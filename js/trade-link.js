// 거래 장부 도감 연결(2026-11-05 사용자 요청).
// 도감 연결 없이 이름만 적은 예전 거래는 이름이 도감 아이템 이름과 완전히 같으면 그 아이템에 바로 연결한다.
// 같은 이름의 도감 아이템이 여럿이면 어느 쪽인지 모르니 자동으로 잇지 않고 사용자가 고르게 둔다.
import { isEquipment } from "./catalog-equipment.js";
import { itemSnapshot } from "./item-options.js";
import { tradeName } from "./trade-merge.js";

/** 도감 연결이 없는 거래의 이름(중복 없이). */
export function unlinkedNames(rows) {
  return [...new Set(rows.filter((row) => !row.item_id).map((row) => tradeName(row.name)).filter(Boolean))];
}

/** 이름이 완전히 같은 도감 아이템이 딱 하나인 거래만 [{ row, item }]로 돌려준다. */
export function exactLinks(rows, items) {
  const byName = new Map();
  for (const item of items) {
    const key = tradeName(item.name);
    if (!byName.has(key)) byName.set(key, new Map());
    byName.get(key).set(item.id, item);
  }
  const links = [];
  for (const row of rows) {
    if (row.item_id) continue;
    const found = byName.get(tradeName(row.name));
    if (found?.size === 1) links.push({ row, item: [...found.values()][0] });
  }
  return links;
}

/**
 * 거래를 도감 아이템에 연결한 값. 가격·수량·등록 시각은 그대로 둔다.
 * rename: 거래 이름을 도감 이름으로 바꿀지(별명으로 적은 거래). options: 장비 실제 옵션(없으면 원래 값).
 * 장비가 아니면 옵션은 비운다. 이미 같은 아이템에 연결돼 있었으면 처음 저장한 스냅샷을 지킨다.
 */
export function linkedTrade(row, item, { rename = true, options } = {}) {
  const same = row.item_id && row.item_id === item.id;
  return {
    ...row,
    name: rename ? tradeName(item.name) : tradeName(row.name),
    item_id: item.id,
    item_snapshot: same && row.item_snapshot && Object.keys(row.item_snapshot).length ? row.item_snapshot : itemSnapshot(item),
    item_options: isEquipment(item) ? { ...(options ?? row.item_options ?? {}) } : {},
  };
}
