import assert from "node:assert/strict";
import { DEFAULT_CHAOS, applyChaos, checkChaosTable, pickDelta, statDiff } from "./chaos-calc.js";

// 기본 확률표는 합 100%, 성공률 60%
assert.equal(checkChaosTable(DEFAULT_CHAOS).ok, true);
assert.equal(DEFAULT_CHAOS.successRate, 60);
assert.match(checkChaosTable({ successRate: 60, deltas: [{ value: 0, percent: 50 }] }).error, /합이 50%/);
assert.match(checkChaosTable({ successRate: 120, deltas: DEFAULT_CHAOS.deltas }).error, /성공률/);

// 누적 확률로 변화량 고르기: 첫 칸(-5, 4.94%) 경계와 마지막 칸(+5)
assert.equal(pickDelta(DEFAULT_CHAOS.deltas, 0), -5);
assert.equal(pickDelta(DEFAULT_CHAOS.deltas, 0.0493), -5);
assert.equal(pickDelta(DEFAULT_CHAOS.deltas, 0.0495), -4);
assert.equal(pickDelta(DEFAULT_CHAOS.deltas, 0.9999), 5);

// 정해진 난수를 차례로 내놓는 가짜 난수
const seq = (...values) => () => values.shift();
const item = { slots: 3, stats: { str: 3, dex: 2, hp: 30, attack: 0 } };

// 실패: 횟수만 1 줄고 능력치 그대로
let r = applyChaos(item, DEFAULT_CHAOS, seq(0.7));
assert.equal(r.success, false);
assert.deepEqual(r.item, { slots: 2, stats: { str: 3, dex: 2, hp: 30, attack: 0 } });
assert.deepEqual(r.changes, []);

// 성공: 붙어 있는 능력치(STR·DEX·HP)만 굴림, 공격력 0은 그대로. STR -5 → 사라짐, DEX +1, HP +2×10
// 누적: 0 칸은 33.26~51.64%, +1 칸은 51.64~70.95%, +2 칸은 70.95~86.82%, +5 칸은 99.01% 위
r = applyChaos(item, DEFAULT_CHAOS, seq(0.1, 0, 0.6, 0.75));
assert.equal(r.success, true);
assert.deepEqual(r.item, { slots: 2, stats: { dex: 3, hp: 50, attack: 0 } });
assert.deepEqual(r.changes.map((c) => [c.key, c.delta, c.after, c.gone]), [["str", -5, 0, true], ["dex", 1, 3, false], ["hp", 20, 50, false]]);

// 사라진 능력치는 다음 성공에서 굴리지 않는다
const next = applyChaos(r.item, DEFAULT_CHAOS, seq(0.1, 0.995, 0.995)).item;
assert.equal(next.stats.str, undefined);
assert.deepEqual(next.stats, { dex: 8, hp: 100, attack: 0 });

// 횟수 0이면 바를 수 없다
assert.match(applyChaos({ slots: 0, stats: { str: 1 } }, DEFAULT_CHAOS).error, /횟수/);

// 시작 대비 차이(사라진 능력치는 0)
assert.deepEqual(statDiff(item, r.item).map((d) => [d.key, d.diff]), [["str", -3], ["dex", 1], ["hp", 20]]);

// 많이 굴린 평균: 성공률 60%, 변화량 기댓값 ≈ +0.29 (표에서 계산)
// mulberry32: 고정 씨앗의 고른 난수(단순 LCG는 연속 값이 서로 얽혀 비율이 치우친다)
let seed = 12345;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
let ok = 0;
let sum = 0;
const runs = 200000;
for (let i = 0; i < runs; i += 1) {
  const out = applyChaos({ slots: 1, stats: { str: 100 } }, DEFAULT_CHAOS, random);
  if (out.success) {
    ok += 1;
    sum += out.changes[0].delta;
  }
}
const mean = DEFAULT_CHAOS.deltas.reduce((s, d) => s + d.value * d.percent, 0) / 100;
assert.ok(Math.abs(ok / runs - 0.6) < 0.005, `성공 비율 ${ok / runs}`);
assert.ok(Math.abs(sum / ok - mean) < 0.03, `평균 변화량 ${sum / ok} vs ${mean}`);
console.log("혼돈의 주문서 계산 검증 통과");

// 장비 등급 색: 정옵 대비 점수(0.1점 단위)와 구간 경계
{
  const { chaosScoreTenths, chaosGrade, scoreText } = await import("./chaos-calc.js");
  const base = { str: 3, dex: 3, attack: 1, defense: 50, hp: 0, speed: 0 };
  assert.equal(chaosScoreTenths(base, base), 0);
  assert.equal(chaosScoreTenths(base, { ...base, hp: 100 }), 100); // HP 100 = 10점
  assert.equal(chaosScoreTenths(base, { ...base, hp: 15 }), 15); // 1.5점(소수 그대로)
  assert.equal(chaosScoreTenths(base, { ...base, speed: 20, jump: 10 }), 0); // 이동속도·점프력 제외
  assert.equal(chaosScoreTenths(base, { ...base, str: 0, attack: 3 }), -10); // STR 사라짐 −3, 공 +2
  const key = (score, wins = 1) => chaosGrade(Math.round(score * 10), wins).key;
  assert.equal(key(-1), "gray");
  assert.equal(key(-0.5), "gray");
  assert.equal(key(0, 0), "white");
  assert.equal(key(5, 0), "white");
  assert.equal(key(0), "orange");
  assert.equal(key(5.5), "orange");
  assert.equal(key(6), "blue");
  assert.equal(key(22.9), "blue");
  assert.equal(key(23), "purple");
  assert.equal(key(39), "purple");
  assert.equal(key(40), "yellow");
  assert.equal(key(54), "yellow");
  assert.equal(key(55), "green");
  assert.equal(key(69.9), "green");
  assert.equal(key(70), "red");
  assert.equal(key(130, 0), "red");
  assert.equal(scoreText(275), "+27.5");
  assert.equal(scoreText(-30), "−3");
  assert.equal(scoreText(0), "0");
}
