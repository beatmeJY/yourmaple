// 아이템 설명 정리 검사: node js/item-text.check.mjs
import assert from "node:assert/strict";
import { cleanItemText, displayItemText, stripItemMarks, tidyItemText } from "./item-text.js";
import { itemTextCases } from "../tools/item-text-fixtures.mjs";

for (const sample of itemTextCases) {
  assert.deepEqual(cleanItemText(sample.raw), { description: sample.description, effects: sample.effects, options: sample.options }, sample.name);
  // 정리한 글을 다시 정리해도 같다(등록·수정 때 여러 번 거쳐도 안전).
  assert.equal(cleanItemText(sample.description).description, sample.description, `${sample.name} 다시 정리`);
}

// 같은 능력치가 두 번 나오면 두 번째는 효과 줄로 남긴다.
assert.deepEqual(cleanItemText("#c성공률 10%STR +3STR +2#").options, { str: 3 });
assert.deepEqual(cleanItemText("#c성공률 10%STR +3STR +2#").effects, ["성공률 10%", "STR +2"]);
// 빼기 수치
assert.deepEqual(cleanItemText("#c성공률 10%이동속도 -2#").options, { speed: -2 });

// 화면: 073 실행 전(설명에 #c)이면 효과·옵션을 꺼내 보이고, 실행 뒤(옵션이 이미 있음)면 설명만 다듬는다.
const before = displayItemText({ description: "창에 공격력 향상 옵션을 추가한다.#c성공률 10%STR +3공격력 +5#", base_options: {} });
assert.deepEqual(before, { description: "창에 공격력 향상 옵션을 추가한다.", effects: ["성공률 10%"], options: { str: 3, attack: 5 } });
const after = displayItemText({ description: "창에 공격력 향상 옵션을 추가한다.", effect_description: "성공률 10%", base_options: { str: 3, attack: 5 } });
assert.deepEqual(after, { description: "창에 공격력 향상 옵션을 추가한다.", effects: ["성공률 10%"], options: {} });
assert.deepEqual(displayItemText({}), { description: "", effects: [], options: {} });

assert.equal(stripItemMarks("70%의 확률로 #c슈퍼 트랜스폼#의 마스터 레벨"), "70%의 확률로 슈퍼 트랜스폼의 마스터 레벨");
assert.equal(stripItemMarks("ID number : XXX#1"), "ID number : XXX#1", "#c 가 없으면 # 도 그대로");
assert.equal(tidyItemText("  한 줄 \n  두 줄  "), "한 줄\n두 줄");

console.log(`item-text: 예시 ${itemTextCases.length}개(주문서 효과·옵션·파괴 확률·조건·손재주·마스터리북·줄바꿈·약어), 중복 능력치·빼기·화면 대체 규칙 통과`);
