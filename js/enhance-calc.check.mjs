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

const estimatedRoute = enhance.optimizeEnhancement({
  baseAttack: 100, basePrice: 100n, slots: 1, shopPrice: 50n,
  scrollPrices: { ten: 10n, sixty: 20n }, marketPrices: { 105: 650n },
  estimatedPrices: { 105: true },
});
assert.equal(estimatedRoute.outcomes.find((row) => row.attack === 105).saleType, "estimate");

// 고정 순서 7회 128개·8회 256개를 실제로 열거해 장수별 조합으로 묶어도 확률이 보존됨을 검증.
for (const slots of [7, 8]) {
  const grouped = enhance.enhancementPlans(slots).map(({ plan }) => enhance.enhancementDistribution(plan));
  for (let mask = 0; mask < 2 ** slots; mask += 1) {
    const plan = Array.from({ length: slots }, (_, i) => mask & (1 << i) ? "ten" : "sixty");
    const tenCount = plan.filter((id) => id === "ten").length;
    assert.deepEqual(enhance.enhancementDistribution(plan), grouped[tenCount]);
  }
}

// 같은 공55라도 남은 횟수가 다르면 최종 고점과 분포가 다르다.
const stateOutcomes = (remaining) => enhance.enhancementDistribution(Array(remaining).fill("sixty"))
  .map((row) => ({ ...row, attack: 55 + row.bonus }));
assert.equal(stateOutcomes(6).at(-1).attack, 67);
assert.equal(stateOutcomes(3).at(-1).attack, 61);
assert.notDeepEqual(stateOutcomes(6), stateOutcomes(3));
// 공50에서 10% 첫 성공 후 60% 6장의 최고 결과는 공67이며 공58 도달 시 중단하지 않는다.
const highPlan = enhance.enhancementDistribution(["ten", ...Array(6).fill("sixty")]);
const sixtyPlan = enhance.enhancementDistribution(Array(7).fill("sixty"));
assert.equal(highPlan.at(-1).bonus, 17);
assert.equal(sixtyPlan.at(-1).bonus, 14);
assert.equal(highPlan.at(-1).numerator, 10n * 60n ** 6n);
assert.equal(sixtyPlan.at(-1).numerator, 60n ** 7n);
// 매 단계 주문서를 고르는 최대 도달 확률
assert.equal(enhance.maxReachNumerator(0, 3), 1_000_000n);
assert.equal(enhance.maxReachNumerator(5, 1), 10n);
assert.equal(enhance.maxReachNumerator(2, 1), 60n);
assert.equal(enhance.maxReachNumerator(4, 2), 4_000n); // 60% 먼저, 실패하면 10%: 60×60 + 40×10
assert.equal(enhance.maxReachNumerator(11, 2), 0n);

// 독립 검산 1: 4회 이하에서 이력별 주문서 선택을 모두 열거한 정책의 최대값과 같다.
function bruteForceReach(need, slots) {
  const nodes = 2 ** slots - 1; // 성공/실패 이력마다 주문서를 하나씩 정한다.
  let best = 0n;
  for (let mask = 0; mask < 2 ** nodes; mask += 1) {
    const walk = (index, step, gained) => {
      if (step === slots) return gained >= need ? 1n : 0n;
      const scroll = mask & (1 << index) ? enhance.ENHANCE_SCROLLS.ten : enhance.ENHANCE_SCROLLS.sixty;
      return scroll.successPercent * walk(index * 2 + 1, step + 1, gained + scroll.attackGain)
        + (100n - scroll.successPercent) * walk(index * 2 + 2, step + 1, gained);
    };
    const value = walk(0, 0, 0);
    if (value > best) best = value;
  }
  return best;
}
for (let slots = 1; slots <= 4; slots += 1) {
  for (let need = 0; need <= 5 * slots; need += 1) {
    assert.equal(enhance.maxReachNumerator(need, slots), bruteForceReach(need, slots), `${slots}회 +${need}`);
  }
}
// 독립 검산 2: 7·8회에서 어떤 고정 조합의 이항분포 확률보다 낮지 않다.
for (const slots of [7, 8]) {
  for (let need = 0; need <= 5 * slots; need += 1) {
    let fixedBest = 0n;
    for (let ten = 0; ten <= slots; ten += 1) {
      const value = atLeastProbability(0, ten, slots - ten, need);
      if (value > fixedBest) fixedBest = value;
    }
    assert.ok(enhance.maxReachNumerator(need, slots) >= fixedBest, `${slots}회 +${need}`);
  }
}

