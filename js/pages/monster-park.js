import { sfx, burstAt } from "../effects.js";
import { attachFaceUrls, faceMarkup } from "../character-face.js";
import { escapeHtml, formatCount } from "../format.js";
import { homeworkState } from "../homework-calc.js";
import { asBig } from "../hunt-calc.js";
import { CYGNUS_MAX_LEVEL, findJob, isCygnusJob, jobStyle, maxLevelOf } from "../job-label.js";
import { levelExpSeed } from "../level-exp-seed.js";
import { MONSTER_PARK, PARK_STORE_KEY, ZONES, addDays, daysLeft, expFromPercent, gainRun, percentOf, seoulDate, simulate, zoneLabel, zoneOf } from "../monster-park-calc.js";
import { translateDbError } from "../db-error.js";
import { loadMainCharacter, mainCharacterId, paintProfileButton } from "../profile.js";
import { isLoggedIn } from "../session.js";
import { getSupabase } from "../supabase-client.js";
import { notify } from "../toast.js";

// 몬스터파크 계산(이벤트 기간 전용 화면, 2026-10-27). 계산 규칙은 js/monster-park-calc.js.
// 캐릭터 카드를 누르면 레벨·경험치가 채워지고, 오늘 남은 입장과 함께 곧바로 다시 계산한다.
// 몬파 레벨(50~129)이 아닌 캐릭터는 접어 둔다. "한 판 끝" 은 한 판 경험치를 더하고 오늘 입장을 줄이며,
// 고른 캐릭터면 레벨·경험치를 캐릭터에 바로 저장한다(2026-10-28 사용자 요청). 손으로 고친 값은 저장 버튼으로.
// 고른 캐릭터의 "오늘 남은 입장"은 숙제표 몬스터파크 1회·2회 체크(homework_checks)와 같은 값이다. 표가 없으면 이 기기에만 기억.
// 이 기기에만 기억: 구역 경험치(모르는 구역을 사용자가 적은 값), 오늘 남은 입장(날짜가 바뀌면 2회로).

const STORE_KEY = PARK_STORE_KEY;
const PARK_KEYS = ["monster-park", "monster-park-2"]; // 숙제표 1회·2회 칸(homework-calc.js RAIDS)
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

// 몬파 계산의 끝 레벨: 만렙(시그너스 120)과 몬파 마지막 구역 다음(130) 중 낮은 쪽. 배틀메이지(만렙 200)도 130에서 끝.
const parkMaxLevel = (job) => Math.min(maxLevelOf(job), MONSTER_PARK.maxLevel);
// 몬파에 들어갈 수 있는 캐릭터: 50레벨 이상, 끝 레벨 전
const usable = (character) => character.level >= MONSTER_PARK.minLevel && character.level < parkMaxLevel(character.job);

