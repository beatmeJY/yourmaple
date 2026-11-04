// 무기 공격속도 등급과 숫자(2026-11-04 사용자 제공 표).
// 저장 값은 숫자를 알면 "4 (빠름)", 등급만 알면 "빠름", 모르면 빈 문자열이다(SQL062 valid_speed_label 이 받는 모양).
import { escapeHtml } from "./format.js";

export const SPEED_GRADES = [
  { label: "매우 빠름", numbers: [3] },
  { label: "빠름", numbers: [4, 5] },
  { label: "보통", numbers: [6] },
  { label: "느림", numbers: [7, 8] },
  { label: "매우 느림", numbers: [9] },
];

const gradeOf = label => SPEED_GRADES.find(grade => grade.label === label) ?? null;
const gradeOfNumber = number => SPEED_GRADES.find(grade => grade.numbers.includes(number)) ?? null;

// 저장된 값을 읽는다. 표에 없는 값(예: 숫자 2, 다른 글자)은 other 로 돌려 원래 값을 지키게 한다.
export function parseSpeed(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { grade: "", number: null, other: "" };
  const digits = raw.match(/^(\d+)/);
  if (digits) {
    const number = Number(digits[1]);
    const grade = gradeOfNumber(number);
    return grade ? { grade: grade.label, number, other: "" } : { grade: "", number: null, other: raw };
  }
  const grade = gradeOf(raw.replace(/\s+/g, " "));
  return grade ? { grade: grade.label, number: null, other: "" } : { grade: "", number: null, other: raw };
}

export function formatSpeed({ grade, number, other }) {
  if (other) return other;
  if (!grade) return "";
  return number == null ? grade : `${number} (${grade})`;
}

// 등급을 고르면 숫자가 하나뿐인 등급은 숫자를 바로 채우고, 둘인 등급은 이미 고른 숫자가 그 등급에 맞을 때만 남긴다.
export function pickGrade(state, label) {
  const grade = gradeOf(label);
  if (!grade) return { grade: "", number: null, other: "" };
  const number = grade.numbers.length === 1 ? grade.numbers[0] : grade.numbers.includes(state.number) ? state.number : null;
  return { grade: grade.label, number, other: "" };
}

export function pickNumber(state, number) {
  const grade = gradeOf(state.grade);
  if (!grade) return state;
  return { ...state, number: number != null && grade.numbers.includes(number) ? number : null };
}

const esc = value => escapeHtml(String(value ?? ""));

// 편집 칸. 실제 값은 숨은 칸(name)에 넣고, 바뀌면 input 이벤트를 보내 "저장 안 한 변경" 표시가 따라오게 한다.
export function speedPickerHtml(value, name = "attack_speed_label") {
  return `<div class="speed-picker" data-speed-picker><input type="hidden" name="${esc(name)}" value="${esc(String(value ?? "").trim())}">${speedPickerBody(parseSpeed(value))}</div>`;
}

function speedPickerBody(state) {
  const grade = gradeOf(state.grade);
  const gradeButtons = SPEED_GRADES.map((item, index) => {
    const on = item.label === state.grade;
    const bars = Array.from({ length: 5 }, (_, bar) => `<i class="${bar < 5 - index ? "is-on" : ""}"></i>`).join("");
    return `<button type="button" class="speed-grade${on ? " is-picked" : ""}" style="--speed-tone:${index}" data-speed-grade="${esc(item.label)}" aria-pressed="${on}"><span class="speed-bars" aria-hidden="true">${bars}</span><b>${esc(item.label)}</b><small>${esc(item.numbers.join("~"))}</small></button>`;
  }).join("");
  const blank = !state.grade && !state.other;
  const otherButton = state.other ? `<button type="button" class="speed-grade speed-grade-other is-picked" data-speed-keep aria-pressed="true"><b>기존 값</b><small>${esc(state.other)}</small></button>` : "";
  const numbers = grade
    ? `<div class="speed-numbers" role="group" aria-label="${esc(grade.label)} 숫자">${grade.numbers.map(number => `<button type="button" class="speed-number${state.number === number ? " is-picked" : ""}" data-speed-number="${number}" aria-pressed="${state.number === number}">${number}</button>`).join("")}${grade.numbers.length > 1 ? `<button type="button" class="speed-number speed-number-unknown${state.number == null ? " is-picked" : ""}" data-speed-number="" aria-pressed="${state.number == null}">숫자 모름</button>` : `<span class="speed-fixed">${esc(grade.label)}은 ${grade.numbers[0]} 고정</span>`}</div>`
    : "";
  const saved = formatSpeed(state);
  return `<div class="speed-grades" role="group" aria-label="공격속도 등급">${gradeButtons}${otherButton}<button type="button" class="speed-grade speed-grade-blank${blank ? " is-picked" : ""}" data-speed-grade="" aria-pressed="${blank}"><b>미확인</b><small>비워 두기</small></button></div>${numbers}<p class="hint speed-preview" data-speed-preview>${saved ? `저장 값: <strong>${esc(saved)}</strong>` : "공격속도를 비워 둡니다."}${state.other ? " · 표에 없는 값이라 그대로 둡니다. 등급을 고르면 바뀝니다." : ""}</p>`;
}

export function mountSpeedPicker(container) {
  container.addEventListener("click", event => {
    const picker = event.target.closest("[data-speed-picker]");
    if (!picker || !container.contains(picker)) return;
    const gradeButton = event.target.closest("[data-speed-grade]");
    const numberButton = event.target.closest("[data-speed-number]");
    if (!gradeButton && !numberButton) return;
    const field = picker.querySelector("input[type=hidden]");
    if (field.disabled) return;
    const current = parseSpeed(field.value);
    const next = gradeButton
      ? pickGrade(current, gradeButton.dataset.speedGrade)
      : pickNumber(current, numberButton.dataset.speedNumber === "" ? null : Number(numberButton.dataset.speedNumber));
    const value = formatSpeed(next);
    if (value === field.value) return;
    field.value = value;
    const focusKey = gradeButton ? `[data-speed-grade="${gradeButton.dataset.speedGrade}"]` : `[data-speed-number="${numberButton.dataset.speedNumber}"]`;
    for (const node of [...picker.children]) if (node !== field) node.remove();
    picker.insertAdjacentHTML("beforeend", speedPickerBody(next));
    picker.querySelector(focusKey)?.focus();
    picker.querySelector(".speed-numbers")?.classList.toggle("is-new", Boolean(gradeButton));
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
