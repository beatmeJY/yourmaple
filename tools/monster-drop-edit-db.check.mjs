// sql/072 검사(PGlite): 몬스터 드랍 수정은 도감 관리자만, 고친 줄마다 변경 이력이 남는다.
process.on("uncaughtException",error=>{console.error(error.stack);process.exit(1);});
import fs from 'node:fs';import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema catalog_import_private;`);
const base=fs.readFileSync('sql/038_shared_game_catalog.sql','utf8');
await db.exec(base.slice(base.indexOf('create table if not exists public.catalog_monsters'),base.indexOf('-- 공용 도감은 비로그인')));
const drops=fs.readFileSync('sql/043_catalog_import.sql','utf8');
await db.exec(drops.slice(drops.indexOf('create table if not exists public.catalog_monster_drops'),drops.indexOf('alter table public.catalog_monster_drops enable')));
await db.exec(`alter table catalog_monster_drops alter column source_url drop not null;
alter table catalog_monsters add column deleted_at timestamptz;
create table catalog_changes(id bigint generated always as identity primary key,entity_type text,entity_id uuid,entity_name text,operation text,changes jsonb,release_label text,changed_at timestamptz default now());
create table catalog_revision(singleton boolean,revision bigint,updated_at timestamptz);insert into catalog_revision values(true,1,now());
create table catalog_import_private.change_backups(change_id bigint,table_name text,old_row jsonb,new_row jsonb);
alter table catalog_monster_drops enable row level security;create policy catalog_read on catalog_monster_drops for select to anon,authenticated using(true);
grant select on catalog_monster_drops,catalog_monsters,catalog_items,catalog_changes to anon,authenticated;
-- 057 의 관리자 판정 대신 시험용 설정값으로 흉내 낸다.
create function public.can_review_catalog() returns boolean language sql stable as $$ select coalesce(current_setting('test.reviewer',true),'')='1' $$;
grant execute on function public.can_review_catalog() to anon,authenticated;`);
const prior=fs.readFileSync('sql/061_catalog_item_level_up_count.sql','utf8');
await db.exec(prior.slice(prior.indexOf('create or replace function public.record_catalog_change()'),prior.indexOf('revoke all on function public.record_catalog_change()')));
await db.exec(`create trigger catalog_change_log after insert or update or delete on catalog_monster_drops for each row execute function record_catalog_change()`);
await db.exec(`insert into catalog_monsters(name,source,source_id,level,hp,exp)values('달팽이','collected','100100',1,8,3),('파란 달팽이','collected','100101',2,15,4),('지운 몬스터','collected','999',1,1,1);
update catalog_monsters set deleted_at=now() where source_id='999';
insert into catalog_items(name,source,source_id)values('달팽이 껍질','collected','4000019'),('빨간 포션','collected','2000000'),('파란 포션','collected','2000001'),('메소','collected','9');`);
const one=async(q,p)=>(await db.query(q,p)).rows[0];
const snail=(await one("select id from catalog_monsters where source_id='100100'")).id;
const other=(await one("select id from catalog_monsters where source_id='100101'")).id;
const gone=(await one("select id from catalog_monsters where source_id='999'")).id;
const item=async sid=>(await one('select id from catalog_items where source_id=$1',[sid])).id;
const [shell,red,blue]=[await item('4000019'),await item('2000000'),await item('2000001')];
await db.query(`insert into catalog_monster_drops(monster_id,item_id,source,monster_source_id,source_entry,rate_percent,rate_text)values
 ($1,$2,'collected','100100',0,60,'60%'),($1,$3,'collected','100100',1,1,'1%'),($4,$2,'collected','100101',0,50,'50%')`,[snail,shell,red,other]);
const otherDrop=(await one('select id from catalog_monster_drops where monster_id=$1',[other])).id;
const sql=fs.readFileSync('sql/072_catalog_monster_drop_edit.sql','utf8');await db.exec(sql);await db.exec(sql);
const historyCount=async()=>(await one('select count(*)::int n from catalog_changes')).n;

// 일반 사용자·비로그인: 거절
for(const role of ['anon','authenticated']){
 await db.exec(`set role ${role};set test.reviewer='0'`);
 const pattern=role==='anon'?/permission denied/:/검토 권한/;
 await assert.rejects(db.query('select catalog_monster_drops_edit_detail($1)',[snail]),pattern);
 await assert.rejects(db.query('select catalog_monster_drops_save($1,$2,$3)',[snail,'x',[]]),pattern);
 await db.exec('reset role');
}

await db.exec(`set role authenticated;set test.reviewer='1'`);
const detail=(await one('select catalog_monster_drops_edit_detail($1) d',[snail])).d;
assert.equal(detail.drops.length,2);assert.equal(detail.drops[0].item.name,'달팽이 껍질','확률 높은 순');assert.equal(Number(detail.drops[1].rate_percent),1);
await assert.rejects(db.query('select catalog_monster_drops_edit_detail($1)',[gone]),/찾을 수 없/);
const save=(list,v=detail.version,id=snail)=>db.query('select catalog_monster_drops_save($1,$2,$3) d',[id,v,JSON.stringify(list)]);
const [d0,d1]=detail.drops;
const keep=d=>({id:d.id,item_id:d.item_id,rate_percent:d.rate_percent===null?null:Number(d.rate_percent)});
await assert.rejects(save([keep(d0)],'old'),/다른 화면/);
await assert.rejects(save([{...keep(d0),rate_percent:101}]),/0~100/);
await assert.rejects(save([{...keep(d0),rate_percent:-1}]),/0~100/);
await assert.rejects(save([{...keep(d0),rate_percent:'5'}]),/숫자/);
await assert.rejects(save([{id:null,item_id:'00000000-0000-0000-0000-000000000000',rate_percent:1}]),/도감에 없는/);
await assert.rejects(save([{id:null,item_id:'abc',rate_percent:1}]),/아이템 값/);
await assert.rejects(save([{id:null,rate_percent:1}]),/아이템을 골라/);
await assert.rejects(save([keep(d0),keep(d0)]),/두 번/);
await assert.rejects(save([{id:otherDrop,item_id:red,rate_percent:1}]),/이 몬스터의 드랍이 아닙니다/);
await assert.rejects(save('x'),/형식/);
await assert.rejects(save([],'x',gone),/찾을 수 없/);

// 확률 바꾸기 + 아이템 바꾸기 + 하나 새로(확률 미상) + 하나 새로(0.05%)
const before=await historyCount();
const saved=(await save([{...keep(d0),rate_percent:55.5},{...keep(d1),item_id:blue},{id:null,item_id:red,rate_percent:null},{id:null,item_id:shell,rate_percent:0.05}])).rows[0].d;
assert.equal(saved.drops.length,4);assert.notEqual(saved.version,detail.version);
await db.exec('reset role');
const rows=(await db.query('select * from catalog_monster_drops where monster_id=$1 order by source,source_entry',[snail])).rows;
assert.equal(rows.find(r=>r.id===d0.id).rate_text,'55.5%');assert.equal(Number(rows.find(r=>r.id===d0.id).rate_percent),55.5);
assert.equal(rows.find(r=>r.id===d1.id).item_id,blue,'같은 줄(UUID)에서 아이템만 바뀜');
const added=rows.filter(r=>r.source==='operator');
assert.deepEqual(added.map(r=>[r.source_entry,r.monster_source_id,r.rate_text]),[[0,snail,'확률 미상'],[1,snail,'0.05%']]);
assert.equal(await historyCount(),before+4,'바뀐 줄마다 이력 1건');
const logs=(await db.query('select * from catalog_changes order by id desc limit 4')).rows;
assert(logs.every(l=>l.entity_type==='monster'&&l.entity_id===snail&&l.release_label==='운영자 드랍 수정'&&l.entity_name==='달팽이'));
assert(logs.some(l=>l.operation==='UPDATE'&&l.changes.item_id?.before==='빨간 포션'&&l.changes.item_id?.after==='파란 포션'),'아이템 바뀜은 이름으로');
assert.equal(Number((await one("select count(*)::int n from catalog_monster_drops where monster_id=$1",[other])).n),1,'다른 몬스터 드랍 그대로');

// 같은 목록 그대로 저장하면 이력이 늘지 않는다. 빼면 지워지고, 새 줄 순번은 이어 붙는다.
await db.exec(`set role authenticated;set test.reviewer='1'`);
let now=(await one('select catalog_monster_drops_edit_detail($1) d',[snail])).d;
const same=now.drops.map(keep);
const n0=await historyCount();await save(same,now.version);assert.equal(await historyCount(),n0,'같은 값은 무기록');
now=(await one('select catalog_monster_drops_edit_detail($1) d',[snail])).d;
const unknown=now.drops.find(d=>d.rate_percent===null);
await save([...now.drops.filter(d=>d.id!==unknown.id).map(keep),{id:null,item_id:blue,rate_percent:100}],now.version);
await db.exec('reset role');
assert.equal(await historyCount(),n0+2,'지움 1 + 새로 1');
const del=(await one("select * from catalog_changes where operation='DELETE' order by id desc limit 1"));assert.equal(del.changes.item_id.before,'빨간 포션');
assert.deepEqual((await db.query("select source_entry,rate_text from catalog_monster_drops where source='operator' order by source_entry")).rows.map(r=>[r.source_entry,r.rate_text]),[[1,'0.05%'],[2,'100%']],'정수 확률은 0을 자르지 않음');
// 전부 빼기
await db.exec(`set role authenticated;set test.reviewer='1'`);
now=(await one('select catalog_monster_drops_edit_detail($1) d',[snail])).d;
assert.equal((await save([],now.version)).rows[0].d.drops.length,0);
await db.exec('reset role');
await db.exec(sql);
console.log('072 드랍 수정: 관리자만(일반/비로그인 거절), 지운 몬스터·버전 충돌·확률 범위/형식·없는 아이템·다른 몬스터 드랍·중복 거절, 확률/아이템 변경(UUID 유지)·새 드랍 operator 순번·지우기·전부 빼기, 바뀐 줄마다 이력(아이템 이름)·같은 값 무기록, 다른 몬스터 불변, 재실행 통과');
await db.close();
