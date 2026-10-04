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

/** 목표 이상 한 개의 평균 비용. 낮은 공격력부터 계산해 미달 판매가의 순환 참조를 막는다. */
export function fairEnhancementPrices({ weapons, slots, shopPrice, scrollPrices, marketPrices = {} }) {
  const fairPrices = new Map();
  if (shopPrice == null || scrollPrices.ten == null || scrollPrices.sixty == null) return fairPrices;
  const targets = reachableFinalAttacks(weapons.map((weapon) => weapon.attack), slots);

  const marketAttacks = Object.entries(marketPrices)
    .filter(([attack, price]) => price != null && Number.isSafeInteger(Number(attack)))
    .map(([attack]) => Number(attack));
  const firstMarketAttack = marketAttacks.length ? Math.min(...marketAttacks) : null;
  const candidates = [];
  for (const weapon of weapons) {
    for (const strategy of enhancementPlans(slots)) {
      const cost = enhancementCost(strategy.plan, weapon.price, scrollPrices);
      if (cost == null) continue;
      const outcomes = enhancementDistribution(strategy.plan).map((row) => ({
        attack: weapon.attack + row.bonus,
        numerator: row.numerator,
        denominator: row.denominator,
      }));
      candidates.push({ weapon, strategy, cost, outcomes, denominator: outcomes[0].denominator });
    }
  }
  for (const target of targets) {
      for (const { weapon, strategy, cost, outcomes, denominator } of candidates) {
        const successNumerator = outcomes.reduce((sum, row) => row.attack >= target ? sum + row.numerator : sum, 0n);
        if (successNumerator === 0n) continue;
        const failureRecoveryNumerator = outcomes.reduce((sum, row) => {
          if (row.attack >= target) return sum;
          const salePrice = marketPrices[row.attack] ??
            (firstMarketAttack != null && row.attack < firstMarketAttack ? shopPrice : fairPrices.get(row.attack)?.price ?? shopPrice);
          return sum + row.numerator * salePrice;
        }, 0n);
        const remainingCost = cost * denominator - failureRecoveryNumerator;
        const estimate = remainingCost <= 0n ? shopPrice : (remainingCost + successNumerator - 1n) / successNumerator;
        const fair = estimate > shopPrice ? estimate : shopPrice;
        const previous = fairPrices.get(target);
        if (previous == null || fair < previous.price) {
          fairPrices.set(target, {
            price: fair, baseAttack: weapon.attack, tenCount: strategy.tenCount, sixtyCount: strategy.sixtyCount,
            successNumerator, denominator, investment: cost,
            expectedFailureRecovery: divideRounded(failureRecoveryNumerator, denominator),
          });
        }
      }
  }
  return fairPrices;
}

/** 첫 경매장 시세보다 낮은 공격력은 상점가, 그 이상은 입력 시세 또는 기대 가격을 사용한다. */
export function effectiveEnhancementPrices({ fairPrices, marketPrices, shopPrice }) {
  const effective = { ...marketPrices };
  const estimatedPrices = {};
  const marketAttacks = Object.entries(marketPrices)
    .filter(([attack, price]) => price != null && Number.isSafeInteger(Number(attack)))
    .map(([attack]) => Number(attack));
  const firstMarketAttack = marketAttacks.length ? Math.min(...marketAttacks) : null;

  for (const [attack, row] of fairPrices) {
    if (effective[String(attack)] != null) continue;
    if (firstMarketAttack != null && attack < firstMarketAttack) {
      effective[String(attack)] = shopPrice;
      continue;
    }
    effective[String(attack)] = row.price;
    estimatedPrices[String(attack)] = true;
  }

  return { effective, estimatedPrices, firstMarketAttack };
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
