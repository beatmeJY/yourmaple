import assert from "node:assert/strict";
import { nameMatchRank, normalizeSearch, searchVariants } from "./search-match.js";

assert.equal(normalizeSearch("  혼돈의 주문서 60% "), "혼돈의주문서60%");
// 그대로 들어 있으면 0
assert.equal(nameMatchRank("혼돈의 주문서 60%", "혼돈의 주문서"), 0);
assert.equal(nameMatchRank("혼돈의 주문서 60%", "주문서60"), 0);
// 글자 순서만 맞으면 1
assert.equal(nameMatchRank("혼돈의 주문서 60%", "혼주문"), 1);
assert.equal(nameMatchRank("혼돈의 주문서 60%", "혼60"), 1);
// 순서가 틀리면 못 찾는다
assert.equal(nameMatchRank("혼돈의 주문서 60%", "문혼"), null);
assert.equal(nameMatchRank("청갑충", "혼주문"), null);
// 별명: 혼줌 → 혼돈의주문서
assert.deepEqual(searchVariants("혼줌 60"), ["혼줌60", "혼돈의주문서60"]);
assert.equal(nameMatchRank("혼돈의 주문서 60%", "혼줌"), 0);
assert.equal(nameMatchRank("혼돈의 주문서 60%", "혼줌60"), 0);
// 대소문자·특수문자
assert.equal(nameMatchRank("Maple Shield", "mpshd"), 1);
assert.equal(nameMatchRank("혼돈의 주문서 60%", "60%"), 0);
assert.equal(nameMatchRank("아무 이름", ""), null);
console.log("아이템 이름 검색 규칙 검증 통과");
