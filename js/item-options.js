// 도감 기본 옵션과 실제 거래 옵션은 서로 다른 값이다. 실제 옵션만 합산 기준에 넣는다.
export const itemOptionFields = [
  {"key": "attack", "label": "공격력"},
  {"key": "magic_attack", "label": "마력"},
  {"key": "str", "label": "STR"},
  {"key": "dex", "label": "DEX"},
  {"key": "int", "label": "INT"},
  {"key": "luk", "label": "LUK"},
  {"key": "hp", "label": "HP"},
  {"key": "mp", "label": "MP"},
  {"key": "defense", "label": "물리 방어"},
  {"key": "magic_defense", "label": "마법 방어"},
  {"key": "accuracy", "label": "명중"},
  {"key": "avoidability", "label": "회피"},
  {"key": "speed", "label": "이동속도"},
  {"key": "jump", "label": "점프력"},
  {"key": "remaining_upgrades", "label": "남은 강화 횟수"},
  {"key": "used_upgrades", "label": "사용한 강화 횟수"},
];

export function readItemOptions(values) {
  const result = {};
  for (const { key, label } of itemOptionFields) {
    const raw = values[key];
    if (raw == null || String(raw).trim() === "") continue;
    const value = Number(String(raw).replaceAll(",", ""));
    if (!Number.isSafeInteger(value) || Math.abs(value) > 2147483647 || (key.endsWith("upgrades") && value < 0)) return { error: `${label}은 허용 범위의 정수로 입력해 주세요.` };
    result[key] = value;
  }
  return { value: result };
}

export function stableJson(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

export function tradeItemKey(row) {
  return stableJson([String(row.name ?? "").trim(), row.item_id ?? null, row.item_snapshot ?? {}, row.item_options ?? {}]);
}

export function itemSnapshot(item) {
  return { name: item.name, category: item.category, base_options: { ...(item.base_options ?? {}) }, requirements: { ...(item.requirements ?? {}) } };
}

export function optionSummary(options = {}) {
  return itemOptionFields.filter(({ key }) => Object.hasOwn(options, key)).map(({ key, label }) => `${label} ${options[key]}`).join(" · ");
}
