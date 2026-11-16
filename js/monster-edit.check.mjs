import assert from "node:assert/strict";
import { readMonsterDraft, monsterDraftFromRow } from "./monster-edit.js";

const base = { name: " 달팽이 ", level: "1", hp: "8", exp: "3", movement_speed: "-65", meso_value: "", weak: ["성", "불"], resist: [] };
const ok = readMonsterDraft(base);
assert.equal(ok.name, "달팽이");
assert.equal(ok.level, 1);
assert.equal(ok.hp, 8);
assert.equal(ok.movement_speed, -65, "이동속도는 음수 허용");
assert.equal(ok.meso_value, null, "빈칸은 미제공");
assert.deepEqual(ok.weak_elements, ["불", "성"], "속성은 정해진 순서로");
assert.equal(readMonsterDraft({ ...base, hp: "0" }).hp, 0, "0은 실제 값");
assert.equal(readMonsterDraft({ ...base, hp: "3,100,000" }).hp, 3100000, "쉼표 허용");
assert.equal(readMonsterDraft({ ...base, required_accuracy: "12.5" }).required_accuracy, 12.5);

assert.throws(() => readMonsterDraft({ ...base, name: "  " }), /이름/);
assert.throws(() => readMonsterDraft({ ...base, level: "0" }), /1 이상/);
assert.throws(() => readMonsterDraft({ ...base, hp: "-1" }), /0 이상/);
assert.throws(() => readMonsterDraft({ ...base, exp: "1.5" }), /정수/);
assert.throws(() => readMonsterDraft({ ...base, mp: "abc" }), /숫자/);
assert.throws(() => readMonsterDraft({ ...base, physical_attack: "-3" }), /0 이상/);
assert.throws(() => readMonsterDraft({ ...base, weak: ["불"], resist: ["불"] }), /함께/);

const row = monsterDraftFromRow({ name: "주니어 발록", level: 70, hp: 3100000, exp: null, weak_elements: "냉기, 성", resist_elements: "불" });
assert.deepEqual(row.weak_elements, ["냉기", "성"]);
assert.deepEqual(row.resist_elements, ["불"]);
assert.equal(row.exp, null);
console.log("monster-edit check ok");
