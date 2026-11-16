// sql/071 검사(PGlite): 몬스터 논리 삭제는 도감 관리자만, 지운 몬스터·드랍은 공개 조회에서 숨긴다.
process.on("uncaughtException",error=>{console.error(error.stack);process.exit(1);});
import fs from 'node:fs';import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema catalog_import_private;`);
const base=fs.readFileSync('sql/038_shared_game_catalog.sql','utf8');
await db.exec(base.slice(base.indexOf('create table if not exists public.catalog_monsters'),base.indexOf('-- 공용 도감은 비로그인')));
await db.exec(`alter table catalog_monsters drop constraint catalog_monsters_name_key;alter table catalog_monsters add column source_data jsonb not null default '{}';
create table catalog_changes(id bigint generated always as identity primary key,entity_type text,entity_id uuid,entity_name text,operation text,changes jsonb,release_label text,changed_at timestamptz default now());
create table if not exists catalog_monster_drops(id bigint generated always as identity primary key,monster_id uuid,item_id uuid,rate_percent numeric);alter table catalog_monster_drops enable row level security;
create table catalog_revision(singleton boolean,revision bigint,updated_at timestamptz);insert into catalog_revision values(true,1,now());
create table catalog_import_private.change_backups(change_id bigint,table_name text,old_row jsonb,new_row jsonb);
alter table catalog_monsters enable row level security;create policy catalog_read on catalog_monsters for select to anon,authenticated using(true);
grant select on catalog_monsters,catalog_items,catalog_monster_drops,catalog_revision to anon,authenticated;grant select on catalog_changes to anon,authenticated;
-- 057 의 관리자 판정 대신 시험용 설정값으로 흉내 낸다.
create function public.can_review_catalog() returns boolean language sql stable as $$ select coalesce(current_setting('test.reviewer',true),'')='1' $$;
grant execute on function public.can_review_catalog() to anon,authenticated;`);
const prior=fs.readFileSync('sql/049_catalog_source_scrub.sql','utf8');
await db.exec(prior.slice(prior.indexOf('create or replace function public.record_catalog_change()'),prior.indexOf('create or replace function public.import_catalog_batch')));
await db.exec(`create trigger catalog_change_log after insert or update or delete on catalog_monsters for each row execute function record_catalog_change()`);
await db.query(`insert into catalog_monsters(name,source,source_id,level,hp,exp,weak_elements,source_data)values('달팽이','collected','100100',1,8,3,'불',$1)`,
 [{stats_text:'STATS HP : 8 MP : 0 EXP : 3 넉백 가능 데미지 : 1+ 물리 데미지 : 12 마법 데미지 : 0 물리 방어력 : 0 마법 방어력 : 0 속도 : -65 1레벨 에서의 필요 명중 : 0 메소 : 7.5',import_payload:{a:1}}]);
const sql052=fs.readFileSync('sql/052_monster_combat_details.sql','utf8');await db.exec(sql052);
const sql=fs.readFileSync('sql/069_catalog_monster_edit.sql','utf8');await db.exec(sql);await db.exec(sql);
await db.query(`insert into catalog_monsters(name,source,source_id,level,hp,exp,image_url)values('스티지(월묘)','collected','9300063',6,65,10,'https://maplestory.io/api/gms/100/mob/9300063/render/stand?bgColor=')`);
const sql070=fs.readFileSync('sql/070_catalog_monster_image_link.sql','utf8');await db.exec(sql070);await db.exec(sql070);
const sql071=fs.readFileSync('sql/071_catalog_monster_soft_delete.sql','utf8');await db.exec(sql071);await db.exec(sql071);
const ids=Object.fromEntries((await db.query('select name,id from catalog_monsters')).rows.map(r=>[r.name,r.id]));
const moon=ids['스티지(월묘)'],snail=ids['달팽이'];
await db.query('insert into catalog_monster_drops(monster_id,item_id,rate_percent) values($1,gen_random_uuid(),1),($2,gen_random_uuid(),2)',[moon,snail]);
const count=async()=>(await db.query('select count(*)::int n from catalog_changes')).rows[0].n;
const as=async(role,reviewer,fn)=>{await db.exec(`set role ${role};set test.reviewer='${reviewer}'`);try{return await fn();}finally{await db.exec('reset role');}};
const visible=role=>as(role,'0',async()=>({
 monsters:(await db.query('select name from catalog_monsters order by name')).rows.map(r=>r.name),
 drops:(await db.query('select count(*)::int n from catalog_monster_drops')).rows[0].n,
 search:(await db.query("select catalog_search_monsters('') r")).rows[0].r.rows.map(r=>r.name).sort(),
}));
for(const role of ['anon','authenticated']){
 const denied=role==='anon'?/permission denied/:/검토 권한/;
 await as(role,'0',async()=>{
  await assert.rejects(db.query('select catalog_monster_set_deleted($1,true,null)',[moon]),denied);
  await assert.rejects(db.query('select catalog_monster_deleted_list()'),denied);
 });
 assert.deepEqual((await visible(role)).monsters.length,2,'지우기 전에는 모두 보임');
}
// 관리자 삭제
const setDel=(id,flag,reason=null)=>as('authenticated','1',()=>db.query('select catalog_monster_set_deleted($1,$2,$3) r',[id,flag,reason]));
await assert.rejects(setDel(moon,true,'가'.repeat(501)),/500자/);
let before=await count();
const res=(await setDel(moon,true,'  중복 몬스터  ')).rows[0].r;assert.ok(res.deleted_at);assert.equal(res.deleted_reason,'중복 몬스터');
await setDel(moon,true,'다른 이유');
assert.equal(await count(),before+1,'삭제 1번에 이력 1건, 이미 지운 몬스터는 무기록');
let log=(await db.query('select * from catalog_changes order by id desc limit 1')).rows[0];
assert.equal(log.release_label,'운영자 몬스터 삭제');assert.deepEqual(log.changes.deleted,{before:false,after:true});assert.equal(log.changes.deleted_reason.after,'중복 몬스터');
for(const role of ['anon','authenticated']){
 const v=await visible(role);
 assert.deepEqual(v.monsters,['달팽이'],`${role}: 지운 몬스터 숨김`);assert.deepEqual(v.search,['달팽이']);assert.equal(v.drops,1,'지운 몬스터 드랍 숨김');
}
// 관리자 목록·그림 점검
const list=(await as('authenticated','1',()=>db.query('select catalog_monster_deleted_list() r'))).rows[0].r;
assert.equal(list.length,1);assert.equal(list[0].name,'스티지(월묘)');assert.equal(list[0].drop_count,1);assert.equal(list[0].deleted_reason,'중복 몬스터');
const audit=(await as('authenticated','1',()=>db.query('select catalog_monster_image_audit() r'))).rows[0].r;
assert.deepEqual(audit.map(r=>r.name),['달팽이'],'그림 점검에서 지운 몬스터 제외');
// 행·드랍은 그대로 남는다
assert.equal((await db.query('select count(*)::int n from catalog_monsters')).rows[0].n,2);
assert.equal((await db.query('select count(*)::int n from catalog_monster_drops')).rows[0].n,2);
// 복구
before=await count();
const back=(await setDel(moon,false)).rows[0].r;assert.equal(back.deleted_at,null);assert.equal(back.deleted_reason,null);
assert.equal(await count(),before+1);
log=(await db.query('select * from catalog_changes order by id desc limit 1')).rows[0];
assert.equal(log.release_label,'운영자 몬스터 복구');assert.deepEqual(log.changes.deleted,{before:true,after:false});
assert.equal((await visible('anon')).monsters.length,2);assert.equal((await visible('anon')).drops,2);
await db.exec(sql071);
assert.equal((await visible('anon')).monsters.length,2,'재실행해도 값 유지');
console.log('071 몬스터 논리 삭제: 관리자만 삭제·복구·목록(일반/비로그인 거절), 지운 몬스터·드랍은 공개 조회/검색/그림 점검에서 숨김, 행·드랍 보존, 이유 500자, 이력 1건·중복 무기록, 복구, 재실행 통과');
await db.close();
