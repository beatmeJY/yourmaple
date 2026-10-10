import assert from "node:assert/strict";
import { applyExpCoupons } from "./hunt-calc.js";

const rate = 120n;
const left = 120n;

const none = applyExpCoupons(left, rate, { double: 0, triple: 0 });
assert.equal(none.minutes, 60n);
assert.equal(none.saved, 0n);
assert.equal(none.capped, false);

const doubleOne = applyExpCoupons(left, rate, { double: 1, triple: 0 });
assert.equal(doubleOne.minutes, 45n);
assert.equal(doubleOne.saved, 15n);
assert.equal(doubleOne.cover, "");

const tripleOne = applyExpCoupons(left, rate, { double: 0, triple: 1 });
assert.equal(tripleOne.minutes, 30n);
assert.equal(tripleOne.saved, 30n);
assert.equal(tripleOne.cover, "");

const both = applyExpCoupons(300n, rate, { double: 1, triple: 1 });
assert.equal(both.minutes, 105n);
assert.equal(both.saved, 45n);
assert.equal(both.capped, false);

const doubleCover = applyExpCoupons(left, rate, { double: 10, triple: 0 });
assert.equal(doubleCover.minutes, 30n);
assert.equal(doubleCover.saved, 30n);
assert.equal(doubleCover.cover, "double");

const tripleCover = applyExpCoupons(left, rate, { double: 4, triple: 10 });
assert.equal(tripleCover.minutes, 20n);
assert.equal(tripleCover.saved, 40n);
assert.equal(tripleCover.cover, "triple");

const mixed = applyExpCoupons(left, rate, { double: 1, triple: 1 });
assert.equal(mixed.cover, "mixed");
assert.equal(mixed.minutes, 23n);
assert.equal(mixed.saved, 37n);

assert.equal(applyExpCoupons(0n, rate, { double: 2, triple: 2 }).minutes, 0n);

import { perHour, shortCount } from "./hunt-calc.js";

assert.equal(shortCount(9800n), "9,800");
assert.equal(shortCount(34000n), "3.4만");
assert.equal(shortCount(30000n), "3만");
assert.equal(shortCount(5200000n), "520만");
assert.equal(shortCount(120000000n), "1억 2,000만");
assert.equal(shortCount(100000000n), "1억");
assert.equal(shortCount(199999999n), "2억");
assert.equal(shortCount(-450000n), "-45만");
assert.equal(shortCount(1500000000000n), "1조 5,000억");
// 20분에 130만 → 1시간 390만, 7분 30초에 100 → 800
assert.equal(perHour(1300000n, 1200), 3900000n);
assert.equal(perHour(100n, 450), 800n);
assert.equal(perHour(0n, 60), 0n);
