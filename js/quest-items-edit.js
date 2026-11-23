// 퀘스트 조건·보상 수정창의 입력 규칙(2026-11-23 사용자 요청, sql/079). 서버도 같은 규칙으로 다시 검사한다.
// 줄: { kind: "c"(완료 조건) | "r"(보상), i 아이템 번호 | m 몬스터 번호, count 입력 글자, n 이름, v 그림 버전, r 그중 하나, j 맞는 직업만 }

// 상세 결과 → 수정창 줄. 원본 대조 전 자료처럼 보상 방식이 무작위·고름인데 r 표시가 없으면 모든 보상을 "그중 하나"로 본다.
export function questEditRows(conditions = [], rewards = [], method = null) {
  const legacyPick = (method === "random" || method === "select") && !rewards.some((x) => x.r);
  const row = (kind) => (x) => ({
    kind, i: x.i ?? null, m: kind === "c" ? x.m ?? null : null, count: String(x.c ?? 1),
    n: x.item?.name ?? x.monster?.name ?? x.n ?? null, v: x.v ?? null,
    r: kind === "r" && (legacyPick || !!x.r), j: kind === "r" && !!x.j,
    image_url: x.item?.image_url ?? x.monster?.image_url ?? null, linked: !!(x.item || x.monster),
  });
  return [...conditions.map(row("c")), ...rewards.map(row("r"))];
}

// 개수 입력: 1~1,000,000,000 정수. 쉼표는 허용한다.
export function readQuestCount(raw, name = "항목") {
  const text = String(raw ?? "").trim().replace(/,/g, "");
  if (!/^\d+$/.test(text)) throw new Error(`${name}의 개수는 1 이상 정수로 적어 주세요.`);
  const value = Number(text);
  if (value < 1 || value > 1_000_000_000) throw new Error(`${name}의 개수는 1~1,000,000,000 사이로 적어 주세요.`);
  return value;
}

// 줄 → 서버로 보낼 { conditions, rewards }. 같은 아이템·몬스터를 같은 칸에 두 번 넣으면 막는다.
export function questItemsPayload(rows) {
  const out = { conditions: [], rewards: [] };
  for (const kind of ["c", "r"]) {
    const list = rows.filter((row) => row.kind === kind);
    if (list.length > 100) throw new Error(`${kind === "c" ? "완료 조건" : "보상"}은 100개까지 둘 수 있습니다.`);
    const seen = new Set();
    for (const row of list) {
      const key = row.m ? `m${row.m}` : `i${row.i}`;
      if (!row.i && !row.m) throw new Error("아이템이나 몬스터를 골라 주세요.");
      if (seen.has(key)) throw new Error(`${row.n ?? "같은 항목"}이(가) ${kind === "c" ? "완료 조건" : "보상"}에 두 번 들어 있어요.`);
      seen.add(key);
      const entry = { ...(row.m ? { m: String(row.m) } : { i: String(row.i) }), c: readQuestCount(row.count, row.n ?? "항목") };
      if (row.n) entry.n = row.n;
      if (row.v) entry.v = row.v;
      if (kind === "r" && row.r) entry.r = 1;
      if (kind === "r" && row.j) entry.j = 1;
      (kind === "c" ? out.conditions : out.rewards).push(entry);
    }
  }
  return out;
}

// 저장할 보상 방식(서버와 같은 규칙): 보상 없음 null, 그중 하나가 있으면 pick, 없으면 fixed.
export function questRewardMethod(rewards, pick = "random") {
  if (!rewards.length) return null;
  return rewards.some((x) => x.r) ? (pick === "select" ? "select" : "random") : "fixed";
}

// 처음과 달라졌는지(닫을 때 경고·저장 버튼). 개수 입력이 틀린 상태도 "바뀜"으로 본다.
export function questItemsChanged(initial, rows, initialPick, pick) {
  let now;
  try { now = questItemsPayload(rows); } catch { return true; }
  const before = JSON.stringify(initial), after = JSON.stringify(now);
  if (before !== after) return true;
  return now.rewards.some((x) => x.r) && initialPick !== pick;
}
