import { translateDbError } from "../db-error.js";
import { escapeHtml, formatCount, readBig, readCount, sortByName } from "../format.js";
import { matchesPointLevel, matchesText, readLevelFilter } from "../filters.js";
import { asBig, formatPerMinute, formatSigned, hourMeso } from "../hunt-calc.js";
import { findJob, jobDisplayName, jobStyle, normalizeJobName } from "../job-label.js";
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

export async function render(root) {
  root.innerHTML = `
    <div class="studio-page">
    <header class="page-header">
      <p class="studio-kicker">사냥터</p>
      <div class="studio-hero-row">
        <h1>사냥 기록</h1>
      </div>
    </header>
    <section class="hunt-panel is-log">
      <div class="hunt-panel-head">
        <div>
          <p class="hunt-panel-kicker">기록</p>
          <h2>1시간 사냥 기록</h2>
        </div>
        <button class="primary-button" type="button" data-add-hunt>사냥 기록 추가</button>
      </div>
      <div class="hunt-panel-body">
      <div class="hunt-jobs" data-hunt-jobs>
        <div data-hunt-job-list>
          <p class="hunt-pick-empty">직업을 불러오는 중입니다.</p>
        </div>
      </div>
      <form class="editor" id="hunt-form" hidden>
        <h2 data-hunt-title>사냥 기록 추가</h2>
        <label class="field"><span>캐릭터</span><select name="character_id"></select></label>
        <label class="field" data-name-field><span>캐릭터명</span><input name="character_name" autocomplete="off" /></label>
        <label class="field"><span>직업</span><input name="job" autocomplete="off" /></label>
        <label class="field"><span>레벨</span><input name="level" inputmode="numeric" autocomplete="off" /></label>
        <label class="field span-all"><span>사냥 이름</span><input name="title" autocomplete="off" placeholder="맵, 자리처럼 이 사냥을 구분하는 이름" /></label>
        <label class="field"><span>분당 경험치</span><input name="exp_minute" inputmode="numeric" data-grouped autocomplete="off" placeholder="1시간 대신 적어도 됩니다" /></label>
        <label class="field"><span>1시간 경험치</span><input name="exp_hour" inputmode="numeric" data-grouped autocomplete="off" placeholder="분당 대신 적어도 됩니다" /></label>
        <label class="field"><span>순메소</span><input name="meso_amount" inputmode="text" data-grouped data-signed autocomplete="off" placeholder="적자는 -. 없으면 비움" /></label>
        <label class="field"><span>1시간 쩔비</span><input name="leech_fee" inputmode="text" data-grouped data-signed autocomplete="off" placeholder="내가 내면 -" /></label>
        <label class="field"><span>1시간 물약</span><input name="potion_cost" inputmode="numeric" data-grouped autocomplete="off" placeholder="없으면 0" /></label>
        <div class="summary is-plan span-all" data-hunt-net>
          <article>
            <span>1시간 메소</span>
            <strong data-hunt-net-value>0</strong>
            <p class="hint" data-hunt-net-note>순메소 + 쩔비 − 물약</p>
          </article>
        </div>
        <label class="field"><span>메모</span><textarea name="memo" placeholder="누구에게 얼마를 받았는지처럼 남겨 둘 내용"></textarea></label>
        <p class="hint span-all">분당과 1시간 중 하나만 적어도 다른 칸이 채워집니다. 둘 다 적었다면 마지막에 고친 칸을 저장합니다.</p>
        <div class="button-row">
          <button class="primary-button" type="submit">저장</button>
          <button class="secondary-button" type="button" data-cancel-hunt>취소</button>
        </div>
      </form>
      <div class="filters">
        <label class="field"><span>캐릭터</span><input data-hunt-search placeholder="이름, 캐릭터, 직업, 메모" /></label>
        <label class="field"><span>레벨 최소</span><input data-hunt-min inputmode="numeric" /></label>
        <label class="field"><span>레벨 최대</span><input data-hunt-max inputmode="numeric" /></label>
      </div>
      <div data-hunt-list></div>
      </div>
    </section>
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
  const huntList = root.querySelector("[data-hunt-list]");

  let hunts = [];
  let characters = [];
  let accounts = [];
  let jobs = [];
  let pickedFamily = "";
  let pickedJobKey = "";
  let huntExpSource = "minute";
  let loadId = 0;

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
    huntForm.hidden = false;
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
    huntForm.hidden = true;
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

  function paintHunts() {
    const filtered = filteredHunts();
    if (filtered.error) {
      huntList.innerHTML = `<p class="empty">${escapeHtml(filtered.error)}</p>`;
      return;
    }
    if (!hunts.length) {
      huntList.innerHTML = `<p class="empty">사냥 기록이 없습니다. 1시간 기준으로 추가해 보세요.</p>`;
      return;
    }
    if ((pickedFamily || pickedJobKey) && !recordHunts().length) {
      huntList.innerHTML = `<p class="empty">${pickedJobKey ? "이 직업" : "이 계열"}의 사냥 기록이 없습니다.</p>`;
      return;
    }
    if (!filtered.rows.length) {
      huntList.innerHTML = `<p class="empty">검색 결과가 없습니다. 검색어나 레벨 범위를 바꿔 보세요.</p>`;
      return;
    }
    if (!pickedFamily && !pickedJobKey) {
      const cards = filtered.rows.map((row) => huntTile(row, { showJob: true })).join("");
      huntList.innerHTML = `<div class="hunt-board"><div class="hunt-board-grid">${cards}</div></div>`;
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
    const body = groups
      .map((group) => {
        const title = group.family === "기타" ? group.name : `${group.family} - ${group.name}`;
        const style = group.style ? ` style="${group.style}"` : "";
        const cards = group.rows.map((row) => huntTile(row)).join("");
        return `<section class="hunt-board-group">
          <h3 class="hunt-board-title"${style}>${escapeHtml(title)}<span>${group.rows.length}</span></h3>
          <div class="hunt-board-grid">${cards}</div>
        </section>`;
      })
      .join("");
    huntList.innerHTML = `<div class="hunt-board">${body}</div>`;
  }

  function huntTile(row, options = {}) {
    const figures = huntFigures(row);
    const heading = String(row.title || "").trim() || row.character_name;
    const memo = String(row.memo || "").trim();
    const jobName = options.showJob ? jobChoice(row.job || "").name : "";
    const meta = [jobName && jobName !== row.character_name ? jobName : "", row.character_name, formatWhen(row.created_at)].filter(Boolean).join(" · ");
    const memoButton = memo
      ? `<button class="hunt-memo" type="button" data-open-memo="${row.id}"><span>메모</span><span class="hunt-memo-preview">${escapeHtml(memo.replace(/\s+/g, " "))}</span></button>`
      : "";
    return `<article class="hunt-tile">
      <div class="hunt-tile-top">
        <h3>${escapeHtml(heading)}</h3>
        <span class="hunt-tile-level">${escapeHtml(formatCount(row.level))}레벨</span>
      </div>
      <p class="hunt-tile-meta">${escapeHtml(meta)}</p>
      <div class="hunt-tile-stats">
        <div><span>분당 경험치</span><strong>${escapeHtml(figures.minute)}</strong></div>
        <div><span>1시간 메소</span><strong class="${figures.mesoClass}">${escapeHtml(figures.meso)}</strong></div>
      </div>
      <div class="hunt-tile-sub">
        <p><span>순메소</span><strong class="${figures.grossClass}">${escapeHtml(figures.gross)}</strong></p>
        <p><span>쩔비</span><strong class="${figures.leechClass}">${escapeHtml(figures.leech)}</strong></p>
        <p><span>물약</span><strong>${escapeHtml(figures.potion)}</strong></p>
      </div>
      <div class="row-actions">
        <button class="text-button" type="button" data-edit-hunt="${row.id}">수정</button>
        <button class="text-button is-danger" type="button" data-delete-hunt="${row.id}">삭제</button>
      </div>
      ${memoButton}
    </article>`;
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
    huntList.innerHTML = `<p class="empty">불러오는 중입니다.</p>`;
    const supabase = await getSupabase();
    const [huntResult, characterResult, accountResult, jobResult] = await Promise.all([
      supabase.from("hunts").select(huntColumns).order("created_at", { ascending: false }),
      supabase.from("characters").select("id, account_id, name, job, level, current_exp"),
      supabase.from("accounts").select("id, name").order("name"),
      supabase.from("jobs").select("id, family, name, color, color_dark, sort_order").order("sort_order"),
    ]);
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
    paintJobButtons();
    paintCharacterOptions();
    paintHunts();
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
      fillHuntForm({ id: "" });
    }
    if (event.target.closest("[data-cancel-hunt]")) closeHuntForm();

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
      if (hunt) fillHuntForm(hunt);
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
    try {
      const supabase = await getSupabase();
      const editingId = huntForm.dataset.editingId;
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
    closeHuntForm();
    notify("사냥 기록을 저장했습니다.", "info");
    await loadAll();
  });

  const shouldOpenAdd = consumePendingAdd();
  await loadAll();
  if (shouldOpenAdd && root.isConnected) {
    fillHuntForm({ id: "" });
    huntForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}
