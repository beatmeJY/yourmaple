import assert from "node:assert/strict";
import { groupTrades, groupTotals, optionChips, tradeGroupKey } from "./trade-groups.js";

const a = { id: "a", name: "청갑충", item_id: "i1", item_options: { attack: 34, luk: 5 }, buy_price: 100, buy_qty: 2, sell_price: null, sell_qty: 0 };
const b = { id: "b", name: "청갑충", item_id: "i1", item_options: { attack: 36, luk: 5, str: 1 }, buy_price: 200, buy_qty: 1, sell_price: 300, sell_qty: 1 };
const c = { id: "c", name: " 엘릭서 ", item_id: null, item_options: {}, buy_price: 10, buy_qty: 5, sell_price: 8, sell_qty: 2 };
const d = { id: "d", name: "엘릭서", item_id: null, item_options: {}, buy_price: 9, buy_qty: 1, sell_price: null, sell_qty: 0 };

assert.equal(tradeGroupKey(a), "id:i1");
assert.equal(tradeGroupKey(c), tradeGroupKey(d));
const groups = groupTrades([a, c, b, d]);
assert.deepEqual(groups.map((g) => g.lots.map((row) => row.id)), [["a", "b"], ["c", "d"]]);

// 거래마다 다른 옵션만 unique, 한쪽에만 있는 옵션은 다른 쪽에 "—"로 보여 준다
const chips = optionChips([a, b]);
assert.deepEqual(chips[0].map((chip) => [chip.key, chip.value, chip.unique]), [["attack", 34, true], ["str", undefined, true], ["luk", 5, false]]);
assert.deepEqual(chips[1].map((chip) => [chip.key, chip.value, chip.unique]), [["attack", 36, true], ["str", 1, true], ["luk", 5, false]]);
assert.ok(optionChips([a])[0].every((chip) => !chip.unique));
assert.deepEqual(optionChips([c, d]), [[], []]);

assert.deepEqual(groupTotals([a, b]), { bought: 3, remaining: 2, realized: 100 });
assert.deepEqual(groupTotals([a]), { bought: 2, remaining: 2, realized: null });
assert.deepEqual(groupTotals([c, d]), { bought: 6, remaining: 4, realized: -4 });
console.log("trade-groups ok");
