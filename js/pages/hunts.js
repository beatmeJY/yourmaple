import { translateDbError } from "../db-error.js";
import { escapeHtml, formatCount, readBig, readCount, sortByName } from "../format.js";
import { matchesPointLevel, matchesText, readLevelFilter } from "../filters.js";
import { BURST_COLORS, burstAt, celebrate, sfx } from "../effects.js";
import { asBig, expRatio, formatPerMinute, formatRatio, formatSigned, HUNT_UNITS, hourMeso, hourToUnit, measuredHour, mulDivRound, perHour, shortCount, timerGain } from "../hunt-calc.js";
import { findJob, jobDisplayName, jobStyle, normalizeJobName } from "../job-label.js";
import { loadMainCharacter, mainCharacterId } from "../profile.js";
import { getSupabase } from "../supabase-client.js";
import { notify } from "../toast.js";

const huntColumns =
  "id, character_id, character_name, job, level, potion_cost, leech_fee, exp_per_hour, meso_per_hour, title, memo, created_at";
// sql/066 실행 뒤에 생기는 실측 칸(걸린 초·얻은 EXP·메소). 실행 전이면 위 칸만 읽고 실측은 저장하지 않는다.
const measuredColumns = `${huntColumns}, measured_seconds, exp_gain, meso_gain`;

const jobFamilies = ["전사", "마법사", "궁수", "도적", "해적"];

function moneyClass(value) {
  if (value > 0n) return "is-gain";
  if (value < 0n) return "is-loss";
  return "";
}

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

function writeGrouped(input, amount) {
  input.value = asBig(amount).toLocaleString("ko-KR");
}

