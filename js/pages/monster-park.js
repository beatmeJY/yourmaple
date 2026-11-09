import { canReviewCatalog } from "../catalog-review.js";
import { sfx, burstAt } from "../effects.js";
import { attachFaceUrls, faceMarkup } from "../character-face.js";
import { escapeHtml, formatCount, readBig } from "../format.js";
import { homeworkState } from "../homework-calc.js";
import { asBig } from "../hunt-calc.js";
import { CYGNUS_MAX_LEVEL, findJob, isCygnusJob, jobStyle, maxLevelOf } from "../job-label.js";
import { levelExpSeed } from "../level-exp-seed.js";
import { MONSTER_PARK, PARK_STORE_KEY, ZONES, addDays, daysLeft, gainRun, percentOf, seoulDate, simulate, zoneLabel, zoneOf } from "../monster-park-calc.js";
import { loadParkSettings, saveParkSettings, zoneExpValues } from "../monster-park-settings.js";
import { translateDbError } from "../db-error.js";
import { loadMainCharacter, mainCharacterId, paintProfileButton } from "../profile.js";
import { isLoggedIn } from "../session.js";
import { getSupabase } from "../supabase-client.js";
import { notify } from "../toast.js";

// 몬스터파크 계산(이벤트 기간 전용 화면, 2026-10-27). 계산 규칙은 js/monster-park-calc.js.
// 캐릭터 카드를 누르면 레벨·경험치가 채워지고, 오늘 남은 입장과 함께 곧바로 다시 계산한다.
// 몬파 레벨(50~129)이 아닌 캐릭터는 접어 둔다. "오늘 몬파 끝" 은 오늘 남은 입장을 한 번에 돌아 경험치를 더하고 입장을 0으로 만들며
// (2026-11-09 사용자 요청, 예전 "한 판 끝" 대체),
// 고른 캐릭터면 레벨·경험치를 캐릭터에 바로 저장한다(2026-10-28 사용자 요청). 손으로 고친 값은 저장 버튼으로.
// 고른 캐릭터의 "오늘 남은 입장"은 숙제표 몬스터파크 1회·2회 체크(homework_checks)와 같은 값이다. 표가 없으면 이 기기에만 기억.
// 이 기기에만 기억: 직접 입력 시 오늘 남은 입장(날짜가 바뀌면 2회로).
// 2026-11-09 v2 디자인(design/design_handoff_monster_park_v2, 사용자 요청): 주황·갈색 테마, 입장권 2장, 레벨 구역 문 막대,
// 캐릭터 레이스(성장 그래프 대체), 이벤트 달력(날짜별 표 대체). 계산·저장·숙제표 연동은 그대로.

const STORE_KEY = PARK_STORE_KEY;
const PARK_KEYS = ["monster-park", "monster-park-2"]; // 숙제표 1회·2회 칸(homework-calc.js RAIDS)
const curve = new Map(levelExpSeed.map(([level, exp]) => [level, asBig(exp)]));
// 구역 문 이름(디자인: 50~70 얼룩말, 71~100 표범, 101~129 호랑이)
const GATE_NAME = { low: "얼룩말 문", mid: "표범 문", high: "호랑이 문" };
const SPAN = MONSTER_PARK.maxLevel - MONSTER_PARK.minLevel; // 50 → 130, 80칸
// 달력에서 레벨이 오르는 날 붙이는 그림(사용자 제공 LEVEL UP 그림, 2026-11-09)
const LEVEL_UP_ICON = `<img class="mp-day-up" src="img/level-up.png" alt="" width="188" height="240" loading="lazy" />`;

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

