import { translateDbError } from "../db-error.js";
import { escapeHtml, formatCount, readBig, readCount, sortByName } from "../format.js";
import { matchesPointLevel, matchesText, readLevelFilter } from "../filters.js";
import { BURST_COLORS, burstAt, celebrate, sfx } from "../effects.js";
import { expProgress } from "../exp-progress.js";
import { asBig, formatMinutes, formatPerMinute, formatSigned, hourMeso, mulDivRound, perHour, shortCount } from "../hunt-calc.js";
import { findJob, jobDisplayName, jobStyle, normalizeJobName } from "../job-label.js";
import { loadMainCharacter, mainCharacterId } from "../profile.js";
import { getSupabase } from "../supabase-client.js";
import { notify } from "../toast.js";

const huntColumns =
  "id, character_id, character_name, job, level, potion_cost, leech_fee, exp_per_hour, meso_per_hour, title, memo, created_at";

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
const blankTimer = { running: false, startedAt: 0, before: 0, title: "", exp: "", meso: "" };

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
        <p>타이머로 재거나 1시간 기준으로 적으면 EXP/h·메소/h로 비교하고, 다음 레벨까지 걸릴 시간을 알려 줘요.</p>
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
                <span data-timer-hint>시작을 누르고 사냥하세요. 1시간 기준 효율로 자동 환산해요.</span>
              </div>
              <div class="hu-wells">
                <label class="hu-well is-wide"><span>사냥터</span><input data-timer-field="title" autocomplete="off" placeholder="예: 엘나스 헥터" /></label>
                <label class="hu-well"><span>획득 EXP</span><input data-timer-field="exp" inputmode="numeric" data-grouped autocomplete="off" placeholder="0" /></label>
                <label class="hu-well"><span>획득 메소</span><input data-timer-field="meso" inputmode="numeric" data-grouped autocomplete="off" placeholder="0" /></label>
              </div>
              <p class="hu-timer-who" data-timer-who></p>
              <div class="hu-timer-actions">
                <button type="button" class="hu-go" data-timer-toggle>사냥 시작</button>
                <button type="button" class="hu-finish" data-timer-finish disabled>기록 남기기</button>
                <button type="button" class="hu-reset" data-timer-reset aria-label="타이머 초기화" title="타이머 초기화" hidden>↺</button>
              </div>
            </div>
          </section>

          <section class="hu-panel hu-records">
            <div class="hu-records-head">
              <div class="hu-records-title">
                <h2>사냥 기록</h2>
                <span>1시간 기준으로 환산 · 쩔비는 받으면 +, 내면 −</span>
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

        <aside class="hu-side">
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

          <section class="hu-panel hu-predict" data-predict>
            <h2>레벨업 예측</h2>
            <div class="hu-chips" data-predict-chars></div>
            <div data-predict-body><p class="hu-muted">불러오는 중입니다.</p></div>
          </section>
        </aside>
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
  let curve = new Map();
  // 레벨업 예측과 타이머 기록에 쓰는 캐릭터. 처음에는 대표 캐릭터.
  let predictId = "";

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
    huntForm.elements.character_id.focus();
  }

  function closeHuntForm() {
    formPanel.hidden = true;
    huntForm.dataset.editingId = "";
    huntForm.reset();
    showNameField(true);
    huntExpSource = "minute";
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

  function huntRow(row, { best, index, showJob }) {
    const rate = hourRate(row);
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
    const fee = leech === 0n ? "—" : `${leech > 0n ? "+" : "−"}${shortCount(leech > 0n ? leech : -leech)}`;
    const memoButton = memo
      ? `<button class="hu-act" type="button" data-open-memo="${row.id}" title="${escapeHtml(memo.replace(/\s+/g, " ").slice(0, 80))}">메모</button>`
      : "";
    return `<article class="hu-row${top ? " is-best" : ""}" style="--i:${Math.min(index, 12)}">
      <span class="hu-row-name">
        <span class="hu-row-title"><strong>${escapeHtml(heading)}</strong>${top ? `<span class="hu-best">최고</span>` : ""}</span>
        <span class="hu-row-who">${escapeHtml(who)}</span>
      </span>
      <span class="hu-row-exp">
        <span><b>${escapeHtml(shortCount(rate))}</b> EXP/h</span>
        <span class="hu-bar"><i style="width:${Math.max(3, ratioPercent(rate, best))}%"></i></span>
        <small>분당 ${escapeHtml(formatPerMinute(rate))}</small>
      </span>
      <span class="hu-row-num"><small>메소/h</small><strong class="${net == null ? "" : moneyClass(net)}" title="순메소 + 쩔비 − 물약">${net == null ? "-" : escapeHtml(net < 0n ? `−${shortCount(-net)}` : shortCount(net))}</strong></span>
      <span class="hu-row-num"><small>쩔비</small><strong class="${moneyClass(leech)}">${escapeHtml(fee)}</strong></span>
      <span class="hu-row-acts">
        ${memoButton}
        <button class="hu-act" type="button" data-edit-hunt="${row.id}">수정</button>
        <button class="hu-act is-danger" type="button" data-delete-hunt="${row.id}">삭제</button>
      </span>
    </article>`;
  }

  // ── 레벨업 예측 ─────────────────────────────────────────────

  function sortedCharacters() {
    return [...characters].sort(compareCharacter);
  }

  function predictCharacter() {
    return characters.find((character) => character.id === predictId) ?? null;
  }

  function paintPredict() {
    const chips = root.querySelector("[data-predict-chars]");
    const body = root.querySelector("[data-predict-body]");
    if (!chips || !body) return;
    const list = sortedCharacters();
    if (!list.length) {
      chips.innerHTML = "";
      body.innerHTML = `<p class="hu-muted">캐릭터를 추가하면 다음 레벨까지 걸릴 시간을 보여 줘요.</p><a class="hu-link" href="#/characters">캐릭터 추가하러 가기</a>`;
      return;
    }
    chips.innerHTML = list
      .map((character) => {
        const on = character.id === predictId;
        const style = jobStyle(findJob(jobs, character.job));
        return `<button type="button" class="hu-chip${on ? " is-on" : ""}" data-predict-pick="${character.id}" aria-pressed="${on}"${style ? ` style="${style}"` : ""}>${escapeHtml(character.name)}</button>`;
      })
      .join("");
    const character = predictCharacter();
    if (!character) return;
    const level = Number(character.level || 0);
    if (!level) {
      body.innerHTML = `<p class="hu-muted">${escapeHtml(character.name)}의 레벨이 비어 있어요. 캐릭터 화면에서 레벨을 적어 주세요.</p>`;
      return;
    }
    if (level >= 200) {
      body.innerHTML = `<p class="hu-lv-line"><span>Lv.200</span><span>만렙</span></p><p class="hu-muted">더 올릴 레벨이 없어요.</p>`;
      return;
    }
    const progress = expProgress({ level, exp: character.exp, curve });
    if (progress.state === "no-curve") {
      body.innerHTML = `<p class="hu-muted">${level}레벨의 다음 레벨 경험치 정보가 없어요.</p>`;
      return;
    }
    const need = asBig(curve.get(level));
    const noExp = progress.state === "no-exp";
    const over = progress.state === "over";
    const remaining = noExp || over ? (over ? 0n : need) : progress.remaining;
    const ratio = noExp ? 0 : over ? 1 : progress.ratio;
    const percent = noExp ? "0.00" : over ? "100.00" : progress.percent;
    const own = hunts.filter((row) => row.character_id === character.id && hourRate(row) > 0n);
    const rates = own.map(hourRate);
    const bestRate = rates.reduce((max, rate) => (rate > max ? rate : max), 0n);
    const avgRate = rates.length ? rates.reduce((sum, rate) => sum + rate, 0n) / BigInt(rates.length) : 0n;
    const timeFor = (rate) => (rate > 0n ? (remaining === 0n ? "바로" : formatMinutes(mulDivRound(60n, remaining, rate))) : "—");
    const chartSource = (own.length ? own : hunts.filter((row) => hourRate(row) > 0n))
      .slice()
      .sort((left, right) => String(left.created_at || "").localeCompare(String(right.created_at || "")))
      .slice(-6);
    const chartMax = chartSource.reduce((max, row) => (hourRate(row) > max ? hourRate(row) : max), 0n);
    const bars = chartSource
      .map((row, index) => {
        const rate = hourRate(row);
        const top = rate === chartMax;
        const height = Math.max(8, ratioPercent(rate, chartMax) * 0.78);
        return `<span class="hu-chart-col" title="${escapeHtml(String(row.title || row.character_name || ""))}"><small>${escapeHtml(shortCount(rate))}</small><i class="${top ? "is-top" : ""}" style="height:${height}%;--i:${index}"></i></span>`;
      })
      .join("");
    const note = noExp
      ? `현재 경험치를 적지 않아 레벨 처음부터 계산했어요. <a class="hu-link" href="#/characters">경험치 적기</a>`
      : `남은 경험치 ${escapeHtml(formatCount(remaining))}`;
    body.innerHTML = `
      <div class="hu-level">
        <p class="hu-lv-line"><span>Lv.${level} → ${level + 1}</span><span>${percent}%</span></p>
        <div class="hu-lv-bar"><i style="width:${(ratio * 100).toFixed(2)}%"></i></div>
        <p class="hu-muted">${note}</p>
      </div>
      <div class="hu-eta">
        <div><span>최고 기록으로</span><strong class="is-best">${escapeHtml(timeFor(bestRate))}</strong></div>
        <div><span>평균 기록으로</span><strong>${escapeHtml(timeFor(avgRate))}</strong></div>
      </div>
      ${own.length ? "" : `<p class="hu-muted">${escapeHtml(character.name)}의 사냥 기록이 없어 시간을 계산할 수 없어요.</p>`}
      <div class="hu-chart-wrap">
        <span class="hu-chart-title">최근 기록 EXP/h${own.length ? "" : " (전체)"}</span>
        ${chartSource.length ? `<div class="hu-chart">${bars}</div>` : `<p class="hu-muted">아직 기록이 없어요.</p>`}
      </div>`;
  }

  // ── 타이머 ─────────────────────────────────────────────────

  function paintTimerWho() {
    const who = root.querySelector("[data-timer-who]");
    if (!who) return;
    const character = predictCharacter();
    who.innerHTML = character
      ? `기록할 캐릭터 <b>${escapeHtml(character.name)}</b>${character.level ? ` · Lv.${escapeHtml(formatCount(character.level))}` : ""} <span>(레벨업 예측에서 바꿀 수 있어요)</span>`
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
      ? "타이머가 돌고 있어요. 끝나면 획득량을 적고 기록을 남기세요."
      : seconds
        ? `${spanText(seconds)} 동안 사냥했어요. 획득량을 적고 기록을 남기세요.`
        : "시작을 누르고 사냥하세요. 1시간 기준 효율로 자동 환산해요.";
    box.querySelector("[data-timer-toggle]").textContent = timer.running ? "일시정지" : seconds ? "다시 시작" : "사냥 시작";
    box.querySelector("[data-timer-finish]").disabled = !seconds;
    box.querySelector("[data-timer-reset]").hidden = !seconds;
  }

  function fillTimerFields() {
    for (const input of root.querySelectorAll("[data-timer-field]")) input.value = timer[input.dataset.timerField] || "";
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
    saveTimer();
    sfx("tick");
    paintTimer();
  }

  async function finishTimer(button) {
    const seconds = elapsedSeconds();
    if (!seconds) return;
    const exp = readBig(timer.exp, "획득 EXP", 1n);
    if (exp.error || exp.value == null) {
      notify(exp.error || "획득 EXP를 적어 주세요.", "error");
      root.querySelector('[data-timer-field="exp"]')?.focus();
      return;
    }
    const meso = readBig(timer.meso, "획득 메소", 0n);
    if (meso.error) {
      notify(meso.error, "error");
      return;
    }
    const expHour = perHour(exp.value, seconds);
    const mesoHour = perHour(meso.value ?? 0n, seconds);
    const title = String(timer.title || "").trim() || "새 사냥";
    const memo = `타이머 ${spanText(seconds)} · EXP ${formatCount(exp.value)} · 메소 ${formatCount(meso.value ?? 0n)}`;
    const character = predictCharacter();
    if (!character?.level) {
      // 캐릭터를 모르면 폼에 채워서 확인받는다.
      fillHuntForm({ id: "", title, exp_per_hour: expHour.toString(), meso_per_hour: mesoHour.toString(), memo });
      notify("캐릭터를 고르고 저장해 주세요.", "info");
      return;
    }
    const value = {
      character_id: character.id,
      character_name: character.name,
      job: character.job || null,
      level: character.level,
      potion_cost: "0",
      leech_fee: "0",
      exp_per_hour: expHour.toString(),
      meso_per_hour: mesoHour.toString(),
      title,
      memo,
    };
    button.disabled = true;
    const previousBest = hunts.reduce((max, row) => (hourRate(row) > max ? hourRate(row) : max), 0n);
    const supabase = await getSupabase();
    const { error } = await supabase.from("hunts").insert(value);
    if (!root.isConnected) return;
    button.disabled = false;
    if (error) {
      notify(translateDbError(error), "error");
      return;
    }
    timer = { ...blankTimer, title: timer.title };
    saveTimer();
    fillTimerFields();
    paintTimer();
    cheer(button, expHour, previousBest, title);
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
    const exp = readHourExp(huntForm, huntExpSource);
    if (exp.error) return exp;
    const potion = readBig(huntForm.elements.potion_cost.value, "1시간 물약", 0n);
    if (potion.error) return potion;
    const leech = readLeech(huntForm.elements.leech_fee.value);
    if (leech.error) return leech;
    const meso = readMeso(huntForm.elements.meso_amount.value);
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
      },
    };
  }

  async function loadAll() {
    const current = ++loadId;
    if (!hunts.length) huntList.innerHTML = `<p class="hu-empty">불러오는 중입니다.</p>`;
    const supabase = await getSupabase();
    const [huntResult, firstCharacters, accountResult, jobResult, curveResult] = await Promise.all([
      supabase.from("hunts").select(huntColumns).order("created_at", { ascending: false }),
      supabase.from("characters").select("id, account_id, name, job, level, exp"),
      supabase.from("accounts").select("id, name").order("name"),
      supabase.from("jobs").select("id, family, name, color, color_dark, sort_order").order("sort_order"),
      supabase.from("level_exp").select("level, exp_to_next"),
      loadMainCharacter(),
    ]);
    // sql/029 실행 전이면 exp 칸이 없다. 빼고 다시 읽는다(예측은 레벨 처음부터 기준).
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
    curve = new Map((curveResult.error ? [] : (curveResult.data ?? [])).map((row) => [row.level, row.exp_to_next]));
    if (!characters.some((character) => character.id === predictId)) {
      const main = mainCharacterId();
      predictId = characters.some((character) => character.id === main) ? main : (sortedCharacters()[0]?.id ?? "");
    }
    paintJobButtons();
    paintCharacterOptions();
    paintHunts();
    paintPredict();
    paintTimerWho();
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
    }
    if (event.target.form === huntForm && ["meso_amount", "leech_fee", "potion_cost"].includes(event.target.name)) {
      paintHuntNet();
    }
    if (event.target.form === huntForm && (event.target.name === "exp_minute" || event.target.name === "exp_hour")) {
      huntExpSource = event.target.name === "exp_minute" ? "minute" : "hour";
      syncExp(huntForm, huntExpSource);
    }
    if (event.target.closest("[data-hunt-search], [data-hunt-min], [data-hunt-max]")) paintHunts();
  });

  root.addEventListener("change", (event) => {
    if (event.target === huntForm.elements.character_id) {
      const character = characters.find((item) => item.id === event.target.value);
      showNameField(!character);
      if (!character) return;
      huntForm.elements.job.value = character.job || "";
      if (character.level) huntForm.elements.level.value = String(character.level);
    }
  });

  root.addEventListener("click", async (event) => {
    if (event.target.closest("[data-add-hunt]")) {
      notify("", "info");
      sfx("tick");
      const character = predictCharacter();
      openForm(character ? { id: "", character_id: character.id, job: character.job, level: character.level } : { id: "" });
    }
    if (event.target.closest("[data-cancel-hunt]")) closeHuntForm();

    if (event.target.closest("[data-timer-toggle]")) toggleTimer();
    if (event.target.closest("[data-timer-reset]")) resetTimer();
    const finish = event.target.closest("[data-timer-finish]");
    if (finish) await finishTimer(finish);

    const pick = event.target.closest("[data-predict-pick]");
    if (pick && pick.dataset.predictPick !== predictId) {
      predictId = pick.dataset.predictPick;
      sfx("tick");
      paintPredict();
      paintTimerWho();
    }

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
  fillTimerFields();
  paintTimer();
  startTicking();
  await loadAll();
  if (shouldOpenAdd && root.isConnected) {
    const character = predictCharacter();
    openForm(character ? { id: "", character_id: character.id, job: character.job, level: character.level } : { id: "" });
  }
}
