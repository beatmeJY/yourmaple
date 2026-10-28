export const MAX_FLOOR = 27;
export const DAILY_CAP = 3500;
export const SAVE_FLOORS = [5, 10, 15, 20, 25];
export const SAVE_SECONDS = 5;

export const BELTS = [
  { id: "white", name: "흰색 허리띠", score: 140 },
  { id: "yellow", name: "노란색 허리띠", score: 1300 },
  { id: "blue", name: "파란색 허리띠", score: 2800 },
  { id: "red", name: "빨간색 허리띠", score: 6400 },
  { id: "black", name: "검은색 허리띠", score: 12000 },
];
export const GOAL_SCORE = BELTS.find((belt) => belt.id === "black").score;

export const BANDS = [
  { start: 1, end: 5 },
  { start: 6, end: 10 },
  { start: 11, end: 15 },
  { start: 16, end: 20 },
  { start: 21, end: 25 },
  { start: 26, end: 27 },
];

const STARTS = BANDS.map((band) => band.start);

export function floorPoints(floor, party) {
  const solo = floor <= 5 ? 2 : floor <= 10 ? 3 : floor <= 15 ? 4 : floor <= 20 ? 5 : floor <= 25 ? 6 : 7;
  return party ? solo - 1 : solo;
}

export function bandPoints(start, party) {
  const band = BANDS.find((item) => item.start === start);
  if (!band) return 0;
  return floorPoints(band.start, party) * (band.end - band.start + 1);
}

export function parseFloors(value) {
  const map = new Map();
  if (!value || typeof value !== "object") return map;
  for (const [key, raw] of Object.entries(value)) {
    const floor = Number(key);
    const seconds = Number(raw);
    if (!STARTS.includes(floor)) continue;
    if (!Number.isInteger(seconds) || seconds < 1) continue;
    map.set(floor, seconds);
  }
  return map;
}

export function compareRoutes(a, b) {
  const left = a.points * b.seconds;
  const right = b.points * a.seconds;
  if (left !== right) return right > left ? 1 : -1;
  if (a.points !== b.points) return b.points - a.points;
  return a.start - b.start;
}

function spanToTop(times, start, party) {
  const startIndex = BANDS.findIndex((band) => band.start === start);
  if (startIndex < 0) return null;
  let points = 0;
  let seconds = 0;
  for (let index = startIndex; index < BANDS.length; index += 1) {
    const band = BANDS[index];
    const time = times.get(band.start);
    if (time == null) return null;
    points += bandPoints(band.start, party);
    seconds += time;
  }
  return { start, end: MAX_FLOOR, points, seconds };
}

function bandStartAfter(saveFloor) {
  return BANDS.find((band) => band.start > saveFloor)?.start ?? null;
}

function pointsFromStart(start, party) {
  const startIndex = BANDS.findIndex((band) => band.start === start);
  if (startIndex < 0) return 0;
  let points = 0;
  for (let index = startIndex; index < BANDS.length; index += 1) {
    points += bandPoints(BANDS[index].start, party);
  }
  return points;
}

export function chainPoints(party, saves) {
  let points = pointsFromStart(1, party);
  for (const saveFloor of saves ?? []) {
    const start = bandStartAfter(saveFloor);
    if (start != null) points += pointsFromStart(start, party);
  }
  return points;
}

function saveChains() {
  const chains = [[]];
  for (const floor of SAVE_FLOORS) {
    const longer = chains.map((chain) => [...chain, floor]);
    chains.push(...longer);
  }
  return chains;
}

function chainRoute(times, party, saves) {
  const full = spanToTop(times, 1, party);
  if (!full) return null;
  const runs = [full];
  for (const saveFloor of saves) {
    const previous = saves[saves.indexOf(saveFloor) - 1];
    if (previous != null && saveFloor <= previous) return null;
    const start = bandStartAfter(saveFloor);
    if (start == null) return null;
    if (previous != null && start <= bandStartAfter(previous)) return null;
    const span = spanToTop(times, start, party);
    if (!span) return null;
    runs.push(span);
  }
  return {
    saves,
    saveFloor: saves.at(-1) ?? null,
    start: runs[1]?.start ?? 1,
    end: MAX_FLOOR,
    points: runs.reduce((sum, run) => sum + run.points, 0),
    seconds: runs.reduce((sum, run) => sum + run.seconds, 0) + saves.length * SAVE_SECONDS,
    runs,
  };
}

