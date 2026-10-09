export const ENHANCE_SCROLLS = {
  ten: { id: "ten", label: "10% 주문서", successPercent: 10n, attackGain: 5 },
  sixty: { id: "sixty", label: "60% 주문서", successPercent: 60n, attackGain: 2 },
};

export const WEAPON_TYPES = {
  normal: { id: "normal", label: "일반 무기", slots: 7 },
  balrog: { id: "balrog", label: "발록의 무기", slots: 8 },
};

function divideRounded(numerator, denominator) {
  return (numerator + denominator / 2n) / denominator;
}

export function enhancementDistribution(plan) {
  let denominator = 1n;
  let chances = new Map([[0, 1n]]);

  for (const scrollId of plan) {
    const scroll = ENHANCE_SCROLLS[scrollId];
    if (!scroll) throw new Error(`알 수 없는 주문서입니다: ${scrollId}`);
    const next = new Map();
    const failPercent = 100n - scroll.successPercent;
    for (const [bonus, numerator] of chances) {
      next.set(bonus, (next.get(bonus) ?? 0n) + numerator * failPercent);
      const successBonus = bonus + scroll.attackGain;
      next.set(successBonus, (next.get(successBonus) ?? 0n) + numerator * scroll.successPercent);
    }
    chances = next;
    denominator *= 100n;
  }

  return [...chances.entries()]
    .sort(([left], [right]) => left - right)
    .map(([bonus, numerator]) => ({ bonus, numerator, denominator }));
}

export function enhancementCost(plan, basePrice, scrollPrices) {
  if (basePrice == null) return null;
  let total = basePrice;
  for (const scrollId of plan) {
    const price = scrollPrices[scrollId];
    if (price == null) return null;
    total += price;
  }
  return total;
}

export function evaluateEnhancement({ baseAttack, basePrice, plan, scrollPrices, marketPrices }) {
  const distribution = enhancementDistribution(plan);
  const investment = enhancementCost(plan, basePrice, scrollPrices);
  let revenueNumerator = 0n;
  let complete = true;
  let attackNumerator = 0n;

  const outcomes = distribution.map((outcome) => {
    const attack = baseAttack + outcome.bonus;
    const marketPrice = marketPrices[String(attack)] ?? null;
    if (marketPrice == null) complete = false;
    else revenueNumerator += marketPrice * outcome.numerator;
    attackNumerator += BigInt(attack) * outcome.numerator;
    return { ...outcome, attack, marketPrice };
  });

  const denominator = outcomes[0]?.denominator ?? 1n;
  const expectedRevenue = complete ? divideRounded(revenueNumerator, denominator) : null;
  const expectedProfit = expectedRevenue != null && investment != null ? expectedRevenue - investment : null;
  return {
    outcomes,
    investment,
    complete,
    expectedRevenue,
    expectedProfit,
    expectedAttackHundredths: divideRounded(attackNumerator * 100n, denominator),
  };
}

export function enhancementPlans(slotCount) {
  return Array.from({ length: slotCount + 1 }, (_, tenCount) => ({
    tenCount,
    sixtyCount: slotCount - tenCount,
    plan: [...Array(tenCount).fill("ten"), ...Array(slotCount - tenCount).fill("sixty")],
  }));
}

export function reachableEnhancementAttacks(baseAttack, slotCount) {
  const attacks = new Set();
  for (const row of enhancementPlans(slotCount)) {
    for (const outcome of enhancementDistribution(row.plan)) attacks.add(baseAttack + outcome.bonus);
  }
  return [...attacks].sort((left, right) => left - right);
}

function roundedDivision(numerator, denominator) {
  if (numerator >= 0n) return (numerator + denominator / 2n) / denominator;
  return -((-numerator + denominator / 2n) / denominator);
}

export function reachableFinalAttacks(baseAttacks, slotCount) {
  const attacks = new Set();
  for (const baseAttack of baseAttacks) {
    for (const attack of reachableEnhancementAttacks(baseAttack, slotCount)) attacks.add(attack);
  }
  return [...attacks].sort((left, right) => left - right);
}

export const DEFAULT_GIVE_UP_TRIALS = 1000;

function ceilDivision(numerator, denominator) {
  return (numerator + denominator - 1n) / denominator;
}

const reachMemo = new Map();

