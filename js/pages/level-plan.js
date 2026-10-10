import { sfx } from "../effects.js";
import { escapeHtml, formatCount, readBig, readCount, sortByName } from "../format.js";
import { applyExpCoupons, asBig, buildPlan, formatMinutes, formatPerMinute, formatSigned, hourMeso, mulDivRound, shortCount } from "../hunt-calc.js";
import { findJob, jobStyle, normalizeJobName } from "../job-label.js";
import { levelExpSeed } from "../level-exp-seed.js";
import { loadMainCharacter, mainCharacterId } from "../profile.js";
import { getSupabase } from "../supabase-client.js";
import { notify } from "../toast.js";
import { translateDbError } from "../db-error.js";

const planKey = "yourmaple.huntPlan";

function couponCountText(count, label) {
  return `${label} ${count.toLocaleString("ko-KR")}장`;
}

function couponPlanNote(doubleCount, tripleCount, plan, savedText) {
  if (plan.cover === "triple") {
    return ` ${couponCountText(tripleCount, "15분 3배 경쿠")}이 남은 사냥보다 많아서, 전부 3배로 잡아 ${savedText} 줄었습니다.`;
  }
  if (plan.cover === "double") {
    return ` ${couponCountText(doubleCount, "15분 2배 경쿠")}이 남은 사냥보다 많아서, 전부 2배로 잡아 ${savedText} 줄었습니다.`;
  }
  const parts = [];
  if (tripleCount > 0) parts.push(couponCountText(tripleCount, "15분 3배 경쿠"));
  if (doubleCount > 0) parts.push(couponCountText(doubleCount, "15분 2배 경쿠"));
  const phrase = parts.length === 2 ? `${parts[0]}과 ${parts[1]}` : parts[0];
  if (plan.cover === "mixed") {
    return ` ${phrase}이 남은 사냥보다 많아서, 3배를 먼저 쓰고 남은 구간을 2배로 잡아 ${savedText} 줄었습니다.`;
  }
  return ` ${phrase}을 한 장씩 쓰면 ${savedText} 줄었습니다.`;
}

function moneyClass(value) {
  if (value > 0n) return "is-gain";
  if (value < 0n) return "is-loss";
  return "";
}

function writeGrouped(input, amount) {
  input.value = asBig(amount).toLocaleString("ko-KR");
}

