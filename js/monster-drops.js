// 사용자 입력 규칙: 띄어쓰기는 별도 아이템 구분자입니다. 반복 아이템은 합치지 않습니다.
export function splitMonsterDrops(value) {
  const text = String(value ?? '').trim();
  if (!text || /^(?:x|-|없음)$/i.test(text)) return [];
  return text.split(/[\s,·/]+/u).filter(Boolean);
}
export function normalizeMonsterDrops(value) {
  return splitMonsterDrops(value).join(', ') || null;
}
