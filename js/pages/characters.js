import { bosses, bossState, bossTimeParts, formatStamp, readBossTime } from "../boss-cooldown.js";
import {
  attachFaceUrls,
  faceMarkup,
  removeCharacterFace,
  saveCharacterFace,
  translateFaceError,
  validateFaceFile,
} from "../character-face.js";
import { translateDbError } from "../db-error.js";
import { escapeHtml, formatCount, readCount, sortByName } from "../format.js";
import { filterRows, readLevelFilter } from "../filters.js";
import { findJob, jobDisplayName, jobLabel, jobRecord, jobStyle } from "../job-label.js";
import { getSupabase } from "../supabase-client.js";
import { notify } from "../toast.js";

const baseColumns = "id, account_id, server, name, job, job_id, level, gear_memo, extra_memo";
const bossSelect =
  "pianus_enabled, pianus_at, papulatus_enabled, papulatus_at, rift_enabled, rift_at";
const tailColumns = "updated_at, jobs(name, color, color_dark)";

function characterSelect({ bosses: withBosses, questsHidden, face }) {
  return [baseColumns, withBosses ? bossSelect : "", questsHidden ? "quests_hidden" : "", face ? "face_path" : "", tailColumns]
    .filter(Boolean)
    .join(", ");
}
const bossArt = {
  pianus: "img/pianus.png",
  papulatus: "img/papulatus.png",
  rift: "img/rift.png",
};
const mapleland = "메이플랜드";

const blank = {
  id: "",
  account_id: "",
  server: "",
  name: "",
  job: "",
  job_id: "",
  level: "",
  gear_memo: "",
  extra_memo: "",
  pianus_enabled: false,
  papulatus_enabled: false,
  rift_enabled: false,
  quests_hidden: false,
};

