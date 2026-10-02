export const GEMS = [
  { id: "diamond", name: "다이아몬드", category: "gem" },
  { id: "garnet", name: "가넷", category: "gem" },
  { id: "amethyst", name: "자수정", category: "gem" },
  { id: "aquamarine", name: "아쿠아마린", category: "gem" },
  { id: "opal", name: "오팔", category: "gem" },
  { id: "sapphire", name: "사파이어", category: "gem" },
  { id: "topaz", name: "토파즈", category: "gem" },
  { id: "emerald", name: "에메랄드", category: "gem" },
];

export const CRYSTALS = [
  { id: "str_crystal", name: "힘의 크리스탈", category: "crystal" },
  { id: "dex_crystal", name: "민첩성의 크리스탈", category: "crystal" },
  { id: "luk_crystal", name: "행운의 크리스탈", category: "crystal" },
  { id: "int_crystal", name: "지혜의 크리스탈", category: "crystal" },
];

export const MAKER_ITEMS = [...GEMS, ...CRYSTALS];

export function makerItemById(id) {
  return MAKER_ITEMS.find((item) => item.id === id) ?? null;
}

/** 원석 -> 보석/크리스탈(일반) -> 하급 -> 중급 -> 상급 순서. 아이템마다 이 5단계 이미지가 있습니다 */
export const STAGES = [
  { id: "ore", label: "원석" },
  { id: "normal", label: "일반" },
  { id: "low", label: "하급" },
  { id: "mid", label: "중급" },
  { id: "high", label: "상급" },
];

export function makerImage(itemId, stageId) {
  return `img/maker/${itemId}-${stageId}.png`;
}

/** 원석 10개를 모아 조합하면 일반 보석/크리스탈 1개가 됩니다 */
export const ORE_PER_NORMAL = 10n;

/** 일반 1개 -> 하급 1개 제련 시도 비용 (확률적으로 하급/중급/상급 중 1개) */
export const NORMAL_REFINE_FEE = 110_000n;

/** 하급 10개 -> 중급 1개 제련 시도 비용 (실패 시 하급 1개 소모) */
export const LOW_TO_MID_FEE = 330_000n;

/** 중급 10개 -> 상급 1개 제련 시도 비용 (실패 시 중급 1개 소모) */
export const MID_TO_HIGH_FEE = 550_000n;

export const STACK_COUNT = 10n;

/** 원석 10개를 일반 보석/크리스탈 1개로 만드는 조합 비용 */
export const NORMAL_CRAFT_FEES = {
  diamond: 950n,
  garnet: 450n,
  amethyst: 450n,
  aquamarine: 450n,
  opal: 450n,
  sapphire: 450n,
  topaz: 450n,
  emerald: 450n,
  black_crystal: 2_900n,
  str_crystal: 4_500n,
  dex_crystal: 4_500n,
  luk_crystal: 4_500n,
  int_crystal: 4_500n,
};

export function normalCraftFee(itemId, category) {
  return NORMAL_CRAFT_FEES[itemId] ?? (category === "crystal" ? 4_500n : 450n);
}

/** 일반 1개 제련 시 나오는 등급 확률(%). 최신 버전 기준 대략값. 보석은 상급이 바로 뜰 확률이 더 높습니다 */
const NORMAL_REFINE_ODDS = {
  gem: [
    { stage: "low", label: "하급", percent: 75 },
    { stage: "mid", label: "중급", percent: 22 },
    { stage: "high", label: "상급", percent: 3 },
  ],
  crystal: [
    { stage: "low", label: "하급", percent: 75 },
    { stage: "mid", label: "중급", percent: 24 },
    { stage: "high", label: "상급", percent: 1 },
  ],
};

export function normalRefineOdds(category) {
  return NORMAL_REFINE_ODDS[category] ?? NORMAL_REFINE_ODDS.gem;
}

export function normalRefinePercent(category, stage) {
  return normalRefineOdds(category).find((odd) => odd.stage === stage)?.percent ?? 0;
}

/** 하급 10개 -> 중급 성공 확률(%). 실패하면 하급 1개만 사라집니다 */
export const LOW_TO_MID_SUCCESS = 50;

/** 중급 10개 -> 상급 성공 확률(%). 실패하면 중급 1개만 사라집니다 */
export const MID_TO_HIGH_SUCCESS = 25;

export const FAIR_PRICE_SAMPLE = 100n;

/** BigInt 나눗셈을 가장 가까운 정수로 반올림합니다. */
function divideRound(numerator, denominator) {
  if (numerator >= 0n) return (numerator + denominator / 2n) / denominator;
  return -((-numerator + denominator / 2n) / denominator);
}