/** 공격력을 need 이상 올릴 최대 확률. 매 단계 10%/60%를 고를 수 있다. 분모는 100^remaining. */
export function maxReachNumerator(need, remaining) {
  if (need <= 0) return 100n ** BigInt(remaining);
  if (remaining === 0) return 0n;
  const key = `${need}:${remaining}`;
  const cached = reachMemo.get(key);
  if (cached != null) return cached;
  let best = 0n;
  for (const scroll of Object.values(ENHANCE_SCROLLS)) {
    const value = scroll.successPercent * maxReachNumerator(need - scroll.attackGain, remaining - 1)
      + (100n - scroll.successPercent) * maxReachNumerator(need, remaining - 1);
    if (value > best) best = value;
  }
  reachMemo.set(key, best);
  return best;
}

/**
 * 완성 공격력별 판매가. 목표 미만이거나 가장 낮은 입력 시세보다 아래면 입력값 또는 상점가,
 * 그 위로 포기선 미만은 입력 필수,
 * 포기선 이상 미입력은 가장 비싼 입력 시세를 도달 확률로 비례한 포기선 추정가 하나로 고정한다.
 */
export function enhancementSalePrices({ baseAttacks, slots, shopPrice, marketPrices = {}, targetAttack, giveUpTrials = DEFAULT_GIVE_UP_TRIALS }) {
  const attacks = reachableFinalAttacks(baseAttacks, slots);
  const denominator = 100n ** BigInt(slots);
  // 여러 노작 중 가장 도달하기 쉬운 확률을 쓴다.
  const reach = new Map(attacks.map((attack) => [attack, baseAttacks.reduce((best, base) => {
    const value = maxReachNumerator(attack - base, slots);
    return value > best ? value : best;
  }, 0n)]));
  const trials = BigInt(giveUpTrials);
  const giveUpAttack = attacks.find((attack) => reach.get(attack) * trials < denominator) ?? null;

  let anchor = null;
  let firstMarketAttack = null;
  for (const attack of attacks) {
    const price = marketPrices[String(attack)] ?? null;
    if (price == null) continue;
    if (firstMarketAttack == null) firstMarketAttack = attack;
    if (anchor == null || price >= anchor.price) anchor = { attack, price };
  }
  let estimate = null;
  if (anchor && giveUpAttack != null) {
    const raw = ceilDivision(anchor.price * reach.get(anchor.attack), reach.get(giveUpAttack));
    estimate = raw > shopPrice ? raw : shopPrice;
  }

  const rows = attacks.map((attack) => {
    const market = marketPrices[String(attack)] ?? null;
    const givenUp = giveUpAttack != null && attack >= giveUpAttack;
    let source = "missing";
    let price = null;
    if (market != null) [source, price] = ["market", market];
    else if (attack < targetAttack || (firstMarketAttack != null && attack < firstMarketAttack)) [source, price] = ["shop", shopPrice];
    else if (givenUp && estimate != null) [source, price] = ["estimate", estimate];
    return { attack, price, source, givenUp, reachNumerator: reach.get(attack) };
  });

  return {
    rows,
    prices: Object.fromEntries(rows.filter((row) => row.price != null).map((row) => [String(row.attack), row.price])),
    estimatedPrices: Object.fromEntries(rows.filter((row) => row.source === "estimate").map((row) => [String(row.attack), true])),
    missingAttacks: rows.filter((row) => row.price == null).map((row) => row.attack),
    giveUpAttack,
    firstMarketAttack,
    anchor,
    estimate,
    denominator,
  };
}

/**
 * 주문서 몇 장 뒤 같은 상태(공격력, 남은 횟수)가 되는 노작별 경로를 비교한다.
 * 10%를 먼저 바르고(초벌) 나머지는 60%다. 중간에 실패하면 그 자리에서 상점 판매하고,
 * 평균 제작 비용 = (노작가 + 평균 주문서 지출 − 실패작 상점 회수액) ÷ 전부 성공할 확률.
 */