function groupDigits(text) {
  return text.replace(/\D/g, "").replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function applyGrouped(input) {
  const raw = input.value;
  const caret = input.selectionStart ?? raw.length;
  const signed = input.hasAttribute("data-signed");
  const negative = signed && raw.includes("-");
  const body = groupDigits(raw);
  const next = negative ? (body ? `-${body}` : "-") : body;
  if (next === raw) return;
  const digitsBefore = raw.slice(0, caret).replace(/\D/g, "").length;
  input.value = next;
  if (digitsBefore === 0) {
    const pos = next.startsWith("-") && raw.slice(0, caret).includes("-") ? 1 : 0;
    input.setSelectionRange(pos, pos);
    return;
  }
  let seen = 0;
  let pos = next.length;
  for (let index = 0; index < next.length; index += 1) {
    if (/\d/.test(next[index])) seen += 1;
    if (seen === digitsBefore) {
      pos = index + 1;
      break;
    }
  }
  input.setSelectionRange(pos, pos);
}

function showMessage(target, text, kind) {
  target.hidden = !text;
  target.textContent = text;
  target.className = `form-message is-${kind}`;
}

export async function render(root) {
  root.innerHTML = `
    <div class="lp-page">
      <header class="ym-page-head">
        <h1>레벨업 계산</h1>
        <p>목표 레벨까지 필요한 경험치와, 고른 사냥 기록으로 걸리는 시간을 계산해요.</p>
      </header>
      <form class="lp-layout" id="plan-form" autocomplete="off">
        <div class="lp-main">
          <section class="lp-hero">
            <input type="hidden" name="character_pick" value="" />
            <div class="lp-chips" data-character-chips></div>
            <div class="lp-steps">
              <div class="lp-step">
                <span class="lp-label">현재 레벨</span>
                <span class="lp-stepper">
                  <button type="button" data-step="from_level" data-delta="-1" aria-label="현재 레벨 내리기">−</button>
                  <label class="lp-lv"><span>Lv.</span><input name="from_level" inputmode="numeric" aria-label="현재 레벨" /></label>
                  <button type="button" data-step="from_level" data-delta="1" aria-label="현재 레벨 올리기">+</button>
                </span>
              </div>
              <label class="lp-step lp-exp">
                <span class="lp-label">현재 경험치 <small data-exp-percent></small></span>
                <span class="lp-exp-well"><input name="current_exp" inputmode="numeric" data-grouped placeholder="이 레벨에서 채운 양" /></span>
              </label>
              <span class="lp-flow" aria-hidden="true"></span>
              <div class="lp-step">
                <span class="lp-label">목표 레벨</span>
                <span class="lp-stepper is-goal">
                  <button type="button" data-step="to_level" data-delta="-1" aria-label="목표 레벨 내리기">−</button>
                  <label class="lp-lv"><span>Lv.</span><input name="to_level" inputmode="numeric" enterkeyhint="next" aria-label="목표 레벨" /></label>
                  <button type="button" data-step="to_level" data-delta="1" aria-label="목표 레벨 올리기">+</button>
                </span>
              </div>
            </div>
            <div class="lp-total">
              <div>
                <span data-total-label>필요 경험치</span>
                <strong data-total>-</strong>
              </div>
              <span class="lp-total-short" data-total-short></span>
            </div>
            <p class="form-message" data-plan-status hidden></p>
          </section>

          <section class="lp-panel lp-picks-panel">
            <div class="lp-panel-head">
              <h2>기준 사냥 기록</h2>
              <span data-hunt-picks-label>캐릭터를 고르면 그 직업의 기록이 나와요</span>
              <button class="lp-ghost" type="button" data-goto-hunt-add>+ 사냥 기록</button>
            </div>
            <input type="hidden" name="hunt_pick" value="" />
            <div class="lp-picks" data-hunt-pick-list role="group" aria-label="기준 사냥 기록">
              <p class="lp-muted">사냥 기록을 불러오는 중입니다.</p>
            </div>
          </section>

          <section class="lp-panel lp-levels">
            <div class="lp-panel-head">
              <h2>레벨별 필요 경험치</h2>
              <span>첫 레벨은 남은 양만 계산해요</span>
            </div>
            <div class="lp-rows" data-level-rows><p class="lp-muted">레벨을 정하면 나와요.</p></div>
          </section>
        </div>

        <aside class="lp-side">
          <section class="lp-panel lp-time">
            <h2>예상 소요 시간</h2>
            <div class="lp-wells">
              <label class="lp-well"><span>분당 경험치</span><input name="exp_minute" value="0" inputmode="numeric" data-grouped /></label>
              <label class="lp-well"><span>1시간 경험치</span><input name="exp_hour" value="0" inputmode="numeric" data-grouped /></label>
              <label class="lp-well"><span>순메소</span><input class="is-gain" name="meso_amount" value="0" inputmode="text" data-grouped data-signed placeholder="적자는 -" /></label>
              <label class="lp-well"><span>1시간 쩔비</span><input name="leech_fee" value="0" inputmode="text" data-grouped data-signed placeholder="내가 내면 -" /></label>
              <label class="lp-well"><span>1시간 물약</span><input class="is-loss" name="potion_cost" value="0" inputmode="numeric" data-grouped placeholder="없으면 0" /></label>
              <label class="lp-well is-sum"><span>총 1시간 메소</span><input name="hour_meso" value="0" readonly tabindex="-1" aria-readonly="true" /></label>
            </div>
            <div class="lp-coupons">
              <div class="lp-coupon">
                <span><strong>15분 2배 경쿠</strong><small>장수만큼 15분씩 2배</small></span>
                <span class="lp-mini-step"><button type="button" data-step="exp_coupon" data-delta="-1" aria-label="2배 경쿠 줄이기">−</button><input name="exp_coupon" inputmode="numeric" placeholder="0" aria-label="15분 2배 경쿠 장수" /><button type="button" data-step="exp_coupon" data-delta="1" aria-label="2배 경쿠 늘리기">+</button></span>
              </div>
              <div class="lp-coupon">
                <span><strong>15분 3배 경쿠</strong><small>3배를 먼저 써요</small></span>
                <span class="lp-mini-step"><button type="button" data-step="exp_coupon_3" data-delta="-1" aria-label="3배 경쿠 줄이기">−</button><input name="exp_coupon_3" inputmode="numeric" placeholder="0" aria-label="15분 3배 경쿠 장수" /><button type="button" data-step="exp_coupon_3" data-delta="1" aria-label="3배 경쿠 늘리기">+</button></span>
              </div>
            </div>
            <div class="lp-tiles" data-plan-result></div>
            <div class="lp-days">
              <span class="lp-days-top">하루 사냥 시간<strong data-hours-label>2시간</strong></span>
              <input type="range" name="day_hours" min="1" max="12" step="1" value="2" aria-label="하루 사냥 시간" />
              <span class="lp-days-out" data-days>사냥 효율을 적으면 며칠 걸리는지 알려 줘요</span>
            </div>
            <p class="lp-note" data-plan-note></p>
          </section>
          <section class="lp-panel lp-quests">
            <h2>퀘스트로 채우면</h2>
            <div data-quest-fill><p class="lp-muted">불러오는 중입니다.</p></div>
          </section>
        </aside>
      </form>
    </div>
  `;

  const planForm = root.querySelector("#plan-form");
  const planNote = root.querySelector("[data-plan-note]");
  const planStatus = root.querySelector("[data-plan-status]");
  const planResult = root.querySelector("[data-plan-result]");

  let hunts = [];
  let curveRows = [];
  let characters = [];
  let accounts = [];
  let jobs = [];
  let quests = [];
  let doneQuests = new Set();
  let planExpSource = "minute";

  function curveOf() {
    const map = new Map();
    for (const [level, exp] of levelExpSeed) map.set(level, asBig(exp));
    return map;
  }

  function syncExp(form, source) {
    const minute = form.elements.exp_minute;
    const hour = form.elements.exp_hour;
    if (source === "minute") {
      const parsed = readBig(minute.value, "분당 경험치", 0n);
      if (parsed.error || parsed.value == null) return;
      writeGrouped(hour, parsed.value * 60n);
      return;
    }
    const parsed = readBig(hour.value, "1시간 경험치", 0n);
    if (parsed.error || parsed.value == null) return;
    if (parsed.value % 60n === 0n) writeGrouped(minute, parsed.value / 60n);
    else minute.value = "";
  }

  function readHourExp(form, source) {
    const minuteText = form.elements.exp_minute.value.trim();
    const hourText = form.elements.exp_hour.value.trim();
    if (source === "minute" && minuteText) {
      const parsed = readBig(minuteText, "분당 경험치", 1n);
      if (parsed.error) return parsed;
      if (parsed.value == null) return { error: "분당 경험치나 1시간 경험치를 입력해 주세요." };
      return { value: parsed.value * 60n };
    }
    if (hourText) {
      const parsed = readBig(hourText, "1시간 경험치", 1n);
      if (parsed.error) return parsed;
      if (parsed.value == null) return { error: "분당 경험치나 1시간 경험치를 입력해 주세요." };
      return parsed;
    }
    if (minuteText) {
      const parsed = readBig(minuteText, "분당 경험치", 1n);
      if (parsed.error) return parsed;
      if (parsed.value == null) return { error: "분당 경험치나 1시간 경험치를 입력해 주세요." };
      return { value: parsed.value * 60n };
    }
    return { error: "분당 경험치나 1시간 경험치를 입력해 주세요." };
  }

  function readSigned(amountText, label, minusHint) {
    const text = String(amountText ?? "").trim().replaceAll(",", "").replaceAll(" ", "");
    if (!text || text === "-") return { value: 0n };
    if (!/^-?\d+$/.test(text)) return { error: `${label}에는 숫자만 입력해 주세요. ${minusHint}` };
    if (text.replace("-", "").length > 40) return { error: `${label} 숫자가 너무 큽니다.` };
    return { value: BigInt(text) };
  }

  function readMeso(amountText) {
    return readSigned(amountText, "순메소", "적자는 -를 붙입니다.");
  }

  function readLeech(amountText) {
    return readSigned(amountText, "1시간 쩔비", "내가 내는 쩔비는 -를 붙입니다.");
  }

  function savePlan() {
    const data = {
      from_level: planForm.elements.from_level.value,
      to_level: planForm.elements.to_level.value,
      current_exp: planForm.elements.current_exp.value,
      exp_minute: planForm.elements.exp_minute.value,
      exp_hour: planForm.elements.exp_hour.value,
      meso_amount: planForm.elements.meso_amount.value,
      potion_cost: planForm.elements.potion_cost.value,
      leech_fee: planForm.elements.leech_fee.value,
      exp_coupon: planForm.elements.exp_coupon.value,
      exp_coupon_3: planForm.elements.exp_coupon_3.value,
      day_hours: planForm.elements.day_hours.value,
      character_pick: planForm.elements.character_pick.value,
      expSource: planExpSource,
    };
    try {
      sessionStorage.setItem(planKey, JSON.stringify(data));
    } catch {
      // 브라우저가 저장을 막아도 계산은 그대로 보여 줍니다.
    }
  }

  function restorePlan() {
    try {
      const raw = sessionStorage.getItem(planKey);
      if (!raw) return;
      const data = JSON.parse(raw);
      for (const [key, value] of Object.entries(data)) {
        if (key === "expSource" || typeof value !== "string") continue;
        const field = planForm.elements.namedItem(key);
        if (field) field.value = value;
      }
      if (data.expSource === "hour" || data.expSource === "minute") planExpSource = data.expSource;
      const amount = planForm.elements.meso_amount;
      if (data.meso_sign === "0") amount.value = "";
      else if (data.meso_sign === "-1" && amount.value && !amount.value.trim().startsWith("-")) {
        amount.value = `-${amount.value.replace(/^-/, "")}`;
      }
    } catch {
      // 이전 입력이 깨져 있으면 빈 칸으로 시작합니다.
    }
  }

  function setFieldTone(input, className) {
    input.classList.toggle("is-gain", className === "is-gain");
    input.classList.toggle("is-loss", className === "is-loss");
  }

  function paintPlanMoney() {
    const mesoInput = planForm.elements.meso_amount;
    const leechInput = planForm.elements.leech_fee;
    const potionInput = planForm.elements.potion_cost;
    const totalInput = planForm.elements.hour_meso;
    const meso = readMeso(mesoInput.value);
    const leech = readLeech(leechInput.value);
    const potion = readBig(potionInput.value, "1시간 물약", 0n);
    setFieldTone(mesoInput, "is-gain");
    setFieldTone(potionInput, "is-loss");
    setFieldTone(leechInput, leech.error ? "" : moneyClass(leech.value ?? 0n));
    if (meso.error || leech.error || potion.error) {
      totalInput.value = "-";
      setFieldTone(totalInput, "");
      return;
    }
    const net = hourMeso(meso.value ?? 0n, leech.value ?? 0n, potion.value ?? 0n);
    totalInput.value = formatSigned(net);
    setFieldTone(totalInput, moneyClass(net));
  }

  function clearOutputs(message, kind = "info") {
    planResult.innerHTML = "";
    planNote.textContent = "";
    root.querySelector("[data-total]").textContent = "-";
    root.querySelector("[data-total-label]").textContent = "필요 경험치";
    root.querySelector("[data-total-short]").textContent = "";
    root.querySelector("[data-level-rows]").innerHTML = `<p class="lp-muted">레벨을 정하면 나와요.</p>`;
    root.querySelector("[data-exp-percent]").textContent = "";
    root.querySelector("[data-days]").textContent = "사냥 효율을 적으면 며칠 걸리는지 알려 줘요";
    showMessage(planStatus, message, kind);
    paintQuestFill(null);
  }

  function paintDayHours() {
    root.querySelector("[data-hours-label]").textContent = `${planForm.elements.day_hours.value}시간`;
  }

  // 레벨별 줄: 첫 레벨은 남은 양, 나머지는 전체. 막대는 구간에서 가장 큰 레벨 기준.
  function paintLevelRows(from, to, current) {
    const box = root.querySelector("[data-level-rows]");
    const curve = curveOf();
    const rows = [];
    for (let level = from; level < to; level += 1) {
      const need = asBig(curve.get(level));
      rows.push({ level, need, left: level === from ? need - current : need });
    }
    const max = rows.reduce((value, row) => (row.need > value ? row.need : value), 1n);
    const total = rows.reduce((sum, row) => sum + row.left, 0n);
    const LIMIT = 40;
    let cum = 0n;
    const html = rows.map((row, index) => {
      cum += row.left;
      if (index >= LIMIT) return "";
      const width = Number((row.left * 1000n) / max) / 10;
      const pct = total > 0n ? Number((cum * 100n) / total) : 100;
      return `<div class="lp-row" style="--i:${Math.min(index, 16)}">
        <strong>Lv.${row.level} → ${row.level + 1}</strong>
        <span class="lp-row-bar"><i style="width:${Math.max(2, width)}%"></i></span>
        <span class="lp-row-need"><b>${escapeHtml(shortCount(row.left))}</b>${row.left !== row.need ? `<small>전체 ${escapeHtml(shortCount(row.need))} 중</small>` : ""}</span>
        <span class="lp-row-cum">${pct}%</span>
      </div>`;
    });
    const more = rows.length > LIMIT ? `<p class="lp-muted">그 밖에 ${rows.length - LIMIT}레벨은 합계에 들어 있어요.</p>` : "";
    box.innerHTML = html.join("") + more;
  }

  // 퀘스트 보상 경험치로 남은 양을 얼마나 채우는지. 고른 캐릭터가 이미 끝낸 퀘스트와 레벨이 안 되는 퀘스트는 뺀다.
  function paintQuestFill(span) {
    const box = root.querySelector("[data-quest-fill]");
    if (!box) return;
    if (!span || span.remaining <= 0n) {
      box.innerHTML = `<p class="lp-muted">${span ? "이미 다 채웠어요." : "레벨을 정하면 보여 줘요."}</p>`;
      return;
    }
    const character = pickedCharacter();
    const rows = quests
      .filter((quest) => asBig(quest.exp_reward) > 0n && Number(quest.start_level || 0) <= span.from)
      .filter((quest) => !character || !doneQuests.has(`${character.id}:${quest.id}`))
      .sort((left, right) => (asBig(right.exp_reward) > asBig(left.exp_reward) ? 1 : -1))
      .slice(0, 5);
    if (!rows.length) {
      box.innerHTML = `<p class="lp-muted">${quests.length ? "지금 레벨에서 할 수 있는 경험치 퀘스트가 없어요." : "퀘스트 보상 경험치를 적어 두면 여기서 보여 줘요."}</p>`;
      return;
    }
    const sum = rows.reduce((total, quest) => total + asBig(quest.exp_reward), 0n);
    box.innerHTML = rows
      .map((quest, index) => {
        const exp = asBig(quest.exp_reward);
        const basis = exp > span.remaining ? 10000n : (exp * 10000n) / span.remaining;
        const pct = `${(Number(basis) / 100).toFixed(1)}%`;
        return `<div class="lp-quest" style="--i:${index}">
          <span class="lp-quest-top"><strong>${escapeHtml(quest.name)}</strong><span>${escapeHtml(shortCount(exp))} · <b>${pct}</b></span></span>
          <span class="lp-quest-bar"><i style="width:${Number(basis) / 100}%"></i></span>
        </div>`;
      })
      .join("") + `<p class="lp-muted">위 ${rows.length}개를 다 하면 남은 양의 ${sum >= span.remaining ? "100" : (Number((sum * 1000n) / span.remaining) / 10).toFixed(1)}%를 채워요.${character ? ` 이미 끝낸 퀘스트는 뺐어요(${escapeHtml(character.name)} 기준).` : ""}</p>`;
  }

  function paintPlan() {
    paintPlanMoney();
    paintDayHours();
    savePlan();
    const fromText = planForm.elements.from_level.value;
    const toText = planForm.elements.to_level.value;
    if (!fromText.trim() || !toText.trim()) {
      clearOutputs("");
      return;
    }

    const from = readCount(fromText, "현재 레벨", 1);
    const to = from.error ? from : readCount(toText, "목표 레벨", 1);
    const current = to.error ? to : readBig(planForm.elements.current_exp.value, "현재 경험치", 0n);
    // 효율 칸이 비었거나 0이면 아직 안 적은 것으로 본다(캐릭터만 고른 상태). 시간 대신 필요 경험치만 보여 준다.
    const blankRate = ["exp_minute", "exp_hour"].every((name) => /^[0,\s]*$/.test(planForm.elements[name].value));
    const exp = current.error ? current : blankRate ? { error: "분당 경험치나 1시간 경험치를 입력해 주세요." } : readHourExp(planForm, planExpSource);
    const allowEmptyExp = exp.error === "분당 경험치나 1시간 경험치를 입력해 주세요.";
    const meso = exp.error && !allowEmptyExp ? exp : readMeso(planForm.elements.meso_amount.value);
    const potion = meso.error ? meso : readBig(planForm.elements.potion_cost.value, "1시간 물약", 0n);
    const leech = potion.error ? potion : readLeech(planForm.elements.leech_fee.value);
    const coupon = leech.error ? leech : readCount(planForm.elements.exp_coupon.value, "15분 경쿠 2배", 0);
    const coupon3 = coupon.error ? coupon : readCount(planForm.elements.exp_coupon_3.value, "15분 경쿠 3배", 0);
    const failed = [from, to, current, allowEmptyExp ? { error: "" } : exp, meso, potion, leech, coupon, coupon3].find((item) => item.error);
    if (failed) {
      clearOutputs(failed.error, "error");
      return;
    }

    let result;
    try {
      result = buildPlan({
        fromLevel: from.value,
        toLevel: to.value,
        currentExp: current.value ?? 0n,
        expPerHour: allowEmptyExp ? null : exp.value,
        mesoPerHour: meso.value ?? 0n,
        potionPerHour: potion.value ?? 0n,
        leechPerHour: leech.value ?? 0n,
        curve: curveOf(),
      });
    } catch {
      result = { error: "계산하지 못했습니다. 입력한 숫자를 확인해 주세요." };
    }
    if (result.error) {
      clearOutputs(result.error, "error");
      return;
    }

    showMessage(planStatus, "", "info");
    const bar = asBig(curveOf().get(from.value));
    const currentValue = current.value ?? 0n;
    root.querySelector("[data-exp-percent]").textContent = bar > 0n && currentValue > 0n ? `· ${(Number((currentValue * 10000n) / bar) / 100).toFixed(2)}%` : "";
    root.querySelector("[data-total-label]").textContent = `필요 경험치 · ${to.value - from.value}레벨`;
    root.querySelector("[data-total]").textContent = formatCount(result.remaining);
    root.querySelector("[data-total-short]").textContent = result.remaining >= 10000n ? `약 ${shortCount(result.remaining)}` : "";
    paintLevelRows(from.value, to.value, currentValue);
    paintQuestFill({ from: from.value, remaining: result.remaining });

    const cards = coupon.value ?? 0;
    const cards3 = coupon3.value ?? 0;
    const couponPlan =
      (cards > 0 || cards3 > 0) && result.minutes != null && result.minutes > 0n
        ? applyExpCoupons(result.remaining, exp.value, { double: cards, triple: cards3 })
        : null;
    const rateText = allowEmptyExp ? "" : `${shortCount(exp.value)}/h`;
    const time = result.minutes == null ? "효율을 적어 주세요" : result.remaining === 0n ? "이미 채웠어요" : formatMinutes(result.minutes);
    const savedText = couponPlan ? (couponPlan.saved > 0n ? formatMinutes(couponPlan.saved) : "1분 미만") : "";
    const grossValue = meso.value ?? 0n;
    const leechValue = leech.value ?? 0n;
    const potionValue = potion.value ?? 0n;
    const hourNet = hourMeso(grossValue, leechValue, potionValue);
    const netText = result.net == null ? "-" : formatSigned(result.net);
    planResult.innerHTML = `
      <div class="is-time"><span>걸리는 시간${rateText ? ` · ${escapeHtml(rateText)}` : ""}</span><strong>${escapeHtml(time)}</strong></div>
      <div class="${couponPlan ? "is-coupon" : ""}"><span>${couponPlan ? `경쿠 쓰면 · ${escapeHtml(savedText)} 단축` : "경쿠 쓰면"}</span><strong>${couponPlan ? escapeHtml(formatMinutes(couponPlan.minutes)) : "—"}</strong></div>
      <div><span>1시간 메소</span><strong class="${moneyClass(hourNet)}">${escapeHtml(formatSigned(hourNet))}</strong></div>
      <div><span>예상 금액</span><strong class="${result.net == null ? "" : moneyClass(result.net)}">${escapeHtml(netText)}</strong></div>
    `;
    const minutes = couponPlan ? couponPlan.minutes : result.minutes;
    const hours = BigInt(Number(planForm.elements.day_hours.value) || 2);
    const days = root.querySelector("[data-days]");
    if (minutes == null) days.textContent = "사냥 효율을 적으면 며칠 걸리는지 알려 줘요";
    else if (minutes === 0n) days.textContent = "오늘 바로 끝나요";
    else {
      const count = (minutes + hours * 60n - 1n) / (hours * 60n);
      days.innerHTML = `${couponPlan ? "경쿠 포함 " : ""}약 <strong>${escapeHtml(count.toLocaleString("ko-KR"))}일</strong>`;
    }
    const couponNote = couponPlan ? couponPlanNote(cards, cards3, couponPlan, savedText) : "";
    planNote.textContent = couponNote.trim();
  }

  function characterOption(character) {
    const job = character.job ? ` · ${character.job}` : "";
    const level = character.level ? ` · ${character.level}` : "";
    return `<option value="${character.id}">${escapeHtml(character.name)}${escapeHtml(job)}${escapeHtml(level)}</option>`;
  }

  function compareCharacter(left, right) {
    const level = (right.level ?? -1) - (left.level ?? -1);
    if (level) return level;
    return left.name.localeCompare(right.name, "ko");
  }

  function characterSelectHtml(placeholder) {
    const groups = accounts
      .map((account) => {
        const members = characters.filter((character) => character.account_id === account.id).sort(compareCharacter);
        if (!members.length) return "";
        return `<optgroup label="${escapeHtml(account.name)}">${members.map(characterOption).join("")}</optgroup>`;
      })
      .filter(Boolean);
    const known = new Set(accounts.map((account) => account.id));
    const loose = characters.filter((character) => !known.has(character.account_id)).sort(compareCharacter);
    if (loose.length) groups.push(`<optgroup label="계정 없음">${loose.map(characterOption).join("")}</optgroup>`);
    return [`<option value="">${placeholder}</option>`, ...groups].join("");
  }

  function paintCharacterPick() {
    const input = planForm.elements.character_pick;
    if (input.value && !characters.some((character) => character.id === input.value)) input.value = "";
    const box = root.querySelector("[data-character-chips]");
    const chip = (id, name, sub, style) => {
      const on = input.value === id;
      return `<button type="button" class="lp-chip${on ? " is-on" : ""}" data-character-pick="${id}" aria-pressed="${on}"${style ? ` style="${style}"` : ""}>${escapeHtml(name)}${sub ? `<span>${escapeHtml(sub)}</span>` : ""}</button>`;
    };
    const list = [...characters].sort(compareCharacter);
    box.innerHTML = list.map((character) => chip(character.id, character.name, character.level ? `Lv.${character.level}` : "", jobStyle(findJob(jobs, character.job)))).join("") + chip("", "직접 입력", "", "");
  }

  function pickedCharacter() {
    return characters.find((item) => item.id === planForm.elements.character_pick.value) || null;
  }

  function sameJob(left, right) {
    const leftJob = findJob(jobs, left);
    const rightJob = findJob(jobs, right);
    if (leftJob && rightJob) return leftJob.id === rightJob.id;
    const key = normalizeJobName(left);
    return Boolean(key) && key === normalizeJobName(right);
  }

  function compareHuntLevel(left, right) {
    const level = Number(right.level || 0) - Number(left.level || 0);
    if (level) return level;
    return String(right.created_at || "").localeCompare(String(left.created_at || ""));
  }

  function huntsForCharacter() {
    const character = pickedCharacter();
    const rows = character ? hunts.filter((row) => sameJob(row.job, character.job)) : hunts;
    return [...rows].sort(compareHuntLevel);
  }

  function huntFigures(row) {
    try {
      const hourValue = asBig(row.exp_per_hour);
      const grossValue = asBig(row.meso_per_hour);
      const leechValue = asBig(row.leech_fee);
      const potionValue = asBig(row.potion_cost);
      const netValue = hourMeso(grossValue, leechValue, potionValue);
      return {
        minute: formatPerMinute(hourValue),
        meso: formatSigned(netValue),
        mesoClass: moneyClass(netValue),
      };
    } catch {
      return { minute: "-", meso: "-", mesoClass: "" };
    }
  }

  function paintHuntPick() {
    const input = planForm.elements.hunt_pick;
    const list = root.querySelector("[data-hunt-pick-list]");
    const label = root.querySelector("[data-hunt-picks-label]");
    const character = pickedCharacter();
    const rows = character ? huntsForCharacter() : [];
    if (character && input.value && !rows.some((row) => row.id === input.value)) input.value = "";
    const selected = input.value;
    if (!character) {
      label.textContent = "캐릭터를 고르면 그 직업의 기록이 나와요";
      list.innerHTML = `<p class="lp-muted">캐릭터를 고르거나 오른쪽에 효율을 직접 적어 주세요.</p>`;
      return;
    }
    if (!rows.length) {
      label.textContent = "기록 없음";
      const who = character.job || character.name;
      list.innerHTML = `<p class="lp-muted">${escapeHtml(who)} 사냥 기록이 없습니다. <a href="#/hunts?add=1">사냥 기록 추가</a>에서 만들어 보세요.</p>`;
      return;
    }
    label.textContent = `${rows.length}개 · 레벨 높은 순 · 누르면 효율을 가져와요`;
    list.innerHTML = rows
      .map((row) => {
        const figures = huntFigures(row);
        const heading = String(row.title || "").trim() || row.character_name;
        const other = row.character_name && row.character_name !== character.name ? row.character_name : "";
        const pressed = row.id === selected;
        const meta = other ? `<span class="hunt-pick-meta">${escapeHtml(other)}</span>` : "";
        const mark = pressed ? `<span class="hunt-pick-badge">기준</span>` : `<span class="hunt-pick-radio" aria-hidden="true"></span>`;
        return `<button class="hunt-pick${pressed ? " is-selected" : ""}" type="button" data-pick-hunt="${row.id}" aria-pressed="${pressed ? "true" : "false"}">
          <span class="hunt-pick-top">
            <span class="hunt-pick-title">${escapeHtml(heading)}</span>
            ${mark}
          </span>
          <span class="hunt-pick-level">${escapeHtml(formatCount(row.level))}레벨</span>
          ${meta}
          <span class="hunt-pick-stats">
            <span><span>분당 경험치</span><strong>${escapeHtml(figures.minute)}</strong></span>
            <span><span>1시간 메소</span><strong class="${figures.mesoClass}">${escapeHtml(figures.meso)}</strong></span>
          </span>
        </button>`;
      })
      .join("");
    const chosen = list.querySelector(".hunt-pick.is-selected");
    if (!chosen || chosen.offsetParent !== list) return;
    const top = chosen.offsetTop;
    const bottom = top + chosen.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }

  function focusPlanInput(input, options = {}) {
    input.focus({ focusVisible: true, preventScroll: Boolean(options.preventScroll) });
    const end = input.value.length;
    input.setSelectionRange(0, end);
  }

  function ensureNextTarget() {
    const from = Number(planForm.elements.from_level.value);
    if (!Number.isInteger(from) || from < 1 || from >= 200) return;
    if (planForm.elements.to_level.value.trim()) return;
    planForm.elements.to_level.value = String(from + 1);
  }

  function revealCurrentExp() {
    const input = planForm.elements.current_exp;
    focusPlanInput(input, { preventScroll: true });
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const margin = Number.parseFloat(getComputedStyle(input).scrollMarginTop) || 0;
    const top = input.getBoundingClientRect().top + window.scrollY - margin;
    window.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
  }

  const planBlankFields = ["to_level", "current_exp", "exp_coupon", "exp_coupon_3"];
  const planInfoFields = ["meso_amount", "leech_fee", "potion_cost", "exp_minute", "exp_hour"];

  function clearPlanRates() {
    for (const name of planBlankFields) planForm.elements[name].value = "";
    for (const name of planInfoFields) planForm.elements[name].value = "0";
    planForm.elements.hunt_pick.value = "";
    planExpSource = "minute";
  }

  function applyCharacter(character) {
    clearPlanRates();
    planForm.elements.from_level.value = character.level ? String(character.level) : "";
    // 캐릭터 화면에 적어 둔 현재 경험치가 있으면 가져온다(sql/029).
    if (character.exp != null && character.exp !== "") writeGrouped(planForm.elements.current_exp, asBig(character.exp));
    ensureNextTarget();
    paintHuntPick();
    paintPlan();
  }

  function applyHunt(hunt) {
    if (!pickedCharacter()) planForm.elements.from_level.value = String(hunt.level);
    ensureNextTarget();
    const hour = asBig(hunt.exp_per_hour);
    writeGrouped(planForm.elements.exp_hour, hour);
    if (hour % 60n === 0n) writeGrouped(planForm.elements.exp_minute, hour / 60n);
    else planForm.elements.exp_minute.value = "";
    planExpSource = "hour";
    writeGrouped(planForm.elements.meso_amount, asBig(hunt.meso_per_hour));
    writeGrouped(planForm.elements.leech_fee, asBig(hunt.leech_fee));
    writeGrouped(planForm.elements.potion_cost, asBig(hunt.potion_cost));
    planForm.elements.hunt_pick.value = hunt.id;
    paintHuntPick();
    paintPlan();
    const huntId = hunt.id;
    setTimeout(() => {
      if (!planForm.isConnected) return;
      if (planForm.elements.hunt_pick.value !== huntId) return;
      revealCurrentExp();
    }, 0);
  }

  async function saveMissingLevels(supabase) {
    const have = new Set(curveRows.map((row) => Number(row.level)));
    const missing = levelExpSeed.filter(([level]) => !have.has(level));
    if (!missing.length) return { error: null, added: 0 };
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    const userId = sessionData.session?.user?.id;
    if (sessionError || !userId) return { error: sessionError || { message: "JWT" }, added: 0 };
    const payload = missing.map(([level, exp]) => ({
      user_id: userId,
      level,
      exp_to_next: exp,
    }));
    const { data, error } = await supabase
      .from("level_exp")
      .upsert(payload, { onConflict: "user_id,level" })
      .select("id, level, exp_to_next");
    if (error) return { error, added: 0 };
    const byLevel = new Map(curveRows.map((row) => [Number(row.level), row]));
    for (const row of data ?? []) byLevel.set(Number(row.level), row);
    curveRows = [...byLevel.values()].sort((a, b) => Number(a.level) - Number(b.level));
    return { error: null, added: data?.length ?? missing.length };
  }

  async function loadAll() {
    const supabase = await getSupabase();
    const [huntResult, curveResult, firstCharacters, accountResult, questResult, progressResult] = await Promise.all([
      supabase.from("hunts").select("id, character_id, character_name, job, level, potion_cost, leech_fee, exp_per_hour, meso_per_hour, title, memo, created_at").order("created_at", { ascending: false }),
      supabase.from("level_exp").select("id, level, exp_to_next").order("level", { ascending: true }),
      supabase.from("characters").select("id, account_id, name, job, level, exp"),
      supabase.from("accounts").select("id, name").order("name"),
      supabase.from("quests").select("id, name, start_level, exp_reward"),
      supabase.from("character_quests").select("quest_id, character_id, completed"),
      loadMainCharacter(),
    ]);
    // sql/029 실행 전이면 exp 칸이 없다. 빼고 다시 읽는다.
    const characterResult = firstCharacters.error && /\bexp\b/i.test(`${firstCharacters.error.message || ""}`)
      ? await supabase.from("characters").select("id, account_id, name, job, level")
      : firstCharacters;
    const jobResult = await supabase.from("jobs").select("id, family, name, color, color_dark, sort_order").order("sort_order");
    if (!root.isConnected) return;
    quests = questResult.error ? [] : (questResult.data ?? []);
    doneQuests = new Set((progressResult.error ? [] : (progressResult.data ?? [])).filter((row) => row.completed).map((row) => `${row.character_id}:${row.quest_id}`));
    const error = huntResult.error || curveResult.error || characterResult.error;
    if (error) {
      hunts = [];
      curveRows = [];
      characters = [];
      accounts = [];
      jobs = [];
      notify(translateDbError(error), "error");
      paintPlan();
      return;
    }
    hunts = huntResult.data ?? [];
    curveRows = curveResult.data ?? [];
    characters = characterResult.data ?? [];
    accounts = accountResult.error ? [] : sortByName(accountResult.data ?? []);
    jobs = jobResult.error ? [] : (jobResult.data ?? []);
    const seeded = await saveMissingLevels(supabase);
    if (!root.isConnected) return;
    if (seeded.error) notify(translateDbError(seeded.error), "error");
    paintCharacterPick();
    // 처음 열었고 적어 둔 레벨이 없으면 대표 캐릭터로 시작한다.
    if (!planForm.elements.from_level.value.trim() && !planForm.elements.character_pick.value) {
      const main = characters.find((character) => character.id === mainCharacterId()) ?? [...characters].sort(compareCharacter)[0];
      if (main) {
        planForm.elements.character_pick.value = main.id;
        paintCharacterPick();
        applyCharacter(main);
        return;
      }
    }
    paintHuntPick();
    paintPlan();
  }

  function pickCharacter(id) {
    planForm.elements.character_pick.value = id;
    paintCharacterPick();
    const character = characters.find((item) => item.id === id);
    if (character) {
      applyCharacter(character);
      return;
    }
    clearPlanRates();
    planForm.elements.from_level.value = "";
    paintHuntPick();
    paintPlan();
  }

  function stepField(name, delta) {
    const input = planForm.elements[name];
    const value = Number(String(input.value).replaceAll(",", "")) || 0;
    const from = Number(planForm.elements.from_level.value) || 1;
    let next = value + delta;
    if (name === "from_level") next = Math.min(199, Math.max(1, next || 1));
    else if (name === "to_level") next = Math.min(200, Math.max(from + 1, next || from + 1));
    else next = Math.max(0, next);
    input.value = name.startsWith("exp_coupon") && next === 0 ? "" : String(next);
    if (name === "from_level") {
      const to = Number(planForm.elements.to_level.value) || 0;
      if (to <= next) planForm.elements.to_level.value = String(Math.min(200, next + 1));
    }
    sfx("tick");
    paintPlan();
  }

  restorePlan();
  paintPlanMoney();
  planForm.addEventListener("submit", (event) => event.preventDefault());
  planForm.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    if (event.target !== planForm.elements.to_level) return;
    event.preventDefault();
    focusPlanInput(planForm.elements.current_exp);
  });

  root.addEventListener("input", (event) => {
    if (event.target.closest("[data-grouped]")) applyGrouped(event.target);
    if (event.target.form === planForm && (event.target.name === "exp_minute" || event.target.name === "exp_hour")) {
      planExpSource = event.target.name === "exp_minute" ? "minute" : "hour";
      syncExp(planForm, planExpSource);
    }
    if (event.target.form === planForm) paintPlan();
  });

  root.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-character-pick]");
    if (chip) {
      sfx("tick");
      pickCharacter(chip.dataset.characterPick);
      return;
    }
    const step = event.target.closest("[data-step]");
    if (step) {
      stepField(step.dataset.step, Number(step.dataset.delta));
      return;
    }
    if (event.target.closest("[data-goto-hunt-add]")) {
      location.hash = "#/hunts?add=1";
    }
    const pickButton = event.target.closest("[data-pick-hunt]");
    if (pickButton) {
      const hunt = hunts.find((item) => item.id === pickButton.dataset.pickHunt);
      if (hunt) applyHunt(hunt);
    }
  });

  await loadAll();
}