/**
 * 하급→중급의 평균 관계식입니다.
 * 성공률 50%이므로 중급 1개에 평균 하급 11개와 제련비 66만 메소가 듭니다.
 */
export function fairMidFromLow(lowPrice) {
  if (lowPrice == null) return null;
  return 11n * lowPrice + 660_000n;
}

/** 하급을 사서 중급 1개를 만드는 데 필요한 평균 재료 수와 제련비입니다. */
export function lowPerMid() {
  return {
    count: 11,
    fee: 660_000,
  };
}

/**
 * 하급을 사서 중급으로 가공하는 게 이득인 하급 1개 가격의 상한선입니다.
 * M = 11L + 66만을 L에 관해 풀며, 손해가 나지 않도록 소수점 이하는 버립니다.
 */
export function lowBreakEven(otherMidCost) {
  if (otherMidCost == null) return null;
  const numerator = otherMidCost - 660_000n;
  return numerator > 0n ? numerator / 11n : 0n;
}

/** 중급→상급은 평균 중급 13개와 제련비 220만 메소가 듭니다. */
export function fairHighFromMid(midPrice) {
  if (midPrice == null) return null;
  return 13n * midPrice + 2_200_000n;
}

export function tierPrices(category, orePrice, itemId) {
  if (orePrice == null) return { normal: null, low: null, mid: null, high: null, lowMeaningless: false };
  const oreCost = orePrice * ORE_PER_NORMAL;
  const craftFee = normalCraftFee(itemId, category);
  const normal = oreCost + craftFee;
  const refineAttempt = normal + NORMAL_REFINE_FEE;
  const lowCount = BigInt(normalRefinePercent(category, "low"));
  const midCount = BigInt(normalRefinePercent(category, "mid"));
  const highCount = BigInt(normalRefinePercent(category, "high"));

  // 100C = lowCount·L + midCount·M + highCount·H
  // M = 11L + 66만, H = 13M + 220만을 대입해 L을 구합니다.
  const lowNumerator = FAIR_PRICE_SAMPLE * refineAttempt - 660_000n * midCount - 10_780_000n * highCount;
  const lowDenominator = lowCount + 11n * midCount + 143n * highCount;
  const rawLow = divideRound(lowNumerator, lowDenominator);
  const lowMeaningless = rawLow <= 0n;

  // 하급의 계산 가치가 없으면 L=0으로 억지 배분하지 않고 하급을 제외한 뒤
  // 일반 제련비를 중급과 상급에만 배분합니다.
  const low = lowMeaningless ? null : rawLow;
  const mid = lowMeaningless
    ? divideRound(FAIR_PRICE_SAMPLE * refineAttempt - highCount * 2_200_000n, midCount + 13n * highCount)
    : fairMidFromLow(low);
  const high = fairHighFromMid(mid);
  return {
    normal,
    oreCost,
    craftFee,
    refineAttempt,
    sampleCost: FAIR_PRICE_SAMPLE * refineAttempt,
    low,
    rawLow,
    mid,
    high,
    lowMeaningless,
    output: { low: lowCount, mid: midCount, high: highCount },
  };
}

/** 상급 1개를 중급으로 만들 때 평균으로 드는 중급 개수와 제련비 (실패 시 중급 1개 소모) */
export function midPerHigh() {
  const p = MID_TO_HIGH_SUCCESS;
  return {
    count: Number(STACK_COUNT) + (100 - p) / p,
    fee: (Number(MID_TO_HIGH_FEE) * 100) / p,
  };
}

/** 중급을 사서 상급 1개를 만드는 평균 비용 */
export function highViaMid(midPrice) {
  if (midPrice == null) return null;
  return fairHighFromMid(midPrice);
}

/**
 * 중급을 사서 가공하는 게 이득인 중급 가격 기준선.
 * 다른 방법(원석부터 제련, 상급 바로 구매) 중 가장 싼 비용과 같아지는 중급 가격입니다.
 */
export function midBreakEven(otherHighCost) {
  if (otherHighCost == null) return null;
  const { count, fee } = midPerHigh();
  const value = (Number(otherHighCost) - fee) / count;
  return value > 0 ? BigInt(Math.round(value)) : 0n;
}

/**
 * 상급을 얻는 세 가지 방법의 비용. 값이 없는 방법은 null입니다.
 * ore: 원석부터 제련, mid: 중급을 사서 가공, buy: 상급 바로 구매
 */
