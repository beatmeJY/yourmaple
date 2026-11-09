export function asBig(value) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("정수가 아닙니다.");
    return BigInt(value);
  }
  if (value == null || value === "") return 0n;
  const text = String(value).trim();
  if (/^-?\d+$/.test(text)) return BigInt(text);
  if (/^-?\d+\.0+$/.test(text)) return BigInt(text.slice(0, text.indexOf(".")));
  throw new Error("정수가 아닙니다.");
}

export function formatSigned(value) {
  const amount = asBig(value);
  const text = amount.toLocaleString("ko-KR");
  return amount > 0n ? `+${text}` : text;
}

export function formatPerMinute(expPerHour) {
  const hour = asBig(expPerHour);
  const whole = hour / 60n;
  const rem = hour % 60n;
  if (rem === 0n) return whole.toLocaleString("ko-KR");
  let digits = (rem * 10000n + 30n) / 60n;
  let shown = whole;
  if (digits >= 10000n) {
    shown += 1n;
    digits = 0n;
  }
  if (digits === 0n) return shown.toLocaleString("ko-KR");
  const fraction = digits.toString().padStart(4, "0").replace(/0+$/, "");
  return `${shown.toLocaleString("ko-KR")}.${fraction}`;
}

export function formatMinutes(totalMinutes) {
  const minutes = asBig(totalMinutes);
  if (minutes <= 0n) return "1분 미만";
  const days = minutes / 1440n;
  const hours = (minutes % 1440n) / 60n;
  const rest = minutes % 60n;
  const parts = [];
  if (days > 0n) parts.push(`${days.toLocaleString("ko-KR")}일`);
  if (hours > 0n) parts.push(`${hours.toString()}시간`);
  if (rest > 0n) parts.push(`${rest.toString()}분`);
  return parts.join(" ");
}

function roundDiv(numerator, denominator) {
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  let whole = abs / denominator;
  const rem = abs % denominator;
  if (rem * 2n >= denominator) whole += 1n;
  return negative ? -whole : whole;
}

export function mulDivRound(amount, numerator, denominator) {
  const base = asBig(amount);
  const num = asBig(numerator);
  const den = asBig(denominator);
  if (den === 0n) throw new Error("0으로 나눌 수 없습니다.");
  const negative = (base < 0n) !== (num < 0n);
  const product = (base < 0n ? -base : base) * (num < 0n ? -num : num);
  const rounded = roundDiv(product, den < 0n ? -den : den);
  return negative ? -rounded : rounded;
}

