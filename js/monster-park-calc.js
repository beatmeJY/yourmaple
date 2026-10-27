// 몬스터 파크 이벤트 계산(2026-10-27 사용자 요청). 몬파 경험치만으로 130까지 며칠, 마감 날 몇 레벨인지.
// 규칙(사용자 확인 2026-10-27):
//   하루 2회 입장. 레벨 구역 50~70 / 71~100 / 101~129, 같은 구역은 한 판 경험치가 모두 같다.
//   한 판에 1레벨만 오른다. 넘친 경험치는 다음 레벨 99.99%(필요 경험치 - 1)까지만 남고 나머지는 버려진다.
//   한 판 뒤 레벨이 올라 구역이 바뀌면 그날 남은 입장은 쓰지 못한다.
// 만렙은 캐릭터마다 다르다(시그너스 120, 그 밖 130). maxLevel 을 넘기지 않으면 130.
// 경험치는 BigInt. 구역 경험치를 모르면(null) 그 구역에 들어가는 순간 계산을 멈춘다.

// 12월 1일 00시 전까지라 11월 30일이 마지막 입장일(2026-10-27 사용자 정정).
export const MONSTER_PARK = { end: "2026-11-30", perDay: 2, minLevel: 50, maxLevel: 130 };

// 한 판 경험치: 50~70 418,840 · 71~100 2,898,000 · 101~129 6,289,333(2026-10-28 사용자 확정).
export const ZONES = [
  { id: "low", min: 50, max: 70, exp: 418_840n },
  { id: "mid", min: 71, max: 100, exp: 2_898_000n },
  { id: "high", min: 101, max: 129, exp: 6_289_333n },
];

export function zoneOf(level) {
  return ZONES.find((zone) => level >= zone.min && level <= zone.max) ?? null;
}

export function zoneLabel(zone) {
  return zone ? `${zone.min}~${zone.max}` : "";
}

/** 한 판 경험치를 더한 결과. 1레벨까지만 오르고, 넘친 양은 다음 레벨 (필요-1)까지만 남는다. */
export function gainRun(level, exp, gain, curve, maxLevel = MONSTER_PARK.maxLevel) {
  const need = curve.get(level);
  if (exp + gain < need) return { level, exp: exp + gain, wasted: 0n, leveled: false };
  const next = level + 1;
  const rest = exp + gain - need;
  if (next >= maxLevel) return { level: next, exp: 0n, wasted: 0n, leveled: true };
  const cap = curve.get(next) - 1n;
  const kept = rest > cap ? cap : rest;
  return { level: next, exp: kept, wasted: rest - kept, leveled: true };
}

/** 서울 날짜(YYYY-MM-DD) */
export function seoulDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** 오늘부터 마감일까지 남은 날(오늘 포함). 마감이 지났으면 0. */
export function daysLeft(today, end = MONSTER_PARK.end) {
  const diff = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return Math.max(0, diff + 1);
}

export function addDays(date, days) {
  const at = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);
  return at.toISOString().slice(0, 10);
}

/**
 * 날마다 몬파를 돈다. days 일 동안(오늘 = 0일째, 오늘은 todayLeft 회), 만렙(maxLevel)이 되거나 구역 경험치를 모르면 멈춘다.
 * zoneExp: 구역 id → 한 판 경험치(BigInt) 또는 null.
 * 결과 runs: { day, slot, zone, before, after, gain, wasted, lostAfter(이 판 뒤 그날 못 쓰는 입장 수) }
 * stop: "max"(만렙) | "unknown"(구역 경험치 모름, zone) | "low"(50 미만) | "days"(기간 끝)
 */
export function simulate({ level, exp, curve, zoneExp, todayLeft = MONSTER_PARK.perDay, days, maxLevel = MONSTER_PARK.maxLevel }) {
  let current = { level, exp };
  const runs = [];
  let lost = 0;
  let wasted = 0n;
  for (let day = 0; day < days; day += 1) {
    const tickets = day === 0 ? todayLeft : MONSTER_PARK.perDay;
    for (let slot = 0; slot < tickets; slot += 1) {
      if (current.level >= maxLevel) return finish("max");
      const zone = zoneOf(current.level);
      if (!zone) return finish("low");
      const gain = zoneExp[zone.id];
      if (gain == null) return finish("unknown", zone);
      const after = gainRun(current.level, current.exp, gain, curve, maxLevel);
      const changed = after.level < maxLevel && zoneOf(after.level)?.id !== zone.id;
      const lostAfter = changed ? tickets - slot - 1 : 0;
      runs.push({ day, slot, zone, before: current, after: { level: after.level, exp: after.exp }, gain, wasted: after.wasted, lostAfter });
      wasted += after.wasted;
      lost += lostAfter;
      current = { level: after.level, exp: after.exp };
      if (lostAfter) break;
    }
  }
  return finish(current.level >= maxLevel ? "max" : "days");

  function finish(stop, zone = null) {
    return { runs, final: current, stop, stopZone: zone, lost, wasted };
  }
}

/** 0.01% 단위로 내림한 진행률. 예: 6342/10000 → "63.42" */
export function percentOf(exp, need) {
  if (!need || need <= 0n) return "0.00";
  const basis = (exp * 10000n) / need;
  return `${basis / 100n}.${(basis % 100n).toString().padStart(2, "0")}`;
}

/** "45.5" 같은 % 입력 → 그 레벨 경험치(내림). 99.99% 를 넘으면 필요-1. */
export function expFromPercent(text, need) {
  const value = Number(String(text).replace("%", "").trim());
  if (!Number.isFinite(value) || value <= 0) return 0n;
  const basis = BigInt(Math.floor(Math.min(value, 100) * 100));
  const exp = (need * basis) / 10000n;
  return exp >= need ? need - 1n : exp;
}
