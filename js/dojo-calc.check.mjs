import assert from "node:assert/strict";
import { BANDS, FLOOR_BOSSES, bandBosses, BELTS, GOAL_SCORE, DAILY_CAP, beltById, quoteSale, quoteBlackBelt, calendarDays, mesoPerHour } from "./dojo-calc.js";

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

// 층별 보스: 쉬는 층(6·12·18·24·30층)은 빠지고, 27라운드 = 32층 크림슨 발록에서 끝난다.
assert.deepEqual(bandBosses(1, 5).map((boss) => boss.name), ["마노", "스텀피", "데우", "킹슬라임", "대왕지네"]);
assert.deepEqual(bandBosses(6, 10).map((boss) => [boss.floor, boss.name]), [[7, "파우스트"], [8, "킹크랑"], [9, "머쉬맘"], [10, "알리샤르"], [11, "타이머"]]);
assert.deepEqual(bandBosses(26, 27).map((boss) => [boss.floor, boss.name]), [[31, "블루 머쉬맘"], [32, "크림슨 발록"]]);
assert.equal(BANDS.reduce((sum, band) => sum + bandBosses(band.start, band.end).length, 0), 27);
assert.equal(Object.keys(FLOOR_BOSSES).length, 27);
assert.equal(bandBosses(16, 20).find((boss) => boss.floor === 21).note, "스킬잠금 · 실명 · 키반대");
console.log("무릉 층별 보스 검증 통과");

// 쉼터 시간(2026-10-29 사용자 규칙): 저장 10초, 저장 없이 지나가면 2초, 구간 초에는 안 들어감
{
  const { compareSaves } = await import("./dojo-calc.js");
  const times = new Map([[1, 60], [6, 80], [11, 110], [16, 150], [21, 200], [26, 120]]);
  const route = (saves) => compareSaves(times, false).rows.find((row) => row.saves.join() === saves.join()).best;
  // 저장 안 함: 720초 + 쉼터 5곳 지나감 2초×5
  assert.equal(route([]).seconds, 720 + 10);
  // 12층(10라운드 뒤) 저장: 1회차 720 + 2회차 11~27라운드 580, 쉼터 지나감 1회차 4곳 + 2회차 3곳 = 7×2, 저장 1×10
  assert.equal(route([10]).seconds, 720 + 580 + 7 * 2 + 10);
  // 6층·12층 저장: 회차 3개(1·6·11라운드부터), 쉼터 5+4+3=12번 중 저장 2번
  assert.equal(route([5, 10]).seconds, 720 + 660 + 580 + 10 * 2 + 10 * 2);
  console.log("무릉 쉼터 시간 검증 통과");
}
