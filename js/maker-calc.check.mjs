import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./maker-calc.js", import.meta.url), "utf8");
const maker = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

function assertClose(actual, expected, tolerance = 200n) {
  const difference = actual > expected ? actual - expected : expected - actual;
  assert.ok(difference <= tolerance, `${actual}와 ${expected}의 차이가 ${tolerance}보다 큽니다.`);
}

for (const category of ["gem", "crystal"]) {
  const itemId = category === "gem" ? "garnet" : "str_crystal";
  const prices = maker.tierPrices(category, 1_000_000n, itemId);
  const odds = Object.fromEntries(maker.normalRefineOdds(category).map((row) => [row.stage, BigInt(row.percent)]));

  assert.equal(prices.lowMeaningless, false);
  assertClose(100n * prices.refineAttempt, odds.low * prices.low + odds.mid * prices.mid + odds.high * prices.high);
  assert.equal(prices.mid, 11n * prices.low + 660_000n);
  assert.equal(prices.high, 13n * prices.mid + 2_200_000n);
}

const cheapGem = maker.tierPrices("gem", 10_000n, "garnet");
assert.equal(cheapGem.low, null);
assert.equal(cheapGem.lowMeaningless, true);
assertClose(100n * cheapGem.refineAttempt, 22n * cheapGem.mid + 3n * cheapGem.high);

const sameOreCrystal = maker.tierPrices("crystal", 20_000n, "str_crystal");
assert.equal(sameOreCrystal.lowMeaningless, false);
assert.ok(sameOreCrystal.low > 0n);

assert.equal(maker.highViaMid(1_000_000n), 15_200_000n);
assert.equal(maker.lowBreakEven(1_000_000n), 30_909n);
assert.equal(maker.fairMidFromLow(maker.lowBreakEven(1_000_000n)), 999_999n);
assert.equal(maker.lowBreakEven(300_000n), 0n);

const gemProfits = maker.marketCraftProfits("gem", {
  ore: 100_000n,
  low: 200_000n,
  mid: 3_000_000n,
  high: 50_000_000n,
}, "garnet");
assert.deepEqual(gemProfits.normal, {
  cost: 1_110_450n,
  revenue: 2_310_000n,
  profit: 1_199_550n,
  oreCost: 1_000_000n,
  craftFee: 450n,
  refineFee: 110_000n,
  breakdown: [
    { stage: "low", percent: 75n, price: 200_000n, weighted: 150_000n },
    { stage: "mid", percent: 22n, price: 3_000_000n, weighted: 660_000n },
    { stage: "high", percent: 3n, price: 50_000_000n, weighted: 1_500_000n },
  ],
});
assert.deepEqual(gemProfits.mid, { cost: 2_860_000n, revenue: 3_000_000n, profit: 140_000n });
assert.deepEqual(gemProfits.high, { cost: 41_200_000n, revenue: 50_000_000n, profit: 8_800_000n });

const crystalProfits = maker.marketCraftProfits("crystal", {
  ore: 100_000n,
  low: 200_000n,
  mid: 3_000_000n,
  high: 50_000_000n,
}, "str_crystal");
assert.deepEqual(crystalProfits.normal, {
  cost: 1_114_500n,
  revenue: 1_370_000n,
  profit: 255_500n,
  oreCost: 1_000_000n,
  craftFee: 4_500n,
  refineFee: 110_000n,
  breakdown: [
    { stage: "low", percent: 75n, price: 200_000n, weighted: 150_000n },
    { stage: "mid", percent: 24n, price: 3_000_000n, weighted: 720_000n },
    { stage: "high", percent: 1n, price: 50_000_000n, weighted: 500_000n },
  ],
});

const missingProfits = maker.marketCraftProfits("crystal", { ore: 100_000n, low: null, mid: 3_000_000n, high: null }, "str_crystal");
assert.equal(missingProfits.normal, null);
assert.equal(missingProfits.mid, null);
assert.equal(missingProfits.high, null);
assert.equal(maker.normalCraftFee("diamond", "gem"), 950n);
assert.equal(maker.normalCraftFee("black_crystal", "gem"), 2_900n);

const enchant = maker.enchantCraftCost([
  { itemId: "garnet", tier: "low", marketPrice: 1_000_000n },
  { itemId: "diamond", tier: "mid", marketPrice: 2_000_000n },
  { itemId: "str_crystal", tier: "high", marketPrice: 3_000_000n },
]);
assert.equal(enchant.complete, true);
assert.equal(enchant.materialCost, 6_000_000n);
assert.equal(enchant.optionFee, 4_500_000n);
assert.equal(enchant.baseFee, 2_750_000n);
assert.equal(enchant.totalCost, 13_250_000n);
assert.equal(maker.enchantCraftCost([{ itemId: "garnet", tier: "low", marketPrice: null }]).complete, false);
assert.equal(maker.enchantCraftCost([]).totalCost, null);

