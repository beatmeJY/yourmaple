// sql/069 검사(PGlite): 몬스터 도감 수정은 도감 관리자만, 변경 이력도 관리자만 읽는다.
process.on("uncaughtException",error=>{console.error(error.stack);process.exit(1);});
import fs from 'node:fs';import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema catalog_import_private;`);
const base=fs.readFileSync('sql/038_shared_game_catalog.sql','utf8');
await db.exec(base.slice(base.indexOf('create table if not exists public.catalog_monsters'),base.indexOf('-- 공용 도감은 비로그인')));
await db.exec(`alter table catalog_monsters drop constraint catalog_monsters_name_key;alter table catalog_monsters add column source_data jsonb not null default '{}';
create table catalog_changes(id bigint generated always as identity primary key,entity_type text,entity_id uuid,entity_name text,operation text,changes jsonb,release_label text,changed_at timestamptz default now());
create table catalog_revision(singleton boolean,revision bigint,updated_at timestamptz);insert into catalog_revision values(true,1,now());
create table catalog_import_private.change_backups(change_id bigint,table_name text,old_row jsonb,new_row jsonb);
alter table catalog_monsters enable row level security;create policy catalog_read on catalog_monsters for select to anon,authenticated using(true);
grant select on catalog_monsters to anon,authenticated;grant select on catalog_changes to anon,authenticated;
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
const id=(await db.query("select id from catalog_monsters where source_id='100100'")).rows[0].id;
const historyCount=async()=>(await db.query('select count(*)::int n from catalog_changes')).rows[0].n;
assert((await historyCount())>0,'052 이력이 있어야 함');

// 일반 사용자·비로그인: 이력 0행, 수정 함수 거절
for(const role of ['anon','authenticated']){
 await db.exec(`set role ${role};set test.reviewer='0'`);
 assert.equal((await db.query('select count(*)::int n from catalog_changes')).rows[0].n,0,`${role} 은 이력을 못 봄`);
 if(role==='anon')await assert.rejects(db.query('select catalog_monster_edit_detail($1)',[id]),/permission denied/);
 else await assert.rejects(db.query('select catalog_monster_edit_detail($1)',[id]),/검토 권한/);
 await db.exec('reset role');
}

// 관리자: 불러오기 → 저장
await db.exec(`set role authenticated;set test.reviewer='1'`);
assert((await db.query('select count(*)::int n from catalog_changes')).rows[0].n>0,'관리자는 이력을 봄');
const detail=(await db.query('select catalog_monster_edit_detail($1) d',[id])).rows[0].d;
assert.equal(detail.draft.name,'달팽이');assert.equal(Number(detail.draft.physical_attack),12);assert.deepEqual(detail.draft.weak_elements,['불']);
const draft={...detail.draft,name:' 파란 달팽이 ',hp:15,exp:4,physical_attack:20,movement_speed:-40,meso_value:null,weak_elements:['성','불'],resist_elements:['독']};
const save=(d,v=detail.version)=>db.query('select catalog_monster_edit_save($1,$2,$3) d',[id,v,d]);
await assert.rejects(save(draft,'old'),/다른 화면/);
await assert.rejects(save({...draft,hp:-1}),/범위/);
await assert.rejects(save({...draft,exp:1.5}),/범위/);
await assert.rejects(save({...draft,level:0}),/범위/);
await assert.rejects(save({...draft,mp:'12'}),/숫자/);
await assert.rejects(save({...draft,weak_elements:['불'],resist_elements:['불']}),/함께/);
await assert.rejects(save({...draft,weak_elements:['물']}),/속성/);
await assert.rejects(save({...draft,name:'  '}),/이름/);
const {weak_elements:_w,...noWeak}=draft;await assert.rejects(save(noWeak),/속성/);
const {name:_drop,...noName}=draft;await assert.rejects(save({...noName,name:undefined}),/이름/);
const before=await historyCount();
const saved=(await save(draft)).rows[0].d;assert.equal(Number(saved.monster.physical_attack),20);
await db.exec('reset role');
const row=(await db.query('select * from catalog_monsters where id=$1',[id])).rows[0];
assert.equal(row.name,'파란 달팽이');assert.equal(Number(row.hp),15);assert.equal(Number(row.movement_speed),-40);assert.equal(row.meso_value,null);
assert.equal(row.weak_elements,'불, 성');assert.equal(row.resist_elements,'독');assert.equal(row.id,id);
assert.deepEqual(row.source_data.import_payload,{a:1},'원문 보관값 유지');
assert.equal(await historyCount(),before+1,'저장 1번에 이력 1건');
const log=(await db.query('select * from catalog_changes order by id desc limit 1')).rows[0];
assert.equal(log.entity_type,'monster');assert.equal(log.release_label,'운영자 상세 수정');
assert.deepEqual(log.changes.hp,{before:8,after:15});assert.deepEqual(log.changes.physical_attack,{before:12,after:20});
assert.deepEqual(log.changes.weak_elements,{before:'불',after:'불, 성'});assert.equal(log.changes.meso_value.before,7.5);
// 같은 값으로 다시 저장하면 이력이 늘지 않는다
await db.exec(`set role authenticated;set test.reviewer='1'`);
const again=(await db.query('select catalog_monster_edit_detail($1) d',[id])).rows[0].d;await save(again.draft,again.version);
await db.exec('reset role');assert.equal(await historyCount(),before+1);
// 정규화 다시 실행(052)해도 고친 전투 수치를 원문 해석값으로 덮지 않는다
await db.exec(sql052);
const kept=(await db.query('select physical_attack,movement_speed,meso_value,hp from catalog_monsters where id=$1',[id])).rows[0];
assert.equal(Number(kept.physical_attack),20);assert.equal(Number(kept.movement_speed),-40);assert.equal(kept.meso_value,null);assert.equal(Number(kept.hp),15);
await db.exec(sql);
console.log('069 몬스터 수정: 관리자만 수정·이력 읽기(일반/비로그인 0행·거절), 버전 충돌·입력 범위·속성 겹침 거절, 저장 반영·UUID·원문 유지, 이력 1건·같은 값 재저장 무기록, 052 재실행에도 수정값 유지, 재실행 통과');
await db.close();
