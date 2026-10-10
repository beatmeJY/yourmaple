import assert from "node:assert/strict";
import { clockRemain, homeworkState, nextMidnight, shortRemain, startOfDay } from "./homework-calc.js";

const at = (text) => new Date(text).getTime();
const HOUR = 3600_000;

// 00시 초기화: 오늘 01시에 했으면 오늘 23시에도 완료, 다음 날 00시 1분에는 다시 할 수 있다
const now = at("2026-10-11T23:00:00");
assert.equal(startOfDay(now), at("2026-10-11T00:00:00"));
assert.equal(nextMidnight(now), at("2026-10-12T00:00:00"));
assert.deepEqual(homeworkState("daily", at("2026-10-11T01:00:00"), now), { done: true, next: at("2026-10-12T00:00:00") });
assert.deepEqual(homeworkState("daily", at("2026-10-10T23:59:00"), now), { done: false, next: null });
assert.deepEqual(homeworkState("daily", at("2026-10-11T01:00:00"), at("2026-10-12T00:01:00")), { done: false, next: null });
// 경계: 00시 정각에 한 것은 그날 몫
assert.equal(homeworkState("daily", at("2026-10-11T00:00:00"), now).done, true);

// 24시간: 어제 22시에 했으면 오늘 21:59에는 대기, 22:00에는 가능
const last = at("2026-10-10T22:00:00");
assert.deepEqual(homeworkState("after24h", last, at("2026-10-11T21:59:00")), { done: true, next: last + 24 * HOUR });
assert.deepEqual(homeworkState("after24h", last, at("2026-10-11T22:00:00")), { done: false, next: null });

// 7일
assert.equal(homeworkState("after7d", last, last + 7 * 24 * HOUR - 1).done, true);
assert.equal(homeworkState("after7d", last, last + 7 * 24 * HOUR).done, false);

// 기록 없음·잘못된 값
assert.deepEqual(homeworkState("daily", null, now), { done: false, next: null });
assert.deepEqual(homeworkState("after24h", "", now), { done: false, next: null });
assert.deepEqual(homeworkState("after24h", "not a date", now), { done: false, next: null });
// ISO 문자열도 받는다
assert.equal(homeworkState("after24h", new Date(last).toISOString(), at("2026-10-11T12:00:00")).done, true);

assert.equal(shortRemain(30_000), "1분 미만");
assert.equal(shortRemain(8 * 60_000), "8분");
assert.equal(shortRemain(5 * HOUR + 12 * 60_000), "5시간 12분");
assert.equal(shortRemain(2 * 24 * HOUR + 3 * HOUR), "2일 3시간");
assert.equal(clockRemain(5 * HOUR + 12 * 60_000 + 9_000), "05:12:09");
assert.equal(clockRemain(26 * HOUR), "1일 02:00:00");

console.log("homework ok");

import { DOJO_DAILY_GOAL, availableDay, availableLabel, availableTime, dojoDays, dojoProgress, localDay, resetDojoTotal } from "./homework-calc.js";

const day1 = at("2026-10-11T10:00:00");
assert.equal(localDay(day1), "2026-10-11");
const iso = (text) => new Date(text).toISOString();
// 어제 8,000 → 오늘 9,200 → 11,500: 오늘 3,500 (완료)
const log = [
  { total: 8000, kind: "set", recorded_at: iso("2026-10-10T22:00:00") },
  { total: 11500, kind: "set", recorded_at: iso("2026-10-11T12:00:00") },
  { total: 9200, kind: "set", recorded_at: iso("2026-10-11T09:00:00") },
];
const progress = dojoProgress(log, at("2026-10-11T13:00:00"));
assert.deepEqual(progress, { total: 11500, today: 3500, partial: false, lastAt: iso("2026-10-11T12:00:00") });
assert.ok(progress.today >= DOJO_DAILY_GOAL);
// 오늘 기록이 아직 없으면 오늘 0, 통합 점수는 마지막 값
assert.deepEqual(dojoProgress(log, at("2026-10-12T08:00:00")), { total: 11500, today: 0, partial: false, lastAt: iso("2026-10-11T12:00:00") });
// 처음 적은 날은 기준이 없어 partial, 그 뒤 오른 만큼만 센다
const first = dojoProgress([
  { total: 5000, kind: "set", recorded_at: iso("2026-10-11T09:00:00") },
  { total: 5600, kind: "set", recorded_at: iso("2026-10-11T11:00:00") },
], at("2026-10-11T12:00:00"));
assert.deepEqual([first.total, first.today, first.partial], [5600, 600, true]);
// 12,000 초기화(reset) 뒤에는 그 점수부터 다시 센다. 줄어든 기록도 초기화로 보고 0
const withReset = dojoDays([
  { total: 11800, kind: "set", recorded_at: iso("2026-10-10T20:00:00") },
  { total: 12500, kind: "set", recorded_at: iso("2026-10-11T09:00:00") },
  { total: 500, kind: "reset", recorded_at: iso("2026-10-11T09:05:00") },
  { total: 1800, kind: "set", recorded_at: iso("2026-10-11T12:00:00") },
  { total: 300, kind: "set", recorded_at: iso("2026-10-11T13:00:00") },
]);
assert.equal(withReset.length, 2);
assert.equal(withReset[1].earned, 700 + 0 + 1300 + 0);
assert.deepEqual(withReset[1].entries.map((entry) => entry.change), [700, 0, 1300, 0]);
assert.equal(withReset[0].partial, true);
assert.deepEqual(dojoProgress([], day1), { total: null, today: null, partial: false, lastAt: null });
assert.equal(resetDojoTotal(12000), 0);
assert.equal(resetDojoTotal(12350), 350);
assert.equal(resetDojoTotal(5000), 0);
assert.equal(availableLabel(at("2026-10-11T14:30:00"), day1), "14:30");
assert.equal(availableLabel(at("2026-10-12T08:05:00"), day1), "내일 08:05");
assert.equal(availableLabel(at("2026-10-14T08:05:00"), day1), "10.14 08:05");
assert.equal(availableDay(at("2026-10-11T23:59:00"), day1), "오늘");
assert.equal(availableDay(at("2026-10-12T00:00:00"), day1), "내일");
assert.equal(availableDay(at("2026-11-01T09:00:00"), at("2026-10-31T23:00:00")), "내일");
assert.equal(availableTime(at("2026-10-12T01:13:00")), "01:13");

// 오늘 초기화(clear): 오늘 쌓은 점수만 0, 그 뒤 오른 만큼 다시 센다. 통합 점수는 그대로
const cleared = dojoProgress([
  { total: 8000, kind: "set", recorded_at: iso("2026-10-10T22:00:00") },
  { total: 9200, kind: "set", recorded_at: iso("2026-10-11T09:00:00") },
  { total: 9200, kind: "clear", recorded_at: iso("2026-10-11T09:30:00") },
  { total: 9700, kind: "set", recorded_at: iso("2026-10-11T12:00:00") },
], at("2026-10-11T13:00:00"));
assert.deepEqual([cleared.total, cleared.today, cleared.partial], [9700, 500, false]);

console.log("dojo score log ok");
