// sql/077 검사(PGlite): 퀘스트 정보 — 공개 읽기·쓰기 막힘, 목록 검색(이름·NPC·조건 아이템·번호, 지역·레벨), 상세에서 도감 아이템·몬스터·맵·
// 선행/다음 퀘스트 연결, 등록 다시 실행(관리자가 고친 칸 보존), 관리자 수정(권한·버전·범위·이력), 다시 실행해도 안전한지 본다.
// 로컬에 비공개 도구가 만든 실제 등록 SQL(data/local/quest-collect/quests.sql)이 있으면 두 번 적용해 개수도 본다.
process.on("uncaughtException", error => { console.error(error.stack); process.exit(1); });
import fs from "node:fs";
import assert from "node:assert/strict";
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema catalog_import_private;
create table catalog_import_private.completed_migrations(name text primary key);
create table public.catalog_monsters(id uuid primary key default gen_random_uuid(),name text not null,level integer,hp bigint,exp bigint,source_id text unique,image_url text,image_link_monster_id uuid,deleted_at timestamptz);
create table public.catalog_items(id uuid primary key default gen_random_uuid(),name text not null,source_id text unique,image_url text);
alter table public.catalog_monsters enable row level security;create policy catalog_read on public.catalog_monsters for select to anon,authenticated using(deleted_at is null);
alter table public.catalog_items enable row level security;create policy catalog_read on public.catalog_items for select to anon,authenticated using(true);
grant select on public.catalog_monsters,public.catalog_items to anon,authenticated;
create table public.catalog_changes(id bigint generated always as identity primary key,entity_type text not null,entity_id uuid not null,entity_name text not null,operation text not null,changes jsonb not null,release_label text,changed_at timestamptz default now());
create table catalog_import_private.change_backups(change_id bigint primary key,table_name text,old_row jsonb,new_row jsonb);
create table public.catalog_revision(singleton boolean primary key,revision bigint,updated_at timestamptz);insert into public.catalog_revision values(true,1,now());
grant select on public.catalog_revision to anon,authenticated;
create function public.can_review_catalog() returns boolean language sql stable as $$ select coalesce(current_setting('test.reviewer',true),'')='1' $$;
grant execute on function public.can_review_catalog() to anon,authenticated;
insert into public.catalog_monsters(name,level,source_id,image_url) values('달팽이',1,'100100','https://maplestory.io/s'),('지운 몬스터',5,'999',null);
update public.catalog_monsters set deleted_at=now() where source_id='999';
insert into public.catalog_items(name,source_id,image_url) values('달팽이 껍질','4000019','https://maplestory.io/i'),('빨간 포션','2000000',null);`);
await db.exec(fs.readFileSync("sql/076_catalog_maps.sql", "utf8"));
await db.exec(`insert into public.catalog_maps(source_id,name,street_name) values(100000000,'헤네시스','빅토리아로드')`);

const sql = fs.readFileSync("sql/077_catalog_quests.sql", "utf8");
await db.exec(sql);
await db.exec(sql); // 다시 실행해도 안전

// 비공개 도구가 만드는 등록 SQL 과 같은 모양(관리자가 고친 칸은 그대로)
const editable = ["name", "min_level", "max_level", "reward_exp", "reward_meso", "reward_fame"];
const cols = ["source_id", "name", "min_level", "max_level", "jobs", "reward_exp", "reward_meso", "reward_fame", "start_npc", "start_map", "region", "conditions", "reward_method", "reward_items", "prerequisites", "next_quests"];
const lit = v => v === null ? "null" : typeof v === "number" ? String(v) : typeof v === "object" ? `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb` : `'${String(v).replaceAll("'", "''")}'`;
const arr = v => `'{${v.join(",")}}'::integer[]`;
const importQuests = rows => db.exec(`insert into public.catalog_quests(${cols}) values ${rows.map(r => `(${cols.map(c => ["jobs", "prerequisites", "next_quests"].includes(c) ? arr(r[c]) : lit(r[c])).join(",")})`).join(",")}
on conflict(source_id) do update set ${cols.filter(c => c !== "source_id").map(c => editable.includes(c) ? `${c}=case when catalog_quests.source='operator' then catalog_quests.${c} else excluded.${c} end` : `${c}=excluded.${c}`).join(",")}
where (${cols.filter(c => c !== "source_id").map(c => "catalog_quests." + c)}) is distinct from (${cols.filter(c => c !== "source_id").map(c => "excluded." + c)});`);
const base = { min_level: null, max_level: null, jobs: [], reward_exp: null, reward_meso: null, reward_fame: null, start_npc: null, start_map: null, region: null, conditions: [], reward_method: null, reward_items: [], prerequisites: [], next_quests: [] };
const quests = [
  { ...base, source_id: 1000, name: "달팽이 껍질 모으기", min_level: 8, max_level: 30, reward_exp: 300, reward_meso: 1000, start_npc: { id: 1012100, n: "헬레나", v: "gms/62" }, start_map: 100000000, region: "헤네시스",
    conditions: [{ i: "4000019", c: 10, n: "달팽이 껍질(수집 이름)" }, { m: "100100", c: 5, n: "달팽이" }, { m: "999", c: 1, n: "지운 몬스터" }, { i: "4999999", c: 1, n: "도감에 없는 아이템" }],
    reward_method: "select", reward_items: [{ i: "2000000", c: 20, n: "빨간 포션" }], prerequisites: [999], next_quests: [1001] },
  { ...base, source_id: 1001, name: "헬레나의 부탁", min_level: 20, region: "헤네시스", prerequisites: [1000], jobs: [300, 310] },
  { ...base, source_id: 2000, name: "엘나스의 눈", min_level: 50, region: "엘나스", start_npc: { id: 2020000, n: "스카두르" } },
  { ...base, source_id: 3000, name: "레벨 없는 퀘스트" },
];
await importQuests(quests);
await importQuests(quests); // 다시 등록해도 그대로
const count = async () => (await db.query("select count(*)::int n from catalog_quests")).rows[0].n;
assert.equal(await count(), 4);

