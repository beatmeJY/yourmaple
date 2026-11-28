// 현금·메소·메이플포인트 가치 비교(2026-11-28 사용자 요청). 화면은 js/pages/meso-point.js, 검사는 js/meso-point-calc.check.mjs.
// 사용자 기준값: 월드코인 1개 = 7.5원, 1만 포인트 = 1,400 월드코인 = 10,500원 → 1포인트 = 1.05원.
// 시세 두 가지(사용자가 적음):
//   exchange = 게임 내 교환, 1만 포인트당 메소
//   cash     = 유저 현금 거래, 100만 메소당 원
// 메소는 BigInt로 계산한다. 포인트를 원으로 바꿀 때 소수(1.05원)가 생기므로 분수(분자·분모)로 들고 가서 마지막에 한 번만 자른다.
// 포인트는 묶음 단위가 아니라 필요한 만큼 살 수 있다고 보고 계산한다.

export const WORLD_COIN_WON = 7.5;
export const COINS_PER_10K_POINT = 1400n;
export const WON_PER_10K_POINT = 10500n; // 1,400 × 7.5
export const POINT_UNIT = 10000n;
export const MESO_UNIT = 1000000n; // 현금 거래 시세 단위(100만 메소)

const ceilDiv = (a, b) => (a + b - 1n) / b;

/** 포인트 → 원(소수 둘째 자리까지 정확한 Number). 5,000포인트 = 5,250원 */
export function pointsToWon(points) {
  return Number(points * WON_PER_10K_POINT) / Number(POINT_UNIT);
}

/** 게임 내 교환 시세를 현금 거래 단위로: 100만 메소당 원(소수 첫째 자리). 3,000만 → 350원 */
export function exchangeWonPer1m(exchange) {
  if (!exchange) return null;
  return Math.round(Number((WON_PER_10K_POINT * MESO_UNIT * 10n) / exchange)) / 10;
}

/** 현금 거래 시세를 게임 내 교환 단위로: 1만 포인트(10,500원)로 살 수 있는 메소. 300원 → 3,500만 */
export function cashMesoPer10k(cash) {
  if (!cash) return null;
  return (WON_PER_10K_POINT * MESO_UNIT) / cash;
}

/**
 * 상품 포인트 가격의 메소 가치.
 * exchangeMeso: 그 포인트를 게임 안에서 교환하면 받는 메소
 * cashMeso: 그 포인트 값(원)으로 유저에게서 살 수 있는 메소
 * diff = cash − exchange, rate = diff ÷ exchange(%), 시세가 비어 있으면 그 값은 null.
 */
export function pointValue(points, { exchange = null, cash = null } = {}) {
  const exchangeMeso = exchange ? (points * exchange) / POINT_UNIT : null;
  // 원 = points × 10500 / 10000, 메소 = 원 × 100만 / cash
  const cashMeso = cash ? (points * WON_PER_10K_POINT * MESO_UNIT) / (POINT_UNIT * cash) : null;
  const diff = exchangeMeso != null && cashMeso != null ? cashMeso - exchangeMeso : null;
  const rate = diff != null && exchangeMeso > 0n ? Number((diff * 10000n) / exchangeMeso) / 100 : null;
  return { won: pointsToWon(points), exchangeMeso, cashMeso, diff, rate };
}

/** 원하는 메소에 드는 현금(원, 올림). 현금 거래로 바로 사기 / 포인트를 사서 교환하기. */
export function cashForMeso(meso, { exchange = null, cash = null } = {}) {
  const viaCash = cash ? ceilDiv(meso * cash, MESO_UNIT) : null;
  const points = exchange ? ceilDiv(meso * POINT_UNIT, exchange) : null;
  const viaPoint = points != null ? ceilDiv(points * WON_PER_10K_POINT, POINT_UNIT) : null;
  return { viaCash, viaPoint, points };
}

/** 가진 현금(원)으로 얻는 메소(내림). 현금 거래로 사기 / 포인트를 사서 교환하기. */
export function mesoForCash(won, { exchange = null, cash = null } = {}) {
  const viaCash = cash ? (won * MESO_UNIT) / cash : null;
  const points = exchange ? (won * POINT_UNIT) / WON_PER_10K_POINT : null;
  const viaPoint = points != null ? (points * exchange) / POINT_UNIT : null;
  return { viaCash, viaPoint, points };
}

/** 메소를 읽기 쉽게: 1,750만 · 1억 2,500만 · 3,000 */
export function mesoShort(value) {
  if (value == null) return "-";
  const negative = value < 0n;
  let rest = negative ? -value : value;
  const eok = rest / 100000000n;
  rest %= 100000000n;
  const man = rest / 10000n;
  const one = rest % 10000n;
  const parts = [];
  if (eok) parts.push(`${eok.toLocaleString("ko-KR")}억`);
  if (man) parts.push(`${man.toLocaleString("ko-KR")}만`);
  // 1만 이상이면 만 아래 자리는 버리고 짧게 보인다(정확한 값은 화면 보조 줄에)
  if (one && !eok && !man) parts.push(one.toLocaleString("ko-KR"));
  const text = parts.join(" ") || "0";
  return negative ? `−${text}` : text;
}
