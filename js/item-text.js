// 아이템 설명 정리(2026-11-23 사용자 요청). sql/073 의 catalog_import_private.item_text 와 같은 규칙이다(한쪽을 고치면 다른 쪽도).
// - 게임 글자색 기호 #c…# 를 지운다. 닫는 # 가 없으면 글 끝까지가 한 덩어리다.
// - "#c성공률 10%STR +3공격력 +5#" 같은 주문서 효과 덩어리는 설명에서 빼고, 능력치는 장비 옵션처럼 options 로,
//   나머지(성공률·파괴 확률·조건·업그레이드 회복 등)는 효과 줄(effects)로 나눈다.
// - 빠진 줄바꿈을 넣는다: 문장 끝 "다." 바로 뒤에 글자가 붙어 있을 때, "직업 : "·"조건 : " 앞이 붙어 있을 때,
//   강조 덩어리(#c)가 문장 끝 뒤에서 시작할 때.
export const effectStatKeys = {
  STR: "str", DEX: "dex", INT: "int", LUK: "luk", "공격력": "attack", "마력": "magic_attack",
  "방어력": "defense", "마법방어력": "magic_defense", "최대 HP": "hp", "최대 MP": "mp",
  "명중치": "accuracy", "회피치": "avoidability", "이동속도": "speed", "점프력": "jump",
};
// 손재주처럼 옵션 칸이 없는 능력치는 효과 줄로 남긴다.
const TOKEN = "(STR|DEX|INT|LUK|공격력|마법방어력|마력|방어력|최대 HP|최대 MP|명중치|회피치|이동속도|점프력|손재주) ([+-][0-9]+)";
const tokenAtStart = new RegExp(`^${TOKEN}`);
const tokenAnywhere = new RegExp(TOKEN);
const effectStart = /^(조건 : 잔여 업그레이드 가능 횟수 [0-9]+회 이상)?성공률 [0-9]+%/;

function parseEffect(body, effects, options) {
  let rest = body, match;
  const take = (pattern) => { const found = rest.match(pattern); if (found) rest = rest.slice(found[0].length); return found; };
  if ((match = take(/^조건 : (잔여 업그레이드 가능 횟수 [0-9]+회 이상)/))) effects.push(`조건 : ${match[1]}`);
  if ((match = take(/^성공률 ([0-9]+)%/))) effects.push(`성공률 ${match[1]}%`);
  if ((match = take(/^실패시 ([0-9]+)% 확률로 파괴/))) effects.push(`실패 시 ${match[1]}% 확률로 파괴`);
  while (rest) {
    if ((match = take(tokenAtStart))) {
      const key = effectStatKeys[match[1]];
      if (key && !Object.hasOwn(options, key)) options[key] = Number(match[2]);
      else effects.push(`${match[1]} ${match[2]}`);
      continue;
    }
    const at = rest.search(tokenAnywhere);
    const words = (at > 0 ? rest.slice(0, at) : rest).trim();
    if (words) effects.push(words);
    rest = at > 0 ? rest.slice(at) : "";
  }
}

export function tidyItemText(value) {
  return String(value ?? "")
    .replace(/([^\s])(직업|조건) : /g, "$1\n$2 : ")
    .replace(/다\.([가-힣A-Za-z])/g, "다.\n$1")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanItemText(raw) {
  let rest = String(raw ?? ""), out = "";
  const effects = [], options = {};
  for (;;) {
    const start = rest.indexOf("#c");
    if (start < 0) break;
    out += rest.slice(0, start);
    rest = rest.slice(start + 2);
    const end = rest.indexOf("#");
    const body = end < 0 ? rest : rest.slice(0, end);
    rest = end < 0 ? "" : rest.slice(end + 1);
    if (effectStart.test(body)) { parseEffect(body, effects, options); continue; }
    if (/[.!?][ \t]*$/.test(out)) out = `${out.replace(/[ \t]+$/, "")}\n`;
    out += body;
  }
  return { description: tidyItemText(out + rest), effects, options };
}

// 화면용: sql/073 을 실행하기 전 자료(#c 가 남은 설명)도 같은 모습으로 보이게 한다. 실행 뒤에는 그대로 돌려준다.
export function displayItemText(item = {}) {
  const parsed = cleanItemText(item.description);
  const effect = cleanItemText(item.effect_description);
  const effects = [...(effect.description ? effect.description.split("\n") : []), ...effect.effects, ...parsed.effects]
    .map((line) => line.trim()).filter(Boolean);
  const hasOptions = item.base_options && Object.keys(item.base_options).length;
  return { description: parsed.description, effects, options: hasOptions ? {} : { ...effect.options, ...parsed.options } };
}

// 착용 조건 칸 이름처럼 덩어리를 나누지 않는 곳은 기호만 지운다(#c 가 있는 글만).
export const stripItemMarks = (value) => { const text = String(value ?? ""); return text.includes("#c") ? text.replace(/#c/g, "").replace(/#/g, "") : text; };

// 장비 효과 글("물리방어력 : + 95(90~100) STR : + 6(5~7) … 업그레이드 가능 횟수: 10 상점가: 200000메소")에서
// 이미 옵션·공격속도·업그레이드 횟수·상점가 칸으로 보여 주는 것과 값이 같은 부분을 뺀다(2026-11-23 사용자 요청).
// 값이 다르거나 모르는 글은 그대로 남겨 차이를 볼 수 있게 한다. 원문은 바꾸지 않고 화면에서만 뺀다.
const shownStatKeys = {
  "물리방어력": "defense", "물리공격력": "attack", "마법방어력": "magic_defense", "마법공격력": "magic_attack",
  "최대HP": "hp", "최대MP": "mp", STR: "str", DEX: "dex", INT: "int", LUK: "luk",
  "명중률": "accuracy", "회피율": "avoidability", "이동속도": "speed", "점프력": "jump",
};
const shownStatPattern = new RegExp(`(${Object.keys(shownStatKeys).join("|")}) ?: ?([+-]) ?([0-9]+)(?:\\(([0-9]+)~([0-9]+)\\))?`, "g");
const sameNumber = (a, b) => (a == null || a === "" ? null : Number(a)) === (b == null || b === "" ? null : Number(b));

export function dropShownEffect(raw, { stats = [], attackSpeed = null, shopPrice = null } = {}) {
  let text = String(raw ?? "");
  const byKey = new Map(stats.map((row) => [row.stat_key, row]));
  text = text.replace(shownStatPattern, (whole, label, sign, value, min, max) => {
    const row = byKey.get(shownStatKeys[label]);
    if (!row || !sameNumber(row.base_value, Number(value) * (sign === "-" ? -1 : 1))) return whole;
    const rangeShown = row.minimum_value != null && row.maximum_value != null;
    if (min != null && rangeShown && !(sameNumber(row.minimum_value, min) && sameNumber(row.maximum_value, max))) return whole;
    return " ";
  });
  text = text.replace(/업그레이드 가능 횟수 ?: ?([0-9]*)/, (whole, value) => sameNumber(byKey.get("remaining_upgrades")?.base_value, value) ? " " : whole);
  text = text.replace(/상점가 ?: ?([0-9,]*) ?(메소)?/, (whole, value) => sameNumber(shopPrice, value.replace(/,/g, "")) ? " " : whole);
  text = text.replace(/공격속도 ?: ?(.+?)(?= 업그레이드| 상점가|$)/, (whole, value) =>
    String(attackSpeed ?? "").replace(/\s+/g, "") === value.replace(/\s+/g, "") ? " " : whole);
  return text.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
}
