import { asBig } from "./hunt-calc.js";

// 캐릭터의 현재 경험치로 이번 레벨 진행률과 다음 레벨까지 남은 사냥 시간을 계산한다.
// curve: 레벨 → 다음 레벨 경험치(Map), hunts: 사냥 기록(1시간 경험치 exp_per_hour).
// 대표 사냥터(mainHuntId)가 이 캐릭터의 기록이면 그것을, 아니면 이 캐릭터의 가장 좋은 기록을 쓴다.

export function pickHunt(hunts, characterId, mainHuntId) {
  const own = (hunts ?? []).filter((hunt) => hunt.character_id === characterId && asBig(hunt.exp_per_hour) > 0n);
  if (mainHuntId) {
    const main = own.find((hunt) => hunt.id === mainHuntId);
    if (main) return { hunt: main, main: true };
  }
  let best = null;
  for (const hunt of own) {
    if (!best || asBig(hunt.exp_per_hour) > asBig(best.exp_per_hour)) best = hunt;
  }
  return best ? { hunt: best, main: false } : null;
}

// 0.01% 단위로 내림한 진행률 문자열. 예: 6342n / 10000n → "63.42"
function percentText(exp, need) {
  const basis = (exp * 10000n) / need;
  const whole = basis / 100n;
  const rest = (basis % 100n).toString().padStart(2, "0");
  return `${whole}.${rest}`;
}

export function expProgress({ level, exp, curve, hunts, characterId, mainHuntId }) {
  if (exp == null || exp === "") return { state: "no-exp" };
  if (!curve?.has(level)) return { state: "no-curve" };
  const need = asBig(curve.get(level));
  const current = asBig(exp);
  if (need <= 0n) return { state: "no-curve" };
  if (current > need) return { state: "over", need, current };
  const remaining = need - current;
  const result = {
    state: "ok",
    need,
    current,
    remaining,
    percent: percentText(current, need),
    ratio: Number((current * 10000n) / need) / 10000,
  };
  const picked = pickHunt(hunts, characterId, mainHuntId);
  if (!picked) return result;
  const perHour = asBig(picked.hunt.exp_per_hour);
  // 분 단위로 올림한다. 1분이라도 남으면 1분.
  const minutes = remaining === 0n ? 0n : (remaining * 60n + perHour - 1n) / perHour;
  return { ...result, hunt: picked.hunt, mainHunt: picked.main, minutes };
}