function groupDigits(text) {
  return text.replace(/\D/g, "").replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// 타이머 획득량 칸: 시작·끝 값을 적으면 차이로, 시작을 비우면 획득량을 직접 적는다.
function gainBoxHtml(kind, label, word) {
  return `<div class="hu-gain" data-gain="${kind}">
    <div class="hu-gain-head">
      <span class="hu-gain-title">${label}</span>
      <span class="hu-gain-mode" data-gain-mode>직접 입력</span>
      <b class="hu-gain-total" data-gain-total aria-live="polite"></b>
    </div>
    <div class="hu-gain-grid">
      <label class="hu-well"><span>시작할 때 내 ${word}</span><input data-timer-field="${kind}Start" inputmode="numeric" data-grouped autocomplete="off" placeholder="모르면 비워 두기" /></label>
      <span class="hu-gain-arrow" aria-hidden="true">→</span>
      <label class="hu-well"><span>끝날 때 내 ${word}</span><input data-timer-field="${kind}End" inputmode="numeric" data-grouped autocomplete="off" placeholder="끝나고 적기" /></label>
    </div>
    <label class="hu-well hu-gain-direct"><span data-gain-direct-label>획득 ${label} 직접 입력</span><input data-timer-field="${kind}" inputmode="numeric" data-grouped autocomplete="off" placeholder="0" /></label>
  </div>`;
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

function consumePendingAdd() {
  const [, queryString] = location.hash.split("?");
  if (!queryString) return false;
  history.replaceState(null, "", `${location.pathname}${location.search}#/hunts`);
  return new URLSearchParams(queryString).get("add") === "1";
}

// 사냥 타이머: 다른 화면에 갔다 오거나 새로고침해도 이어지도록 시작 시각을 브라우저에 기억한다.
const TIMER_KEY = "maple-note-hunt-timer";
const blankTimer = { running: false, startedAt: 0, before: 0, title: "", exp: "", meso: "", expStart: "", expEnd: "", mesoStart: "", mesoEnd: "", potion: "", leech: "" };

function readTimer() {
  try {
    const saved = JSON.parse(localStorage.getItem(TIMER_KEY) || "null");
    if (saved && typeof saved === "object") return { ...blankTimer, ...saved };
  } catch {
    // 저장이 막힌 브라우저는 이번 방문 동안만 기억한다.
  }
  return { ...blankTimer };
}

let timer = readTimer();

// 사냥 기록 목록의 환산 단위(1·15·60분). 이 기기에 기억한다.
const UNIT_KEY = "maple-note-hunt-unit";
function readUnit() {
  try {
    const saved = Number(localStorage.getItem(UNIT_KEY));
    if (HUNT_UNITS.some((unit) => unit.minutes === saved)) return saved;
  } catch {
    // 저장이 막힌 브라우저는 1시간 기준
  }
  return 60;
}
let huntUnit = readUnit();

function saveTimer() {
  try {
    localStorage.setItem(TIMER_KEY, JSON.stringify(timer));
  } catch {
    // 위와 같음
  }
}

function elapsedSeconds() {
  const running = timer.running ? Math.max(0, Math.floor((Date.now() - timer.startedAt) / 1000)) : 0;
  return Math.max(0, Math.floor(timer.before) + running);
}

function clockText(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const sec = seconds % 60;
  const two = (value) => String(value).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
}

function spanText(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const sec = seconds % 60;
  if (h) return `${h}시간 ${m}분`;
  if (m) return sec ? `${m}분 ${sec}초` : `${m}분`;
  return `${sec}초`;
}

export async function render(root) {
  root.innerHTML = `
    <div class="hu-page">
      <header class="ym-page-head hu-head">
        <h1>사냥 기록</h1>
        <p>직접 잰 시간과 획득량을 적거나 타이머로 기록하고, 1시간 기준 효율로 비교해요.</p>
      </header>
      <div class="hu-layout">
        <div class="hu-main">
          <section class="hu-timer" data-timer>
            <div class="hu-ring" data-ring>
              <span class="hu-ring-track" aria-hidden="true"></span>
              <span class="hu-ring-hole" aria-hidden="true"></span>
              <span class="hu-ring-dash" aria-hidden="true"></span>
              <span class="hu-ring-face"><strong data-clock>00:00</strong><span data-clock-state>대기</span></span>
            </div>
            <div class="hu-timer-body">
              <div class="hu-timer-copy">
                <h2>사냥 타이머</h2>
                <span data-timer-hint>시작할 때 내 경험치·메소를 적어 두고 시작을 누르세요. 1시간 기준 효율로 자동 환산해요.</span>
              </div>
              <label class="hu-well"><span>기록할 캐릭터</span><select data-timer-character aria-label="기록할 캐릭터"></select></label>
              <div class="hu-measure" role="group" aria-label="직접 측정 시간">
                <span>직접 잰 시간</span>
                <div class="hu-measure-presets">${[15,30,60].map(minutes => `<button type="button" class="hu-act" data-measured-minutes="${minutes}">${minutes}분</button>`).join("")}</div>
                <label class="hu-well"><span>측정 시간(분)</span><input data-measured-time inputmode="numeric" type="number" min="1" max="1440" placeholder="직접 입력" /></label>
              </div>
              <div class="hu-wells">
                <label class="hu-well is-wide"><span>사냥터</span><input data-timer-field="title" autocomplete="off" placeholder="예: 엘나스 헥터" /></label>
              </div>
              ${gainBoxHtml("exp", "EXP", "경험치")}
              ${gainBoxHtml("meso", "메소", "메소")}
              <div class="hu-wells hu-costs">
                <label class="hu-well"><span>측정 동안 쓴 물약값</span><input data-timer-field="potion" inputmode="numeric" data-grouped placeholder="없으면 0" /></label>
                <label class="hu-well"><span>측정 동안 쩔값 (+받음 / −지불)</span><input data-timer-field="leech" inputmode="text" data-grouped data-signed placeholder="내가 내면 -" /></label>
              </div>
              <p class="hu-timer-who" data-timer-who></p>
              <div class="hu-timer-actions">
                <button type="button" class="hu-go" data-timer-toggle>사냥 시작</button>
                <button type="button" class="hu-finish" data-timer-finish disabled>기록 남기기</button>
                <button type="button" class="hu-reset" data-timer-reset aria-label="타이머 초기화" title="타이머 초기화" hidden>↺</button>
              </div>
            </div>
          </section>

          <section class="hu-panel hu-form-panel" data-hunt-form-panel hidden>
            <form class="hu-form" id="hunt-form">
              <div class="hu-form-head">
                <h2 data-hunt-title>사냥 기록 추가</h2>
                <button class="hu-close" type="button" data-cancel-hunt aria-label="닫기">✕</button>
              </div>
              <label class="field span-all"><span>캐릭터</span><select name="character_id"></select></label>
              <label class="field span-all" data-name-field><span>캐릭터명</span><input name="character_name" autocomplete="off" /></label>
              <label class="field"><span>직업</span><input name="job" autocomplete="off" /></label>
              <label class="field"><span>레벨</span><input name="level" inputmode="numeric" autocomplete="off" /></label>
              <label class="field span-all"><span>사냥 이름</span><input name="title" autocomplete="off" placeholder="맵, 자리처럼 이 사냥을 구분하는 이름" /></label>
              <div class="hu-measured span-all" data-measured-group>
                <p class="hu-measured-head"><b>실제로 잰 값</b><span>선택 · 파풀 한 판처럼 걸린 시간과 얻은 양을 적으면 1분·15분·1시간 값이 자동으로 계산돼요</span></p>
                <label class="field"><span>걸린 시간(분)</span><input name="measured_min" inputmode="numeric" autocomplete="off" placeholder="예: 12" /></label>
                <label class="field"><span>초</span><input name="measured_sec" inputmode="numeric" autocomplete="off" placeholder="0" /></label>
                <label class="field"><span>얻은 경험치</span><input name="exp_gain" inputmode="numeric" data-grouped autocomplete="off" placeholder="예: 500,000" /></label>
                <label class="field"><span>얻은 메소</span><input name="meso_gain" inputmode="numeric" data-grouped autocomplete="off" placeholder="없으면 비움" /></label>
                <p class="hu-measured-note" data-measured-note hidden></p>
              </div>
              <label class="field"><span>분당 경험치</span><input name="exp_minute" inputmode="numeric" data-grouped autocomplete="off" placeholder="1시간 대신 가능" /></label>
              <label class="field"><span>1시간 경험치</span><input name="exp_hour" inputmode="numeric" data-grouped autocomplete="off" placeholder="분당 대신 가능" /></label>
              <label class="field span-all"><span>순메소</span><input name="meso_amount" inputmode="text" data-grouped data-signed autocomplete="off" placeholder="적자는 -. 없으면 비움" /></label>
              <label class="field"><span>1시간 쩔비</span><input name="leech_fee" inputmode="text" data-grouped data-signed autocomplete="off" placeholder="내가 내면 -" /></label>
              <label class="field"><span>1시간 물약</span><input name="potion_cost" inputmode="numeric" data-grouped autocomplete="off" placeholder="없으면 0" /></label>
              <div class="hu-net span-all" data-hunt-net>
                <span>1시간 메소</span>
                <strong data-hunt-net-value>0</strong>
                <p data-hunt-net-note>순메소 + 쩔비 − 물약</p>
              </div>
              <label class="field span-all"><span>메모</span><textarea name="memo" placeholder="누구에게 얼마를 받았는지처럼 남겨 둘 내용"></textarea></label>
              <p class="hu-form-hint span-all">분당과 1시간 중 하나만 적어도 다른 칸이 채워집니다. 둘 다 적었다면 마지막에 고친 칸을 저장합니다.</p>
              <div class="hu-form-actions span-all">
                <button class="hu-save" type="submit">저장</button>
                <button class="hu-cancel" type="button" data-cancel-hunt>취소</button>
              </div>
            </form>
          </section>


          <section class="hu-panel hu-records">
            <div class="hu-records-head">
              <div class="hu-records-title">
                <h2>사냥 기록</h2>
                <span data-unit-note></span>
              </div>
              <div class="hu-units" role="group" aria-label="환산 단위">
                ${HUNT_UNITS.map((unit) => `<button type="button" class="hu-unit" data-hunt-unit="${unit.minutes}">${unit.label}</button>`).join("")}
              </div>
              <button class="hu-add" type="button" data-add-hunt>+ 직접 적기</button>
            </div>
            <div class="hu-filters">
              <label class="hu-search"><span class="sr-only">검색</span><input data-hunt-search placeholder="사냥터, 캐릭터, 직업, 메모" autocomplete="off" /></label>
              <label class="hu-lv"><span>Lv</span><input data-hunt-min inputmode="numeric" placeholder="최소" aria-label="레벨 최소" /><i aria-hidden="true">~</i><input data-hunt-max inputmode="numeric" placeholder="최대" aria-label="레벨 최대" /></label>
            </div>
            <div class="hu-jobs" data-hunt-jobs>
              <div data-hunt-job-list>
                <p class="hunt-pick-empty">직업을 불러오는 중입니다.</p>
              </div>
            </div>
            <div class="hu-list" data-hunt-list></div>
          </section>
        </div>


      </div>
      <dialog class="quest-dialog" data-hunt-dialog>
        <div class="quest-dialog-head">
          <div>
            <p class="quest-dialog-kicker" data-memo-kicker></p>
            <h2>메모</h2>
          </div>
          <button class="icon-button" type="button" data-close-memo>닫기</button>
        </div>
        <div class="quest-dialog-body">
          <div class="quest-block">
            <p data-memo-body></p>
          </div>
        </div>
      </dialog>
    </div>
  `;

  const huntForm = root.querySelector("#hunt-form");
  const formPanel = root.querySelector("[data-hunt-form-panel]");
  const huntList = root.querySelector("[data-hunt-list]");

  let hunts = [];
  let characters = [];
  let accounts = [];
  let jobs = [];
  let pickedFamily = "";
  let pickedJobKey = "";
  let huntExpSource = "minute";
  let loadId = 0;
  let measuredReady = true;
  // 타이머 기록에 쓰는 캐릭터. 처음에는 대표 캐릭터.
  let timerCharacterId = "";

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

  // 직접 적기의 "실제로 잰 값": 모두 비우면 없음, 일부만 적으면 오류.
  function readMeasured(form) {
    const minText = form.elements.measured_min.value.trim();
    const secText = form.elements.measured_sec.value.trim();
    const expText = form.elements.exp_gain.value.trim();
    const mesoText = form.elements.meso_gain.value.trim();
    if (!minText && !secText && !expText && !mesoText) return { value: null };
    const minutes = readCount(minText, "걸린 시간(분)", 0);
    if (minutes.error) return minutes;
    const secs = readCount(secText, "초", 0);
    if (secs.error) return secs;
    if ((secs.value ?? 0) > 59) return { error: "초는 0~59로 적어 주세요." };
    const seconds = (minutes.value ?? 0) * 60 + (secs.value ?? 0);
    if (seconds < 1) return { error: "걸린 시간을 적어 주세요." };
    if (seconds > 86400) return { error: "걸린 시간은 24시간(1440분) 이하로 적어 주세요." };
    const exp = readBig(expText, "얻은 경험치", 1n);
    if (exp.error) return exp;
    if (exp.value == null) return { error: "얻은 경험치를 적어 주세요." };
    const meso = readBig(mesoText, "얻은 메소", 0n);
    if (meso.error) return meso;
    return { value: { seconds, exp: exp.value, meso: meso.value ?? 0n } };
  }

  // 실측을 적으면 1시간 EXP·순메소 칸은 실측으로 채우고 잠근다(두 값이 어긋나지 않게).
  function paintMeasured() {
    const group = huntForm.querySelector("[data-measured-group]");
    group.hidden = !measuredReady;
    const note = huntForm.querySelector("[data-measured-note]");
    const parsed = measuredReady ? readMeasured(huntForm) : { value: null };
    const filled = measuredReady && ["measured_min", "measured_sec", "exp_gain", "meso_gain"].some((name) => huntForm.elements[name].value.trim());
    for (const name of ["exp_minute", "exp_hour", "meso_amount"]) huntForm.elements[name].readOnly = filled;
    group.classList.toggle("is-on", filled);
    group.classList.toggle("is-error", Boolean(parsed.error));
    if (!filled) {
      note.hidden = true;
      return;
    }
    note.hidden = false;
    if (parsed.error) {
      note.textContent = parsed.error;
      return;
    }
    const hour = measuredHour(parsed.value);
    writeGrouped(huntForm.elements.exp_hour, hour.exp);
    huntExpSource = "hour";
    syncExp(huntForm, "hour");
    writeSigned(huntForm.elements.meso_amount, hour.meso);
    paintHuntNet();
    const ratio = expRatio({ measured_seconds: parsed.value.seconds, exp_gain: parsed.value.exp }, 1);
    note.textContent = `${spanText(parsed.value.seconds)}에 ${formatCount(parsed.value.exp)} EXP → 1분 ${formatRatio(ratio.numerator, ratio.denominator)} · 1시간 ${formatCount(hour.exp)}. 1시간 칸은 이 값으로 채워집니다.`;
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

  function paintHuntNet() {
    const value = huntForm.querySelector("[data-hunt-net-value]");
    const note = huntForm.querySelector("[data-hunt-net-note]");
    if (!value || !note) return;
    const gross = readMeso(huntForm.elements.meso_amount.value);
    const leech = gross.error ? gross : readLeech(huntForm.elements.leech_fee.value);
    const potion = leech.error ? leech : readBig(huntForm.elements.potion_cost.value, "1시간 물약", 0n);
    if (gross.error || leech.error || potion.error) {
      value.textContent = "-";
      value.className = "";
      note.textContent = gross.error || leech.error || potion.error;
      return;
    }
    const grossValue = gross.value ?? 0n;
    const leechValue = leech.value ?? 0n;
    const potionValue = potion.value ?? 0n;
    const net = hourMeso(grossValue, leechValue, potionValue);
    value.textContent = formatSigned(net);
    value.className = moneyClass(net);
    note.textContent = `순메소 ${formatSigned(grossValue)} + 쩔비 ${formatSigned(leechValue)} − 물약 ${formatCount(potionValue)}`;
  }

  function writeSigned(input, value) {
    if (value == null || value === "") {
      input.value = "";
      return;
    }
    const amount = asBig(value);
    if (amount === 0n) input.value = "";
    else writeGrouped(input, amount);
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

  function compareHuntCreated(left, right) {
    return String(right.created_at || "").localeCompare(String(left.created_at || ""));
  }

  function activeJobName() {
    if (!pickedJobKey) return "";
    const job = jobs.find((item) => item.id === pickedJobKey);
    if (job) return jobDisplayName(job);
    const hunt = hunts.find((row) => normalizeJobName(row.job) === pickedJobKey);
    return hunt?.job || "";
  }

  function huntsForJob(jobName) {
    const job = jobs.find((item) => item.id === pickedJobKey);
    const rows = job
      ? hunts.filter((row) => findJob(jobs, row.job)?.id === job.id)
      : jobName
        ? hunts.filter((row) => sameJob(row.job, jobName))
        : hunts;
    return [...rows].sort(compareHuntLevel);
  }

  function recordHunts() {
    const jobName = activeJobName();
    if (jobName) return huntsForJob(jobName);
    if (!pickedFamily) return [...hunts].sort(compareHuntCreated);
    return hunts.filter((row) => jobChoice(row.job || "").family === pickedFamily).sort(compareHuntLevel);
  }

  function familyStyle(family) {
    return jobStyle(jobs.find((job) => job.family === family));
  }

  function jobChoice(name) {
    const job = findJob(jobs, name);
    return {
      key: job?.id || normalizeJobName(name),
      name: job ? jobDisplayName(job) : name,
      family: job?.family || "기타",
      sort: job?.sort_order ?? 9999,
      style: jobStyle(job),
    };
  }

  function huntJobChoices() {
    const seen = new Map();
    for (const row of hunts) {
      const choice = jobChoice(row.job || "");
      if (!choice.key || seen.has(choice.key)) continue;
      seen.set(choice.key, choice);
    }
    const familyRank = new Map(jobFamilies.map((family, index) => [family, index]));
    return [...seen.values()].sort((left, right) => {
      const family = (familyRank.get(left.family) ?? 99) - (familyRank.get(right.family) ?? 99);
      if (family) return family;
      return left.sort - right.sort || left.name.localeCompare(right.name, "ko");
    });
  }

  function paintJobButtons() {
    const list = root.querySelector("[data-hunt-job-list]");
    const choices = huntJobChoices();
    const families = [...jobFamilies];
    if (choices.some((choice) => choice.family === "기타")) families.push("기타");
    if (pickedFamily && !families.includes(pickedFamily)) pickedFamily = "";
    const branch = pickedFamily ? choices.filter((choice) => choice.family === pickedFamily) : [];
    if (pickedJobKey && !branch.some((choice) => choice.key === pickedJobKey)) pickedJobKey = "";
    const familyButtons = families
      .map((family) => {
        const selected = family === pickedFamily;
        const style = familyStyle(family);
        const styleAttr = style ? ` style="${style}"` : "";
        return `<button class="hunt-job is-family${selected ? " is-selected" : ""}" type="button" data-job-family="${escapeHtml(family)}" aria-pressed="${selected ? "true" : "false"}"${styleAttr}>${escapeHtml(family)}</button>`;
      })
      .join("");
    const jobButtons = branch
      .map((choice) => {
        const selected = choice.key === pickedJobKey;
        const styleAttr = choice.style ? ` style="${choice.style}"` : "";
        return `<button class="hunt-job${selected ? " is-selected" : ""}" type="button" data-job-key="${escapeHtml(choice.key)}" aria-pressed="${selected ? "true" : "false"}"${styleAttr}>${escapeHtml(choice.name)}</button>`;
      })
      .join("");
    const branchBody = !pickedFamily
      ? ""
      : jobButtons
        ? `<div class="hunt-job-step"><span>직업</span><div class="hunt-job-row">${jobButtons}</div></div>`
        : `<p class="hunt-pick-empty">이 계열의 사냥 기록이 없습니다.</p>`;
    list.innerHTML = `<div class="hunt-job-steps">
      <div class="hunt-job-step"><span>계열</span><div class="hunt-job-row">${familyButtons}</div></div>
      ${branchBody}
    </div>`;
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
        hour: formatCount(hourValue),
        gross: formatSigned(grossValue),
        grossClass: moneyClass(grossValue),
        leech: formatSigned(leechValue),
        leechClass: moneyClass(leechValue),
        potion: formatCount(potionValue),
        meso: formatSigned(netValue),
        mesoClass: moneyClass(netValue),
      };
    } catch {
      return {
        minute: "-",
        hour: "-",
        gross: "-",
        grossClass: "",
        leech: "-",
        leechClass: "",
        potion: "-",
        meso: "-",
        mesoClass: "",
      };
    }
  }

  function paintCharacterOptions() {
    const select = huntForm.elements.character_id;
    const current = select.value;
    select.innerHTML = characterSelectHtml("직접 입력");
    if ([...select.options].some((option) => option.value === current)) select.value = current;
  }

  function showNameField(show) {
    huntForm.querySelector("[data-name-field]").hidden = !show;
  }

  function fillHuntForm(row) {
    formPanel.hidden = false;
    huntForm.dataset.editingId = row.id || "";
    root.querySelector("[data-hunt-title]").textContent = row.id ? "사냥 기록 수정" : "사냥 기록 추가";
    paintCharacterOptions();
    const linked = Boolean(row.character_id && characters.some((character) => character.id === row.character_id));
    huntForm.elements.character_id.value = linked ? row.character_id : "";
    showNameField(!linked);
    huntForm.elements.character_name.value = linked ? "" : row.character_name || "";
    huntForm.elements.job.value = row.job || "";
    huntForm.elements.level.value = row.level ? String(row.level) : "";
    if (row.exp_per_hour) {
      const hour = asBig(row.exp_per_hour);
      writeGrouped(huntForm.elements.exp_hour, hour);
      if (hour % 60n === 0n) {
        writeGrouped(huntForm.elements.exp_minute, hour / 60n);
        huntExpSource = "minute";
      } else {
        huntForm.elements.exp_minute.value = "";
        huntExpSource = "hour";
      }
    } else {
      huntForm.elements.exp_minute.value = "";
      huntForm.elements.exp_hour.value = "";
      huntExpSource = "minute";
    }
    if (row.potion_cost == null || row.potion_cost === "") huntForm.elements.potion_cost.value = "";
    else writeGrouped(huntForm.elements.potion_cost, asBig(row.potion_cost));
    writeSigned(huntForm.elements.leech_fee, row.leech_fee);
    writeSigned(huntForm.elements.meso_amount, row.meso_per_hour);
    paintHuntNet();
    huntForm.elements.title.value = row.title || "";
    huntForm.elements.memo.value = row.memo || "";
    const seconds = Number(row.measured_seconds);
    const hasMeasured = Number.isInteger(seconds) && seconds > 0 && row.exp_gain != null;
    huntForm.elements.measured_min.value = hasMeasured ? String(Math.floor(seconds / 60)) : "";
    huntForm.elements.measured_sec.value = hasMeasured && seconds % 60 ? String(seconds % 60) : "";
    huntForm.elements.exp_gain.value = hasMeasured ? asBig(row.exp_gain).toLocaleString("ko-KR") : "";
    huntForm.elements.meso_gain.value = hasMeasured && row.meso_gain != null && asBig(row.meso_gain) !== 0n ? asBig(row.meso_gain).toLocaleString("ko-KR") : "";
    paintMeasured();
    huntForm.elements.character_id.focus();
  }

  function closeHuntForm() {
    formPanel.hidden = true;
    huntForm.dataset.editingId = "";
    huntForm.reset();
    showNameField(true);
    huntExpSource = "minute";
    paintMeasured();
  }

  function filteredHunts() {
    const bounds = readLevelFilter(root.querySelector("[data-hunt-min]").value, root.querySelector("[data-hunt-max]").value);
    if (bounds.error) return bounds;
    return {
      rows: recordHunts()
        .filter((row) => {
          if (!matchesText(row, root.querySelector("[data-hunt-search]").value, ["title", "character_name", "job", "memo"])) return false;
          return matchesPointLevel(row.level, bounds.min, bounds.max);
        }),
    };
  }

  function hourRate(row) {
    try {
      return asBig(row.exp_per_hour);
    } catch {
      return 0n;
    }
  }

  function netMeso(row) {
    try {
      return hourMeso(asBig(row.meso_per_hour), asBig(row.leech_fee), asBig(row.potion_cost));
    } catch {
      return null;
    }
  }

  // 막대 폭(%)은 BigInt 비율을 0.1% 단위로 계산한다.
  function ratioPercent(value, max) {
    if (max <= 0n) return 0;
    return Number((value * 1000n) / max) / 10;
  }

  function paintHunts() {
    const filtered = filteredHunts();
    if (filtered.error) {
      huntList.innerHTML = `<p class="hu-empty">${escapeHtml(filtered.error)}</p>`;
      return;
    }
    if (!hunts.length) {
      huntList.innerHTML = `<p class="hu-empty">사냥 기록이 없습니다. 타이머로 재거나 "직접 적기"로 1시간 기준 기록을 남겨 보세요.</p>`;
      return;
    }
    if ((pickedFamily || pickedJobKey) && !recordHunts().length) {
      huntList.innerHTML = `<p class="hu-empty">${pickedJobKey ? "이 직업" : "이 계열"}의 사냥 기록이 없습니다.</p>`;
      return;
    }
    if (!filtered.rows.length) {
      huntList.innerHTML = `<p class="hu-empty">검색 결과가 없습니다. 검색어나 레벨 범위를 바꿔 보세요.</p>`;
      return;
    }
    const best = filtered.rows.reduce((max, row) => (hourRate(row) > max ? hourRate(row) : max), 0n);
    let index = 0;
    const rowHtml = (row, showJob) => huntRow(row, { best, index: index++, showJob });
    if (!pickedFamily && !pickedJobKey) {
      huntList.innerHTML = filtered.rows.map((row) => rowHtml(row, true)).join("");
      return;
    }
    const familyRank = new Map(jobFamilies.map((family, index) => [family, index]));
    const groups = [];
    for (const row of filtered.rows) {
      const choice = jobChoice(row.job || "직업 없음");
      let group = groups.find((item) => item.key === choice.key);
      if (!group) {
        group = { ...choice, rows: [] };
        groups.push(group);
      }
      group.rows.push(row);
    }
    groups.sort((left, right) => {
      const family = (familyRank.get(left.family) ?? 99) - (familyRank.get(right.family) ?? 99);
      if (family) return family;
      return left.sort - right.sort || left.name.localeCompare(right.name, "ko");
    });
    huntList.innerHTML = groups
      .map((group) => {
        const title = group.family === "기타" ? group.name : `${group.family} - ${group.name}`;
        const style = group.style ? ` style="${group.style}"` : "";
        return `<h3 class="hu-group"${style}><i aria-hidden="true"></i>${escapeHtml(title)}<span>${group.rows.length}</span></h3>${group.rows.map((row) => rowHtml(row, false)).join("")}`;
      })
      .join("");
  }

  function unitInfo() {
    return HUNT_UNITS.find((unit) => unit.minutes === huntUnit) ?? HUNT_UNITS[HUNT_UNITS.length - 1];
  }

  function paintUnits() {
    const unit = unitInfo();
    for (const button of root.querySelectorAll("[data-hunt-unit]")) {
      const on = Number(button.dataset.huntUnit) === unit.minutes;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-pressed", String(on));
    }
    const note = root.querySelector("[data-unit-note]");
    if (note) note.textContent = `${unit.label} 기준으로 환산 · 잰 시간이 있는 기록은 그 시간으로 계산 · 쩔비는 받으면 +, 내면 −`;
  }

  function huntRow(row, { best, index, showJob }) {
    const rate = hourRate(row);
    const unit = unitInfo();
    const ratio = (() => {
      try {
        return expRatio(row, unit.minutes);
      } catch {
        return { numerator: 0n, denominator: 1n };
      }
    })();
    const unitExp = mulDivRound(ratio.numerator, 1n, ratio.denominator);
    const measuredSeconds = Number(row.measured_seconds);
    const measured = Number.isInteger(measuredSeconds) && measuredSeconds > 0 && row.exp_gain != null
      ? `<span class="hu-row-measured" title="실제로 잰 값">실측 ${escapeHtml(spanText(measuredSeconds))} · ${escapeHtml(shortCount(asBig(row.exp_gain)))} EXP</span>`
      : "";
    const top = best > 0n && rate === best;
    const heading = String(row.title || "").trim() || row.character_name;
    const memo = String(row.memo || "").trim();
    const jobName = showJob ? jobChoice(row.job || "").name : "";
    const who = [row.character_name, row.level ? `Lv.${formatCount(row.level)}` : "", jobName && jobName !== row.character_name ? jobName : "", formatWhen(row.created_at)]
      .filter(Boolean)
      .join(" · ");
    const net = netMeso(row);
    const leech = (() => {
      try {
        return asBig(row.leech_fee);
      } catch {
        return 0n;
      }
    })();
    const unitLeech = hourToUnit(leech, unit.minutes);
    const fee = unitLeech === 0n ? "—" : `${unitLeech > 0n ? "+" : "−"}${shortCount(unitLeech > 0n ? unitLeech : -unitLeech)}`;
    const unitNet = net == null ? null : hourToUnit(net, unit.minutes);
    const memoButton = memo
      ? `<button class="hu-act" type="button" data-open-memo="${row.id}" title="${escapeHtml(memo.replace(/\s+/g, " ").slice(0, 80))}">메모</button>`
      : "";
    return `<article class="hu-row${top ? " is-best" : ""}" style="--i:${Math.min(index, 12)}">
      <span class="hu-row-name">
        <span class="hu-row-title"><strong>${escapeHtml(heading)}</strong>${top ? `<span class="hu-best">최고</span>` : ""}</span>
        <span class="hu-row-who">${escapeHtml(who)}</span>
        ${measured}
      </span>
      <span class="hu-row-exp">
        <span><b>${escapeHtml(shortCount(unitExp))}</b> EXP/${escapeHtml(unit.short)}</span>
        <span class="hu-bar"><i style="width:${Math.max(3, ratioPercent(rate, best))}%"></i></span>
        <small>${escapeHtml(unit.label)} ${escapeHtml(formatRatio(ratio.numerator, ratio.denominator))}</small>
      </span>
      <span class="hu-row-num"><small>메소/${escapeHtml(unit.short)}</small><strong class="${unitNet == null ? "" : moneyClass(unitNet)}" title="순메소 + 쩔비 − 물약">${unitNet == null ? "-" : escapeHtml(unitNet < 0n ? `−${shortCount(-unitNet)}` : shortCount(unitNet))}</strong></span>
      <span class="hu-row-num"><small>쩔비</small><strong class="${moneyClass(unitLeech)}">${escapeHtml(fee)}</strong></span>
      <span class="hu-row-acts">
        ${memoButton}
        <button class="hu-act" type="button" data-edit-hunt="${row.id}">수정</button>
        <button class="hu-act is-danger" type="button" data-delete-hunt="${row.id}">삭제</button>
      </span>
    </article>`;
  }

  // ── 기록 캐릭터 ─────────────────────────────────────────────

  function sortedCharacters() {
    return [...characters].sort(compareCharacter);
  }

  function timerCharacter() {
    return characters.find((character) => character.id === timerCharacterId) ?? null;
  }

  // ── 타이머 ─────────────────────────────────────────────────

  function paintTimerWho() {
    const who = root.querySelector("[data-timer-who]");
    if (!who) return;
    const character = timerCharacter();
    root.querySelector("[data-timer-character]").innerHTML = characterSelectHtml("캐릭터 직접 입력");
    root.querySelector("[data-timer-character]").value = timerCharacterId;
    who.innerHTML = character
      ? `기록할 캐릭터 <b>${escapeHtml(character.name)}</b>${character.level ? ` · Lv.${escapeHtml(formatCount(character.level))}` : ""}`
      : `캐릭터가 없으면 기록 남기기에서 직접 적어요.`;
  }

  function paintTimer() {
    const box = root.querySelector("[data-timer]");
    if (!box) return;
    const seconds = elapsedSeconds();
    box.classList.toggle("is-running", timer.running);
    box.querySelector("[data-ring]").style.setProperty("--deg", `${(seconds % 3600) / 10}deg`);
    box.querySelector("[data-clock]").textContent = clockText(seconds);
    box.querySelector("[data-clock-state]").textContent = timer.running ? "사냥 중" : seconds ? "일시정지" : "대기";
    box.querySelector("[data-timer-hint]").textContent = timer.running
      ? "타이머가 돌고 있어요. 끝나면 지금 내 경험치·메소(또는 획득량)를 적고 기록을 남기세요."
      : seconds
        ? `${spanText(seconds)} 동안 사냥했어요. 끝날 때 내 경험치·메소(또는 획득량)를 적고 기록을 남기세요.`
        : "시작할 때 내 경험치·메소를 적어 두고 시작을 누르세요. 1시간 기준 효율로 자동 환산해요.";
    box.querySelector("[data-timer-toggle]").textContent = timer.running ? "일시정지" : seconds ? "다시 시작" : "사냥 시작";
    box.querySelector("[data-timer-finish]").disabled = !seconds;
    box.querySelector("[data-timer-reset]").hidden = !seconds;
  }

  function readTimerGain(kind, label, minimum) {
    return timerGain({ start: timer[`${kind}Start`], end: timer[`${kind}End`], direct: timer[kind] }, label, minimum);
  }

  function focusGainField(kind, gain) {
    const name = gain.mode === "range" ? (gain.field === "start" ? `${kind}Start` : `${kind}End`) : kind;
    root.querySelector(`[data-timer-field="${name}"]`)?.focus();
  }

  // 시작 값이 있으면 직접 입력 칸을 잠그고 끝 − 시작을 보여 준다.
  function paintGain(kind) {
    const box = root.querySelector(`[data-gain="${kind}"]`);
    if (!box) return;
    const label = kind === "exp" ? "EXP" : "메소";
    const gain = readTimerGain(kind, label, kind === "exp" ? 1n : 0n);
    const range = gain.mode === "range";
    const direct = box.querySelector(`[data-timer-field="${kind}"]`);
    box.classList.toggle("is-range", range);
    box.classList.toggle("is-error", Boolean(gain.error));
    box.querySelector("[data-gain-mode]").textContent = range ? "시작·끝으로 계산" : "직접 입력";
    box.querySelector("[data-gain-direct-label]").textContent = range ? `획득 ${label} (자동 계산)` : `획득 ${label} 직접 입력`;
    direct.disabled = range;
    if (range) direct.value = gain.value != null ? formatCount(gain.value) : "";
    else if (direct.value !== (timer[kind] || "")) direct.value = timer[kind] || "";
    const total = box.querySelector("[data-gain-total]");
    const before = total.textContent;
    total.textContent = gain.error ? "확인 필요" : gain.value != null ? `+${formatCount(gain.value)}` : "";
    total.title = gain.error || "";
    if (total.textContent && total.textContent !== before && !gain.error) {
      total.classList.remove("is-pop");
      void total.offsetWidth;
      total.classList.add("is-pop");
    }
  }

  function paintGains() {
    paintGain("exp");
    paintGain("meso");
  }

  function fillTimerFields() {
    if (!timer.running && timer.before > 0 && timer.before % 60 === 0) root.querySelector("[data-measured-time]").value = String(timer.before / 60);
    for (const input of root.querySelectorAll("[data-timer-field]")) input.value = timer[input.dataset.timerField] || "";
    paintGains();
  }

  let tick = 0;
  function startTicking() {
    clearInterval(tick);
    tick = setInterval(() => {
      if (!root.isConnected) {
        clearInterval(tick);
        return;
      }
      paintTimer();
    }, 1000);
  }

  function toggleTimer() {
    if (timer.running) {
      timer = { ...timer, running: false, before: elapsedSeconds(), startedAt: 0 };
      sfx("uncheck");
    } else {
      timer = { ...timer, running: true, startedAt: Date.now() };
      sfx("check");
    }
    saveTimer();
    paintTimer();
  }

  function resetTimer() {
    if (elapsedSeconds() >= 60 && !window.confirm("타이머를 0으로 되돌릴까요? 적어 둔 획득량은 남겨 둡니다.")) return;
    timer = { ...timer, running: false, startedAt: 0, before: 0 };
    root.querySelector("[data-measured-time]").value = "";
    saveTimer();
    sfx("tick");
    paintTimer();
  }

  async function finishTimer(button) {
    const measuredInput = root.querySelector("[data-measured-time]");
    if (!measuredInput.checkValidity()) { measuredInput.reportValidity(); return; }
    const seconds = elapsedSeconds();
    if (!seconds) return;
    const exp = readTimerGain("exp", "EXP", 1n);
    if (exp.error || exp.value == null) {
      notify(exp.error || (exp.mode === "range" ? "끝날 때 내 경험치를 적어 주세요." : "획득 EXP를 적어 주세요."), "error");
      focusGainField("exp", exp);
      return;
    }
    const meso = readTimerGain("meso", "메소", 0n);
    if (meso.error || (meso.mode === "range" && meso.value == null)) {
      notify(meso.error || "끝날 때 내 메소를 적어 주세요.", "error");
      focusGainField("meso", meso);
      return;
    }
    const expHour = perHour(exp.value, seconds);
    const mesoHour = perHour(meso.value ?? 0n, seconds);
    const title = String(timer.title || "").trim() || "새 사냥";
    const rangeNote = (kind, gain) => gain.mode === "range" ? `(${formatCount(readBig(timer[`${kind}Start`], "", 0n).value)}→${formatCount(readBig(timer[`${kind}End`], "", 0n).value)})` : "";
    const memo = `타이머 ${spanText(seconds)} · EXP ${formatCount(exp.value)}${rangeNote("exp", exp)} · 메소 ${formatCount(meso.value ?? 0n)}${rangeNote("meso", meso)}`;
    const potion = readBig(timer.potion, "물약값", 0n);
    const leech = readLeech(timer.leech);
    if (potion.error || leech.error) { notify(potion.error || leech.error, "error"); return; }
    if (timer.running) { timer = { ...timer, running: false, before: seconds, startedAt: 0 }; saveTimer(); paintTimer(); }
    const character = timerCharacter();
    const fullMemo = `${memo} · 물약 ${formatCount(potion.value ?? 0n)} · 쩔비 ${formatSigned(leech.value ?? 0n)}`;
    const potionHour = perHour(potion.value ?? 0n, seconds);
    const leechHour = perHour(leech.value ?? 0n, seconds);
    // 캐릭터를 골랐으면 타이머 값만으로 저장할 수 있으니 바로 남긴다. 직접 입력(이름·레벨 필요)일 때만 저장 칸을 연다.
    if (!character?.level) {
      openForm({ id: "", character_id: character?.id, job: character?.job, level: character?.level,
        title, exp_per_hour: expHour.toString(), meso_per_hour: mesoHour.toString(),
        potion_cost: potionHour.toString(), leech_fee: leechHour.toString(), memo: fullMemo });
      notify(character ? "캐릭터 레벨이 없어 저장 칸을 열었습니다. 레벨을 적고 저장해 주세요." : "캐릭터명과 레벨을 적고 저장해 주세요. 1시간 기준 값은 채워 두었습니다.", "info");
      return;
    }
    await saveTimerRecord(button, {
      character_id: character.id,
      character_name: character.name,
      job: character.job?.trim() || null,
      level: character.level,
      potion_cost: potionHour.toString(),
      leech_fee: leechHour.toString(),
      exp_per_hour: expHour.toString(),
      meso_per_hour: mesoHour.toString(),
      title,
      memo: fullMemo,
      ...(measuredReady && seconds <= 86400 ? { measured_seconds: seconds, exp_gain: exp.value.toString(), meso_gain: (meso.value ?? 0n).toString() } : {}),
    });
  }

  // 타이머 기록 바로 저장: 성공하면 타이머를 비우고, 알림의 "되돌리기"로 방금 기록을 지우고 값을 돌려놓는다.
  let finishing = false;
  async function saveTimerRecord(button, payload) {
    if (finishing) return;
    finishing = true;
    button.disabled = true;
    const before = { ...timer };
    const measured = root.querySelector("[data-measured-time]").value;
    const previousBest = hunts.reduce((max, row) => (hourRate(row) > max ? hourRate(row) : max), 0n);
    let created = null;
    try {
      const supabase = await getSupabase();
      const { data, error } = await supabase.from("hunts").insert(payload).select("id").single();
      if (error) {
        if (root.isConnected) notify(translateDbError(error), "error");
        return;
      }
      created = data;
      // 화면을 떠났어도 같은 측정이 두 번 저장되지 않게 타이머는 먼저 비운다(사냥터 이름은 다음 측정에 그대로 둔다).
      timer = { ...blankTimer, title: timer.title };
      saveTimer();
    } finally {
      finishing = false;
      if (root.isConnected) paintTimer();
    }
    if (!created || !root.isConnected) return;
    root.querySelector("[data-measured-time]").value = "";
    fillTimerFields();
    paintTimer();
    closeHuntForm();
    cheer(button, BigInt(payload.exp_per_hour), previousBest, payload.title);
    notify("사냥 기록을 저장했습니다.", "info", { label: "되돌리기", onClick: () => undoTimerRecord(created.id, before, measured) });
    await loadAll();
  }

  async function undoTimerRecord(id, before, measured) {
    const supabase = await getSupabase();
    const { error } = await supabase.from("hunts").delete().eq("id", id);
    if (error) {
      notify(translateDbError(error), "error");
      return;
    }
    // 그사이 새 측정을 시작하지 않았을 때만 방금 값으로 되돌려, 고쳐서 다시 남길 수 있게 한다.
    const restore = !timer.running && elapsedSeconds() === 0;
    if (restore) {
      timer = { ...before, running: false, startedAt: 0 };
      saveTimer();
    }
    notify(restore ? "방금 기록을 지우고 타이머 값을 되돌렸습니다." : "방금 기록을 지웠습니다.", "info");
    if (!root.isConnected) return;
    if (restore) {
      root.querySelector("[data-measured-time]").value = measured;
      fillTimerFields();
      paintTimer();
    }
    await loadAll();
  }

  function cheer(target, rate, previousBest, title) {
    const record = previousBest > 0n && rate > previousBest;
    sfx(record ? "fanfare" : "check");
    burstAt(target, BURST_COLORS.success, 30, 1.1);
    if (record) setTimeout(() => celebrate("최고 기록!", `${title} · ${shortCount(rate)} EXP/h`), 200);
  }

  function openMemo(id) {
    const hunt = hunts.find((item) => item.id === id);
    const dialog = root.querySelector("[data-hunt-dialog]");
    if (!hunt?.memo || !dialog) return;
    const bits = [hunt.title, hunt.character_name, hunt.job, hunt.level ? `${formatCount(hunt.level)}레벨` : ""].filter(Boolean);
    root.querySelector("[data-memo-kicker]").textContent = bits.join(" · ");
    root.querySelector("[data-memo-body]").textContent = hunt.memo;
    if (!dialog.open) dialog.showModal();
  }

  function readHuntForm() {
    const characterId = huntForm.elements.character_id.value;
    let characterName = "";
    if (characterId) {
      const character = characters.find((item) => item.id === characterId);
      if (!character) return { error: "캐릭터를 다시 선택해 주세요." };
      characterName = character.name;
    } else {
      characterName = huntForm.elements.character_name.value.trim();
      if (!characterName) return { error: "캐릭터명을 입력해 주세요." };
    }
    const level = readCount(huntForm.elements.level.value, "레벨", 1);
    if (level.error) return level;
    if (level.value == null) return { error: "레벨을 입력해 주세요." };
    if (level.value > 200) return { error: "레벨은 200 이하여야 합니다." };
    const title = huntForm.elements.title.value.trim();
    if (!title) return { error: "사냥 이름을 입력해 주세요." };
    const measured = measuredReady ? readMeasured(huntForm) : { value: null };
    if (measured.error) return measured;
    const measuredHourValue = measured.value ? measuredHour(measured.value) : null;
    const exp = measuredHourValue ? { value: measuredHourValue.exp } : readHourExp(huntForm, huntExpSource);
    if (exp.error) return exp;
    const potion = readBig(huntForm.elements.potion_cost.value, "1시간 물약", 0n);
    if (potion.error) return potion;
    const leech = readLeech(huntForm.elements.leech_fee.value);
    if (leech.error) return leech;
    const meso = measuredHourValue ? { value: measuredHourValue.meso } : readMeso(huntForm.elements.meso_amount.value);
    if (meso.error) return meso;
    return {
      value: {
        character_id: characterId || null,
        character_name: characterName,
        job: huntForm.elements.job.value.trim() || null,
        level: level.value,
        potion_cost: (potion.value ?? 0n).toString(),
        leech_fee: (leech.value ?? 0n).toString(),
        exp_per_hour: exp.value.toString(),
        meso_per_hour: meso.value.toString(),
        title,
        memo: huntForm.elements.memo.value.trim() || null,
        // 실측을 지우고 저장하면 예전처럼 1시간 값만 남는다.
        ...(measuredReady
          ? {
              measured_seconds: measured.value?.seconds ?? null,
              exp_gain: measured.value ? measured.value.exp.toString() : null,
              meso_gain: measured.value ? measured.value.meso.toString() : null,
            }
          : {}),
      },
    };
  }

  async function loadAll() {
    const current = ++loadId;
    if (!hunts.length) huntList.innerHTML = `<p class="hu-empty">불러오는 중입니다.</p>`;
    const supabase = await getSupabase();
    let [huntResult, firstCharacters, accountResult, jobResult] = await Promise.all([
      supabase.from("hunts").select(measuredReady ? measuredColumns : huntColumns).order("created_at", { ascending: false }),
      supabase.from("characters").select("id, account_id, name, job, level, exp"),
      supabase.from("accounts").select("id, name").order("name"),
      supabase.from("jobs").select("id, family, name, color, color_dark, sort_order").order("sort_order"),
      loadMainCharacter(),
    ]);
    // sql/066 실행 전이면 실측 칸을 빼고 다시 읽는다.
    if (huntResult.error && measuredReady && /measured_seconds|exp_gain|meso_gain/i.test(`${huntResult.error.message || ""}`)) {
      measuredReady = false;
      huntResult = await supabase.from("hunts").select(huntColumns).order("created_at", { ascending: false });
    }
    // sql/029 실행 전이면 exp 칸을 빼고 캐릭터를 읽는다.
    const characterResult = firstCharacters.error && /\bexp\b/i.test(`${firstCharacters.error.message || ""}`)
      ? await supabase.from("characters").select("id, account_id, name, job, level")
      : firstCharacters;
    if (current !== loadId || !huntList.isConnected) return;
    const error = huntResult.error || characterResult.error || accountResult.error;
    if (error) {
      hunts = [];
      characters = [];
      accounts = [];
      jobs = [];
      huntList.innerHTML = "";
      notify(translateDbError(error), "error");
      return;
    }
    hunts = huntResult.data ?? [];
    characters = characterResult.data ?? [];
    accounts = sortByName(accountResult.data ?? []);
    jobs = jobResult.error ? [] : (jobResult.data ?? []);
    if (jobResult.error) notify(translateDbError(jobResult.error), "error");
    if (!characters.some((character) => character.id === timerCharacterId)) {
      const main = mainCharacterId();
      timerCharacterId = characters.some((character) => character.id === main) ? main : (sortedCharacters()[0]?.id ?? "");
    }
    paintJobButtons();
    paintCharacterOptions();
    paintHunts();
    paintTimerWho();
    paintMeasured();
  }

  function openForm(row) {
    fillHuntForm(row);
    // 한 열 배치(좁은 화면)에서는 폼이 목록 아래에 있으므로 보이게 옮긴다.
    formPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  const memoDialog = root.querySelector("[data-hunt-dialog]");
  memoDialog.addEventListener("click", (event) => {
    if (event.target === memoDialog) memoDialog.close();
  });
  root.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-memo]")) memoDialog.close();
  });

  root.addEventListener("input", (event) => {
    if (event.target.closest("[data-grouped]")) applyGrouped(event.target);
    const timerField = event.target.closest("[data-timer-field]");
    if (timerField) {
      timer = { ...timer, [timerField.dataset.timerField]: timerField.value };
      saveTimer();
      const gainBox = timerField.closest("[data-gain]");
      if (gainBox) paintGain(gainBox.dataset.gain);
    }
    if (event.target.form === huntForm && ["meso_amount", "leech_fee", "potion_cost"].includes(event.target.name)) {
      paintHuntNet();
    }
    if (event.target.form === huntForm && ["measured_min", "measured_sec", "exp_gain", "meso_gain"].includes(event.target.name)) paintMeasured();
    if (event.target.form === huntForm && (event.target.name === "exp_minute" || event.target.name === "exp_hour") && !event.target.readOnly) {
      huntExpSource = event.target.name === "exp_minute" ? "minute" : "hour";
      syncExp(huntForm, huntExpSource);
    }
    if (event.target.closest("[data-hunt-search], [data-hunt-min], [data-hunt-max]")) paintHunts();
  });

  function setMeasuredMinutes(value) {
    const minutes = Number(value);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) { notify("측정 시간은 1~1440분으로 입력해 주세요.", "error"); return; }
    timer = { ...timer, running: false, startedAt: 0, before: minutes * 60 };
    root.querySelector("[data-measured-time]").value = String(minutes);
    saveTimer(); paintTimer();
  }

  root.addEventListener("change", (event) => {
    if (event.target.matches("[data-timer-character]")) { timerCharacterId = event.target.value; paintTimerWho(); }
    if (event.target.matches("[data-measured-time]")) setMeasuredMinutes(event.target.value);
    if (event.target === huntForm.elements.character_id) {
      const character = characters.find((item) => item.id === event.target.value);
      showNameField(!character);
      if (!character) return;
      huntForm.elements.job.value = character.job || "";
      if (character.level) huntForm.elements.level.value = String(character.level);
    }
  });

  root.addEventListener("click", async (event) => {
    const measured = event.target.closest("[data-measured-minutes]");
    if (measured) setMeasuredMinutes(measured.dataset.measuredMinutes);
    if (event.target.closest("[data-add-hunt]")) {
      notify("", "info");
      sfx("tick");
      const character = timerCharacter();
      openForm(character ? { id: "", character_id: character.id, job: character.job, level: character.level } : { id: "" });
    }
    if (event.target.closest("[data-cancel-hunt]")) closeHuntForm();

    const unitButton = event.target.closest("[data-hunt-unit]");
    if (unitButton) {
      huntUnit = Number(unitButton.dataset.huntUnit);
      try {
        localStorage.setItem(UNIT_KEY, String(huntUnit));
      } catch {
        // 저장이 막혀도 이번 화면에서는 바뀐다.
      }
      sfx("tick");
      paintUnits();
      paintHunts();
    }
    if (event.target.closest("[data-timer-toggle]")) toggleTimer();
    if (event.target.closest("[data-timer-reset]")) resetTimer();
    const finish = event.target.closest("[data-timer-finish]");
    if (finish) await finishTimer(finish);

    const memoButton = event.target.closest("[data-open-memo]");
    if (memoButton) openMemo(memoButton.dataset.openMemo);

    const familyButton = event.target.closest("[data-job-family]");
    if (familyButton) {
      const family = familyButton.dataset.jobFamily;
      if (pickedFamily === family) {
        pickedFamily = "";
        pickedJobKey = "";
      } else {
        pickedFamily = family;
        pickedJobKey = "";
      }
      paintJobButtons();
      paintHunts();
    }

    const jobButton = event.target.closest("[data-job-key]");
    if (jobButton) {
      const key = jobButton.dataset.jobKey;
      pickedJobKey = pickedJobKey === key ? "" : key;
      paintJobButtons();
      paintHunts();
    }

    const editHunt = event.target.closest("[data-edit-hunt]");
    if (editHunt) {
      const hunt = hunts.find((item) => item.id === editHunt.dataset.editHunt);
      if (hunt) openForm(hunt);
    }

    const deleteHunt = event.target.closest("[data-delete-hunt]");
    if (deleteHunt) {
      const hunt = hunts.find((item) => item.id === deleteHunt.dataset.deleteHunt);
      if (!hunt) return;
      const label = hunt.title?.trim() || `${hunt.character_name} ${hunt.level}레벨`;
      if (!window.confirm(`${label} 사냥 기록을 삭제할까요?`)) return;
      deleteHunt.disabled = true;
      const supabase = await getSupabase();
      const { error } = await supabase.from("hunts").delete().eq("id", hunt.id);
      if (!huntList.isConnected) return;
      if (error) {
        deleteHunt.disabled = false;
        notify(translateDbError(error), "error");
        return;
      }
      notify("삭제했습니다.", "info");
      await loadAll();
    }
  });

  huntForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const parsed = readHuntForm();
    if (parsed.error) {
      notify(parsed.error, "error");
      return;
    }
    const button = huntForm.querySelector("[type=submit]");
    button.disabled = true;
    let saved = false;
    const editingId = huntForm.dataset.editingId;
    const others = editingId ? hunts.filter((row) => row.id !== editingId) : hunts;
    const previousBest = others.reduce((max, row) => (hourRate(row) > max ? hourRate(row) : max), 0n);
    try {
      const supabase = await getSupabase();
      const query = editingId
        ? supabase.from("hunts").update(parsed.value).eq("id", editingId)
        : supabase.from("hunts").insert(parsed.value);
      const { error } = await query;
      if (!huntList.isConnected) return;
      if (error) {
        notify(translateDbError(error), "error");
        return;
      }
      saved = true;
    } finally {
      button.disabled = false;
    }
    if (!saved) return;
    cheer(button, BigInt(parsed.value.exp_per_hour), previousBest, parsed.value.title);
    closeHuntForm();
    notify("사냥 기록을 저장했습니다.", "info");
    await loadAll();
  });

  const shouldOpenAdd = consumePendingAdd();
  paintUnits();
  fillTimerFields();
  paintTimer();
  startTicking();
  await loadAll();
  if (shouldOpenAdd && root.isConnected) {
    const character = timerCharacter();
    openForm(character ? { id: "", character_id: character.id, job: character.job, level: character.level } : { id: "" });
  }
}
