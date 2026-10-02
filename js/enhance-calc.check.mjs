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

console.log("강화 확률과 기대값 검증 통과");
