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
const editable = ["name", "min_level", "max_level", "reward_exp", "reward_meso", "reward_fame", "conditions", "reward_method", "reward_items"];
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
// 079: 퀘스트 삭제(숨김·되살리기)·조건/보상 수정
await db.exec("reset role");
const sql079 = fs.readFileSync("sql/079_catalog_quest_items_delete.sql", "utf8");
await db.exec(sql079);
await db.exec(sql079); // 다시 실행해도 안전
const id1001 = (await db.query("select id from catalog_quests where source_id=1001")).rows[0].id;
const setDeleted = (...a) => db.query("select public.catalog_quest_set_deleted($1,$2,$3) r", a);
await db.exec("set role anon");
await assert.rejects(setDeleted(id1001, true, null), /permission denied/);
await db.exec("reset role; set role authenticated; set test.reviewer=''");
await assert.rejects(setDeleted(id1001, true, null), /권한/);
await assert.rejects(db.query("select public.catalog_quest_deleted_list()"), /권한/);
await db.exec("set test.reviewer='1'");
const del = (await setDeleted(id1001, true, " 메이플랜드에 없음 ")).rows[0].r;
assert.ok(del.deleted_at && del.deleted_reason === "메이플랜드에 없음");
await setDeleted(id1001, true, "두 번째"); // 이미 지운 것은 그대로(이력 추가 없음)
const trash = (await db.query("select public.catalog_quest_deleted_list() r")).rows[0].r;
assert.deepEqual(trash.map(x => [x.source_id, x.deleted_reason]), [[1001, "메이플랜드에 없음"]]);
await db.exec("reset role; set role anon");
assert.equal((await search("", "", null, 0)).total, (await db.query("select count(*)::int n from catalog_quests")).rows[0].n, "anon 개수와 검색 개수 같음");
assert.ok(!(await search("", "", null, 0)).rows.some(x => x.source_id === 1001), "지운 퀘스트는 목록에서 빠짐");
assert.equal(await detail(null, 1001), null, "지운 퀘스트 상세 없음");
assert.deepEqual((await detail(null, 1000)).next_quests, [], "다른 퀘스트의 다음 퀘스트에서도 빠짐");
await db.exec("reset role");
await importQuests(quests); // 다시 등록해도 삭제 표시는 그대로
assert.ok((await db.query("select deleted_at from catalog_quests where source_id=1001")).rows[0].deleted_at);
await db.exec("set role authenticated; set test.reviewer='1'");
assert.equal((await setDeleted(id1001, false, "무시")).rows[0].r.deleted_at, null);
await db.exec("reset role; set role anon");
assert.equal((await detail(null, 1000)).next_quests[0].source_id, 1001, "되살리면 연결도 돌아옴");
await db.exec("reset role");
const delHistory = (await db.query("select changes,release_label from catalog_changes where entity_id=$1 order by id", [id1001])).rows;
assert.deepEqual(delHistory.map(x => x.release_label), ["운영자 퀘스트 삭제", "운영자 퀘스트 복구"]);
assert.deepEqual(delHistory[0].changes, { deleted: { before: false, after: true }, deleted_reason: { before: null, after: "메이플랜드에 없음" } });