// 판매가 규칙: 공50 노작, 7회, 목표 공58, 기본 포기선 1,000회
const saleArgs = {
  baseAttacks: [50], slots: 7, shopPrice: 100_000n, targetAttack: 58,
  marketPrices: { 55: 2_000_000n, 58: 50_000_000n, 62: 80_000_000n },
};
const sale = enhance.enhancementSalePrices(saleArgs);
const saleRow = (attack) => sale.rows.find((row) => row.attack === attack);
assert.equal(sale.giveUpAttack, 72); // 7회는 노작 대비 +22부터 1/1,000 미만
assert.equal(saleRow(52).source, "shop"); // 목표 미만 미입력
assert.equal(saleRow(52).price, 100_000n);
assert.equal(saleRow(55).source, "market"); // 목표 미만도 입력하면 대체
assert.equal(saleRow(55).price, 2_000_000n);
assert.equal(saleRow(58).price, 50_000_000n);
assert.equal(saleRow(60).source, "missing"); // 목표 이상 포기선 미만은 입력 필수
assert.ok(sale.missingAttacks.includes(71));
assert.ok(!sale.missingAttacks.includes(57));
assert.ok(!sale.missingAttacks.includes(72));
assert.deepEqual(sale.anchor, { attack: 62, price: 80_000_000n });
const reach62 = enhance.maxReachNumerator(12, 7);
const reach72 = enhance.maxReachNumerator(22, 7);
assert.ok(reach72 * 1000n < 100n ** 7n);
assert.ok(enhance.maxReachNumerator(21, 7) * 1000n >= 100n ** 7n);
const expectedEstimate = (80_000_000n * reach62 + reach72 - 1n) / reach72;
assert.equal(sale.estimate, expectedEstimate);
for (const row of sale.rows.filter((item) => item.attack >= 72)) {
  assert.equal(row.source, "estimate");
  assert.equal(row.price, expectedEstimate); // 포기선 이상은 한 값으로 고정
}
assert.equal(sale.estimatedPrices["80"], true);
assert.equal(enhance.enhancementSalePrices({ ...saleArgs, slots: 8 }).giveUpAttack, 74); // 8회는 +24부터
assert.ok(enhance.enhancementSalePrices({ ...saleArgs, giveUpTrials: 100 }).giveUpAttack < 72);
// 가장 낮은 입력 시세(공58)보다 아래는 목표(공55) 이상이어도 상점가다. 목표 자신도 포함한다.
const lowTarget = enhance.enhancementSalePrices({ ...saleArgs, targetAttack: 55, marketPrices: { 58: 50_000_000n, 62: 80_000_000n } });
assert.equal(lowTarget.firstMarketAttack, 58);
for (const attack of [55, 56, 57]) {
  assert.equal(lowTarget.rows.find((row) => row.attack === attack).source, "shop");
}
assert.equal(lowTarget.rows.find((row) => row.attack === 59).source, "missing");
assert.ok(!lowTarget.missingAttacks.some((attack) => attack < 58));
assert.equal(enhance.enhancementSalePrices({ ...saleArgs, marketPrices: {} }).firstMarketAttack, null);
// 여러 노작 중 가장 쉬운 확률: 공54 노작이 있으면 공62 도달 확률이 공54 기준이다.
const twoBases = enhance.enhancementSalePrices({ ...saleArgs, baseAttacks: [50, 54] });
assert.equal(twoBases.rows.find((row) => row.attack === 62).reachNumerator, enhance.maxReachNumerator(8, 7));
assert.equal(twoBases.giveUpAttack, 76);
// 가장 비싼 시세가 같으면 높은 공격력을 기준으로 한다.
assert.equal(enhance.enhancementSalePrices({ ...saleArgs, marketPrices: { 58: 9n ** 9n, 60: 9n ** 9n } }).anchor.attack, 60);
// 시세가 하나도 없으면 포기 구간도 추정할 수 없다.
const noAnchor = enhance.enhancementSalePrices({ ...saleArgs, marketPrices: {} });
assert.equal(noAnchor.anchor, null);
assert.ok(noAnchor.missingAttacks.includes(72));
// 포기선 위 시세가 낮게 입력돼 추정가가 상점가보다 낮으면 상점가로 올린다.
const lowAnchor = enhance.enhancementSalePrices({ ...saleArgs, marketPrices: { 80: 200_000n } });
assert.equal(lowAnchor.estimate, 100_000n);