// 공개 읽기: 비로그인 읽기 가능, 쓰기 막힘
await db.exec("set role anon");
assert.equal((await db.query("select count(*)::int n from catalog_quests")).rows[0].n, 4);
await assert.rejects(db.exec("insert into catalog_quests(source_id,name) values(5,'x')"));
await assert.rejects(db.exec("update catalog_quests set name='x'"));
const search = async (...args) => (await db.query(`select public.catalog_search_quests($1,$2,$3,$4) r`, args)).rows[0].r;
let r = await search("", "", null, 0);
assert.equal(r.total, 4);
assert.deepEqual(r.rows.map(x => x.source_id), [1000, 1001, 2000, 3000], "레벨 낮은 순, 레벨 없는 것은 뒤");
assert.deepEqual(r.regions, { "": 1, "헤네시스": 2, "엘나스": 1 });
assert.equal(r.rows[0].condition_count, 4);
assert.equal(r.rows[0].chain, true);
assert.equal((await search("껍질", "", null, 0)).total, 1, "조건 아이템 이름으로 찾기");
assert.equal((await search("헬 레 나", "", null, 0)).total, 2, "NPC 이름·띄어쓰기 무시");
assert.equal((await search("2000", "", null, 0)).rows[0].source_id, 2000, "번호로 찾기");
assert.equal((await search("", "헤네시스", null, 0)).total, 2);
assert.equal((await search("", "-", null, 0)).total, 1, "지역 없음");
assert.deepEqual((await search("", "", 25, 0)).rows.map(x => x.source_id), [1000, 1001, 3000], "레벨 25에 받을 수 있는 것");
assert.deepEqual((await search("", "", 40, 0)).rows.map(x => x.source_id), [1001, 3000], "최대 레벨 넘으면 빠짐");

