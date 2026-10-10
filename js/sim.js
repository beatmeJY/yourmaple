import { ENHANCE_SCROLLS, enhancementDistribution } from "./enhance-calc.js";

// 시뮬레이터 굴림. 확률은 enhance-calc / maker-calc 에 있는 사용자 값을 그대로 쓴다.
// rng 는 [0, 1) 값을 돌려주는 함수(기본 Math.random). 검사에서는 정해진 값을 넣는다.

/** percent(정수 %) 확률로 성공하면 true. roll 이 percent/100 보다 작으면 성공. */
export function rollPercent(percent, rng = Math.random) {
  return rng() * 100 < Number(percent);
}

/** 주문서 1장을 바른다. 결과: { success, gain } */
export function rollScroll(scrollId, rng = Math.random) {
  const scroll = ENHANCE_SCROLLS[scrollId];
  if (!scroll) throw new Error(`알 수 없는 주문서입니다: ${scrollId}`);
  const success = rollPercent(scroll.successPercent, rng);
  return { success, gain: success ? scroll.attackGain : 0 };
}

/** "10% 먼저 n장, 나머지 60%" 계획. 예: (7, 2) → ten, ten, sixty × 5 */
export function scrollPlan(slotCount, tenFirst) {
  const ten = Math.max(0, Math.min(slotCount, Math.floor(tenFirst)));
  return [...Array(ten).fill("ten"), ...Array(slotCount - ten).fill("sixty")];
}

/** 계획대로 끝까지 발랐을 때 최종 공격력별 확률. 목표 이상 확률(분자·분모 BigInt)도 함께. */
export function planOutcome(baseAttack, plan, targetAttack) {
  const rows = enhancementDistribution(plan).map((row) => ({ attack: baseAttack + row.bonus, numerator: row.numerator, denominator: row.denominator }));
  const denominator = rows[0]?.denominator ?? 1n;
  const hit = targetAttack == null ? null : rows.filter((row) => row.attack >= targetAttack).reduce((sum, row) => sum + row.numerator, 0n);
  return { rows, denominator, hit };
}

/**
 * 일반 보석 1개 제련 결과 등급. odds: [{ stage, percent }] (합 100).
 * roll 을 누적 확률 구간에 맞춰 고른다. 예: 하급 75 · 중급 22 · 상급 3 → 0~75 하급, 75~97 중급, 97~100 상급.
 */
export function rollRefine(odds, rng = Math.random) {
  const point = rng() * 100;
  let edge = 0;
  for (const odd of odds) {
    edge += Number(odd.percent);
    if (point < edge) return odd.stage;
  }
  return odds[odds.length - 1].stage;
}
