// 몬스터 그림 점검(도감 관리자 전용, 2026-11-16 사용자 요청).
// 그림이 안 나오는 몬스터를 찾고, 이름이 같은 다른 몬스터의 그림을 후보로 보여 준다.
// 예: "스티지(월묘)" → 괄호를 뗀 "스티지"의 그림.

// 괄호 꼬리표를 뗀 기본 이름: "스티지(월묘)" → "스티지", "주니어 발록 (보스)" → "주니어 발록"
export function baseMonsterName(name) {
  const text = String(name ?? "").trim();
  const base = text.replace(/\s*[(（[][^()（）[\]]*[)）\]]\s*$/u, "").trim();
  return base || text;
}

const squash = (text) => String(text ?? "").replace(/\s+/g, "").toLowerCase();

// row 에 연결할 만한 그림 후보: 이름이 같은 몬스터 먼저, 그다음 기본 이름이 들어간 몬스터.
// working(id → true) 는 실제로 그림을 불러온 몬스터만 담는다. 같은 그림 주소는 한 번만 보여 준다.
export function imageCandidates(row, rows, working, limit = 4) {
  const base = squash(baseMonsterName(row.name));
  if (!base) return [];
  const scored = [];
  for (const other of rows) {
    if (other.id === row.id || !other.image_url || !working.has(other.id)) continue;
    if (other.image_url === row.image_url) continue;
    const otherBase = squash(baseMonsterName(other.name));
    const rank = otherBase === base ? 0 : otherBase.includes(base) || base.includes(otherBase) ? 1 : null;
    if (rank == null || otherBase.length < 2) continue;
    scored.push({ other, rank, gap: Math.abs((other.level ?? 0) - (row.level ?? 0)) });
  }
  scored.sort((a, b) => a.rank - b.rank || a.gap - b.gap || String(a.other.name).localeCompare(String(b.other.name), "ko"));
  const seen = new Set();
  const result = [];
  for (const { other } of scored) {
    if (seen.has(other.image_url)) continue;
    seen.add(other.image_url);
    result.push(other);
    if (result.length >= limit) break;
  }
  return result;
}

// ── 원본 그림 API(maplestory.io) 확인 ──
// 저장된 그림 주소 "https://maplestory.io/api/gms/100/mob/9300063/render/stand?bgColor=" 에서
// 지역·버전 앞부분과 동작(stand)을 읽는다. 다른 주소면 기본(gms/100)으로 조회한다.
const API_DEFAULT = "https://maplestory.io/api/gms/100/";
export function apiParts(imageUrl, sourceId) {
  const match = /^(https:\/\/maplestory\.io\/api\/[^/]+\/[^/]+\/)mob\/(\d+)\/render\/([^/?#]+)/.exec(String(imageUrl ?? ""));
  return { base: match?.[1] ?? API_DEFAULT, id: match?.[2] ?? String(sourceId ?? ""), action: match?.[3] ?? null };
}
export function apiInfoUrl(parts) { return `${parts.base}mob/${encodeURIComponent(parts.id)}`; }
export function apiRenderUrl(parts, action) { return `${parts.base}mob/${encodeURIComponent(parts.id)}/render/${encodeURIComponent(action)}?bgColor=`; }

// 몬스터 그림에 쓸 동작: 도감 화면과 같은 순서(move → fly → stand → die1) → 그 밖의 동작(맞기·공격 제외)
export function pickAction(framebooks) {
  const names = Object.keys(framebooks ?? {});
  for (const want of ["move", "fly", "stand", "die1"]) if (names.includes(want)) return want;
  return names.find((name) => !/^(die|hit|attack|skill|regen|chase)/i.test(name)) ?? names[0] ?? null;
}

// 원본 API 응답(status, json)과 저장된 주소로 원인을 정리한다.
export function diagnose(parts, status, info) {
  if (status === 404) return { kind: "missing", text: "원본 API에도 이 몬스터가 없어요. 다른 몬스터 그림을 이어 두세요." };
  if (status !== 200 || !info) return { kind: "error", text: `원본 API가 응답하지 않았어요(${status || "연결 실패"}). 잠시 뒤 다시 확인해 주세요.` };
  const actions = Object.keys(info.framebooks ?? {});
  const action = pickAction(info.framebooks);
  if (!action) return { kind: "noimage", actions, text: "원본 API에 그림 동작이 없어요. 다른 몬스터 그림을 이어 두세요." };
  if (parts.action && !actions.includes(parts.action)) {
    return { kind: "wrong-action", actions, action, text: `저장된 주소는 "${parts.action}" 동작인데 원본 API에는 없어요. "${action}" 그림이 있어요.` };
  }
  return { kind: "ok", actions, action, text: parts.action ? "원본 API에 저장된 동작이 있어요. 그림 서버가 잠깐 실패했을 수 있어요." : `원본 API에 "${action}" 그림이 있어요.` };
}
