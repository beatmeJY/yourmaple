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
