// sql/075 검사(PGlite): 아이템 도감 분류(종류·직업 5개·부위)가 js/equipment-groups.js 규칙과 같은지,
// 예전처럼 (검색어, 쪽)만 넘기면 054 와 같은 결과인지, 개수(kinds·jobs·parts)가 맞는지, 다시 실행해도 안전한지 본다.
// CATEGORIES_JSON=<{items,jobs} 공개 도감 JSON>을 주면 그 자료 전부로 비교한다(로컬 전용).
process.on("uncaughtException", error => { console.error(error.stack); process.exit(1); });
import fs from "node:fs";
import assert from "node:assert/strict";
import { itemFilterMatch, itemKindKey, itemPart, equipmentJobs } from "../js/equipment-groups.js";
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema catalog_import_private;
create table catalog_import_private.completed_migrations(name text primary key);
create table public.catalog_items(id uuid primary key default gen_random_uuid(),name text not null,category text not null,middle_category text,subcategory text,required_level integer,image_url text,source_id text);
create table public.catalog_item_jobs(item_id uuid references public.catalog_items(id),job_name text,primary key(item_id,job_name));
create table public.catalog_revision(singleton boolean primary key,revision bigint);insert into public.catalog_revision values(true,7);`);

// 예시: 직업별·공용·두 직업·부위 별칭·장비 아닌 것.
const sample = [
  ["전사 모자", "방어구", "방어구", "Hat", 10, ["전사"]],
  ["마법사 모자", "방어구", "방어구", "Hat", 20, ["마법사"]],
  ["공용 신발", "방어구", "방어구", "Shoes", 5, ["공용"]],
  ["도적 전사 장갑", "방어구", "방어구", "Glove", 30, ["도적", "전사"]],
  ["폴암 하나", "장비", "두손무기", "Pole Arm", 40, ["전사"]],
  ["폴암 둘", "Equip", "Two-Handed Weapon", "Polearm", 50, ["전사"]],
  ["아대", "장비", "한손무기", "Claw", 30, ["도적"]],
  ["너클", "장비", "한손무기", "Knuckle", 30, ["해적"]],
  ["빨간 포션", "소비", null, null, 0, []],
  ["혼돈의 주문서 60%", "Use", null, null, 0, []],
  ["달팽이 껍질", "Etc", null, null, 0, []],
  ["의자", "설치", null, null, 0, []],
];
const real = process.env.CATEGORIES_JSON ? JSON.parse(fs.readFileSync(process.env.CATEGORIES_JSON, "utf8")) : null;
const items = [];
if (real) {
  const jobsBy = new Map();
  for (const j of real.jobs) jobsBy.set(j.item_id, [...(jobsBy.get(j.item_id) ?? []), j.job_name]);
  for (const r of real.items) items.push({ ...r, jobs: jobsBy.get(r.id) ?? [] });
} else {
  for (const [name, category, middle, sub, level, jobs] of sample) items.push({ id: crypto.randomUUID(), name, category, middle_category: middle, subcategory: sub, required_level: level, jobs, source_id: String(items.length + 1) });
}
for (const it of items) {
  await db.query("insert into public.catalog_items(id,name,category,middle_category,subcategory,required_level,source_id) values($1,$2,$3,$4,$5,$6,$7)", [it.id, it.name, it.category, it.middle_category, it.subcategory, it.required_level, it.source_id]);
  for (const job of it.jobs) await db.query("insert into public.catalog_item_jobs values($1,$2)", [it.id, job]);
}

// 054 의 예전 함수로 기준 결과를 만든다.
await db.exec(fs.readFileSync("sql/054_catalog_item_fuzzy_search.sql", "utf8"));
const call = async (args) => (await db.query(`select public.catalog_search_items(${Object.keys(args).map((k, i) => `${k}=>$${i + 1}`).join(",")}) r`, Object.values(args))).rows[0].r;
const queries = ["", "모자", "폴암", "혼줌", "Hat"];
const before = {};
for (const query of queries) for (const page of [0, 1]) before[`${query}/${page}`] = await call({ p_query: query, p_page: page });

const sql = fs.readFileSync("sql/075_catalog_item_categories.sql", "utf8");
await db.exec(sql);
await db.exec(sql); // 다시 실행해도 안전

// 1) 두 인자 호출은 054 와 같다(행·총개수).
for (const query of queries) for (const page of [0, 1]) {
  const after = await call({ p_query: query, p_page: page });
  assert.deepEqual(after.rows, before[`${query}/${page}`].rows, `${query} ${page}쪽 행`);
  assert.equal(after.total, before[`${query}/${page}`].total, `${query} 총개수`);
}

// 2) 분류 결과가 JS 규칙과 같다(전체 개수 기준으로 모든 쪽을 모아 비교).
const all = async (args) => {
  const first = await call({ ...args, p_page: 0 });
  const rows = [...first.rows];
  for (let page = 1; page * 24 < first.total; page++) rows.push(...(await call({ ...args, p_page: page })).rows);
  return { ...first, rows };
};
const parts = [...new Set(items.map(i => itemPart(i.subcategory)).filter(Boolean))];
const cases = [{}, { p_kind: "equip" }, { p_kind: "use" }, { p_kind: "etc" }, { p_kind: "setup" }];
for (const job of equipmentJobs.map(j => j.key)) { cases.push({ p_job: job }, { p_job: job, p_common: false }); }
for (const part of parts.slice(0, real ? 40 : 10)) cases.push({ p_part: part }, { p_job: "전사", p_part: part });
for (const args of cases) {
  const { p_kind = "", p_job = "", p_part = "", p_common = true } = args;
  const result = await all({ p_query: "", p_kind, p_job, p_part, p_common });
  const expected = items.filter(i => itemFilterMatch(i, i.jobs, { kind: p_kind, job: p_job, part: p_part, common: p_common }));
  assert.equal(result.total, expected.length, `${JSON.stringify(args)} 개수`);
  assert.deepEqual(new Set(result.rows.map(r => r.id)), new Set(expected.map(i => i.id)), `${JSON.stringify(args)} 아이템`);
  // 칩 옆 숫자
  const kindCount = {}; for (const i of items) { const k = itemKindKey(i.category); kindCount[k] = (kindCount[k] ?? 0) + 1; }
  assert.deepEqual(result.kinds, kindCount, "종류 개수");
  const kind = p_kind || (p_job || p_part ? "equip" : "");
  const byKind = items.filter(i => itemFilterMatch(i, [], { kind }));
  for (const job of equipmentJobs.map(j => j.key)) {
    const n = byKind.filter(i => itemKindKey(i.category) === "equip" && (i.jobs.includes(job) || (p_common && i.jobs.includes("공용")))).length;
    assert.equal(result.jobs[job] ?? 0, n, `${job} 개수`);
  }
  const byJob = byKind.filter(i => itemFilterMatch(i, i.jobs, { kind, job: p_job, common: p_common }));
  const partCount = {}; for (const i of byJob) { const p = itemKindKey(i.category) === "equip" ? itemPart(i.subcategory) : null; if (p) partCount[p] = (partCount[p] ?? 0) + 1; }
  assert.deepEqual(result.parts, partCount, `${JSON.stringify(args)} 부위 개수`);
}

// 3) 예시 자료 세부 규칙
if (!real) {
  const names = async (args) => (await all({ p_query: "", ...args })).rows.map(r => r.name).sort();
  assert.deepEqual(await names({ p_job: "전사" }), ["공용 신발", "도적 전사 장갑", "전사 모자", "폴암 둘", "폴암 하나"].sort(), "전사: 공용·두 직업 장비 포함");
  assert.deepEqual(await names({ p_job: "전사", p_common: false }), ["도적 전사 장갑", "전사 모자", "폴암 둘", "폴암 하나"].sort(), "공용 빼기");
  assert.deepEqual(await names({ p_part: "Polearm" }), ["폴암 둘", "폴암 하나"], "Pole Arm 과 Polearm 은 한 부위");
  assert.deepEqual(await names({ p_kind: "use" }), ["빨간 포션", "혼돈의 주문서 60%"], "소비는 소비·Use");
  assert.deepEqual(await names({ p_query: "모자", p_job: "마법사", p_common: false }), ["마법사 모자"], "검색어와 직업 함께");
  assert.equal((await call({ p_query: "", p_page: 0, p_job: "해적" })).common, 1, "공용 장비 수");
}

// 4) 권한: 비로그인도 실행할 수 있다.
const grants = (await db.query("select grantee from information_schema.routine_privileges where routine_name='catalog_search_items' and grantee in ('anon','authenticated')")).rows.map(r => r.grantee).sort();
assert.deepEqual(grants, ["anon", "authenticated"], "비로그인 검색 권한");
assert.equal((await db.query("select count(*)::int n from pg_proc where proname='catalog_search_items'")).rows[0].n, 1, "검색 함수는 하나만");

console.log(`item-categories(sql/075): ${real ? `공개 자료 ${items.length}개` : `예시 ${items.length}개`}, 경우 ${cases.length}개 — 054 호환·분류·개수·재실행·권한 통과`);