export function sameStateRoutes({ weapons, slots, shopPrice, scrollPrices, maxSteps = 2 }) {
  const states = new Map();
  for (const weapon of weapons) {
    for (let steps = 1; steps <= Math.min(maxSteps, slots); steps += 1) {
      for (let tenCount = steps; tenCount >= 0; tenCount -= 1) {
        const plan = [...Array(tenCount).fill("ten"), ...Array(steps - tenCount).fill("sixty")];
        const denominator = 100n ** BigInt(steps);
        // 각 장은 앞 장이 모두 성공했을 때만 바른다. 지출 분자는 분모 100^steps 기준이다.
        let reachNumerator = 1n;
        let scrollSpendNumerator = 0n;
        const scrolls = plan.map((scrollId, index) => {
          const scroll = ENHANCE_SCROLLS[scrollId];
          const reachChance = reachNumerator * 100n ** BigInt(steps - index);
          scrollSpendNumerator += scrollPrices[scrollId] * reachChance;
          const row = { scrollId, price: scrollPrices[scrollId], reachNumerator: reachChance };
          reachNumerator *= scroll.successPercent;
          return row;
        });
        const successNumerator = reachNumerator;
        const failNumerator = denominator - successNumerator;
        const spendNumerator = weapon.price * denominator + scrollSpendNumerator;
        const recoveryNumerator = shopPrice * failNumerator;
        const net = spendNumerator - recoveryNumerator;
        const cost = net <= 0n ? 0n : ceilDivision(net, successNumerator);
        const attack = weapon.attack + plan.reduce((sum, scrollId) => sum + ENHANCE_SCROLLS[scrollId].attackGain, 0);
        const remaining = slots - steps;
        const key = `${attack}:${remaining}`;
        const state = states.get(key) ?? { attack, remaining, steps, routes: [] };
        state.routes.push({ baseAttack: weapon.attack, basePrice: weapon.price, plan, scrolls, denominator,
          successNumerator, failNumerator, scrollSpendNumerator, spendNumerator, recoveryNumerator, cost });
        states.set(key, state);
      }
    }
  }
  return [...states.values()]
    .filter((state) => state.routes.length > 1)
    .map((state) => ({ ...state, routes: state.routes.sort((left, right) => left.cost === right.cost ? 0 : left.cost < right.cost ? -1 : 1) }))
    .sort((left, right) => left.steps - right.steps || left.attack - right.attack);
}

export function optimizeEnhancement({ baseAttack, basePrice, slots, shopPrice, scrollPrices, marketPrices, estimatedPrices = {} }) {
  const powers = Array.from({ length: slots + 1 }, (_, index) => 100n ** BigInt(index));
  const memo = new Map();

  function solve(attack, remaining) {
    const key = `${attack}:${remaining}`;
    const cached = memo.get(key);
    if (cached) return cached;
    const denominator = powers[remaining];

    if (remaining === 0) {
      const marketPrice = marketPrices[String(attack)] ?? null;
      const useMarket = marketPrice != null && marketPrice > shopPrice;
      const salePrice = useMarket ? marketPrice : shopPrice;
      const terminal = {
        attack,
        remaining,
        action: "complete",
        saleType: useMarket ? estimatedPrices[String(attack)] ? "estimate" : "market" : "shop",
        salePrice,
        expectedValueNumerator: salePrice,
        denominator: 1n,
        alternatives: [],
      };
      memo.set(key, terminal);
      return terminal;
    }

    let best = {
      id: "sell",
      expectedValueNumerator: shopPrice * denominator,
      label: "상점 판매",
    };
    const alternatives = [best];
    for (const scrollId of ["ten", "sixty"]) {
      const price = scrollPrices[scrollId];
      if (price == null) continue;
      const scroll = ENHANCE_SCROLLS[scrollId];
      const success = solve(attack + scroll.attackGain, remaining - 1);
      const fail = solve(attack, remaining - 1);
      const numerator = -price * denominator
        + scroll.successPercent * success.expectedValueNumerator
        + (100n - scroll.successPercent) * fail.expectedValueNumerator;
      const candidate = {
        id: scrollId,
        label: scroll.label,
        expectedValueNumerator: numerator,
        success,
        fail,
      };
      alternatives.push(candidate);
      if (candidate.expectedValueNumerator > best.expectedValueNumerator) best = candidate;
    }

    const node = {
      attack,
      remaining,
      action: best.id,
      expectedValueNumerator: best.expectedValueNumerator,
      denominator,
      alternatives: alternatives.map((row) => ({
        id: row.id,
        label: row.label,
        expectedValue: roundedDivision(row.expectedValueNumerator, denominator),
      })),
      success: best.success,
      fail: best.fail,
      saleType: best.id === "sell" ? "shop" : null,
      salePrice: best.id === "sell" ? shopPrice : null,
    };
    memo.set(key, node);
    return node;
  }

  const root = solve(baseAttack, slots);
  const fullDenominator = powers[slots];
  const usageNumerators = { ten: 0n, sixty: 0n };
  const terminalMap = new Map();
  const reachablePolicy = new Map();

  function trace(node, probabilityNumerator) {
    const scaledProbability = probabilityNumerator * powers[node.remaining];
    if (node.remaining > 0) reachablePolicy.set(`${node.attack}:${node.remaining}`, node);
    if (node.action === "sell" || node.action === "complete") {
      const terminalKey = `${node.attack}:${node.remaining}:${node.saleType}`;
      const current = terminalMap.get(terminalKey) ?? {
        attack: node.attack,
        remaining: node.remaining,
        saleType: node.saleType,
        salePrice: node.salePrice,
        probabilityNumerator: 0n,
        denominator: fullDenominator,
      };
      current.probabilityNumerator += scaledProbability;
      terminalMap.set(terminalKey, current);
      return;
    }
    usageNumerators[node.action] += scaledProbability;
    const scroll = ENHANCE_SCROLLS[node.action];
    trace(node.success, probabilityNumerator * scroll.successPercent);
    trace(node.fail, probabilityNumerator * (100n - scroll.successPercent));
  }

  trace(root, 1n);
  const outcomes = [...terminalMap.values()].sort((left, right) => left.attack - right.attack || right.remaining - left.remaining);
  const expectedScrollCost = roundedDivision(
    usageNumerators.ten * (scrollPrices.ten ?? 0n) + usageNumerators.sixty * (scrollPrices.sixty ?? 0n),
    fullDenominator,
  );
  const expectedSale = roundedDivision(
    outcomes.reduce((sum, row) => sum + row.salePrice * row.probabilityNumerator, 0n),
    fullDenominator,
  );
  const expectedSpend = basePrice + expectedScrollCost;
  const expectedProfit = expectedSale - expectedSpend;
  const earlyStopNumerator = outcomes.filter((row) => row.remaining > 0).reduce((sum, row) => sum + row.probabilityNumerator, 0n);

  return {
    baseAttack,
    basePrice,
    slots,
    root,
    outcomes,
    policy: [...reachablePolicy.values()]
      .sort((left, right) => right.remaining - left.remaining || left.attack - right.attack),
    expectedScrollCost,
    expectedSpend,
    expectedSale,
    expectedProfit,
    expectedUsageHundredths: {
      ten: roundedDivision(usageNumerators.ten * 100n, fullDenominator),
      sixty: roundedDivision(usageNumerators.sixty * 100n, fullDenominator),
    },
    earlyStopNumerator,
    completeNumerator: fullDenominator - earlyStopNumerator,
    denominator: fullDenominator,
  };
}

