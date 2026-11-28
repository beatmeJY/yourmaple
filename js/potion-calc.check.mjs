import assert from "node:assert/strict";
import { perUnitText, rankPotions, recoverOf, shopOf } from "./potion-calc.js";
import { POTIONS } from "./potion-data.js";

const red = { name: "빨간 포션", hp: 50, price: 47, myo: 47 };
const meat = { name: "짐승의 고기", hp: 100, price: 100, myo: 106 };
const laksa = { name: "락사", hp: 800, price: 850, myo: 808 };
const elixir = { name: "혼스터", hpPct: 60, hpCap: 6000, price: 6700 };
const cake = { name: "케이크", hp: 100, mp: 100, price: 304 };
const blue = { name: "파란 포션", mp: 100, price: 190, myo: 190 };

// % 물약: 최대치를 모르면 null, 알면 최대치의 %와 고정량 중 작은 쪽
assert.equal(recoverOf(elixir, "hp"), null);
assert.equal(recoverOf(elixir, "hp", { hp: 5000 }), 3000);
assert.equal(recoverOf(elixir, "hp", { hp: 10001 }), 6000);
assert.equal(recoverOf(elixir, "hp", { hp: 1234 }), 740); // 1234 × 0.6 = 740.4 → 740
assert.equal(recoverOf(elixir, "mp", { mp: 9000 }), 0);

// 묘묘는 더 쌀 때만 쓴다
assert.deepEqual(shopOf(laksa, true), { price: 808, myo: true, same: false });
assert.deepEqual(shopOf(laksa, false), { price: 850, myo: false, same: false });
assert.deepEqual(shopOf(meat, true), { price: 100, myo: false, same: false });
assert.deepEqual(shopOf(red, true), { price: 47, myo: false, same: true });

// HP 순위: 47/50 = 0.94, 808/800 = 1.01, 850/800 = 1.0625, 100/100 = 1, 304/100 = 3.04
let { rows, hidden } = rankPotions([meat, laksa, red, elixir, cake, blue], { tab: "hp" });
assert.deepEqual(rows.map((row) => row.potion.name), ["빨간 포션", "짐승의 고기", "락사", "케이크"]);
assert.equal(hidden, 1);
assert.equal(rows[0].ratio, 1);
assert.equal(perUnitText(rows[0].perUnit), "0.94");

({ rows } = rankPotions([meat, laksa, red], { tab: "hp", useMyo: true }));
assert.deepEqual(rows.map((row) => [row.potion.name, row.price, row.myo]), [["빨간 포션", 47, false], ["짐승의 고기", 100, false], ["락사", 808, true]]);

// 최대 HP를 적으면 % 물약도 들어간다: 6700 / 6000
({ rows, hidden } = rankPotions([elixir], { tab: "hp", max: { hp: 20000 } }));
assert.equal(hidden, 0);
assert.equal(rows[0].recover, 6000);

// 둘 다 탭: HP·MP를 모두 회복하는 것만, 합으로 나눔 304 / 200 = 1.52
({ rows } = rankPotions([meat, cake, blue], { tab: "both" }));
assert.deepEqual(rows.map((row) => row.potion.name), ["케이크"]);
assert.equal(rows[0].perUnit, 1.52);

// 같은 효율이면 같은 순위
({ rows } = rankPotions([{ name: "가", hp: 100, price: 100 }, { name: "나", hp: 200, price: 200 }, { name: "다", hp: 100, price: 150 }], { tab: "hp" }));
assert.deepEqual(rows.map((row) => row.rank), [1, 1, 3]);

// 실제 자료: 모든 항목이 회복량·가격을 가지고, 이름이 겹치지 않는다
const names = new Set();
for (const potion of POTIONS) {
  assert.ok(!names.has(potion.name), `중복 이름 ${potion.name}`);
  names.add(potion.name);
  assert.ok(Number.isInteger(potion.price) && potion.price > 0, potion.name);
  assert.ok(potion.hp || potion.mp || potion.hpPct || potion.mpPct, potion.name);
  if (potion.hpPct) assert.ok(potion.hpCap > 0, potion.name);
  if (potion.mpPct) assert.ok(potion.mpCap > 0, potion.name);
  assert.ok(potion.npc && potion.map, potion.name);
}
// 실제 자료 HP 1위는 사과(28/30 = 0.93), 다음이 빨간 포션·달걀(0.94) 공동 2위. 말레이시아 MP 음식은 묘묘에서 더 싸다
({ rows } = rankPotions(POTIONS, { tab: "hp", useMyo: true }));
assert.equal(rows[0].potion.name, "사과");
assert.deepEqual(rows.filter((row) => row.rank === 2).map((row) => row.potion.name).sort(), ["달걀", "빨간 포션"]);
({ rows } = rankPotions(POTIONS, { tab: "mp", useMyo: true }));
assert.equal(rows.find((row) => row.potion.name === "두리안").price, 6160);

console.log("potion-calc ok");
