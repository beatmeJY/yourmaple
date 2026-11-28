import assert from "node:assert/strict";
import { cashForMeso, cashMesoPer10k, exchangeWonPer1m, mesoForCash, mesoShort, pointValue, pointsToWon } from "./meso-point-calc.js";

// 기준: 1만 포인트 = 1,400 월드코인 × 7.5원 = 10,500원
assert.equal(pointsToWon(10000n), 10500);
assert.equal(pointsToWon(5000n), 5250);
assert.equal(pointsToWon(1n), 1.05);

// 사용자 예시: 5,000포인트 = 5,250원, 교환 1만 포인트당 3,000만 → 1,500만, 현금 거래 100만당 300원 → 1,750만
const rates = { exchange: 30000000n, cash: 300n };
const value = pointValue(5000n, rates);
assert.equal(value.won, 5250);
assert.equal(value.exchangeMeso, 15000000n);
assert.equal(value.cashMeso, 17500000n); // 5,250 × 100만 ÷ 300
assert.equal(value.diff, 2500000n);
assert.equal(value.rate, 16.66); // 250만 ÷ 1,500만 = 16.666…% → 둘째 자리 버림

// 시세 하나만 있으면 그쪽만
assert.deepEqual(pointValue(5000n, { exchange: 30000000n }), { won: 5250, exchangeMeso: 15000000n, cashMeso: null, diff: null, rate: null });
assert.equal(pointValue(5000n, { cash: 300n }).cashMeso, 17500000n);

// 서로 다른 단위로 바꿔 보기: 교환 3,000만 = 100만당 350원, 현금 300원 = 1만 포인트(10,500원)당 3,500만
assert.equal(exchangeWonPer1m(30000000n), 350);
assert.equal(exchangeWonPer1m(32000000n), 328.1); // 10,500 × 100만 ÷ 3,200만 = 328.125
assert.equal(cashMesoPer10k(300n), 35000000n);
assert.equal(exchangeWonPer1m(null), null);

// 1억 메소에 드는 현금: 현금 거래 1억 × 300 ÷ 100만 = 30,000원
// 포인트로: 1억 × 1만 ÷ 3,000만 = 33,333.3… → 33,334포인트, × 1.05 = 35,000.7 → 35,001원(올림)
assert.deepEqual(cashForMeso(100000000n, rates), { viaCash: 30000n, viaPoint: 35001n, points: 33334n });
// 나누어떨어지지 않는 현금 거래도 올림: 123,457 × 300 ÷ 100만 = 37.04 → 38원
assert.equal(cashForMeso(123457n, rates).viaCash, 38n);

// 10,000원으로 얻는 메소: 현금 거래 1만 × 100만 ÷ 300 = 33,333,333(내림)
// 포인트로: 1만 ÷ 1.05 = 9,523포인트(내림) × 3,000만 ÷ 1만 = 28,569,000
assert.deepEqual(mesoForCash(10000n, rates), { viaCash: 33333333n, viaPoint: 28569000n, points: 9523n });

// 짧은 메소 표시
assert.equal(mesoShort(17500000n), "1,750만");
assert.equal(mesoShort(125000000n), "1억 2,500만");
assert.equal(mesoShort(100000000n), "1억");
assert.equal(mesoShort(3000n), "3,000");
assert.equal(mesoShort(0n), "0");
assert.equal(mesoShort(-2500000n), "−250만");
assert.equal(mesoShort(null), "-");

console.log("meso-point-calc ok");
