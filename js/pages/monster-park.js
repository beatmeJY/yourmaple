import { sfx, burstAt } from "../effects.js";
import { attachFaceUrls, faceMarkup } from "../character-face.js";
import { escapeHtml, formatCount } from "../format.js";
import { asBig } from "../hunt-calc.js";
import { findJob, jobStyle } from "../job-label.js";
import { levelExpSeed } from "../level-exp-seed.js";
import { MONSTER_PARK, ZONES, addDays, daysLeft, expFromPercent, percentOf, seoulDate, simulate, zoneLabel, zoneOf } from "../monster-park-calc.js";
import { loadMainCharacter, mainCharacterId } from "../profile.js";
import { isLoggedIn } from "../session.js";
import { getSupabase } from "../supabase-client.js";

// 몬스터파크 계산(이벤트 기간 전용 화면, 2026-10-27). 계산 규칙은 js/monster-park-calc.js.
// 캐릭터 카드를 누르면 레벨·경험치가 채워지고, 오늘 남은 입장과 함께 곧바로 다시 계산한다. 저장하는 것은 없다.
// 이 기기에만 기억: 구역 경험치(모르는 구역을 사용자가 적은 값), 오늘 남은 입장(날짜가 바뀌면 2회로).

const STORE_KEY = "maple-note-monster-park";
const curve = new Map(levelExpSeed.map(([level, exp]) => [level, asBig(exp)]));
const PERCENT_CHIPS = ["0", "25", "50", "75", "99.99"];

function readStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function writeStore(value) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(value));
  } catch {
    // 저장소를 못 쓰는 브라우저면 기억만 안 한다.
  }
}

