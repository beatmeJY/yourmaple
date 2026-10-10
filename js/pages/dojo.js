import { attachFaceUrls, faceMarkup, missingFaceColumn } from "../character-face.js";
import { translateDbError } from "../db-error.js";
import { burstAt, sfx } from "../effects.js";
import {
  BANDS,
  BELTS,
  DAILY_CAP,
  GOAL_SCORE,
  SAVE_FLOORS,
  SAVE_SECONDS,
  bandPoints,
  beltById,
  calendarDays,
  playSeconds,
  chainPoints,
  chainText,
  compareRoutes,
  compareSaves,
  floorPoints,
  formatDuration,
  formatPerMinute,
  formatPointsPerSecond,
  formatSecondsPerPoint,
  measuredRoutes,
  parseFloors,
  quoteBlackBelt,
  readRuns,
  chainKey,
  saveFloorToFloor,
  spanParts,
  spanText,
} from "../dojo-calc.js";
import { escapeHtml, formatCount, readBig, readCount, sortByName } from "../format.js";
import { getSupabase } from "../supabase-client.js";
import { notify } from "../toast.js";

const recordColumns = "id, character_id, character_name, party, floors, score, runs, memo, created_at, updated_at";

function formatWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const BELT_ICONS = {
  white: "img/dojo-belt-white.png",
  yellow: "img/dojo-belt-yellow.png",
  blue: "img/dojo-belt-blue.png",
  red: "img/dojo-belt-red.png",
  black: "img/dojo-belt-black.png",
};

/** 상세 옵션 호버 이미지 */
const BELT_DETAILS = {
  white: "img/dojo-belt-white-detail.png",
  yellow: "img/dojo-belt-yellow-detail.png",
  blue: "img/dojo-belt-blue-detail.png",
  red: "img/dojo-belt-red-detail.png",
  black: "img/dojo-belt-black-detail.png",
};

function beltName(id) {
  return beltById(id)?.name ?? id;
}

function beltLabel(belt) {
  const icon = BELT_ICONS[belt.id] || "";
  const detail = BELT_DETAILS[belt.id] || "";
  const iconHtml = icon
    ? `<span class="dojo-belt-icon${detail ? " has-detail" : ""}"${detail ? ` tabindex="0" data-belt-detail="${escapeHtml(detail)}" aria-label="${escapeHtml(belt.name)} 상세 옵션"` : ""}><img src="${escapeHtml(icon)}" alt="" width="36" height="36" decoding="async" /></span>`
    : `<span class="dojo-swatch is-${escapeHtml(belt.id)}"></span>`;
  return `<span class="dojo-belt">${iconHtml}<span class="dojo-belt-copy"><span class="dojo-belt-name">${escapeHtml(belt.name)}</span><span class="hint">${escapeHtml(formatCount(belt.score))}점</span></span></span>`;
}

const BAND_BOSS_NOTES = {
  6: "10층 타이머 스턴 유의",
  11: "12층 파파픽시 실명, 스킬잠금 유의",
  16: "19층 구미호 실명 / 21층 포이즌골렘 스킬잠금, 실명, 키반대 유의",
  21: "26층 프랑켄로이드 실명, 스킬잠금 유의 / 29층 스노우맨 스턴 유의",
};

function floorsTable() {
  return BANDS.map((band) => {
    const label = spanText(band.start, band.end);
    const { floorLabel, roundLabel } = spanParts(band.start, band.end);
    const saveTitle = SAVE_FLOORS.includes(band.end) ? ` title="${saveFloorToFloor(band.end)}층(쉬는 층)에서 저장"` : "";
    const bossNote = BAND_BOSS_NOTES[band.start];
    const bossTip = bossNote
      ? `<div class="dojo-band-boss-tip" data-band-boss hidden role="status">${escapeHtml(bossNote)}</div>`
      : "";
    return `<div class="dojo-band" data-band-row="${band.start}"${saveTitle}>
      ${bossTip}
      <div class="dojo-band-info">
        <span class="dojo-band-floor">${floorLabel}</span>
        <span class="dojo-band-round">(${roundLabel})</span>
        <span class="dojo-band-points" data-band-points="${band.start}"></span>
      </div>
      <div class="dj-band-meter">
        <span class="dj-band-bar" aria-hidden="true"><i data-band-bar="${band.start}"></i></span>
        <span class="dojo-band-rate" data-band-rate="${band.start}" hidden></span>
      </div>
      <div class="dojo-band-controls">
        <span class="dj-band-stepper">
          <button class="dj-step" type="button" data-band-step="${band.start}" data-step="-1" aria-label="${label} 1초 줄이기">−</button>
          <label class="dojo-band-time">
            <input name="band_${band.start}" inputmode="numeric" autocomplete="off" aria-label="${label} 초" placeholder="0" />
            <span>초</span>
          </label>
          <button class="dj-step" type="button" data-band-step="${band.start}" data-step="1" aria-label="${label} 1초 늘리기">+</button>
        </span>
        <span class="dojo-band-clock">
          <span class="dojo-band-readout" data-band-time hidden>0:00.0</span>
          <button class="dojo-band-icon-btn" type="button" data-band-start="${band.start}" aria-label="${label} 시작">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 4.6v10.8c0 .8.88 1.29 1.56.87l8.6-5.4a1 1 0 0 0 0-1.74l-8.6-5.4c-.68-.42-1.56.07-1.56.87Z" fill="currentColor"/></svg>
          </button>
          <button class="dojo-band-icon-btn is-stop" type="button" data-band-stop="${band.start}" aria-label="${label} 종료" disabled>
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5.2" y="5.2" width="9.6" height="9.6" rx="2.2" fill="currentColor"/></svg>
          </button>
          <button class="dojo-band-text-btn" type="button" data-band-apply="${band.start}" aria-label="${label} 반영">반영</button>
          <button class="dojo-band-text-btn is-cancel" type="button" data-band-cancel="${band.start}" aria-label="${label} 취소">취소</button>
        </span>
      </div>
    </div>`;
  }).join("");
}

function samePrice(left, right) {
  if (left == null || right == null) return false;
  return BigInt(left) === BigInt(right);
}

const dojoChain = `<svg viewBox="0 0 20 52" width="18" height="48" focusable="false"><g fill="none" stroke="#5c3818" stroke-width="4" stroke-linejoin="round"><rect x="4" y="0" width="12" height="22" rx="6"/><rect x="1" y="16" width="18" height="12" rx="6"/><rect x="4" y="28" width="12" height="22" rx="6"/></g><g fill="none" stroke="#f3d7a2" stroke-width="2.1" stroke-linejoin="round"><rect x="4" y="0" width="12" height="22" rx="6"/><rect x="1" y="16" width="18" height="12" rx="6"/><rect x="4" y="28" width="12" height="22" rx="6"/></g></svg>`;

