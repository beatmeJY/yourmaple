import { bosses, bossTimeParts, formatStamp, readBossTime } from "../boss-cooldown.js";
import { attachFaceUrls, faceMarkup, missingFaceColumn } from "../character-face.js";
import { translateDbError } from "../db-error.js";
import { BURST_COLORS, burstAt, celebrate, sfx } from "../effects.js";
import { compareName, escapeHtml, formatCount } from "../format.js";
import { DOJO_DAILY_GOAL, DOJO_RESET_POINTS, RESET_KINDS, availableDay, availableLabel, availableTime, clockRemain, dojoProgress, homeworkState, nextMidnight, resetDojoTotal, shortRemain } from "../homework-calc.js";
import { jobRecord } from "../job-label.js";
import { getSupabase } from "../supabase-client.js";
import { notify } from "../toast.js";

// 숙제 체크리스트: 위는 초기화 시계 3개, 아래는 숙제마다 카드 하나(그 숙제를 할 수 있는 캐릭터만).
// 보스 3종은 캐릭터 표의 …_enabled(할 캐릭터)·…_at(도전 시각)을 그대로 쓴다. 예전에 캐릭터 관리에 있던
// 보스 도전 기록·시각 직접 지정·취소·보스 켜기·"도전 가능만"을 이 화면으로 옮겼다(2026-10-11 사용자 요청).
// 무릉도장과 직접 추가한 숙제는 homework_checks 에 끝낸 시각을 남긴다(sql/030).
// 숙제마다 "+"로 표시할 캐릭터를 고른다: 보스는 …_enabled, 그 밖은 homework_members(sql/031). 숙제 카드 숨기기는 homework_prefs.

const BOSS_ART = { pianus: "img/pianus.png", papulatus: "img/papulatus.png", rift: "img/rift.png" };
const BOSS_KIND = { papulatus: "after24h", rift: "after24h", pianus: "after7d" };
const BOSS_ORDER = ["papulatus", "rift", "pianus"];
const BOSS_BURST = {
  papulatus: ["#ffb703", "#ffd000", "#ff8a1f", "#ffffff"],
  rift: ["#7ecbff", "#3aa0ff", "#67e8f9", "#ffffff"],
  pianus: ["#ff5a5a", "#e10600", "#fecaca", "#ffffff"],
};
const BASE_COLUMNS = "id, name, level, account_id, accounts(name), jobs(name, color, color_dark), pianus_enabled, pianus_at, papulatus_enabled, papulatus_at, rift_enabled, rift_at";
const TABS = [
  { id: "all", label: "전체" },
  { id: "daily", label: "매일 00시" },
  { id: "after24h", label: "24시간" },
  { id: "after7d", label: "7일" },
];
const HOUR_MS = 3_600_000;
const READY_ONLY_KEY = "maple-note-homework-ready-only";
const SOON_KEY = "maple-note-homework-soon";

function tableMissing(error, pattern = /homework_(tasks|checks)/i) {
  const raw = `${error?.message || ""} ${error?.details || ""} ${error?.code || ""}`;
  return pattern.test(raw) && /does not exist|schema cache|could not find|42P01|PGRST205/i.test(raw);
}

function readFlag(key) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key, on) {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    // 기억하지 못해도 이번에는 적용한다.
  }
}