export function highRoutes(oreCost, midPrice, highPrice) {
  const routes = [
    { id: "ore", label: "원석부터 제련", cost: oreCost ?? null },
    { id: "mid", label: "중급 사서 가공", cost: highViaMid(midPrice) },
    { id: "buy", label: "상급 바로 구매", cost: highPrice ?? null },
  ];
  const known = routes.filter((route) => route.cost != null);
  const best = known.length ? known.reduce((a, b) => (b.cost < a.cost ? b : a)) : null;
  return { routes, best };
}

/**
 * 기록한 실거래가끼리 비교한 제작 손익입니다.
 * normal은 일반 제련 1회의 기대 손익, mid/high는 완성품 1개를 얻을 때의 평균 손익입니다.
 */
export function marketCraftProfits(category, market, itemId) {
  const ore = market?.ore ?? null;
  const low = market?.low ?? null;
  const mid = market?.mid ?? null;
  const high = market?.high ?? null;
  const odds = Object.fromEntries(normalRefineOdds(category).map((row) => [row.stage, BigInt(row.percent)]));

  const normal = ore != null && low != null && mid != null && high != null
    ? (() => {
        const oreCost = ore * ORE_PER_NORMAL;
        const craftFee = normalCraftFee(itemId, category);
        const cost = oreCost + craftFee + NORMAL_REFINE_FEE;
        const breakdown = [
          { stage: "low", percent: odds.low, price: low, weighted: divideRound(odds.low * low, 100n) },
          { stage: "mid", percent: odds.mid, price: mid, weighted: divideRound(odds.mid * mid, 100n) },
          { stage: "high", percent: odds.high, price: high, weighted: divideRound(odds.high * high, 100n) },
        ];
        const revenue = breakdown.reduce((sum, row) => sum + row.weighted, 0n);
        return { cost, revenue, profit: revenue - cost, oreCost, craftFee, refineFee: NORMAL_REFINE_FEE, breakdown };
      })()
    : null;
  const middle = low != null && mid != null
    ? (() => {
        const cost = fairMidFromLow(low);
        return { cost, revenue: mid, profit: mid - cost };
      })()
    : null;
  const upper = mid != null && high != null
    ? (() => {
        const cost = fairHighFromMid(mid);
        return { cost, revenue: high, profit: high - cost };
      })()
    : null;

  return { normal, mid: middle, high: upper };
}

export const ENCHANT_BASE_FEE = 2_750_000n;
export const ENCHANT_TIER_FEES = {
  low: 750_000n,
  mid: 1_500_000n,
  high: 2_250_000n,
};

/** 장비 옵션 부여에 선택한 보석·크리스탈의 시세와 등급별 비용을 합산합니다. */
export function enchantCraftCost(selections) {
  const rows = (selections ?? [])
    .filter((selection) => selection?.itemId)
    .slice(0, 3)
    .map((selection) => {
      const tierFee = ENCHANT_TIER_FEES[selection.tier] ?? null;
      const marketPrice = selection.marketPrice ?? null;
      return {
        ...selection,
        tierFee,
        marketPrice,
        cost: tierFee != null && marketPrice != null ? tierFee + marketPrice : null,
      };
    });
  const complete = rows.length > 0 && rows.every((row) => row.cost != null);
  const materialCost = rows.reduce((sum, row) => sum + (row.marketPrice ?? 0n), 0n);
  const optionFee = rows.reduce((sum, row) => sum + (row.tierFee ?? 0n), 0n);
  const totalCost = complete ? ENCHANT_BASE_FEE + materialCost + optionFee : null;
  return { rows, complete, materialCost, optionFee, baseFee: ENCHANT_BASE_FEE, totalCost };
}

export const REVERSE_RECIPE = [
  { id: "orihalcon", label: "오리할콘", count: 5n },
  { id: "monster_b", label: "하급 몬스터 결정 B", count: 20n },
  { id: "monster_a", label: "하급 몬스터 결정 A", count: 14n },
  { id: "time_piece", label: "시간조각", count: 45n },
  { id: "high_1", label: "상급 보석·크리스탈 1", count: 1n },
  { id: "high_2", label: "상급 보석·크리스탈 2", count: 1n },
  { id: "high_3", label: "상급 보석·크리스탈 3", count: 1n },
];

