import { attachFaceUrls, faceMarkup, missingFaceColumn } from "../character-face.js";
import { translateDbError } from "../db-error.js";
import {
  BANDS,
  BELTS,
  GOAL_SCORE,
  SAVE_FLOORS,
  SAVE_SECONDS,
  bandPoints,
  beltById,
  chainPoints,
  chainText,
  compareRoutes,
  compareSaves,
  floorPoints,
  formatDuration,
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
        <span class="dojo-band-rate" data-band-rate="${band.start}" hidden></span>
      </div>
      <div class="dojo-band-controls">
        <label class="dojo-band-time">
          <input name="band_${band.start}" inputmode="numeric" autocomplete="off" aria-label="${label} 초" placeholder="0" />
          <span>초</span>
        </label>
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
    <section class="dojo-cast">
      <img class="dojo-roof" src="img/dojo-roof.png" alt="" />
      <section class="dojo-frame">
        <div class="page-toolbar">
          <h2>캐릭터</h2>
          <p class="dojo-picked-label" data-picked-label hidden></p>
        </div>
        <div data-records></div>
      </section>
    </section>
    <div class="dojo-link" aria-hidden="true">${dojoChain}${dojoChain}</div>
    <form id="dojo-form">
      <section class="dojo-frame">
      <div class="dojo-who" data-who>
        <div class="dojo-who-copy">
          <p class="dojo-who-kicker">구간 시간</p>
          <h2>캐릭터를 선택해 주세요</h2>
        </div>
      </div>
      <div class="editor">
        <details class="dojo-note span-all">
          <summary>계산 기준</summary>
          <p class="hint">구간 전체를 깨는 초를 적습니다. 층에는 쉬는 층도 포함되어 있어서, 5라운드를 마칠 때마다 나오는 쉬는 층(${SAVE_FLOORS.map((floor) => `${saveFloorToFloor(floor)}층`).join(", ")})에서 저장할 수 있고, 이어서 5라운드 단위로 다시 저장할 수 있습니다. 개인은 1~5층(1~5라운드)이 층마다 2점, 팀은 1점입니다. 저장 한 번에 참고 시간 ${SAVE_SECONDS}초를 더합니다. 하루 최대 3,500점이고, 검은 허리띠는 ${formatCount(GOAL_SCORE)}점입니다.</p>
        </details>
        <div class="dojo-fields">
          <label class="field dojo-field-character"><span>캐릭터</span>
            <select name="character_id">
              <option value="">캐릭터 선택</option>
            </select>
          </label>
          <div class="field dojo-field-party">
            <span>방식</span>
            <div class="dojo-party-toggle" role="group" aria-label="개인 또는 팀">
              <button type="button" class="dojo-party-btn is-solo is-active" data-party-choice="solo" aria-pressed="true">개인</button>
              <button type="button" class="dojo-party-btn is-team" data-party-choice="team" aria-pressed="false">팀</button>
            </div>
            <input type="hidden" name="party" value="solo" />
          </div>
          <label class="field dojo-field-score"><span>지금 점수</span><input name="score" inputmode="numeric" autocomplete="off" placeholder="없으면 0" /></label>
        </div>
        <div class="dojo-split">
          <div class="dojo-bands">
            <p class="dojo-bands-title">참고용 구간 초</p>
            ${floorsTable()}
          </div>
          <div class="dojo-best-column">
            <div class="dojo-best is-empty" data-best>
              <p class="dojo-best-kicker">최적 동선</p>
              <p class="dojo-best-empty">구간 초를 모두 입력하면 여기에 정리됩니다.</p>
            </div>
            <div class="button-row">
              <button class="primary-button dojo-game-button" type="submit" data-save>이 캐릭터 저장</button>
              <button class="secondary-button" type="button" data-clear>입력 지우기</button>
            </div>
          </div>
        </div>
      </div>
      </section>
      <div class="dojo-link" aria-hidden="true">${dojoChain}${dojoChain}</div>
      <section class="dojo-notice">
        <div data-plan></div>
      </section>
    </form>
    <div class="dojo-link" aria-hidden="true">${dojoChain}${dojoChain}</div>
    <section class="dojo-frame dojo-belts">
      <div class="dojo-belts-head"><span>허리띠 시세</span><span class="dojo-belts-hint">공용 시세입니다. 가격을 적으면 아래에 쌓입니다.</span></div>
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
      <span class="dojo-cell is-act-time">실제</span>
      <span class="dojo-cell is-act-rate">실제 초당</span>
      <span class="dojo-cell is-act-point">실제 점수당</span>
      <span class="dojo-cell is-belt" title="실제 시간으로 지금 점수에서 ${formatCount(GOAL_SCORE)}점까지">검은 허리띠</span>
      <span class="dojo-cell is-hour">시간당</span>
    </div>`;
  }

  function paintBest(entry, meta = {}) {
    const { hasActual = false, hasRecommend = false } = meta;
    const box = root.querySelector("[data-best]");
    if (!box) return;
    const route = entry?.route ?? null;
    const seconds = entry?.seconds ?? null;
    const mode = entry?.mode ?? (hasRecommend ? "recommend" : "actual");
    const score = entry?.score ?? 0;
    const hasRoute = Boolean(route);
    const path = hasRoute
      ? route.saves?.length
        ? route.saves
            .map(
              (round) =>
                `<span class="dojo-best-step"><span class="dojo-best-chip">${saveFloorToFloor(round)}층</span><span class="dojo-best-round-note">${round}라운드</span></span>`,
            )
            .join(`<span class="dojo-best-arrow" aria-hidden="true">→</span>`)
        : `<span class="dojo-best-chip">저장 안 함</span>`
      : `<span class="dojo-best-chip is-placeholder">-</span>`;
    const head = `<div class="dojo-best-tabs" role="tablist" aria-label="최적 동선 보기">
          <button type="button" class="dojo-best-tab is-actual${mode === "actual" ? " is-active" : ""}" data-best-view="actual" role="tab" aria-selected="${mode === "actual"}"${hasActual ? "" : " disabled"}>실제 기록</button>
          <button type="button" class="dojo-best-tab is-recommend${mode === "recommend" ? " is-active" : ""}" data-best-view="recommend" role="tab" aria-selected="${mode === "recommend"}"${hasRecommend ? "" : " disabled"}>추천 동선</button>
        </div>`;
    const beltEta = hasRoute ? beltText(route, seconds, score || 0) : "-";
    const beltFull = hasRoute ? beltText(route, seconds, 0) : "-";
    const mesoHour = hasRoute ? hourText(route, seconds) : "-";
    const perSecond = hasRoute ? formatPointsPerSecond(route.points, seconds) : "-";
    const perPoint = hasRoute ? formatSecondsPerPoint(route.points, seconds) : "-";
    const duration = hasRoute ? formatDuration(seconds) : "-";
    const totalPoints = hasRoute ? `${formatCount(route.points)}점` : "-";
    box.className = `dojo-best is-${mode}${hasRoute ? "" : " is-empty"}`;
    box.innerHTML = `
      <div class="dojo-best-card">
        <div class="dojo-best-head">
          <p class="dojo-best-kicker">최적 동선</p>
          ${head}
        </div>
        <div class="dojo-best-headline">
          <span>총 검은띠까지</span>
          <strong>${escapeHtml(beltFull)}</strong>
        </div>
        <div class="dojo-best-hero">
          <div class="dojo-best-hero-stat">
            <span>검은 허리띠까지</span>
            <strong>${escapeHtml(beltEta)}</strong>
          </div>
          <div class="dojo-best-hero-stat is-meso">
            <span>시간당 메소</span>
            <strong>${escapeHtml(mesoHour)}</strong>
          </div>
        </div>
        <div class="dojo-best-stats">
          <div class="dojo-best-stat">
            <span>초당 점수</span>
            <strong>${escapeHtml(perSecond)}</strong>
          </div>
          <div class="dojo-best-stat">
            <span>점수당 초</span>
            <strong>${escapeHtml(perPoint)}</strong>
          </div>
        </div>
        <div class="dojo-best-route">
          <p class="dojo-best-path">${path}</p>
          <p class="dojo-best-duration">
            <span>소요 시간</span><strong>${escapeHtml(duration)}</strong>
            <span class="dojo-best-duration-sep" aria-hidden="true">·</span>
            <span>점수</span><strong>${escapeHtml(totalPoints)}</strong>
          </p>
        </div>
        ${hasRoute ? "" : `<p class="dojo-best-empty-hint">구간 초를 모두 입력하면 채워집니다.</p>`}
      </div>
    `;
  }

  function paintPlan() {
    paintBandClocks();
    const party = partyOf();
    for (const band of BANDS) {
      const points = root.querySelector(`[data-band-points="${band.start}"]`);
      const each = floorPoints(band.start, party);
      const total = bandPoints(band.start, party);
      if (points) {
        points.textContent = `${formatCount(total)}점`;
        points.title = `층마다 ${each}점, 이 구간 ${formatCount(total)}점`;
      }
    }

    const current = floorsOf();
    if (current.error) {
      paintBest(null);
      plan.innerHTML = `<p class="form-message is-error"></p>`;
      plan.querySelector("p").textContent = current.error;
      return;
    }

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
          rate.textContent = "초당 0점 · 점수당 0초";
        }
        continue;
      }
      const points = bandPoints(band.start, party);
      const rateText = `초당 ${formatPointsPerSecond(points, seconds)} · 점수당 ${formatSecondsPerPoint(points, seconds)}`;
      if (input) input.title = rateText;
      if (rate) {
        rate.hidden = false;
        rate.textContent = rateText;
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
    paintBest(shown, { hasActual, hasRecommend });

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
    plan.innerHTML = `
      <div class="dojo-board">
      ${timerHtml}
      <div class="dojo-plan">
        ${planHead()}
        ${body}
      </div>
      <p class="form-message is-error" data-measured hidden></p>
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

  function paintBelts() {
    hideBeltTip();
    const body = BELTS.map((belt) => {
      const history = priceRows.filter((row) => row.belt === belt.id);
      const latest = history[0] ?? null;
      const priceCells = latest
        ? (() => {
            const delta = priceDelta(latest, history[1]);
            return `<td class="num dojo-price-value">${escapeHtml(formatCount(latest.price))}</td><td class="num dojo-price-delta ${delta.className}">${escapeHtml(delta.text)}</td><td class="dojo-price-date">${escapeHtml(formatWhen(latest.created_at))}</td>`;
          })()
        : `<td colspan="3">아직 시세가 없습니다.</td>`;
      return `<tr class="dojo-price-row" data-belt-row="${belt.id}" role="button" tabindex="0" aria-label="${escapeHtml(belt.name)} 시세 기록 보기"><td>${beltLabel(belt)}</td>${priceCells}</tr>`;
    }).join("");
    belts.innerHTML = `<div class="table-wrap"><table class="data-table dojo-prices"><thead><tr><th>허리띠</th><th>시세</th><th>이전과 차이</th><th>기록일</th></tr></thead><tbody>${body}</tbody></table></div>`;
    if (beltHistoryDialog.open && beltHistoryDialog.dataset.belt) refreshBeltHistory(beltHistoryDialog.dataset.belt);
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
      who.classList.remove("is-on");
      who.innerHTML = `<div class="dojo-who-copy"><p class="dojo-who-kicker">구간 시간</p><h2>캐릭터를 선택해 주세요</h2></div>`;
      if (label) label.hidden = true;
      return;
    }
    const job = character.job ? escapeHtml(character.job) : "";
    const level = character.level ? `Lv ${escapeHtml(formatCount(character.level))}` : "";
    const meta = [job, level, mode].filter(Boolean).join(" · ");
    const face = character.face_url ? faceMarkup(character.face_url) : "";
    who.classList.add("is-on");
    who.innerHTML = `${face}<div class="dojo-who-copy"><p class="dojo-who-kicker">구간 시간</p><h2>${escapeHtml(character.name)}</h2><p class="dojo-who-meta">${meta}</p></div>`;
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

  async function savePrice(beltId) {
    const input = root.querySelector(`[data-price="${beltId}"]`);
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

  async function saveRecord(event) {
    event.preventDefault();
    await persistSheet();
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
    const editor = form.querySelector(".editor");
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
      savePrice(savePriceButton.dataset.savePrice);
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
    const beltRow = event.target.closest("[data-belt-row]");
    if (beltRow && !event.target.closest("button, input")) {
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