function formatLevelList(levels) {
  const ranges = [];
  let start = levels[0];
  let prev = levels[0];
  for (let index = 1; index <= levels.length; index += 1) {
    const level = levels[index];
    if (level === prev + 1) {
      prev = level;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = level;
    prev = level;
  }
  return ranges.join(", ");
}

export function remainingExp(fromLevel, toLevel, currentExp, curve) {
  if (!Number.isInteger(fromLevel) || !Number.isInteger(toLevel)) {
    return { error: "레벨에는 숫자만 입력해 주세요." };
  }
  if (fromLevel === 200) return { error: "200레벨은 만렙입니다." };
  if (fromLevel < 1 || fromLevel > 199) return { error: "현재 레벨은 1부터 199까지입니다." };
  if (toLevel < 2 || toLevel > 200) return { error: "목표 레벨은 2부터 200까지입니다." };
  if (toLevel <= fromLevel) return { error: "목표 레벨은 현재 레벨보다 높아야 합니다." };
  if (!curve.size) return { error: "다음 레벨 경험치가 없습니다." };

  const missing = [];
  let total = 0n;
  for (let level = fromLevel; level < toLevel; level += 1) {
    if (!curve.has(level)) {
      missing.push(level);
      continue;
    }
    total += asBig(curve.get(level));
  }
  if (missing.length) {
    return { error: `${formatLevelList(missing)}레벨의 다음 레벨 경험치가 없습니다.` };
  }

  const current = asBig(currentExp);
  const bar = asBig(curve.get(fromLevel));
  if (current > bar) return { error: "현재 경험치가 이 레벨의 다음 레벨 경험치보다 큽니다." };
  return { total, remaining: total - current };
}

export function buildPlan({ fromLevel, toLevel, currentExp, expPerHour, mesoPerHour, potionPerHour, leechPerHour, curve }) {
  const span = remainingExp(fromLevel, toLevel, currentExp, curve);
  if (span.error) return span;
  const result = {
    total: span.total,
    remaining: span.remaining,
    minutes: null,
    meso: null,
    potion: null,
    leech: null,
    net: null,
  };
  if (expPerHour == null) return result;
  const rate = asBig(expPerHour);
  if (rate <= 0n) return { error: "1시간 경험치는 1 이상이어야 합니다." };
  if (span.remaining === 0n) {
    result.minutes = 0n;
    result.meso = 0n;
    result.potion = 0n;
    result.leech = 0n;
    result.net = 0n;
    return result;
  }
  const meso = asBig(mesoPerHour);
  const potion = asBig(potionPerHour);
  const leech = asBig(leechPerHour);
  result.minutes = mulDivRound(60n, span.remaining, rate);
  result.meso = mulDivRound(meso, span.remaining, rate);
  result.potion = mulDivRound(potion, span.remaining, rate);
  result.leech = mulDivRound(leech, span.remaining, rate);
  result.net = result.meso + result.leech - result.potion;
  return result;
}

export function hourMeso(gross, leech, potion) {
  return asBig(gross) + asBig(leech) - asBig(potion);
}

const couponMinutes = 15n;

function couponBoost(rate, multiplier, cards) {
  return mulDivRound(rate * multiplier * couponMinutes, cards, 60n);
}

function clampMinutes(minutes, normal) {
  if (minutes > normal) return normal;
  if (minutes < 0n) return 0n;
  return minutes;
}

export function applyExpCoupons(remaining, expPerHour, counts) {
  const left = asBig(remaining);
  const rate = asBig(expPerHour);
  const triple = asBig(counts?.triple ?? 0);
  const double = asBig(counts?.double ?? 0);
  const normal = left === 0n || rate <= 0n ? 0n : mulDivRound(60n, left, rate);
  if ((triple <= 0n && double <= 0n) || left === 0n || rate <= 0n) {
    return { minutes: normal, saved: 0n, capped: false, cover: "" };
  }

  const boost3 = triple > 0n ? couponBoost(rate, 3n, triple) : 0n;
  if (triple > 0n && boost3 >= left) {
    const minutes = clampMinutes(mulDivRound(60n, left, rate * 3n), normal);
    return { minutes, saved: normal - minutes, capped: true, cover: "triple" };
  }

  const after3 = left - boost3;
  const boost2 = double > 0n ? couponBoost(rate, 2n, double) : 0n;
  if (double > 0n && boost2 >= after3) {
    const minutes = clampMinutes(triple * couponMinutes + mulDivRound(60n, after3, rate * 2n), normal);
    return { minutes, saved: normal - minutes, capped: true, cover: triple > 0n ? "mixed" : "double" };
  }

  const minutes = clampMinutes(
    (triple > 0n ? triple : 0n) * couponMinutes +
      (double > 0n ? double : 0n) * couponMinutes +
      mulDivRound(60n, after3 - boost2, rate),
    normal,
  );
  return { minutes, saved: normal - minutes, capped: false, cover: "" };
}

// 큰 숫자를 짧게: 1억 2,000만 · 520만 · 3.4만 · 9,800. 조 단위도 같은 방식(시안 short()).
export function shortCount(value) {
  const amount = asBig(value);
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const sign = negative ? "-" : "";
  const jo = 1000000000000n;
  const eok = 100000000n;
  const man = 10000n;
  if (abs >= jo) {
    const rest = (abs % jo) / eok;
    return `${sign}${(abs / jo).toLocaleString("ko-KR")}조${rest ? ` ${rest.toLocaleString("ko-KR")}억` : ""}`;
  }
  if (abs >= eok) {
    const rest = roundDiv(abs % eok, man);
    if (rest >= 10000n) return `${sign}${(abs / eok + 1n).toLocaleString("ko-KR")}억`;
    return `${sign}${(abs / eok).toLocaleString("ko-KR")}억${rest ? ` ${rest.toLocaleString("ko-KR")}만` : ""}`;
  }
  if (abs >= man) {
    // 100만 이상은 정수 만, 그 아래는 소수 한 자리(반올림)
    if (abs >= 1000000n) return `${sign}${roundDiv(abs, man).toLocaleString("ko-KR")}만`;
    const tenth = roundDiv(abs, 1000n);
    const whole = tenth / 10n;
    const rest = tenth % 10n;
    return `${sign}${whole.toString()}${rest ? `.${rest}` : ""}만`;
  }
  return `${sign}${abs.toLocaleString("ko-KR")}`;
}

// 타이머로 잰 획득량을 1시간 기준으로 바꾼다(반올림). seconds 는 1 이상.
export function perHour(amount, seconds) {
  return mulDivRound(amount, 3600n, BigInt(Math.max(1, Math.round(Number(seconds)))));
}

// 타이머 획득량: 시작 값을 적었으면 끝 − 시작, 안 적었으면 직접 적은 획득량을 쓴다.
// 입력은 쉼표가 섞인 문자열. 반환 { mode: "range" | "direct", value, error, field }
function readAmount(text, label) {
  const raw = String(text ?? "").trim().replaceAll(",", "").replaceAll(" ", "");
  if (!raw) return { value: null };
  if (!/^\d+$/.test(raw) || raw.length > 40) return { error: `${label}에는 숫자만 입력해 주세요.` };
  return { value: BigInt(raw) };
}

export function timerGain({ start, end, direct }, label, minimum = 0n) {
  const from = readAmount(start, `시작 ${label}`);
  if (from.error) return { mode: "range", error: from.error, field: "start" };
  if (from.value == null) {
    const gain = readAmount(direct, `획득 ${label}`);
    if (gain.error) return { mode: "direct", error: gain.error, field: "direct" };
    if (gain.value != null && gain.value < minimum) return { mode: "direct", error: `획득 ${label} 값은 ${minimum.toString()} 이상이어야 합니다.`, field: "direct" };
    return { mode: "direct", value: gain.value };
  }
  const to = readAmount(end, `끝 ${label}`);
  if (to.error) return { mode: "range", error: to.error, field: "end" };
  if (to.value == null) return { mode: "range", value: null, field: "end" };
  if (to.value < from.value) return { mode: "range", error: `끝 ${label}가 시작보다 작아요. 레벨이 올랐다면 시작 값을 지우고 획득 ${label}를 직접 적어 주세요.`, field: "end" };
  const value = to.value - from.value;
  if (value < minimum) return { mode: "range", error: `획득 ${label} 값은 ${minimum.toString()} 이상이어야 합니다.`, field: "end" };
  return { mode: "range", value };
}

// ── 사냥 기록 단위 환산(1분·15분·1시간) ─────────────────────────
// 실측 기록(걸린 초 + 얻은 양)은 원래 값으로, 예전 기록(1시간 값만)은 1시간 값을 비례해 바꾼다.
export const HUNT_UNITS = [
  { minutes: 1, label: "1분", short: "분" },
  { minutes: 15, label: "15분", short: "15분" },
  { minutes: 60, label: "1시간", short: "h" },
];

// numerator ÷ denominator 를 소수 넷째 자리까지(반올림) 쉼표 붙여 보여 준다. 음수도 된다.
export function formatRatio(numerator, denominator) {
  const num = asBig(numerator);
  const den = asBig(denominator);
  if (den <= 0n) throw new Error("0 이하로 나눌 수 없습니다.");
  const negative = num < 0n;
  const scaled = mulDivRound(negative ? -num : num, 10000n, den);
  const whole = scaled / 10000n;
  const fraction = (scaled % 10000n).toString().padStart(4, "0").replace(/0+$/, "");
  const text = fraction ? `${whole.toLocaleString("ko-KR")}.${fraction}` : whole.toLocaleString("ko-KR");
  return negative && scaled !== 0n ? `-${text}` : text;
}

// 기록 한 줄의 EXP를 unitMinutes 기준 { numerator, denominator } 로. 실측이 있으면 실측을 쓴다.
export function expRatio(row, unitMinutes) {
  const unit = BigInt(unitMinutes);
  const seconds = Number(row?.measured_seconds);
  if (Number.isInteger(seconds) && seconds > 0 && row?.exp_gain != null && row.exp_gain !== "") {
    return { numerator: asBig(row.exp_gain) * unit * 60n, denominator: BigInt(seconds) };
  }
  return { numerator: asBig(row?.exp_per_hour) * unit, denominator: 60n };
}

// 1시간 금액(메소·쩔비·물약)을 unitMinutes 기준 정수로(반올림).
export function hourToUnit(amountPerHour, unitMinutes) {
  return mulDivRound(asBig(amountPerHour), BigInt(unitMinutes), 60n);
}

// 걸린 시간·얻은 양으로 1시간 값을 만든다(직접 적기의 실측 입력). seconds는 1~86400 정수.
export function measuredHour({ seconds, exp, meso }) {
  return { exp: perHour(asBig(exp), seconds), meso: perHour(asBig(meso ?? 0n), seconds) };
}