const detail = async (id, sid) => (await db.query("select public.catalog_quest_detail($1,$2) d", [id, sid])).rows[0].d;
let d = await detail(null, 1000);
assert.equal(d.quest.name, "달팽이 껍질 모으기");
assert.equal(d.conditions[0].item.name, "달팽이 껍질", "도감 아이템 연결");
assert.equal(d.conditions[1].monster.name, "달팽이", "도감 몬스터 연결");
assert.ok(!d.conditions[2].monster, "지운 몬스터는 연결 안 함");
assert.ok(!d.conditions[3].item && d.conditions[3].n === "도감에 없는 아이템", "도감에 없으면 수집 이름");
assert.equal(d.rewards[0].item.name, "빨간 포션");
assert.equal(d.start_map.name, "헤네시스");
assert.deepEqual(d.prerequisites, [], "표에 없는 선행 퀘스트는 빠짐");
assert.equal(d.next_quests[0].name, "헬레나의 부탁");
assert.equal((await detail(null, 1001)).prerequisites[0].source_id, 1000);
assert.equal(await detail(null, 424242), null);
assert.equal(d.quest.source, "collected");

// 관리자 수정
const save = (...a) => db.query("select public.catalog_quest_edit_save($1,$2,$3,$4,$5,$6,$7,$8) d", a);
await assert.rejects(save(d.quest.id, d.quest.version, "x", 1, 2, 0, 0, 0), /permission denied/); // 비로그인은 실행 권한 없음
await db.exec("reset role; set role authenticated");
await assert.rejects(save(d.quest.id, d.quest.version, "x", 1, 2, 0, 0, 0), /권한/); // 일반 로그인
await db.exec("reset role; set role authenticated; set test.reviewer='1'");
await assert.rejects(save(d.quest.id, "old", "x", 1, 2, 0, 0, 0), /다른 화면/);
await assert.rejects(save(d.quest.id, d.quest.version, " ", 1, 2, 0, 0, 0), /이름/);
await assert.rejects(save(d.quest.id, d.quest.version, "x", 30, 2, 0, 0, 0), /최소 레벨/);
await assert.rejects(save(d.quest.id, d.quest.version, "x", 1, 2, -5, 0, 0), /범위/);
d = (await save(d.quest.id, d.quest.version, "달팽이 껍질 모으기", 10, 30, 350, 1000, null)).rows[0].d;
assert.equal(d.quest.min_level, 10);
assert.equal(d.quest.source, "operator");
d = (await save(d.quest.id, d.quest.version, "달팽이 껍질 모으기", 10, 30, 350, 1000, null)).rows[0].d; // 같은 값은 이력 없음
await db.exec("reset role");
const history = (await db.query("select entity_type,changes from catalog_changes")).rows;
assert.equal(history.length, 1);
assert.deepEqual(history[0], { entity_type: "quest", changes: { min_level: { before: 8, after: 10 }, reward_exp: { before: 300, after: 350 } } });
assert.equal((await db.query("select count(*)::int n from catalog_import_private.change_backups")).rows[0].n, 1);
// 다시 등록해도 관리자가 고친 칸은 그대로, 나머지는 새 값
await importQuests([{ ...quests[0], min_level: 8, reward_exp: 300, region: "헤네시스 새 지역" }]);
const after = (await db.query("select min_level,reward_exp,region,source from catalog_quests where source_id=1000")).rows[0];
assert.deepEqual(after, { min_level: 10, reward_exp: 350, region: "헤네시스 새 지역", source: "operator" });
// 잘못된 값은 표가 거절
await assert.rejects(db.exec("insert into catalog_quests(source_id,name,min_level,max_level) values(9,'x',50,10)"));
await assert.rejects(db.exec("insert into catalog_quests(source_id,name,reward_method) values(9,'x','maybe')"));
await db.exec(sql); // 자료가 있어도 다시 실행 안전
assert.equal(await count(), 4);

// 로컬 실제 등록 SQL(있을 때만): 두 번 적용해도 개수 그대로, 몇 개 연결 확인
const real = "data/local/quest-collect/quests.sql";
if (fs.existsSync(real)) {
  const text = fs.readFileSync(real, "utf8");
  await db.exec(text);
  const n1 = await count();
  await db.exec(text);
  assert.equal(await count(), n1);
  assert.ok(n1 > 1000, `실제 등록 개수 ${n1}`);
  console.log(`  실제 등록 SQL 두 번 적용: 표에 퀘스트 ${n1}개(검사용 4개 포함)`);
}
console.log("quest-catalog-db check 통과");
