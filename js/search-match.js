// 아이템 이름 검색 규칙(2026-10-30 사용자 요청). 서버 함수(sql/054 catalog_search_items)와 같은 규칙이다.
// - 띄어쓰기는 무시하고 대소문자를 구분하지 않는다.
// - 이름에 그대로 들어 있으면 0, 적은 글자가 이름에 순서대로만 들어 있으면 1(예: "혼주문" → "혼돈의 주문서 60%"), 아니면 null.
// - 별명은 검색어 안의 별명을 본래 이름으로 바꾼 것도 함께 찾는다(예: "혼줌" → "혼돈의주문서").

// 서버의 catalog_search_aliases 기본값과 같다. 별명·본래 이름 모두 띄어쓰기 없는 소문자.
export const SEARCH_ALIASES = [{ alias: "혼줌", target: "혼돈의주문서" }];

export function normalizeSearch(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, "");
}

function isSubsequence(name, query) {
  let at = 0;
  for (const char of name) {
    if (char === query[at]) at += 1;
    if (at === query.length) return true;
  }
  return at === query.length;
}

export function searchVariants(query, aliases = SEARCH_ALIASES) {
  const norm = normalizeSearch(query);
  if (!norm) return [];
  const variants = new Set([norm]);
  for (const { alias, target } of aliases) if (norm.includes(alias)) variants.add(norm.replace(alias, target));
  return [...variants];
}

// 가장 잘 맞는 순위(0 그대로 들어 있음, 1 글자 순서만 맞음) 또는 null
export function nameMatchRank(name, query, aliases = SEARCH_ALIASES) {
  const target = [...normalizeSearch(name)];
  let best = null;
  for (const variant of searchVariants(query, aliases)) {
    const chars = [...variant];
    if (normalizeSearch(name).includes(variant)) return 0;
    if (isSubsequence(target, chars)) best = 1;
  }
  return best;
}