function levelText(state, top = MONSTER_PARK.maxLevel) {
  if (state.level >= top) return `Lv.${state.level}`;
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
  let saving = false;
  let outOpen = false; // 몬파 못 가는 캐릭터 펼침
  let manualCygnus = false; // 직접 입력할 때 시그너스(만렙 120)인지
  let homeworkReady = false; // homework_checks 를 읽었으면 고른 캐릭터의 입장 횟수를 숙제와 맞춘다
  const parkChecks = new Map(); // "캐릭터id:task_key" → checked_at
  const eventDays = daysLeft(today);

  root.innerHTML = `
    <div class="mp-page">
      <header class="ym-page-head">
        <h1>몬스터파크 계산</h1>
        <p>몬스터파크 경험치만으로 만렙(130, 시그너스 120)까지 며칠 걸리는지, 이벤트가 끝나는 날 몇 레벨이 되는지 알려 드려요.</p>
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
          <button type="button" class="ym-chip mp-cygnus-toggle" data-cygnus hidden aria-pressed="false">시그너스 · 만렙 ${CYGNUS_MAX_LEVEL}</button>
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
          <span class="mp-label">오늘 남은 입장 <small class="mp-hw-link" data-hw-link hidden>숙제표와 같이 바뀌어요</small></span>
          <span class="mp-tickets" role="group" aria-label="오늘 남은 입장">
            ${[0, 1, 2].map((count) => `<button type="button" class="mp-ticket" data-ticket="${count}">${count}회</button>`).join("")}
          </span>
        </div>
        <div class="mp-apply" data-apply></div>
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

  function syncsHomework() {
    return homeworkReady && Boolean(picked);
  }

  function doneToday(key) {
    return homeworkState("daily", parkChecks.get(`${picked}:${key}`) ?? null, Date.now()).done;
  }

  function ticketsToday() {
    if (syncsHomework()) return MONSTER_PARK.perDay - PARK_KEYS.filter(doneToday).length;
    const saved = todayLeft[picked || "manual"];
    return Number.isInteger(saved) ? Math.min(MONSTER_PARK.perDay, Math.max(0, saved)) : MONSTER_PARK.perDay;
  }

  function saveTickets(count) {
    if (syncsHomework()) {
      saveHomework(count);
      return;
    }
    todayLeft[picked || "manual"] = count;
    writeStore({ ...readStore(), today: { date: today, left: todayLeft } });
  }

  // 남은 입장 count 에 맞춰 숙제표 1회·2회 칸을 채우거나 비운다. 이미 오늘 체크한 칸은 시각을 그대로 둔다.
  async function saveHomework(count) {
    const characterId = picked;
    const used = MONSTER_PARK.perDay - count;
    const stamp = new Date().toISOString();
    const writes = PARK_KEYS.map((key, index) => {
      const mapKey = `${characterId}:${key}`;
      const want = index < used;
      if (want === doneToday(key)) return null;
      const previous = parkChecks.get(mapKey) ?? null;
      if (want) parkChecks.set(mapKey, stamp);
      else parkChecks.delete(mapKey);
      return { key, want, mapKey, previous };
    }).filter(Boolean);
    if (!writes.length) return;
    const supabase = await getSupabase();
    const results = await Promise.all([
      // 숙제표에 이 캐릭터가 안 보이면 몬스터파크 표에 넣는다.
      used > 0 ? supabase.from("homework_members").upsert({ character_id: characterId, task_key: "monster-park" }, { onConflict: "character_id,task_key" }) : { error: null },
      ...writes.map((write) => (write.want
        ? supabase.from("homework_checks").upsert({ character_id: characterId, task_key: write.key, checked_at: stamp }, { onConflict: "character_id,task_key" })
        : supabase.from("homework_checks").delete().eq("character_id", characterId).eq("task_key", write.key))),
    ]);
    if (!root.isConnected) return;
    const failed = results.slice(1).find((result) => result.error);
    if (failed) {
      for (const write of writes) {
        if (write.previous) parkChecks.set(write.mapKey, write.previous);
        else parkChecks.delete(write.mapKey);
      }
      sfx("fail");
      notify(`숙제표에 반영하지 못했어요. ${translateDbError(failed.error)}`, "error");
      paint();
    }
  }

  function saveZones() {
    const saved = {};
    for (const zone of ZONES) if (zoneExp[zone.id] != null && zoneExp[zone.id] !== zone.exp) saved[zone.id] = zoneExp[zone.id].toString();
    writeStore({ ...readStore(), zoneExp: saved });
  }

  // 지금 계산하는 캐릭터의 만렙
  function cap() {
    const character = picked ? characters.find((item) => item.id === picked) : null;
    if (character) return parkMaxLevel(character.job);
    return manualCygnus ? CYGNUS_MAX_LEVEL : MONSTER_PARK.maxLevel;
  }

  // 직업 만렙(배틀메이지 200처럼 cap 보다 클 수 있다)
  function realMaxLevel() {
    const character = picked ? characters.find((item) => item.id === picked) : null;
    if (character) return maxLevelOf(character.job);
    return cap();
  }

  function clampLevel(value) {
    return Math.min(realMaxLevel(), Math.max(1, Math.round(value) || 1));
  }

  function setLevel(value, { keepPercent = true } = {}) {
    level = clampLevel(value);
    if (keepPercent) exp = level >= realMaxLevel() ? 0n : expFromPercent(percentInput, curve.get(level));
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
      const out = !usable(character);
      const cygnus = isCygnusJob(character.job);
      return `<button type="button" class="mp-char${on ? " is-on" : ""}${out ? " is-out" : ""}" data-character="${escapeHtml(character.id)}" aria-pressed="${on}" style="${jobStyle(findJob(jobs, character.job))}">
        <span class="mp-char-face">${faceMarkup(character.face_url) || `<b>${escapeHtml((character.name || "?").slice(0, 1))}</b>`}</span>
        <span class="mp-char-name">${escapeHtml(character.name)}</span>
        <span class="mp-char-lv">${character.level ? `Lv.${character.level}` : "레벨 없음"}${percent ? ` <small>${percent}</small>` : ""}${cygnus ? ` <i class="mp-cygnus" title="시그너스 기사단 · 만렙 ${CYGNUS_MAX_LEVEL}">${CYGNUS_MAX_LEVEL}</i>` : ""}</span>
      </button>`;
    };
    const manualOn = picked === "";
    // 몬파 못 가는 캐릭터는 접어 둔다(고른 캐릭터는 늘 보이게).
    const shown = characters.filter((item) => usable(item) || item.id === picked);
    const hidden = characters.filter((item) => !usable(item) && item.id !== picked);
    const more = hidden.length
      ? `<details class="mp-char-more" data-char-more${outOpen ? " open" : ""}><summary><span>몬파 레벨이 아닌 캐릭터 <b>${hidden.length}</b>명</span></summary><div class="mp-char-grid">${hidden.map(card).join("")}</div></details>`
      : "";
    box.innerHTML = `<div class="mp-char-grid">${shown.map(card).join("")}<button type="button" class="mp-char is-manual${manualOn ? " is-on" : ""}" data-character="" aria-pressed="${manualOn}"><span class="mp-char-face"><b>✎</b></span><span class="mp-char-name">직접 입력</span><span class="mp-char-lv">레벨을 골라요</span></button></div>${more}`;
  }

  // 고른 캐릭터의 저장된 레벨·경험치와 지금 값이 다른가
  function pickedCharacter() {
    return picked ? characters.find((item) => item.id === picked) ?? null : null;
  }

  function isDirty(character) {
    if (!character) return false;
    return character.level !== level || asBig(character.exp ?? 0) !== exp;
  }

  // 저장 문구는 입력칸에 보이는 % 그대로(경험치를 %에서 거꾸로 구하면 0.01% 내림이 생겨서)
  function savedText() {
    return level >= realMaxLevel() ? `Lv.${level}` : `Lv.${level} · ${percentInput}%`;
  }

  function paintApply() {
    const box = root.querySelector("[data-apply]");
    const zone = level < cap() ? zoneOf(level) : null;
    const gain = zone ? zoneExp[zone.id] : null;
    const left = ticketsToday();
    const canRun = Boolean(zone) && gain != null && left > 0;
    const runNote = !zone ? (level < MONSTER_PARK.minLevel ? "50레벨부터" : cap() < realMaxLevel() ? "몬파 졸업" : `${cap()} 달성`) : gain == null ? "구역 경험치 모름" : left <= 0 ? "오늘 입장 끝" : `+${formatCount(gain)}`;
    const character = pickedCharacter();
    const dirty = isDirty(character);
    const saveHtml = !character
      ? `<span class="mp-apply-note">${isLoggedIn() ? "캐릭터를 고르면 레벨을 바로 저장할 수 있어요" : ""}</span>`
      : dirty
        ? `<button type="button" class="mp-save" data-save ${saving ? "disabled" : ""}>${saving ? "저장 중…" : `${escapeHtml(character.name)}에 ${escapeHtml(savedText())} 저장`}</button>`
        : `<span class="mp-apply-note is-saved">✓ ${escapeHtml(character.name)} 저장된 값과 같아요</span>`;
    box.innerHTML = `
      <button type="button" class="mp-run-done" data-run-done ${canRun && !saving ? "" : "disabled"}>
        <span>한 판 끝!</span><small>${escapeHtml(runNote)}</small>
      </button>
      ${saveHtml}`;
  }

  async function saveCharacter({ silent = false } = {}) {
    const character = pickedCharacter();
    if (!character || saving || !isDirty(character)) return;
    saving = true;
    paintApply();
    const values = { level, exp: exp.toString() };
    const supabase = await getSupabase();
    const { error } = await supabase.from("characters").update(values).eq("id", character.id);
    saving = false;
    if (!root.isConnected) return;
    if (error) {
      sfx("fail");
      notify(translateDbError(error), "error");
      paintApply();
      return;
    }
    character.level = values.level;
    character.exp = values.exp;
    if (!silent) sfx("tick");
    notify(`${character.name} ${savedText()} 저장했습니다.`, "success");
    loadMainCharacter(true).then(paintProfileButton);
    paintPick();
    paintApply();
  }

  // 한 판 경험치를 더하고 오늘 입장을 하나 줄인다. 구역이 바뀌면 오늘 남은 입장은 못 쓰니 0.
  function finishRun() {
    const zone = level < cap() ? zoneOf(level) : null;
    const gain = zone ? zoneExp[zone.id] : null;
    const left = ticketsToday();
    if (!zone || gain == null || left <= 0) return;
    const top = cap();
    // 실제 경험치는 직업 만렙 기준(배틀메이지는 130이 돼도 넘친 경험치가 남는다)
    const after = gainRun(level, exp, gain, curve, realMaxLevel());
    const changed = after.level < top && zoneOf(after.level)?.id !== zone.id;
    level = after.level;
    exp = after.exp;
    percentInput = level >= realMaxLevel() ? "0" : percentOf(exp, curve.get(level));
    saveTickets(changed || after.level >= top ? 0 : left - 1);
    if (after.leveled) {
      sfx(level >= top ? "fanfare" : "check");
      burstAt(levelInput, ["#ffe28a", "#9ff0c4", "#ffffff"], 18, 1);
    } else sfx("tick");
    if (after.wasted > 0n) notify(`1레벨 제한으로 경험치 ${formatCount(after.wasted)}이 버려졌어요`, "info");
    paint();
    saveCharacter({ silent: true });
  }

  function pickCharacter(id) {
    picked = id;
    const character = characters.find((item) => item.id === id);
    if (character?.level) {
      level = clampLevel(character.level);
      exp = character.exp != null && level < realMaxLevel() ? asBig(character.exp) : 0n;
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
    const cygnusToggle = root.querySelector("[data-cygnus]");
    cygnusToggle.hidden = picked !== "";
    cygnusToggle.setAttribute("aria-pressed", String(manualCygnus));
    const zone = level < cap() ? zoneOf(level) : null;
    const zoneBox = root.querySelector("[data-zone]");
    zoneBox.textContent = zone ? `${zoneLabel(zone)} 구역 · 한 판 ${zoneExp[zone.id] != null ? formatCount(zoneExp[zone.id]) : "경험치 모름"}` : level < MONSTER_PARK.minLevel ? "50레벨부터 들어갈 수 있어요" : cap() < realMaxLevel() ? `${cap()}레벨부터는 못 들어가요` : `이미 ${cap()}이에요`;
    zoneBox.classList.toggle("is-unknown", Boolean(zone) && zoneExp[zone.id] == null);
    const need = curve.get(level);
    root.querySelector("[data-exp-exact]").textContent = need && level < realMaxLevel() ? `${formatCount(exp)} / ${formatCount(need)}` : "";
    for (const chip of root.querySelectorAll("[data-percent-chip]")) chip.setAttribute("aria-pressed", String(chip.dataset.percentChip === percentInput));
    root.querySelector("[data-hw-link]").hidden = !syncsHomework();
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
    const top = cap();
    if (level >= top) {
      // 만렙이 130보다 높은 직업(배틀메이지 200)은 만렙이 아니라 몬파 구역이 끝난 것
      const graduated = top < realMaxLevel();
      box.innerHTML = `<article class="mp-result is-reach ym-glass"><span class="mp-result-label">${graduated ? "몬파 졸업" : "이미 만렙"}</span><strong>Lv.${level}</strong><p>${graduated ? `${top}레벨부터는 몬스터파크에 들어갈 수 없어요.` : "축하해요! 몬스터파크는 이제 쉬어도 돼요."}</p></article>`;
      return;
    }
    const finalNeed = curve.get(event.final.level);
    const finalRatio = event.final.level >= top || !finalNeed ? 100 : Number((event.final.exp * 10000n) / finalNeed) / 100;
    const gainedLevels = event.final.level - startLevel;
    const reach = event.stop === "max";
    let goalHtml;
    if (goal.stop === "max") {
      const last = goal.runs.at(-1);
      const date = addDays(today, last.day);
      goalHtml = `<strong>${goal.runs.length}판 · ${last.day + 1}일</strong><p>${shortDate(date, today)}에 ${top}${reach ? "" : ` — 이벤트 마감보다 ${last.day + 1 - eventDays}일 더 걸려요`}</p>`;
    } else {
      goalHtml = `<strong>계산 대기</strong><p>${escapeHtml(stopNote(goal))}${goal.runs.length ? ` · 그때까지 ${goal.runs.length}판, ${levelText(goal.final, top)}` : ""}</p>${goal.stop === "unknown" ? `<button type="button" class="ym-chip mp-zone-open" data-zone-open="${goal.stopZone.id}">Lv.${zoneLabel(goal.stopZone)} 경험치 적기</button>` : ""}`;
    }
    box.innerHTML = `
      <article class="mp-result ${reach ? "is-reach" : ""} ym-glass">
        <span class="mp-result-label">${endLabel} 마감 때</span>
        <strong data-final-level>${reach ? `Lv.${top} 달성!` : levelText(event.final, top)}</strong>
        <div class="ym-gauge"><i style="--value:${reach ? 100 : finalRatio}%"></i></div>
        <p>${event.runs.length}판 · ${gainedLevels > 0 ? `+${gainedLevels}레벨` : "레벨 그대로"}${event.stop === "unknown" || event.stop === "low" ? ` · ${escapeHtml(stopNote(event))}` : ""}</p>
      </article>
      <article class="mp-result ym-glass">
        <span class="mp-result-label">${top}까지</span>
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
          <small>${run.slot + 1}판</small>${escapeHtml(levelText(run.after, cap()))}${run.after.level > run.before.level ? `<em>UP</em>` : ""}
        </span>`);
      for (let index = 0; index < lost; index += 1) pills.push(`<span class="mp-run is-lost"><small>${runs.length + index + 1}판</small>못 씀</span>`);
      if (!tickets) pills.push(`<span class="mp-run is-done">오늘은 다 했어요</span>`);
      else if (tickets > runs.length + lost) pills.push(`<span class="mp-run is-idle">${{ max: cap() < realMaxLevel() ? "몬파 졸업" : `${cap()} 달성`, unknown: "구역 경험치 모름", low: "50레벨부터 입장" }[event.stop] ?? "계산 멈춤"}</span>`);
      rows.push(`<li class="mp-day${day === 0 ? " is-today" : ""}"><span class="mp-day-date">${shortDate(date, today)}</span><span class="mp-day-runs">${pills.join("")}</span></li>`);
    }
    box.innerHTML = `<h2>날짜별 진행</h2><ol class="mp-days">${rows.join("")}</ol>`;
  }

  function paint() {
    paintInputs();
    paintApply();
    const start = { level, exp, curve, zoneExp, todayLeft: ticketsToday(), maxLevel: cap() };
    const event = simulate({ ...start, days: eventDays });
    const goal = simulate({ ...start, days: 400 });
    paintResults(event, goal);
    paintWarnings(event);
    paintTimeline(event);
  }

  root.addEventListener("click", (event) => {
    if (event.target.closest("[data-run-done]")) {
      finishRun();
      return;
    }
    if (event.target.closest("[data-cygnus]")) {
      sfx("tick");
      manualCygnus = !manualCygnus;
      setLevel(level);
      paint();
      return;
    }
    if (event.target.closest("[data-save]")) {
      saveCharacter();
      return;
    }
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

  root.addEventListener("toggle", (event) => {
    if (event.target.matches?.("[data-char-more]")) outOpen = event.target.open;
  }, true);

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
  const [characterResult, jobResult, checkResult] = await Promise.all([
    supabase.from("characters").select("id, name, job, level, exp, face_path"),
    supabase.from("jobs").select("id, family, name, color, color_dark, sort_order").order("sort_order"),
    supabase.from("homework_checks").select("character_id, task_key, checked_at").in("task_key", PARK_KEYS),
    loadMainCharacter(),
  ]);
  if (!root.isConnected) return;
  // 얼굴·경험치 칸이 없는 예전 DB면 캐릭터 고르기만 빼고 직접 입력으로 쓴다.
  if (characterResult.error) return;
  characters = characterResult.data ?? [];
  jobs = jobResult.error ? [] : (jobResult.data ?? []);
  // 숙제 표(sql/030)가 없으면 예전처럼 이 기기에만 입장 횟수를 기억한다.
  homeworkReady = !checkResult.error;
  for (const row of checkResult.data ?? []) parkChecks.set(`${row.character_id}:${row.task_key}`, row.checked_at);
  await attachFaceUrls(supabase, characters);
  if (!root.isConnected) return;
  const mainId = mainCharacterId();
  // 들어갈 수 있는 캐릭터(50~129) 먼저, 그 안에서는 대표 → 레벨 높은 순.
  characters.sort((left, right) => Number(usable(right)) - Number(usable(left)) || Number(right.id === mainId) - Number(left.id === mainId) || (right.level ?? 0) - (left.level ?? 0));
  const first = characters.find((item) => usable(item));
  if (first) pickCharacter(first.id);
  else paintPick();
}
