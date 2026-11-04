import assert from "node:assert/strict";
import { formatJobs, parseJobs, toggleJob } from "./job-picker.js";
assert.deepEqual(parseJobs("공용"), { all: true, jobs: [], other: "" });
assert.deepEqual(parseJobs("도적/전사"), { all: false, jobs: ["전사", "도적"], other: "" });
assert.deepEqual(parseJobs("전사, 궁수 · 해적"), { all: false, jobs: ["전사", "궁수", "해적"], other: "" });
assert.deepEqual(parseJobs("초보자"), { all: false, jobs: ["초보자"], other: "" });
assert.deepEqual(parseJobs(""), { all: false, jobs: [], other: "" });
assert.equal(parseJobs("모험가").other, "모험가");
assert.equal(formatJobs(parseJobs("모험가")), "모험가");
assert.equal(parseJobs("공용/전사").other, "공용/전사");
// 여러 개 켜고 끄기, 저장 순서는 늘 같은 순서
let s = parseJobs("");
s = toggleJob(s, "도적"); s = toggleJob(s, "전사");
assert.equal(formatJobs(s), "전사/도적");
s = toggleJob(s, "궁수"); assert.equal(formatJobs(s), "전사/궁수/도적");
s = toggleJob(s, "전사"); assert.equal(formatJobs(s), "궁수/도적");
// 공용은 혼자, 직업을 누르면 공용이 풀림
s = toggleJob(s, "공용"); assert.equal(formatJobs(s), "공용");
s = toggleJob(s, "해적"); assert.equal(formatJobs(s), "해적");
assert.equal(formatJobs(toggleJob(parseJobs("공용"), "공용")), "");
// 표 밖 기존 값은 직업을 누르면 새로 시작
assert.equal(formatJobs(toggleJob(parseJobs("모험가"), "마법사")), "마법사");
// 저장 값은 서버가 나누는 규칙과 맞고 100자 이하
const every = ["초보자", "전사", "마법사", "궁수", "도적", "해적"].reduce(toggleJob, parseJobs(""));
assert.equal(formatJobs(every), "초보자/전사/마법사/궁수/도적/해적");
assert.ok(formatJobs(every).length <= 100);
assert.deepEqual(formatJobs(every).split(/[/,·\s]+/), ["초보자", "전사", "마법사", "궁수", "도적", "해적"]);
console.log("착용 직업: 읽기·여러 개 선택·공용 단독·표 밖 값 보존·저장 형식 통과");
