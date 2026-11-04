import assert from "node:assert/strict";
import { formatSpeed, parseSpeed, pickGrade, pickNumber } from "./attack-speed.js";
// 읽기: 숫자가 있으면 숫자로 등급을 정한다
assert.deepEqual(parseSpeed("6 (보통)"), { grade: "보통", number: 6, other: "" });
assert.deepEqual(parseSpeed("4"), { grade: "빠름", number: 4, other: "" });
assert.deepEqual(parseSpeed("빠름"), { grade: "빠름", number: null, other: "" });
assert.deepEqual(parseSpeed("매우  빠름"), { grade: "매우 빠름", number: null, other: "" });
assert.deepEqual(parseSpeed(""), { grade: "", number: null, other: "" });
assert.deepEqual(parseSpeed(null), { grade: "", number: null, other: "" });
// 표에 없는 값은 그대로 지킨다
assert.equal(parseSpeed("2").other, "2");
assert.equal(formatSpeed(parseSpeed("2")), "2");
assert.equal(formatSpeed(parseSpeed("엄청 빠름")), "엄청 빠름");
// 등급 고르기: 숫자 하나뿐이면 자동, 둘이면 비워 두거나 맞는 숫자만 유지
assert.equal(formatSpeed(pickGrade({}, "매우 빠름")), "3 (매우 빠름)");
assert.equal(formatSpeed(pickGrade({}, "보통")), "6 (보통)");
assert.equal(formatSpeed(pickGrade({}, "매우 느림")), "9 (매우 느림)");
assert.equal(formatSpeed(pickGrade({}, "빠름")), "빠름");
assert.equal(formatSpeed(pickGrade(parseSpeed("6 (보통)"), "느림")), "느림");
assert.equal(formatSpeed(pickGrade({ grade: "빠름", number: 5 }, "빠름")), "5 (빠름)");
assert.equal(formatSpeed(pickGrade(parseSpeed("2"), "빠름")), "빠름");
assert.equal(formatSpeed(pickGrade(parseSpeed("4 (빠름)"), "")), "");
// 숫자 고르기: 그 등급의 숫자만
assert.equal(formatSpeed(pickNumber(parseSpeed("빠름"), 5)), "5 (빠름)");
assert.equal(formatSpeed(pickNumber(parseSpeed("느림"), 8)), "8 (느림)");
assert.equal(formatSpeed(pickNumber(parseSpeed("느림"), 4)), "느림");
assert.equal(formatSpeed(pickNumber(parseSpeed("7 (느림)"), null)), "느림");
// 저장 값은 SQL062 규칙(숫자로 시작하거나 다섯 등급 이름)에 맞는다
const valid = v => v === "" || /^[0-9]+(\s|\(|$)/.test(v) || ["매우 빠름", "빠름", "보통", "느림", "매우 느림"].includes(v);
for (const grade of ["매우 빠름", "빠름", "보통", "느림", "매우 느림"]) {
  const picked = pickGrade({}, grade);
  assert.ok(valid(formatSpeed(picked)));
  for (const n of [3, 4, 5, 6, 7, 8, 9]) assert.ok(valid(formatSpeed(pickNumber(picked, n))));
}
console.log("공격속도: 읽기·표 밖 값 보존·등급별 숫자 고정/선택·저장 형식 통과");
