// 몬스터·아이템 검색용 페이지 생성기(tools/build_catalog_pages.py) 검사. 고정 자료로 임시 폴더에 만들어 본다.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "ym-catalog-pages-"));
const img = (id) => `https://maplestory.io/api/gms/100/mob/${id}/render/stand?bgColor=`;

try {
  mkdirSync(join(out, "monsters"), { recursive: true });
  writeFileSync(join(out, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://yourmaple.kr/</loc></url>\n  <url><loc>https://yourmaple.kr/monsters/</loc></url>\n  <url><loc>https://yourmaple.kr/monsters/old/</loc></url>\n</urlset>\n`);
  writeFileSync(join(out, "monsters", "index.html"), "<main><!-- monster-list --><nav class=\"feature-nav\"></nav></main>");
  const fixture = {
    monsters: [
      { id: "m1", name: "달팽이", level: 1, hp: 8, exp: 3, mp: 0, required_accuracy: 0, weak_elements: "", resist_elements: "", image_url: img(100100), source_id: "100100" },
      { id: "m2", name: "<스크립트>&\"", level: 10, hp: 1500, exp: 20, image_url: null, source_id: "200", image_link_monster_id: "m1" },
      { id: "m3", name: "번호 없음", level: null, hp: null, exp: null, image_url: "http://bad/", source_id: null },
      { id: "m4", name: "같은 번호", level: 5, source_id: "100100" },
      { id: "m5", name: "이상한 번호", level: 5, source_id: "../x" },
    ],
    drops: [
      { monster_id: "m1", item_id: "i1", rate_percent: 0.5, source_entry: 1 },
      { monster_id: "m1", item_id: "i2", rate_percent: 12.25, source_entry: 2 },
      { monster_id: "m1", item_id: "i9", rate_percent: null, source_entry: 3 },
    ],
    items: [
      { id: "i1", name: "달팽이 껍질", category: "Etc", source_id: "4000019", image_url: "https://maplestory.io/api/gms/100/item/4000019/icon" },
      { id: "i2", name: "빨간 포션", category: "Use", source_id: "2000000", description: "HP를 50 회복한다." },
      { id: "i3", name: "<아대>", category: "Equip", subcategory: "아대", required_level: 70, source_id: "1472000" },
      { id: "i4", name: "번호 겹침", category: "Etc", source_id: "4000019" },
    ],
  };
  const fixturePath = join(out, "fixture.json");
  writeFileSync(fixturePath, JSON.stringify(fixture));
  const run = spawnSync("python3", ["tools/build_catalog_pages.py", out, "--fixture", fixturePath], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /몬스터 페이지 3개 · 아이템 페이지 3개/);

  // 1) 주소는 몬스터 번호, 번호가 없으면 id. 같은 번호·이상한 번호는 건너뛴다.
  const snail = readFileSync(join(out, "monsters", "100100", "index.html"), "utf8");
  assert.ok(existsSync(join(out, "monsters", "200", "index.html")));
  assert.ok(existsSync(join(out, "monsters", "m3", "index.html")));
  assert.ok(!snail.includes("같은 번호"), "같은 번호 몬스터가 덮어쓰면 안 된다");
  assert.ok(!existsSync(join(out, "x")) && !existsSync(join(out, "monsters", "..", "x")));

  // 2) 제목·주소·드랍 순서(확률 높은 순, 모르는 확률은 맨 뒤)·그림 순서
  assert.match(snail, /<title>메랜 달팽이 — 드랍 아이템/);
  assert.match(snail, /<link rel="canonical" href="https:\/\/yourmaple\.kr\/monsters\/100100\/"/);
  const order = ["빨간 포션", "달팽이 껍질", "아이템 정보 없음"].map((name) => snail.indexOf(name));
  assert.ok(order.every((at) => at > 0) && order[0] < order[1] && order[1] < order[2], "드랍 순서");
  assert.match(snail, /12\.25%/);
  assert.match(snail, /확률 미상/);
  assert.match(snail, /render\/move\?bgColor=/);
  assert.match(snail, /<div id="app">/);
  assert.match(snail, /<script type="module" src=".\/js\/main.js"><\/script>/);
  assert.match(snail, /href=".\/css\/styles.css" data-app-style disabled/);
  assert.match(snail, /data-alts="[^"]*render\/fly[^"]*render\/stand[^"]*render\/die1/);

  // 3) 이름은 이스케이프, 그림이 없으면 이어 둔 몬스터 그림
  const odd = readFileSync(join(out, "monsters", "200", "index.html"), "utf8");
  assert.ok(!odd.includes("<스크립트>") && odd.includes("&lt;스크립트&gt;&amp;"), "이름 이스케이프");
  assert.match(odd, /mob\/100100\/render\/move/);
  assert.match(odd, /등록된 드랍 정보가 없어요/);
  assert.ok(!odd.includes("아이템를"));
  const noNumber = readFileSync(join(out, "monsters", "m3", "index.html"), "utf8");
  assert.ok(!noNumber.includes("http://bad/"), "https 가 아닌 그림 주소는 쓰지 않는다");

  // 3-1) 아이템 페이지: 번호 주소·드랍 몬스터 링크·설명·이스케이프, 몬스터 페이지의 드랍 링크도 번호 주소
  const shell = readFileSync(join(out, "items", "4000019", "index.html"), "utf8");
  assert.match(shell, /<title>메랜 달팽이 껍질 — 드랍 몬스터/);
  assert.match(shell, /<link rel="canonical" href="https:\/\/yourmaple\.kr\/items\/4000019\/"/);
  assert.match(shell, /href="\/monsters\/100100\/">달팽이 <small>Lv\.1<\/small><\/a><span>0\.5%<\/span>/);
  assert.match(shell, /<script type="module" src=".\/js\/main.js"><\/script>/);
  assert.ok(!shell.includes("번호 겹침"));
  const potion = readFileSync(join(out, "items", "2000000", "index.html"), "utf8");
  assert.match(potion, /HP를 50 회복한다\./);
  assert.match(potion, /소비/);
  const claw = readFileSync(join(out, "items", "1472000", "index.html"), "utf8");
  assert.ok(!claw.includes("<아대>") && claw.includes("&lt;아대&gt;"));
  assert.match(claw, /등록된 드랍 몬스터가 없어요/);
  assert.match(snail, /href="\/items\/2000000\/">빨간 포션/);
  assert.match(snail, /href="\/items\/">아이템 정보 없음/);

  // 4) 사이트맵: 예전 몬스터 주소는 지우고 새 주소만, 기본 주소는 유지
  const sitemap = readFileSync(join(out, "sitemap.xml"), "utf8");
  assert.ok(!sitemap.includes("/monsters/old/"));
  assert.ok(sitemap.includes("<loc>https://yourmaple.kr/monsters/</loc>"));
  assert.equal((sitemap.match(/\/monsters\/[^<]+\/<\/loc>/g) || []).length, 3);
  assert.equal((sitemap.match(/\/items\/[^<]+\/<\/loc>/g) || []).length, 3);

  // 5) 소개 페이지 목록
  const intro = readFileSync(join(out, "monsters", "index.html"), "utf8");
  assert.ok(!intro.includes("<!-- monster-list -->"));
  assert.match(intro, /메랜 몬스터 전체 목록 \(3마리\)/);
  assert.equal((intro.match(/href="\/monsters\/[^"]+\/"/g) || []).length, 3);

  // 6) 몬스터가 없으면 배포를 멈춘다
  writeFileSync(fixturePath, JSON.stringify({ monsters: [], drops: [], items: [] }));
  const empty = spawnSync("python3", ["tools/build_catalog_pages.py", join(out, "empty"), "--fixture", fixturePath], { cwd: root, encoding: "utf8" });
  assert.notEqual(empty.status, 0);
  console.log("catalog-pages check 통과");
} finally {
  rmSync(out, { recursive: true, force: true });
}
