// 거래 목록 묶기(2026-11-04 사용자 요청): 같은 아이템(도감 연결이면 도감 ID, 아니면 이름)의 거래를 한 묶음으로 보여 주고,
// 묶음 안에서 거래마다 다른 옵션(구분 옵션)을 골라 강조한다. 옵션이 같은 거래는 저장할 때 이미 수량으로 합쳐진다.
import { itemOptionFields } from "./item-options.js";
import { tradeName } from "./trade-merge.js";

export function tradeGroupKey(row) {
  return row.item_id ? `id:${row.item_id}` : `name:${tradeName(row.name)}`;
}

/** rows 순서를 유지하며 묶는다(첫 거래가 나온 자리에 묶음). */
export function groupTrades(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = tradeGroupKey(row);
    if (!groups.has(key)) groups.set(key, { key, name: tradeName(row.name), itemId: row.item_id ?? null, lots: [] });
    groups.get(key).lots.push(row);
  }
  return [...groups.values()];
}

const valueText = (value) => (value === undefined ? "—" : String(value));

/**
 * 묶음 안 거래마다 옵션 칩 목록. unique: 이 묶음에서 거래마다 값이 다른 옵션(이 거래를 구분하는 정보).
 * 거래가 하나면 모두 unique=false. 적지 않은 옵션은 undefined로 보고 "—"와 비교한다.
 */
export function optionChips(lots) {
  const keys = itemOptionFields.filter(({ key }) => lots.some((row) => Object.hasOwn(row.item_options ?? {}, key)));
  const differing = new Set(keys.filter(({ key }) => new Set(lots.map((row) => valueText(row.item_options?.[key]))).size > 1).map(({ key }) => key));
  return lots.map((row) => keys
    .filter(({ key }) => Object.hasOwn(row.item_options ?? {}, key) || differing.has(key))
    .map(({ key, label }) => ({ key, label, value: row.item_options?.[key], unique: differing.has(key) })));
}

export function groupTotals(lots) {
  let bought = 0;
  let remaining = 0;
  let realized = 0;
  let hasSale = false;
  for (const row of lots) {
    bought += row.buy_qty;
    remaining += row.buy_qty - row.sell_qty;
    if (row.sell_price != null && row.sell_qty > 0) {
      hasSale = true;
      realized += (row.sell_price - row.buy_price) * row.sell_qty;
    }
  }
  return { bought, remaining, realized: hasSale ? realized : null };
}
