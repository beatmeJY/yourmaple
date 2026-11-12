// 공개 소개 주소를 실제 화면 주소로 함께 쓴다.
const paths = { dashboard: "/", "level-plan": "/level-up/", "item-catalog": "/items/" };
const ids = Object.fromEntries(Object.entries(paths).map(([id, path]) => [path, id]));

export function routePath(id) {
  return Object.hasOwn(paths, id) ? paths[id] : `/${id}/`;
}

export function routeFromPath(pathname) {
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
