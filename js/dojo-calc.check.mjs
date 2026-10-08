import assert from "node:assert/strict";
import { BELTS, GOAL_SCORE, DAILY_CAP, beltById, quoteSale, quoteBlackBelt, calendarDays, mesoPerHour } from "./dojo-calc.js";

const thresholds = [["white", 140], ["yellow", 1300], ["blue", 2800], ["red", 6400], ["black", 12000]];
const prices = { white: 100n, yellow: 200n, blue: 300n, red: 400n, black: 500n };
const route = { points: 100, seconds: 60 };
assert.deepEqual(BELTS.map(({ id, score }) => [id, score]), thresholds);
assert.equal(GOAL_SCORE, 12000);
assert.equal(DAILY_CAP, 3500);

// 각 보상 직전/도달 경계와 이미 획득한 허리띠의 중복 수익 제외.
for (const [id, score] of thresholds) {
  assert.equal(beltById(id).score, score);
  assert.equal(quoteSale(prices, score - 1, 0, route).belts.some((belt) => belt.id === id), false);
  assert.equal(quoteSale(prices, score, 0, route).belts.at(-1).id, id);
  const lastPoint = quoteSale(prices, score, score - 1, route);
  assert.equal(lastPoint.need, 1);
  assert.deepEqual(lastPoint.belts.map((belt) => belt.id), [id]);
  assert.equal(lastPoint.total, prices[id]);
  assert.equal(quoteSale(prices, score, score, route).belts.length, 0);
}

const black = quoteBlackBelt(prices, route, 60);
assert.equal(black.seconds, 7200);
assert.equal(black.days, 4);
assert.equal(black.total, 1500n);
assert.equal(black.hour, 750n);
assert.equal(mesoPerHour(500n, 12000, route), 250n);
assert.equal(calendarDays(12000), 4);
const remaining = quoteSale(prices, 12000, 6400, route);
assert.equal(remaining.need, 5600);
assert.equal(remaining.seconds, 3360);
assert.equal(remaining.days, 2);
assert.deepEqual(remaining.belts.map((belt) => belt.id), ["black"]);
// 옛 목표 지정·과거 고득점 기록에도 새 목표를 넘겨 점수를 더 모으도록 계산하지 않는다.
assert.equal(quoteSale(prices, 17000, 0, route).need, 12000);
assert.equal(quoteSale(prices, 12000, 17000, route).need, 0);
assert.equal(quoteSale(prices, 12000, 17000, route).seconds, 0);
assert.equal(quoteBlackBelt({ white: 100n }, route, 60).hour, null);
assert.equal(quoteBlackBelt(prices, route, null).seconds, null);
console.log("무릉 허리띠 점수·획득 경계·시간·수익 검증 통과");
