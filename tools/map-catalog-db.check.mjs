// sql/076 검사(PGlite): 맵 정보 — 공개 읽기, 우리 몬스터가 나오는 맵만 목록에, 등록 다시 실행·관리자 이름 보존,
// 수집 연결 다시 맞추기(관리자 연결은 그대로), 관리자 수정(권한·버전·이력), 다시 실행해도 안전한지 본다.
process.on("uncaughtException", error => { console.error(error.stack); process.exit(1); });
import fs from "node:fs";
import assert from "node:assert/strict";
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema catalog_import_private;
create table catalog_import_private.completed_migrations(name text primary key);
create table public.catalog_monsters(id uuid primary key default gen_random_uuid(),name text not null,level integer,hp bigint,exp bigint,source_id text unique,image_url text,image_link_monster_id uuid,deleted_at timestamptz);
alter table public.catalog_monsters enable row level security;create policy catalog_read on public.catalog_monsters for select to anon,authenticated using(deleted_at is null);
grant select on public.catalog_monsters to anon,authenticated;
create table public.catalog_changes(id bigint generated always as identity primary key,entity_type text not null,entity_id uuid not null,entity_name text not null,operation text not null,changes jsonb not null,release_label text,changed_at timestamptz default now());
create table catalog_import_private.change_backups(change_id bigint primary key,table_name text,old_row jsonb,new_row jsonb);
create table public.catalog_revision(singleton boolean primary key,revision bigint,updated_at timestamptz);insert into public.catalog_revision values(true,1,now());
grant select on public.catalog_revision to anon,authenticated;
-- 057 의 관리자 판정 대신 시험용 설정값으로 흉내 낸다.
create function public.can_review_catalog() returns boolean language sql stable as $$ select coalesce(current_setting('test.reviewer',true),'')='1' $$;
grant execute on function public.can_review_catalog() to anon,authenticated;
insert into public.catalog_monsters(name,level,hp,exp,source_id) values('달팽이',1,8,3,'100100'),('파란 달팽이',2,15,4,'100101'),('주황버섯',8,80,15,'1210100'),('지운 몬스터',5,1,1,'999');
update public.catalog_monsters set deleted_at=now() where source_id='999';`);

const sql = fs.readFileSync("sql/076_catalog_maps.sql", "utf8");
await db.exec(sql);
await db.exec(sql); // 다시 실행해도 안전

// 비공개 도구가 만드는 등록 SQL 과 같은 모양으로 넣는다.
const importMaps = async rows => db.exec(`insert into public.catalog_maps(source_id,name,street_name,name_en,street_name_en,name_source,in_old_version) values
${rows.map(r => `(${r[0]},'${r[1]}',${r[2] ? `'${r[2]}'` : "null"},'${r[3]}','${r[4]}','${r[5]}',true)`).join(",")}
on conflict(source_id) do update set name_en=excluded.name_en,street_name_en=excluded.street_name_en,in_old_version=excluded.in_old_version,
name=case when catalog_maps.name_source='operator' then catalog_maps.name else excluded.name end,
street_name=case when catalog_maps.name_source='operator' then catalog_maps.street_name else excluded.street_name end,
name_source=case when catalog_maps.name_source='operator' then 'operator' else excluded.name_source end
where (catalog_maps.name_en,catalog_maps.street_name_en,catalog_maps.in_old_version) is distinct from (excluded.name_en,excluded.street_name_en,excluded.in_old_version)
 or (catalog_maps.name_source<>'operator' and (catalog_maps.name,catalog_maps.street_name,catalog_maps.name_source) is distinct from (excluded.name,excluded.street_name,excluded.name_source));`);
const maps = [
  [40000, "달팽이동산", "메이플로드", "Snail Hunting Ground I", "Maple Road", "collected"],
  [104010000, "헤네시스 사냥터 I", "빅토리아로드", "Henesys Hunting Ground I", "Victoria Road", "collected"],
  [101030000, "East Domain of Perion", "Perion", "East Domain of Perion", "Perion", "collected"],
  [100000000, "헤네시스", "빅토리아로드", "Henesys", "Victoria Road", "collected"],
];
await importMaps(maps);
const link = async pairs => {
  await db.exec(`delete from catalog_import_private.map_links_in;insert into catalog_import_private.map_links_in values ${pairs.map(([m, p]) => `('${m}',${p})`).join(",")}`);
  return (await db.query("select catalog_import_private.sync_map_monsters() r")).rows[0].r;
};
assert.deepEqual(await link([["100100", 40000], ["100100", 104010000], ["100101", 104010000], ["1210100", 101030000], ["999", 100000000], ["없는몬스터", 40000], ["100100", 123]]), { added: 5, updated: 0, removed: 0 }, "없는 몬스터·맵은 건너뜀");
assert.deepEqual(await link([["100100", 40000], ["100100", 104010000], ["100101", 104010000], ["1210100", 101030000], ["999", 100000000]]), { added: 0, updated: 0, removed: 0 }, "같은 연결 다시 넣기");
assert.equal((await db.query("select count(*)::int n from catalog_import_private.map_links_in")).rows[0].n, 0, "등록 뒤 비공개 표 비움");

const as = async (role, reviewer, fn) => { await db.exec(`set role ${role};set test.reviewer='${reviewer}'`); try { return await fn(); } finally { await db.exec("reset role"); } };
const search = (args = {}) => as("anon", "0", async () => (await db.query("select public.catalog_search_maps($1,$2,$3) r", [args.q ?? "", args.street ?? "", args.page ?? 0])).rows[0].r);

// 1) 목록: 우리 몬스터(지우지 않은)가 나오는 맵만, 최저 레벨 순.
let list = await search();
assert.deepEqual(list.rows.map(r => r.name), ["달팽이동산", "헤네시스 사냥터 I", "East Domain of Perion"], "지운 몬스터만 나오는 마을은 빠짐");
assert.equal(list.total, 3);
assert.deepEqual(list.rows[1].monsters.map(m => m.name), ["달팽이", "파란 달팽이"], "몬스터 미리보기는 레벨 순");
assert.deepEqual([list.rows[1].monster_count, list.rows[1].min_level, list.rows[1].max_level], [2, 1, 2]);
assert.deepEqual(list.streets, { "메이플로드": 1, "빅토리아로드": 1, "Perion": 1 }, "지역 개수");
assert.deepEqual((await search({ q: "헤네 시스" })).rows.map(r => r.name), ["헤네시스 사냥터 I"], "띄어쓰기 무시");
assert.deepEqual((await search({ q: "주황" })).rows.map(r => r.name), ["East Domain of Perion"], "몬스터 이름으로도 찾음");
assert.deepEqual((await search({ q: "104010000" })).rows.map(r => r.name), ["헤네시스 사냥터 I"], "맵 번호");
assert.deepEqual((await search({ street: "메이플로드" })).rows.map(r => r.name), ["달팽이동산"], "지역으로 좁히기");

// 2) 상세·몬스터의 맵
const detail = await as("anon", "0", async () => (await db.query("select public.catalog_map_detail(null,104010000) r")).rows[0].r);
assert.equal(detail.map.name, "헤네시스 사냥터 I");
assert.deepEqual(detail.monsters.map(m => m.name), ["달팽이", "파란 달팽이"]);
// 대체 그림(070): 칸이 아니라 이어 둔 몬스터(image_link_monster_id)의 그림 주소를 그때 찾는다(운영 실행 때 없는 칸을 써서 실패했던 것 재발 방지).
await db.exec(`update public.catalog_monsters set image_url='https://example.test/snail.png' where source_id='100100';
  update public.catalog_monsters set image_link_monster_id=(select id from public.catalog_monsters where source_id='100100') where source_id='100101'`);
const linked = await as("anon", "0", async () => (await db.query("select public.catalog_map_detail(null,104010000) r")).rows[0].r);
assert.deepEqual(linked.monsters.map(m => m.image_fallback_url), [null, "https://example.test/snail.png"], "상세: 이어 둔 몬스터 그림");
assert.deepEqual((await search({ q: "104010000" })).rows[0].monsters.map(m => m.image_fallback_url), [null, "https://example.test/snail.png"], "목록: 이어 둔 몬스터 그림");
const snail = (await db.query("select id from catalog_monsters where source_id='100100'")).rows[0].id;
const snailMaps = await as("anon", "0", async () => (await db.query("select public.catalog_monster_maps($1) r", [snail])).rows[0].r);
assert.deepEqual(snailMaps.map(m => m.name), ["달팽이동산", "헤네시스 사냥터 I"], "몬스터가 나오는 맵");
assert.equal(await as("anon", "0", async () => (await db.query("select public.catalog_map_detail(null,1) r")).rows[0].r), null, "없는 맵");

// 2-1) 미니맵·포탈·등장 위치: 포탈에 목적지 이름을 붙이고 없는 목적지는 빼며, 지운 몬스터 위치는 숨긴다.
await db.exec(`update public.catalog_maps set minimap='{"cx":530,"cy":1278,"w":2317,"h":1832,"mag":4}',
  portals='[{"n":"east00","x":1625,"y":216,"to":100000000,"tp":"west00","t":2},{"n":"in00","x":958,"y":-851,"to":5,"tp":"st00","t":3}]',
  spawns='[{"m":"100100","x":157,"y":215},{"m":"999","x":1,"y":2},{"m":"없음","x":3,"y":4}]' where source_id=104010000`);
const rich = await as("anon", "0", async () => (await db.query("select public.catalog_map_detail(null,104010000) r")).rows[0].r);
assert.deepEqual(rich.minimap, { cx: 530, cy: 1278, w: 2317, h: 1832, mag: 4 });
assert.deepEqual(rich.portals, [{ n: "east00", x: 1625, y: 216, to: 100000000, tp: "west00", t: 2, to_name: "헤네시스", to_street: "빅토리아로드" }], "목적지 이름, 없는 맵 포탈은 빠짐");
assert.deepEqual(rich.spawns.map(s => [s.x, s.y, s.monster_id]), [[157, 215, snail]], "지운 몬스터·없는 몬스터 위치는 빠짐");
const town = await as("anon", "0", async () => (await db.query("select public.catalog_map_detail(null,100000000) r")).rows[0].r);
assert.deepEqual([town.map.name, town.monsters.length, town.portals, town.minimap], ["헤네시스", 0, [], null], "몬스터 없는 마을도 상세는 열림");
await assert.rejects(db.query(`update public.catalog_maps set portals='{}' where source_id=40000`), /catalog_maps_detail_check/, "포탈은 배열만");
await assert.rejects(db.query(`update public.catalog_maps set minimap='{"w":0,"h":1}' where source_id=40000`), /catalog_maps_detail_check/, "미니맵 크기 0 거절");
// 전체 그림: 버전 필수, 기준점·크기는 넷 다 있거나 하나도 없거나.
await db.exec(`update public.catalog_maps set render='{"v":"gms/62","ox":-655,"oy":-607,"w":2677,"h":1363}' where source_id=104010000;
  update public.catalog_maps set render='{"v":"cms/200"}' where source_id=100000000`);
assert.deepEqual((await as("anon", "0", async () => (await db.query("select public.catalog_map_detail(null,104010000) r")).rows[0].r)).render, { v: "gms/62", ox: -655, oy: -607, w: 2677, h: 1363 });
assert.deepEqual((await as("anon", "0", async () => (await db.query("select public.catalog_map_detail(null,100000000) r")).rows[0].r)).render, { v: "cms/200" }, "기준점 없는 그림");
assert.equal((await search({ q: "104010000" })).rows[0].image_v, "gms/62", "목록 카드 그림 버전");
for (const bad of ['{"v":"x"}', '{"v":"gms/62","w":10}', '{"v":"gms/62","ox":0,"oy":0,"w":0,"h":1}', '{"v":"gms/62\\"><x","w":1,"h":1,"ox":0,"oy":0}', '{"ox":0,"oy":0,"w":1,"h":1}'])
  await assert.rejects(db.query(`update public.catalog_maps set render=$1 where source_id=40000`, [bad]), /catalog_maps_detail_check/, `잘못된 그림 거절 ${bad}`);
// 최대 마릿수: 수집 연결에서 받고, 바뀌면 고치고, 관리자 연결은 그대로.
await db.exec(`delete from catalog_import_private.map_links_in;insert into catalog_import_private.map_links_in values ('100100',40000,12),('100100',104010000,null),('100101',104010000,7),('1210100',101030000,3),('999',100000000,null)`);
assert.deepEqual((await db.query("select catalog_import_private.sync_map_monsters() r")).rows[0].r, { added: 0, updated: 3, removed: 0 }, "마릿수가 바뀐 연결 3개(새 연결 아님)");
assert.deepEqual((await as("anon", "0", async () => (await db.query("select public.catalog_map_detail(null,104010000) r")).rows[0].r)).monsters.map(m => [m.name, m.max_count]), [["달팽이", null], ["파란 달팽이", 7]]);
await assert.rejects(db.query("update public.catalog_map_monsters set max_count=0 where max_count=7"), /max_count_check/, "마릿수 0 거절");

// 3) 쓰기: 비로그인·일반 로그인은 표에 직접 못 쓴다, 수정 함수는 관리자만.
for (const role of ["anon", "authenticated"]) {
  await assert.rejects(as(role, "0", () => db.query("update public.catalog_maps set name='x'")), /permission denied/, `${role} 직접 수정 거절`);
  await assert.rejects(as(role, "0", () => db.query("insert into public.catalog_map_monsters(map_id,monster_id) values(gen_random_uuid(),gen_random_uuid())")), /permission denied/, `${role} 연결 직접 추가 거절`);
}
await assert.rejects(as("anon", "1", () => db.query("select public.catalog_map_edit_save($1,$2,'x',null)", [detail.map.id, detail.map.version])), /permission denied/, "비로그인은 수정 함수 실행 불가");
await assert.rejects(as("authenticated", "0", () => db.query("select public.catalog_map_edit_save($1,$2,'x',null)", [detail.map.id, detail.map.version])), /검토 권한/, "일반 로그인 거절");

// 4) 관리자 수정: 이름 바꾸기 → operator, 이력 1건, 버전 충돌, 빈 이름 거절.
const perion = await as("anon", "0", async () => (await db.query("select public.catalog_map_detail(null,101030000) r")).rows[0].r);
const saved = await as("authenticated", "1", async () => (await db.query("select public.catalog_map_edit_save($1,$2,' 페리온 동쪽 경계 ','페리온') r", [perion.map.id, perion.map.version])).rows[0].r);
assert.deepEqual([saved.map.name, saved.map.street_name, saved.map.name_source], ["페리온 동쪽 경계", "페리온", "operator"]);
const history = (await db.query("select entity_type,changes from catalog_changes")).rows;
assert.equal(history.length, 1);
assert.deepEqual(history[0], { entity_type: "map", changes: { name: { before: "East Domain of Perion", after: "페리온 동쪽 경계" }, street_name: { before: "Perion", after: "페리온" } } });
await assert.rejects(as("authenticated", "1", () => db.query("select public.catalog_map_edit_save($1,$2,'다른 이름',null)", [perion.map.id, perion.map.version])), /다른 화면에서 수정/, "옛 버전으로 저장하면 거절");
await assert.rejects(as("authenticated", "1", () => db.query("select public.catalog_map_edit_save($1,$2,'  ',null)", [perion.map.id, saved.map.version])), /1~200자/, "빈 이름 거절");
await as("authenticated", "1", () => db.query("select public.catalog_map_edit_save($1,$2,'페리온 동쪽 경계','페리온')", [perion.map.id, saved.map.version]));
assert.equal((await db.query("select count(*)::int n from catalog_changes")).rows[0].n, 1, "같은 값 저장은 이력 없음");

// 5) 다시 등록: 관리자가 고친 이름은 그대로, 다른 맵은 새 이름으로.
await importMaps(maps.map(m => m[0] === 40000 ? [40000, "달팽이 동산(새)", "메이플로드", "Snail Hunting Ground I", "Maple Road", "collected"] : m));
assert.deepEqual((await db.query("select source_id,name,name_source from catalog_maps where source_id in (40000,101030000) order by source_id")).rows,
  [{ source_id: 40000, name: "달팽이 동산(새)", name_source: "collected" }, { source_id: 101030000, name: "페리온 동쪽 경계", name_source: "operator" }]);

// 6) 수집 연결 다시 맞추기: 빠진 수집 연결은 지우고, 관리자 연결은 남긴다.
const henesys = (await db.query("select id from catalog_maps where source_id=100000000")).rows[0].id;
await db.query("insert into catalog_map_monsters(map_id,monster_id,source) values($1,$2,'operator')", [henesys, snail]);
assert.deepEqual(await link([["100100", 40000], ["100101", 104010000]]), { added: 0, updated: 2, removed: 3 }, "빠진 수집 연결 3개 지움(남은 연결은 마릿수 없음으로)");
assert.deepEqual((await db.query("select m.source_id,c.source from catalog_map_monsters c join catalog_maps m on m.id=c.map_id order by 1")).rows,
  [{ source_id: 40000, source: "collected" }, { source_id: 100000000, source: "operator" }, { source_id: 104010000, source: "collected" }], "관리자 연결 유지");

await db.exec(sql); // 자료가 있을 때 다시 실행
assert.equal((await db.query("select count(*)::int n from catalog_maps")).rows[0].n, 4, "다시 실행해도 맵 유지");
assert.equal((await db.query("select name from catalog_maps where source_id=101030000")).rows[0].name, "페리온 동쪽 경계");
console.log("map-catalog(sql/076): 공개 목록·검색·지역·상세·몬스터의 맵, 직접 쓰기 거절, 관리자 수정·버전·이력, 다시 등록·연결 맞추기·재실행 통과");
