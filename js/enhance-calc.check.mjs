import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./enhance-calc.js", import.meta.url), "utf8");
const enhance = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

const oneTen = enhance.enhancementDistribution(["ten"]);
assert.deepEqual(oneTen, [
  { bonus: 0, numerator: 90n, denominator: 100n },
  { bonus: 5, numerator: 10n, denominator: 100n },
]);

const mixed = enhance.enhancementDistribution(["ten", "sixty"]);
assert.deepEqual(mixed, [
  { bonus: 0, numerator: 3_600n, denominator: 10_000n },
  { bonus: 2, numerator: 5_400n, denominator: 10_000n },
  { bonus: 5, numerator: 400n, denominator: 10_000n },
  { bonus: 7, numerator: 600n, denominator: 10_000n },
]);
assert.equal(mixed.reduce((sum, row) => sum + row.numerator, 0n), 10_000n);

const evaluated = enhance.evaluateEnhancement({
  baseAttack: 100,
  basePrice: 1_000n,
  plan: ["ten"],
  scrollPrices: { ten: 100n, sixty: 200n },
  marketPrices: { 100: 1_000n, 105: 3_000n },
});
assert.equal(evaluated.investment, 1_100n);
assert.equal(evaluated.expectedRevenue, 1_200n);
assert.equal(evaluated.expectedProfit, 100n);
assert.equal(evaluated.expectedAttackHundredths, 10_050n);

assert.equal(enhance.WEAPON_TYPES.normal.slots, 7);
assert.equal(enhance.WEAPON_TYPES.balrog.slots, 8);
assert.equal(enhance.enhancementPlans(7).length, 8);
assert.deepEqual(enhance.reachableEnhancementAttacks(100, 1), [100, 102, 105]);

for (let slots = 1; slots <= 8; slots += 1) {
  for (const strategy of enhance.enhancementPlans(slots)) {
    const distribution = enhance.enhancementDistribution(strategy.plan);
    const denominator = 100n ** BigInt(slots);
    assert.equal(distribution.reduce((sum, row) => sum + row.numerator, 0n), denominator);
    assert.equal(new Set(distribution.map((row) => row.bonus)).size, distribution.length);
  }
}

const profitable = enhance.optimizeEnhancement({
  baseAttack: 100,
  basePrice: 100n,
  slots: 1,
  shopPrice: 50n,
  scrollPrices: { ten: 10n, sixty: null },
  marketPrices: { 105: 1_000n },
});
assert.equal(profitable.root.action, "ten");
assert.equal(profitable.expectedScrollCost, 10n);
assert.equal(profitable.expectedSpend, 110n);
assert.equal(profitable.expectedSale, 145n);
assert.equal(profitable.expectedProfit, 35n);
assert.equal(profitable.expectedUsageHundredths.ten, 100n);
assert.equal(profitable.earlyStopNumerator, 0n);

const stopImmediately = enhance.optimizeEnhancement({
  baseAttack: 100,
  basePrice: 100n,
  slots: 1,
  shopPrice: 50n,
  scrollPrices: { ten: 500n, sixty: 500n },
  marketPrices: { 102: 100n, 105: 100n },
});
assert.equal(stopImmediately.root.action, "sell");
assert.equal(stopImmediately.expectedScrollCost, 0n);
assert.equal(stopImmediately.expectedSale, 50n);
assert.equal(stopImmediately.expectedProfit, -50n);
assert.equal(stopImmediately.earlyStopNumerator, stopImmediately.denominator);

const branching = enhance.optimizeEnhancement({
  baseAttack: 100,
  basePrice: 100n,
  slots: 2,
  shopPrice: 100n,
  scrollPrices: { ten: 49n, sixty: null },
  marketPrices: { 105: 500n, 110: 2_000n },
});
assert.equal(branching.root.action, "ten");
assert.equal(branching.policy.find((node) => node.attack === 100 && node.remaining === 1).action, "sell");
assert.equal(branching.policy.find((node) => node.attack === 105 && node.remaining === 1).action, "ten");
assert.equal(branching.expectedUsageHundredths.ten, 110n);
assert.equal(branching.earlyStopNumerator, 9_000n);

