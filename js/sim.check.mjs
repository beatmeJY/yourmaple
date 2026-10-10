import assert from "node:assert/strict";
import { planOutcome, rollPercent, rollRefine, rollScroll, scrollPlan } from "./sim.js";

const fixed = (value) => () => value;

// 경계: 10%는 0.0999… 까지 성공, 0.1 부터 실패
assert.equal(rollPercent(10, fixed(0.0999)), true);
assert.equal(rollPercent(10, fixed(0.1)), false);
assert.deepEqual(rollScroll("ten", fixed(0.05)), { success: true, gain: 5 });
assert.deepEqual(rollScroll("ten", fixed(0.5)), { success: false, gain: 0 });
assert.deepEqual(rollScroll("sixty", fixed(0.59)), { success: true, gain: 2 });
assert.deepEqual(rollScroll("sixty", fixed(0.6)), { success: false, gain: 0 });
assert.throws(() => rollScroll("nope", fixed(0)));

assert.deepEqual(scrollPlan(7, 2), ["ten", "ten", "sixty", "sixty", "sixty", "sixty", "sixty"]);
assert.deepEqual(scrollPlan(3, 9), ["ten", "ten", "ten"]);
assert.deepEqual(scrollPlan(2, -1), ["sixty", "sixty"]);

// 60% 2장: 공50 → 50(16%), 52(48%), 54(36%). 목표 52 이상 = 84%
const two = planOutcome(50, ["sixty", "sixty"], 52);
assert.deepEqual(two.rows.map((row) => [row.attack, Number(row.numerator)]), [[50, 1600], [52, 4800], [54, 3600]]);
assert.equal(two.denominator, 10000n);
assert.equal(two.hit, 8400n);

const odds = [
  { stage: "low", percent: 75 },
  { stage: "mid", percent: 22 },
  { stage: "high", percent: 3 },
];
assert.equal(rollRefine(odds, fixed(0)), "low");
assert.equal(rollRefine(odds, fixed(0.7499)), "low");
assert.equal(rollRefine(odds, fixed(0.75)), "mid");
assert.equal(rollRefine(odds, fixed(0.9699)), "mid");
assert.equal(rollRefine(odds, fixed(0.97)), "high");
assert.equal(rollRefine(odds, fixed(0.9999)), "high");

// 큰 표본에서 비율이 확률 근처인지(시드 고정 의사난수)
let seed = 12345;
const lcg = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const count = { low: 0, mid: 0, high: 0 };
for (let index = 0; index < 100000; index += 1) count[rollRefine(odds, lcg)] += 1;
assert.ok(Math.abs(count.low / 1000 - 75) < 1, `하급 ${count.low}`);
assert.ok(Math.abs(count.mid / 1000 - 22) < 1, `중급 ${count.mid}`);
assert.ok(Math.abs(count.high / 1000 - 3) < 0.5, `상급 ${count.high}`);

console.log("sim ok");