export function compareSaves(times, party) {
  const map = times instanceof Map ? times : parseFloors(times);
  const rows = saveChains().map((saves) => ({
    saves,
    saveFloor: saves.at(-1) ?? null,
    start: saves.length ? bandStartAfter(saves[0]) : 1,
    best: chainRoute(map, party, saves),
  }));
  const ranked = rows.filter((row) => row.best).sort((a, b) => compareRoutes(a.best, b.best));
  return { rows, best: ranked[0]?.best ?? null };
}

export function playSeconds(route, score) {
  if (!route?.points || score <= 0) return 0;
  return (score * route.seconds) / route.points;
}

export function calendarDays(score) {
  if (score <= 0) return 0;
  return Math.ceil(score / DAILY_CAP);
}

function readPrice(prices, id) {
  if (!prices) return null;
  const value = prices instanceof Map ? prices.get(id) : prices[id];
  if (value == null || value === "") return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export function mesoFromSale(total, points, route) {
  if (total == null || points <= 0 || !route?.points || !route.seconds) return null;
  const numerator = BigInt(total) * BigInt(route.points) * 3600n;
  const denominator = BigInt(points) * BigInt(route.seconds);
  if (denominator === 0n) return null;
  return numerator / denominator;
}

export function mesoPerHour(price, score, route) {
  if (price == null) return null;
  return mesoFromSale(price, score, route);
}

export function quoteBlackBelt(prices, route, actualSeconds) {
  const missing = [];
  let total = 0n;
  let priced = 0;
  for (const belt of BELTS) {
    const price = readPrice(prices, belt.id);
    if (price == null) missing.push(belt);
    else {
      total += price;
      priced += 1;
    }
  }
  const paced = route?.points && actualSeconds ? { points: route.points, seconds: actualSeconds } : null;
  return {
    seconds: paced ? playSeconds(paced, GOAL_SCORE) : null,
    days: calendarDays(GOAL_SCORE),
    total: priced === BELTS.length ? total : null,
    hour: paced && priced === BELTS.length ? mesoFromSale(total, GOAL_SCORE, paced) : null,
    missing,
  };
}

export function quoteSale(prices, targetScore, currentScore, route) {
  const target = Math.min(Math.max(0, targetScore), GOAL_SCORE);
  const score = Math.max(0, Number(currentScore) || 0);
  const need = Math.max(0, target - score);
  const belts = BELTS.filter((belt) => belt.score > score && belt.score <= target);
  const missing = [];
  let total = 0n;
  let priced = 0;
  for (const belt of belts) {
    const price = readPrice(prices, belt.id);
    if (price == null) missing.push(belt);
    else {
      total += price;
      priced += 1;
    }
  }
  return {
    need,
    seconds: route && need ? playSeconds(route, need) : need ? null : 0,
    days: calendarDays(need),
    belts,
    missing,
    total: priced ? total : null,
    hour: priced ? mesoFromSale(total, need, route) : null,
  };
}

export function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "-";
  const seconds = Math.round(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0 && minutes === 0 && rest === 0) return `${hours.toLocaleString("ko-KR")}시간`;
  if (hours > 0 && rest === 0) return `${hours.toLocaleString("ko-KR")}시간 ${minutes}분`;
  if (hours > 0) return `${hours.toLocaleString("ko-KR")}시간 ${minutes}분 ${rest}초`;
  if (minutes > 0 && rest === 0) return `${minutes}분`;
  if (minutes > 0) return `${minutes}분 ${rest}초`;
  return `${rest}초`;
}

