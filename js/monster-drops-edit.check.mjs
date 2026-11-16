import assert from "node:assert/strict";
import { readDropRate, dropSavePayload, dropsChanged, rateInput } from "./monster-drops-edit.js";

assert.equal(readDropRate(""), null, "빈칸은 확률 미상");
assert.equal(readDropRate("  "), null);
assert.equal(readDropRate("0"), 0, "0은 실제 값");
assert.equal(readDropRate("60"), 60);
assert.equal(readDropRate(" 0.05 % "), 0.05, "% 붙여도 됨");
assert.equal(readDropRate("100"), 100);
assert.equal(readDropRate("0.000001"), 0.000001);
assert.throws(() => readDropRate("100.1"), /0~100/);
assert.throws(() => readDropRate("-1"), /숫자/);
assert.throws(() => readDropRate("1,5"), /숫자/);
assert.throws(() => readDropRate("abc", "달팽이 껍질"), /달팽이 껍질의 확률/);
assert.throws(() => readDropRate("0.0000001"), /여섯째/);

const shell = { id: "i1", name: "달팽이 껍질" }, red = { id: "i2", name: "빨간 포션" };
const initial = [{ id: "d1", item_id: "i1", rate_percent: 60 }, { id: "d2", item_id: "i2", rate_percent: null }];
const rows = [{ id: "d1", item: shell, rate: "60" }, { id: "d2", item: red, rate: "" }];
assert.equal(dropsChanged(initial, rows), false, "그대로면 바뀌지 않음");
assert.equal(dropsChanged(initial, [{ ...rows[0], rate: "60.0" }, rows[1]]), false, "60과 60.0은 같음");
assert.equal(dropsChanged(initial, [{ ...rows[0], rate: "55" }, rows[1]]), true, "확률 바꿈");
assert.equal(dropsChanged(initial, [rows[0], { ...rows[1], removed: true }]), true, "뺌");
assert.equal(dropsChanged(initial, [...rows, { id: null, item: shell, rate: "" }]), true, "새로 넣음");
assert.equal(dropsChanged(initial, [{ ...rows[0], rate: "x" }, rows[1]]), true, "잘못된 입력도 바뀐 것으로");

assert.deepEqual(dropSavePayload([{ ...rows[0], rate: "55.5" }, { ...rows[1], removed: true }, { id: null, item: red, rate: "0.05%" }]),
  [{ id: "d1", item_id: "i1", rate_percent: 55.5 }, { id: null, item_id: "i2", rate_percent: 0.05 }], "뺀 줄 제외·새 줄 id null");
assert.deepEqual(dropSavePayload([]), [], "전부 빼기");
assert.throws(() => dropSavePayload([{ id: null, item: null, rate: "" }]), /아이템을 골라/);
assert.throws(() => dropSavePayload(Array.from({ length: 501 }, () => ({ id: null, item: shell, rate: "" }))), /500/);
assert.equal(rateInput(null), "");
assert.equal(rateInput("0.0500"), "0.05");
console.log("monster-drops-edit: 확률 빈칸=미상·0 유지·% 허용·범위/형식/자릿수, 바뀜 판정(60=60.0·뺌·새 줄), 저장 목록(뺀 줄 제외·새 줄 id null) 통과");