assert.deepEqual(enhance.reachableFinalAttacks([100, 101], 1), [100, 101, 102, 103, 105, 106]);

const fair = enhance.fairEnhancementPrices({
  weapons: [{ attack: 100, price: 100n }],
  slots: 1,
  shopPrice: 50n,
  scrollPrices: { ten: 10n, sixty: 20n },
});
assert.equal(fair.get(105).price, 110n); // (110 − 공100 추정가110 × 0.9) ÷ 0.1
assert.equal(fair.get(102).price, 110n); // 공105도 성공: 10% 조합의 (110 − 110 × 0.9) ÷ 0.1이 최저
assert.equal(fair.get(100).price, 110n); // 모든 결과가 공100 이상이므로 가장 싼 조합의 1회 비용

// 공50에 60% 7장: 4회 이상 성공하면 공58 이상이다. 더 높은 결과도 성공에 포함한다.
const claw = enhance.fairEnhancementPrices({
  weapons: [{ attack: 50, price: 1_000n }], slots: 7, shopPrice: 50n,
  scrollPrices: { ten: 1_000_000n, sixty: 100n },
  marketPrices: { 58: 3_000n }, // 공57 이하는 사용자가 정한 상점행
});
const claw58 = claw.get(58);
assert.equal(claw58.tenCount, 0);
assert.equal(claw58.sixtyCount, 7);
assert.equal(claw58.successNumerator, 71_020_800_000_000n);
assert.equal(claw58.denominator, 100_000_000_000_000n);
assert.equal(claw58.investment, 1_700n);
assert.equal(claw58.price, 2_374n); // (1700 − 50 × 0.289792) ÷ 0.710208을 올림
const exact58Numerator = 29_030_400_000_000n;
const exact58Cost = (1_700n * claw58.denominator - 50n * (claw58.denominator - exact58Numerator) + exact58Numerator - 1n) / exact58Numerator;
assert.ok(claw58.price < exact58Cost); // 정확히 공58만 성공으로 보던 기존 비용보다 낮음
assert.equal(claw.get(60).price, 1_940n); // 공58 실거래가3000 회수로 공60 획득 비용이 감소
const shopOnlyClaw = enhance.fairEnhancementPrices({
  weapons: [{ attack: 50, price: 1_000n }], slots: 7, shopPrice: 50n,
  scrollPrices: { ten: 1_000_000n, sixty: 100n }, marketPrices: { 100: 3_000n },
});
const clawPrices = [...shopOnlyClaw].sort(([a], [b]) => a - b);
for (let i = 1; i < clawPrices.length; i += 1) {
  assert.ok(clawPrices[i][1].price >= clawPrices[i - 1][1].price, "높은 공격력 이상 획득 비용은 감소하지 않음");
}

// 정확히 공103이 나오지 않는 공100 조합도 공105를 만들 수 있으면 후보에 포함한다.
const aboveOnly = enhance.fairEnhancementPrices({
  weapons: [{ attack: 100, price: 100n }, { attack: 101, price: 1_000n }],
  slots: 1, shopPrice: 0n, scrollPrices: { ten: 10n, sixty: 10_000n },
});
assert.equal(aboveOnly.get(103).baseAttack, 100);
assert.equal(aboveOnly.get(103).price, 110n); // 미달 공100 추정가110 회수
assert.equal(aboveOnly.get(103).successNumerator, 10n);