const opalExample = maker.marketCraftProfits("gem", {
  ore: 32_000n,
  low: 7_000n,
  mid: 700_000n,
  high: 10_000_000n,
}, "opal");
assert.equal(opalExample.normal.cost, 430_450n);
assert.equal(opalExample.normal.revenue, 459_250n);
assert.equal(opalExample.normal.profit, 28_800n);

const reversePrices = {
  orihalcon: 100n,
  monster_b: 200n,
  monster_a: 300n,
  time_piece: 400n,
  high_1: 1_000n,
  high_2: 2_000n,
  high_3: 3_000n,
};
const reverseWithCatalyst = maker.reverseCraftCost(reversePrices, true);
assert.equal(reverseWithCatalyst.materialCost, 32_700n);
assert.equal(reverseWithCatalyst.highExtraFee, 1_701_000n);
assert.equal(reverseWithCatalyst.fixedCost, 2_709_000n);
assert.equal(reverseWithCatalyst.attemptCost, 2_741_700n);
assert.equal(reverseWithCatalyst.destructionLoss, 274_170n);
assert.equal(reverseWithCatalyst.averageCompletedCost, 3_046_333n);

const reverseWithoutCatalyst = maker.reverseCraftCost(reversePrices, false);
assert.equal(reverseWithoutCatalyst.fixedCost, 2_394_000n);
assert.equal(reverseWithoutCatalyst.attemptCost, 2_426_700n);
assert.equal(reverseWithoutCatalyst.averageCompletedCost, 2_426_700n);

const reverseValue = maker.reverseExpectedValue(120n, {
  0: 1_000_000n,
  1: 1_000_000n,
  2: 1_000_000n,
  3: 1_000_000n,
  4: 1_000_000n,
  5: 1_000_000n,
}, 800_000n);
assert.equal(reverseValue.complete, true);
assert.equal(reverseValue.expectedSale, 900_000n);
assert.equal(reverseValue.expectedProfit, 100_000n);
assert.deepEqual(reverseValue.rows.map((row) => row.attack), [120n, 121n, 122n, 123n, 124n, 125n, null]);
assert.deepEqual(reverseValue.rows.map((row) => row.weighted), [540_900n, 158_400n, 108_900n, 57_600n, 24_300n, 9_900n, 0n]);
assert.deepEqual(reverseValue.rows.map((row) => row.fairPrice), [246_503n, 841_751n, 1_224_365n, 2_314_815n, 5_486_968n, 13_468_013n, null]);
assert.equal(reverseValue.rows.find((row) => row.bonus === 5).expectedIn101, 0.9999);
assert.equal(reverseValue.targets.length, 6);

const reverseTargetValue = maker.reverseExpectedValue(120n, {
  0: 1_000_000n,
  1: 1_000_000n,
  2: 1_000_000n,
  3: 1_000_000n,
  4: 1_000_000n,
  5: 1_000_000n,
}, 1_000_000n);
const plusFive = reverseTargetValue.targets.find((row) => row.bonus === 5);
assert.equal(plusFive.grossCost, 101_010_101n);
assert.equal(plusFive.residualRevenue, 89_909_091n);
assert.equal(plusFive.netCost, 11_101_010n);
assert.equal(plusFive.marketProfit, -10_101_010n);

// 실거래가 없이 자동 산정하며 파괴 포함 전체 예상 매출이 원가와 같아야 한다.
for (const cost of [0n, 1n, 500_000_000n, 10n ** 24n]) {
  const allocation = maker.reverseExpectedValue(null, {}, cost);
  const saleable = allocation.rows.filter((row) => row.bonus != null);
  const total = saleable.reduce((sum, row) => sum + row.fairPrice * row.basisPoints, 0n);
  assertClose(total, cost * 10_000n, 5_000n);
  for (let i = 1; i < saleable.length; i++) assert.ok(saleable[i].fairPrice >= saleable[i - 1].fairPrice);
  const prices = Object.fromEntries(saleable.map((row) => [row.bonus, row.fairPrice]));
  assertClose(maker.reverseExpectedValue(120n, prices, cost).expectedProfit, 0n, 3n);
}
assert.ok(maker.reverseExpectedValue(null, {}, null).rows.every((row) => row.fairPrice == null));
console.log("메이커 적정가 및 리버스 비용 배분 검증 통과");