// 조건·보상 저장
await db.exec("set role authenticated; set test.reviewer='1'");
let q2000 = (await detail(null, 2000)).quest;
const itemsSave = (id, version, conds, rewards, pick) => db.query("select public.catalog_quest_items_save($1,$2,$3,$4,$5) d", [id, version, JSON.stringify(conds), JSON.stringify(rewards), pick]);
const bad = async (conds, rewards, pattern, pick = "random") => assert.rejects(itemsSave(q2000.id, q2000.version, conds, rewards, pick), pattern);
await bad([{ i: "1", c: 0 }], [], /개수/);
await bad([{ i: "1", c: 1.5 }], [], /개수/);
await bad([{ i: "1", c: "3" }], [], /숫자/);
await bad([{ i: "1", m: "2", c: 1 }], [], /하나/);
await bad([{ i: "abc", c: 1 }], [], /번호/);
await bad([], [{ m: "100100", c: 1 }], /아이템만/);
await bad([], [{ i: "1", c: 1 }], /방식/, "maybe");
await bad(Array.from({ length: 101 }, (_, k) => ({ i: String(k + 1), c: 1 })), [], /100개/);
await assert.rejects(itemsSave(q2000.id, "old", [], [], "random"), /다른 화면/);
d = (await itemsSave(q2000.id, q2000.version,
  [{ m: "100100", c: 3, n: "달팽이", junk: 1 }],
  [{ i: "2000000", c: 5, n: "빨간 포션", r: 1 }, { i: "4000019", c: 1, n: "껍질", r: 1, j: 1 }, { i: "4999999", c: 2, n: "없는 아이템", v: "bad version" }], "select")).rows[0].d;
assert.equal(d.quest.reward_method, "select");
assert.equal(d.quest.source, "operator");
assert.deepEqual(d.quest.conditions, [{ m: "100100", c: 3, n: "달팽이" }], "모르는 칸은 버림");
assert.deepEqual(d.quest.reward_items, [{ i: "2000000", c: 5, n: "빨간 포션", r: 1 }, { i: "4000019", c: 1, n: "껍질", r: 1, j: 1 }, { i: "4999999", c: 2, n: "없는 아이템" }], "틀린 그림 버전은 버림");
assert.equal(d.conditions[0].monster.name, "달팽이");
assert.equal(d.rewards[0].item.name, "빨간 포션");
// 같은 값으로 다시 저장하면 이력 없음, 그중 하나를 모두 빼면 fixed, 보상이 없으면 null
// 이력 표는 검사용 표라 소유자 역할로 읽고 다시 관리자로 돌아온다.
const asOwner = async (query, args) => { await db.exec("reset role"); try { return (await db.query(query, args)).rows; } finally { await db.exec("set role authenticated; set test.reviewer='1'"); } };
const itemHistory = async () => (await asOwner("select count(*)::int n from catalog_changes where entity_id=$1 and release_label='운영자 퀘스트 조건·보상 수정'", [q2000.id]))[0].n;
d = (await itemsSave(q2000.id, d.quest.version, d.quest.conditions, d.quest.reward_items, "select")).rows[0].d;
assert.equal(await itemHistory(), 1);
d = (await itemsSave(q2000.id, d.quest.version, [], [{ i: "2000000", c: 5 }], "select")).rows[0].d;
assert.equal(d.quest.reward_method, "fixed");
d = (await itemsSave(q2000.id, d.quest.version, [], [], "random")).rows[0].d;
assert.equal(d.quest.reward_method, null);
assert.equal(await itemHistory(), 3);
const firstChange = (await asOwner("select changes from catalog_changes where entity_id=$1 and release_label='운영자 퀘스트 조건·보상 수정' order by id limit 1", [q2000.id]))[0].changes;
assert.deepEqual(Object.keys(firstChange).sort(), ["conditions", "reward_items", "reward_method"]);
assert.deepEqual(firstChange.reward_method, { before: null, after: "select" });
// 수집 자료를 다시 등록해도 관리자가 고친 조건·보상은 그대로
d = (await itemsSave(q2000.id, d.quest.version, [{ i: "4000019", c: 7 }], [{ i: "2000000", c: 9 }], "random")).rows[0].d;
await db.exec("reset role");
await importQuests(quests);
const kept = (await db.query("select conditions,reward_items,reward_method from catalog_quests where source_id=2000")).rows[0];
assert.deepEqual(kept, { conditions: [{ i: "4000019", c: 7 }], reward_items: [{ i: "2000000", c: 9 }], reward_method: "fixed" });
await db.exec("set role anon");
await assert.rejects(itemsSave(q2000.id, d.quest.version, [], [], "random"), /permission denied/);
await db.exec("reset role");
console.log("quest-catalog-db check 통과");