const shiftedBases = enhance.fairEnhancementPrices({
  weapons: [48, 49, 50, 51, 52].map((attack) => ({ attack, price: 1_000n })),
  slots: 7, shopPrice: 50n, scrollPrices: { ten: 1_000_000n, sixty: 100n },
  marketPrices: { 61: 3_000n }, // 공60 이하 미달 결과는 상점행: 기존 확률 회귀 검증 유지
});
assert.equal(shiftedBases.get(58).baseAttack, 52);
assert.equal(shiftedBases.get(58).successNumerator, 90_374_400_000_000n);
assert.equal(shiftedBases.get(59).baseAttack, 51);
assert.equal(shiftedBases.get(60).baseAttack, 52);
assert.equal(shiftedBases.get(59).successNumerator, shiftedBases.get(60).successNumerator); // 출발 노작이 달라도 필요한 성공 횟수가 같을 수 있음

// 주문서별 분포를 누적하는 구현과 독립적으로 이항분포 공식으로 검산한다.
function combination(n, k) {
  let count = 1n;
  for (let i = 1; i <= k; i += 1) count = count * BigInt(n - i + 1) / BigInt(i);
  return count;
}

function atLeastProbability(baseAttack, tenCount, sixtyCount, target) {
  let numerator = 0n;
  for (let i = 0; i <= tenCount; i += 1) {
    for (let j = 0; j <= sixtyCount; j += 1) {
      if (baseAttack + 5 * i + 2 * j < target) continue;
      numerator += combination(tenCount, i) * 10n ** BigInt(i) * 90n ** BigInt(tenCount - i)
        * combination(sixtyCount, j) * 60n ** BigInt(j) * 40n ** BigInt(sixtyCount - j);
    }
  }
  return numerator;
}

const verificationWeapons = [{ attack: 48, price: 600n }, { attack: 50, price: 1_000n }, { attack: 52, price: 2_000n }];
for (const slots of [7, 8]) {
  const shopPrice = 50n;
  const scrollPrices = { ten: 120n, sixty: 80n };
  const marketPrices = { 58: 1_500n, 62: 3_000n };
  const prices = enhance.fairEnhancementPrices({ weapons: verificationWeapons, slots, shopPrice, scrollPrices, marketPrices });
  const independentlyCalculated = new Map();
  const denominator = 100n ** BigInt(slots);
  for (const [target, row] of prices) {
    let minimum = null;
    for (const weapon of verificationWeapons) {
      for (let ten = 0; ten <= slots; ten += 1) {
        const sixty = slots - ten;
        const probability = atLeastProbability(weapon.attack, ten, sixty, target);
        if (probability === 0n) continue;
        const cost = weapon.price + BigInt(ten) * scrollPrices.ten + BigInt(sixty) * scrollPrices.sixty;
        let recovery = 0n;
        for (let i = 0; i <= ten; i += 1) {
          for (let j = 0; j <= sixty; j += 1) {
            const attack = weapon.attack + 5 * i + 2 * j;
            if (attack >= target) continue;
            const chance = combination(ten, i) * 10n ** BigInt(i) * 90n ** BigInt(ten - i)
              * combination(sixty, j) * 60n ** BigInt(j) * 40n ** BigInt(sixty - j);
            const sale = marketPrices[attack] ?? (attack < 58 ? shopPrice : independentlyCalculated.get(attack));
            recovery += chance * sale;
          }
        }
        const netCost = cost * denominator - recovery;
        const estimate = netCost <= 0n ? shopPrice : (netCost + probability - 1n) / probability;
        const price = estimate > shopPrice ? estimate : shopPrice;
        if (minimum == null || price < minimum) minimum = price;
      }
    }
    assert.equal(row.price, minimum, `${slots}회 공${target} 이상 최저 비용`);
    independentlyCalculated.set(target, minimum);
    assert.equal(row.successNumerator, atLeastProbability(row.baseAttack, row.tenCount, row.sixtyCount, target));
  }
}

const overridden = enhance.effectiveEnhancementPrices({
  fairPrices: new Map([[100, { price: 80n }], [105, { price: 180n }], [110, { price: 150n }], [115, { price: 300n }]]),
  marketPrices: { 105: 200n, 110: 250n },
  shopPrice: 50n,
});
assert.equal(overridden.effective[100], 50n); // 첫 시장가보다 낮으면 상점 판매
assert.equal(overridden.effective[105], 200n);
assert.equal(overridden.effective[110], 250n);
assert.equal(overridden.effective[115], 300n); // 높은 미입력 공격력은 기대 가격 사용
assert.deepEqual(overridden.estimatedPrices, { 115: true });
assert.equal(overridden.firstMarketAttack, 105);

