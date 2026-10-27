import { mountDojoScoreLog } from "../dojo-score-log.js";
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
import { createQuickCharacter } from "../quick-character.js";
import { isLoggedIn, requireLogin, takeDraft } from "../session.js";
import { getSupabase } from "../supabase-client.js";
import { notify } from "../toast.js";

// 캐릭터 선택의 "＋ 새 캐릭터" 항목 값
const QUICK_OPTION = "__quick_new";
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

// 구간마다 다른 색. 구간 행 색 막대, 루트 칸 그림, 층 트랙에 같이 쓴다.
const BAND_HUES = [150, 85, 50, 25, 330, 295];

function bandHue(round) {
  const index = BANDS.findIndex((band) => round >= band.start && round <= band.end);
  return BAND_HUES[Math.max(0, index)];
}

// 측정대 빠른 선택(시안 v2): 저장 안 함 / 24층 / 18층 → 24층 / 올저장
const QUICK_PICKS = [[], [20], [15, 20], SAVE_FLOORS];
// 캐릭터 칩 얼굴 바탕색(얼굴 사진이 없을 때)
const CHAR_HUES = [295, 210, 150, 25, 85, 330];
// 스톱워치 고리 둘레(r=92)
const RING = 578;

function savesOf(key) {
  return key ? key.split(",").map(Number) : [];
}

// 회차별 시작 라운드: 첫 회차 1, 저장할 때마다 그 저장 다음 구간부터 다시
function runStarts(saves) {
  return [1, ...saves.map((save) => save + 1)];
}

