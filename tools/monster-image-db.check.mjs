// sql/070 검사(PGlite): 몬스터 그림 점검·연결은 도감 관리자만.
process.on("uncaughtException",error=>{console.error(error.stack);process.exit(1);});
import fs from 'node:fs';import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema catalog_import_private;`);
const base=fs.readFileSync('sql/038_shared_game_catalog.sql','utf8');
await db.exec(base.slice(base.indexOf('create table if not exists public.catalog_monsters'),base.indexOf('-- 공용 도감은 비로그인')));
await db.exec(`alter table catalog_monsters drop constraint catalog_monsters_name_key;alter table catalog_monsters add column source_data jsonb not null default '{}';
create table catalog_changes(id bigint generated always as identity primary key,entity_type text,entity_id uuid,entity_name text,operation text,changes jsonb,release_label text,changed_at timestamptz default now());
create table if not exists catalog_monster_drops(monster_id uuid,item_id uuid);
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
const ids=Object.fromEntries((await db.query('select name,id from catalog_monsters')).rows.map(r=>[r.name,r.id]));
const moon=ids['스티지(월묘)'],snail=ids['달팽이'];
await db.exec(`update catalog_monsters set image_url='https://img.test/snail.png' where name='달팽이'`);
const count=async()=>(await db.query('select count(*)::int n from catalog_changes')).rows[0].n;
const denied=role=>role==='anon'?/permission denied/:/검토 권한/;
for(const role of ['anon','authenticated']){
 await db.exec(`set role ${role};set test.reviewer='0'`);
 await assert.rejects(db.query('select catalog_monster_image_audit()'),denied(role));
 await assert.rejects(db.query('select catalog_monster_set_image($1,null,$2)',[moon,'https://x.test/a.png']),denied(role));
 await assert.rejects(db.query('select catalog_monster_set_image_link($1,null,$2)',[moon,snail]),denied(role));
 // 검색은 누구나: 대체 그림 칸이 함께 온다
 const rows=(await db.query("select catalog_search_monsters('스티지') r")).rows[0].r.rows;assert.equal(rows.length,1);assert.equal(rows[0].image_fallback_url,null);
 await db.exec('reset role');
}
await db.exec(`set role authenticated;set test.reviewer='1'`);
const audit=(await db.query('select catalog_monster_image_audit() a')).rows[0].a;assert.equal(audit.length,2);
const link=(expected,target)=>db.query('select catalog_monster_set_image_link($1,$2,$3) r',[moon,expected,target]);
await assert.rejects(link(null,moon),/자기 자신|check constraint/);
await assert.rejects(link(snail,snail),/다른 화면/);
let before=await count();
assert.equal((await link(null,snail)).rows[0].r.image_fallback_url,'https://img.test/snail.png');
await link(snail,snail);
await db.exec('reset role');
assert.equal(await count(),before+1,'연결 1번에 이력 1건, 같은 연결은 무기록');
let log=(await db.query('select * from catalog_changes order by id desc limit 1')).rows[0];
assert.equal(log.release_label,'운영자 대체 그림 연결');assert.deepEqual(log.changes.image_link,{before:null,after:'달팽이'});
// 원본 주소는 그대로, 검색에 대체 그림이 붙는다
const row=(await db.query("select catalog_search_monsters('스티지') r")).rows[0].r.rows[0];
assert.match(row.image_url,/render\/stand/);assert.equal(row.image_fallback_url,'https://img.test/snail.png');
// 이어 둔 몬스터 그림이 바뀌면 따라간다
await db.exec(`update catalog_monsters set image_url='https://img.test/snail2.png' where name='달팽이'`);
assert.equal((await db.query("select catalog_search_monsters('스티지') r")).rows[0].r.rows[0].image_fallback_url,'https://img.test/snail2.png');
// 그림 없는 몬스터에는 연결 불가
await db.exec(`update catalog_monsters set image_url=null where name='달팽이'`);
await db.exec(`set role authenticated;set test.reviewer='1'`);
await assert.rejects(link(snail,null).then(()=>link(null,snail)),/그림이 없습니다/);
// 원본 주소 고치기(stand → fly)
const setImg=(expected,url)=>db.query('select catalog_monster_set_image($1,$2,$3) r',[moon,expected,url]);
const stand='https://maplestory.io/api/gms/100/mob/9300063/render/stand?bgColor=',fly='https://maplestory.io/api/gms/100/mob/9300063/render/fly?bgColor=';
await assert.rejects(setImg(stand,'http://x.test/a.png'),/https/);
await assert.rejects(setImg('https://other',fly),/다른 화면/);
before=await count();await setImg(stand,fly);await setImg(fly,fly);
await db.exec('reset role');
assert.equal(await count(),before+1);
log=(await db.query('select * from catalog_changes order by id desc limit 1')).rows[0];
assert.equal(log.release_label,'운영자 원본 그림 주소 수정');assert.deepEqual(log.changes.image_url,{before:stand,after:fly});
// 이어 둔 몬스터를 지우면 연결만 풀린다
await db.exec(`update catalog_monsters set image_link_monster_id=null where id='${moon}'`);
await db.exec(sql070);
console.log('070 몬스터 그림: 관리자만 점검·연결(일반/비로그인 거절, 검색은 공개), 자기 연결·버전 충돌·그림 없는 대상·https 아님 거절, 원본 주소 유지+대체 그림 따라감, 원본 주소 고치기, 이력 1건·같은 값 무기록, 재실행 통과');
await db.close();
