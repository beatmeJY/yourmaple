import assert from "node:assert/strict";
import { baseMonsterName, imageCandidates, apiParts, apiRenderUrl, apiInfoUrl, pickAction, diagnose } from "./monster-image-audit.js";

assert.equal(baseMonsterName("스티지(월묘)"), "스티지");
assert.equal(baseMonsterName("주니어 발록 (보스)"), "주니어 발록");
assert.equal(baseMonsterName("스티지"), "스티지");
assert.equal(baseMonsterName("(이상한)"), "(이상한)", "다 지우면 원래 이름");

const rows = [
  { id: "a", name: "스티지(월묘)", level: 22, image_url: null },
  { id: "b", name: "스티지", level: 22, image_url: "https://img/b.png" },
  { id: "c", name: "다크 스티지", level: 40, image_url: "https://img/c.png" },
  { id: "d", name: "스티지 (이벤트)", level: 22, image_url: "https://img/b.png" },
  { id: "e", name: "달팽이", level: 1, image_url: "https://img/e.png" },
  { id: "f", name: "스티지", level: 25, image_url: "https://img/broken.png" },
];
const working = new Set(["b", "c", "d", "e"]);
const picks = imageCandidates(rows[0], rows, working);
assert.deepEqual(picks.map((r) => r.id), ["b", "c"], "같은 이름 먼저, 같은 그림은 한 번, 안 뜨는 그림·관계없는 이름 제외");
assert.deepEqual(imageCandidates(rows[4], rows, working), [], "후보 없음");

console.log("monster-image-audit check ok");

const parts = apiParts("https://maplestory.io/api/gms/100/mob/9300063/render/stand?bgColor=", "1");
assert.deepEqual(parts, { base: "https://maplestory.io/api/gms/100/", id: "9300063", action: "stand" });
assert.equal(apiInfoUrl(parts), "https://maplestory.io/api/gms/100/mob/9300063");
assert.equal(apiRenderUrl(parts, "fly"), "https://maplestory.io/api/gms/100/mob/9300063/render/fly?bgColor=");
assert.deepEqual(apiParts(null, "100100"), { base: "https://maplestory.io/api/gms/100/", id: "100100", action: null });
assert.equal(pickAction({ die1: 4, fly: 2, hit1: 1 }), "fly", "스티지(월묘) 실제 응답");
assert.equal(pickAction({ move: 3, stand: 2 }), "stand");
assert.equal(pickAction({ die1: 1, attack1: 2, skill1: 1, jump: 1 }), "jump");
assert.equal(pickAction({}), null);
assert.equal(diagnose(parts, 200, { framebooks: { die1: 4, fly: 2, hit1: 1 } }).kind, "wrong-action");
assert.equal(diagnose(parts, 200, { framebooks: { die1: 4, fly: 2, hit1: 1 } }).action, "fly");
assert.equal(diagnose(parts, 404, null).kind, "missing");
assert.equal(diagnose(parts, 0, null).kind, "error");
assert.equal(diagnose(parts, 200, { framebooks: { stand: 1 } }).kind, "ok");
assert.equal(diagnose(parts, 200, { framebooks: {} }).kind, "noimage");
console.log("monster-image-audit api check ok");
