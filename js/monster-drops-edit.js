// 몬스터 드랍 수정창의 입력 규칙(2026-11-16 사용자 요청: 드랍 테이블도 고칠 수 있어야 한다).
// 서버(sql/072)도 같은 규칙으로 다시 검사한다. 확률 빈칸은 "확률 미상"(null), 0은 실제 값이다.

// "0.05", "0.05%", " 60 % " → 숫자, 빈칸 → null. 0~100% 밖이나 숫자가 아니면 오류.
export function readDropRate(raw, name = "드랍") {
  const text = String(raw ?? "").trim().replace(/\s*%$/, "");
  if (text === "") return null;
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`${name}의 확률은 숫자로 입력해 주세요.`);
  const value = Number(text);
  if (!Number.isFinite(value) || value > 100) throw new Error(`${name}의 확률은 0~100% 사이로 입력해 주세요.`);
  if ((text.split(".")[1] ?? "").length > 6) throw new Error(`${name}의 확률은 소수 여섯째 자리까지 입력해 주세요.`);
  return value;
}

// 화면 줄 → 서버로 보낼 목록. removed 줄은 빼고(서버가 지움), 새 줄은 id 없이 보낸다.
// rows: [{ id: 기존 드랍 id 또는 null, item: { id, name }, rate: 입력 글자, removed }]
export function dropSavePayload(rows) {
  const list = rows.filter((row) => !row.removed);
  if (list.length > 500) throw new Error("드랍은 500개까지 둘 수 있습니다.");
  return list.map((row) => {
    if (!row.item?.id) throw new Error("드랍할 아이템을 골라 주세요.");
    return { id: row.id ?? null, item_id: row.item.id, rate_percent: readDropRate(row.rate, row.item.name) };
  });
}

// 처음 불러온 목록과 달라졌는지(닫을 때 경고·저장 버튼에 쓴다). 확률은 숫자로 비교해 "60"과 "60.0"을 같게 본다.
export function dropsChanged(initial, rows) {
  const live = rows.filter((row) => !row.removed);
  if (live.length !== initial.length || live.some((row) => !row.id)) return true;
  const before = new Map(initial.map((drop) => [drop.id, drop]));
  return live.some((row) => {
    const old = before.get(row.id);
    if (!old || old.item_id !== row.item.id) return true;
    let rate;
    try { rate = readDropRate(row.rate); } catch { return true; }
    return (old.rate_percent == null ? null : Number(old.rate_percent)) !== rate;
  });
}

// 확률 표시 글자(입력칸 초깃값). null → 빈칸.
export function rateInput(value) {
  return value == null ? "" : String(Number(value));
}