export const REVERSE_BASE_FEE = 693_000n;
export const REVERSE_HIGH_EXTRA_FEE = 567_000n;
export const REVERSE_CATALYST_FEE = 315_000n;
export const REVERSE_SUCCESS_PERCENT = 90n;
export const REVERSE_CATALYST_ODDS = [
  { label: "정옵", bonus: 0, percent: 54.09, basisPoints: 5_409n },
  { label: "+1", bonus: 1, percent: 15.84, basisPoints: 1_584n },
  { label: "+2", bonus: 2, percent: 10.89, basisPoints: 1_089n },
  { label: "+3", bonus: 3, percent: 5.76, basisPoints: 576n },
  { label: "+4", bonus: 4, percent: 2.43, basisPoints: 243n },
  { label: "+5", bonus: 5, percent: 0.99, basisPoints: 99n },
  { label: "파괴", bonus: null, percent: 10, basisPoints: 1_000n },
];

/** 리버스 장비 1회 제작비와 파괴를 반복했을 때 완성품 1개당 평균 투입비 */
export function reverseCraftCost(prices, useCatalyst = true) {
  const rows = REVERSE_RECIPE.map((material) => {
    const unitPrice = prices?.[material.id] ?? null;
    return {
      ...material,
      unitPrice,
      cost: unitPrice == null ? null : unitPrice * material.count,
    };
  });
  const complete = rows.every((row) => row.cost != null);
  const materialCost = rows.reduce((sum, row) => sum + (row.cost ?? 0n), 0n);
  const highExtraFee = REVERSE_HIGH_EXTRA_FEE * 3n;
  const catalystFee = useCatalyst ? REVERSE_CATALYST_FEE : 0n;
  const fixedCost = REVERSE_BASE_FEE + highExtraFee + catalystFee;
  const attemptCost = complete ? materialCost + fixedCost : null;
  const averageCompletedCost = attemptCost != null && useCatalyst
    ? divideRound(attemptCost * 100n, REVERSE_SUCCESS_PERCENT)
    : attemptCost;
  const destructionLoss = attemptCost != null && useCatalyst ? divideRound(attemptCost * 10n, 100n) : null;
  return { rows, complete, materialCost, highExtraFee, catalystFee, fixedCost, attemptCost, averageCompletedCost, destructionLoss };
}

/** 공격력별 실거래가에 촉진제 결과 확률을 적용한 제작 1회의 기대 판매가 */
export function reverseExpectedValue(baseAttack, outcomePrices, attemptCost = null) {
  // 여섯 완성 옵션이 제작비를 동일하게 회수하도록 배분한다.
  const saleableOptionCount = BigInt(REVERSE_CATALYST_ODDS.filter((odd) => odd.bonus != null).length);
  const rows = REVERSE_CATALYST_ODDS.map((odd) => {
    if (odd.bonus == null) {
      return { ...odd, attack: null, price: 0n, weighted: 0n, expectedIn101: 10.1, fairPrice: null };
    }
    const price = outcomePrices?.[odd.bonus] ?? null;
    return {
      ...odd,
      attack: baseAttack == null ? null : baseAttack + BigInt(odd.bonus),
      price,
      weighted: price == null ? null : divideRound(price * odd.basisPoints, 10_000n),
      expectedIn101: 101 * Number(odd.basisPoints) / 10_000,
      fairPrice: attemptCost == null ? null : divideRound(attemptCost * 10_000n, saleableOptionCount * odd.basisPoints),
    };
  });
  const complete = baseAttack != null && rows.filter((row) => row.bonus != null).every((row) => row.price != null);
  const expectedSale = complete ? rows.reduce((sum, row) => sum + (row.weighted ?? 0n), 0n) : null;
  const expectedProfit = expectedSale != null && attemptCost != null ? expectedSale - attemptCost : null;
  const targets = complete && attemptCost != null
    ? rows
        .filter((row) => row.bonus != null)
        .map((target) => {
          const grossCost = divideRound(attemptCost * 10_000n, target.basisPoints);
          const leftovers = rows
            .filter((row) => row.bonus !== target.bonus)
            .map((row) => ({
              ...row,
              averageCount: Number(row.basisPoints) / Number(target.basisPoints),
              expectedRevenue: row.price == null ? 0n : divideRound(row.price * row.basisPoints, target.basisPoints),
            }));
          const residualRevenue = leftovers.reduce((sum, row) => sum + row.expectedRevenue, 0n);
          const netCost = grossCost - residualRevenue;
          return {
            ...target,
            averageAttempts: 10_000 / Number(target.basisPoints),
            grossCost,
            leftovers,
            residualRevenue,
            netCost,
            marketProfit: target.price - netCost,
          };
        })
    : [];
  return { rows, complete, expectedSale, expectedProfit, targets };
}
