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

// 타이머 획득량: 시작·끝 값 또는 직접 입력
{
  const { timerGain } = await import("./hunt-calc.js");
  assert.deepEqual(timerGain({ start: "1,000", end: "3,500", direct: "9" }, "EXP", 1n), { mode: "range", value: 2500n });
  assert.deepEqual(timerGain({ start: "", end: "3,500", direct: "1,234" }, "EXP", 1n), { mode: "direct", value: 1234n });
  assert.deepEqual(timerGain({ start: "", end: "", direct: "" }, "메소", 0n), { mode: "direct", value: null });
  assert.equal(timerGain({ start: "100", end: "", direct: "5" }, "EXP", 1n).value, null);
  assert.match(timerGain({ start: "500", end: "100", direct: "" }, "EXP", 1n).error, /레벨이 올랐다면/);
  assert.match(timerGain({ start: "500", end: "500", direct: "" }, "EXP", 1n).error, /1 이상/);
  assert.deepEqual(timerGain({ start: "500", end: "500", direct: "" }, "메소", 0n), { mode: "range", value: 0n });
  assert.match(timerGain({ start: "1a", end: "5", direct: "" }, "EXP", 1n).error, /숫자만/);
  // 시작 값이 아주 커도 BigInt로 정확히
  assert.equal(timerGain({ start: "9007199254740993", end: "9007199254740999", direct: "" }, "메소").value, 6n);
}
console.log("hunt-calc timerGain ok");

// 사냥 기록 단위 환산: 파풀 한 판(EXP 고정, 12분 30초)과 1시간 값만 있는 예전 기록
{
  const { formatRatio, expRatio, hourToUnit, measuredHour } = await import("./hunt-calc.js");
  const ratioText = (row, unit) => { const r = expRatio(row, unit); return formatRatio(r.numerator, r.denominator); };
  const run = { measured_seconds: 750, exp_gain: "500000", exp_per_hour: "2400000" };
  // 500,000 ÷ 750초 = 666.6667/초 → 1분 40,000, 15분 600,000, 1시간 2,400,000
  assert.equal(ratioText(run, 1), "40,000");
  assert.equal(ratioText(run, 15), "600,000");
  assert.equal(ratioText(run, 60), "2,400,000");
  // 7분에 100만 → 1분 142,857.1429 (손계산 1,000,000 ÷ 7)
  assert.equal(ratioText({ measured_seconds: 420, exp_gain: "1000000" }, 1), "142,857.1429");
  // 예전 기록: 1시간 400만 → 1분 66,666.6667, 15분 100만
  const old = { exp_per_hour: "4000000" };
  assert.equal(ratioText(old, 1), "66,666.6667");
  assert.equal(ratioText(old, 15), "1,000,000");
  // 실측 칸이 비어 있으면 1시간 값으로
  assert.equal(ratioText({ measured_seconds: null, exp_gain: null, exp_per_hour: "60" }, 1), "1");
  assert.equal(formatRatio(-10n, 3n), "-3.3333");
  assert.equal(formatRatio(0n, 7n), "0");
  assert.equal(hourToUnit(-200000n, 15), -50000n);
  assert.equal(hourToUnit(100n, 1), 2n);
  assert.deepEqual(measuredHour({ seconds: 750, exp: 500000n, meso: 30000n }), { exp: 2400000n, meso: 144000n });
}
console.log("hunt-calc units ok");
