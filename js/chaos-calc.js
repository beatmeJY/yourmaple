// 혼돈의 주문서 60% 한 장씩 바르기(2026-10-30 사용자 요청).
// 확률은 본섭에 공개된 값으로 알려진 표를 기본값으로 둔다. 메이플랜드 공식 확인 전이라 화면에서 바꿀 수 있다.
// 규칙: 업그레이드 가능 횟수를 1 쓴다. 성공하면 이미 붙어 있는(0보다 큰) 능력치마다 따로 변화량을 굴린다.
// 최대 HP·MP는 변화량의 10배. 0 이하가 된 능력치는 사라지고 다시 붙지 않는다. 실패하면 횟수만 준다.

export const CHAOS_STATS = [
  { key: "str", label: "STR" },
  { key: "dex", label: "DEX" },
  { key: "int", label: "INT" },
  { key: "luk", label: "LUK" },
  { key: "attack", label: "공격력" },
  { key: "magic_attack", label: "마력" },
  { key: "defense", label: "물리 방어" },
  { key: "magic_defense", label: "마법 방어" },
  { key: "accuracy", label: "명중" },
  { key: "avoidability", label: "회피" },
  { key: "speed", label: "이동속도" },
  { key: "jump", label: "점프력" },
  { key: "hp", label: "HP", scale: 10 },
  { key: "mp", label: "MP", scale: 10 },
];

// 변화량별 확률(%). 합이 100.
export const DEFAULT_CHAOS = {
  successRate: 60,
  deltas: [
    { value: -5, percent: 4.94 },
    { value: -4, percent: 2.97 },
    { value: -3, percent: 3.65 },
    { value: -2, percent: 8 },
    { value: -1, percent: 13.7 },
    { value: 0, percent: 18.38 },
    { value: 1, percent: 19.31 },
    { value: 2, percent: 15.87 },
    { value: 3, percent: 10.21 },
    { value: 4, percent: 1.98 },
    { value: 5, percent: 0.99 },
  ],
};

export function statScale(key) {
  return CHAOS_STATS.find((stat) => stat.key === key)?.scale ?? 1;
}

// 확률 설정 검사: 성공률 0~100, 변화량 확률은 0 이상이고 합이 100(소수 둘째 자리 반올림 오차 허용).
export function checkChaosTable(table) {
  const rate = Number(table?.successRate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return { error: "성공률은 0~100% 사이로 적어 주세요." };
  const deltas = table?.deltas ?? [];
  if (!deltas.length) return { error: "변화량 확률이 없습니다." };
  let sum = 0;
  for (const delta of deltas) {
    const percent = Number(delta.percent);
    if (!Number.isInteger(delta.value) || !Number.isFinite(percent) || percent < 0) return { error: "변화량 확률은 0 이상으로 적어 주세요." };
    sum += percent;
  }
  if (Math.abs(sum - 100) > 0.011) return { error: `변화량 확률의 합이 ${Math.round(sum * 100) / 100}%예요. 100%가 되게 맞춰 주세요.` };
  return { ok: true, sum };
}

// 0~1 난수 하나로 변화량 하나를 고른다(확률표 순서대로 누적).
export function pickDelta(deltas, random) {
  const total = deltas.reduce((sum, delta) => sum + Number(delta.percent), 0);
  let left = random * total;
  for (const delta of deltas) {
    left -= Number(delta.percent);
    if (left < 0) return delta.value;
  }
  return deltas.at(-1).value;
}

// 한 장 바르기. item = { slots, stats: { key: value } }. random() 은 0 이상 1 미만.
// 결과: { item, success, changes: [{ key, before, after, delta, gone }] }
export function applyChaos(item, table, random = Math.random) {
  if (!(item?.slots > 0)) return { error: "남은 업그레이드 횟수가 없어요." };
  const next = { slots: item.slots - 1, stats: { ...item.stats } };
  const success = random() * 100 < Number(table.successRate);
  const changes = [];
  if (success) {
    for (const { key } of CHAOS_STATS) {
      const before = next.stats[key];
      if (!(before > 0)) continue;
      const delta = pickDelta(table.deltas, random()) * statScale(key);
      const after = Math.max(0, before + delta);
      if (after > 0) next.stats[key] = after;
      else delete next.stats[key];
      changes.push({ key, before, after, delta, gone: after === 0 });
    }
  }
  return { item: next, success, changes };
}

// 시작 상태 대비 지금 능력치 차이(사라진 능력치는 0으로 본다).
export function statDiff(start, now) {
  return CHAOS_STATS
    .filter(({ key }) => (start.stats[key] ?? 0) > 0 || (now.stats[key] ?? 0) > 0)
    .map(({ key, label }) => ({ key, label, start: start.stats[key] ?? 0, now: now.stats[key] ?? 0, diff: (now.stats[key] ?? 0) - (start.stats[key] ?? 0) }));
}

// 장비 등급 색(2026-11-09 사용자 기준). 정옵(도감 기본 옵션)과 지금 능력치 차이를 더해 점수를 낸다.
// 공격력·마력·STR·DEX·INT·LUK·물리/마법 방어·명중·회피는 1당 1점, HP·MP는 10당 1점(소수 그대로). 이동속도·점프력은 넣지 않는다.
// 소수 오차를 피하려고 0.1점 단위 정수(tenths)로 계산한다.
const GRADE_STATS = ["attack", "magic_attack", "str", "dex", "int", "luk", "defense", "magic_defense", "accuracy", "avoidability", "hp", "mp"];

export function chaosScoreTenths(base, now) {
  let tenths = 0;
  for (const key of GRADE_STATS) {
    const diff = (Number(now?.[key]) || 0) - (Number(base?.[key]) || 0);
    tenths += statScale(key) === 10 ? diff : diff * 10;
  }
  return tenths;
}

// 구간은 아래 경계부터 다음 구간 전까지(예: 5.5점은 0~5 구간, −0.5점은 회색).
// 0~5는 주문서가 한 번이라도 성공했으면 "작"(주황), 아니면 "노작"(흰색).
export const CHAOS_GRADES = [
  { key: "red", name: "빨강", min: 70, color: "#ff4d6a" },
  { key: "green", name: "연두", min: 55, color: "#a3e635" },
  { key: "yellow", name: "노랑", min: 40, color: "#ffd84d" },
  { key: "purple", name: "보라", min: 23, color: "#b884ff" },
  { key: "blue", name: "파랑", min: 6, color: "#4fa8ff" },
  { key: "orange", name: "주황", min: 0, color: "#ff9a3c" },
  { key: "white", name: "흰색", min: 0, color: "#f4f1ff" },
  { key: "gray", name: "회색", min: -Infinity, color: "#8b8798" },
];

export function chaosGrade(tenths, successes) {
  const score = tenths / 10;
  if (score < 0) return CHAOS_GRADES.find((grade) => grade.key === "gray");
  if (score < 6) return CHAOS_GRADES.find((grade) => grade.key === (successes > 0 ? "orange" : "white"));
  return CHAOS_GRADES.find((grade) => grade.min !== 0 && score >= grade.min);
}

// 0.1점 단위 정수를 "+27.5"·"−3"·"0" 같은 글자로.
export function scoreText(tenths) {
  const sign = tenths > 0 ? "+" : tenths < 0 ? "−" : "";
  const abs = Math.abs(tenths);
  return `${sign}${Math.floor(abs / 10)}${abs % 10 ? `.${abs % 10}` : ""}`;
}