function shortDate(date, today) {
  const [, month, day] = date.split("-").map(Number);
  const week = "일월화수목금토"[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${month}/${day} (${date === today ? "오늘" : week})`;
}

// "2026-11-30" → "11월 30일"
const endLabel = (() => {
  const [, month, day] = MONSTER_PARK.end.split("-").map(Number);
  return `${month}월 ${day}일`;
})();

function levelText(state) {
  if (state.level >= MONSTER_PARK.maxLevel) return `Lv.${state.level}`;
  return `Lv.${state.level} · ${percentOf(state.exp, curve.get(state.level))}%`;
}

export async function render(root) {
  const today = seoulDate();
  const store = readStore();
  const zoneExp = Object.fromEntries(ZONES.map((zone) => {
    const saved = store.zoneExp?.[zone.id];
    return [zone.id, saved ? asBig(saved) : zone.exp];
  }));
  const todayLeft = store.today?.date === today ? store.today.left ?? {} : {};
  let characters = [];
  let jobs = [];
  let picked = ""; // 캐릭터 id, "" = 직접 입력
  let level = 71;
  let exp = 0n;
  let percentInput = "0";
  let lastReach = false;
  let painted = false;
  const eventDays = daysLeft(today);

  root.innerHTML = `
    <div class="mp-page">
      <header class="ym-page-head">
        <h1>몬스터파크 계산</h1>
        <p>몬스터파크 경험치만으로 130까지 며칠 걸리는지, 이벤트가 끝나는 날 몇 레벨이 되는지 알려 드려요.</p>
      </header>
      <section class="mp-event ym-glass">
        <img class="mp-event-art" src="img/monster-park.png" alt="" width="96" height="96" />
        <span class="ym-badge is-gold">이벤트</span>
        <strong>${eventDays ? `${endLabel}까지 · ${eventDays === 1 ? "오늘 마감" : `D-${eventDays - 1}`}` : "이벤트가 끝났어요"}</strong>
        <span class="mp-event-sub">하루 ${MONSTER_PARK.perDay}회 · 한 판에 1레벨까지만 올라요</span>
      </section>
      <section class="mp-pick" data-pick hidden></section>
      <section class="mp-input ym-glass">
        <div class="mp-field">
          <span class="mp-label">현재 레벨</span>
          <span class="mp-stepper">
            <button type="button" data-level-step="-10" aria-label="10레벨 내리기">−10</button>
            <button type="button" data-level-step="-1" aria-label="1레벨 내리기">−</button>
            <label class="mp-lv"><span>Lv.</span><input data-level inputmode="numeric" aria-label="현재 레벨" /></label>
            <button type="button" data-level-step="1" aria-label="1레벨 올리기">+</button>
            <button type="button" data-level-step="10" aria-label="10레벨 올리기">+10</button>
          </span>
          <span class="mp-zone" data-zone></span>
        </div>
        <div class="mp-field">
          <span class="mp-label">현재 경험치</span>
          <span class="mp-percent">
            <label class="mp-percent-input"><input data-percent inputmode="decimal" aria-label="현재 경험치 퍼센트" /><span>%</span></label>
            ${PERCENT_CHIPS.map((value) => `<button type="button" class="ym-chip" data-percent-chip="${value}">${value}%</button>`).join("")}
          </span>
          <span class="mp-exp-exact" data-exp-exact></span>
        </div>
        <div class="mp-field">
          <span class="mp-label">오늘 남은 입장</span>
          <span class="mp-tickets" role="group" aria-label="오늘 남은 입장">
            ${[0, 1, 2].map((count) => `<button type="button" class="mp-ticket" data-ticket="${count}">${count}회</button>`).join("")}
          </span>
        </div>
      </section>
      <section class="mp-results" data-results></section>
      <section class="mp-warnings" data-warnings></section>
      <section class="mp-timeline ym-glass" data-timeline></section>
      <details class="mp-zones ym-glass">
        <summary>구역별 한 판 경험치</summary>
        <p>값이 다르면 고쳐 적어 주세요. 이 기기에 기억해요.</p>
        <div class="mp-zone-grid">
          ${ZONES.map((zone) => `
            <label class="mp-zone-field">
              <span>Lv.${zoneLabel(zone)}</span>
              <input data-zone-exp="${zone.id}" inputmode="numeric" placeholder="${zone.exp ? formatCount(zone.exp) : "모름"}" value="${zoneExp[zone.id] != null ? formatCount(zoneExp[zone.id]) : ""}" />
            </label>`).join("")}
        </div>
      </details>
    </div>`;

  const levelInput = root.querySelector("[data-level]");
  const percentField = root.querySelector("[data-percent]");

  function ticketsToday() {
    const saved = todayLeft[picked || "manual"];
    return Number.isInteger(saved) ? Math.min(MONSTER_PARK.perDay, Math.max(0, saved)) : MONSTER_PARK.perDay;
  }

  function saveTickets(count) {
    todayLeft[picked || "manual"] = count;
    writeStore({ ...readStore(), today: { date: today, left: todayLeft } });
  }

  function saveZones() {
    const saved = {};
    for (const zone of ZONES) if (zoneExp[zone.id] != null && zoneExp[zone.id] !== zone.exp) saved[zone.id] = zoneExp[zone.id].toString();
    writeStore({ ...readStore(), zoneExp: saved });
  }

  function clampLevel(value) {
    return Math.min(MONSTER_PARK.maxLevel, Math.max(1, Math.round(value) || 1));
  }

  function setLevel(value, { keepPercent = true } = {}) {
    level = clampLevel(value);
    if (keepPercent) exp = level >= MONSTER_PARK.maxLevel ? 0n : expFromPercent(percentInput, curve.get(level));
  }

  function paintPick() {
    const box = root.querySelector("[data-pick]");
    if (!isLoggedIn()) {
      box.hidden = false;
      box.innerHTML = `<p class="mp-login">로그인하면 내 캐릭터를 눌러 레벨·경험치를 바로 채울 수 있어요. <button type="button" class="text-button" data-login-open>로그인</button></p>`;
      return;
    }
    box.hidden = false;
    const card = (character) => {
      const on = picked === character.id;
      const percent = character.level && character.exp != null && curve.has(character.level) ? `${percentOf(asBig(character.exp), curve.get(character.level))}%` : "";
      const out = !character.level || character.level < MONSTER_PARK.minLevel || character.level >= MONSTER_PARK.maxLevel;
      return `<button type="button" class="mp-char${on ? " is-on" : ""}${out ? " is-out" : ""}" data-character="${escapeHtml(character.id)}" aria-pressed="${on}" style="${jobStyle(findJob(jobs, character.job))}">
        <span class="mp-char-face">${faceMarkup(character.face_url) || `<b>${escapeHtml((character.name || "?").slice(0, 1))}</b>`}</span>
        <span class="mp-char-name">${escapeHtml(character.name)}</span>
        <span class="mp-char-lv">${character.level ? `Lv.${character.level}` : "레벨 없음"}${percent ? ` <small>${percent}</small>` : ""}</span>
      </button>`;
    };
    const manualOn = picked === "";
    box.innerHTML = `<div class="mp-char-grid">${characters.map(card).join("")}<button type="button" class="mp-char is-manual${manualOn ? " is-on" : ""}" data-character="" aria-pressed="${manualOn}"><span class="mp-char-face"><b>✎</b></span><span class="mp-char-name">직접 입력</span><span class="mp-char-lv">레벨을 골라요</span></button></div>`;
  }

  function pickCharacter(id) {
    picked = id;
    const character = characters.find((item) => item.id === id);
    if (character?.level) {
      level = clampLevel(character.level);
      exp = character.exp != null && level < MONSTER_PARK.maxLevel ? asBig(character.exp) : 0n;
      const need = curve.get(level);
      if (need && exp >= need) exp = need - 1n;
      percentInput = need ? percentOf(exp, need) : "0";
    }
    paintPick();
    paint();
  }

  function paintInputs() {
    if (document.activeElement !== levelInput) levelInput.value = String(level);
    if (document.activeElement !== percentField) percentField.value = percentInput;
    const zone = zoneOf(level);
    const zoneBox = root.querySelector("[data-zone]");
    zoneBox.textContent = zone ? `${zoneLabel(zone)} 구역 · 한 판 ${zoneExp[zone.id] != null ? formatCount(zoneExp[zone.id]) : "경험치 모름"}` : level < MONSTER_PARK.minLevel ? "50레벨부터 들어갈 수 있어요" : "이미 130이에요";
    zoneBox.classList.toggle("is-unknown", Boolean(zone) && zoneExp[zone.id] == null);
    const need = curve.get(level);
    root.querySelector("[data-exp-exact]").textContent = need && level < MONSTER_PARK.maxLevel ? `${formatCount(exp)} / ${formatCount(need)}` : "";
    for (const chip of root.querySelectorAll("[data-percent-chip]")) chip.setAttribute("aria-pressed", String(chip.dataset.percentChip === percentInput));
    const left = ticketsToday();
    for (const button of root.querySelectorAll("[data-ticket]")) {
      const on = Number(button.dataset.ticket) === left;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-pressed", String(on));
    }
  }

  function stopNote(result) {
    if (result.stop === "unknown") return `Lv.${zoneLabel(result.stopZone)} 구역 경험치를 아직 몰라서 여기까지만 계산했어요`;
    if (result.stop === "low") return "50레벨부터 들어갈 수 있어요";
    return "";
  }

  function paintResults(event, goal) {
    const box = root.querySelector("[data-results]");
    const startLevel = level;
    if (level >= MONSTER_PARK.maxLevel) {
      box.innerHTML = `<article class="mp-result is-reach ym-glass"><span class="mp-result-label">이미 130</span><strong>Lv.130</strong><p>축하해요! 몬스터파크는 이제 쉬어도 돼요.</p></article>`;
      return;
    }
    const finalNeed = curve.get(event.final.level);
    const finalRatio = event.final.level >= MONSTER_PARK.maxLevel || !finalNeed ? 100 : Number((event.final.exp * 10000n) / finalNeed) / 100;
    const gainedLevels = event.final.level - startLevel;
    const reach = event.stop === "max";
    let goalHtml;
    if (goal.stop === "max") {
      const last = goal.runs.at(-1);
      const date = addDays(today, last.day);
      goalHtml = `<strong>${goal.runs.length}판 · ${last.day + 1}일</strong><p>${shortDate(date, today)}에 130${reach ? "" : ` — 이벤트 마감보다 ${last.day + 1 - eventDays}일 더 걸려요`}</p>`;
    } else {
      goalHtml = `<strong>계산 대기</strong><p>${escapeHtml(stopNote(goal))}${goal.runs.length ? ` · 그때까지 ${goal.runs.length}판, ${levelText(goal.final)}` : ""}</p>${goal.stop === "unknown" ? `<button type="button" class="ym-chip mp-zone-open" data-zone-open="${goal.stopZone.id}">Lv.${zoneLabel(goal.stopZone)} 경험치 적기</button>` : ""}`;
    }
    box.innerHTML = `
      <article class="mp-result ${reach ? "is-reach" : ""} ym-glass">
        <span class="mp-result-label">${endLabel} 마감 때</span>
        <strong data-final-level>${reach ? "Lv.130 달성!" : levelText(event.final)}</strong>
        <div class="ym-gauge"><i style="--value:${reach ? 100 : finalRatio}%"></i></div>
        <p>${event.runs.length}판 · ${gainedLevels > 0 ? `+${gainedLevels}레벨` : "레벨 그대로"}${event.stop === "unknown" || event.stop === "low" ? ` · ${escapeHtml(stopNote(event))}` : ""}</p>
      </article>
      <article class="mp-result ym-glass">
        <span class="mp-result-label">130까지</span>
        ${goalHtml}
      </article>`;
    if (reach && !lastReach) {
      sfx("fanfare");
      burstAt(box.querySelector("[data-final-level]"), ["#ffe28a", "#9ff0c4", "#ffffff"], 26, 1);
    }
    lastReach = reach;
    // 처음 한 번만 떠오르게 한다(입력할 때마다 다시 튀지 않게).
    box.classList.toggle("is-first", !painted);
    painted = true;
  }

  // 오늘 판은 하나씩 크게, 내일부터는 한 줄로 묶는다.
  function paintWarnings(event) {
    const items = [];
    let laterLost = 0;
    let laterWasted = 0n;
    let laterWasteRuns = 0;
    for (const run of event.runs) {
      if (run.day > 0) {
        laterLost += run.lostAfter;
        if (run.wasted > 0n) {
          laterWasted += run.wasted;
          laterWasteRuns += 1;
        }
        continue;
      }
      if (run.lostAfter) {
        items.push({ today: true, html: `<b>오늘 ${run.slot + 1}번째 판</b>에서 Lv.${run.after.level}이 되어 ${zoneLabel(zoneOf(run.after.level))} 구역으로 바뀌어요. 오늘 남은 입장 <b>${run.lostAfter}회</b>를 못 써요.` });
      }
      if (run.wasted > 0n) {
        items.push({ today: true, html: `<b>오늘 ${run.slot + 1}번째 판</b>은 1레벨 제한으로 Lv.${run.after.level} 99.99%에서 멈춰요. 버려지는 경험치 <b>${formatCount(run.wasted)}</b>` });
      }
    }
    if (laterLost) items.push({ today: false, html: `내일부터 구역이 바뀌는 날, 남은 입장 <b>${laterLost}회</b>를 못 써요.` });
    if (laterWasteRuns) items.push({ today: false, html: `내일부터 <b>${laterWasteRuns}판</b>이 1레벨 제한에 걸려요. 버려지는 경험치 합계 <b>${formatCount(laterWasted)}</b>` });
    const box = root.querySelector("[data-warnings]");
    box.innerHTML = items
      .map((item, index) => `<p class="mp-warning${item.today ? " is-today" : ""}" style="--i:${index}"><span aria-hidden="true">${item.today ? "⚠" : "!"}</span><span>${item.html}</span></p>`)
      .join("");
  }

  function paintTimeline(event) {
    const box = root.querySelector("[data-timeline]");
    if (!eventDays) {
      box.innerHTML = `<p class="mp-muted">이벤트 기간이 끝났어요.</p>`;
      return;
    }
    const rows = [];
    for (let day = 0; day < eventDays; day += 1) {
      const date = addDays(today, day);
      const runs = event.runs.filter((run) => run.day === day);
      const tickets = day === 0 ? ticketsToday() : MONSTER_PARK.perDay;
      const lost = runs.reduce((sum, run) => sum + run.lostAfter, 0);
      const pills = runs.map((run) => `<span class="mp-run${run.after.level > run.before.level ? " is-up" : ""}${run.wasted > 0n || run.lostAfter ? " is-warn" : ""}">
          <small>${run.slot + 1}판</small>${escapeHtml(levelText(run.after))}${run.after.level > run.before.level ? `<em>UP</em>` : ""}
        </span>`);
      for (let index = 0; index < lost; index += 1) pills.push(`<span class="mp-run is-lost"><small>${runs.length + index + 1}판</small>못 씀</span>`);
      if (!tickets) pills.push(`<span class="mp-run is-done">오늘은 다 했어요</span>`);
      else if (tickets > runs.length + lost) pills.push(`<span class="mp-run is-idle">${{ max: "130 달성", unknown: "구역 경험치 모름", low: "50레벨부터 입장" }[event.stop] ?? "계산 멈춤"}</span>`);
      rows.push(`<li class="mp-day${day === 0 ? " is-today" : ""}"><span class="mp-day-date">${shortDate(date, today)}</span><span class="mp-day-runs">${pills.join("")}</span></li>`);
    }
    box.innerHTML = `<h2>날짜별 진행</h2><ol class="mp-days">${rows.join("")}</ol>`;
  }

  function paint() {
    paintInputs();
    const start = { level, exp, curve, zoneExp, todayLeft: ticketsToday() };
    const event = simulate({ ...start, days: eventDays });
    const goal = simulate({ ...start, days: 400 });
    paintResults(event, goal);
    paintWarnings(event);
    paintTimeline(event);
  }

  root.addEventListener("click", (event) => {
    const character = event.target.closest("[data-character]");
    if (character) {
      sfx("tick");
      pickCharacter(character.dataset.character);
      return;
    }
    const step = event.target.closest("[data-level-step]");
    if (step) {
      sfx("tick");
      setLevel(level + Number(step.dataset.levelStep));
      paint();
      return;
    }
    const chip = event.target.closest("[data-percent-chip]");
    if (chip) {
      sfx("tick");
      percentInput = chip.dataset.percentChip;
      setLevel(level);
      paint();
      return;
    }
    const zoneOpen = event.target.closest("[data-zone-open]");
    if (zoneOpen) {
      const details = root.querySelector(".mp-zones");
      details.open = true;
      const input = details.querySelector(`[data-zone-exp="${zoneOpen.dataset.zoneOpen}"]`);
      input.scrollIntoView({ block: "center", behavior: "smooth" });
      input.focus({ preventScroll: true });
      return;
    }
    const ticket = event.target.closest("[data-ticket]");
    if (ticket) {
      sfx("tick");
      saveTickets(Number(ticket.dataset.ticket));
      paint();
    }
  });

  root.addEventListener("input", (event) => {
    if (event.target === levelInput) {
      const value = Number(levelInput.value.replace(/[^\d]/g, ""));
      if (value) {
        setLevel(value);
        paint();
      }
      return;
    }
    if (event.target === percentField) {
      percentInput = percentField.value.replace(/[^\d.]/g, "") || "0";
      setLevel(level);
      paint();
      return;
    }
    const zoneInput = event.target.closest("[data-zone-exp]");
    if (zoneInput) {
      const digits = zoneInput.value.replace(/[^\d]/g, "");
      zoneExp[zoneInput.dataset.zoneExp] = digits ? BigInt(digits) : (ZONES.find((zone) => zone.id === zoneInput.dataset.zoneExp)?.exp ?? null);
      saveZones();
      paint();
    }
  });

  root.addEventListener("change", (event) => {
    if (event.target === levelInput || event.target === percentField) paintInputs();
    const zoneInput = event.target.closest("[data-zone-exp]");
    if (zoneInput) {
      const value = zoneExp[zoneInput.dataset.zoneExp];
      zoneInput.value = value != null ? formatCount(value) : "";
    }
  });

  setLevel(level);
  paintPick();
  paint();

  if (!isLoggedIn()) return;
  const supabase = await getSupabase();
  const [characterResult, jobResult] = await Promise.all([
    supabase.from("characters").select("id, name, job, level, exp, face_path"),
    supabase.from("jobs").select("id, family, name, color, color_dark, sort_order").order("sort_order"),
    loadMainCharacter(),
  ]);
  if (!root.isConnected) return;
  // 얼굴·경험치 칸이 없는 예전 DB면 캐릭터 고르기만 빼고 직접 입력으로 쓴다.
  if (characterResult.error) return;
  characters = characterResult.data ?? [];
  jobs = jobResult.error ? [] : (jobResult.data ?? []);
  await attachFaceUrls(supabase, characters);
  if (!root.isConnected) return;
  const mainId = mainCharacterId();
  // 들어갈 수 있는 캐릭터(50~129) 먼저, 그 안에서는 대표 → 레벨 높은 순.
  const usable = (item) => item.level >= MONSTER_PARK.minLevel && item.level < MONSTER_PARK.maxLevel;
  characters.sort((left, right) => Number(usable(right)) - Number(usable(left)) || Number(right.id === mainId) - Number(left.id === mainId) || (right.level ?? 0) - (left.level ?? 0));
  const first = characters.find((item) => usable(item));
  if (first) pickCharacter(first.id);
  else paintPick();
}