export function formatPerMinute(points, seconds) {
  if (!seconds) return "-";
  const value = (points * 60) / seconds;
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}점`;
}

function formatRate(value, unit) {
  if (!Number.isFinite(value)) return "-";
  return `${value.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${unit}`;
}

export function formatPointsPerSecond(points, seconds) {
  if (!seconds) return "-";
  return formatRate(points / seconds, "점");
}

export function formatSecondsPerPoint(points, seconds) {
  if (!points) return "-";
  return formatRate(seconds / points, "초");
}

export function roundToFloor(round) {
  return round + Math.floor((round - 1) / 5);
}

// 층별 보스(2026-10-28 사용자 제공). 우리 동선은 크림슨 발록(32층, 27라운드)까지라 그 층까지만 둔다.
// note는 그 보스에서 조심할 것(예전 구간 주의 문구를 보스에 붙임).
export const FLOOR_BOSSES = {
  1: { name: "마노" },
  2: { name: "스텀피" },
  3: { name: "데우" },
  4: { name: "킹슬라임" },
  5: { name: "대왕지네" },
  7: { name: "파우스트" },
  8: { name: "킹크랑" },
  9: { name: "머쉬맘" },
  10: { name: "알리샤르" },
  11: { name: "타이머", note: "스턴" },
  13: { name: "다일" },
  14: { name: "파파픽시", note: "실명 · 스킬잠금" },
  15: { name: "좀비머쉬맘" },
  16: { name: "제노" },
  17: { name: "데비존" },
  19: { name: "구미호", note: "실명" },
  20: { name: "태륜" },
  21: { name: "초강화형 포이즌골렘", note: "스킬잠금 · 실명 · 키반대" },
  22: { name: "요괴선사" },
  23: { name: "주니어 발록" },
  25: { name: "엘리쟈" },
  26: { name: "프랑켄로이드", note: "실명 · 스킬잠금" },
  27: { name: "키메라" },
  28: { name: "포장마차" },
  29: { name: "스노우맨", note: "스턴" },
  31: { name: "블루 머쉬맘" },
  32: { name: "크림슨 발록" },
};

// 라운드 구간 안의 보스를 층 순서대로: [{ floor, round, name, note }]
export function bandBosses(start, end) {
  const list = [];
  for (let round = start; round <= end; round += 1) {
    const floor = roundToFloor(round);
    const boss = FLOOR_BOSSES[floor];
    if (boss) list.push({ floor, round, name: boss.name, note: boss.note ?? "" });
  }
  return list;
}

export function saveFloorToFloor(saveRound) {
  return roundToFloor(saveRound) + 1;
}

export function saveText(saveFloor) {
  if (saveFloor == null) return "저장 안 함";
  return `${saveFloorToFloor(saveFloor)}층`;
}

export function chainKey(saves) {
  return (saves ?? []).join(",");
}

export function readRuns(value) {
  const map = new Map();
  if (!value || typeof value !== "object" || Array.isArray(value)) return map;
  for (const [key, raw] of Object.entries(value)) {
    const seconds = Number(raw);
    if (Number.isInteger(seconds) && seconds >= 1 && seconds <= 86400) map.set(String(key), seconds);
  }
  return map;
}

export function measuredRoutes(times, party, runs) {
  const map = runs instanceof Map ? runs : readRuns(runs);
  const compared = compareSaves(times, party);
  const rows = compared.rows
    .filter((row) => map.has(chainKey(row.saves)))
    .map((row) => ({
      route: row.best ?? { points: chainPoints(party, row.saves), saves: row.saves, start: row.start, end: MAX_FLOOR },
      seconds: map.get(chainKey(row.saves)),
    }))
    .sort((left, right) =>
      compareRoutes(
        { points: left.route.points, seconds: left.seconds, start: left.route.start },
        { points: right.route.points, seconds: right.seconds, start: right.route.start },
      ),
    );
  return { compared, best: rows[0] ?? null, rows };
}

export function chainText(saves) {
  if (!saves?.length) return "저장 안 함";
  if (saves.length === SAVE_FLOORS.length) return "올저장";
  return saves.map((floor) => `${saveFloorToFloor(floor)}층`).join(" → ");
}

export function spanParts(start, end) {
  const floorStart = roundToFloor(start);
  const floorEnd = roundToFloor(end);
  const floorLabel = floorStart === floorEnd ? `${floorStart}층` : `${floorStart}~${floorEnd}층`;
  const roundLabel = start === end ? `${start}라운드` : `${start}~${end}라운드`;
  return { floorLabel, roundLabel };
}

export function spanText(start, end) {
  const { floorLabel, roundLabel } = spanParts(start, end);
  return `${floorLabel}(${roundLabel})`;
}

export function cycleText(route) {
  if (!route) return "-";
  if (route.runs?.length) return route.runs.map((run) => spanText(run.start, run.end)).join(" 후 ");
  if (route.saveFloor == null) return spanText(1, MAX_FLOOR);
  return `${spanText(1, MAX_FLOOR)} 후 ${spanText(route.start, route.end)}`;
}

export function beltById(id) {
  return BELTS.find((belt) => belt.id === id) ?? null;
}