// 10.9 01:47 처럼 짧게(전체 시각은 title 로)
function shortStamp(value) {
  const date = new Date(value);
  const two = (part) => String(part).padStart(2, "0");
  return `${date.getMonth() + 1}.${date.getDate()} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

function sameDay(left, right) {
  return new Date(left).toDateString() === new Date(right).toDateString();
}

export async function render(root) {
  root.innerHTML = `
    <div class="hw-page">
      <header class="ym-page-head hw-head">
        <div><h1>숙제 체크리스트</h1><p>숙제마다 할 수 있는 캐릭터만 모았어요. 끝낸 칸은 초기화 시각이 지나면 저절로 다시 열려요.</p></div>
      </header>
      <div class="hw-clocks" data-clocks></div>
      <p class="hw-notice" data-notice hidden></p>
      <div class="hw-bar">
        <div class="hw-tabs" role="tablist" data-tabs></div>
        <label class="char-switch hw-ready">
          <input type="checkbox" data-ready-only />
          <span class="char-switch-track" aria-hidden="true"></span>
          <span>지금 가능만</span>
        </label>
        <label class="char-switch hw-ready">
          <input type="checkbox" data-soon-also />
          <span class="char-switch-track" aria-hidden="true"></span>
          <span>오늘·곧</span>
        </label>
        <span class="hw-total" data-total></span>
        <button type="button" class="hw-add-open" data-add-open>+ 숙제 추가</button>
      </div>
      <div class="hw-hidden" data-hidden-list hidden></div>
      <form class="hw-add" data-add-form hidden>
        <span class="hw-add-title">숙제 추가</span>
        <input name="name" maxlength="40" placeholder="예: 일일 퀘스트" autocomplete="off" aria-label="숙제 이름" />
        <select name="reset_kind" aria-label="초기화 방식">
          ${Object.values(RESET_KINDS).map((kind) => `<option value="${kind.id}">${kind.label}</option>`).join("")}
        </select>
        <button type="submit" class="hw-add-save">추가</button>
      </form>
      <div class="hw-cards" data-cards><p class="hw-muted">불러오는 중입니다.</p></div>
      <dialog class="boss-time-dialog" data-time-dialog>
        <form data-time-form>
          <h2 data-time-title>끝낸 시각</h2>
          <p class="field-note">실제로 끝낸(도전한) 시각을 적으면 그 시각부터 대기 시간이 시작됩니다.</p>
          <div class="boss-time-fields">
            <label class="field"><span>년</span><input name="year" inputmode="numeric" autocomplete="off" required /></label>
            <label class="field"><span>월</span><input name="month" inputmode="numeric" autocomplete="off" required /></label>
            <label class="field"><span>일</span><input name="day" inputmode="numeric" autocomplete="off" required /></label>
            <label class="field"><span>시</span><input name="hour" inputmode="numeric" autocomplete="off" required /></label>
            <label class="field"><span>분</span><input name="minute" inputmode="numeric" autocomplete="off" required /></label>
          </div>
          <div class="button-row">
            <button class="primary-button" type="submit">기록</button>
            <button class="secondary-button" type="button" data-time-close>닫기</button>
          </div>
        </form>
      </dialog>
    </div>
  `;

  const cardsBox = root.querySelector("[data-cards]");
  const addForm = root.querySelector("[data-add-form]");
  const timeDialog = root.querySelector("[data-time-dialog]");
  const timeForm = root.querySelector("[data-time-form]");
  const readyToggle = root.querySelector("[data-ready-only]");
  const soonToggle = root.querySelector("[data-soon-also]");
  readyToggle.checked = readFlag(READY_ONLY_KEY);
  soonToggle.checked = readFlag(SOON_KEY);

  let characters = [];
  let tasks = [];
  let checks = new Map(); // `${characterId}:${taskKey}` → checked_at
  let ready = true; // sql/030 실행 여부
  let membersReady = true; // sql/031 실행 여부
  let members = new Set(); // `${characterId}:${taskKey}` (무릉·직접 추가 숙제의 표시 캐릭터)
  let hiddenTasks = new Set();
  let dojoReady = true; // sql/033 실행 여부
  let dojoLog = new Map(); // characterId → [{ id, total, kind, recorded_at }] 무릉 통합 점수 기록
  // characterId → { id: 방금 남긴 기록 id, records: 그 전 무릉 화면 점수 [{ id, score }] } — 되돌리면 기록을 지우고 점수를 원래대로
  const dojoUndo = new Map();
  let recordRows = new Map(); // characterId → [{ id, score, updated_at }] 무릉 화면 기록(개인·팀)
  let userId = "";
  let tab = "all";
  let loadId = 0;
  let painted = false;
  const managing = new Set(); // 표시할 캐릭터를 고르는 중인 숙제 카드
  const celebrated = new Set();
  // 방금 바꾼 기록을 되돌릴 때 쓸 예전 값: `${characterId}:${taskKey}` → { previous, generation }
  const undoSlots = new Map();
  let undoEpoch = 0;

  // ── 데이터 ────────────────────────────────────────────────

  function accountLabel(character) {
    const account = character.accounts;
    const name = Array.isArray(account) ? account[0]?.name : account?.name;
    return name || "계정 없음";
  }

  function orderedCharacters() {
    return [...characters].sort((a, b) => compareName(accountLabel(a), accountLabel(b)) || (b.level ?? -1) - (a.level ?? -1) || a.name.localeCompare(b.name, "ko"));
  }

  function allTasks() {
    const builtIn = [
      ...BOSS_ORDER.map((key) => {
        const boss = bosses.find((item) => item.key === key);
        return { key, name: boss.label, kind: BOSS_KIND[key], boss, img: BOSS_ART[key], sub: key === "pianus" ? "보스 · 입장 후 7일" : "보스 · 입장 후 24시간" };
      }),
      { key: "dojo", name: "무릉도장", kind: "daily", glyph: "武", hue: 25, sub: "매일 00시 초기화", needsTable: true },
    ];
    const custom = tasks.map((task) => ({ key: task.id, name: task.name, kind: task.reset_kind, glyph: [...task.name.trim()][0] || "숙", hue: 295, sub: `직접 추가 · ${RESET_KINDS[task.reset_kind]?.label ?? ""}`, custom: true, needsTable: true }));
    return [...builtIn, ...custom];
  }

  function isEligible(task, character) {
    if (task.boss) return Boolean(character[task.boss.columnEnabled]);
    // sql/031 실행 전에는 예전처럼 모든 캐릭터
    return !membersReady || members.has(`${character.id}:${task.key}`);
  }

  function visibleTasks() {
    return allTasks().filter((task) => !hiddenTasks.has(task.key));
  }

  function checkedAt(task, character) {
    if (task.boss) return character[task.boss.columnAt] ?? null;
    return checks.get(`${character.id}:${task.key}`) ?? null;
  }

  function stateOf(task, character, now) {
    const state = homeworkState(task.kind, checkedAt(task, character), now);
    // 무릉은 오늘 3,500점을 채워도 끝낸 것으로 본다.
    if (task.key === "dojo" && !state.done && (dojoProgress(dojoLog.get(character.id), now).today ?? 0) >= DOJO_DAILY_GOAL) {
      return { done: true, next: nextMidnight(now), byPoints: true };
    }
    return state;
  }

  // "지금 가능만"·"오늘·곧"(예전 캐릭터 관리의 필터): 둘 다 끄면 모두, 켠 조건 중 하나라도 맞으면 보인다.
  function soonish(state, now) {
    return state.done && state.next != null && (state.next - now <= HOUR_MS || sameDay(now, state.next));
  }

  function columnShown(state, now) {
    const readyOnly = readyToggle.checked;
    const soonAlso = soonToggle.checked;
    if (!readyOnly && !soonAlso) return true;
    return (readyOnly && !state.done) || (soonAlso && soonish(state, now));
  }

  // ── 그리기 ────────────────────────────────────────────────

  function face(character) {
    const color = jobRecord(character)?.color;
    const tint = /^#[0-9a-fA-F]{6}$/.test(color || "") ? ` style="--tint:${color}"` : "";
    const inner = character.face_url ? faceMarkup(character.face_url) : `<span class="char-face is-letter">${escapeHtml([...String(character.name).trim()][0] || "?")}</span>`;
    return `<span class="hw-face"${tint}>${inner}</span>`;
  }

  function soonMark(state, now) {
    if (!state.done || !state.next) return "";
    if (state.next - now <= HOUR_MS) return `<em class="hw-soon">곧</em>`;
    if (sameDay(now, state.next)) return `<em class="hw-soon is-today">오늘</em>`;
    return "";
  }

  // 시안 숙제표 모양: 숙제마다 표 하나. 위 줄은 캐릭터(링 얼굴), 아래 줄은 그 숙제의 체크 칸.
  // 링은 끝낸 칸이 다시 열리기까지 지난 정도(다 차면 다시 가능).
  function periodOf(task) {
    return task.kind === "after7d" ? 7 * 86_400_000 : 86_400_000;
  }

  function personHead(task, character, state, now, managingNow) {
    let deg = 360;
    let tone = "is-ready";
    if (managingNow) tone = "is-manage";
    else if (state.done) {
      const left = state.next - now;
      deg = Math.max(0, Math.min(360, (1 - left / periodOf(task)) * 360));
      tone = "is-wait";
    }
    const color = jobRecord(character)?.color;
    const tint = /^#[0-9a-fA-F]{6}$/.test(color || "") ? `;--tint:${color}` : "";
    const inner = character.face_url ? faceMarkup(character.face_url) : `<span class="char-face is-letter">${escapeHtml([...String(character.name).trim()][0] || "?")}</span>`;
    return `<div class="hw-person ${tone}" style="--deg:${deg}deg${tint}" title="${escapeHtml(`${accountLabel(character)} · ${character.name}`)}">
      <span class="hw-ring"><span class="hw-ring-face">${inner}</span></span>
      <strong>${escapeHtml(character.name)}${managingNow ? "" : soonMark(state, now)}</strong>
      <small>${character.level ? `Lv.${escapeHtml(formatCount(character.level))}` : escapeHtml(accountLabel(character))}</small>
    </div>`;
  }

  function checkCell(task, character, state, now) {
    const at = checkedAt(task, character);
    const key = `${character.id}:${task.key}`;
    const label = state.done
      ? `${character.name} · ${task.name} 끝냄${state.next ? ` · ${shortRemain(state.next - now)} 뒤 다시` : ""}`
      : `${character.name} · ${task.name} 하기${at ? ` · 마지막 ${formatStamp(at)}` : ""}`;
    const remain = state.done
      ? `<small class="is-day">${escapeHtml(availableDay(state.next, now))}</small><small class="is-at">${escapeHtml(availableTime(state.next))} 가능</small>`
      : `<small class="is-ready">지금 가능</small>`;
    const below = state.done
      ? `<span class="hw-left" data-remain="${state.next}" title="다시 가능까지 남은 시간">${shortRemain(state.next - now)}</span>`
      : `<span class="hw-left">${at ? `마지막 ${escapeHtml(shortStamp(at))}` : "기록 없음"}</span>`;
    const undo = undoSlots.has(key) ? `<button type="button" class="hw-tiny" data-undo="${escapeHtml(task.key)}" data-character="${character.id}">취소</button>` : "";
    return `<div class="hw-tcell">
      <button type="button" class="hw-cell${state.done ? " is-done" : ""}" data-check="${escapeHtml(task.key)}" data-character="${character.id}" aria-pressed="${state.done}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"><b>${state.done ? "✓" : ""}</b>${remain}</button>
      ${below}
      <span class="hw-tcell-acts">
        <button type="button" class="hw-tiny is-icon" data-set-time="${escapeHtml(task.key)}" data-character="${character.id}" aria-label="${escapeHtml(`${character.name} ${task.name} 끝낸 시각 직접 적기`)}" title="끝낸 시각을 직접 적어요"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M10 6.2V10l2.6 1.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>${undo}
      </span>
    </div>`;
  }

  function switchCell(task, character) {
    const on = isEligible(task, character);
    return `<div class="hw-tcell is-switch"><label class="char-switch"><input type="checkbox" data-enable="${escapeHtml(task.key)}" data-character="${character.id}"${on ? " checked" : ""} /><span class="char-switch-track" aria-hidden="true"></span><span class="sr-only">${escapeHtml(`${character.name} ${task.name}에 표시`)}</span></label><small>${on ? "표시" : "숨김"}</small></div>`;
  }

  function dojoTodayCell(characterId, now) {
    const progress = dojoProgress(dojoLog.get(characterId), now);
    if (progress.total == null) {
      return `<div class="hw-tcell is-dojo"><span class="hw-dojo-num">기록 없음</span><span class="hw-dojo-bar"><i style="width:0"></i></span><span class="hw-left">점수 미입력</span></div>`;
    }
    const today = progress.today ?? 0;
    const ratio = Math.min(1, today / DOJO_DAILY_GOAL);
    return `<div class="hw-tcell is-dojo${today >= DOJO_DAILY_GOAL ? " is-full" : ""}" title="${progress.partial ? "오늘 처음 적은 점수는 어제 기록이 없어 빼고 셌어요" : "오늘 00시 전 마지막 기록부터 오른 점수"}">
      <span class="hw-dojo-num"><b>${formatCount(today)}</b>/${formatCount(DOJO_DAILY_GOAL)}</span>
      <span class="hw-dojo-bar"><i style="width:${ratio * 100}%"></i></span>
      <span class="hw-left">${today >= DOJO_DAILY_GOAL ? "오늘 완료" : progress.partial ? "어제 기록 없음" : `${formatCount(DOJO_DAILY_GOAL - today)}점 남음`}</span>
      ${today > 0 ? `<span class="hw-tcell-acts"><button type="button" class="hw-tiny" data-dojo-clear="${characterId}" title="오늘 쌓은 점수만 0으로 (통합 점수는 그대로)">오늘 초기화</button></span>` : ""}
    </div>`;
  }

  function dojoTotalCell(characterId, now) {
    const progress = dojoProgress(dojoLog.get(characterId), now);
    const total = progress.total ?? 0;
    const ratio = Math.min(1, total / DOJO_RESET_POINTS);
    const full = total >= DOJO_RESET_POINTS;
    const undo = dojoUndo.has(characterId) ? `<button type="button" class="hw-tiny" data-dojo-undo="${characterId}">취소</button>` : "";
    return `<div class="hw-tcell is-dojo${full ? " is-max" : ""}">
      <span class="hw-dojo-num"><b>${progress.total == null ? "-" : formatCount(total)}</b>/${formatCount(DOJO_RESET_POINTS)}</span>
      <span class="hw-dojo-bar is-total"><i style="width:${ratio * 100}%"></i></span>
      <span class="hw-dojo-add">
        <input data-dojo-input="${characterId}" inputmode="numeric" maxlength="8" placeholder="현재 점수" aria-label="현재 통합 점수" />
        <button type="button" class="hw-tiny is-add" data-dojo-add="${characterId}" aria-label="통합 점수 저장" title="지금 게임의 통합 점수로 저장">✓</button>
      </span>
      <span class="hw-tcell-acts"><button type="button" class="hw-tiny${full ? " is-hot" : ""}" data-dojo-reset="${characterId}" title="통합 점수에서 ${formatCount(DOJO_RESET_POINTS)}점을 빼요"${progress.total == null ? " disabled" : ""}>${formatCount(DOJO_RESET_POINTS)} 초기화</button>${undo}</span>
      ${progress.lastAt ? `<span class="hw-left">${escapeHtml(shortStamp(progress.lastAt))} 기록</span>` : ""}
    </div>`;
  }

  function taskCard(task, now, index) {
    const people = orderedCharacters().filter((character) => isEligible(task, character));
    const blocked = task.needsTable && !ready;
    const states = people.map((character) => ({ character, state: stateOf(task, character, now) }));
    const readyCount = states.filter((item) => !item.state.done).length;
    const doneCount = states.length - readyCount;
    const isManaging = managing.has(task.key);
    const shown = states.filter((item) => columnShown(item.state, now));
    const icon = task.img ? `<img src="${escapeHtml(task.img)}" alt="" width="40" height="40" />` : `<span class="hw-glyph" style="--hue:${task.hue}">${escapeHtml(task.glyph)}</span>`;
    const rowIcon = task.img ? `<img src="${escapeHtml(task.img)}" alt="" width="30" height="30" />` : `<span class="hw-glyph is-small" style="--hue:${task.hue}">${escapeHtml(task.glyph)}</span>`;
    const extraRows = (columns) => {
      if (task.key !== "dojo" || isManaging) return "";
      if (!dojoReady) return `<p class="hw-muted hw-dojo-note">무릉 통합 점수를 적으려면 Supabase에서 sql/033_dojo_score_log.sql을 실행해 주세요.</p>`;
      const ids = columns.map((column) => (column.character ?? column).id);
      return `<div class="hw-trow is-dojo"><div class="hw-tlabel"><span><strong>오늘 점수</strong><small>어제보다 ${formatCount(DOJO_DAILY_GOAL)}점이면 완료</small></span></div>${ids.map((id) => dojoTodayCell(id, now)).join("")}</div>
        <div class="hw-trow is-dojo"><div class="hw-tlabel"><span><strong>통합 점수</strong><small>게임에 보이는 점수 입력</small></span></div>${ids.map((id) => dojoTotalCell(id, now)).join("")}</div>`;
    };
    // 무릉은 통합 점수로 완료를 판단하므로 체크 칸 줄을 두지 않는다(sql/033 전에는 예전처럼 체크 칸).
    const scoreOnly = task.key === "dojo" && dojoReady && !isManaging;
    const table = (columns, headCell, rowCell) => `<div class="hw-tscroll"><div class="hw-table" style="--cols:${columns.length}">
        <div class="hw-trow is-head"><div class="hw-tlabel is-corner"></div>${columns.map(headCell).join("")}</div>
        ${scoreOnly ? "" : `<div class="hw-trow"><div class="hw-tlabel">${rowIcon}<span><strong>${escapeHtml(task.name)}</strong><small>${escapeHtml(RESET_KINDS[task.kind]?.label ?? "")}</small></span></div>${columns.map(rowCell).join("")}</div>`}
        ${extraRows(columns)}
      </div></div>`;
    let body;
    if (blocked) body = `<p class="hw-muted">sql/030_homework.sql을 실행하면 쓸 수 있어요.</p>`;
    else if (!characters.length) body = `<p class="hw-muted">캐릭터를 추가하면 숙제표가 생겨요. <a href="#/characters">캐릭터 추가하러 가기</a></p>`;
    else if (isManaging) {
      body = `<p class="hw-muted hw-manage-note">이 숙제표에 보일 캐릭터를 켜고 끄세요.${task.boss ? " 레벨과 퀘스트를 맞춘 캐릭터만 켜 주세요." : ""} 다 고르면 ✓를 누르세요.</p>`
        + table(orderedCharacters(), (character) => personHead(task, character, null, now, true), (character) => switchCell(task, character));
    } else if (!people.length) body = `<p class="hw-muted">이 숙제표에 보일 캐릭터가 없어요. 오른쪽 위 + 버튼으로 캐릭터를 넣어 주세요.</p>`;
    else if (!shown.length) {
      const soonest = states.reduce((best, item) => (item.state.next != null && (!best || item.state.next < best) ? item.state.next : best), null);
      body = readyCount === 0
        ? `<p class="hw-muted hw-all-done">✓ 모두 끝냈어요${soonest ? ` · 가장 빠른 칸은 ${escapeHtml(availableLabel(soonest, now))}(<span data-remain="${soonest}">${shortRemain(soonest - now)}</span> 뒤)` : ""}</p>`
        : `<p class="hw-muted">켜 둔 보기 조건(지금 가능만·오늘·곧)에 맞는 캐릭터가 없어요.</p>`;
    } else {
      body = table(shown, (item) => personHead(task, item.character, item.state, now, false), (item) => checkCell(task, item.character, item.state, now));
    }
    const ratio = states.length ? doneCount / states.length : 0;
    const full = states.length > 0 && readyCount === 0;
    return `<section class="hw-card${full ? " is-full" : ""}" data-task-card="${escapeHtml(task.key)}" style="--i:${Math.min(index, 8)};--deg:${ratio * 360}deg">
      <header class="hw-card-head">
        <span class="hw-card-icon">${icon}</span>
        <span class="hw-card-title"><strong>${escapeHtml(task.name)} 숙제표</strong><small>${escapeHtml(task.sub)}</small></span>
        ${task.key === "dojo" ? `<a class="hw-mini hw-link" href="#/dojo?log">자세한 기록</a>` : ""}
        <span class="hw-card-count" title="끝낸 캐릭터 / 표시한 캐릭터"><span class="hw-mini-ring"></span><b>${doneCount}</b>/${states.length}</span>
        ${task.custom
          ? `<button type="button" class="hw-mini is-danger" data-delete-task="${task.key}">숙제 지우기</button>`
          : membersReady ? `<button type="button" class="hw-mini" data-hide-task="${escapeHtml(task.key)}">숨기기</button>` : ""}
        ${blocked || (!task.boss && !membersReady) ? "" : `<button type="button" class="hw-plus${isManaging ? " is-on" : ""}" data-manage="${escapeHtml(task.key)}" aria-pressed="${isManaging}" aria-label="${escapeHtml(task.name)} ${isManaging ? "캐릭터 고르기 끝내기" : "표시할 캐릭터 고르기"}" title="${isManaging ? "다 골랐어요" : "표시할 캐릭터 넣기·빼기"}">${isManaging ? "✓" : "+"}</button>`}
      </header>
      ${body}
    </section>`;
  }

  function paintTabs() {
    root.querySelector("[data-tabs]").innerHTML = TABS.map((item) => `<button type="button" class="hw-tab${tab === item.id ? " is-on" : ""}" role="tab" aria-selected="${tab === item.id}" data-tab="${item.id}">${item.label}</button>`).join("");
  }

  function paintCards() {
    const now = Date.now();
    paintTabs();
    const list = visibleTasks().filter((task) => tab === "all" || task.kind === tab);
    paintHidden();
    let total = 0;
    let done = 0;
    for (const task of list) {
      if (task.needsTable && !ready) continue;
      for (const character of characters) {
        if (!isEligible(task, character)) continue;
        total += 1;
        if (stateOf(task, character, now).done) done += 1;
      }
    }
    root.querySelector("[data-total]").innerHTML = `전체 <strong>${done}</strong> / ${total}`;
    root.querySelector("[data-add-open]").disabled = !ready;
    cardsBox.innerHTML = list.length ? list.map((task, index) => taskCard(task, now, index)).join("") : `<p class="hw-muted">이 초기화 방식의 숙제가 없어요.</p>`;
    // 등장 연출은 처음 한 번만(다시 그릴 때 깜빡이지 않게).
    if (painted) root.querySelector(".hw-page").classList.add("is-settled");
    painted = true;
  }

  function paintHidden() {
    const box = root.querySelector("[data-hidden-list]");
    const hidden = allTasks().filter((task) => hiddenTasks.has(task.key));
    box.hidden = !hidden.length;
    box.innerHTML = hidden.length
      ? `<span>숨긴 숙제</span>${hidden.map((task) => `<button type="button" class="hw-mini" data-show-task="${escapeHtml(task.key)}">${escapeHtml(task.name)} 다시 보이기</button>`).join("")}`
      : "";
  }

  // ── 시계: 처음 한 번 틀을 만들고 매초 글자와 막대만 바꾼다 ─────────────

  function buildClocks() {
    root.querySelector("[data-clocks]").innerHTML = [
      ["day", "매일 00시 초기화까지"],
      ["boss", "다음 24시간 숙제"],
      ["week", "다음 7일 숙제"],
    ]
      .map(([tone, label], index) => `<div class="hw-clock is-${tone}" data-clock="${tone}" style="--i:${index}">
        <span>${label}</span>
        <strong data-clock-value>-</strong>
        <span class="hw-clock-who"><span class="hw-clock-face" data-clock-face hidden></span><small data-clock-sub></small></span>
        <i><b data-clock-bar></b></i>
      </div>`)
      .join("");
  }

  function setClock(tone, value, sub, ratio, character = null) {
    const box = root.querySelector(`[data-clock="${tone}"]`);
    if (!box) return;
    // 얼굴은 캐릭터가 바뀔 때만 다시 넣는다(매초 그리지 않게).
    const faceBox = box.querySelector("[data-clock-face]");
    const faceKey = character ? `${character.id}:${character.face_url || ""}` : "";
    if (faceBox.dataset.key !== faceKey) {
      faceBox.dataset.key = faceKey;
      faceBox.hidden = !character;
      faceBox.innerHTML = character ? face(character) : "";
    }
    const valueNode = box.querySelector("[data-clock-value]");
    const subNode = box.querySelector("[data-clock-sub]");
    if (valueNode.textContent !== value) valueNode.textContent = value;
    if (subNode.textContent !== sub) subNode.textContent = sub;
    box.querySelector("[data-clock-bar]").style.width = `${Math.max(0, Math.min(100, ratio * 100))}%`;
  }

  function paintClocks() {
    const now = Date.now();
    const soonest = (kind) => {
      let best = null;
      let open = 0;
      for (const task of visibleTasks().filter((item) => item.kind === kind && !(item.needsTable && !ready))) {
        for (const character of characters) {
          if (!isEligible(task, character)) continue;
          const state = stateOf(task, character, now);
          if (!state.done) open += 1;
          else if (!best || state.next < best.next) best = { next: state.next, task, character };
        }
      }
      return { best, open };
    };
    const midnight = nextMidnight(now);
    setClock("day", clockRemain(midnight - now), "무릉도장 · 매일 숙제", (midnight - now) / 86_400_000);
    for (const [tone, kind, period] of [["boss", "after24h", 86_400_000], ["week", "after7d", 7 * 86_400_000]]) {
      const info = soonest(kind);
      if (!info.best) setClock(tone, info.open ? "지금 가능" : "—", info.open ? `할 수 있는 캐릭터 ${info.open}` : "해당 숙제가 없어요", info.open ? 1 : 0);
      else setClock(tone, clockRemain(info.best.next - now), `${info.best.character.name} · ${info.best.task.name} · ${availableLabel(info.best.next, now)} 가능${info.open ? ` · 지금 가능 ${info.open}` : ""}`, (info.best.next - now) / period, info.best.character);
    }
  }

  // 남은 시간 글자만 고친다. 초기화 시각이 지난 칸이 있으면 카드를 다시 그린다.
  function refreshRemains() {
    const now = Date.now();
    let expired = false;
    for (const node of cardsBox.querySelectorAll("[data-remain]")) {
      const next = Number(node.dataset.remain);
      if (!next) continue;
      if (next <= now) {
        expired = true;
        break;
      }
      node.textContent = shortRemain(next - now);
    }
    if (expired) paintCards();
  }

  // ── 불러오기 ──────────────────────────────────────────────

  async function load() {
    const current = ++loadId;
    const supabase = await getSupabase();
    let characterResult = await supabase.from("characters").select(`${BASE_COLUMNS}, face_path`);
    if (characterResult.error && missingFaceColumn(characterResult.error)) characterResult = await supabase.from("characters").select(BASE_COLUMNS);
    const [taskResult, checkResult, memberResult, prefResult, dojoResult, recordResult, auth] = await Promise.all([
      supabase.from("homework_tasks").select("id, name, reset_kind, sort_order, created_at").order("sort_order").order("created_at"),
      supabase.from("homework_checks").select("character_id, task_key, checked_at"),
      supabase.from("homework_members").select("character_id, task_key"),
      supabase.from("homework_prefs").select("hidden_tasks").maybeSingle(),
      supabase.from("dojo_score_log").select("id, character_id, total, kind, recorded_at").order("recorded_at"),
      supabase.from("dojo_records").select("id, character_id, score, updated_at"),
      supabase.auth.getUser(),
    ]);
    if (current !== loadId || !root.isConnected) return;
    if (characterResult.error) {
      notify(translateDbError(characterResult.error), "error");
      cardsBox.innerHTML = "";
      return;
    }
    const rows = characterResult.data ?? [];
    await attachFaceUrls(supabase, rows);
    if (current !== loadId || !root.isConnected) return;
    characters = rows;
    const missing = tableMissing(taskResult.error) || tableMissing(checkResult.error);
    ready = !missing;
    const notice = root.querySelector("[data-notice]");
    notice.hidden = ready;
    notice.textContent = ready ? "" : "무릉도장과 직접 추가한 숙제를 저장하려면 Supabase에서 sql/030_homework.sql을 실행해 주세요. 지금은 보스 숙제만 쓸 수 있어요.";
    if (!missing && (taskResult.error || checkResult.error)) notify(translateDbError(taskResult.error || checkResult.error), "error");
    tasks = taskResult.error ? [] : (taskResult.data ?? []);
    userId = auth?.data?.user?.id || "";
    const membersMissing = tableMissing(memberResult.error, /homework_members/i) || tableMissing(prefResult.error, /homework_prefs/i);
    membersReady = ready && !membersMissing;
    if (!membersMissing && (memberResult.error || prefResult.error)) notify(translateDbError(memberResult.error || prefResult.error), "error");
    members = new Set((memberResult.error ? [] : (memberResult.data ?? [])).map((row) => `${row.character_id}:${row.task_key}`));
    hiddenTasks = new Set(prefResult.error ? [] : (prefResult.data?.hidden_tasks ?? []));
    dojoReady = ready && !tableMissing(dojoResult.error, /dojo_score_log/i);
    if (dojoReady && dojoResult.error) notify(translateDbError(dojoResult.error), "error");
    dojoLog = new Map();
    for (const row of dojoResult.error ? [] : (dojoResult.data ?? [])) {
      if (!dojoLog.has(row.character_id)) dojoLog.set(row.character_id, []);
      dojoLog.get(row.character_id).push(row);
    }
    // 무릉 화면의 수련 점수(dojo_records.score)도 통합 점수다. 기록보다 나중에 저장됐고 값이 다르면 그 점수를 마지막 기록으로 본다
    // (기록 표가 생기기 전에 무릉 화면에서 저장한 점수까지 보이게).
    recordRows = new Map();
    for (const row of recordResult.error ? [] : (recordResult.data ?? [])) {
      if (!row.character_id) continue;
      if (!recordRows.has(row.character_id)) recordRows.set(row.character_id, []);
      recordRows.get(row.character_id).push({ id: row.id, score: row.score, updated_at: row.updated_at });
    }
    if (dojoReady) {
      const latestRecord = new Map();
      for (const row of recordResult.error ? [] : (recordResult.data ?? [])) {
        if (row.score == null || !row.character_id) continue;
        const prev = latestRecord.get(row.character_id);
        if (!prev || new Date(row.updated_at) > new Date(prev.updated_at)) latestRecord.set(row.character_id, row);
      }
      for (const [characterId, record] of latestRecord) {
        const list = dojoLog.get(characterId) ?? [];
        const last = list[list.length - 1];
        const newer = !last || new Date(record.updated_at) > new Date(last.recorded_at);
        if (newer && (!last || Number(last.total) !== Number(record.score))) {
          list.push({ id: `record-${characterId}`, character_id: characterId, total: Number(record.score), kind: "set", recorded_at: record.updated_at, fromRecord: true });
          dojoLog.set(characterId, list);
        }
      }
    }
    if (ready && membersMissing) {
      notice.hidden = false;
      notice.textContent = "숙제마다 표시할 캐릭터를 고르거나 숙제를 숨기려면 Supabase에서 sql/031_homework_members.sql을 실행해 주세요. 지금은 무릉도장·직접 추가한 숙제에 모든 캐릭터가 보여요.";
    }
    checks = new Map((checkResult.error ? [] : (checkResult.data ?? [])).map((row) => [`${row.character_id}:${row.task_key}`, row.checked_at]));
    paintCards();
    paintClocks();
  }

  // ── 기록 쓰기 ─────────────────────────────────────────────

  async function persist(task, character, value) {
    const supabase = await getSupabase();
    if (task.boss) return supabase.from("characters").update({ [task.boss.columnAt]: value }).eq("id", character.id);
    if (value == null) return supabase.from("homework_checks").delete().eq("character_id", character.id).eq("task_key", task.key);
    return supabase.from("homework_checks").upsert({ character_id: character.id, task_key: task.key, checked_at: value }, { onConflict: "character_id,task_key" });
  }

  function writeLocal(task, character, value) {
    if (task.boss) character[task.boss.columnAt] = value;
    else if (value == null) checks.delete(`${character.id}:${task.key}`);
    else checks.set(`${character.id}:${task.key}`, value);
  }

  /** 끝낸 시각을 value(ISO 또는 null)로 바꾼다. 실패하면 되돌린다. */
  async function commit(task, character, value, { undoable = true, target = null } = {}) {
    const key = `${character.id}:${task.key}`;
    const previous = checkedAt(task, character);
    const generation = ++undoEpoch;
    if (undoable) undoSlots.set(key, { previous, generation });
    writeLocal(task, character, value);
    paintCards();
    paintClocks();
    const now = Date.now();
    const doneNow = homeworkState(task.kind, value, now).done;
    if (doneNow) {
      sfx("check");
      const cell = cardsBox.querySelector(`[data-check="${CSS.escape(task.key)}"][data-character="${character.id}"]`) ?? cardsBox.querySelector(`[data-task-card="${CSS.escape(task.key)}"]`) ?? target;
      burstAt(cell, task.boss ? BOSS_BURST[task.key] : BURST_COLORS.success, task.boss ? 26 : 18, task.boss ? 1.1 : 0.9);
    } else sfx("uncheck");
    if (undoable && value != null) {
      notify(`${character.name} · ${task.name}: ${formatStamp(new Date(value))}에 끝낸 것으로 기록했습니다.`, "info", { label: "취소", onClick: () => undo(task.key, character.id) });
    }
    const { error } = await persist(task, character, value);
    if (!root.isConnected) return;
    if (error) {
      if (undoSlots.get(key)?.generation === generation) undoSlots.delete(key);
      writeLocal(task, character, previous);
      paintCards();
      paintClocks();
      notify(translateDbError(error), "error");
      return;
    }
    if (doneNow) cheerIfComplete(character);
  }

  async function undo(taskKey, characterId) {
    const task = allTasks().find((item) => item.key === taskKey);
    const character = characters.find((item) => item.id === characterId);
    const slot = undoSlots.get(`${characterId}:${taskKey}`);
    if (!task || !character || !slot) return;
    undoSlots.delete(`${characterId}:${taskKey}`);
    await commit(task, character, slot.previous, { undoable: false });
    notify(`${character.name} · ${task.name}: ${slot.previous ? formatStamp(new Date(slot.previous)) : "기록 없음"}(으)로 되돌렸습니다.`, "info");
  }

  async function toggle(task, character, button) {
    const now = Date.now();
    const state = stateOf(task, character, now);
    if (!state.done) {
      await commit(task, character, new Date(now).toISOString(), { target: button });
      return;
    }
    const key = `${character.id}:${task.key}`;
    if (undoSlots.has(key)) {
      await undo(task.key, character.id);
      return;
    }
    if (!window.confirm(`${character.name}의 ${task.name} 기록을 지울까요? 지우면 바로 다시 할 수 있는 상태가 돼요.`)) return;
    await commit(task, character, null, { undoable: false });
  }

  function cheerIfComplete(character) {
    const now = Date.now();
    const list = visibleTasks().filter((task) => isEligible(task, character) && !(task.needsTable && !ready));
    if (!list.length || list.some((task) => !stateOf(task, character, now).done)) return;
    const key = `${character.id}:${new Date(now).toDateString()}`;
    if (celebrated.has(key)) return;
    celebrated.add(key);
    setTimeout(() => {
      sfx("fanfare");
      celebrate(`${character.name} 완료!`, "지금 할 수 있는 숙제를 모두 끝냈어요");
    }, 220);
  }

  function openTime(task, character) {
    timeDialog.dataset.task = task.key;
    timeDialog.dataset.character = character.id;
    root.querySelector("[data-time-title]").textContent = `${character.name} · ${task.name}`;
    const parts = bossTimeParts(checkedAt(task, character) || Date.now());
    for (const name of ["year", "month", "day", "hour", "minute"]) timeForm.elements[name].value = parts[name];
    if (!timeDialog.open) timeDialog.showModal();
    timeForm.elements.year.focus();
    timeForm.elements.year.select();
  }

  async function setEnabled(task, character, input) {
    const on = input.checked;
    const key = `${character.id}:${task.key}`;
    const write = (value) => {
      if (task.boss) character[task.boss.columnEnabled] = value;
      else if (value) members.add(key);
      else members.delete(key);
    };
    write(on);
    sfx(on ? "check" : "uncheck");
    const supabase = await getSupabase();
    const { error } = task.boss
      ? await supabase.from("characters").update({ [task.boss.columnEnabled]: on }).eq("id", character.id)
      : on
        ? await supabase.from("homework_members").upsert({ character_id: character.id, task_key: task.key }, { onConflict: "character_id,task_key" })
        : await supabase.from("homework_members").delete().eq("character_id", character.id).eq("task_key", task.key);
    if (!root.isConnected) return;
    if (error) {
      write(!on);
      input.checked = !on;
      notify(translateDbError(error), "error");
      return;
    }
    paintClocks();
    const note = input.closest(".hw-tcell")?.querySelector("small");
    if (note) note.textContent = on ? "표시" : "숨김";
    // 고르는 중에는 표를 다시 그리지 않고, 카드 머리 숫자만 맞춘다.
    const card = cardsBox.querySelector(`[data-task-card="${CSS.escape(task.key)}"] .hw-card-count`);
    if (card) {
      const people = characters.filter((item) => isEligible(task, item));
      const done = people.filter((item) => stateOf(task, item, Date.now()).done).length;
      card.innerHTML = `<span class="hw-mini-ring"></span><b>${done}</b>/${people.length}`;
    }
  }

  // ── 무릉 점수 ─────────────────────────────────────────────

  // 통합 점수 기록 한 줄을 남긴다. 성공하면 새 기록, 실패하면 null.
  async function logDojo(characterId, total, kind) {
    const supabase = await getSupabase();
    // 무릉 화면 수련 점수에서 읽어 온 기준(아직 기록 표에 없는 값)은 먼저 기록 표에 남긴다.
    // 그러지 않으면 새 점수로 수련 점수가 덮여서, 새로 고침하면 어제 기준이 사라진다.
    for (const entry of (dojoLog.get(characterId) ?? []).filter((item) => item.fromRecord)) {
      const saved = await supabase
        .from("dojo_score_log")
        .insert({ character_id: characterId, total: Number(entry.total), kind: "set", recorded_at: entry.recorded_at })
        .select("id")
        .single();
      if (!root.isConnected) return null;
      if (saved.error) {
        notify(translateDbError(saved.error), "error");
        return null;
      }
      entry.id = saved.data?.id ?? entry.id;
      entry.fromRecord = false;
    }
    const { data, error } = await supabase
      .from("dojo_score_log")
      .insert({ character_id: characterId, total, kind, recorded_at: new Date().toISOString() })
      .select("id, character_id, total, kind, recorded_at")
      .single();
    if (!root.isConnected) return null;
    if (error) {
      const needsClearSql = kind === "clear" && /kind_check|23514/i.test(`${error.message} ${error.code}`);
      notify(needsClearSql ? "오늘 초기화를 쓰려면 Supabase에서 sql/034_dojo_score_clear.sql을 실행해 주세요." : translateDbError(error), "error");
      return null;
    }
    const row = { character_id: characterId, total, kind, recorded_at: new Date().toISOString(), ...(data ?? {}), id: data?.id ?? `local-${Date.now()}` };
    if (!dojoLog.has(characterId)) dojoLog.set(characterId, []);
    dojoLog.get(characterId).push(row);
    dojoUndo.set(characterId, { id: row.id, records: [] });
    return row;
  }

  // 무릉 화면의 수련 점수(dojo_records.score)를 같은 값으로 맞춘다(그 캐릭터의 개인·팀 기록이 있으면).
  // 바꾸기 전 점수는 되돌리기 칸(dojoUndo)에 남긴다.
  async function syncRecordScore(characterId, total) {
    if (total == null) return;
    const rows = recordRows.get(characterId) ?? [];
    if (!rows.length) return;
    const before = rows.map((row) => ({ id: row.id, score: row.score }));
    const supabase = await getSupabase();
    const { error } = await supabase.from("dojo_records").update({ score: total }).eq("character_id", characterId);
    if (!root.isConnected) return;
    if (error) {
      notify(translateDbError(error), "error");
      return;
    }
    for (const row of rows) row.score = total;
    const slot = dojoUndo.get(characterId);
    if (slot) slot.records = before;
  }

  async function addPoints(characterId) {
    const input = cardsBox.querySelector(`[data-dojo-input="${characterId}"]`);
    const character = characters.find((item) => item.id === characterId);
    const text = String(input?.value ?? "").replaceAll(",", "").trim();
    if (!/^\d+$/.test(text)) {
      notify("게임에 보이는 현재 통합 점수를 숫자로 적어 주세요.", "error");
      input?.focus();
      return;
    }
    const total = Number(text);
    const now = Date.now();
    const before = dojoProgress(dojoLog.get(characterId), now);
    const button = cardsBox.querySelector(`[data-dojo-add="${characterId}"]`);
    if (button) button.disabled = true;
    const row = await logDojo(characterId, total, "set");
    if (button) button.disabled = false;
    if (!row || !character) return;
    await syncRecordScore(characterId, total);
    const after = dojoProgress(dojoLog.get(characterId), now);
    sfx("mid");
    paintCards();
    paintClocks();
    burstAt(cardsBox.querySelector(`[data-dojo-add="${characterId}"]`), ["#ffb08a", "#ffe28a", "#ffffff"], 16, 0.8);
    const todayText = after.partial && before.total == null ? "어제 기록이 없어 오늘 점수는 다음 기록부터 셉니다" : `오늘 ${formatCount(after.today ?? 0)}/${formatCount(DOJO_DAILY_GOAL)}점`;
    notify(`${character.name} 통합 점수 ${formatCount(total)}점 기록 · ${todayText}`, "info", { label: "취소", onClick: () => undoPoints(characterId) });
    // 오늘 3,500점을 넘긴 순간 무릉 숙제를 끝낸 것으로 기록한다.
    const dojo = allTasks().find((task) => task.key === "dojo");
    if ((before.today ?? 0) < DOJO_DAILY_GOAL && (after.today ?? 0) >= DOJO_DAILY_GOAL && dojo && !homeworkState("daily", checkedAt(dojo, character), now).done) {
      await commit(dojo, character, new Date(now).toISOString(), { undoable: false });
      sfx("fanfare");
      celebrate("무릉 완료!", `${character.name} · 오늘 ${formatCount(after.today)}점`);
    }
    if (total >= DOJO_RESET_POINTS && (before.total ?? 0) < DOJO_RESET_POINTS) {
      notify(`${character.name} 통합 점수가 ${formatCount(DOJO_RESET_POINTS)}점을 넘었어요. 원할 때 "${formatCount(DOJO_RESET_POINTS)} 초기화"를 눌러 주세요.`, "info");
    }
  }

  async function resetPoints(characterId) {
    const character = characters.find((item) => item.id === characterId);
    const total = dojoProgress(dojoLog.get(characterId), Date.now()).total;
    if (total == null) return;
    const after = resetDojoTotal(total);
    if (!window.confirm(`${character?.name ?? "이 캐릭터"}의 통합 점수에서 ${formatCount(DOJO_RESET_POINTS)}점을 뺄까요? ${formatCount(total)}점 → ${formatCount(after)}점`)) return;
    const row = await logDojo(characterId, after, "reset");
    if (!row) return;
    await syncRecordScore(characterId, after);
    sfx("uncheck");
    paintCards();
    paintClocks();
    notify(`통합 점수를 ${formatCount(after)}점으로 초기화했습니다.`, "info", { label: "취소", onClick: () => undoPoints(characterId) });
  }

  // 오늘 초기화: 오늘 쌓은 점수(3,500점 중)만 0으로 되돌린다. 통합 점수는 그대로이고, 그 뒤 오른 점수부터 다시 센다.
  // 점수로 끝낸 오늘 무릉 체크도 푼다.
  async function clearToday(characterId) {
    const character = characters.find((item) => item.id === characterId);
    const now = Date.now();
    const progress = dojoProgress(dojoLog.get(characterId), now);
    if (!character || progress.total == null || !(progress.today > 0)) return;
    if (!window.confirm(`${character.name}의 오늘 점수 ${formatCount(progress.today)}점을 0으로 초기화할까요? 통합 점수 ${formatCount(progress.total)}점은 그대로입니다.`)) return;
    const row = await logDojo(characterId, progress.total, "clear");
    if (!row) return;
    const dojo = allTasks().find((task) => task.key === "dojo");
    if (dojo && homeworkState("daily", checkedAt(dojo, character), now).done) await commit(dojo, character, null, { undoable: false });
    else {
      sfx("uncheck");
      paintCards();
      paintClocks();
    }
    notify(`${character.name} 오늘 점수를 0으로 초기화했습니다.`, "info", { label: "취소", onClick: () => undoPoints(characterId) });
  }

  async function undoPoints(characterId) {
    const slot = dojoUndo.get(characterId);
    if (!slot) return;
    const { id } = slot;
    dojoUndo.delete(characterId);
    const list = dojoLog.get(characterId) ?? [];
    const index = list.findIndex((row) => row.id === id);
    const removed = index >= 0 ? list.splice(index, 1)[0] : null;
    paintCards();
    paintClocks();
    sfx("tick");
    if (String(id).startsWith("local-")) return;
    const supabase = await getSupabase();
    const { error } = await supabase.from("dojo_score_log").delete().eq("id", id);
    if (!root.isConnected) return;
    if (error) {
      if (removed) list.splice(index, 0, removed);
      paintCards();
      notify(translateDbError(error), "error");
      return;
    }
    // 무릉 화면 점수도 바꾸기 전 값으로 되돌린다(다시 불러올 때 지운 점수가 돌아오지 않게).
    for (const before of slot.records) {
      const restored = await supabase.from("dojo_records").update({ score: before.score }).eq("id", before.id);
      if (!root.isConnected) return;
      if (restored.error) {
        notify(translateDbError(restored.error), "error");
        return;
      }
      const row = (recordRows.get(characterId) ?? []).find((item) => item.id === before.id);
      if (row) row.score = before.score;
    }
  }

  async function setHidden(taskKey, hide) {
    const previous = new Set(hiddenTasks);
    if (hide) hiddenTasks.add(taskKey);
    else hiddenTasks.delete(taskKey);
    managing.delete(taskKey);
    sfx(hide ? "uncheck" : "check");
    paintCards();
    paintClocks();
    const supabase = await getSupabase();
    const { error } = await supabase
      .from("homework_prefs")
      .upsert({ user_id: userId, hidden_tasks: [...hiddenTasks], updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (!root.isConnected) return;
    if (error) {
      hiddenTasks = previous;
      paintCards();
      paintClocks();
      notify(translateDbError(error), "error");
    }
  }

  // ── 이벤트 ────────────────────────────────────────────────

  root.addEventListener("click", async (event) => {
    const tabButton = event.target.closest("[data-tab]");
    if (tabButton) {
      tab = tabButton.dataset.tab;
      sfx("tick");
      paintCards();
      return;
    }
    const checkButton = event.target.closest("[data-check]");
    if (checkButton) {
      const task = allTasks().find((item) => item.key === checkButton.dataset.check);
      const character = characters.find((item) => item.id === checkButton.dataset.character);
      if (task && character) await toggle(task, character, checkButton);
      return;
    }
    const dojoAdd = event.target.closest("[data-dojo-add]");
    if (dojoAdd) {
      await addPoints(dojoAdd.dataset.dojoAdd);
      return;
    }
    const dojoReset = event.target.closest("[data-dojo-reset]");
    if (dojoReset) {
      await resetPoints(dojoReset.dataset.dojoReset);
      return;
    }
    const dojoClear = event.target.closest("[data-dojo-clear]");
    if (dojoClear) {
      await clearToday(dojoClear.dataset.dojoClear);
      return;
    }
    const dojoUndoButton = event.target.closest("[data-dojo-undo]");
    if (dojoUndoButton) {
      await undoPoints(dojoUndoButton.dataset.dojoUndo);
      return;
    }
    const undoButton = event.target.closest("[data-undo]");
    if (undoButton) {
      await undo(undoButton.dataset.undo, undoButton.dataset.character);
      return;
    }
    const timeButton = event.target.closest("[data-set-time]");
    if (timeButton) {
      const task = allTasks().find((item) => item.key === timeButton.dataset.setTime);
      const character = characters.find((item) => item.id === timeButton.dataset.character);
      if (task && character) openTime(task, character);
      return;
    }
    if (event.target.closest("[data-time-close]")) {
      timeDialog.close();
      return;
    }
    if (event.target === timeDialog) {
      timeDialog.close();
      return;
    }
    const manage = event.target.closest("[data-manage]");
    if (manage) {
      const key = manage.dataset.manage;
      if (managing.has(key)) managing.delete(key);
      else managing.add(key);
      sfx("tick");
      paintCards();
      return;
    }
    const hideButton = event.target.closest("[data-hide-task]");
    if (hideButton) {
      const task = allTasks().find((item) => item.key === hideButton.dataset.hideTask);
      if (task && window.confirm(`"${task.name}" 숙제 카드를 숨길까요? 기록은 그대로 두고, 위의 "다시 보이기"로 되돌릴 수 있어요.`)) await setHidden(task.key, true);
      return;
    }
    const showButton = event.target.closest("[data-show-task]");
    if (showButton) {
      await setHidden(showButton.dataset.showTask, false);
      return;
    }
    if (event.target.closest("[data-add-open]")) {
      addForm.hidden = !addForm.hidden;
      sfx("tick");
      if (!addForm.hidden) addForm.elements.name.focus();
      return;
    }
    const deleteButton = event.target.closest("[data-delete-task]");
    if (deleteButton) {
      const task = tasks.find((item) => item.id === deleteButton.dataset.deleteTask);
      if (!task || !window.confirm(`"${task.name}" 숙제를 지울까요? 체크 기록도 함께 지워져요.`)) return;
      const supabase = await getSupabase();
      // 체크 기록은 task_key 로만 이어져 있어 함께 지운다.
      const removed = await supabase.from("homework_checks").delete().eq("task_key", task.id);
      if (removed.error) {
        notify(translateDbError(removed.error), "error");
        return;
      }
      if (membersReady) {
        const unlinked = await supabase.from("homework_members").delete().eq("task_key", task.id);
        if (unlinked.error) {
          notify(translateDbError(unlinked.error), "error");
          return;
        }
      }
      const { error } = await supabase.from("homework_tasks").delete().eq("id", task.id);
      if (!root.isConnected) return;
      if (error) {
        notify(translateDbError(error), "error");
        return;
      }
      sfx("fail");
      notify("숙제를 지웠습니다.", "info");
      await load();
    }
  });

  root.addEventListener("change", async (event) => {
    if (event.target === readyToggle || event.target === soonToggle) {
      writeFlag(event.target === readyToggle ? READY_ONLY_KEY : SOON_KEY, event.target.checked);
      sfx(event.target.checked ? "check" : "uncheck");
      paintCards();
      return;
    }
    const enable = event.target.closest("[data-enable]");
    if (enable) {
      const task = allTasks().find((item) => item.key === enable.dataset.enable);
      const character = characters.find((item) => item.id === enable.dataset.character);
      if (task && character) await setEnabled(task, character, enable);
    }
  });

  root.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    const input = event.target.closest("[data-dojo-input]");
    if (!input) return;
    event.preventDefault();
    await addPoints(input.dataset.dojoInput);
  });

  timeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const task = allTasks().find((item) => item.key === timeDialog.dataset.task);
    const character = characters.find((item) => item.id === timeDialog.dataset.character);
    if (!task || !character) return;
    const parsed = readBossTime(Object.fromEntries(["year", "month", "day", "hour", "minute"].map((name) => [name, timeForm.elements[name].value])));
    if (parsed.error) {
      notify(parsed.error, "error");
      return;
    }
    if (parsed.value > Date.now() + 1000) {
      notify("아직 지나지 않은 시각은 기록할 수 없습니다.", "error");
      return;
    }
    const previous = checkedAt(task, character);
    if (previous && Math.floor(new Date(previous).getTime() / 60000) === Math.floor(parsed.value / 60000)) {
      timeDialog.close();
      notify("이미 그 시각으로 기록되어 있습니다.", "info");
      return;
    }
    timeDialog.close();
    await commit(task, character, new Date(parsed.value).toISOString());
  });

  addForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = addForm.elements.name.value.trim();
    const kind = addForm.elements.reset_kind.value;
    if (!name) {
      notify("숙제 이름을 적어 주세요.", "error");
      addForm.elements.name.focus();
      return;
    }
    if (!RESET_KINDS[kind]) return;
    const button = addForm.querySelector("[type=submit]");
    button.disabled = true;
    const supabase = await getSupabase();
    const { data: created, error } = await supabase.from("homework_tasks").insert({ name, reset_kind: kind, sort_order: tasks.length }).select("id").single();
    if (!root.isConnected) return;
    button.disabled = false;
    if (error) {
      notify(translateDbError(error), "error");
      return;
    }
    // 새 숙제는 처음에 모든 캐릭터를 보여 준다. 필요 없는 캐릭터는 + 로 뺀다.
    if (membersReady && created?.id && characters.length) {
      const linked = await supabase.from("homework_members").insert(characters.map((character) => ({ character_id: character.id, task_key: String(created.id) })));
      if (linked.error) notify(translateDbError(linked.error), "error");
    }
    sfx("check");
    burstAt(button, BURST_COLORS.success, 18, 0.9);
    addForm.reset();
    addForm.hidden = true;
    await load();
  });

  // 시계는 1초마다 글자만, 남은 시간은 30초마다 글자만 고친다(다시 그리지 않음).
  let ticks = 0;
  const timer = setInterval(() => {
    if (!root.isConnected) {
      clearInterval(timer);
      return;
    }
    ticks += 1;
    paintClocks();
    if (ticks % 30 === 0) refreshRemains();
  }, 1000);

  buildClocks();
  paintTabs();
  await load();
}