export async function render(root) {
  root.innerHTML = `
    <div class="dojo-page">
    <div class="dojo-lanterns" aria-hidden="true"><i class="is-big"></i><i></i></div>
    <header class="page-header dojo-hero">
      <p class="dojo-kicker">MU LUNG</p>
      <h1>무릉도장</h1>
    </header>
    <form id="dojo-form">
      <section class="dj-panel dj-top">
        <img class="dj-roof" src="img/dojo-roof.png" alt="" />
        <div class="dj-top-row">
          <div class="dj-plaque">
            <span class="dj-plaque-title"><i aria-hidden="true">◆</i> 수련 점수 <i aria-hidden="true">◆</i></span>
            <label class="dj-plaque-score">
              <input name="score" inputmode="numeric" autocomplete="off" placeholder="0" aria-label="지금 점수" />
              <span>/ ${formatCount(GOAL_SCORE)}</span>
            </label>
            <span class="dj-plaque-who" data-who>캐릭터를 선택해 주세요</span>
          </div>
          <div class="dj-stats">
            <div class="dj-stat"><span>검은색 허리띠까지</span><strong data-stat-need>-</strong></div>
            <div class="dj-stat"><span>하루 ${formatCount(DAILY_CAP)}점 제한</span><strong data-stat-days>-</strong></div>
            <div class="dj-stat is-gold"><span data-stat-play-label>추천 루트 순수 플레이</span><strong data-stat-play>-</strong></div>
          </div>
        </div>
        <div class="dj-gauge" data-gauge>
          <div class="dj-gauge-track"><div class="dj-gauge-fill" data-gauge-fill><i></i></div></div>
          ${BELTS.map(
            (belt) => `<div class="dj-gauge-belt" data-gauge-belt="${belt.id}" style="--at:${(belt.score / GOAL_SCORE) * 100}%">
              <span class="dj-gauge-diamond"><img src="${BELT_ICONS[belt.id]}" alt="" width="30" height="30" /></span>
              <span class="dj-gauge-label">${escapeHtml(belt.name.replace(" 허리띠", ""))}</span>
            </div>`,
          ).join("")}
        </div>
      </section>

      <section class="dj-panel dj-chars">
        <div class="dj-panel-head">
          <h2><i aria-hidden="true">◆</i>캐릭터</h2>
          <p class="dojo-picked-label" data-picked-label hidden></p>
          <label class="dj-picker"><span class="sr-only">캐릭터 선택</span>
            <select name="character_id" aria-label="캐릭터 선택"><option value="">캐릭터 선택</option></select>
          </label>
        </div>
        <div data-records></div>
      </section>

      <div class="dj-grid">
        <section class="dj-panel dj-bands">
          <div class="dj-panel-head">
            <h2><i aria-hidden="true">◆</i>구간 기록</h2>
            <div class="dojo-party-toggle dj-modes" role="group" aria-label="개인 또는 팀">
              <button type="button" class="dojo-party-btn is-solo is-active" data-party-choice="solo" aria-pressed="true">개인</button>
              <button type="button" class="dojo-party-btn is-team" data-party-choice="team" aria-pressed="false">팀</button>
            </div>
            <input type="hidden" name="party" value="solo" />
          </div>
          <p class="dj-sub">구간을 한 번 깨는 데 걸린 시간(초)을 적으면 저장 루트를 다시 계산해요. ▶로 직접 잴 수도 있어요.</p>
          <div class="dojo-bands">
            ${floorsTable()}
          </div>
          <details class="dojo-note">
            <summary>계산 기준</summary>
            <p class="hint">구간 전체를 깨는 초를 적습니다. 층에는 쉬는 층도 포함되어 있어서, 5라운드를 마칠 때마다 나오는 쉬는 층(${SAVE_FLOORS.map((floor) => `${saveFloorToFloor(floor)}층`).join(", ")})에서 저장할 수 있고, 이어서 5라운드 단위로 다시 저장할 수 있습니다. 개인은 1~5층(1~5라운드)이 층마다 2점, 팀은 1점입니다. 저장 한 번에 참고 시간 ${SAVE_SECONDS}초를 더합니다. 하루 최대 ${formatCount(DAILY_CAP)}점이고, 검은 허리띠는 ${formatCount(GOAL_SCORE)}점입니다.</p>
          </details>
          <div class="dj-actions">
            <button class="primary-button dojo-game-button" type="submit" data-save>기록 저장</button>
            <button class="secondary-button" type="button" data-clear>입력 지우기</button>
          </div>
        </section>

        <section class="dj-scroll">
          <div class="dj-roller" aria-hidden="true"></div>
          <span class="dj-tassel" aria-hidden="true"></span>
          <span class="dj-tassel is-right" aria-hidden="true"></span>
          <div class="dj-scroll-cloth">
            <div class="dj-scroll-paper">
              <h2><i aria-hidden="true">◈</i>저장 루트 순위표<i aria-hidden="true">◈</i></h2>
              <span class="dj-scroll-sub">저장 조합 중 분당 점수가 높은 순</span>
              <div class="dojo-best is-empty" data-best></div>
              <div class="dj-route-list" data-route-list></div>
            </div>
          </div>
          <div class="dj-roller is-bottom" aria-hidden="true"></div>
        </section>
      </div>

      <section class="dojo-notice dj-runs">
        <div data-plan></div>
      </section>
    </form>

    <section class="dj-panel dj-belts">
      <div class="dj-panel-head">
        <h2><i aria-hidden="true">◆</i>허리띠 시세</h2>
        <span class="dj-sub">흰색부터 검은색까지 다 팔았을 때</span>
        <span class="dj-belt-sum" data-belt-sum></span>
      </div>
      <div data-belts></div>
    </section>
    <dialog class="belt-history-dialog" data-belt-history-dialog>
      <div class="belt-history-head">
        <h2 data-belt-history-title>시세 기록</h2>
        <button class="text-button" type="button" data-belt-history-close aria-label="닫기">닫기</button>
      </div>
      <div data-belt-history-body></div>
      <div class="belt-history-add" data-belt-history-add></div>
    </dialog>
    </div>
  `;

  const form = root.querySelector("#dojo-form");
  const belts = root.querySelector("[data-belts]");
  const records = root.querySelector("[data-records]");
  const plan = root.querySelector("[data-plan]");
  const beltHistoryDialog = root.querySelector("[data-belt-history-dialog]");
  let beltTip = document.getElementById("dojo-belt-tip");
  if (!beltTip) {
    beltTip = document.createElement("div");
    beltTip.id = "dojo-belt-tip";
    beltTip.className = "dojo-belt-tip";
    beltTip.hidden = true;
    beltTip.setAttribute("aria-hidden", "true");
    beltTip.innerHTML = `<img alt="" decoding="async" />`;
    document.body.appendChild(beltTip);
  }
  const beltTipImg = beltTip.querySelector("img");
  let beltTipIcon = null;
  let characters = [];
  let accounts = [];
  let draftRuns = new Map();
  let clock = null;
  let bandPending = null;
  let routePending = null;
  let clockTimer = 0;
  let clockTarget = null;
  let clockPressed = false;
  let landedKey = "";
  let arriveCard = false;
  let savedSnapshot = "";
  let runsReady = true;
  let priceRows = [];
  let recordRows = [];
  let loadId = 0;
  let saving = false;
  let bestView = "actual";
  // 지금 보여 주는 1위 루트(명패 판 정보·허리띠 시급에 같이 쓴다)
  let shownEntry = null;
  // 두루마리 위쪽 칸에 보여 줄 루트(순위 줄을 누르면 바뀜). 비어 있으면 1위.
  let viewKey = "";

  function partyOf() {
    return form.elements.party.value === "team";
  }

  function syncPartyButtons() {
    const value = form.elements.party.value;
    for (const button of form.querySelectorAll("[data-party-choice]")) {
      const on = button.dataset.partyChoice === value;
      button.classList.toggle("is-active", on);
      button.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function setParty(value) {
    if (form.elements.party.value === value) return;
    form.elements.party.value = value;
    syncPartyButtons();
    form.elements.party.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function snapshot() {
    const bands = BANDS.map((band) => form.elements[`band_${band.start}`].value.trim());
    const runs = [...draftRuns.entries()].sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
    return JSON.stringify({
      character: form.dataset.openCharacter || "",
      party: form.dataset.openParty || "solo",
      score: form.elements.score.value.trim(),
      bands,
      runs,
    });
  }

  function latestPrices() {
    const map = new Map();
    for (const row of priceRows) {
      if (!map.has(row.belt)) map.set(row.belt, row);
    }
    return map;
  }

  function priceMap() {
    const map = new Map();
    for (const [belt, row] of latestPrices()) map.set(belt, row.price);
    return map;
  }

  function floorsOf() {
    const times = new Map();
    for (const band of BANDS) {
      const label = spanText(band.start, band.end);
      const parsed = readCount(form.elements[`band_${band.start}`].value, `${label} 초`, 1);
      if (parsed.error) return parsed;
      if (parsed.value != null) {
        if (parsed.value > 86400) return { error: `${label} 초는 하루를 넘길 수 없습니다.` };
        times.set(band.start, parsed.value);
      }
    }
    const score = readCount(form.elements.score.value, "지금 점수", 0);
    if (score.error) return score;
    if (score.value != null && score.value > GOAL_SCORE) return { error: `지금 점수는 ${formatCount(GOAL_SCORE)} 이하여야 합니다.` };
    return { times, score: score.value ?? 0, party: partyOf() };
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

  function paintCharacters() {
    const select = form.elements.character_id;
    const current = form.dataset.openCharacter || select.value;
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
    select.innerHTML = [`<option value="">캐릭터 선택</option>`, ...groups].join("");
    if (current && characters.some((character) => character.id === current)) select.value = current;
  }

  function readCharacter() {
    const id = form.elements.character_id.value;
    const character = characters.find((row) => row.id === id);
    if (!character) return { error: "캐릭터를 선택해 주세요." };
    return { characterId: id, characterName: character.name };
  }

  function runInput(key, part) {
    return [...plan.querySelectorAll(`[data-run-part="${part}"]`)].find((input) => input.dataset.runKey === key);
  }

  function readRun(key) {
    const minutes = readCount(runInput(key, "min")?.value ?? "", "분", 0);
    const seconds = readCount(runInput(key, "sec")?.value ?? "", "초", 0);
    if (minutes.error) return minutes;
    if (seconds.error) return seconds;
    if (minutes.value == null && seconds.value == null) return { seconds: null };
    if (seconds.value != null && seconds.value > 59) return { error: "초는 59 이하여야 합니다." };
    const total = (minutes.value ?? 0) * 60 + (seconds.value ?? 0);
    if (total < 1) {
      if (minutes.value == null || seconds.value == null) return { seconds: null };
      return { error: "돌아본 시간은 1초 이상이어야 합니다." };
    }
    if (total > 86400) return { error: "돌아본 시간은 하루를 넘길 수 없습니다." };
    return { seconds: total };
  }

  function syncRuns() {
    const inputs = [...plan.querySelectorAll("[data-run-part='min']")];
    if (!inputs.length) return { ok: true };
    const next = new Map();
    for (const input of inputs) {
      const parsed = readRun(input.dataset.runKey);
      if (parsed.error) return parsed;
      if (parsed.seconds != null) next.set(input.dataset.runKey, parsed.seconds);
    }
    draftRuns = next;
    return { ok: true };
  }

  function routeForKey(key) {
    const current = floorsOf();
    if (current.error) return null;
    const row = compareSaves(current.times, current.party).rows.find((item) => chainKey(item.saves) === key);
    if (!row) return null;
    return row.best ?? { points: chainPoints(current.party, row.saves) };
  }

  function hourText(route, seconds) {
    if (!route || seconds == null) return "-";
    const quote = quoteBlackBelt(priceMap(), route, seconds);
    if (quote.hour == null) return quote.missing.length ? "시세 없음" : "-";
    return formatCount(quote.hour);
  }

  function beltText(route, seconds, score) {
    if (!route?.points || seconds == null) return "-";
    const need = Math.max(0, GOAL_SCORE - (score || 0));
    if (!need) return "달성";
    return formatDuration((need * seconds) / route.points);
  }

  function setNote(text, isError) {
    const note = plan.querySelector("[data-measured]");
    if (!note) return;
    note.hidden = !text;
    note.className = isError ? "form-message is-error" : "hint";
    note.textContent = text;
  }

  function formatStopwatch(ms) {
    const safe = Math.max(0, ms);
    const minutes = Math.floor(safe / 60000);
    const seconds = Math.floor(safe / 1000) % 60;
    const tenths = Math.floor(safe / 100) % 10;
    return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
  }

  function cancelClock() {
    clock = null;
    window.clearInterval(clockTimer);
    clockTimer = 0;
  }

  function tickClock() {
    if (!root.isConnected) {
      cancelClock();
      return;
    }
    if (!clock) return;
    const time = clock.scope === "band"
      ? root.querySelector(`[data-band-row="${clock.key}"] [data-band-time]`)
      : plan.querySelector(".dojo-stopwatch.is-running [data-clock-time]");
    if (!time) return;
    time.textContent = formatStopwatch(Date.now() - clock.startedAt);
  }

  function paintBandClocks() {
    const runningKey = clock?.scope === "band" ? clock.key : "";
    const busy = Boolean(clock) || Boolean(bandPending) || Boolean(routePending);
    for (const band of BANDS) {
      const row = root.querySelector(`[data-band-row="${band.start}"]`);
      if (!row) continue;
      const key = String(band.start);
      const on = key === runningKey;
      const pending = bandPending?.key === key;
      row.classList.toggle("is-timing", on);
      row.classList.toggle("is-pending", pending);
      const readout = row.querySelector("[data-band-time]");
      const start = row.querySelector("[data-band-start]");
      const stop = row.querySelector("[data-band-stop]");
      const bossTip = row.querySelector("[data-band-boss]");
      if (bossTip) bossTip.hidden = !on;
      if (readout) {
        readout.hidden = !on && !pending;
        if (on) readout.textContent = formatStopwatch(Date.now() - clock.startedAt);
        if (pending) readout.textContent = `${bandPending.seconds}초`;
      }
      if (start) start.disabled = busy && !on;
      if (stop) stop.disabled = !on;
    }
  }

  function startClock() {
    if (clock?.scope === "band" || bandPending || routePending) return;
    const select = plan.querySelector("[data-clock-target]");
    const key = select ? select.value : clockTarget;
    if (key == null) return;
    clockTarget = key;
    clock = { scope: "route", key, startedAt: Date.now() };
    window.clearInterval(clockTimer);
    clockTimer = window.setInterval(tickClock, 100);
    paintPlan();
  }

  function startBandClock(start) {
    if (clock || bandPending || routePending) return;
    clock = { scope: "band", key: String(start), startedAt: Date.now() };
    window.clearInterval(clockTimer);
    clockTimer = window.setInterval(tickClock, 100);
    paintPlan();
  }

  function stopBandClock() {
    if (clock?.scope !== "band") return;
    const key = clock.key;
    const total = Math.round((Date.now() - clock.startedAt) / 1000);
    cancelClock();
    if (total > 86400) {
      notify("돌아본 시간은 하루를 넘길 수 없습니다.", "error");
      paintPlan();
      return;
    }
    bandPending = { key, seconds: Math.max(1, total) };
    paintPlan();
  }

  async function applyBandPending() {
    if (!bandPending || saving) return;
    const input = form.elements[`band_${bandPending.key}`];
    if (input) input.value = String(bandPending.seconds);
    bandPending = null;
    paintPlan();
    await persistSheet("구간 시간을 저장했습니다.");
  }

  function cancelBandPending() {
    bandPending = null;
    paintPlan();
  }

  function stopClock() {
    if (clock?.scope === "band") {
      stopBandClock();
      return;
    }
    if (!clock) return;
    const key = clock.key;
    const total = Math.round((Date.now() - clock.startedAt) / 1000);
    cancelClock();
    if (total > 86400) {
      notify("돌아본 시간은 하루를 넘길 수 없습니다.", "error");
      paintPlan();
      return;
    }
    routePending = { key, seconds: Math.max(1, total) };
    clockTarget = key;
    paintPlan();
  }

  async function applyRoutePending() {
    if (!routePending || saving) return;
    const { key, seconds } = routePending;
    routePending = null;
    const minInput = runInput(key, "min");
    const secInput = runInput(key, "sec");
    if (minInput) minInput.value = String(Math.floor(seconds / 60));
    if (secInput) secInput.value = String(seconds % 60);
    const parsed = applyRun(key);
    if (parsed.error) {
      notify(parsed.error, "error");
      paintPlan();
      return;
    }
    landedKey = key;
    paintPlan();
    landedKey = "";
    await persistSheet("실제 시간을 저장했습니다.");
  }

  function resetRoutePending() {
    routePending = null;
    paintPlan();
  }

  function timerBar(items) {
    const options = items.map((item) => ({
      key: chainKey(item.row.saves),
      label: chainText(item.row.saves),
      actual: item.actual,
      refSeconds: item.row.best ? item.row.best.seconds : null,
    }));
    if (!options.some((item) => item.key === clockTarget)) {
      clockTarget = routePending ? routePending.key : (options[0]?.key ?? null);
    }
    const running = clock?.scope === "route";
    const pending = Boolean(routePending);
    const busy = Boolean(clock) || Boolean(bandPending) || pending;
    const time = running
      ? formatStopwatch(Date.now() - clock.startedAt)
      : pending
        ? formatStopwatch(routePending.seconds * 1000)
        : "0:00.0";
    const active = options.find((item) => item.key === clockTarget) ?? null;
    const actualMeta = active?.actual != null ? formatDuration(active.actual) : "-";
    const refMeta = active?.refSeconds != null ? formatDuration(active.refSeconds) : "-";
    const choices = options
      .map(
        (item) =>
          `<option value="${escapeHtml(item.key)}"${item.key === clockTarget ? " selected" : ""}>${escapeHtml(item.label)}</option>`,
      )
      .join("");
    return `<div class="dojo-timer${running ? " is-running" : ""}${pending ? " is-pending" : ""}">
      <div class="dojo-timer-row is-top">
        <label class="dojo-timer-target"><span>저장 방법</span><select data-clock-target${running ? " disabled" : ""}>${choices}</select></label>
        <span class="dojo-timer-meta">
          <span class="dojo-timer-meta-item"><span>실제</span><b>${escapeHtml(actualMeta)}</b></span>
          <span class="dojo-timer-meta-item"><span>참고</span><b>${escapeHtml(refMeta)}</b></span>
        </span>
      </div>
      <div class="dojo-timer-row is-bottom">
        <div class="dojo-stopwatch-face">
          <span class="dojo-stopwatch${running ? " is-running" : ""}">
            <svg class="dojo-stopwatch-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="13" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/>
              <path d="M12 13V8.7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
              <path d="M9.3 2.6h5.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
              <path d="M18.3 6.1 19.7 4.7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
            </svg>
            <span class="dojo-stopwatch-time" data-clock-time>${time}</span>
          </span>
        </div>
        <div class="dojo-timer-actions">
          <button class="dojo-stopwatch-btn is-start" type="button" data-clock-start${busy ? " disabled" : ""}>시작</button>
          <button class="dojo-stopwatch-btn is-stop" type="button" data-clock-stop${running ? "" : " disabled"}>종료</button>
          <button class="dojo-stopwatch-btn" type="button" data-clock-apply>반영</button>
          <button class="dojo-stopwatch-btn" type="button" data-clock-reset>초기화</button>
        </div>
        <button class="dojo-stopwatch-btn dojo-timer-save" type="button" data-save-clock${running || clockTarget == null ? " disabled" : ""}>저장</button>
      </div>
    </div>`;
  }

  function paintLive(key) {
    const row = [...plan.querySelectorAll("[data-chain]")].find((item) => item.dataset.chain === key);
    if (!row) return;
    const route = routeForKey(key);
    const seconds = draftRuns.get(key);
    const rate = row.querySelector("[data-live='rate']");
    const point = row.querySelector("[data-live='point']");
    const hour = row.querySelector("[data-live='hour']");
    const belt = row.querySelector("[data-live='belt']");
    const score = floorsOf();
    if (!route || seconds == null) {
      if (rate) rate.textContent = "-";
      if (point) point.textContent = "-";
      if (hour) hour.textContent = "-";
      if (belt) belt.textContent = "-";
      return;
    }
    if (rate) rate.textContent = formatPointsPerSecond(route.points, seconds);
    if (point) point.textContent = formatSecondsPerPoint(route.points, seconds);
    if (hour) hour.textContent = hourText(route, seconds);
    if (belt) belt.textContent = beltText(route, seconds, score.error ? 0 : score.score);
  }

  function applyRun(key) {
    const parsed = readRun(key);
    if (parsed.error) {
      draftRuns.delete(key);
      paintLive(key);
      setNote(parsed.error, true);
      return parsed;
    }
    if (parsed.seconds == null) draftRuns.delete(key);
    else draftRuns.set(key, parsed.seconds);
    paintLive(key);
    setNote("", false);
    return parsed;
  }

  function planHead() {
    return `<div class="dojo-plan-row is-head">
      <span class="dojo-cell is-save">저장</span>
      <span class="dojo-cell is-score">점수</span>
      <span class="dojo-cell is-ref-time"><span class="label-wide">참고 시간</span><span class="label-stack">시간</span></span>
      <span class="dojo-cell is-ref-rate"><span class="label-wide">참고 초당</span><span class="label-stack">초당</span></span>
      <span class="dojo-cell is-ref-point"><span class="label-wide">참고 점수당</span><span class="label-stack">점수당</span></span>
      <span class="dojo-cell is-act-time">실제 시간</span>
      <span class="dojo-cell is-act-rate">실제 초당</span>
      <span class="dojo-cell is-act-point">실제 점수당</span>
      <span class="dojo-cell is-belt" title="실제 시간으로 지금 점수에서 ${formatCount(GOAL_SCORE)}점까지">검은 허리띠</span>
      <span class="dojo-cell is-hour">시간당</span>
    </div>`;
  }

  // 구간마다 다른 색. 루트 칸 그림과 구간 막대에 같이 쓴다.
  const BAND_HUES = [150, 85, 50, 25, 330, 295];

  function bandHue(round) {
    const index = BANDS.findIndex((band) => round >= band.start && round <= band.end);
    return BAND_HUES[Math.max(0, index)];
  }

  // 회차마다 한 줄: 그 회차가 다시 시작하는 라운드부터 27라운드까지 칸을 켠다(시안의 1회차·2회차).
  function runRows(route) {
    const last = BANDS.at(-1).end;
    const runs = route?.runs?.length ? route.runs : [{ start: 1, end: last }];
    return `<div class="dj-runs-grid">${runs
      .map((run, runIndex) => {
        const cells = Array.from({ length: last }, (_, index) => {
          const round = index + 1;
          const on = round >= run.start;
          const gap = round % 5 === 0 && round < last ? " is-gap" : "";
          return `<i class="${on ? "is-on" : ""}${gap}" style="--hue:${bandHue(round)};--d:${runIndex * 250 + index * 18}ms"></i>`;
        }).join("");
        return `<div class="dj-run" title="${escapeHtml(spanText(run.start, run.end))}"><span>${runIndex + 1}회차</span><div class="dj-cells">${cells}</div></div>`;
      })
      .join("")}</div>`;
  }

  function paintBest(entry, meta = {}) {
    const { hasActual = false, hasRecommend = false, rank = 1, picked = false } = meta;
    const box = root.querySelector("[data-best]");
    if (!box) return;
    const route = entry?.route ?? null;
    const seconds = entry?.seconds ?? null;
    const mode = entry?.mode ?? (hasRecommend ? "recommend" : "actual");
    const score = entry?.score ?? 0;
    const hasRoute = Boolean(route);
    const tabs = `<div class="dojo-best-tabs" role="tablist" aria-label="1위 루트 보기">
          <button type="button" class="dojo-best-tab is-actual${mode === "actual" ? " is-active" : ""}" data-best-view="actual" role="tab" aria-selected="${mode === "actual"}"${hasActual ? "" : " disabled"}>실제 기록</button>
          <button type="button" class="dojo-best-tab is-recommend${mode === "recommend" ? " is-active" : ""}" data-best-view="recommend" role="tab" aria-selected="${mode === "recommend"}"${hasRecommend ? "" : " disabled"}>추천 동선</button>
        </div>`;
    box.className = `dojo-best is-${mode}${hasRoute ? "" : " is-empty"}`;
    if (!hasRoute) {
      box.innerHTML = `${tabs}<p class="dj-best-empty">구간 초를 모두 입력하면 1위 루트가 여기에 적힙니다.</p>`;
      return;
    }
    const name = route.saves?.length ? chainText(route.saves) : "저장 안 함";
    box.innerHTML = `
      <div class="dj-best">
        <div class="dj-best-top">
          <span class="dj-best-rank">${String(rank).padStart(2, "0")}</span>
          <strong>${escapeHtml(name)}</strong>
          <span class="dj-best-badge${picked ? " is-picked" : ""}">${picked ? "선택" : mode === "actual" ? "실제" : "추천"}</span>
          <span class="dj-best-rate">분당 ${escapeHtml(formatPerMinute(route.points, seconds))}</span>
        </div>
        <span class="dj-best-meta">한 바퀴 ${escapeHtml(formatCount(route.points))}점 · ${escapeHtml(formatDuration(seconds))}</span>
        ${runRows(route)}
      </div>
      <div class="dj-best-foot">${picked ? `<button type="button" class="dj-best-reset" data-best-reset>1위 보기</button>` : ""}${tabs}</div>
    `;
  }

  // 두루마리 아래 순위 목록: 상위 5개. 실제 시간이 있으면 실제로, 없으면 참고 시간으로 분당 점수를 잰다.
  // 기록이 없거나 5개보다 적어도 빈 줄로 5칸을 채워 두루마리 크기가 바뀌지 않게 한다.
  const ROUTE_ROWS = 5; // 1위 칸 + 아래 목록 02~05

  function paintRouteList(ranked) {
    const box = root.querySelector("[data-route-list]");
    if (!box) return;
    const all = ranked
      .filter((item) => item.row.best)
      .map((item) => {
        const seconds = item.actual ?? item.row.best.seconds;
        return { ...item, seconds, perMinute: (item.points * 60) / seconds };
      });
    const items = all.slice(1, ROUTE_ROWS);
    // 막대는 1위 대비 비율(시안)
    const max = all.length ? Math.max(...all.slice(0, ROUTE_ROWS).map((item) => item.perMinute)) : 1;
    const filled = items.map((item, index) => {
      const key = chainKey(item.row.saves);
      const picked = viewKey === key ? " is-picked" : "";
      return `<button type="button" class="dj-route${picked}" aria-pressed="${viewKey === key}" data-chain="${escapeHtml(key)}" style="--i:${index}">
          <span class="dj-route-rank">${String(index + 2).padStart(2, "0")}</span>
          <span class="dj-route-copy"><strong>${escapeHtml(chainText(item.row.saves))}</strong><span>${escapeHtml(formatCount(item.points))}점 · ${escapeHtml(formatDuration(item.seconds))}${item.actual != null ? " · 실제" : " · 참고"}</span></span>
          <span class="dj-route-rate"><b>${escapeHtml(formatPerMinute(item.points, item.seconds))}/분</b><span class="dj-route-bar"><i style="width:${Math.max(4, (item.perMinute / max) * 100)}%"></i></span></span>
        </button>`;
    });
    const empty = Array.from({ length: ROUTE_ROWS - 1 - filled.length }, (_, offset) => {
      const index = filled.length + offset;
      return `<div class="dj-route is-empty" aria-hidden="true" style="--i:${index}">
          <span class="dj-route-rank">${String(index + 2).padStart(2, "0")}</span>
          <span class="dj-route-copy"><strong>—</strong><span>구간 초를 입력하면 채워집니다</span></span>
          <span class="dj-route-rate"><b>분당 -</b><span class="dj-route-bar"></span></span>
        </div>`;
    });
    box.innerHTML = filled.join("") + empty.join("");
  }

  // 순위 줄을 눌렀으면 위쪽 칸을 그 루트로 바꾼다. 순위는 목록과 같은 기준(실제 시간 우선)으로 센다.
  function paintPickedRoute(ranked, score, meta) {
    if (!viewKey) return;
    const all = ranked.filter((item) => item.row.best);
    const index = all.findIndex((item) => chainKey(item.row.saves) === viewKey);
    if (index < 0) {
      viewKey = "";
      return;
    }
    const item = all[index];
    const entry = {
      mode: item.actual != null ? "actual" : "recommend",
      route: item.row.best,
      seconds: item.actual ?? item.row.best.seconds,
      score,
    };
    paintBest(entry, { ...meta, rank: index + 1, picked: true });
  }

  // 명패 판: 정보 칸 3개와 허리띠 게이지
  function paintPlaque(score) {
    const need = Math.max(0, GOAL_SCORE - score);
    const set = (selector, text) => {
      const node = root.querySelector(selector);
      if (node) node.textContent = text;
    };
    set("[data-stat-need]", need ? `${formatCount(need)}점` : "달성");
    set("[data-stat-days]", need ? `최소 ${formatCount(calendarDays(need))}일` : "-");
    const route = shownEntry?.route;
    set("[data-stat-play-label]", shownEntry?.mode === "actual" ? "실제 1위 루트 순수 플레이" : "추천 루트 순수 플레이");
    set("[data-stat-play]", route && need ? formatDuration(playSeconds({ points: route.points, seconds: shownEntry.seconds }, need)) : need ? "-" : "달성");
    const fill = root.querySelector("[data-gauge-fill]");
    const width = `${Math.min(100, (score / GOAL_SCORE) * 100)}%`;
    // 처음 그릴 때는 0에서 차오르게 한 프레임 늦게 넣는다.
    if (fill && !fill.dataset.ready) {
      fill.dataset.ready = "1";
      requestAnimationFrame(() => requestAnimationFrame(() => fill.style.setProperty("--w", width)));
    } else if (fill) fill.style.setProperty("--w", width);
    const nextBelt = BELTS.find((belt) => score < belt.score);
    for (const belt of BELTS) {
      const owned = score >= belt.score;
      const node = root.querySelector(`[data-gauge-belt="${belt.id}"]`);
      node?.classList.toggle("is-on", owned);
      node?.classList.toggle("is-next", belt === nextBelt);
      // 명패의 획득 여부도 지금 점수를 따른다(명패는 시세를 불러올 때만 다시 그리므로 여기서 맞춘다).
      const status = root.querySelector(`[data-belt-status="${belt.id}"]`);
      if (status) {
        status.textContent = owned ? "획득 · 판매 가능" : `${formatCount(belt.score - score)}점 남음`;
        status.classList.toggle("is-gain", owned);
      }
    }
  }

  function paintPlan() {
    paintBandClocks();
    const party = partyOf();
    for (const band of BANDS) {
      const points = root.querySelector(`[data-band-points="${band.start}"]`);
      const each = floorPoints(band.start, party);
      const total = bandPoints(band.start, party);
      if (points) {
        points.textContent = `${formatCount(total)}점 · 층당 ${each}점`;
        points.title = `층마다 ${each}점, 이 구간 ${formatCount(total)}점`;
      }
    }

    const current = floorsOf();
    if (current.error) {
      shownEntry = null;
      paintBest(null);
      paintPlaque(0);
      paintRouteList([]);
      plan.innerHTML = `<p class="form-message is-error"></p>`;
      plan.querySelector("p").textContent = current.error;
      return;
    }

    // 구간 막대: 가장 빠른(초당 점수가 큰) 구간을 100%로
    const rates = BANDS.map((band) => {
      const seconds = current.times.get(band.start);
      return seconds ? bandPoints(band.start, party) / seconds : 0;
    });
    const maxRate = Math.max(...rates, 0);
    BANDS.forEach((band, index) => {
      const bar = root.querySelector(`[data-band-bar="${band.start}"]`);
      if (!bar) return;
      bar.style.setProperty("--w", maxRate ? `${(rates[index] / maxRate) * 100}%` : "0%");
      bar.style.setProperty("--hue", BAND_HUES[index]);
    });
    for (const band of BANDS) {
      const row = root.querySelector(`[data-band-row="${band.start}"]`);
      const seconds = current.times.get(band.start);
      if (!row) continue;
      const input = row.querySelector("input");
      const rate = row.querySelector("[data-band-rate]");
      if (!seconds) {
        input?.removeAttribute("title");
        if (rate) {
          rate.hidden = false;
          rate.textContent = "초당 -";
          rate.title = "";
        }
        continue;
      }
      const points = bandPoints(band.start, party);
      const rateText = `초당 ${formatPointsPerSecond(points, seconds)} · 점수당 ${formatSecondsPerPoint(points, seconds)}`;
      if (input) input.title = rateText;
      if (rate) {
        rate.hidden = false;
        rate.textContent = `초당 ${formatPointsPerSecond(points, seconds)}`;
        rate.title = rateText;
      }
    }

    const compared = compareSaves(current.times, party);
    const measured = measuredRoutes(current.times, party, draftRuns);
    const recommendEntry = compared.best
      ? { mode: "recommend", route: compared.best, seconds: compared.best.seconds, score: current.score }
      : null;
    const actualEntry = measured.best
      ? { mode: "actual", route: measured.best.route, seconds: measured.best.seconds, score: current.score }
      : null;
    const hasActual = !!actualEntry;
    const hasRecommend = !!recommendEntry;
    const preferRecommend = bestView === "recommend" && hasRecommend;
    const shown = preferRecommend ? recommendEntry : hasActual ? actualEntry : recommendEntry;
    shownEntry = shown;
    paintBest(shown, { hasActual, hasRecommend });
    paintPlaque(current.score);
    paintBeltSum();

    const ranked = compared.rows
      .map((row) => ({
        row,
        points: row.best ? row.best.points : chainPoints(party, row.saves),
        actual: draftRuns.get(chainKey(row.saves)) ?? null,
      }))
      .sort((left, right) => {
        if (!left.row.best && !right.row.best) return left.row.saves.length - right.row.saves.length;
        if (!left.row.best) return 1;
        if (!right.row.best) return -1;
        if ((left.actual == null) !== (right.actual == null)) return left.actual == null ? 1 : -1;
        if (left.actual != null) {
          return compareRoutes(
            { points: left.row.best.points, seconds: left.actual, start: left.row.best.start },
            { points: right.row.best.points, seconds: right.actual, start: right.row.best.start },
          );
        }
        return compareRoutes(left.row.best, right.row.best);
      });
    paintRouteList(ranked);
    paintPickedRoute(ranked, current.score, { hasActual, hasRecommend });
    const timerHtml = timerBar(ranked);
    const body = ranked
      .map((item, index) => {
        const key = chainKey(item.row.saves);
        const label = chainText(item.row.saves);
        const hasRef = Boolean(item.row.best);
        const [minutes, seconds] = item.actual == null ? ["", ""] : [String(Math.floor(item.actual / 60)), String(item.actual % 60)];
        const liveRate = item.actual == null ? "-" : formatPointsPerSecond(item.points, item.actual);
        const livePoint = item.actual == null ? "-" : formatSecondsPerPoint(item.points, item.actual);
        const liveBelt = item.actual == null ? "-" : beltText({ points: item.points }, item.actual, current.score);
        const liveHour = item.actual == null ? "-" : hourText({ points: item.points }, item.actual);
        const refTime = hasRef ? formatDuration(item.row.best.seconds) : "-";
        const refRate = hasRef ? formatPointsPerSecond(item.points, item.row.best.seconds) : "-";
        const refPoint = hasRef ? formatSecondsPerPoint(item.points, item.row.best.seconds) : "-";
        let routeLabel;
        if (item.row.saves?.length === SAVE_FLOORS.length) {
          routeLabel = escapeHtml(label);
        } else if (item.row.saves?.length) {
          const columns = item.row.saves.length * 2 - 1;
          const floorCells = item.row.saves
            .map((round, floorIndex) => {
              const column = floorIndex * 2 + 1;
              const arrow = floorIndex < item.row.saves.length - 1
                ? `<span class="dojo-save-arrow" style="grid-column:${column + 1}" aria-hidden="true">→</span>`
                : "";
              return `<span class="dojo-save-floor" style="grid-column:${column}">${saveFloorToFloor(round)}층</span>${arrow}`;
            })
            .join("");
          const numCells = item.row.saves
            .map((round, floorIndex) => `<span class="dojo-save-round-num" style="grid-column:${floorIndex * 2 + 1}">${round}</span>`)
            .join("");
          const labelCells = item.row.saves
            .map((round, floorIndex) => `<span class="dojo-save-round-label" style="grid-column:${floorIndex * 2 + 1}">라운드</span>`)
            .join("");
          routeLabel = `<span class="dojo-save-grid" style="grid-template-columns:repeat(${columns}, auto)">${floorCells}${numCells}${labelCells}</span>`;
        } else {
          routeLabel = escapeHtml(label);
        }
        const timing = clock?.scope === "route" && clock.key === key ? " is-timing" : "";
        const landed = landedKey === key ? " is-landed" : "";
        const picked = clockTarget === key ? " is-picked" : "";
        return `<div class="dojo-plan-row${index === 0 ? " is-selected" : ""}${timing}${landed}${picked}" data-chain="${escapeHtml(key)}" role="button" tabindex="0" aria-label="${escapeHtml(label)}을(를) 저장 방법으로 선택">
          <span class="dojo-cell is-save"><span class="dojo-value">${routeLabel}</span></span>
          <span class="dojo-cell is-score"><span class="dojo-value">${escapeHtml(formatCount(item.points))}점</span></span>
          <span class="dojo-cell is-ref-time"><span class="dojo-tag">참고</span><span class="dojo-value">${escapeHtml(refTime)}</span></span>
          <span class="dojo-cell is-ref-rate"><span class="dojo-tag">참고</span><span class="dojo-value">${escapeHtml(refRate)}</span></span>
          <span class="dojo-cell is-ref-point"><span class="dojo-tag">참고</span><span class="dojo-value">${escapeHtml(refPoint)}</span></span>
          <span class="dojo-cell is-act-time"><span class="dojo-tag">실제</span><span class="dojo-line dojo-actual"><span class="dojo-clock"><input class="dojo-run" data-run-key="${escapeHtml(key)}" data-run-part="min" inputmode="numeric" autocomplete="off" aria-label="${escapeHtml(label)} 분" value="${escapeHtml(minutes)}" /><span>분</span></span><span class="dojo-clock"><input class="dojo-run" data-run-key="${escapeHtml(key)}" data-run-part="sec" inputmode="numeric" autocomplete="off" aria-label="${escapeHtml(label)} 초" value="${escapeHtml(seconds)}" /><span>초</span></span></span></span>
          <span class="dojo-cell is-act-rate"><span class="dojo-tag">실제</span><span class="dojo-value" data-live="rate">${escapeHtml(liveRate)}</span></span>
          <span class="dojo-cell is-act-point"><span class="dojo-tag">실제</span><span class="dojo-value" data-live="point">${escapeHtml(livePoint)}</span></span>
          <span class="dojo-cell is-belt"><span class="dojo-value" data-live="belt">${escapeHtml(liveBelt)}</span></span>
          <span class="dojo-cell is-hour"><span class="dojo-value" data-live="hour">${escapeHtml(liveHour)}</span></span>
        </div>`;
      })
      .join("");
    // 저장 루트 순위표와 같은 두루마리(나무 막대 + 붉은 천 + 한지) 안에 스톱워치와 표를 둔다.
    plan.innerHTML = `
      <div class="dj-ledger-wrap">
      <div class="dj-roller" aria-hidden="true"></div>
      <div class="dj-scroll-cloth">
      <div class="dojo-board dj-ledger">
        <h2 class="dj-ledger-title"><i aria-hidden="true">◈</i>실제 시간 기록<i aria-hidden="true">◈</i></h2>
        <p class="dj-ledger-sub">저장 방법을 고르고 한 바퀴를 직접 재서 적으면, 참고 시간 대신 실제 시간으로 순위를 매겨요</p>
        ${timerHtml}
        <div class="dj-ledger-legend" aria-hidden="true"><span class="is-ref">참고 = 구간 초로 계산</span><span class="is-act">실제 = 직접 잰 시간</span></div>
        <div class="dojo-plan">
          ${planHead()}
          ${body}
        </div>
        <p class="form-message is-error" data-measured hidden></p>
      </div>
      </div>
      <div class="dj-roller is-bottom" aria-hidden="true"></div>
      </div>
    `;
  }

  function priceEditor(belt, deleteId) {
    const remove = deleteId
      ? `<button class="text-button is-danger" type="button" data-delete-price="${escapeHtml(deleteId)}">삭제</button>`
      : "";
    return `<div class="row-actions"><input class="dojo-price" data-price="${belt.id}" inputmode="numeric" autocomplete="off" aria-label="${escapeHtml(belt.name)} 시세" placeholder="새 시세" /><button class="text-button" type="button" data-save-price="${belt.id}">기록</button>${remove}</div>`;
  }

  function priceDelta(row, older) {
    if (!older) return { text: "-", className: "" };
    const diff = BigInt(row.price) - BigInt(older.price);
    if (diff === 0n) return { text: "0", className: "" };
    return {
      text: diff > 0n ? `+${formatCount(diff)}` : formatCount(diff),
      className: diff > 0n ? "is-gain" : "is-loss",
    };
  }

  function hideBeltTip() {
    beltTipIcon = null;
    beltTip.hidden = true;
    beltTip.classList.remove("is-open");
    beltTip.dataset.active = "";
    beltTipImg.removeAttribute("src");
    beltTipImg.alt = "";
  }

  function placeBeltTip(icon) {
    const rect = icon.getBoundingClientRect();
    const tip = beltTip.getBoundingClientRect();
    let left = rect.right + 12;
    let top = rect.top + rect.height / 2 - tip.height / 2;
    if (left + tip.width > window.innerWidth - 8) left = Math.max(8, rect.left - tip.width - 12);
    if (top < 8) top = 8;
    if (top + tip.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - tip.height - 8);
    beltTip.style.left = `${Math.round(left)}px`;
    beltTip.style.top = `${Math.round(top)}px`;
  }

  function showBeltTip(icon) {
    const src = icon.dataset.beltDetail;
    if (!src) return;
    const same = beltTipIcon === icon && beltTip.dataset.active === src && !beltTip.hidden;
    beltTipIcon = icon;
    beltTip.dataset.active = src;
    if (!same) {
      beltTipImg.src = src;
      beltTipImg.alt = icon.getAttribute("aria-label") || "";
    }
    beltTip.hidden = false;
    beltTip.classList.add("is-open");
    placeBeltTip(icon);
    if (!beltTipImg.complete) {
      beltTipImg.addEventListener("load", () => {
        if (beltTipIcon === icon) placeBeltTip(icon);
      }, { once: true });
    }
  }

  function beltHistoryBody(beltId) {
    const history = priceRows.filter((row) => row.belt === beltId);
    if (!history.length) return `<p class="hint">아직 시세가 없습니다.</p>`;
    const rows = history
      .map((row, index) => {
        const delta = priceDelta(row, history[index + 1]);
        return `<tr><td class="num">${escapeHtml(formatCount(row.price))}</td><td class="num ${delta.className}">${escapeHtml(delta.text)}</td><td>${escapeHtml(formatWhen(row.created_at))}</td><td><button class="text-button is-danger" type="button" data-delete-price="${escapeHtml(row.id)}">삭제</button></td></tr>`;
      })
      .join("");
    return `<div class="table-wrap"><table class="data-table"><thead><tr><th>시세</th><th>이전과 차이</th><th>기록 시각</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function refreshBeltHistory(beltId) {
    const belt = beltById(beltId);
    if (!belt) return;
    beltHistoryDialog.querySelector("[data-belt-history-body]").innerHTML = beltHistoryBody(beltId);
    beltHistoryDialog.querySelector("[data-belt-history-add]").innerHTML = priceEditor(belt);
  }

  function openBeltHistory(beltId) {
    const belt = beltById(beltId);
    if (!belt) return;
    beltHistoryDialog.dataset.belt = beltId;
    beltHistoryDialog.querySelector("[data-belt-history-title]").textContent = `${belt.name} 시세 기록`;
    refreshBeltHistory(beltId);
    if (!beltHistoryDialog.open) beltHistoryDialog.showModal();
  }

  // 최근 7일 기록(오래된 → 최근)과 직전 대비 등락률
  function weekBars(history) {
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = history.filter((row) => new Date(row.created_at).getTime() >= since).slice(0, 7).reverse();
    if (!recent.length) return `<div class="dj-plate-bars is-empty"><span>7일 기록 없음</span></div>`;
    const values = recent.map((row) => BigInt(row.price));
    const max = values.reduce((top, value) => (value > top ? value : top), values[0]);
    const min = values.reduce((low, value) => (value < low ? value : low), values[0]);
    const span = max - min;
    return `<div class="dj-plate-bars">${values
      .map((value, index) => {
        const height = span > 0n ? 30 + Number(((value - min) * 70n) / span) : 100;
        const latest = index === values.length - 1 ? ' class="is-now"' : "";
        return `<i${latest} style="--h:${height}%;--d:${index * 50}ms" title="${escapeHtml(formatCount(value))}"></i>`;
      })
      .join("")}</div>`;
  }

  function changeRate(history) {
    if (history.length < 2) return { text: "-", className: "" };
    const now = BigInt(history[0].price);
    const before = BigInt(history[1].price);
    if (before === 0n) return { text: "-", className: "" };
    const permille = Number(((now - before) * 1000n) / before) / 10;
    if (permille === 0) return { text: "0%", className: "" };
    return { text: `${permille > 0 ? "▲" : "▼"} ${Math.abs(permille).toFixed(1)}%`, className: permille > 0 ? "is-up" : "is-down" };
  }

  // 허리띠 명패 5개: 이름 · 그림(누르면 기록) · 시세 입력 · 7일 막대 · 등락 · 필요 점수와 획득 여부
  function paintBelts() {
    hideBeltTip();
    const score = Number(form.elements.score.value.replace(/\D/g, "")) || 0;
    belts.innerHTML = `<div class="dj-plates">${BELTS.map((belt, index) => {
      const history = priceRows.filter((row) => row.belt === belt.id);
      const latest = history[0] ?? null;
      const change = changeRate(history);
      const detail = BELT_DETAILS[belt.id] || "";
      const owned = score >= belt.score;
      return `<article class="dj-plate" style="--i:${index}">
        <span class="dj-plate-string" aria-hidden="true"></span>
        <div class="dj-plate-body">
          <button type="button" class="dj-plate-name" data-belt-row="${belt.id}" aria-label="${escapeHtml(belt.name)} 시세 기록 보기">${escapeHtml(belt.name)}</button>
          <div class="dj-plate-paper">
            <span class="dojo-belt-icon${detail ? " has-detail" : ""}"${detail ? ` tabindex="0" data-belt-detail="${escapeHtml(detail)}" aria-label="${escapeHtml(belt.name)} 상세 옵션"` : ""}><img src="${escapeHtml(BELT_ICONS[belt.id])}" alt="" width="48" height="48" decoding="async" /></span>
            <span class="dj-plate-now">${latest ? `지금 ${escapeHtml(formatCount(latest.price))}` : "아직 시세 없음"}</span>
            <span class="dj-plate-input">
              <input class="dojo-price" data-price="${belt.id}" inputmode="numeric" autocomplete="off" aria-label="${escapeHtml(belt.name)} 새 시세" placeholder="새 시세" />
              <button type="button" data-save-price="${belt.id}">기록</button>
            </span>
            ${weekBars(history)}
            <span class="dj-plate-line"><span>7일 시세</span><b class="${change.className}">${escapeHtml(change.text)}</b></span>
            <span class="dj-plate-line is-foot"><span>${escapeHtml(formatCount(belt.score))}점</span><b data-belt-status="${belt.id}" class="${owned ? "is-gain" : ""}">${owned ? "획득 · 판매 가능" : `${escapeHtml(formatCount(belt.score - score))}점 남음`}</b></span>
          </div>
        </div>
      </article>`;
    }).join("")}</div>`;
    paintBeltSum();
    if (beltHistoryDialog.open && beltHistoryDialog.dataset.belt) refreshBeltHistory(beltHistoryDialog.dataset.belt);
  }

  // 허리띠 시세 합계와 1위 루트 기준 시간당 메소
  function paintBeltSum() {
    const sum = root.querySelector("[data-belt-sum]");
    if (!sum) return;
    const quote = quoteBlackBelt(priceMap(), shownEntry?.route, shownEntry?.seconds);
    if (quote.total == null) {
      sum.innerHTML = `시세 ${formatCount(BELTS.length - quote.missing.length)}/${formatCount(BELTS.length)} 입력`;
      return;
    }
    sum.innerHTML = `합계 ${escapeHtml(formatCount(quote.total))}${quote.hour != null ? ` · <b>시급 ${escapeHtml(formatCount(quote.hour))}</b>` : ""}`;
  }

  function paintRecords() {
    if (!recordRows.length) {
      records.innerHTML = `<p class="empty">저장된 캐릭터가 없습니다.</p>`;
      return;
    }
    const openCharacterId = form.dataset.openCharacter || "";
    const openParty = form.dataset.openParty || "solo";
    const ranked = recordRows
      .map((row) => ({
        row,
        actual: measuredRoutes(parseFloors(row.floors), row.party, row.runs).best,
      }))
      .sort((left, right) => {
        if (left.actual && right.actual) {
          const speed = compareRoutes(
            { points: left.actual.route.points, seconds: left.actual.seconds, start: left.actual.route.start },
            { points: right.actual.route.points, seconds: right.actual.seconds, start: right.actual.route.start },
          );
          if (speed) return speed;
        } else if (left.actual) return -1;
        else if (right.actual) return 1;
        return left.row.character_name.localeCompare(right.row.character_name, "ko");
      });
    const body = ranked
      .map(({ row, actual }) => {
        const party = row.party ? "team" : "solo";
        const selected = row.character_id === openCharacterId && party === openParty;
        const open = row.character_id ? ` data-open="${escapeHtml(row.character_id)}" data-party="${party}" tabindex="0"` : "";
        const actualChain = actual ? chainText(actual.route.saves) : "-";
        const actualTime = actual ? formatDuration(actual.seconds) : "-";
        const perSecond = actual ? formatPointsPerSecond(actual.route.points, actual.seconds) : "-";
        const perPoint = actual ? formatSecondsPerPoint(actual.route.points, actual.seconds) : "-";
        const belt = !actual ? "-" : beltText(actual.route, actual.seconds, row.score || 0);
        const beltFull = !actual ? "-" : beltText(actual.route, actual.seconds, 0);
        const hour = !actual ? "-" : hourText(actual.route, actual.seconds);
        const popped = arriveCard && selected ? " is-pop" : "";
        const face = faceMarkup(characters.find((item) => item.id === row.character_id)?.face_url);
        const picked = selected ? `<span class="dojo-picked">선택됨</span>` : "";
        return `<article class="dojo-card${selected ? " is-selected" : ""}${popped}"${open}${selected ? ` aria-current="true"` : ""}>
          <div class="dojo-card-head">
            ${face}
            <h3>${escapeHtml(row.character_name)}</h3>
            ${picked}
            <span class="dojo-mode ${row.party ? "is-team" : "is-solo"}">${row.party ? "팀" : "개인"}</span>
            <button class="text-button is-danger" type="button" data-delete="${escapeHtml(row.id)}">삭제</button>
          </div>
          <div class="dojo-card-hero">
            <span>검은 허리띠까지<em class="dojo-card-score">지금 ${escapeHtml(formatCount(row.score || 0))}점</em></span>
            <strong>${escapeHtml(belt)}</strong>
            <p class="dojo-card-meso"><span>시간당 메소</span><b>${escapeHtml(hour)}</b></p>
          </div>
          <ul class="dojo-card-extra">
            <li class="is-route"><span>실제 경로</span><strong>${escapeHtml(actualChain)}</strong></li>
            <li><span>실제 시간</span><strong>${escapeHtml(actualTime)}</strong></li>
            <li><span>초당 점수</span><strong>${escapeHtml(perSecond)}</strong></li>
            <li><span>점수당 초</span><strong>${escapeHtml(perPoint)}</strong></li>
            <li><span>총 검은띠 시간</span><strong>${escapeHtml(beltFull)}</strong></li>
          </ul>
        </article>`;
      })
      .join("");
    records.innerHTML = `<div class="dojo-cards">${body}</div>`;
    arriveCard = false;
  }

  function fillSheet(row, characterId, party) {
    viewKey = "";
    cancelClock();
    bandPending = null;
    routePending = null;
    clockTarget = null;
    const id = characterId || row?.character_id || "";
    const mode = party || (row?.party ? "team" : "solo");
    form.dataset.editingId = row?.id || "";
    form.dataset.openCharacter = id;
    form.dataset.openParty = mode;
    form.elements.character_id.value = id;
    form.elements.party.value = mode;
    syncPartyButtons();
    const sharedScore = row?.score ?? sheetFor(id, mode === "team" ? "solo" : "team")?.score;
    form.elements.score.value = sharedScore == null ? "" : String(sharedScore);
    const times = parseFloors(row?.floors);
    for (const band of BANDS) {
      form.elements[`band_${band.start}`].value = times.has(band.start) ? String(times.get(band.start)) : "";
    }
    draftRuns = readRuns(row?.runs);
    paintPlan();
    paintWho();
    savedSnapshot = snapshot();
    if (recordRows.length) paintRecords();
  }

  function paintWho() {
    const who = root.querySelector("[data-who]");
    const label = root.querySelector("[data-picked-label]");
    const id = form.dataset.openCharacter || form.elements.character_id.value;
    const character = characters.find((row) => row.id === id);
    const mode = form.elements.party.value === "team" ? "팀" : "개인";
    if (!who) return;
    if (!character) {
      who.textContent = "캐릭터를 선택해 주세요";
      if (label) label.hidden = true;
      return;
    }
    const level = character.level ? `Lv ${formatCount(character.level)}` : "";
    who.textContent = [character.name, character.job, level, mode].filter(Boolean).join(" · ");
    if (label) {
      label.hidden = false;
      label.textContent = `${character.name} · ${mode}`;
    }
  }

  function sheetFor(characterId, party) {
    if (!characterId) return null;
    const team = party === "team";
    return recordRows.find((item) => item.character_id === characterId && Boolean(item.party) === team) ?? null;
  }

  function openSheet(characterId, party) {
    const previousCharacter = form.dataset.openCharacter || "";
    const previousParty = form.dataset.openParty || "solo";
    if (characterId === previousCharacter && party === previousParty) return true;
    if (snapshot() !== savedSnapshot && !window.confirm("저장하지 않은 내용이 있습니다. 다른 기록을 열까요?")) {
      form.elements.character_id.value = previousCharacter;
      form.elements.party.value = previousParty;
      syncPartyButtons();
      return false;
    }
    fillSheet(sheetFor(characterId, party), characterId, party);
    return true;
  }

  function clearInputs() {
    cancelClock();
    bandPending = null;
    routePending = null;
    clockTarget = null;
    form.elements.score.value = "";
    for (const band of BANDS) form.elements[`band_${band.start}`].value = "";
    draftRuns = new Map();
    paintPlan();
  }

  function showError(target, error) {
    target.innerHTML = `<p class="form-message is-error"></p>`;
    target.querySelector("p").textContent = translateDbError(error);
  }

  async function load() {
    const id = ++loadId;
    belts.innerHTML = `<p class="empty">시세를 불러오는 중입니다.</p>`;
    records.innerHTML = `<p class="empty">기록을 불러오는 중입니다.</p>`;
    const supabase = await getSupabase();
    if (id !== loadId || !root.isConnected) return;
    const legacyColumns = recordColumns.replace(", runs", "");
    let characterResult = await supabase.from("characters").select("id, account_id, name, job, level, face_path");
    if (characterResult.error && missingFaceColumn(characterResult.error)) {
      characterResult = await supabase.from("characters").select("id, account_id, name, job, level");
    }
    const [accountResult, priceResult, recordResult] = await Promise.all([
      supabase.from("accounts").select("id, name").order("name"),
      supabase.from("dojo_belt_prices").select("id, belt, price, created_at").order("created_at", { ascending: false }),
      supabase.from("dojo_records").select(recordColumns).order("created_at", { ascending: false }).then(async (result) => {
        const raw = `${result.error?.message || ""} ${result.error?.details || ""}`;
        if (!result.error || !/\bruns\b/i.test(raw)) {
          if (!result.error) runsReady = true;
          return result;
        }
        runsReady = false;
        return supabase.from("dojo_records").select(legacyColumns).order("created_at", { ascending: false });
      }),
    ]);
    if (id !== loadId || !root.isConnected) return;
    if (characterResult.error) {
      showError(belts, characterResult.error);
      return;
    }
    characters = characterResult.data ?? [];
    await attachFaceUrls(supabase, characters);
    if (id !== loadId || !root.isConnected) return;
    if (accountResult.error) notify(translateDbError(accountResult.error), "error");
    accounts = accountResult.error ? [] : sortByName(accountResult.data ?? []);
    paintCharacters();
    if (priceResult.error) showError(belts, priceResult.error);
    else {
      priceRows = priceResult.data ?? [];
      paintBelts();
    }
    if (recordResult.error) showError(records, recordResult.error);
    else {
      recordRows = recordResult.data ?? [];
      paintRecords();
      if (!runsReady) {
        records.insertAdjacentHTML(
          "afterbegin",
          `<p class="form-message is-error">돌아본 시간을 저장하려면 Supabase SQL Editor에서 sql/018_dojo_character_runs.sql 을 실행해 주세요.</p>`,
        );
      }
    }
    paintPlan();
    paintWho();
  }

  // 명패와 기록 창에 같은 이름의 입력칸이 있으므로, 누른 버튼 옆 입력칸을 받는다.
  async function savePrice(beltId, input) {
    const parsed = readBig(input?.value ?? "", `${beltName(beltId)} 시세`, 0n);
    if (parsed.error) {
      notify(parsed.error, "error");
      return;
    }
    if (parsed.value == null) {
      notify("시세를 입력해 주세요.", "error");
      return;
    }
    const latest = latestPrices().get(beltId);
    if (latest && samePrice(latest.price, parsed.value)) {
      notify("지금 시세와 같습니다.", "info");
      return;
    }
    const supabase = await getSupabase();
    const { error } = await supabase.from("dojo_belt_prices").insert({ belt: beltId, price: parsed.value.toString() });
    if (!root.isConnected) return;
    if (error) {
      notify(translateDbError(error), "error");
      return;
    }
    notify("시세를 기록했습니다.");
    await load();
  }

  async function deletePrice(id) {
    const row = priceRows.find((item) => item.id === id);
    if (!row) return;
    if (!window.confirm(`${beltName(row.belt)} ${formatCount(row.price)} 시세 기록을 삭제할까요?`)) return;
    const supabase = await getSupabase();
    const { error } = await supabase.from("dojo_belt_prices").delete().eq("id", id);
    if (!root.isConnected) return;
    if (error) {
      notify(translateDbError(error), "error");
      return;
    }
    notify("시세 기록을 삭제했습니다.");
    await load();
  }

  async function persistSheet(doneMessage = "구간 시간을 저장했습니다.") {
    if (saving) return false;
    const synced = syncRuns();
    if (synced.error) {
      notify(synced.error, "error");
      return false;
    }
    const current = floorsOf();
    if (current.error) {
      notify(current.error, "error");
      return false;
    }
    if (!current.times.size && !draftRuns.size) {
      notify("구간 초나 실제 시간을 하나 이상 입력해 주세요.", "error");
      return false;
    }
    const character = readCharacter();
    if (character.error) {
      notify(character.error, "error");
      return false;
    }
    const existing = sheetFor(character.characterId, current.party ? "team" : "solo");
    const editingId = existing?.id || "";
    const payload = {
      character_id: character.characterId,
      character_name: character.characterName,
      party: current.party,
      floors: Object.fromEntries(current.times),
      score: form.elements.score.value.trim() ? current.score : null,
    };
    if (runsReady) payload.runs = Object.fromEntries(draftRuns);
    saving = true;
    const supabase = await getSupabase();
    const request = editingId
      ? supabase.from("dojo_records").update(payload).eq("id", editingId).select("id").single()
      : supabase.from("dojo_records").insert(payload).select("id").single();
    const { data, error } = await request;
    saving = false;
    if (!root.isConnected) return false;
    if (error) {
      notify(translateDbError(error), "error");
      return false;
    }
    form.dataset.editingId = data.id;
    form.dataset.openCharacter = character.characterId;
    form.dataset.openParty = current.party ? "team" : "solo";
    savedSnapshot = snapshot();
    const sibling = sheetFor(character.characterId, current.party ? "solo" : "team");
    if (sibling && sibling.id !== data.id && String(sibling.score ?? "") !== String(payload.score ?? "")) {
      await supabase.from("dojo_records").update({ score: payload.score }).eq("id", sibling.id);
    }
    if (!runsReady && draftRuns.size) {
      notify("구간 시간은 저장했습니다. 돌아본 시간은 sql/018_dojo_character_runs.sql 을 실행한 뒤에 저장됩니다.", "info");
    } else notify(doneMessage);
    await load();
    return true;
  }

  async function saveRoute(key) {
    const parsed = readRun(key);
    if (parsed.error) {
      notify(parsed.error, "error");
      return;
    }
    if (parsed.seconds == null) {
      notify("저장할 실제 시간을 입력해 주세요.", "error");
      return;
    }
    applyRun(key);
    await persistSheet("실제 시간을 저장했습니다.");
  }

  let savedLabelTimer = 0;

  async function saveRecord(event) {
    event.preventDefault();
    const button = form.querySelector("[data-save]");
    const saved = await persistSheet();
    if (!saved || !button?.isConnected) return;
    sfx("check");
    burstAt(button, ["#ffb08a", "#ffe28a", "#ffffff"], 30, 1.1);
    button.textContent = "저장했어요 ✓";
    clearTimeout(savedLabelTimer);
    savedLabelTimer = setTimeout(() => {
      if (button.isConnected) button.textContent = "기록 저장";
    }, 1600);
  }

  async function deleteRecord(id) {
    const row = recordRows.find((item) => item.id === id);
    if (!row) return;
    if (!window.confirm(`${row.character_name} ${row.party ? "팀" : "개인"} 구간 시간을 삭제할까요?`)) return;
    const supabase = await getSupabase();
    const { error } = await supabase.from("dojo_records").delete().eq("id", id);
    if (!root.isConnected) return;
    if (error) {
      notify(translateDbError(error), "error");
      return;
    }
    if (form.dataset.editingId === id) fillSheet(null, form.dataset.openCharacter || "", form.dataset.openParty || "solo");
    notify("구간 시간을 삭제했습니다.");
    await load();
  }

  let arriveTimer = 0;

  function markArrived() {
    const editor = form.querySelector(".dj-bands");
    if (!editor) return;
    editor.classList.remove("is-arrived");
    void editor.offsetWidth;
    editor.classList.add("is-arrived");
    window.clearTimeout(arriveTimer);
    arriveTimer = window.setTimeout(() => editor.classList.remove("is-arrived"), 900);
  }

  function scrollToSheet() {
    const bar = document.querySelector(".topbar");
    const offset = (bar?.getBoundingClientRect().height ?? 58) + 14;
    form.style.scrollMarginTop = `${offset}px`;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const distance = Math.abs(form.getBoundingClientRect().top - offset);
    if (reduce || distance < 12) {
      if (distance >= 12) form.scrollIntoView({ block: "start" });
      markArrived();
      return;
    }
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    let settled = false;
    let fallback = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("scroll", watch);
      window.removeEventListener("scrollend", finish);
      window.clearTimeout(fallback);
      markArrived();
    };
    const watch = () => {
      window.clearTimeout(fallback);
      fallback = window.setTimeout(finish, 140);
    };
    fallback = window.setTimeout(finish, 1400);
    window.addEventListener("scroll", watch, { passive: true });
    window.addEventListener("scrollend", finish);
  }

  form.addEventListener("input", (event) => {
    if (event.target.matches("[data-run-part]")) {
      applyRun(event.target.dataset.runKey);
      return;
    }
    if (event.target.name?.startsWith("band_") || event.target.name === "score") paintPlan();
  });
  form.addEventListener("change", (event) => {
    if (event.target.matches("[data-clock-target]")) {
      clockTarget = event.target.value;
      if (routePending) routePending.key = clockTarget;
      paintPlan();
      return;
    }
    if (event.target.matches("[data-run-part]")) return;
    if (event.target.name === "character_id") openSheet(event.target.value, form.elements.party.value);
    if (event.target.name === "party") openSheet(form.elements.character_id.value, event.target.value);
  });
  form.addEventListener("focusout", (event) => {
    if (!event.target.matches?.("[data-run-part]")) return;
    const next = event.relatedTarget;
    if (next?.matches?.("[data-run-part]")) return;
    if (clockPressed || next?.closest?.("[data-clock-start], [data-clock-stop], [data-clock-apply], [data-clock-reset], [data-band-start], [data-band-stop], [data-band-apply], [data-band-cancel], [data-save-clock]")) return;
    const parsed = applyRun(event.target.dataset.runKey);
    if (!parsed.error) paintPlan();
  });
  form.addEventListener("submit", (event) => {
    saveRecord(event);
  });
  records.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest("[data-open]");
    if (!card || event.target.closest("button")) return;
    event.preventDefault();
    card.click();
  });
  plan.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("[data-chain]");
    if (!row || event.target.closest("button, input")) return;
    event.preventDefault();
    row.click();
  });
  root.addEventListener("keydown", (event) => {
    const input = event.target.closest?.("[data-price]");
    if (!input || event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    savePrice(input.dataset.price, input);
  });
  belts.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("[data-belt-row]");
    if (!row || event.target.closest("button, input")) return;
    event.preventDefault();
    row.click();
  });
  function burstStart(button) {
    const rect = button.getBoundingClientRect();
    const node = document.createElement("span");
    node.className = "dojo-burst";
    node.style.left = `${rect.left + rect.width / 2}px`;
    node.style.top = `${rect.top + rect.height / 2}px`;
    node.innerHTML = Array.from({ length: 10 }, (_, index) => `<i style="--a:${index * 36}deg"></i>`).join("");
    document.body.appendChild(node);
    window.setTimeout(() => node.remove(), 620);
  }

  root.addEventListener("pointerdown", (event) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const control = event.target.closest("button, .dojo-card");
    if (!control || control.disabled) return;
    control.classList.remove("is-tap");
    void control.offsetWidth;
    control.classList.add("is-tap");
    const start = event.target.closest("[data-band-start], [data-clock-start]");
    if (start && !start.disabled) burstStart(start);
  });
  root.addEventListener("mousedown", (event) => {
    clockPressed = Boolean(event.target.closest("[data-clock-start], [data-clock-stop], [data-clock-apply], [data-clock-reset], [data-band-start], [data-band-stop], [data-band-apply], [data-band-cancel], [data-save-clock]"));
  });
  root.addEventListener("mouseup", () => {
    clockPressed = false;
  });
  root.addEventListener("click", (event) => {
    const clockStart = event.target.closest("[data-clock-start]");
    if (clockStart && !clockStart.disabled) {
      startClock();
      return;
    }
    const clockStop = event.target.closest("[data-clock-stop]");
    if (clockStop && !clockStop.disabled) {
      stopClock();
      return;
    }
    const clockApply = event.target.closest("[data-clock-apply]");
    if (clockApply) {
      applyRoutePending();
      return;
    }
    const clockReset = event.target.closest("[data-clock-reset]");
    if (clockReset) {
      resetRoutePending();
      return;
    }
    const bandStart = event.target.closest("[data-band-start]");
    if (bandStart && !bandStart.disabled) {
      startBandClock(bandStart.dataset.bandStart);
      return;
    }
    const bandStop = event.target.closest("[data-band-stop]");
    if (bandStop && !bandStop.disabled) {
      stopBandClock();
      return;
    }
    const bandApply = event.target.closest("[data-band-apply]");
    if (bandApply) {
      applyBandPending();
      return;
    }
    const saveRun = event.target.closest("[data-save-clock]");
    if (saveRun && !saveRun.disabled) {
      saveRoute(clockTarget);
      return;
    }
    const bandCancel = event.target.closest("[data-band-cancel]");
    if (bandCancel) {
      cancelBandPending();
      return;
    }
    const routeItem = event.target.closest(".dj-route[data-chain]");
    if (routeItem) {
      const key = routeItem.dataset.chain;
      viewKey = viewKey === key ? "" : key;
      // 스톱워치로 재는 중이 아니면 재는 대상도 이 루트로 맞춘다(기존 동작).
      if (viewKey && clock?.scope !== "route") {
        clockTarget = key;
        if (routePending) routePending.key = clockTarget;
      }
      sfx("tick");
      paintPlan();
      return;
    }
    if (event.target.closest("[data-best-reset]")) {
      viewKey = "";
      sfx("tick");
      paintPlan();
      return;
    }
    const chainRow = event.target.closest("[data-chain]");
    if (chainRow && !event.target.closest(".dojo-run") && clock?.scope !== "route") {
      const key = chainRow.dataset.chain;
      if (key !== clockTarget) {
        clockTarget = key;
        if (routePending) routePending.key = clockTarget;
        paintPlan();
      }
      return;
    }
    const savePriceButton = event.target.closest("[data-save-price]");
    if (savePriceButton) {
      savePrice(savePriceButton.dataset.savePrice, savePriceButton.parentElement.querySelector("[data-price]"));
      return;
    }
    const bandStep = event.target.closest("[data-band-step]");
    if (bandStep) {
      const input = form.elements[`band_${bandStep.dataset.bandStep}`];
      const now = Number(input.value.replace(/\D/g, "")) || 0;
      input.value = String(Math.max(0, now + Number(bandStep.dataset.step)) || "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    const deletePriceButton = event.target.closest("[data-delete-price]");
    if (deletePriceButton) {
      deletePrice(deletePriceButton.dataset.deletePrice);
      return;
    }
    const beltHistoryClose = event.target.closest("[data-belt-history-close]");
    if (beltHistoryClose) {
      beltHistoryDialog.close();
      return;
    }
    // 명패 이름(버튼)도 기록 창을 연다. 입력칸·기록·삭제 버튼만 뺀다.
    const beltRow = event.target.closest("[data-belt-row]");
    if (beltRow && !event.target.closest("input, [data-save-price], [data-delete-price]")) {
      openBeltHistory(beltRow.dataset.beltRow);
      return;
    }
    const openRow = event.target.closest("[data-open]");
    if (openRow && !event.target.closest("button")) {
      const characterId = openRow.dataset.open;
      const party = openRow.dataset.party || "solo";
      arriveCard = true;
      if (characterId && openSheet(characterId, party)) scrollToSheet();
      else arriveCard = false;
      return;
    }
    const deleteButton = event.target.closest("[data-delete]");
    if (deleteButton && !deleteButton.closest("[data-delete-price]")) {
      deleteRecord(deleteButton.dataset.delete);
      return;
    }
    if (event.target.closest("[data-clear]")) clearInputs();
    const partyChoice = event.target.closest("[data-party-choice]");
    if (partyChoice) {
      setParty(partyChoice.dataset.partyChoice);
      return;
    }
    const bestViewButton = event.target.closest("[data-best-view]");
    if (bestViewButton) {
      if (bestViewButton.disabled) return;
      const next = bestViewButton.dataset.bestView;
      if (next !== bestView) {
        bestView = next;
        paintPlan();
      }
      return;
    }
  });

  form.dataset.openParty = "solo";
  paintPlan();
  savedSnapshot = snapshot();

  belts.addEventListener("pointerover", (event) => {
    const icon = event.target.closest(".dojo-belt-icon.has-detail");
    if (!icon || !belts.contains(icon)) return;
    showBeltTip(icon);
  });
  belts.addEventListener("pointerout", (event) => {
    const icon = event.target.closest(".dojo-belt-icon.has-detail");
    if (!icon || beltTipIcon !== icon) return;
    const next = event.relatedTarget;
    if (next && icon.contains(next)) return;
    hideBeltTip();
  });
  belts.addEventListener("focusin", (event) => {
    const icon = event.target.closest(".dojo-belt-icon.has-detail");
    if (icon && belts.contains(icon)) showBeltTip(icon);
  });
  belts.addEventListener("focusout", (event) => {
    const icon = event.target.closest(".dojo-belt-icon.has-detail");
    if (!icon || beltTipIcon !== icon) return;
    const next = event.relatedTarget;
    if (next && icon.contains(next)) return;
    hideBeltTip();
  });
  if (!beltTip.dataset.bound) {
    beltTip.dataset.bound = "1";
    const dismiss = () => {
      const tip = document.getElementById("dojo-belt-tip");
      if (!tip || tip.hidden) return;
      tip.hidden = true;
      tip.classList.remove("is-open");
      tip.dataset.active = "";
      const img = tip.querySelector("img");
      if (img) {
        img.removeAttribute("src");
        img.alt = "";
      }
    };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
  }
  hideBeltTip();

  await load();
}
