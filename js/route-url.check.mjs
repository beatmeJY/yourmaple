import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { legacyRoute, routeFromPath, routePath } from "./route-url.js";

for (const id of ["dashboard", "dojo", "level-plan", "item-catalog", "trades", "transport"]) {
  const path = routePath(id);
  assert.equal(routeFromPath(path), id);
  assert.ok(existsSync(new URL(`..${path}index.html`, import.meta.url)), path);
}
const origin = "https://yourmaple.kr";
assert.equal(legacyRoute(new URL("/#/dojo/", origin)).href, "/dojo/");
assert.equal(legacyRoute(new URL("/#/items", origin)).href, "/trades/");
assert.equal(legacyRoute(new URL("/?mock=guest#/item-catalog?id=abc", origin)).href, "/items/?mock=guest&id=abc");
assert.equal(legacyRoute(new URL("/#access_token=value", origin)), null);
console.log("경로 변환과 직접 접속 파일 검증 통과");