// 1회 도전 결과 묶음: 확률 합과 기대 지출·판매액이 DP 결과와 같다.
for (const slots of [1, 2, 7]) {
  const route = enhance.optimizeEnhancement({
    baseAttack: 50, basePrice: 1_000n, slots, shopPrice: 100n,
    scrollPrices: { ten: 70n, sixty: 30n },
    marketPrices: Object.fromEntries(enhance.reachableEnhancementAttacks(50, slots).map((attack) => [attack, BigInt(100 + (attack - 50) ** 3)])),
  });
  const { leaves, denominator, maxSpend } = enhance.attemptLeaves(route, { ten: 70n, sixty: 30n });
  assert.equal(denominator, 100n ** BigInt(slots));
  assert.equal(leaves.reduce((sum, row) => sum + row.numerator, 0n), denominator);
  const spendNumerator = leaves.reduce((sum, row) => sum + row.numerator * row.spend, 0n);
  const saleNumerator = leaves.reduce((sum, row) => sum + row.numerator * row.sale, 0n);
  assert.equal((spendNumerator + denominator / 2n) / denominator, route.expectedSpend);
  assert.equal((saleNumerator + denominator / 2n) / denominator, route.expectedSale);
  assert.ok(leaves.every((row) => row.spend <= maxSpend));
  assert.ok(maxSpend <= 1_000n + 70n * BigInt(slots));
}
const stopRoute = enhance.optimizeEnhancement({
  baseAttack: 100, basePrice: 100n, slots: 1, shopPrice: 50n, scrollPrices: { ten: 500n, sixty: 500n }, marketPrices: { 100: 60n, 102: 100n, 105: 100n },
});
assert.deepEqual(enhance.attemptLeaves(stopRoute, { ten: 500n, sixty: 500n }).leaves, [{ spend: 100n, sale: 50n, numerator: 100n }]);

// 노작 섞기: 최악 지출 합계가 보유 메소 이하에서 기대 이익 합계 최대
const mix = enhance.bestAttemptMix({
  budget: 100n,
  items: [{ id: "a", weight: 60n, value: 30n }, { id: "b", weight: 50n, value: 24n }, { id: "c", weight: 10n, value: -5n }],
});
// a 1번(60)은 30, b 2번(100)은 48 → 효율이 조금 낮아도 b를 두 번 하는 쪽이 이익이 크다.
assert.equal(mix.totalValue, 48n);
assert.equal(mix.totalWeight, 100n);
assert.deepEqual(mix.rows.map((row) => [row.item.id, row.count]), [["b", 2n]]);
assert.equal(mix.exact, true);
assert.equal(enhance.bestAttemptMix({ budget: 100n, items: [{ id: "c", weight: 10n, value: -5n }] }).rows.length, 0); // 손해면 도전 안 함
assert.equal(enhance.bestAttemptMix({ budget: 40n, items: [{ id: "a", weight: 60n, value: 30n }] }).totalValue, 0n); // 1번도 못 함
// 독립 검산: 작은 예제에서 가능한 모든 횟수 조합을 직접 열거한 최대값과 같다.
let seed = 7;
const random = (max) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % max; };
for (let round = 0; round < 300; round += 1) {
  const items = Array.from({ length: 1 + random(4) }, (_, index) => ({ id: index, weight: BigInt(5 + random(40)), value: BigInt(random(60) - 15) }));
  const budget = BigInt(random(150));
  let bruteBest = 0n;
  const walk = (index, remaining, value) => {
    if (index === items.length) { if (value > bruteBest) bruteBest = value; return; }
    for (let count = 0n; count * items[index].weight <= remaining; count += 1n) walk(index + 1, remaining - count * items[index].weight, value + count * items[index].value);
  };
  walk(0, budget, 0n);
  const result = enhance.bestAttemptMix({ items, budget });
  assert.equal(result.totalValue, bruteBest, `섞기 ${round}`);
  assert.ok(result.totalWeight <= budget);
  assert.equal(result.rows.reduce((sum, row) => sum + row.count * row.item.value, 0n), result.totalValue);
}

// 전체 지도: 경로가 같은 상태를 지나면 한 노드로 합친다(노작가는 지도 값에 영향 없음).
const mapArgs = { slots: 2, shopPrice: 50n, scrollPrices: { ten: 10n, sixty: 20n },
  marketPrices: Object.fromEntries([50, 52, 53, 54, 55, 56, 57, 58, 60].map((attack) => [attack, BigInt(attack * 10)])) };
