import assert from "node:assert/strict";
import { transportState, transportTime, transportCountdown } from "./transport-calc.js";
const at = (minute, seconds = 0) => Date.parse(`2026-10-21T12:${String(minute).padStart(2, "0")}:${String(seconds).padStart(2, "0")}+09:00`);
const labels = ["내려감 출발", "올라감 출발 대기", "올라감 출발", "내려감 출발 대기"];
for (let minute = 0; minute < 60; minute += 1) {
  for (const second of [0, 59]) {
    const now = at(minute, second);
    const { helios, ship } = transportState(now);
    assert.equal(helios.label, labels[minute % 4]);
    assert.equal(new Date(helios.upAt + 9 * 3600_000).getUTCMinutes() % 4, 2);
    assert.equal(new Date(helios.downAt + 9 * 3600_000).getUTCMinutes() % 4, 0);
    assert.ok(helios.upAt > now && helios.downAt > now && helios.changesAt > now);
    const phase = minute % 10 < 5 ? "waiting" : minute % 10 < 9 ? "boarding" : "closed";
    assert.equal(ship.phase, phase);
    assert.ok(ship.changesAt > now && ship.departsAt > now);
    assert.equal(ship.departsAt - ship.closesAt, 60_000);
    assert.equal(ship.departsAt - ship.boardingAt, 300_000);
  }
}
assert.equal(transportState(at(4, 59) + 999).ship.phase, "waiting");
assert.equal(transportState(at(5)).ship.phase, "boarding");
assert.equal(transportState(at(8, 59) + 999).ship.phase, "boarding");
assert.equal(transportState(at(9)).ship.phase, "closed");
assert.equal(transportState(at(10)).ship.phase, "waiting");
assert.equal(transportTime(transportState(at(59, 59)).ship.departsAt), "13:00");
assert.equal(transportTime(transportState(Date.parse("2026-10-21T23:59:59+09:00")).ship.departsAt), "00:00");
assert.equal(transportCountdown(at(10), at(9, 59) + 1), "0:01");
assert.equal(transportCountdown(at(10), at(10)), "0:00");
assert.equal(transportState(Date.parse("2026-10-21T03:09:00Z")).ship.phase, "closed");
console.log("교통 시간표: 60분 전체·초 경계·마감·정각/자정 전환·한국 시각 검증 통과");
