import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { itemSlugFromPath, legacyRoute, monsterSlugFromPath, routeFromPath, routePath } from "./route-url.js";

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
// 몬스터 하나를 고른 주소는 몬스터 도감 화면이고 번호를 읽는다. 그냥 /monsters/ 는 번호 없음.
assert.equal(routeFromPath("/monsters/100100/"), "monsters");
assert.equal(routeFromPath("/monsters/100100"), "monsters");
assert.equal(monsterSlugFromPath("/monsters/100100/"), "100100");
assert.equal(routeFromPath("/monsters/"), "monsters");
assert.equal(monsterSlugFromPath("/monsters/"), "");
assert.equal(monsterSlugFromPath("/monsters/a/b/"), "");
assert.equal(monsterSlugFromPath("/monster-park/"), "");
assert.equal(routeFromPath("/monster-trash/"), "monster-trash");
assert.equal(routeFromPath("/items/1302000/"), "item-catalog");
assert.equal(itemSlugFromPath("/items/1302000/"), "1302000");
assert.equal(itemSlugFromPath("/items/"), "");
assert.equal(routeFromPath("/items/"), "item-catalog");
assert.ok(existsSync(new URL("../404.html", import.meta.url)), "없는 주소용 404.html");
console.log("경로 변환과 직접 접속 파일 검증 통과");