/** 최적 경로의 1회 도전 결과를 실제 지출(노작가 + 사용한 주문서)과 판매액별로 묶는다. */
export function attemptLeaves(route, scrollPrices) {
  const leaves = new Map();
  let maxSpend = route.basePrice;

  function walk(node, probabilityNumerator, spend) {
    if (node.action === "sell" || node.action === "complete") {
      const key = `${spend}:${node.salePrice}`;
      const row = leaves.get(key) ?? { spend, sale: node.salePrice, numerator: 0n };
      row.numerator += probabilityNumerator * 100n ** BigInt(node.remaining);
      leaves.set(key, row);
      if (spend > maxSpend) maxSpend = spend;
      return;
    }
    const scroll = ENHANCE_SCROLLS[node.action];
    const next = spend + scrollPrices[node.action];
    walk(node.success, probabilityNumerator * scroll.successPercent, next);
    walk(node.fail, probabilityNumerator * (100n - scroll.successPercent), next);
  }

  walk(route.root, 1n, route.basePrice);
  return { leaves: [...leaves.values()], denominator: route.denominator, maxSpend };
}

/**
 * 보유 메소 안에서 노작별 도전 횟수를 섞어 기대 이익 합계를 최대로 한다.
 * 운이 나빠도 돈이 모자라지 않게, 각 도전의 최악 지출 합계가 보유 메소를 넘지 않도록 한다.
 * 기대 이익이 0 이하인 노작은 도전하지 않는다. 분기 한정 탐색으로 정확한 최적 조합을 찾는다.
 */