export async function render(root) {
  root.innerHTML = `
    <div class="studio-page character-page">
    <header class="page-header">
      <p class="studio-kicker">명부</p>
      <div class="studio-hero-row">
        <h1>캐릭터</h1>
        <div class="button-row" data-character-actions hidden>
          <button class="text-button" type="button" data-servers>서버 선택</button>
          <button class="secondary-button" type="button" data-add-account>계정 추가</button>
          <button class="primary-button" type="button" data-add>캐릭터 추가</button>
        </div>
      </div>
    </header>
    <div data-gate></div>
    <section class="studio-board" data-workspace hidden>
      <div class="character-board-head">
        <h2 data-server-title></h2>
      </div>
    <form class="editor" id="account-form" hidden>
      <h2 data-account-title>계정 추가</h2>
      <label class="field"><span>계정 이름</span><input name="name" required placeholder="예: 본계정" /></label>
      <div class="button-row">
        <button class="primary-button" type="submit">저장</button>
        <button class="secondary-button" type="button" data-cancel-account>취소</button>
      </div>
    </form>
      <form class="editor" id="character-form" hidden>
        <h2 data-form-title>캐릭터 추가</h2>
        <label class="field"><span>계정</span><select name="account_id" required></select></label>
        <label class="field"><span>캐릭터명</span><input name="name" required /></label>
        <div class="field span-all face-field">
          <span>얼굴</span>
          <div class="face-field-row">
            <span class="face-preview" data-face-preview><span class="char-face is-empty">없음</span></span>
            <input name="face" type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="얼굴 사진" />
            <button class="text-button" type="button" data-clear-face hidden>얼굴 지우기</button>
          </div>
          <small class="field-note">캐릭터, 홈, 무릉에 보입니다. png, jpg, webp, gif, 2MB 이하.</small>
          <small class="field-note" data-face-migrate hidden>얼굴을 저장하려면 Supabase SQL Editor에서 sql/026_character_face.sql 을 실행해 주세요.</small>
        </div>
        <label class="field">
          <span>직업</span>
          <select name="job_id"></select>
          <small class="field-note" data-job-note hidden></small>
        </label>
        <label class="field"><span>레벨</span><input name="level" inputmode="numeric" /></label>
        <label class="field"><span>장비/스펙 메모</span><textarea name="gear_memo"></textarea></label>
        <label class="field"><span>기타 메모</span><textarea name="extra_memo"></textarea></label>
        <div class="boss-fields span-all" data-quests-hidden-fields>
          <div class="boss-switches">
            <label class="boss-switch"><input type="checkbox" name="quests_hidden" /><span>퀘스트에 표시하지 않기</span></label>
          </div>
          <p class="field-note">켜면 이 캐릭터는 퀘스트 완료 표와 합계에서 빠집니다. 이미 체크한 완료 기록은 그대로 남습니다.</p>
        </div>
        <div class="boss-fields span-all" data-boss-fields>
          <div class="boss-switches">
            ${bosses
              .map(
                (boss) =>
                  `<label class="boss-switch"><input type="checkbox" name="${boss.columnEnabled}" /><span>${escapeHtml(boss.label)} 활성화</span></label>`,
              )
              .join("")}
          </div>
          <p class="field-note">레벨과 퀘스트를 맞춘 캐릭터만 켜 주세요. 켠 캐릭터만 카드에서 도전 시각을 남길 수 있습니다.</p>
        </div>
        <div class="button-row">
          <button class="primary-button" type="submit" data-save>저장</button>
          <button class="secondary-button" type="button" data-cancel>취소</button>
        </div>
      </form>
      <div class="filters">
        <label class="field"><span>캐릭터명</span><input data-search placeholder="이름·메모로 찾기" /></label>
        <label class="field"><span>레벨 최소</span><input data-level-min inputmode="numeric" /></label>
        <label class="field"><span>레벨 최대</span><input data-level-max inputmode="numeric" /></label>
        <div class="boss-filters" data-boss-filters>
          ${bosses
            .map(
              (boss) => `<button class="boss-filter" type="button" data-boss-filter="${boss.key}" aria-pressed="false" title="${escapeHtml(boss.label)} 활성화 캐릭터만 보기">
            <img src="${bossArt[boss.key]}" alt="" width="32" height="32" />
            <span>${escapeHtml(boss.label)}</span>
          </button>`,
            )
            .join("")}
          <label class="boss-switch boss-ready-only">
            <input type="checkbox" data-boss-ready-only />
            <span>도전할 수 있는 캐릭터만</span>
          </label>
          <label class="boss-switch boss-soon-also">
            <input type="checkbox" data-boss-soon-also />
            <span>오늘·곧 보기</span>
          </label>
        </div>
      </div>
      <div data-list></div>
    </section>
    <dialog class="boss-time-dialog" data-boss-time-dialog>
      <form id="boss-time-form">
        <h2 data-boss-time-title>도전 시각</h2>
        <p class="field-note" data-boss-time-note>실제로 도전한 시각을 적으면 그 시각부터 대기 시간이 시작됩니다.</p>
        <div class="boss-time-fields">
          <label class="field"><span>년</span><input name="year" inputmode="numeric" autocomplete="off" required /></label>
          <label class="field"><span>월</span><input name="month" inputmode="numeric" autocomplete="off" required /></label>
          <label class="field"><span>일</span><input name="day" inputmode="numeric" autocomplete="off" required /></label>
          <label class="field"><span>시</span><input name="hour" inputmode="numeric" autocomplete="off" required /></label>
          <label class="field"><span>분</span><input name="minute" inputmode="numeric" autocomplete="off" required /></label>
        </div>
        <div class="button-row">
          <button class="primary-button" type="submit">기록</button>
          <button class="secondary-button" type="button" data-boss-time-close>닫기</button>
        </div>
      </form>
    </dialog>
    </div>
  `;

  const list = root.querySelector("[data-list]");
  const gate = root.querySelector("[data-gate]");
  const workspace = root.querySelector("[data-workspace]");
  const actions = root.querySelector("[data-character-actions]");
  const form = root.querySelector("#character-form");
  const accountForm = root.querySelector("#account-form");
  const bossTimeDialog = root.querySelector("[data-boss-time-dialog]");
  const bossTimeForm = root.querySelector("#boss-time-form");
  const title = root.querySelector("[data-form-title]");
  let rows = [];
  let accounts = [];
  let jobs = [];
  let loadId = 0;
  let bossReady = true;
  let questsHiddenReady = true;
  let faceReady = false;
  let faceRemoved = false;
  let faceObjectUrl = "";
  let readyKey = "";
  const bossFilters = new Set();
  const bossUndo = new Map();
  const bossWrite = new Map();
  let bossEpoch = 0;
  const bossFields = root.querySelector("[data-boss-fields]");
  const questsHiddenFields = root.querySelector("[data-quests-hidden-fields]");
  const bossFilterBar = root.querySelector("[data-boss-filters]");
  let selectedServer = "메이플랜드";
  const extraServers = new Set();
  const jobNote = root.querySelector("[data-job-note]");

  function showStatus(text, kind) {
    notify(text, kind);
  }

  function countFor(accountId, ignoreId = "") {
    return rows.filter((row) => row.account_id === accountId && row.id !== ignoreId).length;
  }

  function fillAccountOptions(selectedId) {
    const select = form.elements.account_id;
    select.innerHTML = accounts
      .map((account) => {
        const count = countFor(account.id);
        return `<option value="${account.id}">${escapeHtml(account.name)} (${count}/6)</option>`;
      })
      .join("");
    if (selectedId) select.value = selectedId;
  }

  function fillJobOptions(selectedId) {
    const select = form.elements.job_id;
    const groups = [];
    for (const job of jobs) {
      let group = groups.find((item) => item.family === job.family);
      if (!group) {
        group = { family: job.family, jobs: [] };
        groups.push(group);
      }
      group.jobs.push(job);
    }
    const body = groups
      .map((group) => {
        const options = group.jobs
          .map((job) => {
            const label = job.rank ? `${job.rank}차 ${jobDisplayName(job)}` : jobDisplayName(job);
            return `<option value="${escapeHtml(job.id)}">${escapeHtml(label)}</option>`;
          })
          .join("");
        return `<optgroup label="${escapeHtml(group.family)}">${options}</optgroup>`;
      })
      .join("");
    select.innerHTML = `<option value="">선택 안 함</option>${body}`;
    select.value = selectedId && jobs.some((job) => job.id === selectedId) ? selectedId : "";
  }

  function fillForm(character) {
    if (!accounts.length) {
      showStatus("먼저 계정을 만들어 주세요.", "error");
      return;
    }
    form.hidden = false;
    form.dataset.editingId = character.id || "";
    title.textContent = character.id ? "캐릭터 수정" : "캐릭터 추가";
    fillAccountOptions(character.account_id || accounts[0].id);
    fillJobOptions(character.job_id || "");
    const linked = Boolean(character.job_id && jobs.some((job) => job.id === character.job_id));
    form.dataset.legacyJob = linked ? "" : character.job || "";
    jobNote.hidden = !form.dataset.legacyJob;
    jobNote.textContent = form.dataset.legacyJob
      ? `목록에 없는 직업입니다: ${character.job}. 다른 직업을 고르지 않으면 이 이름을 유지합니다.`
      : "";
    for (const [key, value] of Object.entries(character)) {
      const field = form.elements.namedItem(key);
      if (
        field &&
        field.type !== "file" &&
        key !== "account_id" &&
        key !== "job_id" &&
        key !== "jobs" &&
        key !== "quests_hidden" &&
        !key.endsWith("_enabled")
      ) {
        field.value = value ?? "";
      }
    }
    for (const boss of bosses) {
      const field = form.elements.namedItem(boss.columnEnabled);
      if (field) field.checked = Boolean(character[boss.columnEnabled]);
    }
    if (form.elements.quests_hidden) form.elements.quests_hidden.checked = Boolean(character.quests_hidden);
    faceRemoved = false;
    releaseFacePreview();
    form.elements.face.value = "";
    form.dataset.facePath = character.face_path || "";
    syncFaceField();
    paintFacePreview(character.face_url || "");
    form.elements.name.focus();
  }

  function closeForm() {
    form.hidden = true;
    form.dataset.editingId = "";
    form.dataset.legacyJob = "";
    form.dataset.facePath = "";
    jobNote.hidden = true;
    faceRemoved = false;
    releaseFacePreview();
    form.reset();
    paintFacePreview("");
  }

  function syncFaceField() {
    const note = form.querySelector("[data-face-migrate]");
    if (note) note.hidden = faceReady;
    if (form.elements.face) form.elements.face.disabled = !faceReady;
  }

  function releaseFacePreview() {
    if (!faceObjectUrl) return;
    URL.revokeObjectURL(faceObjectUrl);
    faceObjectUrl = "";
  }

  function paintFacePreview(src) {
    const preview = form.querySelector("[data-face-preview]");
    const clear = form.querySelector("[data-clear-face]");
    if (!preview) return;
    if (src) {
      preview.innerHTML = `<img class="char-face" src="${escapeHtml(src)}" alt="" />`;
      if (clear) clear.hidden = !faceReady;
    } else {
      preview.innerHTML = `<span class="char-face is-empty">없음</span>`;
      if (clear) clear.hidden = true;
    }
  }

  function characterCard(row) {
    const job = jobRecord(row) || findJob(jobs, row.job);
    const style = jobStyle(job);
    const jobText = job ? jobLabel(jobDisplayName(job), job) : escapeHtml(row.job || "직업 없음");
    const notes = [
      row.gear_memo ? ["장비", row.gear_memo] : null,
      row.extra_memo ? ["기타", row.extra_memo] : null,
    ].filter(Boolean);
    const noteHtml = notes.length
      ? `<div class="character-notes">${notes
          .map(([label, text]) => `<p class="character-note"><span>${label}</span>${escapeHtml(text)}</p>`)
          .join("")}</div>`
      : "";
    return `
      <li class="character-row"${style ? ` style="${style}"` : ""}>
        <div class="character-row-main">
          ${faceMarkup(row.face_url)}
          <div class="character-copy">
            <div class="character-title"><strong class="character-name">${escapeHtml(row.name)}</strong>${row.quests_hidden ? `<span class="tag">퀘스트 제외</span>` : ""}</div>
            <span class="character-job">${jobText}</span>
          </div>
        </div>
        <div class="character-row-side">
          <span class="character-level"><span>Lv</span>${escapeHtml(formatCount(row.level))}</span>
          <div class="row-actions">
            <button class="text-button" type="button" data-edit="${row.id}">수정</button>
            <button class="text-button is-danger" type="button" data-delete="${row.id}">삭제</button>
          </div>
        </div>
        ${noteHtml}
        ${bossButtons(row)}
      </li>
    `;
  }

  function bossButtons(row) {
    const now = Date.now();
    const html = bosses
      .filter((boss) => row[boss.columnEnabled])
      .map((boss) => bossButton(row, boss, bossState(row[boss.columnAt], now, boss)))
      .join("");
    return html ? `<div class="boss-runs">${html}</div>` : "";
  }

  function bossButton(row, boss, state) {
    const classes = ["boss-run", state.ready ? "is-ready" : "", state.soon ? "is-soon" : ""].filter(Boolean).join(" ");
    const hour = (state.hints ?? []).includes("곧");
    const time = state.last == null ? "" : `<span class="boss-run-time${hour ? " is-hour" : ""}">${formatStamp(state.last)}</span>`;
    const undo = bossUndo.has(`${row.id}:${boss.key}`)
      ? `<button class="text-button boss-undo" type="button" data-boss-undo="${boss.key}" data-character="${row.id}">취소</button>`
      : "";
    const marks = (state.hints ?? []).map((hint) => `<em data-boss-hint>${escapeHtml(hint)}</em>`).join("");
    return `<div class="boss-run-line"><button class="${classes}" type="button" data-boss="${boss.key}" data-character="${row.id}" data-last="${state.last ?? ""}" title="${escapeHtml(bossTitle(boss, state))}" ${state.ready ? "" : "disabled"}><img class="boss-run-art" src="${bossArt[boss.key]}" alt="" width="36" height="36" /><span class="boss-run-copy"><span class="boss-run-name">${boss.label}${marks}</span>${time}</span></button><span class="boss-run-actions"><button class="boss-time" type="button" data-boss-time="${boss.key}" data-character="${row.id}" aria-label="${escapeHtml(boss.label)} 도전 시각" title="도전 시각을 직접 고릅니다."><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M10 6.2V10l2.6 1.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>${undo}</span></div>`;
  }

  function bossTitle(boss, state) {
    if (state.ready) return `${boss.label}에 도전한 시각으로 기록합니다.`;
    return `${formatStamp(state.next)}부터 다시 도전할 수 있습니다.`;
  }

  function paintBossButton(button, now) {
    const boss = bosses.find((item) => item.key === button.dataset.boss);
    if (!boss) return;
    const state = bossState(button.dataset.last, now, boss);
    button.disabled = !state.ready;
    button.classList.toggle("is-ready", state.ready);
    button.classList.toggle("is-soon", state.soon);
    button.title = bossTitle(boss, state);
    const name = button.querySelector(".boss-run-name");
    if (!name) return;
    name.querySelectorAll("[data-boss-hint]").forEach((node) => node.remove());
    for (const hint of state.hints ?? []) {
      const mark = document.createElement("em");
      mark.dataset.bossHint = "";
      mark.textContent = hint;
      name.append(mark);
    }
    const time = button.querySelector(".boss-run-time");
    if (time) time.classList.toggle("is-hour", (state.hints ?? []).includes("곧"));
  }

  function serverNames() {
    const names = new Set(rows.map((row) => row.server).filter(Boolean));
    for (const name of extraServers) names.add(name);
    names.add(mapleland);
    const rest = [...names].filter((name) => name !== mapleland).sort((a, b) => a.localeCompare(b, "ko"));
    return [mapleland, ...rest];
  }

  function serverPick(name) {
    const count = rows.filter((row) => row.server === name).length;
    if (name === mapleland) {
      return `<button class="server-pick server-pick-brand" type="button" data-open-server="${escapeHtml(name)}" aria-label="메이플랜드, ${count}명"><img src="img/mapleland.png" alt="" /><span>${count}명</span></button>`;
    }
    return `<button class="server-pick" type="button" data-open-server="${escapeHtml(name)}"><strong>${escapeHtml(name)}</strong><span>${count}명</span></button>`;
  }

  function paintGate() {
    selectedServer = "";
    workspace.hidden = true;
    actions.hidden = true;
    gate.hidden = false;
    closeForm();
    accountForm.hidden = true;
    const names = serverNames();
    const picks = `<div class="server-picks">${names.map((name) => serverPick(name)).join("")}</div>`;
    gate.innerHTML = `
      <div class="server-gate studio-board">
        <div class="character-board-head">
          <h2>서버 선택</h2>
        </div>
        ${picks}
        <form class="server-new" data-new-server>
          <label class="field"><span>다른 서버</span><input name="server" placeholder="서버 이름" /></label>
          <button class="primary-button" type="submit">들어가기</button>
        </form>
      </div>
    `;
  }

  function openServer(name) {
    selectedServer = name;
    extraServers.add(name);
    gate.hidden = true;
    workspace.hidden = false;
    actions.hidden = false;
    const title = root.querySelector("[data-server-title]");
    if (name === mapleland) {
      title.innerHTML = `<button class="server-brand" type="button" data-servers aria-label="메이플랜드, 서버 선택"><img src="img/mapleland.png" alt="" /></button>`;
    } else {
      title.textContent = name;
    }
    paintList();
  }

  function paintList() {
    if (!selectedServer) {
      paintGate();
      return;
    }
    const serverRows = rows.filter((row) => row.server === selectedServer);
    if (!accounts.length) {
      list.innerHTML = `<p class="empty">계정이 없습니다. 계정 추가로 본계정, 부계정처럼 먼저 만들어 주세요.</p>`;
      return;
    }
    const filtered = filterRows(serverRows, {
      query: root.querySelector("[data-search]").value,
      fields: ["name", "gear_memo", "extra_memo"],
      levelMode: "point",
      levelField: "level",
      filter: readLevelFilter(
        root.querySelector("[data-level-min]").value,
        root.querySelector("[data-level-max]").value,
      ),
    });
    if (filtered.error) {
      list.innerHTML = `<p class="empty">${filtered.error}</p>`;
      return;
    }
    const activeBosses = bosses.filter((boss) => bossFilters.has(boss.key));
    const readyOnly = readyOnlyChecked();
    const includeSoon = soonAlsoChecked();
    const now = Date.now();
    const visibleRows =
      activeBosses.length || readyOnly || includeSoon
        ? filtered.rows.filter((row) => matchesBossFilter(row, activeBosses, readyOnly, includeSoon, now))
        : filtered.rows;
    const searching = Boolean(
      root.querySelector("[data-search]").value.trim() ||
        root.querySelector("[data-level-min]").value.trim() ||
        root.querySelector("[data-level-max]").value.trim() ||
        activeBosses.length ||
        readyOnly ||
        includeSoon,
    );
    const blocks = accounts
      .map((account) => {
        const members = visibleRows
          .filter((row) => row.account_id === account.id)
          .sort((a, b) => (b.level ?? -1) - (a.level ?? -1) || a.name.localeCompare(b.name, "ko"));
        if (!members.length && (searching || countFor(account.id) > 0)) return "";
        const count = countFor(account.id);
        const full = count >= 6;
        const body = members.length
          ? `<ul class="character-rows">${members.map(characterCard).join("")}</ul>`
          : `<p class="character-empty">이 서버에는 아직 캐릭터가 없습니다.</p>`;
        return `
          <section class="account-block">
            <div class="account-head">
              <h2 title="${escapeHtml(account.name)}">${escapeHtml(account.name)} <span class="count-pill${full ? " is-full" : ""}">${count}/6</span></h2>
              <div class="account-tools">
                <button class="text-button" type="button" data-add-character="${account.id}" ${full ? "disabled" : ""}>추가</button>
                <button class="text-button" type="button" data-edit-account="${account.id}">이름</button>
                <button class="text-button is-danger" type="button" data-delete-account="${account.id}">삭제</button>
              </div>
            </div>
            ${body}
          </section>
        `;
      })
      .join("");
    const bossText = activeBosses.map((boss) => boss.label).join(", ");
    const bossEmpty = bossEmptyMessage(bossText, readyOnly, includeSoon);
    list.innerHTML = blocks
      ? `<div class="character-accounts">${blocks}</div>`
      : `<p class="empty">${
          activeBosses.length || readyOnly || includeSoon
            ? bossEmpty
            : searching
              ? "검색 결과가 없습니다. 검색어나 레벨 범위를 바꿔 보세요."
              : "이 서버에는 아직 캐릭터가 없습니다. 캐릭터 추가로 넣어 주세요."
        }</p>`;
    readyKey = attentionIds();
  }

  function readyOnlyChecked() {
    return Boolean(root.querySelector("[data-boss-ready-only]")?.checked);
  }

  function soonAlsoChecked() {
    return Boolean(root.querySelector("[data-boss-soon-also]")?.checked);
  }

  function bossEmptyMessage(bossText, readyOnly, includeSoon) {
    const named = bossText ? `${bossText} ` : "";
    if (readyOnly && includeSoon) return `지금 도전하거나 오늘·곧인 ${named}캐릭터가 없습니다.`;
    if (readyOnly) return `지금 ${bossText ? `${bossText}에 ` : ""}도전할 수 있는 캐릭터가 없습니다.`;
    if (includeSoon) return `오늘·곧인 ${named}캐릭터가 없습니다.`;
    return `${bossText} 활성화 캐릭터가 없습니다.`;
  }

  function canChallenge(row, boss, now = Date.now()) {
    return Boolean(row[boss.columnEnabled]) && bossState(row[boss.columnAt], now, boss).ready;
  }

  function isSoon(row, boss, now = Date.now()) {
    return Boolean(row[boss.columnEnabled]) && bossState(row[boss.columnAt], now, boss).soon;
  }

  function matchesBossFilter(row, activeBosses, readyOnly, includeSoon, now) {
    const pool = activeBosses.length ? activeBosses : bosses;
    return pool.some((boss) => {
      if (!row[boss.columnEnabled]) return false;
      if (!readyOnly && !includeSoon) return true;
      if (readyOnly && canChallenge(row, boss, now)) return true;
      return includeSoon && isSoon(row, boss, now);
    });
  }

  function attentionIds(now = Date.now()) {
    const readyOnly = readyOnlyChecked();
    const includeSoon = soonAlsoChecked();
    if ((!readyOnly && !includeSoon) || !selectedServer) return "";
    const activeBosses = bosses.filter((boss) => bossFilters.has(boss.key));
    return rows
      .filter((row) => row.server === selectedServer && matchesBossFilter(row, activeBosses, readyOnly, includeSoon, now))
      .map((row) => row.id)
      .sort()
      .join(",");
  }

  function columnMissing(error, pattern) {
    const raw = error?.message || "";
    return pattern.test(raw) && /could not find|schema cache|does not exist/i.test(raw);
  }

  function bossColumnMissing(error) {
    return columnMissing(error, /pianus_|papulatus_|rift_/);
  }

  function questsHiddenMissing(error) {
    return columnMissing(error, /quests_hidden/);
  }

  function faceColumnMissing(error) {
    const raw = `${error?.message || ""} ${error?.details || ""}`;
    return /face_path/i.test(raw) && /could not find|schema cache|does not exist/i.test(raw);
  }

  async function loadCharacters() {
    const current = ++loadId;
    list.innerHTML = `<p class="empty">캐릭터를 불러오는 중입니다.</p>`;
    const supabase = await getSupabase();
    const [accountResult, jobResult] = await Promise.all([
      supabase.from("accounts").select("id, name").order("name"),
      supabase.from("jobs").select("id, family, rank, name, color, color_dark, sort_order").order("sort_order"),
    ]);
    if (current !== loadId || !list.isConnected) return;
    let withBosses = true;
    let withQuestsHidden = true;
    let withFace = true;
    let columnWarning = null;
    let characters = await supabase
      .from("characters")
      .select(characterSelect({ bosses: withBosses, questsHidden: withQuestsHidden, face: withFace }))
      .order("updated_at", { ascending: false });
    while (
      characters.error &&
      (bossColumnMissing(characters.error) || questsHiddenMissing(characters.error) || faceColumnMissing(characters.error))
    ) {
      const nextBosses = withBosses && !bossColumnMissing(characters.error);
      const nextQuests = withQuestsHidden && !questsHiddenMissing(characters.error);
      const nextFace = withFace && !faceColumnMissing(characters.error);
      if (nextBosses === withBosses && nextQuests === withQuestsHidden && nextFace === withFace) break;
      if (bossColumnMissing(characters.error) || questsHiddenMissing(characters.error)) {
        columnWarning = columnWarning || characters.error;
      }
      withBosses = nextBosses;
      withQuestsHidden = nextQuests;
      withFace = nextFace;
      characters = await supabase
        .from("characters")
        .select(characterSelect({ bosses: withBosses, questsHidden: withQuestsHidden, face: withFace }))
        .order("updated_at", { ascending: false });
      if (current !== loadId || !list.isConnected) return;
    }
    const error = accountResult.error || characters.error || jobResult.error;
    if (error) {
      rows = [];
      accounts = [];
      jobs = [];
      list.innerHTML = "";
      showStatus(translateDbError(error), "error");
      return;
    }
    bossReady = withBosses;
    questsHiddenReady = withQuestsHidden;
    faceReady = withFace;
    syncFaceField();
    bossFields.hidden = !bossReady;
    questsHiddenFields.hidden = !questsHiddenReady;
    bossFilterBar.hidden = !bossReady;
    if (!bossReady) {
      bossFilters.clear();
      for (const button of bossFilterBar.querySelectorAll("[data-boss-filter]")) {
        button.classList.remove("is-on");
        button.setAttribute("aria-pressed", "false");
      }
      const readyOnly = root.querySelector("[data-boss-ready-only]");
      if (readyOnly) readyOnly.checked = false;
      const soonAlso = root.querySelector("[data-boss-soon-also]");
      if (soonAlso) soonAlso.checked = false;
    }
    accounts = sortByName(accountResult.data ?? []);
    jobs = jobResult.data ?? [];
    rows = characters.data ?? [];
    if (withFace) await attachFaceUrls(supabase, rows);
    if (current !== loadId || !list.isConnected) return;
    if (columnWarning) showStatus(translateDbError(columnWarning), "error");
    if (selectedServer) openServer(selectedServer);
    else paintGate();
  }

  function readForm() {
    const accountId = form.elements.account_id.value;
    const name = form.elements.name.value.trim();
    if (!selectedServer) return { error: "서버를 먼저 선택해 주세요." };
    if (!accounts.length) return { error: "먼저 계정을 만들어 주세요." };
    if (!accountId) return { error: "캐릭터를 넣을 계정을 선택해 주세요." };
    if (!name) return { error: "캐릭터명을 입력해 주세요." };
    const editingId = form.dataset.editingId || "";
    if (countFor(accountId, editingId) >= 6) {
      return { error: "한 계정에는 캐릭터를 6개까지 만들 수 있습니다." };
    }
    const level = readCount(form.elements.level.value, "레벨", 1);
    if (level.error) return level;
    return {
      value: {
        account_id: accountId,
        server: selectedServer,
        name,
        job_id: form.elements.job_id.value || null,
        job: jobs.find((job) => job.id === form.elements.job_id.value)?.name || form.dataset.legacyJob || null,
        level: level.value,
        gear_memo: form.elements.gear_memo.value.trim() || null,
        extra_memo: form.elements.extra_memo.value.trim() || null,
        ...(bossReady
          ? Object.fromEntries(bosses.map((boss) => [boss.columnEnabled, form.elements.namedItem(boss.columnEnabled).checked]))
          : {}),
        ...(questsHiddenReady ? { quests_hidden: form.elements.quests_hidden.checked } : {}),
      },
    };
  }

  root.addEventListener("input", (event) => {
    if (event.target.closest("[data-search], [data-level-min], [data-level-max]")) paintList();
  });

  root.addEventListener("change", (event) => {
    if (event.target.closest("[data-boss-ready-only], [data-boss-soon-also]")) paintList();
  });

  root.addEventListener("submit", (event) => {
    const serverForm = event.target.closest("[data-new-server]");
    if (!serverForm) return;
    event.preventDefault();
    const name = serverForm.elements.server.value.trim();
    if (!name) {
      showStatus("서버 이름을 입력해 주세요.", "error");
      return;
    }
    openServer(name);
  });

  root.addEventListener("click", async (event) => {
    const filterButton = event.target.closest("[data-boss-filter]");
    if (filterButton) {
      const key = filterButton.dataset.bossFilter;
      if (bossFilters.has(key)) bossFilters.delete(key);
      else bossFilters.add(key);
      filterButton.classList.toggle("is-on", bossFilters.has(key));
      filterButton.setAttribute("aria-pressed", String(bossFilters.has(key)));
      paintList();
      return;
    }

    const openServerButton = event.target.closest("[data-open-server]");
    if (openServerButton) openServer(openServerButton.dataset.openServer);
    if (event.target.closest("[data-servers]")) paintGate();
    if (event.target.closest("[data-add-account]")) {
      accountForm.hidden = false;
      accountForm.dataset.editingId = "";
      root.querySelector("[data-account-title]").textContent = "계정 추가";
      accountForm.reset();
      accountForm.elements.name.focus();
    }
    if (event.target.closest("[data-cancel-account]")) {
      accountForm.hidden = true;
      accountForm.dataset.editingId = "";
    }
    if (event.target.closest("[data-add]")) {
      showStatus("", "info");
      fillForm(blank);
    }
    if (event.target.closest("[data-cancel]")) closeForm();

    const addForAccount = event.target.closest("[data-add-character]");
    if (addForAccount) {
      if (addForAccount.disabled) return;
      showStatus("", "info");
      fillForm({ ...blank, account_id: addForAccount.dataset.addCharacter });
    }

    const editAccountButton = event.target.closest("[data-edit-account]");
    if (editAccountButton) {
      const account = accounts.find((item) => item.id === editAccountButton.dataset.editAccount);
      if (!account) return;
      accountForm.hidden = false;
      accountForm.dataset.editingId = account.id;
      root.querySelector("[data-account-title]").textContent = "계정 이름 수정";
      accountForm.elements.name.value = account.name;
      accountForm.elements.name.focus();
    }

    const deleteAccountButton = event.target.closest("[data-delete-account]");
    if (deleteAccountButton) {
      const account = accounts.find((item) => item.id === deleteAccountButton.dataset.deleteAccount);
      if (!account) return;
      if (!window.confirm(`${account.name} 계정을 삭제할까요? 캐릭터가 있으면 삭제되지 않습니다.`)) return;
      const supabase = await getSupabase();
      const { error } = await supabase.from("accounts").delete().eq("id", account.id);
      if (error) {
        showStatus(translateDbError(error), "error");
        return;
      }
      showStatus("계정을 삭제했습니다.", "info");
      await loadCharacters();
    }

    if (event.target.closest("[data-boss-time-dialog]")) {
      if (event.target.closest("[data-boss-time-close]")) bossTimeDialog.close();
      return;
    }

    const bossTimeButton = event.target.closest("[data-boss-time]");
    if (bossTimeButton) {
      openBossTime(bossTimeButton.dataset.character, bossTimeButton.dataset.bossTime);
      return;
    }

    const bossUndoButton = event.target.closest("[data-boss-undo]");
    if (bossUndoButton) {
      await undoBoss(bossUndoButton.dataset.character, bossUndoButton.dataset.bossUndo);
      return;
    }

    const bossRun = event.target.closest("[data-boss]");
    if (bossRun) {
      if (!bossRun.disabled) burstJuice(bossRun);
      await recordBoss(bossRun);
      return;
    }

    const editButton = event.target.closest("[data-edit]");
    if (editButton) {
      const row = rows.find((item) => item.id === editButton.dataset.edit);
      if (!row) return;
      showStatus("", "info");
      fillForm(row);
    }

    const deleteButton = event.target.closest("[data-delete]");
    if (!deleteButton) return;
    const row = rows.find((item) => item.id === deleteButton.dataset.delete);
    if (!row) return;
    if (!window.confirm(`${row.name} 캐릭터를 삭제할까요? 삭제한 내용은 되돌릴 수 없습니다.`)) return;
    deleteButton.disabled = true;
    const supabase = await getSupabase();
    const { error } = await supabase.from("characters").delete().eq("id", row.id);
    if (error) {
      deleteButton.disabled = false;
      showStatus(translateDbError(error), "error");
      return;
    }
    await removeCharacterFace(supabase, row.face_path);
    if (form.dataset.editingId === row.id) closeForm();
    showStatus("캐릭터를 삭제했습니다.", "info");
    await loadCharacters();
  });

  accountForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = accountForm.elements.name.value.trim();
    if (!name) {
      showStatus("계정 이름을 입력해 주세요.", "error");
      return;
    }
    const supabase = await getSupabase();
    const id = accountForm.dataset.editingId;
    const query = id
      ? supabase.from("accounts").update({ name }).eq("id", id)
      : supabase.from("accounts").insert({ name });
    const { error } = await query;
    if (error) {
      showStatus(translateDbError(error), "error");
      return;
    }
    accountForm.hidden = true;
    accountForm.dataset.editingId = "";
    showStatus(id ? "계정 이름을 수정했습니다." : "계정을 저장했습니다.", "info");
    await loadCharacters();
  });

  function enqueueBossWrite(key, task) {
    const tail = bossWrite.get(key) ?? Promise.resolve();
    const run = tail.then(task, task);
    bossWrite.set(key, run.catch(() => {}));
    return run;
  }

  async function saveBossAt(row, boss, value) {
    try {
      const supabase = await getSupabase();
      return await supabase.from("characters").update({ [boss.columnAt]: value }).eq("id", row.id);
    } catch (error) {
      return { error };
    }
  }

  function burstJuice(button) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = button.getBoundingClientRect();
    const layer = document.createElement("div");
    layer.className = "juice-burst";
    layer.style.left = `${rect.left}px`;
    layer.style.top = `${rect.top}px`;
    layer.style.width = `${rect.width}px`;
    layer.style.height = `${rect.height}px`;
    const palettes = {
      rift: { drops: ["#7ecbff", "#3aa0ff", "#1d4ed8", "#67e8f9", "#dbeafe", "#2563eb", "#38bdf8", "#93c5fd"], ring: "#7dd3fc" },
      pianus: { drops: ["#ff2d2d", "#e10600", "#ff5a5a", "#b91c1c", "#ff8a80", "#dc2626", "#fecaca", "#9f1239"], ring: "#f87171" },
    };
    const palette = palettes[button.dataset.boss] || { drops: ["#ff4d2e", "#ff8a1f", "#ffd000", "#ff5c8a", "#ff3d6e", "#ffb703", "#f94144", "#ffe066"], ring: "#ffb703" };
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    for (let i = 0; i < 40; i += 1) {
      const drop = document.createElement("span");
      const originX = 4 + Math.random() * Math.max(rect.width - 8, 1);
      const originY = 3 + Math.random() * Math.max(rect.height - 6, 1);
      const away = Math.atan2(originY - centerY, originX - centerX);
      const angle = (Math.hypot(originX - centerX, originY - centerY) < 8 ? Math.random() * Math.PI * 2 : away) + (Math.random() - 0.5) * 0.5;
      const distance = 56 + Math.random() * 84;
      drop.style.setProperty("--ox", `${originX}px`);
      drop.style.setProperty("--oy", `${originY}px`);
      drop.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
      drop.style.setProperty("--dy", `${Math.sin(angle) * distance}px`);
      drop.style.setProperty("--rot", `${Math.round((Math.random() - 0.5) * 80)}deg`);
      drop.style.background = palette.drops[i % palette.drops.length];
      const size = 8 + Math.random() * 9;
      drop.style.width = `${size}px`;
      drop.style.height = `${size * (0.65 + Math.random() * 0.55)}px`;
      drop.style.animationDelay = `${Math.random() * 90}ms`;
      layer.appendChild(drop);
    }
    const ring = document.createElement("i");
    ring.style.borderColor = palette.ring;
    layer.appendChild(ring);
    document.body.appendChild(layer);
    window.setTimeout(() => layer.remove(), 1400);
    button.classList.add("is-splashing");
    window.setTimeout(() => button.classList.remove("is-splashing"), 280);
  }

  async function recordBoss(button) {
    const boss = bosses.find((item) => item.key === button.dataset.boss);
    const row = rows.find((item) => item.id === button.dataset.character);
    if (!boss || !row || !row[boss.columnEnabled]) return;
    const clickedAt = Date.now();
    const state = bossState(row[boss.columnAt], clickedAt, boss);
    if (!state.ready) return;
    commitBossAt(row, boss, clickedAt);
  }

  function openBossTime(characterId, bossKeyName) {
    const boss = bosses.find((item) => item.key === bossKeyName);
    const row = rows.find((item) => item.id === characterId);
    if (!boss || !row || !row[boss.columnEnabled]) return;
    bossTimeDialog.dataset.character = characterId;
    bossTimeDialog.dataset.boss = bossKeyName;
    bossTimeDialog.querySelector("[data-boss-time-title]").textContent = `${row.name} · ${boss.label}`;
    const parts = bossTimeParts(row[boss.columnAt] || Date.now());
    bossTimeForm.elements.year.value = parts.year;
    bossTimeForm.elements.month.value = parts.month;
    bossTimeForm.elements.day.value = parts.day;
    bossTimeForm.elements.hour.value = parts.hour;
    bossTimeForm.elements.minute.value = parts.minute;
    if (!bossTimeDialog.open) bossTimeDialog.showModal();
    bossTimeForm.elements.year.focus();
    bossTimeForm.elements.year.select();
  }

  bossTimeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const boss = bosses.find((item) => item.key === bossTimeDialog.dataset.boss);
    const row = rows.find((item) => item.id === bossTimeDialog.dataset.character);
    if (!boss || !row) return;
    const parsed = readBossTime({
      year: bossTimeForm.elements.year.value,
      month: bossTimeForm.elements.month.value,
      day: bossTimeForm.elements.day.value,
      hour: bossTimeForm.elements.hour.value,
      minute: bossTimeForm.elements.minute.value,
    });
    if (parsed.error) {
      showStatus(parsed.error, "error");
      return;
    }
    const atMs = parsed.value;
    const previousMs = row[boss.columnAt] == null ? null : new Date(row[boss.columnAt]).getTime();
    if (previousMs != null && Math.floor(previousMs / 60000) === Math.floor(atMs / 60000)) {
      bossTimeDialog.close();
      showStatus("이미 그 시각으로 기록되어 있습니다.", "info");
      return;
    }
    if (atMs > Date.now() + 1000) {
      showStatus("아직 지나지 않은 시각은 기록할 수 없습니다.", "error");
      return;
    }
    bossTimeDialog.close();
    commitBossAt(row, boss, atMs);
  });

  function commitBossAt(row, boss, atMs) {
    const key = `${row.id}:${boss.key}`;
    const previous = row[boss.columnAt] ?? null;
    const previousMs = previous == null ? null : new Date(previous).getTime();
    if (previousMs != null && Math.abs(previousMs - atMs) < 1000) {
      showStatus("이미 그 시각으로 기록되어 있습니다.", "info");
      return;
    }

    const at = new Date(atMs).toISOString();
    const generation = ++bossEpoch;
    const persisted = new Set();
    bossUndo.set(key, { previous, generation, persisted });
    row[boss.columnAt] = at;
    paintList();
    notify(`${row.name} ${boss.label} 도전을 ${formatStamp(atMs)}으로 기록했습니다.`, "info", {
      label: "취소",
      onClick: () => undoBoss(row.id, boss.key),
    });

    enqueueBossWrite(key, async () => {
      const slot = bossUndo.get(key);
      if (!slot || slot.generation !== generation) return;
      const { error } = await saveBossAt(row, boss, at);
      const after = bossUndo.get(key);
      if (!after || after.generation !== generation) {
        if (!error) persisted.add(generation);
        return;
      }
      if (error) {
        bossUndo.delete(key);
        const current = rows.find((item) => item.id === row.id);
        if (current) current[boss.columnAt] = previous;
        if (list.isConnected) {
          paintList();
          showStatus(translateDbError(error), "error");
        }
        return;
      }
      persisted.add(generation);
    });
  }

  async function undoBoss(characterId, bossKeyName) {
    const boss = bosses.find((item) => item.key === bossKeyName);
    const row = rows.find((item) => item.id === characterId);
    const key = `${characterId}:${bossKeyName}`;
    const slot = bossUndo.get(key);
    if (!boss || !row || !slot) return;
    const { previous, generation, persisted } = slot;
    const recordedAt = row[boss.columnAt] ?? null;
    bossUndo.delete(key);
    row[boss.columnAt] = previous;
    paintList();
    enqueueBossWrite(key, async () => {
      const { error } = await saveBossAt(row, boss, previous);
      if (!list.isConnected) return;
      const current = rows.find((item) => item.id === row.id);
      const newer = bossUndo.get(key);
      if (error) {
        if (persisted.has(generation) && current && !newer) {
          bossUndo.set(key, slot);
          current[boss.columnAt] = recordedAt;
          paintList();
        }
        showStatus(translateDbError(error), "error");
        return;
      }
      if (newer || !current || (current[boss.columnAt] ?? null) !== previous) return;
      const when = previous ? formatStamp(previous) : "기록 없음";
      showStatus(`${row.name} ${boss.label} 도전을 ${when}으로 되돌렸습니다.`, "info");
    });
  }

  form.elements.face.addEventListener("change", () => {
    const file = form.elements.face.files?.[0];
    if (!file) return;
    const check = validateFaceFile(file);
    if (check.error) {
      form.elements.face.value = "";
      showStatus(check.error, "error");
      return;
    }
    faceRemoved = false;
    releaseFacePreview();
    faceObjectUrl = URL.createObjectURL(file);
    paintFacePreview(faceObjectUrl);
  });

  form.querySelector("[data-clear-face]").addEventListener("click", () => {
    form.elements.face.value = "";
    faceRemoved = true;
    releaseFacePreview();
    paintFacePreview("");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const parsed = readForm();
    if (parsed.error) {
      showStatus(parsed.error, "error");
      return;
    }
    const file = form.elements.face.files?.[0] || null;
    if (file) {
      const check = validateFaceFile(file);
      if (check.error) {
        showStatus(check.error, "error");
        return;
      }
    }
    const saveButton = form.querySelector("[data-save]");
    saveButton.disabled = true;
    showStatus("저장하는 중입니다.", "info");
    try {
      const supabase = await getSupabase();
      const id = form.dataset.editingId;
      const creating = !id;
      const query = id
        ? supabase.from("characters").update(parsed.value).eq("id", id).select("id").single()
        : supabase.from("characters").insert(parsed.value).select("id").single();
      const { data, error } = await query;
      if (error) {
        showStatus(translateDbError(error), "error");
        return;
      }
      const characterId = data.id;
      form.dataset.editingId = characterId;
      if (faceReady && (file || faceRemoved)) {
        const faceResult = await saveCharacterFace(supabase, {
          characterId,
          file,
          previousPath: form.dataset.facePath || "",
          remove: faceRemoved && !file,
        });
        if (faceResult.error) {
          title.textContent = "캐릭터 수정";
          showStatus(
            creating
              ? `캐릭터는 저장했습니다. ${translateFaceError(faceResult.error)}`
              : translateFaceError(faceResult.error),
            "error",
          );
          return;
        }
        if (faceResult.changed) {
          const { error: faceError } = await supabase
            .from("characters")
            .update({ face_path: faceResult.path })
            .eq("id", characterId);
          if (faceError) {
            title.textContent = "캐릭터 수정";
            showStatus(
              creating ? `캐릭터는 저장했습니다. ${translateDbError(faceError)}` : translateDbError(faceError),
              "error",
            );
            return;
          }
        }
      }
      closeForm();
      showStatus(creating ? "캐릭터를 저장했습니다." : "캐릭터를 수정했습니다.", "info");
      await loadCharacters();
    } catch (error) {
      showStatus(translateFaceError(error), "error");
    } finally {
      saveButton.disabled = false;
    }
  });

  const bossTimer = window.setInterval(() => {
    if (!list.isConnected) {
      window.clearInterval(bossTimer);
      return;
    }
    const now = Date.now();
    for (const button of list.querySelectorAll("[data-boss]")) paintBossButton(button, now);
    if ((!readyOnlyChecked() && !soonAlsoChecked()) || !selectedServer) return;
    const nextKey = attentionIds(now);
    if (nextKey === readyKey) return;
    readyKey = nextKey;
    paintList();
  }, 1000);

  await loadCharacters();
}