const from58 = enhance.effectiveEnhancementPrices({
  fairPrices: new Map([[46, { price: 24_540_000n }], [57, { price: 30_000_000n }], [58, { price: 35_000_000n }], [59, { price: 40_000_000n }]]),
  marketPrices: { 58: 50_000_000n },
  shopPrice: 100_000n,
});
assert.equal(from58.effective[46], 100_000n);
assert.equal(from58.effective[57], 100_000n);
assert.equal(from58.effective[58], 50_000_000n);
assert.equal(from58.effective[59], 40_000_000n);
assert.deepEqual(from58.estimatedPrices, { 59: true });

const noMarket = enhance.effectiveEnhancementPrices({ fairPrices: fair, marketPrices: {}, shopPrice: 50n });
assert.equal(noMarket.effective[100], 110n); // 시장가가 없으면 평균 획득 비용
assert.equal(noMarket.firstMarketAttack, null);

const mixedPrices = enhance.effectiveEnhancementPrices({
  fairPrices: enhance.fairEnhancementPrices({
    weapons: [{ attack: 100, price: 100n }], slots: 1, shopPrice: 50n,
    scrollPrices: { ten: 10n, sixty: 20n }, marketPrices: { 102: 60n },
  }), marketPrices: { 102: 60n }, shopPrice: 50n,
});
const mixedRoute = enhance.optimizeEnhancement({
  baseAttack: 100, basePrice: 100n, slots: 1, shopPrice: 50n,
  scrollPrices: { ten: 10n, sixty: 20n },
  marketPrices: mixedPrices.effective,
  estimatedPrices: mixedPrices.estimatedPrices,
});
assert.equal(mixedRoute.outcomes.find((row) => row.attack === 100).saleType, "shop");
assert.equal(mixedRoute.outcomes.find((row) => row.attack === 105).saleType, "estimate");

const observedOtherOutcome = enhance.fairEnhancementPrices({
  weapons: [{ attack: 100, price: 100n }],
  slots: 1,
  shopPrice: 50n,
  scrollPrices: { ten: 10n, sixty: 20n },
  marketPrices: { 100: 80n },
});
assert.equal(observedOtherOutcome.get(102).price, 147n); // (120 − 실거래가80 × 0.4) ÷ 0.6 올림
assert.equal(observedOtherOutcome.get(105).price, 380n); // (110 − 실거래가80 × 0.9) ÷ 0.1
assert.equal(observedOtherOutcome.get(100).price, fair.get(100).price); // 목표 자체 시세는 획득 비용에 영향 없음
const highRecovery = enhance.fairEnhancementPrices({
  weapons: [{ attack: 100, price: 100n }], slots: 1, shopPrice: 50n,
  scrollPrices: { ten: 10n, sixty: 20n }, marketPrices: { 100: 1_000n },
});
assert.equal(highRecovery.get(105).price, 50n); // 회수액이 제작비보다 커도 상점가 하한 유지
const estimatedRoute = enhance.optimizeEnhancement({
  baseAttack: 100, basePrice: 100n, slots: 1, shopPrice: 50n,
  scrollPrices: { ten: 10n, sixty: 20n }, marketPrices: { 105: 650n },
  estimatedPrices: { 105: true },
});
assert.equal(estimatedRoute.outcomes.find((row) => row.attack === 105).saleType, "estimate");
assert.equal(enhance.fairEnhancementPrices({
  weapons: [{ attack: 100, price: 100n }], slots: 1, shopPrice: 50n,
  scrollPrices: { ten: null, sixty: 20n },
}).size, 0);

console.log("강화 확률과 기대값 검증 통과");