export function bestAttemptMix({ items, budget, nodeLimit = 2_000_000 }) {
  const usable = items
    .filter((item) => item.value > 0n && item.weight > 0n && item.weight <= budget)
    // 지출 대비 이익이 큰 순서로 탐색해야 상한 계산이 맞는다.
    .sort((left, right) => {
      const leftRatio = left.value * right.weight;
      const rightRatio = right.value * left.weight;
      return leftRatio === rightRatio ? (left.weight < right.weight ? -1 : 1) : leftRatio > rightRatio ? -1 : 1;
    });
  let best = { value: 0n, weight: 0n, counts: [] };
  let visited = 0;
  let exact = true;
  const counts = Array(usable.length).fill(0n);

  function search(index, remaining, value, weight) {
    visited += 1;
    if (visited > nodeLimit) {
      exact = false;
      return;
    }
    if (value > best.value || (value === best.value && weight < best.weight)) {
      best = { value, weight, counts: counts.map((count, order) => ({ item: usable[order], count })).filter((row) => row.count > 0n) };
    }
    if (index === usable.length) return;
    const item = usable[index];
    // 남은 메소를 모두 이 노작 효율로 쓴다고 가정한 값이 상한이다.
    if (value + (remaining * item.value) / item.weight <= best.value) return;
    for (let count = remaining / item.weight; count >= 0n; count -= 1n) {
      counts[index] = count;
      search(index + 1, remaining - count * item.weight, value + count * item.value, weight + count * item.weight);
      if (!exact) break;
    }
    counts[index] = 0n;
  }

  search(0, budget, 0n, 0n);
  return { rows: best.counts, totalValue: best.value, totalWeight: best.weight, exact };
}

/**
 * 노작별 최적 경로에서 실제로 지나갈 수 있는 상태만 모아 남은 횟수별 열로 나눈다.
 * weights는 노작별 도전 횟수다. 1트당 각 상태·경로를 지날 평균 확률을 도전 횟수로 가중해 함께 구한다.
 */
export function enhancementPolicyMap(routes, weights = routes.map(() => 1n)) {
  const nodes = new Map();
  const edges = [];
  const keyOf = (node) => `${node.attack}:${node.remaining}`;

  function visit(node) {
    const key = keyOf(node);
    if (nodes.has(key)) return;
    nodes.set(key, {
      key,
      attack: node.attack,
      remaining: node.remaining,
      action: node.action,
      value: roundedDivision(node.expectedValueNumerator, node.denominator),
      alternatives: node.alternatives,
      saleType: node.saleType,
      salePrice: node.salePrice,
      starts: [],
      reachNumerator: 0n,
    });
    if (node.action !== "ten" && node.action !== "sixty") return;
    edges.push({ from: key, to: keyOf(node.success), kind: "success", action: node.action, reachNumerator: 0n });
    edges.push({ from: key, to: keyOf(node.fail), kind: "fail", action: node.action, reachNumerator: 0n });
    visit(node.success);
    visit(node.fail);
  }

  // 도달 확률: 출발 상태는 100^slots, 한 장 바를 때마다 성공/실패 확률(%)을 곱하고 100으로 나눈다.
  // 남은 횟수만큼 100이 곱해져 있으므로 나눗셈은 항상 나누어떨어진다.
  function spread(route, weight) {
    const scale = 100n ** BigInt(route.slots);
    const reach = new Map([[keyOf(route.root), scale]]);
    const order = [];
    const seen = new Set();
    const collect = (node) => {
      const key = keyOf(node);
      if (seen.has(key)) return;
      seen.add(key);
      order.push(node);
      if (node.action === "ten" || node.action === "sixty") {
        collect(node.success);
        collect(node.fail);
      }
    };
    collect(route.root);
    order.sort((left, right) => right.remaining - left.remaining);
    for (const node of order) {
      const amount = reach.get(keyOf(node)) ?? 0n;
      nodes.get(keyOf(node)).reachNumerator += amount * weight;
      if (node.action !== "ten" && node.action !== "sixty") continue;
      const percent = ENHANCE_SCROLLS[node.action].successPercent;
      for (const [kind, next, share] of [["success", node.success, percent], ["fail", node.fail, 100n - percent]]) {
        const moved = (amount * share) / 100n;
        reach.set(keyOf(next), (reach.get(keyOf(next)) ?? 0n) + moved);
        edges.find((edge) => edge.from === keyOf(node) && edge.kind === kind).reachNumerator += moved * weight;
      }
    }
  }

  routes.forEach((route) => visit(route.root));
  routes.forEach((route, index) => {
    nodes.get(keyOf(route.root)).starts.push({ baseAttack: route.baseAttack, basePrice: route.basePrice, count: weights[index] });
    spread(route, weights[index]);
  });
  const denominator = routes.reduce((sum, route, index) => sum + weights[index] * 100n ** BigInt(route.slots), 0n);
  const remainings = [...new Set([...nodes.values()].map((node) => node.remaining))].sort((left, right) => right - left);
  return {
    columns: remainings.map((remaining) => ({
      remaining,
      nodes: [...nodes.values()].filter((node) => node.remaining === remaining).sort((left, right) => right.attack - left.attack),
    })),
    attacks: [...new Set([...nodes.values()].map((node) => node.attack))].sort((left, right) => right - left),
    edges,
    denominator,
  };
}
