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

// 장비 효과 글: 보이는 값과 같은 부분만 뺀다.
{
  const { dropShownEffect } = await import("./item-text.js");
  const stats = [
    { stat_key: "defense", base_value: 95, minimum_value: 90, maximum_value: 100 },
    { stat_key: "str", base_value: 6, minimum_value: null, maximum_value: null },
    { stat_key: "avoidability", base_value: 2, minimum_value: 1, maximum_value: 3 },
    { stat_key: "remaining_upgrades", base_value: 10 },
  ];
  const raw = "물리방어력 : + 95(90~100) STR : + 6(5~7) 회피율 : + 2(1~3) 업그레이드 가능 횟수: 10 상점가: 200000메소";
  assert.equal(dropShownEffect(raw, { stats, shopPrice: "200000" }), "", "모두 같으면 빈 글");
  assert.equal(dropShownEffect(raw, { stats, shopPrice: 150000 }), "상점가: 200000메소", "상점가가 다르면 남김");
  assert.equal(dropShownEffect("점프력 : + 10(8~12) 업그레이드 가능 횟수: 5", { stats: [{ stat_key: "jump", base_value: 5 }, { stat_key: "remaining_upgrades", base_value: 5 }] }), "점프력 : + 10(8~12)", "값이 다르면 남김");
  assert.equal(dropShownEffect("물리방어력 : + 95(80~100)", { stats }), "물리방어력 : + 95(80~100)", "범위가 다르면 남김");
  assert.equal(dropShownEffect("물리공격력 : + 85(80~90) 공격속도 : 6 (보통) 업그레이드 가능 횟수: 상점가: ", { stats: [{ stat_key: "attack", base_value: 85 }], attackSpeed: "6 (보통)" }), "", "공격속도·빈 횟수·빈 상점가");
  assert.equal(dropShownEffect("이동속도 : - 5", { stats: [{ stat_key: "speed", base_value: -5 }] }), "", "빼기 수치");
  assert.equal(dropShownEffect("", {}), "");
}
console.log("item-text: 장비 효과 글 중복 빼기 통과");