function floorsTable() {
  return BANDS.map((band, bandIndex) => {
    const label = spanText(band.start, band.end);
    const { floorLabel, roundLabel } = spanParts(band.start, band.end);
    const saveTitle = SAVE_FLOORS.includes(band.end) ? ` title="${saveFloorToFloor(band.end)}층(쉬는 층)에서 저장"` : "";
    const bossNote = BAND_BOSS_NOTES[band.start];
    const bossTip = bossNote
      ? `<div class="dojo-band-boss-tip" data-band-boss hidden role="status">${escapeHtml(bossNote)}</div>`
      : "";
    return `<div class="dojo-band" data-band-row="${band.start}" style="--hue:${BAND_HUES[bandIndex]}"${saveTitle}>
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
    <header class="page-header dojo-hero dj-hero">
      <span class="dj-seal" aria-hidden="true">武</span>
      <span class="dj-hero-title">
        <p class="dojo-kicker">MU LUNG DOJO</p>
        <h1>무릉도장</h1>
      </span>
      <div class="dojo-party-toggle dj-modes" role="group" aria-label="개인 또는 팀">
        <button type="button" class="dojo-party-btn is-solo is-active" data-party-choice="solo" aria-pressed="true">개인</button>
        <button type="button" class="dojo-party-btn is-team" data-party-choice="team" aria-pressed="false">팀</button>
      </div>
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
            <button type="button" class="dj-plaque-log" data-score-log-open>통합 점수 기록 보기</button>
          </div>
          <div class="dj-stats">
            <div class="dj-stat"><span>검은색 허리띠까지</span><strong data-stat-need>-</strong></div>
            <div class="dj-stat"><span>하루 ${formatCount(DAILY_CAP)}점 제한</span><strong data-stat-days>-</strong></div>
            <div class="dj-stat is-gold"><span data-stat-play-label>추천 루트 플레이</span><strong data-stat-play>-</strong></div>
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
        <div class="dj-charbar">
          <span class="dj-charbar-label">캐릭터</span>
          <div class="dj-charbar-list" data-char-chips role="group" aria-label="캐릭터 고르기"></div>
          <label class="dj-picker" hidden><span class="sr-only">캐릭터 선택</span>
            <select name="character_id" aria-label="캐릭터 선택" tabindex="-1"><option value="">캐릭터 선택</option></select>
          </label>
        </div>
        <div class="dj-quick-char" data-quick-char hidden>
          <p class="dj-quick-char-hint" data-quick-char-hint>이름만 적으면 바로 캐릭터를 만들어요.</p>
          <div class="dj-quick-char-row">
            <input data-quick-char-name maxlength="30" autocomplete="off" placeholder="캐릭터 이름" aria-label="새 캐릭터 이름" />
            <button type="button" class="dj-quick-char-make" data-quick-char-create>만들기</button>
            <button type="button" class="text-button" data-quick-char-cancel>닫기</button>
          </div>
          <small>직업·레벨은 나중에 캐릭터 관리에서 채워요. 만든 캐릭터는 무릉 숙제표와 퀘스트에도 바로 보여요.</small>
        </div>
      </section>

      <section class="dj-panel dj-chars">
        <div class="dj-panel-head">
          <h2><i aria-hidden="true">◆</i>캐릭터별 기록</h2>
          <span class="dj-sub">카드를 누르면 그 캐릭터 기록을 열어요 · 실제 기록이 빠른 순</span>
          <p class="dojo-picked-label" data-picked-label hidden></p>
        </div>
        <div data-records></div>
      </section>

      <div class="dj-grid">
        <section class="dj-panel dj-bands">
          <div class="dj-panel-head">
            <h2><i aria-hidden="true">◆</i>구간 기록</h2>
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

      <section class="dj-panel dj-measure">
        <div class="dj-measure-head">
          <span class="dj-measure-title">
            <h2><i aria-hidden="true">◆</i>실제 시간 기록</h2>
            <span class="dj-sub">저장 방법을 고르고 한 바퀴를 직접 재면, 참고 시간 대신 실제 시간으로 순위를 매겨요</span>
          </span>
          <span class="dj-legend"><span><i class="is-ref"></i>참고 = 구간 초로 계산</span><span><i class="is-act"></i>실제 = 직접 잰 시간</span></span>
        </div>
        <div data-plan></div>
      </section>
    </form>

    <section class="dj-panel dj-belts">
      <div class="dj-panel-head">
        <h2><i aria-hidden="true">◆</i>허리띠 시세</h2>
        <span class="dj-sub">흰색부터 검은색까지 다 팔았을 때 · 이름을 누르면 시세 기록</span>
        <span class="dj-belt-chips">
          <span class="dj-belt-chip"><small>합계</small><strong data-belt-sum>-</strong></span>
          <span class="dj-belt-chip is-gold"><small>1위 루트 시간당</small><strong data-belt-hour>-</strong></span>
        </span>
      </div>
      <div data-belts></div>
    </section>
    <dialog class="dj-log-dialog" data-score-log-dialog aria-label="통합 점수 기록">
      <section class="dj-scorelog" data-score-log></section>
    </dialog>
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
  let landedTimer = 0;
  let arriveCard = false;
  let savedSnapshot = "";
  // 로그인하러 가기 전에 적던 기록(로그인 뒤 되살림). 다른 캐릭터를 골라도 묻지 않고 그 캐릭터 기록 위에 다시 채운다.
  let carried = null;
  let runsReady = true;
  let priceRows = [];
  let recordRows = [];
  let loadId = 0;
  let saving = false;
  let bestView = "actual";
  // 지금 보여 주는 1위 루트(명패 판 정보·허리띠 시급에 같이 쓴다)
  let shownEntry = null;
  // 두루마리 위쪽 칸에 보여 줄 루트(순위 줄을 누르면 바뀜). 비어 있으면 1위.
  let viewKey = null; // "저장 안 함" 루트의 키가 "" 라서 선택 없음은 null 로 둔다

  function partyOf() {
    return form.elements.party.value === "team";
  }

  function syncPartyButtons() {
    const value = form.elements.party.value;
    for (const button of root.querySelectorAll("[data-party-choice]")) {
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
    // 로그인했으면 맨 아래에 "이름만으로 새 캐릭터"(캐릭터가 없을 때 적던 기록을 바로 저장할 수 있게)
    const quick = isLoggedIn() ? [`<option value="${QUICK_OPTION}">＋ 새 캐릭터 (이름만)</option>`] : [];
    select.innerHTML = [`<option value="">캐릭터 선택</option>`, ...groups, ...quick].join("");
    if (current && characters.some((character) => character.id === current)) select.value = current;
    paintCharChips();
  }

  // 명패 판 아래 캐릭터 칩 줄(시안 v2): select 대신 누르는 칩. 실제 선택은 숨은 select 를 거쳐 기존 흐름(openSheet)을 탄다.
  function paintCharChips() {
    const box = root.querySelector("[data-char-chips]");
    if (!box) return;
    if (!isLoggedIn()) {
      box.innerHTML = `<span class="dj-charbar-note">로그인하면 캐릭터를 골라 기록을 저장할 수 있어요.</span><button type="button" class="dj-char is-login" data-login-open>로그인</button>`;
      return;
    }
    const current = form.dataset.openCharacter || form.elements.character_id.value;
    const party = form.elements.party.value || "solo";
    const chip = (character) => {
      const on = character.id === current;
      const sheet = sheetFor(character.id, party) ?? sheetFor(character.id, party === "team" ? "solo" : "team");
      const meta = [character.level ? `Lv.${formatCount(character.level)}` : "", sheet?.score != null ? `${formatCount(sheet.score)}점` : ""].filter(Boolean).join(" · ") || "기록 없음";
      const face = faceMarkup(character.face_url) || `<b>${escapeHtml([...String(character.name || "?").trim()][0] || "?")}</b>`;
      return `<button type="button" class="dj-char${on ? " is-on" : ""}" data-char-pick="${escapeHtml(character.id)}" aria-pressed="${on}">
        <span class="dj-char-face" style="--hue:${CHAR_HUES[characters.indexOf(character) % CHAR_HUES.length]}">${face}</span>
        <span class="dj-char-copy"><strong>${escapeHtml(character.name)}</strong><small>${escapeHtml(meta)}</small></span>
      </button>`;
    };
    const known = new Set(accounts.map((account) => account.id));
    const groups = accounts
      .map((account) => ({ name: account.name, members: characters.filter((character) => character.account_id === account.id).sort(compareCharacter) }))
      .filter((group) => group.members.length);
    const loose = characters.filter((character) => !known.has(character.account_id)).sort(compareCharacter);
    if (loose.length) groups.push({ name: "계정 없음", members: loose });
    const many = groups.length > 1;
    box.innerHTML = groups
      .map((group) => `<span class="dj-char-group">${many ? `<small class="dj-char-account">${escapeHtml(group.name)}</small>` : ""}${group.members.map(chip).join("")}</span>`)
      .join("") + `<button type="button" class="dj-char is-new" data-char-new>＋ 새 캐릭터</button>`;
  }

  // ── 이름만으로 캐릭터 만들기 ──────────────────────────────
  const quickBox = root.querySelector("[data-quick-char]");

  function showQuickCharacter(hint = "이름만 적으면 바로 캐릭터를 만들어요.", { focus = true } = {}) {
    quickBox.hidden = false;
    quickBox.querySelector("[data-quick-char-hint]").textContent = hint;
    if (focus) quickBox.querySelector("[data-quick-char-name]").focus({ preventScroll: false });
  }

  function hideQuickCharacter() {
    quickBox.hidden = true;
    quickBox.querySelector("[data-quick-char-name]").value = "";
  }

  async function createCharacterQuick() {
    const input = quickBox.querySelector("[data-quick-char-name]");
    const button = quickBox.querySelector("[data-quick-char-create]");
    if (button.disabled) return;
    // 지금 적던 기록을 맡겨 두고, 새 캐릭터를 열면 그 위에 다시 채운다(새 캐릭터는 저장된 기록이 없어 칸이 비워지므로).
    const keep = carried ?? carrySheet();
    button.disabled = true;
    const supabase = await getSupabase();
    const result = await createQuickCharacter(supabase, input.value, { homeworkKeys: ["dojo"] });
    button.disabled = false;
    if (!root.isConnected) return;
    if (result.error || result.dbError) {
      notify(result.error || translateDbError(result.dbError), "error");
      input.focus();
      return;
    }
    characters = [...characters, result.character];
    if (result.createdAccount) accounts = sortByName([...accounts, result.account]);
    paintCharacters();
    hideQuickCharacter();
    carried = keep;
    form.elements.character_id.value = result.character.id;
    openSheet(result.character.id, form.elements.party.value || "solo");
    paintWho();
    sfx("check");
    burstAt(form.elements.character_id, ["#ffd98a", "#ff9a6b", "#ffffff"], 16, 0.8);
    notify(`${result.character.name} 캐릭터를 만들었어요. 저장을 누르면 이 캐릭터에 기록돼요.`, "info");
    if (result.warning) notify(translateDbError(result.warning), "error");
  }

  quickBox.addEventListener("click", (event) => {
    if (event.target.closest("[data-quick-char-create]")) createCharacterQuick();
    if (event.target.closest("[data-quick-char-cancel]")) hideQuickCharacter();
  });
  quickBox.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing || !event.target.closest("[data-quick-char-name]")) return;
    // 기록 폼 안이라 Enter 가 기록 저장으로 가지 않게 막는다.
    event.preventDefault();
    createCharacterQuick();
  });

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
    // 합계 1초 미만(0분 0초)이면 그 루트 기록을 지운다(시안 v2).
    if (total < 1) return { seconds: null };
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
    if (clock.scope === "route") {
      paintWatch();
      return;
    }
    const time = root.querySelector(`[data-band-row="${clock.key}"] [data-band-time]`);
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
    // 아직 안 잰 루트는 기록부에 입력칸이 없으므로 칸을 거치지 않고 바로 넣는다(다시 그리면 그 루트 카드가 생긴다).
    const synced = syncRuns();
    if (synced.error) {
      notify(synced.error, "error");
      paintPlan();
      return;
    }
    draftRuns.set(key, seconds);
    // 방금 적은 카드는 1.4초 동안 금빛(저장 뒤 다시 그려져도 유지)
    landedKey = key;
    window.clearTimeout(landedTimer);
    landedTimer = window.setTimeout(() => {
      landedKey = "";
      for (const card of plan.querySelectorAll(".dj-card.is-landed")) card.classList.remove("is-landed");
    }, 1400);
    paintPlan();
    sfx("check");
    const card = [...plan.querySelectorAll(".dj-card")].find((item) => item.dataset.chain === key);
    if (card) burstAt(card, ["#ffe28a", "#ffb08a", "#ffffff"], 22, 1);
    await persistSheet("실제 시간을 저장했습니다.");
  }

  function resetRoutePending() {
    routePending = null;
    paintPlan();
  }

  // 측정대에서 잴 저장 조합을 바꾼다. 재는 중에는 잠근다. 반영 전 시간은 버린다(다른 루트에 적히지 않게).
  function pickRoute(key) {
    if (clock?.scope === "route") return false;
    if (key === clockTarget) return true;
    sfx("tick");
    clockTarget = key;
    routePending = null;
    paintPlan();
    return true;
  }

  // 기록부 ×: 그 루트 실제 시간을 지운다. 로그인해 캐릭터를 골랐으면 바로 저장한다.
  async function clearRun(key) {
    for (const input of plan.querySelectorAll("[data-run-part]")) {
      if (input.dataset.runKey === key) input.value = "";
    }
    draftRuns.delete(key);
    sfx("uncheck");
    paintPlan();
    if (isLoggedIn() && form.elements.character_id.value && (draftRuns.size || floorsOf().times?.size)) await persistSheet("실제 시간을 지웠습니다.");
  }

  // 측정대 "이미 잰 시간이 있으면 □분 □초 [바로 적기]": 지금 고른 루트에 적고 저장한다(기록부에 적기와 같은 흐름).
  async function applyManual() {
    if (clock?.scope === "route" || saving) return;
    const minutes = readCount(plan.querySelector("[data-manual='min']")?.value ?? "", "분", 0);
    const seconds = readCount(plan.querySelector("[data-manual='sec']")?.value ?? "", "초", 0);
    const error = minutes.error || seconds.error || (seconds.value != null && seconds.value > 59 ? "초는 59 이하여야 합니다." : "");
    if (error) {
      notify(error, "error");
      return;
    }
    const total = (minutes.value ?? 0) * 60 + (seconds.value ?? 0);
    if (total < 1) {
      notify("잰 시간을 적어 주세요.", "error");
      return;
    }
    if (total > 86400) {
      notify("돌아본 시간은 하루를 넘길 수 없습니다.", "error");
      return;
    }
    routePending = { key: clockTarget, seconds: total };
    await applyRoutePending();
  }

  // 스톱워치 참고 시간(지금 고른 저장 조합). 재는 동안 매 0.1초 고리·차이를 바꿀 때 쓴다.
  let watchRef = null;
  // 기록부 카드 순서가 바뀔 때만 카드가 떠오르게(입력할 때마다 다시 튀지 않게)
  let bookSig = "";
  let showAllRoutes = false;

  function watchState() {
    const running = clock?.scope === "route";
    const elapsed = running ? (Date.now() - clock.startedAt) / 1000 : routePending ? routePending.seconds : 0;
    const active = running || Boolean(routePending);
    const ratio = watchRef ? Math.min(1, elapsed / watchRef) : 0;
    const delta = watchRef ? Math.round(elapsed - watchRef) : null;
    let deltaText = "참고 시간 대비";
    let tone = "";
    if (active && delta != null) {
      deltaText = delta === 0 ? "참고와 같음" : delta < 0 ? `참고보다 ${formatDuration(-delta)} 빠름` : `참고보다 ${formatDuration(delta)} 느림`;
      tone = delta <= 0 ? "is-fast" : "is-slow";
    }
    return { running, active, elapsed, ratio, over: Boolean(watchRef) && elapsed > watchRef, deltaText, tone };
  }

  function paintWatch() {
    const face = plan.querySelector("[data-watch]");
    if (!face) return;
    const state = watchState();
    face.querySelector("[data-watch-time]").textContent = formatStopwatch(state.elapsed * 1000);
    const ring = face.querySelector("[data-watch-ring]");
    ring.setAttribute("stroke-dashoffset", String(RING * (1 - state.ratio)));
    ring.classList.toggle("is-over", state.over);
    const delta = face.querySelector("[data-watch-delta]");
    delta.textContent = state.deltaText;
    delta.className = `dj-watch-delta ${state.tone}`;
  }

  // ① 층 트랙: 27라운드 칸 + 저장 지점(5·10·15·20·25라운드 뒤) 마름모 토글
  function trackHtml(saves, locked) {
    const last = BANDS.at(-1).end;
    const parts = [];
    for (let round = 1; round <= last; round += 1) {
      const rerun = saves.some((save) => round > save);
      parts.push(`<i class="dj-track-cell${rerun ? " is-rerun" : ""}" style="--hue:${bandHue(round)}" title="${roundToFloorText(round)}"></i>`);
      if (SAVE_FLOORS.includes(round)) {
        const on = saves.includes(round);
        parts.push(`<button type="button" class="dj-gate${on ? " is-on" : ""}" data-gate="${round}" aria-pressed="${on}" title="${saveFloorToFloor(round)}층(쉬는 층)에서 저장"${locked ? " disabled" : ""}><small>${saveFloorToFloor(round)}층</small><i aria-hidden="true"></i></button>`);
      }
    }
    return `<div class="dj-track">${parts.join("")}</div>`;
  }

  function roundToFloorText(round) {
    const { floorLabel } = spanParts(round, round);
    return `${floorLabel} (${round}라운드)`;
  }

  // 측정대: ① 저장할 쉬는 층 고르기 ② 한 바퀴 재기(원형 스톱워치)
  function deskHtml(pick) {
    const saves = savesOf(pick.key);
    const running = clock?.scope === "route";
    const pending = Boolean(routePending);
    watchRef = pick.ref;
    const state = watchState();
    const status = running ? "● 기록 중" : pending ? "반영 전" : pick.actual != null ? `기록 있음 · ${formatDuration(pick.actual)}` : "아직 기록 없음";
    const statusTone = running ? "is-live" : pending ? "is-pending" : "";
    const quick = QUICK_PICKS.map((picks) => {
      const key = chainKey(picks);
      const on = key === pick.key;
      return `<button type="button" class="dj-quick${on ? " is-on" : ""}" data-quick-pick="${escapeHtml(key)}" aria-pressed="${on}"${running ? " disabled" : ""}>${escapeHtml(chainText(picks))}</button>`;
    }).join("");
    const buttons = running
      ? `<button type="button" class="dj-watch-btn is-stop" data-clock-stop>■ 종료</button>`
      : pending
        ? `<button type="button" class="dj-watch-btn is-apply" data-clock-apply>기록부에 적기</button><button type="button" class="dj-watch-btn is-ghost" data-clock-reset>다시 재기</button>`
        : `<button type="button" class="dj-watch-btn is-start" data-clock-start${bandPending || clock ? " disabled" : ""}>▶ 시작</button>`;
    return `<div class="dj-desk">
      <div class="dj-step-block">
        <div class="dj-step-head"><span class="dj-step-num">1</span><strong>저장할 쉬는 층 고르기</strong><small>${running ? "재는 동안은 바꿀 수 없어요" : "층을 눌러 켜고 꺼요"}</small></div>
        ${trackHtml(saves, running)}
        <div class="dj-pick-line"><strong>${escapeHtml(chainText(saves))}</strong><span>한 바퀴 ${escapeHtml(formatCount(pick.points))}점 · ${saves.length + 1}회차 · 저장 ${saves.length}번</span></div>
        <div class="dj-quicks">${quick}</div>
      </div>
      <div class="dj-desk-rule" aria-hidden="true"></div>
      <div class="dj-step-block is-center">
        <div class="dj-step-head"><span class="dj-step-num">2</span><strong>한 바퀴 재기</strong><small class="dj-watch-status ${statusTone}">${escapeHtml(status)}</small></div>
        <div class="dj-watch${running ? " is-running" : ""}" data-watch>
          <svg viewBox="0 0 230 230" aria-hidden="true"><circle cx="115" cy="115" r="92" class="dj-watch-track" /><circle cx="115" cy="115" r="92" class="dj-watch-ring${state.over ? " is-over" : ""}" data-watch-ring stroke-dasharray="${RING}" stroke-dashoffset="${RING * (1 - state.ratio)}" /></svg>
          <span class="dj-watch-face">
            <small>${running ? "재는 중" : pending ? "한 바퀴" : "준비"}</small>
            <strong data-watch-time>${formatStopwatch(state.elapsed * 1000)}</strong>
            <span>참고 ${escapeHtml(pick.ref != null ? formatDuration(pick.ref) : "-")}</span>
            <em class="dj-watch-delta ${state.tone}" data-watch-delta>${escapeHtml(state.deltaText)}</em>
          </span>
        </div>
        <div class="dj-watch-btns">${buttons}</div>
        <div class="dj-manual">
          <span>이미 잰 시간이 있으면</span>
          <label><input data-manual="min" inputmode="numeric" autocomplete="off" placeholder="0" aria-label="이미 잰 시간 분" /><small>분</small></label>
          <label><input data-manual="sec" inputmode="numeric" autocomplete="off" placeholder="0" aria-label="이미 잰 시간 초" /><small>초</small></label>
          <button type="button" data-manual-apply${running ? " disabled" : ""}>바로 적기</button>
        </div>
      </div>
    </div>`;
  }

  // 회차 막대 27칸: 첫 회차는 구간 색, 다시 도는 라운드는 주홍
  function cellsHtml(saves) {
    const last = BANDS.at(-1).end;
    const starts = runStarts(saves).slice(1);
    return `<span class="dj-card-cells" aria-hidden="true">${Array.from({ length: last }, (_, index) => {
      const round = index + 1;
      const rerun = starts.some((start) => round >= start);
      const gap = round % 5 === 0 && round < last ? " is-gap" : "";
      return `<i class="${rerun ? "is-rerun" : ""}${gap}" style="--hue:${bandHue(round)}"></i>`;
    }).join("")}</span>`;
  }

  function runInputs(key, label, actual) {
    const [minutes, seconds] = actual == null ? ["", ""] : [String(Math.floor(actual / 60)), String(actual % 60)];
    return `<span class="dj-time">
      <label><input class="dojo-run" data-run-key="${escapeHtml(key)}" data-run-part="min" inputmode="numeric" autocomplete="off" aria-label="${escapeHtml(label)} 분" placeholder="분" value="${escapeHtml(minutes)}" /><small>분</small></label>
      <label><input class="dojo-run" data-run-key="${escapeHtml(key)}" data-run-part="sec" inputmode="numeric" autocomplete="off" aria-label="${escapeHtml(label)} 초" placeholder="초" value="${escapeHtml(seconds)}" /><small>초</small></label>
    </span>`;
  }

  function deltaText(actual, ref) {
    if (actual == null || ref == null) return { text: "", tone: "" };
    const diff = actual - ref;
    if (diff === 0) return { text: "참고와 같음", tone: "is-fast" };
    return diff < 0 ? { text: `▼ ${formatDuration(-diff)} 빠름`, tone: "is-fast" } : { text: `▲ ${formatDuration(diff)} 느림`, tone: "is-slow" };
  }

  // 기록부 카드 한 장(잰 루트). 1~3위는 금·은·동 순위 칸, 4위부터 사각 인장.
  function bookCard(row, index, score, enter) {
    const key = chainKey(row.route.saves);
    const label = chainText(row.route.saves);
    const ref = row.route.runs ? row.route.seconds : null;
    const delta = deltaText(row.seconds, ref);
    const tier = ["is-gold", "is-silver", "is-bronze"][index] ?? "is-plain";
    const landed = landedKey === key;
    const medal = index < 3
      ? `<span class="dj-medal" aria-hidden="true"><b>${index + 1}</b><i></i><small>${index + 1}위</small></span>`
      : `<span class="dj-seal-rank" aria-hidden="true">${index + 1}</span>`;
    return `<article class="dj-card ${tier}${landed ? " is-landed" : ""}${enter ? " is-enter" : ""}" data-chain="${escapeHtml(key)}" style="--i:${index}" aria-label="${index + 1}위 ${escapeHtml(label)}">
      ${medal}
      ${index === 0 ? `<span class="dj-card-kicker">최고 기록</span>` : ""}
      <div class="dj-card-top">
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(formatCount(row.route.points))}점</span>
        <button type="button" class="dj-card-redo" data-pick-chain="${escapeHtml(key)}">다시 재기</button>
        <button type="button" class="dj-card-x" data-run-clear="${escapeHtml(key)}" aria-label="${escapeHtml(label)} 기록 지우기" title="기록 지우기">×</button>
      </div>
      <div class="dj-card-mid">
        ${runInputs(key, label, row.seconds)}
        <span class="dj-card-ref"><small>참고 ${escapeHtml(ref != null ? formatDuration(ref) : "-")}</small><b class="${delta.tone}" data-live="delta">${escapeHtml(delta.text)}</b></span>
        <span class="dj-card-rate"><b data-live="pm">분당 ${escapeHtml(formatPerMinute(row.route.points, row.seconds))}</b><small>초당 <span data-live="ps">${escapeHtml(formatPointsPerSecond(row.route.points, row.seconds))}</span> · 점수당 <span data-live="spp">${escapeHtml(formatSecondsPerPoint(row.route.points, row.seconds))}</span></small></span>
      </div>
      ${cellsHtml(row.route.saves)}
      <div class="dj-card-foot"><span>검은 허리띠까지 <b data-live="belt">${escapeHtml(beltText(row.route, row.seconds, score))}</b></span><span>시간당 <b data-live="hour">${escapeHtml(hourText(row.route, row.seconds))}</b> 메소</span></div>
    </article>`;
  }

  // 기록부(한지): 잰 루트 카드 · 아직 안 잰 추천 루트 3개 · 전체 32개 간이표
  function bookHtml(ranked, measured, score) {
    const sig = measured.rows.map((row) => chainKey(row.route.saves)).join("|");
    const enter = sig !== bookSig;
    bookSig = sig;
    const cards = measured.rows.length
      ? measured.rows.map((row, index) => bookCard(row, index, score, enter)).join("")
      : `<p class="dj-book-empty">아직 잰 루트가 없어요. 왼쪽에서 한 바퀴를 재 보세요.</p>`;
    const byRef = ranked.filter((item) => item.row.best).sort((left, right) => compareRoutes(left.row.best, right.row.best));
    const suggest = byRef.filter((item) => item.actual == null).slice(0, 3).map((item) => {
      const key = chainKey(item.row.saves);
      return `<div class="dj-suggest-row">
        <span><strong>${escapeHtml(chainText(item.row.saves))}</strong><small>${escapeHtml(formatCount(item.points))}점 · 참고 ${escapeHtml(formatDuration(item.row.best.seconds))}</small></span>
        <b>참고 분당 ${escapeHtml(formatPerMinute(item.points, item.row.best.seconds))}</b>
        <button type="button" data-pick-chain="${escapeHtml(key)}">이 루트 재기</button>
      </div>`;
    }).join("");
    const allRows = showAllRoutes
      ? [...byRef, ...ranked.filter((item) => !item.row.best)].map((item) => {
          const key = chainKey(item.row.saves);
          const label = chainText(item.row.saves);
          const seconds = item.actual ?? item.row.best?.seconds ?? null;
          return `<div class="dj-all-row${key === clockTarget ? " is-picked" : ""}${item.actual != null ? " is-actual" : ""}" data-chain="${escapeHtml(key)}">
            <span class="is-name">${escapeHtml(label)}</span>
            <span class="is-num">${escapeHtml(formatCount(item.points))}</span>
            <span class="is-num">${escapeHtml(item.row.best ? formatDuration(item.row.best.seconds) : "-")}</span>
            ${runInputs(key, label, item.actual)}
            <span class="is-num is-pm" data-live="pm-short">${escapeHtml(seconds ? formatPerMinute(item.points, seconds).replace("점", "") : "-")}</span>
          </div>`;
        }).join("")
      : "";
    return `<div class="dj-book">
      <div class="dj-book-head"><h3>기록부</h3><span>잰 루트 ${formatCount(measured.rows.length)}개 · 실제 분당 점수 순</span></div>
      <div class="dj-book-cards">${cards}</div>
      ${suggest ? `<div class="dj-suggest"><span class="dj-suggest-title">아직 안 잰 추천 루트</span>${suggest}</div>` : ""}
      <button type="button" class="dj-all-toggle" data-all-toggle aria-expanded="${showAllRoutes}">${showAllRoutes ? "전체 루트 접기 ▴" : `전체 ${formatCount(ranked.length)}개 루트 보기 ▾`}</button>
      ${showAllRoutes ? `<div class="dj-all"><div class="dj-all-row is-head"><span>저장</span><span class="is-num">점수</span><span class="is-num">참고</span><span class="is-center">실제</span><span class="is-num">분당</span></div>${allRows}</div>` : ""}
      <p class="form-message is-error" data-measured hidden></p>
    </div>`;
  }

  function paintLive(key) {
    const rows = [...plan.querySelectorAll("[data-chain]")].filter((item) => item.dataset.chain === key);
    if (!rows.length) return;
    const route = routeForKey(key);
    const seconds = draftRuns.get(key);
    const score = floorsOf();
    const has = Boolean(route) && seconds != null;
    const ref = route?.runs ? route.seconds : null;
    const delta = deltaText(has ? seconds : null, ref);
    for (const row of rows) {
      const set = (name, text) => {
        const node = row.querySelector(`[data-live='${name}']`);
        if (node) node.textContent = text;
      };
      set("pm", has ? `분당 ${formatPerMinute(route.points, seconds)}` : "분당 -");
      set("ps", has ? formatPointsPerSecond(route.points, seconds) : "-");
      set("spp", has ? formatSecondsPerPoint(route.points, seconds) : "-");
      set("belt", has ? beltText(route, seconds, score.error ? 0 : score.score) : "-");
      set("hour", has ? hourText(route, seconds) : "-");
      set("pm-short", has ? formatPerMinute(route.points, seconds).replace("점", "") : route?.runs ? formatPerMinute(route.points, route.seconds).replace("점", "") : "-");
      const deltaNode = row.querySelector("[data-live='delta']");
      if (deltaNode) {
        deltaNode.textContent = delta.text;
        deltaNode.className = delta.tone;
      }
    }
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
    if (viewKey == null) return;
    const all = ranked.filter((item) => item.row.best);
    const index = all.findIndex((item) => chainKey(item.row.saves) === viewKey);
    if (index < 0) {
      viewKey = null;
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
    set("[data-stat-play-label]", shownEntry?.mode === "actual" ? "실제 1위 루트 플레이" : "추천 루트 플레이");
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
    // 측정대에서 재는 저장 조합(기존 clockTarget). 없으면 순위 1위.
    if (!ranked.some((item) => chainKey(item.row.saves) === clockTarget)) {
      clockTarget = routePending ? routePending.key : (ranked[0] ? chainKey(ranked[0].row.saves) : "");
    }
    const picked = ranked.find((item) => chainKey(item.row.saves) === clockTarget);
    const pick = {
      key: clockTarget,
      points: picked?.points ?? chainPoints(party, savesOf(clockTarget)),
      ref: picked?.row.best ? picked.row.best.seconds : null,
      actual: picked?.actual ?? null,
    };
    plan.innerHTML = `<div class="dj-measure-body">${deskHtml(pick)}${bookHtml(ranked, measured, current.score)}</div>`;
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

  // 직전 기록 대비 등락률
  function changeRate(history) {
    if (history.length < 2) return { text: "-", className: "" };
    const now = BigInt(history[0].price);
    const before = BigInt(history[1].price);
    if (before === 0n) return { text: "-", className: "" };
    const permille = Number(((now - before) * 1000n) / before) / 10;
    if (permille === 0) return { text: "0%", className: "" };
    return { text: `${permille > 0 ? "▲" : "▼"} ${Math.abs(permille).toFixed(1)}%`, className: permille > 0 ? "is-up" : "is-down" };
  }

  // 허리띠 카드 5개(시안 v2): 그림(호버하면 상세 옵션) · 이름(누르면 시세 기록 창) · 획득 여부 · 새 시세 입력 · 지금 시세와 등락
  function paintBelts() {
    hideBeltTip();
    const score = Number(form.elements.score.value.replace(/\D/g, "")) || 0;
    belts.innerHTML = `<div class="dj-beltcards">${BELTS.map((belt, index) => {
      const history = priceRows.filter((row) => row.belt === belt.id);
      const latest = history[0] ?? null;
      const change = changeRate(history);
      const detail = BELT_DETAILS[belt.id] || "";
      const owned = score >= belt.score;
      return `<article class="dj-beltcard${owned ? " is-owned" : ""}" style="--i:${index}">
        <div class="dj-beltcard-top">
          <span class="dojo-belt-icon${detail ? " has-detail" : ""}"${detail ? ` tabindex="0" data-belt-detail="${escapeHtml(detail)}" aria-label="${escapeHtml(belt.name)} 상세 옵션"` : ""}><img src="${escapeHtml(BELT_ICONS[belt.id])}" alt="" width="32" height="32" decoding="async" /></span>
          <span class="dj-beltcard-copy">
            <button type="button" class="dj-beltcard-name" data-belt-row="${belt.id}" aria-label="${escapeHtml(belt.name)} 시세 기록 보기">${escapeHtml(belt.name)}</button>
            <small data-belt-status="${belt.id}" class="${owned ? "is-gain" : ""}">${owned ? "획득 · 판매 가능" : `${escapeHtml(formatCount(belt.score - score))}점 남음`}</small>
          </span>
        </div>
        <span class="dj-beltcard-input">
          <input class="dojo-price" data-price="${belt.id}" inputmode="numeric" autocomplete="off" aria-label="${escapeHtml(belt.name)} 새 시세" placeholder="${latest ? escapeHtml(formatCount(latest.price)) : "시세 입력"}" />
          <small>메소</small>
          <button type="button" data-save-price="${belt.id}">기록</button>
        </span>
        <span class="dj-beltcard-foot"><span>${latest ? `지금 ${escapeHtml(formatCount(latest.price))}` : "아직 시세 없음"}</span><b class="${change.className}">${escapeHtml(change.text)}</b></span>
      </article>`;
    }).join("")}</div>`;
    paintBeltSum();
    if (beltHistoryDialog.open && beltHistoryDialog.dataset.belt) refreshBeltHistory(beltHistoryDialog.dataset.belt);
  }

  // 허리띠 시세 합계와 1위 루트 기준 시간당 메소(머리 칩 두 개)
  function paintBeltSum() {
    const sum = root.querySelector("[data-belt-sum]");
    const hour = root.querySelector("[data-belt-hour]");
    if (!sum || !hour) return;
    const quote = quoteBlackBelt(priceMap(), shownEntry?.route, shownEntry?.seconds);
    sum.textContent = quote.total == null ? `시세 ${formatCount(BELTS.length - quote.missing.length)}/${formatCount(BELTS.length)} 입력` : `${formatCount(quote.total)} 메소`;
    hour.textContent = quote.hour != null ? `${formatCount(quote.hour)} 메소` : "-";
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
          <div class="dojo-card-hero${face ? " has-face" : ""}">
            <div class="dojo-card-title">
              <h3>${escapeHtml(row.character_name)}</h3>
              <span class="dojo-mode ${row.party ? "is-team" : "is-solo"}">${row.party ? "팀" : "개인"}</span>
              ${picked}
              <button class="dojo-card-delete" type="button" data-delete="${escapeHtml(row.id)}" aria-label="${escapeHtml(row.character_name)} ${row.party ? "팀" : "개인"} 기록 삭제" title="삭제">×</button>
            </div>
            ${face}
            <div class="dojo-card-hero-text">
              <span>검은 허리띠까지<em class="dojo-card-score">지금 ${escapeHtml(formatCount(row.score || 0))}점</em></span>
              <strong>${escapeHtml(belt)}</strong>
            </div>
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
    viewKey = null;
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
    paintCharChips();
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
    // 로그인 전에는 열 기록이 없다. 개인/팀만 바꾸고 적던 값은 그대로 둔다.
    if (!isLoggedIn()) {
      form.dataset.openCharacter = characterId;
      form.dataset.openParty = party;
      return true;
    }
    if (carried) {
      fillSheet(sheetFor(characterId, party), characterId, party);
      applyCarried();
      return true;
    }
    if (snapshot() !== savedSnapshot && !window.confirm("저장하지 않은 내용이 있습니다. 다른 기록을 열까요?")) {
      form.elements.character_id.value = previousCharacter;
      form.elements.party.value = previousParty;
      syncPartyButtons();
      return false;
    }
    fillSheet(sheetFor(characterId, party), characterId, party);
    return true;
  }

  // 로그인하러 갈 때 맡길 기록: 지금 칸의 값과 고른 개인/팀(열린 기록과 다를 수 있어 버튼 값을 쓴다).
  function carrySheet() {
    syncRuns();
    return { ...JSON.parse(snapshot()), party: form.elements.party.value || "solo" };
  }

  // 맡겨 둔 기록(수련 점수·구간 초·실제 시간)을 지금 열린 칸에 채운다. 저장 전이라 "저장 필요" 상태로 남는다.
  function applyCarried() {
    if (!carried) return;
    form.elements.score.value = carried.score ?? "";
    BANDS.forEach((band, index) => {
      form.elements[`band_${band.start}`].value = carried.bands?.[index] ?? "";
    });
    draftRuns = new Map(carried.runs ?? []);
    paintPlan();
    paintWho();
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
    // 로그인 전: 루트 계산만 한다. 캐릭터 기록·허리띠 시세는 로그인하면 보인다.
    if (!isLoggedIn()) {
      characters = [];
      accounts = [];
      priceRows = [];
      recordRows = [];
      paintCharacters();
      paintBelts();
      records.innerHTML = `<p class="empty">로그인하면 캐릭터별 무릉 기록과 효율 순위가 여기 보여요. 지금은 위에 구간 초를 적어 루트를 계산해 볼 수 있어요.</p>`;
      paintPlan();
      paintWho();
      return;
    }
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
    // 로그인했는데 캐릭터가 하나도 없으면 이름만으로 만드는 칸을 바로 보여 준다.
    if (!characters.length) showQuickCharacter("아직 캐릭터가 없어요. 이름만 적으면 바로 만들어 기록을 저장할 수 있어요.", { focus: false });
    if (priceResult.error) showError(belts, priceResult.error);
    else {
      priceRows = priceResult.data ?? [];
      paintBelts();
    }
    if (recordResult.error) showError(records, recordResult.error);
    else {
      recordRows = recordResult.data ?? [];
      paintRecords();
      // 처음 열 때만 효율 순위 첫 캐릭터를 선택한다. 저장·재조회 때 사용자의 선택은 유지한다.
      const first = records.querySelector("[data-open]");
      if (!form.dataset.openCharacter && first) {
        fillSheet(sheetFor(first.dataset.open, first.dataset.party), first.dataset.open, first.dataset.party);
      }
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
    if (!requireLogin("허리띠 시세는 로그인한 계정에 저장돼요.", { belt: { id: beltId, value: input?.value ?? "" }, sheet: carrySheet() })) return;
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
    // 로그인 전이면 적은 기록을 맡기고 로그인하러 간다. 돌아오면 다시 채워 두고, 저장할 캐릭터를 고르게 한다.
    if (!requireLogin("무릉 기록은 로그인한 계정의 캐릭터에 저장돼요.", { sheet: carrySheet() })) return false;
    const character = readCharacter();
    if (character.error) {
      if (!characters.length) {
        showQuickCharacter("캐릭터가 아직 없어요. 이름만 적어 만들면 적던 기록이 그 캐릭터에 저장돼요.");
        notify("저장할 캐릭터가 없어요. 이름만 적어 캐릭터를 만들어 주세요.", "info");
      } else notify(`${character.error} 목록에 없으면 "＋ 새 캐릭터"로 이름만 적어 만들 수 있어요.`, "error");
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
    carried = null;
    const sibling = sheetFor(character.characterId, current.party ? "solo" : "team");
    if (sibling && sibling.id !== data.id && String(sibling.score ?? "") !== String(payload.score ?? "")) {
      await supabase.from("dojo_records").update({ score: payload.score }).eq("id", sibling.id);
    }
    // 수련 점수 = 숙제 체크리스트의 통합 점수. 바뀌었으면 통합 점수 기록(sql/033)에도 한 줄 남긴다.
    const previousRecord = [existing, sibling].filter((row) => row?.score != null).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];
    if (payload.score != null) await logTotalScore(supabase, character.characterId, payload.score, previousRecord);
    if (!runsReady && draftRuns.size) {
      notify("구간 시간은 저장했습니다. 돌아본 시간은 sql/018_dojo_character_runs.sql 을 실행한 뒤에 저장됩니다.", "info");
    } else notify(doneMessage);
    await load();
    return true;
  }

  // previous: 이번 저장 전 수련 점수 기록({ score, updated_at }). 기록 표에 없던 값이면 그 시각으로 먼저 남겨 어제 기준을 지킨다.
  async function logTotalScore(supabase, characterId, score, previous) {
    const last = await supabase.from("dojo_score_log").select("total, recorded_at").eq("character_id", characterId).order("recorded_at", { ascending: false }).limit(1);
    // sql/033 실행 전이면 기록하지 않는다(무릉 저장은 그대로).
    if (last.error) return;
    let latest = last.data?.[0] ?? null;
    const previousIsNewer = previous && (!latest || new Date(previous.updated_at) > new Date(latest.recorded_at));
    if (previousIsNewer && Number(previous.score) !== Number(latest?.total)) {
      const baseline = await supabase.from("dojo_score_log").insert({ character_id: characterId, total: Number(previous.score), kind: "set", recorded_at: previous.updated_at });
      if (baseline.error) {
        notify(translateDbError(baseline.error), "error");
        return;
      }
      latest = { total: previous.score };
    }
    if (latest && Number(latest.total) === Number(score)) return;
    const { error } = await supabase.from("dojo_score_log").insert({ character_id: characterId, total: score, kind: "set", recorded_at: new Date().toISOString() });
    if (error) notify(translateDbError(error), "error");
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
      // 같은 루트가 기록부 카드와 전체 간이표에 함께 있으면 두 칸을 같은 값으로 맞춘다(readRun 은 첫 칸을 읽는다).
      const { runKey, runPart } = event.target.dataset;
      for (const twin of plan.querySelectorAll(`[data-run-part="${runPart}"]`)) {
        if (twin !== event.target && twin.dataset.runKey === runKey) twin.value = event.target.value;
      }
      applyRun(runKey);
      return;
    }
    if (event.target.name?.startsWith("band_") || event.target.name === "score") paintPlan();
  });
  form.addEventListener("change", (event) => {
    if (event.target.name === "character_id" && event.target.value === QUICK_OPTION) {
      event.target.value = form.dataset.openCharacter || "";
      showQuickCharacter();
      return;
    }
    if (event.target.matches("[data-run-part]")) return;
    if (event.target.name === "character_id") openSheet(event.target.value, form.elements.party.value);
    if (event.target.name === "party") openSheet(form.elements.character_id.value, event.target.value);
  });
  // 누르면 다시 그려지는 측정대·기록부 버튼. 실제 시간 칸에서 이 버튼으로 옮겨 갈 때는 칸을 벗어날 때 다시 그리지 않는다(누른 버튼이 사라지지 않게).
  const CLOCK_CONTROLS = "[data-clock-start], [data-clock-stop], [data-clock-apply], [data-clock-reset], [data-band-start], [data-band-stop], [data-band-apply], [data-band-cancel], [data-manual-apply], [data-pick-chain], [data-run-clear], [data-gate], [data-quick-pick], [data-all-toggle]";

  form.addEventListener("focusout", (event) => {
    if (!event.target.matches?.("[data-run-part]")) return;
    const next = event.relatedTarget;
    if (next?.matches?.("[data-run-part]")) return;
    if (clockPressed || next?.closest?.(CLOCK_CONTROLS)) return;
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
    // 이미 잰 시간 칸에서 Enter = 바로 적기(폼 저장으로 가지 않게)
    if (event.key !== "Enter" || event.isComposing || !event.target.closest("[data-manual]")) return;
    event.preventDefault();
    applyManual();
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
    clockPressed = Boolean(event.target.closest(CLOCK_CONTROLS));
  });
  root.addEventListener("mouseup", () => {
    clockPressed = false;
  });
  root.addEventListener("click", (event) => {
    const clockStart = event.target.closest("[data-clock-start]");
    if (clockStart && !clockStart.disabled) {
      sfx("mid");
      startClock();
      return;
    }
    const clockStop = event.target.closest("[data-clock-stop]");
    if (clockStop && !clockStop.disabled) {
      sfx("low");
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
      sfx("tick");
      resetRoutePending();
      return;
    }
    // ① 층 트랙의 마름모: 그 쉬는 층 저장을 켜고 끈다(재는 중에는 잠김)
    const gate = event.target.closest("[data-gate]");
    if (gate && !gate.disabled) {
      const round = Number(gate.dataset.gate);
      const saves = savesOf(clockTarget);
      pickRoute(chainKey(saves.includes(round) ? saves.filter((save) => save !== round) : [...saves, round].sort((left, right) => left - right)));
      return;
    }
    const quickPick = event.target.closest("[data-quick-pick]");
    if (quickPick && !quickPick.disabled) {
      pickRoute(quickPick.dataset.quickPick);
      return;
    }
    // 기록부 "다시 재기" · 추천 루트 "이 루트 재기": 측정대를 그 루트로 맞추고 측정대로 간다
    const pickChain = event.target.closest("[data-pick-chain]");
    if (pickChain) {
      if (pickRoute(pickChain.dataset.pickChain)) plan.querySelector(".dj-desk")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
      return;
    }
    const runClear = event.target.closest("[data-run-clear]");
    if (runClear) {
      clearRun(runClear.dataset.runClear);
      return;
    }
    if (event.target.closest("[data-manual-apply]")) {
      applyManual();
      return;
    }
    if (event.target.closest("[data-all-toggle]")) {
      sfx("tick");
      showAllRoutes = !showAllRoutes;
      paintPlan();
      return;
    }
    // 명패 판 캐릭터 칩: 숨은 select 를 바꿔 기존 흐름(openSheet)으로 연다
    const charPick = event.target.closest("[data-char-pick]");
    if (charPick) {
      const select = form.elements.character_id;
      if (select.value === charPick.dataset.charPick && form.dataset.openCharacter === charPick.dataset.charPick) return;
      sfx("tick");
      select.value = charPick.dataset.charPick;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      paintCharChips();
      return;
    }
    if (event.target.closest("[data-char-new]")) {
      sfx("tick");
      showQuickCharacter();
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
    const bandCancel = event.target.closest("[data-band-cancel]");
    if (bandCancel) {
      cancelBandPending();
      return;
    }
    const routeItem = event.target.closest(".dj-route[data-chain]");
    if (routeItem) {
      const key = routeItem.dataset.chain;
      viewKey = viewKey === key ? null : key;
      // 스톱워치로 재는 중이 아니면 재는 대상도 이 루트로 맞춘다(기존 동작).
      if (viewKey != null && clock?.scope !== "route") {
        clockTarget = key;
        if (routePending) routePending.key = clockTarget;
      }
      sfx("tick");
      paintPlan();
      return;
    }
    if (event.target.closest("[data-best-reset]")) {
      viewKey = null;
      sfx("tick");
      paintPlan();
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

  // 통합 점수 기록 창(수련 점수 옆 버튼). #/dojo?log 로 오면 바로 연다.
  const scoreLog = mountDojoScoreLog(root.querySelector("[data-score-log]"));
  root.querySelector("[data-score-log-open]").addEventListener("click", () => {
    sfx("tick");
    if (!requireLogin("통합 점수 기록은 로그인한 계정에 저장돼요.", { sheet: carrySheet() })) return;
    scoreLog.open(form.dataset.openCharacter || form.elements.character_id?.value || "");
  });
  await load();
  // 로그인하러 가기 전에 적던 기록·시세가 있으면 되살린다(저장은 사용자가 누른다).
  const draft = takeDraft("dojo");
  if (draft && root.isConnected) {
    if (draft.sheet) {
      carried = draft.sheet;
      if (carried.party === "team" && form.elements.party.value !== "team") setParty("team");
      applyCarried();
    }
    if (draft.belt) {
      const input = belts.querySelector(`[data-price="${draft.belt.id}"]`);
      if (input) input.value = draft.belt.value;
    }
    const sheetNote = characters.length
      ? "로그인했어요. 적어 둔 기록을 채워 뒀어요. 저장할 캐릭터를 확인하고 저장을 눌러 주세요."
      : "로그인했어요. 적어 둔 기록을 채워 뒀어요. 캐릭터 이름만 적어 만든 뒤 저장을 눌러 주세요.";
    notify(draft.belt ? "로그인했어요. 적어 둔 허리띠 시세를 채워 뒀으니 저장을 눌러 주세요." : sheetNote, "info");
  }
  if (/[?&]log\b/.test(location.hash) && root.isConnected && isLoggedIn()) scoreLog.open(form.dataset.openCharacter || "");
}
