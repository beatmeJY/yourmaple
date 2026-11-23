// node js/quest-items-edit.check.mjs
import assert from "node:assert/strict";
import { questEditRows, readQuestCount, questItemsPayload, questRewardMethod, questItemsChanged } from "./quest-items-edit.js";

// 상세 → 줄: 도감 이름 우선, 예전 무작위 자료는 모든 보상을 그중 하나로
let rows = questEditRows(
  [{ i: "4000019", c: 10, n: "달팽이 껍질", item: { name: "달팽이의 껍질", image_url: "x" } }, { m: "100100", c: 5, n: "달팽이" }],
  [{ i: "2040001", c: 1, n: "투구 주문서" }, { i: "2040801", c: 1, n: "장갑 주문서", j: 1 }],
  "random");
assert.equal(rows.length, 4);
assert.equal(rows[0].n, "달팽이의 껍질");
assert.equal(rows[1].m, "100100");
assert.deepEqual(rows.slice(2).map((r) => [r.r, r.j]), [[true, false], [true, true]]);
// r 표시가 있으면 그대로(섞인 보상)
rows = questEditRows([], [{ i: "2000000", c: 30 }, { i: "2040001", c: 1, r: 1 }], "random");
assert.deepEqual(rows.map((r) => r.r), [false, true]);

// 개수
assert.equal(readQuestCount("1,000"), 1000);
assert.throws(() => readQuestCount("0"), /1 이상|1~/);
assert.throws(() => readQuestCount("1.5"), /정수/);
assert.throws(() => readQuestCount(""), /정수/);
assert.throws(() => readQuestCount("1000000001"), /1~1,000,000,000/);

// 보낼 값
const payload = questItemsPayload(questEditRows([{ m: "100100", c: 5, n: "달팽이" }], [{ i: "2000000", c: 30, n: "빨간 포션", v: "gms/62" }, { i: "2040001", c: 1, n: "투구 주문서", r: 1, j: 1 }]));
assert.deepEqual(payload, {
  conditions: [{ m: "100100", c: 5, n: "달팽이" }],
  rewards: [{ i: "2000000", c: 30, n: "빨간 포션", v: "gms/62" }, { i: "2040001", c: 1, n: "투구 주문서", r: 1, j: 1 }],
});
// 같은 칸 중복은 막고, 조건과 보상에 같은 아이템은 허용
assert.throws(() => questItemsPayload([{ kind: "r", i: "1", count: "1" }, { kind: "r", i: "1", count: "2" }]), /두 번/);
assert.doesNotThrow(() => questItemsPayload([{ kind: "c", i: "1", count: "1" }, { kind: "r", i: "1", count: "1" }]));
// 조건의 아이템과 몬스터 번호가 같아도 다른 항목
assert.doesNotThrow(() => questItemsPayload([{ kind: "c", i: "100", count: "1" }, { kind: "c", m: "100", count: "1" }]));

// 보상 방식
assert.equal(questRewardMethod([]), null);
assert.equal(questRewardMethod([{ i: "1" }]), "fixed");
assert.equal(questRewardMethod([{ i: "1", r: 1 }], "select"), "select");
assert.equal(questRewardMethod([{ i: "1", r: 1 }], "random"), "random");

// 바뀜 판단
const base = questEditRows([], [{ i: "1", c: 1, r: 1 }, { i: "2", c: 1, r: 1 }], "random");
const initial = questItemsPayload(base);
assert.equal(questItemsChanged(initial, base, "random", "random"), false);
assert.equal(questItemsChanged(initial, base, "random", "select"), true);
assert.equal(questItemsChanged(initial, [...base.slice(0, 1)], "random", "random"), true);
assert.equal(questItemsChanged(initial, [{ ...base[0], count: "x" }, base[1]], "random", "random"), true);
console.log("quest-items-edit check 통과");
