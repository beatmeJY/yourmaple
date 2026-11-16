// 몬스터 도감 수정창의 입력 규칙(2026-11-16 사용자 요청: 개발자는 몬스터 도감을 고칠 수 있어야 한다).
// 서버(sql/069)도 같은 규칙으로 다시 검사한다. 빈칸은 "미제공"(null), 0은 실제 값이다.
import { elements } from "./monster-merge.js";

// [키, 화면 이름, 종류] — int: 0 이상 정수, pos: 1 이상 정수, num: 0 이상 숫자, signed: 음수도 되는 숫자
export const monsterEditFields = [
  ["level", "레벨", "pos"],
  ["hp", "HP", "int"],
  ["exp", "경험치", "int"],
  ["mp", "MP", "num"],
  ["required_accuracy", "필요 명중", "num"],
  ["accuracy_reference_level", "명중 기준 레벨", "pos"],
  ["accuracy_per_level", "레벨당 명중 증가", "num"],
  ["physical_attack", "물리 공격력", "num"],
  ["magic_attack", "마법 공격력", "num"],
  ["physical_defense", "물리 방어력", "num"],
  ["magic_defense", "마법 방어력", "num"],
  ["movement_speed", "이동속도", "signed"],
  ["knockback_damage", "넉백 기준 피해량", "num"],
  ["meso_value", "메소", "num"],
];

const MAX_INT = 2147483647;
const MAX_BIG = 9007199254740991; // JSON 숫자로 안전하게 오가는 최대 정수

function readNumber(raw, label, kind) {
  const text = String(raw ?? "").trim().replaceAll(",", "");
  if (text === "") return null;
  if (!/^[+-]?\d+(\.\d+)?$/.test(text)) throw new Error(`${label}은 숫자로 입력해 주세요.`);
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error(`${label}은 숫자로 입력해 주세요.`);
  if (kind !== "signed" && value < 0) throw new Error(`${label}은 0 이상으로 입력해 주세요.`);
  if (kind === "int" || kind === "pos") {
    if (!Number.isInteger(value)) throw new Error(`${label}은 정수로 입력해 주세요.`);
    if (kind === "pos" && value < 1) throw new Error(`${label}은 1 이상으로 입력해 주세요.`);
    if (value > (kind === "pos" ? MAX_INT : MAX_BIG)) throw new Error(`${label}이 너무 큽니다.`);
  }
  if (Math.abs(value) > 1e15) throw new Error(`${label}이 너무 큽니다.`);
  return value;
}

// values: { name, [키]: 입력 글자, weak: ["불"], resist: [] } → 서버로 보낼 draft
export function readMonsterDraft(values) {
  const name = String(values.name ?? "").trim();
  if (!name || name.length > 200) throw new Error("몬스터 이름은 1~200자로 입력해 주세요.");
  const draft = { name };
  for (const [key, label, kind] of monsterEditFields) draft[key] = readNumber(values[key], label, kind);
  const pick = (list) => elements.filter((name) => (list ?? []).includes(name));
  const weak = pick(values.weak), resist = pick(values.resist);
  const both = weak.filter((name) => resist.includes(name));
  if (both.length) throw new Error(`${both.join(", ")} 속성은 약점과 반감에 함께 둘 수 없어요.`);
  draft.weak_elements = weak;
  draft.resist_elements = resist;
  return draft;
}

// DB 행 → 수정창 처음 값
export function monsterDraftFromRow(row) {
  const draft = { name: row.name ?? "" };
  for (const [key] of monsterEditFields) draft[key] = row[key] ?? null;
  const split = (text) => String(text ?? "").split(",").map((v) => v.trim()).filter((v) => elements.includes(v));
  draft.weak_elements = split(row.weak_elements);
  draft.resist_elements = split(row.resist_elements);
  return draft;
}