const routeA = enhance.optimizeEnhancement({ ...mapArgs, baseAttack: 50, basePrice: 100n });
const routeB = enhance.optimizeEnhancement({ ...mapArgs, baseAttack: 53, basePrice: 999n });
const policyMap = enhance.enhancementPolicyMap([routeA, routeB]);
assert.deepEqual(policyMap.columns.map((column) => column.remaining), [2, 1, 0]);
const start = policyMap.columns[0].nodes;
assert.deepEqual(start.map((node) => node.attack), [53, 50]); // 높은 공격력이 위
assert.deepEqual(start.find((node) => node.attack === 50).starts, [{ baseAttack: 50, basePrice: 100n, count: 1n }]);
// 도달 확률: 이 예에서는 중간 판매가 없어 열(남은 횟수)마다 확률 합이 출발 수만큼으로 같다.
assert.equal(policyMap.denominator, 2n * 10_000n);
for (const column of policyMap.columns) {
  const total = column.nodes.reduce((sum, node) => sum + node.reachNumerator, 0n);
  assert.equal(total, policyMap.denominator, `남은 ${column.remaining}회 열 확률 합`);
}
// 노드로 들어오는 경로 확률의 합은 그 노드의 도달 확률과 같다.
for (const node of policyMap.columns.slice(1).flatMap((column) => column.nodes)) {
  const incoming = policyMap.edges.filter((edge) => edge.to === node.key).reduce((sum, edge) => sum + edge.reachNumerator, 0n);
  assert.equal(incoming, node.reachNumerator, `${node.key} 유입`);
}
// 도전 횟수 가중: 공50을 3번, 공53을 1번 하면 출발 노드 확률이 3:1이다.
const weighted = enhance.enhancementPolicyMap([routeA, routeB], [3n, 1n]);
assert.equal(weighted.columns[0].nodes.find((node) => node.attack === 50).reachNumerator * 1n, 3n * weighted.columns[0].nodes.find((node) => node.attack === 53).reachNumerator);
const allKeys = policyMap.columns.flatMap((column) => column.nodes.map((node) => node.key));
assert.equal(new Set(allKeys).size, allKeys.length); // 같은 상태는 한 번만
for (const edge of policyMap.edges) {
  assert.ok(allKeys.includes(edge.from) && allKeys.includes(edge.to));
}
const firstNode = start.find((node) => node.attack === 50);
assert.equal(firstNode.value, routeA.root.alternatives.find((row) => row.id === routeA.root.action).expectedValue);
assert.equal(firstNode.alternatives.length, 3); // 판매·10%·60%

// 같은 상태 비교: 공53+10%와 공56+60%는 모두 공58·남은 6회가 된다.
const stateArgs = {
  weapons: [{ attack: 53, price: 40_000_000n }, { attack: 56, price: 60_000_000n }, { attack: 51, price: 30_000_000n }, { attack: 54, price: 45_000_000n }, { attack: 48, price: 20_000_000n }],
  slots: 7, shopPrice: 100_000n, scrollPrices: { ten: 3_000_000n, sixty: 1_300_000n },
};
const states = enhance.sameStateRoutes(stateArgs);
const state58 = states.find((state) => state.attack === 58 && state.remaining === 6);
assert.deepEqual(state58.routes.map((route) => route.baseAttack), [56, 53]); // 싼 순서
assert.equal(state58.routes[0].cost, 102_100_000n); // (6,130만 − 0.4 × 10만) ÷ 0.6
assert.equal(state58.routes[1].cost, 429_100_000n); // (4,300만 − 0.9 × 10만) ÷ 0.1
assert.equal(state58.routes[1].successNumerator, 10n);
assert.equal(state58.routes[1].recoveryNumerator, 9_000_000n); // 분모 100 기준
// 2장: 초벌 성공 시에만 60%를 바른다. (3,000만 + 300만 + 0.1 × 130만 − 0.94 × 10만) ÷ 0.06
const state585 = states.find((state) => state.attack === 58 && state.remaining === 5);
const route51 = state585.routes.find((route) => route.baseAttack === 51);
assert.deepEqual(route51.plan, ["ten", "sixty"]);
assert.equal(route51.cost, 550_600_000n);
assert.equal(route51.successNumerator, 600n);
assert.equal(route51.scrolls[1].reachNumerator, 1_000n); // 두 번째 장은 10% 확률로만 바름
assert.equal(state585.routes.find((route) => route.baseAttack === 48).plan.join(), "ten,ten");
assert.ok(states.every((state) => state.routes.length > 1)); // 비교 대상이 하나뿐인 상태는 제외
assert.equal(enhance.sameStateRoutes({ ...stateArgs, maxSteps: 1 }).every((state) => state.remaining === 6), true);

console.log("강화 확률과 기대값 검증 통과");
