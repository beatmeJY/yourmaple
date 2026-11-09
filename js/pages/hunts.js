import { translateDbError } from "../db-error.js";
import { escapeHtml, formatCount, readBig, readCount, sortByName } from "../format.js";
import { matchesPointLevel, matchesText, readLevelFilter } from "../filters.js";
import { BURST_COLORS, burstAt, celebrate, sfx } from "../effects.js";
import { asBig, expRatio, formatPerMinute, formatRatio, formatSigned, HUNT_UNITS, hourMeso, hourToUnit, mulDivRound, perHour, shortCount, timerGain } from "../hunt-calc.js";
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
// characterId: null이면 대표 캐릭터, ""이면 직접 입력(charName·level·job). editingId가 있으면 그 기록을 고치는 중.
const blankTimer = { running: false, startedAt: 0, before: 0, title: "", exp: "", meso: "", expStart: "", expEnd: "", mesoStart: "", mesoEnd: "", potion: "", leech: "", memo: "", characterId: null, charName: "", level: "", job: "", editingId: "" };

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
        <p>타이머로 재거나 잰 시간을 직접 적어 기록하고, 1분·15분·1시간 기준으로 바꿔 비교해요.</p>
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
                <h2 data-timer-heading>사냥 기록 남기기</h2>
                <span data-timer-hint>타이머로 재거나 잰 시간을 직접 적고, 얻은 경험치·메소를 적어 기록을 남기세요.</span>
              </div>
              <div class="hu-editing" data-editing hidden>
                <span>기록 수정 중 · <b data-editing-title></b></span>
                <button type="button" class="hu-act" data-cancel-edit>수정 취소</button>
              </div>
              <div class="hu-timer-grid">
              <div class="hu-timer-col">
              <label class="hu-well"><span>기록할 캐릭터</span><select data-timer-character aria-label="기록할 캐릭터"></select></label>
              <div class="hu-wells hu-direct-who" data-direct-who hidden>
                <label class="hu-well" data-direct-field="charName"><span>캐릭터명</span><input data-timer-field="charName" autocomplete="off" placeholder="이름" /></label>
                <label class="hu-well" data-direct-field="level"><span>레벨</span><input data-timer-field="level" inputmode="numeric" autocomplete="off" placeholder="예: 120" /></label>
                <label class="hu-well" data-direct-field="job"><span>직업</span><input data-timer-field="job" autocomplete="off" placeholder="선택" /></label>
              </div>
              <div class="hu-measure" role="group" aria-label="잰 시간">
                <span>잰 시간 <small>타이머 대신 직접 적어도 돼요 · 파풀 한 판처럼 짧은 기록은 분·초로</small></span>
                <div class="hu-measure-presets">${[15,30,60].map(minutes => `<button type="button" class="hu-act" data-measured-minutes="${minutes}">${minutes}분</button>`).join("")}</div>
                <div class="hu-measure-time">
                  <label class="hu-well"><span>분</span><input data-measured-time inputmode="numeric" autocomplete="off" placeholder="0" /></label>
                  <label class="hu-well"><span>초</span><input data-measured-sec inputmode="numeric" autocomplete="off" placeholder="0" /></label>
                </div>
              </div>
              <div class="hu-wells">
                <label class="hu-well is-wide"><span>사냥터</span><input data-timer-field="title" autocomplete="off" placeholder="예: 엘나스 헥터, 파풀라투스" /></label>
              </div>
              </div>
              <div class="hu-timer-col">
              ${gainBoxHtml("exp", "EXP", "경험치")}
              ${gainBoxHtml("meso", "메소", "메소")}
              <div class="hu-wells hu-costs">
                <label class="hu-well"><span>그동안 쓴 물약값</span><input data-timer-field="potion" inputmode="numeric" data-grouped placeholder="없으면 0" /></label>
                <label class="hu-well"><span>그동안 쩔값 (+받음 / −지불)</span><input data-timer-field="leech" inputmode="text" data-grouped data-signed placeholder="내가 내면 -" /></label>
                <label class="hu-well is-wide"><span>메모</span><textarea data-timer-field="memo" rows="2" placeholder="누구에게 얼마를 받았는지처럼 남겨 둘 내용"></textarea></label>
              </div>
              </div>
              </div>
              <p class="hu-preview" data-timer-preview aria-live="polite"></p>
              <p class="hu-timer-who" data-timer-who></p>
              <div class="hu-timer-actions">
                <button type="button" class="hu-go" data-timer-toggle>사냥 시작</button>
                <button type="button" class="hu-finish" data-timer-finish disabled>기록 남기기</button>
                <button type="button" class="hu-reset" data-timer-reset aria-label="시간 초기화" title="시간 초기화" hidden>↺</button>
              </div>
            </div>
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

  const huntList = root.querySelector("[data-hunt-list]");

  let hunts = [];
  let characters = [];
  let accounts = [];
  let jobs = [];
  let pickedFamily = "";
  let pickedJobKey = "";
  let loadId = 0;
  let measuredReady = true;
  // 타이머 기록에 쓰는 캐릭터. 처음에는 대표 캐릭터.
  let timerCharacterId = "";

  function readSigned(amountText, label, minusHint) {
    const text = String(amountText ?? "").trim().replaceAll(",", "").replaceAll(" ", "");
    if (!text || text === "-") return { value: 0n };
    if (!/^-?\d+$/.test(text)) return { error: `${label}에는 숫자만 입력해 주세요. ${minusHint}` };
    if (text.replace("-", "").length > 40) return { error: `${label} 숫자가 너무 큽니다.` };
    return { value: BigInt(text) };
  }

  function readLeech(amountText) {
    return readSigned(amountText, "1시간 쩔비", "내가 내는 쩔비는 -를 붙입니다.");
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

  // 저장해 둔 선택(직접 입력 포함)이 있으면 그것, 없으면 대표 캐릭터.
  function pickTimerCharacter() {
    if (timer.characterId === "") {
      timerCharacterId = "";
      return;
    }
    if (timer.characterId && characters.some((character) => character.id === timer.characterId)) {
      timerCharacterId = timer.characterId;
      return;
    }
    const main = mainCharacterId();
    timerCharacterId = characters.some((character) => character.id === main) ? main : (sortedCharacters()[0]?.id ?? "");
  }

  // ── 기록 칸(타이머) ─────────────────────────────────────────

  // 캐릭터를 직접 입력하면 이름·레벨·직업 칸을, 레벨이 없는 캐릭터면 레벨 칸만 보여 준다.
  function paintTimerWho() {
    const who = root.querySelector("[data-timer-who]");
    if (!who) return;
    const character = timerCharacter();
    const select = root.querySelector("[data-timer-character]");
    select.innerHTML = characterSelectHtml("캐릭터 직접 입력");
    select.value = timerCharacterId;
    const needName = !character;
    const needLevel = !character?.level;
    root.querySelector("[data-direct-who]").hidden = !needLevel;
    root.querySelector('[data-direct-field="charName"]').hidden = !needName;
    root.querySelector('[data-direct-field="job"]').hidden = !needName;
    root.querySelector('[data-direct-field="level"]').classList.toggle("is-wide", !needName);
    who.innerHTML = character
      ? `기록할 캐릭터 <b>${escapeHtml(character.name)}</b>${character.level ? ` · Lv.${escapeHtml(formatCount(character.level))}` : ` · <span>레벨을 적어 주세요</span>`}`
      : `캐릭터명과 레벨을 적어 주세요.`;
  }

  function hasDraft() {
    return elapsedSeconds() > 0 || ["exp", "meso", "expStart", "expEnd", "mesoStart", "mesoEnd", "potion", "leech", "memo"].some((key) => String(timer[key] || "").trim());
  }

  function paintTimer() {
    const box = root.querySelector("[data-timer]");
    if (!box) return;
    const seconds = elapsedSeconds();
    const editing = hunts.find((row) => row.id === timer.editingId);
    box.classList.toggle("is-running", timer.running);
    box.classList.toggle("is-editing", Boolean(timer.editingId));
    box.querySelector("[data-ring]").style.setProperty("--deg", `${(seconds % 3600) / 10}deg`);
    box.querySelector("[data-clock]").textContent = clockText(seconds);
    box.querySelector("[data-clock-state]").textContent = timer.running ? "사냥 중" : seconds ? (timer.editingId ? "잰 시간" : "일시정지") : "대기";
    box.querySelector("[data-timer-heading]").textContent = timer.editingId ? "사냥 기록 고치기" : "사냥 기록 남기기";
    box.querySelector("[data-editing]").hidden = !timer.editingId;
    box.querySelector("[data-editing-title]").textContent = editing ? String(editing.title || "").trim() || editing.character_name : "";
    box.querySelector("[data-timer-hint]").textContent = timer.running
      ? "타이머가 돌고 있어요. 끝나면 지금 내 경험치·메소(또는 얻은 양)를 적고 기록을 남기세요."
      : seconds
        ? `${spanText(seconds)} 동안의 기록이에요. 얻은 경험치·메소를 적고 기록을 남기세요.`
        : "타이머로 재거나 잰 시간을 직접 적고, 얻은 경험치·메소를 적어 기록을 남기세요.";
    box.querySelector("[data-timer-toggle]").textContent = timer.running ? "일시정지" : seconds ? "이어서 재기" : "사냥 시작";
    box.querySelector("[data-timer-finish]").textContent = timer.editingId ? "수정 저장" : "기록 남기기";
    box.querySelector("[data-timer-finish]").disabled = !seconds;
    box.querySelector("[data-timer-reset]").hidden = !seconds;
    paintPreview();
  }

  // 지금 적은 값으로 1분·15분·1시간 EXP를 미리 보여 준다.
  function paintPreview() {
    const preview = root.querySelector("[data-timer-preview]");
    if (!preview) return;
    const seconds = elapsedSeconds();
    const exp = readTimerGain("exp", "EXP", 1n);
    if (!seconds || exp.error || exp.value == null) {
      preview.hidden = true;
      return;
    }
    preview.hidden = false;
    const row = { measured_seconds: Math.max(1, seconds), exp_gain: exp.value.toString() };
    preview.innerHTML = HUNT_UNITS.map((unit) => {
      const ratio = expRatio(row, unit.minutes);
      return `<span><small>${escapeHtml(unit.label)}</small><b>${escapeHtml(formatRatio(ratio.numerator, ratio.denominator))}</b></span>`;
    }).join("");
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

  // 멈춘 상태면 잰 시간을 분·초 칸에 보여 준다.
  function paintMeasuredInputs() {
    const minutes = root.querySelector("[data-measured-time]");
    const secs = root.querySelector("[data-measured-sec]");
    if (timer.running || !timer.before) {
      minutes.value = "";
      secs.value = "";
      return;
    }
    minutes.value = String(Math.floor(timer.before / 60));
    secs.value = timer.before % 60 ? String(timer.before % 60) : "";
  }

  function fillTimerFields() {
    paintMeasuredInputs();
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
    paintMeasuredInputs();
    paintTimer();
  }

  function resetTimer() {
    if (elapsedSeconds() >= 60 && !window.confirm("잰 시간을 0으로 되돌릴까요? 적어 둔 획득량은 남겨 둡니다.")) return;
    timer = { ...timer, running: false, startedAt: 0, before: 0 };
    saveTimer();
    sfx("tick");
    paintMeasuredInputs();
    paintTimer();
  }

  // 분·초 칸이나 15/30/60분 버튼으로 잰 시간을 정한다(1초~24시간).
  function setMeasuredTime(minutesText, secondsText, { quiet = false } = {}) {
    const minutes = readCount(String(minutesText ?? ""), "분", 0);
    const secs = readCount(String(secondsText ?? ""), "초", 0);
    const error = minutes.error || secs.error || ((secs.value ?? 0) > 59 ? "초는 0~59로 적어 주세요." : "");
    const total = (minutes.value ?? 0) * 60 + (secs.value ?? 0);
    if (error || total > 86400) {
      notify(error || "잰 시간은 24시간(1440분) 이하로 적어 주세요.", "error");
      paintMeasuredInputs();
      return;
    }
    if (!total && quiet) return;
    timer = { ...timer, running: false, startedAt: 0, before: total };
    saveTimer();
    paintMeasuredInputs();
    paintTimer();
  }

  // 기록 남기기·수정 저장: 이 칸 하나에서 새 기록과 고치기를 모두 처리한다.
  async function finishTimer(button) {
    const seconds = elapsedSeconds();
    if (!seconds) return;
    const character = timerCharacter();
    const name = character ? character.name : String(timer.charName || "").trim();
    if (!name) {
      notify("캐릭터명을 적어 주세요.", "error");
      root.querySelector('[data-timer-field="charName"]')?.focus();
      return;
    }
    const levelValue = character?.level ? { value: Number(character.level) } : readCount(String(timer.level || ""), "레벨", 1);
    if (levelValue.error || levelValue.value == null || levelValue.value > 200) {
      notify(levelValue.error || (levelValue.value > 200 ? "레벨은 200 이하여야 합니다." : "레벨을 적어 주세요."), "error");
      root.querySelector('[data-timer-field="level"]')?.focus();
      return;
    }
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
    const potion = readBig(timer.potion, "물약값", 0n);
    const leech = readLeech(timer.leech);
    if (potion.error || leech.error) { notify(potion.error || leech.error, "error"); return; }
    if (timer.running) { timer = { ...timer, running: false, before: seconds, startedAt: 0 }; saveTimer(); paintTimer(); }
    const title = String(timer.title || "").trim() || "새 사냥";
    const userMemo = String(timer.memo || "").trim();
    // sql/066 전에는 잰 값을 칸에 못 넣으니 메모에 남긴다.
    const rangeNote = (kind, gain) => gain.mode === "range" ? `(${formatCount(readBig(timer[`${kind}Start`], "", 0n).value)}→${formatCount(readBig(timer[`${kind}End`], "", 0n).value)})` : "";
    const autoMemo = `${spanText(seconds)} · EXP ${formatCount(exp.value)}${rangeNote("exp", exp)} · 메소 ${formatCount(meso.value ?? 0n)}${rangeNote("meso", meso)} · 물약 ${formatCount(potion.value ?? 0n)} · 쩔비 ${formatSigned(leech.value ?? 0n)}`;
    const storeMeasured = measuredReady && seconds <= 86400;
    await saveTimerRecord(button, {
      character_id: character?.id ?? null,
      character_name: name,
      job: (character ? character.job : timer.job)?.trim() || null,
      level: levelValue.value,
      potion_cost: perHour(potion.value ?? 0n, seconds).toString(),
      leech_fee: perHour(leech.value ?? 0n, seconds).toString(),
      exp_per_hour: perHour(exp.value, seconds).toString(),
      meso_per_hour: perHour(meso.value ?? 0n, seconds).toString(),
      title,
      memo: storeMeasured ? userMemo || null : [autoMemo, userMemo].filter(Boolean).join("\n"),
      ...(storeMeasured ? { measured_seconds: seconds, exp_gain: exp.value.toString(), meso_gain: (meso.value ?? 0n).toString() } : {}),
    });
  }

  // 새 기록은 알림의 "되돌리기"로 지우고 값을 돌려놓을 수 있다. 고친 기록은 바로 반영한다.
  let finishing = false;
  async function saveTimerRecord(button, payload) {
    if (finishing) return;
    finishing = true;
    button.disabled = true;
    const before = { ...timer };
    const editingId = timer.editingId;
    const others = editingId ? hunts.filter((row) => row.id !== editingId) : hunts;
    const previousBest = others.reduce((max, row) => (hourRate(row) > max ? hourRate(row) : max), 0n);
    let saved = null;
    try {
      const supabase = await getSupabase();
      const { data, error } = editingId
        ? await supabase.from("hunts").update(payload).eq("id", editingId).select("id").single()
        : await supabase.from("hunts").insert(payload).select("id").single();
      if (error) {
        if (root.isConnected) notify(translateDbError(error), "error");
        return;
      }
      saved = data ?? { id: editingId };
      // 화면을 떠났어도 같은 측정이 두 번 저장되지 않게 칸은 먼저 비운다(사냥터·직접 입력 캐릭터는 다음 기록에 그대로 둔다).
      timer = { ...blankTimer, title: editingId ? "" : timer.title, characterId: timer.characterId, charName: timer.charName, level: timer.level, job: timer.job };
      saveTimer();
    } finally {
      finishing = false;
      if (root.isConnected) paintTimer();
    }
    if (!saved || !root.isConnected) return;
    fillTimerFields();
    paintTimer();
    cheer(button, BigInt(payload.exp_per_hour), previousBest, payload.title);
    if (editingId) notify("사냥 기록을 고쳤습니다.", "info");
    else notify("사냥 기록을 저장했습니다.", "info", { label: "되돌리기", onClick: () => undoTimerRecord(saved.id, before) });
    await loadAll();
  }

  async function undoTimerRecord(id, before) {
    const supabase = await getSupabase();
    const { error } = await supabase.from("hunts").delete().eq("id", id);
    if (error) {
      notify(translateDbError(error), "error");
      return;
    }
    // 그사이 새로 적기 시작하지 않았을 때만 방금 값으로 되돌려, 고쳐서 다시 남길 수 있게 한다.
    const restore = !timer.running && !hasDraft() && !timer.editingId;
    if (restore) {
      timer = { ...before, running: false, startedAt: 0 };
      saveTimer();
    }
    notify(restore ? "방금 기록을 지우고 적었던 값을 되돌렸습니다." : "방금 기록을 지웠습니다.", "info");
    if (!root.isConnected) return;
    if (restore) {
      pickTimerCharacter();
      paintTimerWho();
      fillTimerFields();
      paintTimer();
    }
    await loadAll();
  }

  // 목록의 "수정": 그 기록을 위 칸에 불러온다. 예전 기록(1시간 값만)은 60분 동안의 양으로 불러온다.
  function editHuntRecord(hunt) {
    if (timer.running) {
      notify("타이머가 도는 중에는 다른 기록을 불러올 수 없습니다. 먼저 일시정지해 주세요.", "error");
      return;
    }
    if (timer.editingId !== hunt.id && hasDraft() && !window.confirm("지금 적고 있는 값을 지우고 이 기록을 불러올까요?")) return;
    const measuredSeconds = Number(hunt.measured_seconds);
    const measured = Number.isInteger(measuredSeconds) && measuredSeconds > 0 && hunt.exp_gain != null;
    const seconds = measured ? measuredSeconds : 3600;
    const fromHour = (value) => mulDivRound(asBig(value ?? 0), BigInt(seconds), 3600n);
    const expGain = measured ? asBig(hunt.exp_gain) : fromHour(hunt.exp_per_hour);
    let mesoGain = measured && hunt.meso_gain != null ? asBig(hunt.meso_gain) : fromHour(hunt.meso_per_hour);
    let potion = fromHour(hunt.potion_cost);
    // 예전 기록의 적자 순메소는 획득 메소 0 + 물약값으로 옮겨 1시간 메소(순메소 + 쩔비 − 물약)를 그대로 둔다.
    if (mesoGain < 0n) {
      potion += -mesoGain;
      mesoGain = 0n;
    }
    const leech = fromHour(hunt.leech_fee);
    const linked = Boolean(hunt.character_id && characters.some((character) => character.id === hunt.character_id));
    const linkedCharacter = linked ? characters.find((character) => character.id === hunt.character_id) : null;
    timer = {
      ...blankTimer,
      before: seconds,
      title: hunt.title || "",
      exp: expGain.toLocaleString("ko-KR"),
      meso: mesoGain ? mesoGain.toLocaleString("ko-KR") : "",
      potion: potion ? potion.toLocaleString("ko-KR") : "",
      leech: leech ? leech.toLocaleString("ko-KR") : "",
      memo: hunt.memo || "",
      characterId: linked ? hunt.character_id : "",
      charName: linked ? "" : hunt.character_name || "",
      level: linkedCharacter?.level ? "" : String(hunt.level || ""),
      job: linked ? "" : hunt.job || "",
      editingId: hunt.id,
    };
    saveTimer();
    pickTimerCharacter();
    paintTimerWho();
    fillTimerFields();
    paintTimer();
    sfx("tick");
    root.querySelector("[data-timer]").scrollIntoView({ behavior: "smooth", block: "start" });
    if (!measured) notify("예전 기록이라 1시간(60분) 동안 얻은 양으로 불러왔습니다. 실제로 잰 시간이 다르면 고쳐 주세요.", "info");
  }

  function cancelEdit() {
    timer = { ...blankTimer, characterId: null };
    saveTimer();
    pickTimerCharacter();
    paintTimerWho();
    fillTimerFields();
    paintTimer();
    sfx("uncheck");
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
    // 고치던 기록이 지워졌으면 고치기 상태만 푼다(적은 값은 새 기록으로 남길 수 있게 둔다).
    if (timer.editingId && !hunts.some((row) => row.id === timer.editingId)) {
      timer = { ...timer, editingId: "" };
      saveTimer();
    }
    pickTimerCharacter();
    paintJobButtons();
    paintHunts();
    paintTimerWho();
    paintTimer();
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
    if (timerField?.closest("[data-gain]")) paintPreview();
    if (event.target.closest("[data-hunt-search], [data-hunt-min], [data-hunt-max]")) paintHunts();
  });

  root.addEventListener("change", (event) => {
    if (event.target.matches("[data-timer-character]")) {
      timerCharacterId = event.target.value;
      timer = { ...timer, characterId: timerCharacterId };
      saveTimer();
      paintTimerWho();
    }
    if (event.target.matches("[data-measured-time], [data-measured-sec]")) {
      setMeasuredTime(root.querySelector("[data-measured-time]").value, root.querySelector("[data-measured-sec]").value, { quiet: true });
    }
  });

  root.addEventListener("click", async (event) => {
    const measured = event.target.closest("[data-measured-minutes]");
    if (measured) setMeasuredTime(measured.dataset.measuredMinutes, "");
    if (event.target.closest("[data-cancel-edit]")) cancelEdit();

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
      if (hunt) editHuntRecord(hunt);
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

  const shouldOpenAdd = consumePendingAdd();
  paintUnits();
  fillTimerFields();
  paintTimer();
  startTicking();
  await loadAll();
  // 홈의 "사냥 기록 추가"로 왔으면 기록 칸으로 옮겨 사냥터부터 적게 한다.
  if (shouldOpenAdd && root.isConnected) {
    root.querySelector("[data-timer]").scrollIntoView({ behavior: "smooth", block: "start" });
    root.querySelector('[data-timer-field="title"]').focus({ preventScroll: true });
  }
}
