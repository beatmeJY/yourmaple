import assert from "node:assert/strict";
import { bestOffset, sampleOffset } from "./server-clock.js";

// 기기 시계가 정확하고 왕복 200ms: 서버 Date 는 초 아래가 잘려 와도 오차 0.5초 안
const exact = sampleOffset({ sentAt: 1_000_000_300, receivedAt: 1_000_000_500, serverDate: 1_000_000_000 });
assert.equal(exact.rtt, 200);
assert(Math.abs(exact.offset) <= 500);

// 기기 시계가 2분 늦으면 offset 이 약 +120초
const late = sampleOffset({ sentAt: 1_000_000_000, receivedAt: 1_000_000_100, serverDate: 1_000_120_000 });
assert(Math.abs(late.offset - 120_000) <= 500);

// 빠르면 음수
const early = sampleOffset({ sentAt: 1_000_090_000, receivedAt: 1_000_090_100, serverDate: 1_000_000_000 });
assert(early.offset < -89_000);

// 쓸 수 없는 표본
assert.equal(sampleOffset({ sentAt: 0, receivedAt: 5000, serverDate: 0 }), null); // 왕복 너무 김
assert.equal(sampleOffset({ sentAt: 10, receivedAt: 5, serverDate: 0 }), null); // 시계가 뒤로 감
assert.equal(sampleOffset({ sentAt: 0, receivedAt: 5, serverDate: NaN }), null); // Date 머리 없음

// 왕복이 가장 짧은 표본을 고른다
assert.equal(bestOffset([null, { rtt: 300, offset: 10 }, { rtt: 80, offset: 20 }]), 20);
assert.equal(bestOffset([null, null]), null);
console.log("server-clock ok");
