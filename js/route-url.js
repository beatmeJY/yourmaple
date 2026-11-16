// 공개 소개 주소를 실제 화면 주소로 함께 쓴다.
const paths = { dashboard: "/", "level-plan": "/level-up/", "item-catalog": "/items/" };
const ids = Object.fromEntries(Object.entries(paths).map(([id, path]) => [path, id]));

// 몬스터·아이템 하나를 고른 주소 /monsters/<몬스터 번호>/ · /items/<아이템 번호>/ 도 각 도감 화면이다(2026-11-16 사용자 요청).
const monsterPath = /^\/monsters\/([0-9A-Za-z-]+)\/?$/;
const itemPath = /^\/items\/([0-9A-Za-z-]+)\/?$/;

export function monsterSlugFromPath(pathname) {
  return pathname.match(monsterPath)?.[1] ?? "";
}

export function itemSlugFromPath(pathname) {
  return pathname.match(itemPath)?.[1] ?? "";
}

export function routePath(id) {
  return Object.hasOwn(paths, id) ? paths[id] : `/${id}/`;
}

export function routeFromPath(pathname) {
  if (monsterPath.test(pathname)) return "monsters";
  if (itemPath.test(pathname)) return "item-catalog";
  const path = pathname.replace(/\/+$/, "") + "/";
  return ids[path] ?? path.slice(1, -1);
}

export function legacyRoute(location) {
  const match = location.hash.match(/^#\/?([a-z][a-z0-9-]*)\/?(?:\?(.*))?$/);
  if (!match) return null;
  const id = match[1] === "items" ? "trades" : match[1];
  const params = new URLSearchParams(location.search);
  for (const [key, value] of new URLSearchParams(match[2])) params.set(key, value);
  const query = params.toString();
  return { id, href: routePath(id) + (query ? `?${query}` : "") };
}
