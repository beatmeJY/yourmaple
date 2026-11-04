// 장비 착용 직업 고르기(2026-11-04 사용자 요청: 직업 버튼, 여러 개 선택).
// 저장 값은 도감 수집 형식 그대로: 모든 직업 "공용", 초보자만 "초보자", 나머지는 "전사/궁수"처럼 / 로 잇는다.
// 서버(sql/044 정규화 트리거)는 / , · 공백으로 나눠 catalog_item_jobs 에 넣는다.
import { escapeHtml } from "./format.js";

export const JOB_NAMES = ["초보자", "전사", "마법사", "궁수", "도적", "해적"];
const ALL = "공용";

export function parseJobs(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { all: false, jobs: [], other: "" };
  const tokens = raw.split(/[/,·\s]+/).filter(Boolean);
  if (tokens.includes(ALL) && tokens.length === 1) return { all: true, jobs: [], other: "" };
  if (tokens.some(token => !JOB_NAMES.includes(token))) return { all: false, jobs: [], other: raw };
  return { all: false, jobs: JOB_NAMES.filter(job => tokens.includes(job)), other: "" };
}

export function formatJobs({ all, jobs, other }) {
  if (other) return other;
  if (all) return ALL;
  return JOB_NAMES.filter(job => jobs.includes(job)).join("/");
}

// 직업 버튼은 켜고 끄기. 공용을 누르면 다른 직업은 풀리고, 직업을 누르면 공용이 풀린다.
export function toggleJob(state, job) {
  if (job === ALL) return state.all ? { all: false, jobs: [], other: "" } : { all: true, jobs: [], other: "" };
  if (!JOB_NAMES.includes(job)) return state;
  const base = state.all || state.other ? [] : state.jobs;
  const jobs = base.includes(job) ? base.filter(item => item !== job) : [...base, job];
  return { all: false, jobs: JOB_NAMES.filter(item => jobs.includes(item)), other: "" };
}

const esc = value => escapeHtml(String(value ?? ""));

export function jobPickerHtml(value, name = "req:REQ JOB") {
  return `<div class="job-picker" data-job-picker><input type="hidden" name="${esc(name)}" value="${esc(String(value ?? "").trim())}">${jobPickerBody(parseJobs(value))}</div>`;
}

function jobPickerBody(state) {
  const button = (key, label, on, extra = "") => `<button type="button" class="job-chip${on ? " is-picked" : ""}${extra}" data-job-toggle="${esc(key)}" aria-pressed="${on}"><i aria-hidden="true"></i>${esc(label)}</button>`;
  const chips = JOB_NAMES.map(job => button(job, job, state.jobs.includes(job))).join("");
  const other = state.other ? `<span class="job-chip job-chip-other is-picked" aria-label="기존 값 ${esc(state.other)}"><i aria-hidden="true"></i>기존 값 · ${esc(state.other)}</span>` : "";
  const saved = formatJobs(state);
  const note = state.other
    ? " · 직업 목록에 없는 값이라 그대로 둡니다. 직업을 누르면 바뀝니다."
    : state.jobs.length === JOB_NAMES.length ? " · 모든 직업이면 공용을 눌러도 됩니다." : "";
  return `<div class="job-chips" role="group" aria-label="착용 직업">${button(ALL, "공용 · 모든 직업", state.all, " job-chip-all")}${chips}${other}</div><p class="hint job-preview">${saved ? `저장 값: <strong>${esc(saved)}</strong>` : "아무것도 고르지 않으면 착용 직업을 비워 둡니다(미확인)."}${note}</p>`;
}

export function mountJobPicker(container) {
  container.addEventListener("click", event => {
    const toggle = event.target.closest("[data-job-toggle]");
    const picker = toggle?.closest("[data-job-picker]");
    if (!picker || !container.contains(picker)) return;
    const field = picker.querySelector("input[type=hidden]");
    if (field.disabled) return;
    const next = toggleJob(parseJobs(field.value), toggle.dataset.jobToggle);
    field.value = formatJobs(next);
    const key = toggle.dataset.jobToggle;
    for (const node of [...picker.children]) if (node !== field) node.remove();
    picker.insertAdjacentHTML("beforeend", jobPickerBody(next));
    picker.querySelector(`[data-job-toggle="${key}"]`)?.focus();
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
