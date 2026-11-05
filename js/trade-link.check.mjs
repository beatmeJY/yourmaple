import assert from "node:assert/strict";
import { exactLinks, linkedTrade, unlinkedNames } from "./trade-link.js";

const claw = { id: "i1", name: "청갑충", category: "장비", base_options: { attack: 34 }, requirements: { level: 70 } };
const elixir = { id: "i2", name: "엘릭서", category: "소비", base_options: {}, requirements: {} };
const twinA = { id: "i3", name: "같은 이름", category: "장비" };
const twinB = { id: "i4", name: "같은 이름", category: "장비" };
const rows = [
  { id: "t1", name: "청갑충 ", item_id: null, item_options: {} },
  { id: "t2", name: "청갑", item_id: null, item_options: {} },
  { id: "t3", name: "엘릭서", item_id: null, item_options: { attack: 1 } },
  { id: "t4", name: "같은 이름", item_id: null },
  { id: "t5", name: "청갑충", item_id: "i1", item_options: {} },
];

assert.deepEqual(unlinkedNames(rows), ["청갑충", "청갑", "엘릭서", "같은 이름"]);
// 완전히 같은 이름(앞뒤 공백만 무시)만, 같은 이름 도감 아이템이 둘이면 잇지 않는다. 이미 연결된 거래는 건드리지 않는다.
const links = exactLinks(rows, [claw, elixir, twinA, twinB, claw]);
assert.deepEqual(links.map(({ row, item }) => [row.id, item.id]), [["t1", "i1"], ["t3", "i2"]]);

// 장비: 옵션 유지, 스냅샷 붙음, 이름은 도감 이름
const linked = linkedTrade({ ...rows[0], buy_price: 10, buy_qty: 2, created_at: "x", item_options: { attack: 35 } }, claw);
assert.equal(linked.name, "청갑충");
assert.equal(linked.item_id, "i1");
assert.deepEqual(linked.item_options, { attack: 35 });
assert.deepEqual(linked.item_snapshot, { name: "청갑충", category: "장비", base_options: { attack: 34 }, requirements: { level: 70 } });
assert.equal(linked.buy_price, 10);
assert.equal(linked.created_at, "x");
// 장비가 아니면 옵션을 비운다
assert.deepEqual(linkedTrade(rows[2], elixir).item_options, {});
// 별명 그대로 두기 + 새 옵션
const nick = linkedTrade(rows[1], claw, { rename: false, options: { attack: 36, luk: 5 } });
assert.equal(nick.name, "청갑");
assert.deepEqual(nick.item_options, { attack: 36, luk: 5 });
// 이미 같은 아이템이면 처음 스냅샷 유지
const old = { id: "t9", name: "청갑충", item_id: "i1", item_snapshot: { name: "청갑충", base_options: { attack: 30 } }, item_options: {} };
assert.deepEqual(linkedTrade(old, claw, { options: { attack: 33 } }).item_snapshot, old.item_snapshot);
console.log("trade-link: ok");
