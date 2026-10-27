import assert from "node:assert/strict";
import { levelExpSeed } from "./level-exp-seed.js";
import { ZONES, addDays, daysLeft, expFromPercent, gainRun, percentOf, simulate, zoneOf } from "./monster-park-calc.js";

const curve = new Map(levelExpSeed.map(([level, exp]) => [level, BigInt(exp)]));
const MID = 2_898_000n;
const known = { low: null, mid: MID, high: null };

// 구역 경계
assert.equal(zoneOf(49), null);
assert.equal(zoneOf(50).id, "low");
assert.equal(zoneOf(70).id, "low");
assert.equal(zoneOf(71).id, "mid");
assert.equal(zoneOf(100).id, "mid");
assert.equal(zoneOf(101).id, "high");
assert.equal(zoneOf(129).id, "high");
assert.equal(zoneOf(130), null);

// 구역 경험치(2026-10-28 사용자 확정)
assert.deepEqual(ZONES.map((zone) => zone.exp), [418_840n, 2_898_000n, 6_289_333n]);
// 손계산: Lv101 필요 10,783,397. 0 에서 두 판(12,578,666) → 102 레벨, 남은 1,795,269
const real = Object.fromEntries(ZONES.map((zone) => [zone.id, zone.exp]));
const high = simulate({ level: 101, exp: 0n, curve, zoneExp: real, todayLeft: 2, days: 1 });
assert.deepEqual(high.final, { level: 102, exp: 1_795_269n });

// 레벨이 안 오르면 그대로 더한다
assert.deepEqual(gainRun(100, 0n, MID, curve), { level: 100, exp: MID, wasted: 0n, leveled: false });
// 손계산: Lv71 필요 2,175,973. 0 + 2,898,000 → 72 레벨, 남은 722,027(Lv72 필요보다 작아 그대로)
assert.deepEqual(gainRun(71, 0n, MID, curve), { level: 72, exp: 722_027n, wasted: 0n, leveled: true });
// 1레벨 제한: 필요 100, 다음 필요 50 에 1000 을 받으면 → 다음 레벨 49(99.99%), 851 버림
const tiny = new Map([[60, 100n], [61, 50n]]);
assert.deepEqual(gainRun(60, 0n, 1000n, tiny), { level: 61, exp: 49n, wasted: 851n, leveled: true });
// 129 → 130 이면 끝(경험치 0)
assert.deepEqual(gainRun(129, curve.get(129) - 1n, 10n, curve).level, 130);

// 날짜: 마감 11/30. 10/27 → 오늘 포함 35일, 마감 날 1일, 12/1 이면 0
assert.equal(daysLeft("2026-10-27"), 35);
assert.equal(daysLeft("2026-11-30"), 1);
assert.equal(daysLeft("2026-12-01"), 0);
assert.equal(addDays("2026-10-30", 2), "2026-11-01");

// 오늘 남은 입장 1회 + 내일 2회 → 3판. Lv80 0% 에서 시작
const short = simulate({ level: 80, exp: 0n, curve, zoneExp: known, todayLeft: 1, days: 2 });
assert.equal(short.runs.length, 3);
assert.deepEqual(short.runs.map((run) => [run.day, run.slot]), [[0, 0], [1, 0], [1, 1]]);
assert.equal(short.stop, "days");

// 구역이 바뀌면 그날 남은 입장을 못 쓴다: Lv100 에서 남은 경험치가 한 판보다 적으면 첫 판에 101 → 오늘 1판 버려짐
const edge = simulate({ level: 100, exp: curve.get(100) - 1000n, curve, zoneExp: known, todayLeft: 2, days: 1 });
assert.equal(edge.runs.length, 1);
assert.equal(edge.runs[0].after.level, 101);
assert.equal(edge.runs[0].lostAfter, 1);
assert.equal(edge.lost, 1);
assert.equal(edge.stop, "days");
// 다음 날 이어가면 101~129 경험치를 모르니 멈춘다
const unknown = simulate({ level: 100, exp: curve.get(100) - 1000n, curve, zoneExp: known, todayLeft: 2, days: 2 });
assert.equal(unknown.stop, "unknown");
assert.equal(unknown.stopZone.id, "high");
// 두 번째 판에서 구역이 바뀌면 그날 버리는 입장 없음
const second = simulate({ level: 100, exp: curve.get(100) - MID - 1000n, curve, zoneExp: known, todayLeft: 2, days: 1 });
assert.equal(second.runs.length, 2);
assert.equal(second.lost, 0);

// 구역 경험치를 모두 알면 130 에서 멈추고 runs 의 마지막이 130
const all = simulate({ level: 125, exp: 0n, curve, zoneExp: { low: 1n, mid: MID, high: 50_000_000n }, todayLeft: 2, days: 100 });
assert.equal(all.stop, "max");
assert.equal(all.final.level, 130);
assert.equal(all.runs.at(-1).after.level, 130);
// 1레벨 제한이라 한 판에 1레벨씩: 125 → 130 은 5판
assert.equal(all.runs.length, 5);

// 시그너스(만렙 120): 119 → 120 이면 끝, 120 은 바로 "max"
const cygnus = simulate({ level: 118, exp: 0n, curve, zoneExp: real, todayLeft: 2, days: 100, maxLevel: 120 });
assert.equal(cygnus.stop, "max");
assert.equal(cygnus.final.level, 120);
assert.equal(cygnus.runs.at(-1).after.level, 120);
assert.deepEqual(gainRun(119, curve.get(119) - 1n, 10n, curve, 120), { level: 120, exp: 0n, wasted: 0n, leveled: true });
assert.equal(simulate({ level: 120, exp: 0n, curve, zoneExp: real, days: 3, maxLevel: 120 }).runs.length, 0);

// 50 미만은 들어갈 수 없다
assert.equal(simulate({ level: 49, exp: 0n, curve, zoneExp: known, days: 4 }).stop, "low");

// % 변환(0.01% 내림)
assert.equal(percentOf(6342n, 10000n), "63.42");
assert.equal(expFromPercent("50", 10000n), 5000n);
assert.equal(expFromPercent("100", 10000n), 9999n);
assert.equal(expFromPercent("", 10000n), 0n);

console.log("monster-park-calc ok");
