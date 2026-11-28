// 물약 효율 계산. 화면(js/pages/potions.js)과 분리해 검사한다(js/potion-calc.check.mjs).
// 효율 = 가격 ÷ 회복량 = 1 회복당 메소(작을수록 좋다). 가격이 작은 정수라 Number로 계산한다.

/** 한 개 회복량. % 물약은 최대치를 알아야 하고(없으면 null), 최대치의 %와 고정량 중 작은 쪽. */
export function recoverOf(potion, kind, max = {}) {
  const flat = potion[kind];
  if (flat) return flat;
  const pct = potion[`${kind}Pct`];
  if (!pct) return 0;
  const limit = Number(max[kind]);
  if (!Number.isFinite(limit) || limit <= 0) return null;
  return Math.min(Math.floor((limit * pct) / 100), potion[`${kind}Cap`]);
}

/** 살 곳: 묘묘를 켜면 묘묘가 더 쌀 때만 묘묘. same = 묘묘도 같은 값에 판다. */
export function shopOf(potion, useMyo) {
  const myoCheaper = useMyo && potion.myo != null && potion.myo < potion.price;
  return {
    price: myoCheaper ? potion.myo : potion.price,
    myo: myoCheaper,
    same: useMyo && potion.myo != null && potion.myo === potion.price,
  };
}

/**
 * 순위표. tab: "hp" | "mp" | "both"(둘 다 회복하는 것만, HP+MP 합으로).
 * 반환: { rows: [{ potion, rank, recover, hp, mp, price, myo, same, perUnit, ratio }], hidden: % 물약이라 빠진 개수 }
 * perUnit = 1 회복당 메소, ratio = 1위 대비(1위 = 1, 막대 길이).
 */
export function rankPotions(potions, { tab = "hp", useMyo = false, max = {} } = {}) {
  let hidden = 0;
  const rows = [];
  for (const potion of potions) {
    const hp = recoverOf(potion, "hp", max);
    const mp = recoverOf(potion, "mp", max);
    const wants = tab === "both" ? [hp, mp] : [tab === "hp" ? hp : mp];
    if (wants.some((value) => value === 0)) continue;
    if (wants.some((value) => value === null)) {
      hidden += 1;
      continue;
    }
    const recover = wants.reduce((sum, value) => sum + value, 0);
    const shop = shopOf(potion, useMyo);
    rows.push({ potion, hp, mp, recover, ...shop, perUnit: shop.price / recover });
  }
  rows.sort((a, b) => a.perUnit - b.perUnit || b.recover - a.recover || a.potion.name.localeCompare(b.potion.name, "ko"));
  const best = rows[0]?.perUnit ?? 1;
  let rank = 0;
  rows.forEach((row, index) => {
    // 효율이 같으면 같은 순위
    if (index === 0 || row.perUnit !== rows[index - 1].perUnit) rank = index + 1;
    row.rank = rank;
    row.ratio = best / row.perUnit;
  });
  return { rows, hidden };
}

/** 1 회복당 메소 표시: 소수 둘째 자리까지 */
export function perUnitText(value) {
  return value.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
