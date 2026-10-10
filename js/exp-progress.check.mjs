import assert from "node:assert/strict";
import { expProgress, pickHunt } from "./exp-progress.js";

const curve = new Map([[72, "651000"], [73, "700000"]]);
const hunts = [
  { id: "h1", character_id: "c1", exp_per_hour: "200000", title: "루디 하층" },
  { id: "h2", character_id: "c1", exp_per_hour: "300000", title: "시계탑" },
  { id: "h3", character_id: "c2", exp_per_hour: "900000", title: "남의 기록" },
];

// 대표 사냥터가 없으면 이 캐릭터의 가장 좋은 기록(다른 캐릭터 기록은 제외)
assert.equal(pickHunt(hunts, "c1", "").hunt.id, "h2");
// 대표 사냥터가 있으면 그것
assert.equal(pickHunt(hunts, "c1", "h1").hunt.id, "h1");
assert.equal(pickHunt(hunts, "c1", "h1").main, true);
// 대표 사냥터가 다른 캐릭터 기록이면 무시하고 가장 좋은 기록
assert.equal(pickHunt(hunts, "c1", "h3").hunt.id, "h2");
assert.equal(pickHunt(hunts, "c9", ""), null);

// 손계산: 651,000 중 412,880 → 63.42% (0.01% 내림), 남은 238,120, 시간당 300,000 → 47.624분 → 48분(올림)
const p = expProgress({ level: 72, exp: "412880", curve, hunts, characterId: "c1", mainHuntId: "" });
assert.equal(p.state, "ok");
assert.equal(p.percent, "63.42");
assert.equal(p.remaining, 238120n);
assert.equal(p.hunt.id, "h2");
assert.equal(p.minutes, 48n);

// 딱 나누어떨어지면 올림하지 않는다: 남은 300,000 / 시간당 300,000 = 60분
const even = expProgress({ level: 73, exp: "400000", curve, hunts, characterId: "c1", mainHuntId: "" });
assert.equal(even.minutes, 60n);

// 0%와 100%
assert.equal(expProgress({ level: 72, exp: "0", curve, hunts: [], characterId: "c1" }).percent, "0.00");
const full = expProgress({ level: 72, exp: "651000", curve, hunts, characterId: "c1" });
assert.equal(full.percent, "100.00");
assert.equal(full.minutes, 0n);

// 입력이 없거나 표가 없거나 넘치는 경우
assert.equal(expProgress({ level: 72, exp: null, curve }).state, "no-exp");
assert.equal(expProgress({ level: 72, exp: "", curve }).state, "no-exp");
assert.equal(expProgress({ level: 80, exp: "1", curve }).state, "no-curve");
assert.equal(expProgress({ level: 72, exp: "651001", curve }).state, "over");
// 사냥 기록이 없으면 시간 없이 진행률만
assert.equal(expProgress({ level: 72, exp: "1", curve, hunts: [], characterId: "c1" }).minutes, undefined);

console.log("exp-progress ok");
