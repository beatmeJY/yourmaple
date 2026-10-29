import { escapeHtml, formatCount } from "./format.js";

export function neededMonsterAccuracy(row, myLevel) {
  if (myLevel == null || row.required_accuracy == null) return null;
  const reference = row.accuracy_reference_level ?? row.level;
  if (reference == null) return null;
  const gap = Math.max(0, reference - myLevel);
  if (gap > 0 && row.accuracy_per_level == null) return null;
  const raw = Number(row.required_accuracy) + gap * Number(row.accuracy_per_level ?? 0);
  return Math.ceil(Math.round(raw * 1e6) / 1e6);
}

export function monsterCombatFacts(row) {
  const reference = row.accuracy_reference_level ?? row.level;
  const fields = [[`${reference == null ? "기준 레벨 미제공" : `Lv.${reference}`} 필요 명중`, row.required_accuracy], ["MP", row.mp],
    ["물리 공격력", row.physical_attack], ["마법 공격력", row.magic_attack], ["물리 방어력", row.physical_defense], ["마법 방어력", row.magic_defense],
    ["이동속도", row.movement_speed], ["넉백 기준 피해량", row.knockback_damage], ["메소", row.meso_value]];
  return `<dl class="mo-combat-grid">${fields.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${value == null ? `<span class="mo-muted">미제공</span>` : escapeHtml(formatCount(value))}</dd></div>`).join("")}</dl>`;
}