// "2026-11-24" → "11/24"
function tinyDate(date) {
  const [, month, day] = date.split("-").map(Number);
  return `${month}/${day}`;
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

// 레벨 + 그 레벨 진행률(0~1)을 한 숫자로. 끝 레벨 이상이면 끝 레벨.
function levelValue(state, top) {
  if (state.level >= top) return top;
  const need = curve.get(state.level);
  return state.level + (need ? Number((state.exp * 10000n) / need) / 10000 : 0);
}

// 50~130 막대 위 위치(%)
const trackX = (value) => Math.max(0, Math.min(100, ((value - MONSTER_PARK.minLevel) / SPAN) * 100));

export async function render(root) {
  const today = seoulDate();
  const store = readStore();
  const [settings, operator] = await Promise.all([
    loadParkSettings(),
    isLoggedIn() && canReviewCatalog(),
  ]);
  if (!root.isConnected) return;
  let zoneExp = settings.zoneExp ?? {};
  const canEditZones = settings.editable && operator;
  const todayLeft = store.today?.date === today ? store.today.left ?? {} : {};
  let characters = [];
  let jobs = [];
  let picked = ""; // 캐릭터 id, "" = 직접 입력
  let level = 71;
  let exp = 0n;
  let expError = "";
  let lastReach = false;
  let saving = false;
  let outOpen = false; // 몬파 못 가는 캐릭터 펼침
  let manualCygnus = false; // 직접 입력할 때 시그너스(만렙 120)인지
  let homeworkReady = false; // homework_checks 를 읽었으면 고른 캐릭터의 입장 횟수를 숙제와 맞춘다
  let calPick = 0; // 달력에서 자세히 보는 날(0 = 오늘)
  let calDetails = [];
  let fxTimer = 0;
  const parkChecks = new Map(); // "캐릭터id:task_key" → checked_at
  const eventDays = daysLeft(today);
  const dday = eventDays ? (eventDays === 1 ? "오늘 마감" : `D-${eventDays - 1}`) : "종료";

  root.innerHTML = `
    <div class="mp-page">
      <header class="mp-head">
        <div class="mp-head-copy">
          <span class="mp-kicker">MONSTER PARK EVENT</span>
          <h1>몬스터파크 계산</h1>
          <p>몬스터파크 경험치만으로 만렙(130, 시그너스 120)까지 며칠 걸리는지, 이벤트가 끝나는 날 몇 레벨이 되는지 알려 드려요.</p>
        </div>
        <section class="mp-event" aria-label="이벤트 기간">
          <span class="mp-event-thatch" aria-hidden="true"></span>
          <span class="mp-event-shade" aria-hidden="true"></span>
          <span class="mp-event-shine" aria-hidden="true"></span>
          <img class="mp-event-art" src="img/monster-park.png" alt="" width="88" height="88" />
          <div class="mp-event-copy">
            <div class="mp-event-top"><span class="mp-event-badge">이벤트</span><span>${eventDays ? `${endLabel}까지` : "이벤트가 끝났어요"}</span></div>
            <div class="mp-event-mid"><strong>${escapeHtml(dday)}</strong><span data-event-left></span></div>
            <span class="mp-event-sub">하루 ${MONSTER_PARK.perDay}회 · 한 판에 1레벨까지만 올라요</span>
          </div>
        </section>
      </header>

      <section class="mp-pick" data-pick aria-label="캐릭터 고르기"></section>

      <div class="mp-board">
        <section class="mp-card mp-now" aria-labelledby="mp-now-title">
          <div class="mp-now-head">
            <h2 id="mp-now-title">지금 상태</h2>
            <span class="mp-who" data-who></span>
            <button type="button" class="mp-cygnus-toggle" data-cygnus hidden aria-pressed="false">시그너스 · 만렙 ${CYGNUS_MAX_LEVEL}</button>
          </div>
          <div class="mp-stepper">
            <button type="button" class="is-ten" data-level-step="-10" aria-label="10레벨 내리기">−10</button>
            <button type="button" data-level-step="-1" aria-label="1레벨 내리기">−</button>
            <label class="mp-lv"><span>Lv.</span><input data-level inputmode="numeric" autocomplete="off" aria-label="현재 레벨" /><span class="mp-fx" data-fx aria-hidden="true"></span></label>
            <button type="button" data-level-step="1" aria-label="1레벨 올리기">+</button>
            <button type="button" class="is-ten" data-level-step="10" aria-label="10레벨 올리기">+10</button>
          </div>
          <div class="mp-block">
            <div class="mp-row-head"><span>레벨 구역</span><span class="mp-zone-note" data-zone></span></div>
            <div class="mp-gates" data-gates></div>
          </div>
          <div class="mp-block">
            <div class="mp-row-head"><label for="mp-current-exp">현재 경험치</label><span class="mp-exp-ratio" data-exp-ratio></span></div>
            <div class="mp-exp-bar" aria-hidden="true"><i data-exp-bar></i></div>
            <span class="mp-exp-input">
              <input id="mp-current-exp" data-current-exp inputmode="numeric" autocomplete="off" aria-describedby="mp-exp-hint" />
              <span>EXP</span>
            </span>
            <span class="mp-exp-exact" id="mp-exp-hint" data-exp-exact aria-live="polite"></span>
          </div>
          <div class="mp-block">
            <div class="mp-row-head"><span>오늘 남은 입장 <small class="mp-hw-link" data-hw-link hidden>숙제표와 같이 바뀌어요</small></span><b class="mp-left-text" data-left-text></b></div>
            <div class="mp-tickets" role="group" aria-label="오늘 남은 입장" data-tickets></div>
          </div>
          <div class="mp-apply" data-apply></div>
        </section>
        <div class="mp-side">
          <div class="mp-results" data-results></div>
          <div class="mp-warnings" data-warnings></div>
        </div>
      </div>

      <section class="mp-card mp-race" data-race aria-labelledby="mp-race-title"></section>
      <section class="mp-card mp-cal" data-calendar aria-labelledby="mp-cal-title"></section>

      <details class="mp-zones" data-zones>
        <summary><b>구역별 한 판 경험치</b><span>${settings.error ? "기준 경험치를 불러오지 못했어요. 새로고침한 뒤 다시 확인해 주세요." : "모든 사용자에게 적용되는 구역별 기준이에요."}</span></summary>
        <form data-zone-form>
          <div class="mp-zone-grid">
            ${ZONES.map((zone) => `
              <label class="mp-zone-field" data-zone-field="${zone.id}">
                <span>Lv.${zoneLabel(zone)} <small>${GATE_NAME[zone.id]}</small></span>
                <input name="${zone.id}" inputmode="numeric" placeholder="모름" value="${escapeHtml(formatCount(zoneExp[zone.id]))}" ${canEditZones ? "" : "readonly"} />
              </label>`).join("")}
          </div>
          ${canEditZones ? '<button type="submit" class="mp-save">구역 경험치 저장</button>' : ""}
        </form>
      </details>
    </div>`;

  const levelInput = root.querySelector("[data-level]");
  const expField = root.querySelector("[data-current-exp]");

  function syncsHomework() {
    return homeworkReady && Boolean(picked);
  }

  function doneToday(key, characterId = picked) {
    return homeworkState("daily", parkChecks.get(`${characterId}:${key}`) ?? null, Date.now()).done;
  }

  function ticketsToday(characterId = picked) {
    if (homeworkReady && characterId) {
      return MONSTER_PARK.perDay - PARK_KEYS.filter((key) => doneToday(key, characterId)).length;
    }
    const saved = todayLeft[characterId || "manual"];
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

  const zoneForm = root.querySelector("[data-zone-form]");
  zoneForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!canEditZones) return;
    const button = zoneForm.querySelector("button");
    if (button.disabled) return;
    const values = {};
    for (const { id } of ZONES) {
      const field = zoneForm.elements.namedItem(id);
      const { value, error } = readBig(field.value, "한 판 경험치", 1n);
      if (error || value == null || value > BigInt(Number.MAX_SAFE_INTEGER)) {
        notify(error || "한 판 경험치를 올바른 양의 정수로 입력해 주세요.", "error");
        field.focus();
        return;
      }
      values[id] = Number(value);
    }
    for (const field of zoneForm.elements) field.disabled = true;
    try {
      const { data, error } = await saveParkSettings(values);
      if (error) throw error;
      if (!root.isConnected) return;
      zoneExp = zoneExpValues(data);
      for (const { id } of ZONES) zoneForm.elements.namedItem(id).value = formatCount(zoneExp[id]);
      paint();
      notify("구역별 한 판 경험치를 저장했습니다.", "success");
    } catch (error) {
      if (root.isConnected) notify(translateDbError(error), "error");
    } finally {
      for (const field of zoneForm.elements) field.disabled = false;
    }
  });

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

  function setExperience(raw) {
    const parsed = readBig(raw, "현재 경험치");
    const amount = parsed.value ?? 0n;
    const need = curve.get(level);
    expError = parsed.error ?? "";
    if (!expError && need && amount >= need) {
      expError = `현재 경험치는 ${formatCount(need - 1n)} 이하로 입력해 주세요.`;
    }
    if (!expError) exp = amount;
  }

  function setLevel(value) {
    level = clampLevel(value);
    if (level >= realMaxLevel()) {
      exp = 0n;
      expError = "";
    } else {
      setExperience(expField.value);
    }
  }

  // 얼굴(없으면 이름 첫 글자, 직업 색 바탕)
  function faceHtml(character, className) {
    const face = faceMarkup(character.face_url);
    return `<span class="${className}">${face || `<b>${escapeHtml((character.name || "?").slice(0, 1))}</b>`}</span>`;
  }

  function paintPick() {
    const box = root.querySelector("[data-pick]");
    if (!isLoggedIn()) {
      box.innerHTML = `<p class="mp-login"><span>로그인하면 내 캐릭터를 눌러 레벨·경험치를 바로 채울 수 있어요.</span><button type="button" class="mp-login-button" data-login-open>로그인</button></p>`;
      return;
    }
    const card = (character, index) => {
      const on = picked === character.id;
      const current = on ? level : character.level;
      const raw = on ? exp : asBig(character.exp ?? 0);
      const need = current ? curve.get(current) : null;
      const percent = current && need && current < parkMaxLevel(character.job) ? percentOf(raw >= need ? need - 1n : raw, need) : "";
      const cygnus = isCygnusJob(character.job);
      return `<button type="button" class="mp-char${on ? " is-on" : ""}" data-character="${escapeHtml(character.id)}" aria-pressed="${on}" style="${jobStyle(findJob(jobs, character.job))};--i:${Math.min(index, 10)}">
        <span class="mp-char-top">
          ${faceHtml(character, "mp-char-face")}
          <span class="mp-char-copy"><strong>${escapeHtml(character.name)}</strong><small>${escapeHtml(character.job || "직업 없음")}</small></span>
        </span>
        <span class="mp-char-lv"><b>${current ? `Lv.${current}` : "레벨 없음"}</b>${percent ? `<small>${percent}%</small>` : ""}${cygnus ? `<i class="mp-cygnus" title="시그너스 기사단 · 만렙 ${CYGNUS_MAX_LEVEL}">만렙 ${CYGNUS_MAX_LEVEL}</i>` : ""}</span>
        <span class="mp-char-bar"><i style="width:${percent || 0}%"></i></span>
      </button>`;
    };
    const manualOn = picked === "";
    // 몬파 못 가는 캐릭터는 접어 둔다(고른 캐릭터는 늘 보이게).
    const shown = characters.filter((item) => usable(item) || item.id === picked);
    const hidden = characters.filter((item) => !usable(item) && item.id !== picked);
    const why = (character) => (!character.level ? "레벨 없음" : character.level < MONSTER_PARK.minLevel ? "50레벨부터" : "몬파 졸업");
    const more = hidden.length
      ? `<button type="button" class="mp-out-toggle" data-toggle-out aria-expanded="${outOpen}">${outOpen ? "▴" : "▾"} 몬파 레벨이 아닌 캐릭터 <b>${hidden.length}</b>명</button>
        ${outOpen ? `<div class="mp-out-list">${hidden.map((character) => `<button type="button" class="mp-out" data-character="${escapeHtml(character.id)}" style="${jobStyle(findJob(jobs, character.job))}">${faceHtml(character, "mp-out-face")}<b>${escapeHtml(character.name)}</b><span>${character.level ? `Lv.${character.level} · ` : ""}${why(character)}</span></button>`).join("")}</div>` : ""}`
      : "";
    box.innerHTML = `<div class="mp-char-row">${shown.map(card).join("")}<button type="button" class="mp-char is-manual${manualOn ? " is-on" : ""}" data-character="" aria-pressed="${manualOn}"><span class="mp-char-face"><b>✎</b></span><strong>직접 입력</strong><small>레벨을 골라요</small></button></div>${more}`;
  }

  // 고른 캐릭터의 저장된 레벨·경험치와 지금 값이 다른가
  function pickedCharacter() {
    return picked ? characters.find((item) => item.id === picked) ?? null : null;
  }

  function isDirty(character) {
    if (!character) return false;
    return character.level !== level || asBig(character.exp ?? 0) !== exp;
  }

  function savedText() {
    return level >= realMaxLevel() ? `Lv.${level}` : `Lv.${level} · ${formatCount(exp)} EXP`;
  }

  // 오늘 남은 입장을 지금 레벨·경험치에서 모두 돌았을 때. 만렙(cap)·구역 바뀜·구역 경험치 모름이면 거기서 멈춘다.
  // 경험치는 직업 만렙 기준으로 더한다(배틀메이지는 130이 돼도 넘친 경험치가 남는다).
  function todayPlan() {
    const top = cap();
    const left = ticketsToday();
    let state = { level, exp };
    let runs = 0;
    let gained = 0n;
    let wasted = 0n;
    let lost = 0;
    let levels = 0;
    for (let slot = 0; slot < left; slot += 1) {
      if (state.level >= top) break;
      const zone = zoneOf(state.level);
      const gain = zone ? zoneExp[zone.id] : null;
      if (gain == null) break;
      const after = gainRun(state.level, state.exp, gain, curve, realMaxLevel());
      runs += 1;
      gained += gain;
      wasted += after.wasted;
      if (after.leveled) levels += 1;
      state = { level: after.level, exp: after.exp };
      if (after.level < top && zoneOf(after.level)?.id !== zone.id) {
        lost = left - slot - 1;
        break;
      }
    }
    return { runs, gained, wasted, lost, levels, after: state };
  }

  function paintApply() {
    const box = root.querySelector("[data-apply]");
    const zone = level < cap() ? zoneOf(level) : null;
    const gain = zone ? zoneExp[zone.id] : null;
    const left = ticketsToday();
    const canRun = !expError && Boolean(zone) && gain != null && left > 0;
    const plan = canRun ? todayPlan() : null;
    const runNote = !zone ? (level < MONSTER_PARK.minLevel ? "50레벨부터" : cap() < realMaxLevel() ? "몬파 졸업" : `${cap()} 달성`) : gain == null ? "구역 경험치 모름" : left <= 0 ? "오늘 입장 끝" : `${plan.runs}판 · +${formatCount(plan.gained)}`;
    const character = pickedCharacter();
    const dirty = isDirty(character);
    const saveHtml = !character
      ? `<span class="mp-apply-note">${isLoggedIn() ? "캐릭터를 고르면 레벨을 바로 저장할 수 있어요" : ""}</span>`
      : dirty
        ? `<button type="button" class="mp-save" data-save ${saving || expError ? "disabled" : ""}>${saving ? "저장 중…" : `${escapeHtml(character.name)}에 ${escapeHtml(savedText())} 저장`}</button>`
        : `<span class="mp-apply-note is-saved">✓ ${escapeHtml(character.name)} 저장된 값과 같아요 · 오늘 몬파 끝을 누르면 바로 저장돼요</span>`;
    box.innerHTML = `
      <button type="button" class="mp-run-done" data-run-done ${canRun && !saving ? "" : "disabled"}>
        <span>오늘 몬파 끝!</span><small>${escapeHtml(runNote)}</small>
      </button>
      <div class="mp-apply-foot">${saveHtml}</div>`;
  }

  async function saveCharacter({ silent = false } = {}) {
    const character = pickedCharacter();
    if (!character || saving || expError || !isDirty(character)) return;
    saving = true;
    paintApply();
    const values = { level, exp: exp.toString() };
    const summary = savedText();
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
    notify(`${character.name} ${summary} 저장했습니다.`, "success");
    loadMainCharacter(true).then(paintProfileButton);
    paintPick();
    paintApply();
    paintRace();
  }

  // 오늘 몬파 끝 연출: 경험치 글자가 떠오르고, 레벨업이면 고리·불꽃·LEVEL UP. 모션 축소면 건너뛴다.
  function playRunFx(leveled, gain) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const layer = root.querySelector("[data-fx]");
    window.clearTimeout(fxTimer);
    layer.innerHTML = leveled
      ? `<i class="mp-fx-ring"></i>${Array.from({ length: 12 }, (_, i) => `<i class="mp-fx-spark" style="--a:${i * 30}deg;--w:${(i % 3) * 0.04}s"></i>`).join("")}<b class="mp-fx-word">LEVEL UP</b>`
      : `<b class="mp-fx-gain">+${escapeHtml(formatCount(gain))} EXP</b>`;
    fxTimer = window.setTimeout(() => {
      layer.innerHTML = "";
    }, 1300);
  }

  // 오늘 남은 입장을 한 번에 돌고 입장을 0으로. 구역이 바뀌면 남은 입장은 못 쓰니 역시 0.
  function finishToday() {
    const zone = level < cap() ? zoneOf(level) : null;
    const gain = zone ? zoneExp[zone.id] : null;
    if (expError || !zone || gain == null || ticketsToday() <= 0) return;
    const top = cap();
    const plan = todayPlan();
    if (!plan.runs) return;
    level = plan.after.level;
    exp = plan.after.exp;
    saveTickets(0);
    if (plan.levels) {
      sfx(level >= top ? "fanfare" : "check");
      burstAt(levelInput, ["#ffd38a", "#ffb35c", "#ffffff"], 18, 1);
    } else sfx("tick");
    playRunFx(plan.levels > 0, plan.gained);
    const notes = [];
    if (plan.lost) notes.push(`구역이 바뀌어 남은 입장 ${plan.lost}회는 못 써요`);
    if (plan.wasted > 0n) notes.push(`1레벨 제한으로 경험치 ${formatCount(plan.wasted)}이 버려졌어요`);
    if (notes.length) notify(notes.join(" · "), "info");
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
      expError = "";
    }
    calPick = 0;
    paintPick();
    paint();
  }

  function paintInputs() {
    const character = pickedCharacter();
    root.querySelector("[data-who]").textContent = character ? `${character.name}${character.job ? ` · ${character.job}` : ""}` : "직접 입력";
    if (document.activeElement !== levelInput) levelInput.value = String(level);
    expField.disabled = level >= realMaxLevel();
    expField.setAttribute("aria-invalid", String(Boolean(expError)));
    if (!expError && document.activeElement !== expField) expField.value = formatCount(exp);
    const cygnusToggle = root.querySelector("[data-cygnus]");
    cygnusToggle.hidden = picked !== "";
    cygnusToggle.setAttribute("aria-pressed", String(manualCygnus));
    const top = cap();
    const zone = level < top ? zoneOf(level) : null;
    const zoneBox = root.querySelector("[data-zone]");
    zoneBox.textContent = zone ? (zoneExp[zone.id] != null ? `한 판 +${formatCount(zoneExp[zone.id])}` : "이 구역 경험치를 몰라요") : level < MONSTER_PARK.minLevel ? "50레벨부터 들어갈 수 있어요" : top < realMaxLevel() ? `${top}레벨부터는 못 들어가요` : `이미 ${top}이에요`;
    zoneBox.classList.toggle("is-unknown", !zone || zoneExp[zone.id] == null);
    // 레벨 구역 문 막대: 지금 구역은 선명하게, 지나온 구역은 조금, 앞 구역은 많이 흐리게
    root.querySelector("[data-gates]").innerHTML = `${ZONES.map((item) => {
      const state = zone?.id === item.id ? "is-now" : level > item.max ? "is-past" : "is-ahead";
      return `<div class="mp-gate ${state}" style="--flex:${item.max - item.min + 1}">
        <span class="mp-gate-bar is-${item.id}"></span>
        <span class="mp-gate-copy"><b>${zoneLabel(item)} <small>· ${GATE_NAME[item.id]}</small></b><span>한 판 ${zoneExp[item.id] != null ? formatCount(zoneExp[item.id]) : "모름"}</span></span>
      </div>`;
    }).join("")}<span class="mp-gate-mark" style="--x:${trackX(levelValue({ level, exp }, top))}%"></span>`;
    const need = curve.get(level);
    const showExp = Boolean(need) && !expField.disabled;
    root.querySelector("[data-exp-bar]").style.width = `${showExp && !expError ? Number((exp * 10000n) / need) / 100 : expField.disabled ? 100 : 0}%`;
    root.querySelector("[data-exp-ratio]").textContent = showExp && !expError ? `${percentOf(exp, need)}%` : "";
    const exact = root.querySelector("[data-exp-exact]");
    exact.textContent = expError || (showExp ? `다음 레벨까지 ${formatCount(need - exp)} EXP · ${formatCount(exp)} / ${formatCount(need)}` : "");
    exact.classList.toggle("is-error", Boolean(expError));
    root.querySelector("[data-hw-link]").hidden = !syncsHomework();
    const left = ticketsToday();
    root.querySelector("[data-left-text]").textContent = `${left}회`;
    // 입장권 2장: 앞에서부터 남은 만큼 "입장 가능". 누르면 한 장씩만 쓰거나 되돌린다(2026-11-09 사용자 요청).
    root.querySelector("[data-tickets]").innerHTML = Array.from({ length: MONSTER_PARK.perDay }, (_, index) => {
      const on = index < left;
      return `<button type="button" class="mp-ticket${on ? " is-on" : ""}" data-ticket="${on ? left - 1 : left + 1}" aria-pressed="${on}" title="${on ? "사용함으로 바꾸기" : "입장 가능으로 되돌리기"}">
        <span class="mp-ticket-n">${index + 1}</span>
        <span class="mp-ticket-copy"><b>${on ? "입장 가능" : "사용함"}</b><small>${on ? "누르면 사용 처리" : "누르면 되돌리기"}</small></span>
      </button>`;
    }).join("");
    const total = eventDays ? left + MONSTER_PARK.perDay * (eventDays - 1) : 0;
    root.querySelector("[data-event-left]").innerHTML = eventDays ? `남은 입장 <b>${formatCount(total)}회</b>` : "";
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
      box.innerHTML = `<article class="mp-hero is-reach"><span class="mp-hero-label">${graduated ? "몬파 졸업" : "이미 만렙"}</span><strong>Lv.${level}</strong><span class="mp-hero-sub">${graduated ? `${top}레벨부터는 몬스터파크에 들어갈 수 없어요.` : "축하해요! 몬스터파크는 이제 쉬어도 돼요."}</span></article>`;
      lastReach = false;
      return;
    }
    const gainedLevels = event.final.level - startLevel;
    const reach = event.stop === "max";
    const nowX = trackX(levelValue({ level, exp }, top)) * (SPAN / (top - MONSTER_PARK.minLevel));
    const finalX = trackX(levelValue(event.final, top)) * (SPAN / (top - MONSTER_PARK.minLevel));
    const goalLast = goal.runs.at(-1);
    let goalHtml;
    if (goal.stop === "max" && goalLast) {
      const late = goalLast.day + 1 - eventDays;
      goalHtml = `<div class="mp-goal-copy"><span class="mp-goal-label">Lv.${top}까지</span><strong>${formatCount(goal.runs.length)}판</strong><span class="mp-goal-sub${reach ? "" : " is-late"}">${shortDate(addDays(today, goalLast.day), today)}에 Lv.${top}${reach ? "" : ` · 마감보다 ${late}일 더 걸려요`}</span></div>
        <span class="mp-goal-days"><b>${goalLast.day + 1}</b><small>일</small></span>`;
    } else {
      goalHtml = `<div class="mp-goal-copy"><span class="mp-goal-label">Lv.${top}까지</span><strong>계산 대기</strong><span class="mp-goal-sub">${escapeHtml(stopNote(goal))}${goal.runs.length ? ` · 그때까지 ${goal.runs.length}판, ${levelText(goal.final, top)}` : ""}</span></div>
        ${goal.stop === "unknown" ? '<button type="button" class="mp-goal-fill" data-open-zones>경험치 적기</button>' : ""}`;
    }
    box.innerHTML = `
      <article class="mp-hero${reach ? " is-reach" : ""}">
        <span class="mp-hero-label">${reach ? `마감 전 Lv.${top} 달성 가능` : event.stop === "days" ? `${endLabel} 마감 예상` : "현재 계산 가능한 결과"}</span>
        <strong data-final-level>${reach ? shortDate(addDays(today, event.runs.at(-1).day), today) : levelText(event.final, top)}</strong>
        <span class="mp-hero-sub">${event.runs.length}판 · ${gainedLevels > 0 ? `+${gainedLevels}레벨` : "레벨 그대로"}${event.stop === "unknown" || event.stop === "low" ? ` · ${escapeHtml(stopNote(event))}` : ""}</span>
        <div class="mp-hero-track" aria-hidden="true">
          <span class="mp-hero-done" style="width:${nowX}%"></span>
          <span class="mp-hero-gain" style="left:${nowX}%;width:${Math.max(0, finalX - nowX)}%"></span>
          <span class="mp-hero-now" style="left:${nowX}%"></span>
        </div>
        <div class="mp-hero-scale"><span>Lv.${MONSTER_PARK.minLevel}</span><span>지금 Lv.${level} → 마감 Lv.${event.final.level}</span><span>Lv.${top}</span></div>
      </article>
      <article class="mp-goal">${goalHtml}</article>`;
    if (reach && !lastReach) {
      sfx("fanfare");
      burstAt(box.querySelector("[data-final-level]"), ["#ffd38a", "#ffb35c", "#ffffff"], 26, 1);
    }
    lastReach = reach;
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
    if (laterLost) items.push({ today: false, html: `<b>내일부터 구역이 바뀌는 날</b>, 남은 입장 ${laterLost}회를 못 써요.` });
    if (laterWasteRuns) items.push({ today: false, html: `<b>내일부터 ${laterWasteRuns}판</b>이 1레벨 제한에 걸려요. 버려지는 경험치 합계 ${formatCount(laterWasted)}` });
    const box = root.querySelector("[data-warnings]");
    box.innerHTML = items
      .map((item, index) => `<p class="mp-warning${item.today ? " is-today" : ""}" style="--i:${index}"><span class="mp-warning-icon" aria-hidden="true">${item.today ? "!" : "i"}</span><span>${item.html}</span></p>`)
      .join("");
  }

  // 캐릭터 레이스: 몬파 갈 수 있는 캐릭터마다 지금 위치 → 마감 위치를 한 줄로(50~130 공통 눈금).
  function paintRace() {
    const box = root.querySelector("[data-race]");
    const entries = characters.filter((character) => usable(character) || (character.id === picked && level >= MONSTER_PARK.minLevel)).map((character) => {
      const top = parkMaxLevel(character.job);
      const current = character.id === picked ? level : character.level;
      const raw = character.id === picked ? exp : asBig(character.exp ?? 0);
      const need = curve.get(current);
      const safe = raw < 0n ? 0n : need && raw >= need ? need - 1n : raw;
      return { id: character.id, character, level: current, exp: safe, top, tickets: ticketsToday(character.id), selected: character.id === picked };
    });
    // 손님과 등록 캐릭터가 없는 경우에도 직접 입력 결과를 볼 수 있다.
    if (!picked && level >= MONSTER_PARK.minLevel && level < cap()) {
      entries.push({ id: "", character: { name: "직접 입력" }, level, exp, top: cap(), tickets: ticketsToday(), selected: true });
    }
    box.hidden = !eventDays || !entries.length;
    if (box.hidden) {
      box.innerHTML = "";
      return;
    }
    const lanes = entries.map((entry, index) => {
      const start = { level: entry.level, exp: entry.exp, curve, zoneExp, todayLeft: entry.tickets, maxLevel: entry.top };
      const result = simulate({ ...start, days: eventDays });
      const goal = simulate({ ...start, days: 400 });
      const goalLast = goal.runs.at(-1);
      const done = entry.level >= entry.top;
      const now = trackX(levelValue(entry, entry.top));
      const fin = trackX(levelValue(result.final, entry.top));
      const reached = result.stop === "max";
      const result1 = done ? "이미 만렙" : reached ? `${tinyDate(addDays(today, result.runs.at(-1)?.day ?? 0))} 만렙` : `마감 Lv.${result.final.level}`;
      const result2 = done ? "" : reached ? `마감 ${eventDays - 1 - (result.runs.at(-1)?.day ?? 0)}일 전 Lv.${entry.top}` : goal.stop === "max" && goalLast ? `Lv.${entry.top}은 ${tinyDate(addDays(today, goalLast.day))}` : goal.stop === "unknown" ? "구역 경험치 필요" : "";
      const style = entry.character.job ? jobStyle(findJob(jobs, entry.character.job)) : "";
      return `<button type="button" class="mp-lane${entry.selected ? " is-on" : ""}${reached || done ? " is-reach" : ""}" data-character="${escapeHtml(entry.id)}" aria-pressed="${entry.selected}" style="${style};--i:${Math.min(index, 10)}"
        aria-label="${escapeHtml(`${entry.character.name} · 지금 ${levelText(entry, entry.top)} · ${result1}${result2 ? ` · ${result2}` : ""}`)}">
        <span class="mp-lane-who">${entry.id ? faceHtml(entry.character, "mp-lane-face") : '<span class="mp-lane-face"><b>✎</b></span>'}<span class="mp-lane-name"><b>${escapeHtml(entry.character.name)}</b><small>${escapeHtml(levelText(entry, entry.top))}</small></span></span>
        <span class="mp-lane-track" aria-hidden="true">
          <span class="mp-lane-zones">${ZONES.map((zone) => `<i style="--flex:${zone.max - zone.min + 1}"></i>`).join("")}</span>
          <span class="mp-lane-run" style="left:${now}%;width:${Math.max(0, fin - now)}%"></span>
          <span class="mp-lane-cap" style="left:${trackX(entry.top)}%"></span>
          <span class="mp-lane-now" style="left:${now}%"></span>
          <span class="mp-lane-fin" style="left:${fin}%"></span>
        </span>
        <span class="mp-lane-result"><b>${escapeHtml(result1)}</b><small>${escapeHtml(result2)}</small></span>
      </button>`;
    });
    const scale = [50, 70, 100, 120, 130].map((value) => `<span style="left:${trackX(value)}%">${value}</span>`).join("");
    box.innerHTML = `
      <div class="mp-sec-head">
        <div><h2 id="mp-race-title">캐릭터 레이스</h2><p>지금 위치에서 ${endLabel} 마감까지 얼마나 달리는지 한 줄씩 비교해요</p></div>
        <ul class="mp-legend" aria-label="범례"><li><i class="is-now"></i>지금</li><li><i class="is-run"></i>마감까지 오를 구간</li><li><i class="is-cap"></i>만렙</li></ul>
      </div>
      <div class="mp-lane-scale" aria-hidden="true"><span></span><span class="mp-lane-ticks">${scale}</span><span></span></div>
      <div class="mp-lanes">${lanes.join("")}</div>`;
  }

  // 이벤트 달력: 고른 캐릭터의 오늘~마감. 일요일부터 7칸(2026-11-09 사용자 요청), 하루 두 칸이 그날 입장권.
  function paintCalendar(event) {
    const box = root.querySelector("[data-calendar]");
    const character = pickedCharacter();
    const title = `${character ? escapeHtml(character.name) : "직접 입력"}의 이벤트 달력`;
    if (!eventDays) {
      box.innerHTML = `<div class="mp-sec-head"><div><h2 id="mp-cal-title">${title}</h2></div></div><p class="mp-muted">이벤트 기간이 끝났어요.</p>`;
      calDetails = [];
      return;
    }
    const top = cap();
    const byDay = new Map();
    for (const run of event.runs) {
      if (!byDay.has(run.day)) byDay.set(run.day, []);
      byDay.get(run.day).push(run);
    }
    const lastRunDay = event.runs.at(-1)?.day ?? -1;
    const lead = new Date(`${today}T00:00:00Z`).getUTCDay();
    const cells = Array.from({ length: lead }, () => `<span class="mp-day is-blank" aria-hidden="true"></span>`);
    const runText = (run) => (run.after.level > run.before.level ? `Lv.${run.before.level} → ${run.after.level}` : `+경험치 · ${percentOf(run.after.exp, curve.get(run.after.level))}%`);
    calDetails = [];
    let carry = { level, exp };
    for (let day = 0; day < eventDays; day += 1) {
      const runs = byDay.get(day) ?? [];
      const before = carry;
      const after = runs.at(-1)?.after ?? carry;
      carry = after;
      const tickets = day === 0 ? ticketsToday() : MONSTER_PARK.perDay;
      const lost = runs.reduce((sum, run) => sum + run.lostAfter, 0);
      const up = after.level - before.level;
      const goalHit = event.stop === "max" && runs.length > 0 && day === lastRunDay;
      const done = after.level >= top && !runs.length;
      const date = addDays(today, day);
      const [, month, dateNum] = date.split("-").map(Number);
      const pips = Array.from({ length: MONSTER_PARK.perDay }, (_, slot) => {
        const run = runs[slot];
        if (run) return `<i class="${run.after.level > run.before.level ? "is-up" : "is-exp"}"></i>`;
        if (slot < runs.length + lost) return `<i class="is-lost"></i>`;
        if (day === 0 && slot >= tickets) return `<i class="is-used"></i>`;
        return "<i></i>";
      }).join("");
      const badge = goalHit ? "만렙 달성" : day === 0 ? "오늘" : lost ? "구역 변경" : up > 0 ? `+${up}` : "";
      const badgeClass = goalHit ? "is-goal" : day === 0 ? "is-today" : lost ? "is-lost" : up > 0 ? "is-up" : "";
      const wasted = runs.reduce((sum, run) => sum + run.wasted, 0n);
      const note = done ? `이미 Lv.${top}이에요`
        : !tickets ? "오늘 입장을 다 썼어요"
          : lost ? `구역이 바뀌어 ${lost}회를 못 써요`
            : wasted > 0n ? `1레벨 제한으로 ${formatCount(wasted)} 버려져요`
              : goalHit ? `Lv.${top} 달성!`
                : runs.length < tickets ? ({ unknown: "구역 경험치를 몰라 계산을 멈췄어요", low: "50레벨부터 들어갈 수 있어요" }[event.stop] ?? "") : "";
      calDetails.push({ date: shortDate(date, today), runs: runs.map((run, index) => ({ text: `${index + 1}판 · ${runText(run)}`, up: run.after.level > run.before.level })), note });
      const week = (lead + day) % 7;
      const label = `${shortDate(date, today)} · ${done ? "끝" : levelText(after, top)}${badge ? ` · ${badge}` : ""}`;
      cells.push(`<button type="button" class="mp-day${day === 0 ? " is-today" : ""}${goalHit ? " is-goal" : up > 0 ? " is-up" : ""}${done ? " is-done" : ""}${day === calPick ? " is-picked" : ""}${week === 6 ? " is-sat" : week === 0 ? " is-sun" : " is-weekday"}" data-cal-day="${day}" aria-label="${escapeHtml(label)}" style="--i:${Math.min(day, 30)}">
        <span class="mp-day-top"><b>${dateNum === 1 || day === 0 ? `${month}/` : ""}${dateNum}</b>${badge ? `<em class="${badgeClass}">${escapeHtml(badge)}</em>` : ""}</span>
        <span class="mp-day-lv"><b>${done ? "—" : `Lv.${after.level}`}</b><small>${done || after.level >= top ? "" : `${percentOf(after.exp, curve.get(after.level))}%`}</small></span>
        ${up > 0 ? LEVEL_UP_ICON : ""}
        <span class="mp-day-pips">${pips}</span>
      </button>`);
    }
    while (cells.length % 7) cells.push(`<span class="mp-day is-blank" aria-hidden="true"></span>`);
    if (calPick >= calDetails.length) calPick = 0;
    box.innerHTML = `
      <div class="mp-sec-head">
        <div><h2 id="mp-cal-title">${title}</h2><p>하루 두 칸이 그날 입장권이에요 · 칸에 마우스를 올리거나 누르면 판별 결과가 보여요</p></div>
        <ul class="mp-legend" aria-label="범례"><li><i class="is-pip-up"></i>레벨업</li><li><i class="is-pip-exp"></i>경험치만</li><li><i class="is-pip-lost"></i>구역 변경으로 못 씀</li><li><i class="is-pip-used"></i>이미 씀</li></ul>
      </div>
      <div class="mp-cal-scroll">
        <div class="mp-cal-grid">
          ${["일", "월", "화", "수", "목", "금", "토"].map((name, index) => `<span class="mp-dow${index === 6 ? " is-sat" : index === 0 ? " is-sun" : ""}">${name}</span>`).join("")}
          ${cells.join("")}
        </div>
      </div>
      <p class="mp-cal-detail" data-cal-detail aria-live="polite"></p>`;
    paintCalDetail();
  }

  function paintCalDetail() {
    const box = root.querySelector("[data-cal-detail]");
    const detail = calDetails[calPick];
    if (!box || !detail) return;
    box.innerHTML = `<b>${escapeHtml(detail.date)}</b>${detail.runs.map((run) => `<span class="mp-cal-run${run.up ? " is-up" : ""}">${escapeHtml(run.text)}</span>`).join("")}<span class="mp-cal-note">${escapeHtml(detail.note || (detail.runs.length ? "" : "입장 없음"))}</span>`;
    for (const cell of root.querySelectorAll("[data-cal-day]")) cell.classList.toggle("is-picked", Number(cell.dataset.calDay) === calPick);
  }

  function pickCalDay(cell) {
    if (!cell) return;
    const day = Number(cell.dataset.calDay);
    if (day === calPick) return;
    calPick = day;
    paintCalDetail();
  }

  function paint() {
    paintInputs();
    paintApply();
    if (expError) return;
    const start = { level, exp, curve, zoneExp, todayLeft: ticketsToday(), maxLevel: cap() };
    const event = simulate({ ...start, days: eventDays });
    const goal = simulate({ ...start, days: 400 });
    paintResults(event, goal);
    paintWarnings(event);
    paintRace();
    paintCalendar(event);
  }

  for (const type of ["pointerover", "focusin"]) {
    root.addEventListener(type, (event) => pickCalDay(event.target.closest?.("[data-cal-day]")));
  }

  root.addEventListener("click", (event) => {
    const day = event.target.closest("[data-cal-day]");
    if (day) {
      pickCalDay(day);
      return;
    }
    if (event.target.closest("[data-run-done]")) {
      finishToday();
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
    if (event.target.closest("[data-toggle-out]")) {
      sfx("tick");
      outOpen = !outOpen;
      paintPick();
      return;
    }
    if (event.target.closest("[data-open-zones]")) {
      const zones = root.querySelector("[data-zones]");
      zones.open = true;
      const zone = zoneOf(level);
      const field = zone ? zoneForm.elements.namedItem(zone.id) : null;
      zones.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      field?.focus({ preventScroll: true });
      return;
    }
    const character = event.target.closest("[data-character]");
    if (character) {
      if (character.dataset.character === picked && character.closest("[data-race]")) return;
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
    if (event.target === expField) {
      setExperience(expField.value);
      paint();
      return;
    }
  });

  root.addEventListener("focusout", (event) => {
    if (event.target === expField && !expError) expField.value = formatCount(exp);
  });

  root.addEventListener("change", (event) => {
    if (event.target === levelInput) paintInputs();
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
