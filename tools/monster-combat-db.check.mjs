process.on('uncaughtException',error=>{console.error(error.message);process.exit(1);});
import fs from 'node:fs';import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema catalog_import_private;`);
const base=fs.readFileSync('sql/038_shared_game_catalog.sql','utf8');await db.exec(base.slice(base.indexOf('create table if not exists public.catalog_monsters'),base.indexOf('-- 공용 도감은 비로그인')));
await db.exec(`alter table catalog_monsters drop constraint catalog_monsters_name_key;alter table catalog_monsters add column source_data jsonb;create table catalog_changes(id bigint generated always as identity primary key,entity_type text,entity_id uuid,entity_name text,operation text,changes jsonb,release_label text,changed_at timestamptz default now());create table catalog_revision(singleton boolean,revision bigint,updated_at timestamptz);insert into catalog_revision values(true,1,now());create table catalog_import_private.change_backups(change_id bigint,table_name text,old_row jsonb,new_row jsonb);
alter table catalog_monsters enable row level security;create policy catalog_read on catalog_monsters for select to anon,authenticated using(true);grant select(id,required_accuracy,accuracy_per_level) on catalog_monsters to anon,authenticated;`);
const ready=process.env.MONSTER_CATALOG_FILE ? JSON.parse(fs.readFileSync(process.env.MONSTER_CATALOG_FILE,'utf8')) : {monsters:[
 {name:'달팽이',source_id:'100100',level:1,hp:8,exp:3,source_data:{stats_text:'STATS HP : 8 MP : 0 EXP : 3 넉백 가능 데미지 : 1+ 물리 데미지 : 12 마법 데미지 : 0 물리 방어력 : 0 마법 방어력 : 0 속도 : -65 1레벨 에서의 필요 명중 : 0 메소 : 7.5 속성관계 :'}},
 {name:'점검 몬스터',source_id:'999999',level:10,hp:100,exp:20,source_data:{stats_text:'STATS HP : 100 MP : 20 넉백 가능 데미지 : 5+ 물리 데미지 : 30 마법 데미지 : 10 물리 방어력 : 5 마법 방어력 : 2 속도 : 0 10레벨 에서의 필요 명중 : 30.5 메소 : 15'}}
]};
for(const m of ready.monsters)await db.query(`insert into catalog_monsters(name,source,source_id,level,hp,exp,source_data)values($1,'collected',$2,$3,$4,$5,$6)`,[m.name,m.source_id,m.level,m.hp,m.exp,m.source_data]);
const signature=async()=>(await db.query("select md5(string_agg(id::text||name||level||hp||exp,',' order by id)) h from catalog_monsters")).rows[0].h;
await db.exec("update catalog_monsters set required_accuracy=999 where source_id='100100'");
const before=await signature();const sql=fs.readFileSync('sql/052_monster_combat_details.sql','utf8');
const prior=fs.readFileSync('sql/049_catalog_source_scrub.sql','utf8');await db.exec(prior.slice(prior.indexOf('create or replace function public.record_catalog_change()'),prior.indexOf('create or replace function public.import_catalog_batch')));
await db.exec(`create trigger catalog_change_log after insert or update or delete on catalog_monsters for each row execute function record_catalog_change()`);
await db.exec(sql);const history=(await db.query('select count(*)::int n from catalog_changes')).rows[0].n;assert.equal(history,ready.monsters.length);
await db.exec(sql);assert.equal((await db.query('select count(*)::int n from catalog_changes')).rows[0].n,history);assert.equal(await signature(),before);
const count=(await db.query('select count(*)::int n from catalog_monsters where required_accuracy is not null and accuracy_reference_level=level')).rows[0].n;assert.equal(count,ready.monsters.length);
const mpRows=(await db.query('select source_id,mp from catalog_monsters')).rows;for(const m of ready.monsters){if(typeof m.source_data.mp==='number')assert.equal(Number(mpRows.find(row=>row.source_id===m.source_id).mp),m.source_data.mp);}
const snail=(await db.query("select * from catalog_monsters where source_id='100100'")).rows[0];assert.equal(Number(snail.required_accuracy),0);assert.equal(Number(snail.physical_attack),12);assert.equal(Number(snail.movement_speed),-65);assert.equal(Number(snail.meso_value),7.5);assert.equal(snail.accuracy_per_level,null);
assert.equal((await db.query("select catalog_import_private.monster_stat('HP : ???','HP') x")).rows[0].x,null);assert.equal((await db.query("select catalog_import_private.monster_stat('MP : 12M','MP') x")).rows[0].x,null);
await db.exec('set role anon');const detail=(await db.query('select catalog_monster_detail($1) d',[snail.id])).rows[0].d;assert.equal(detail.monster.physical_attack,12);assert(!JSON.stringify(detail).includes('source_data'));await assert.rejects(db.query('select source_data from catalog_monsters'),/permission denied/);await assert.rejects(db.query("select catalog_import_private.monster_stat('HP : 1','HP')"),/permission denied/);await db.exec('reset role');
await db.query(`update catalog_monsters set source_data=jsonb_set(source_data,'{stats_text}',to_jsonb(replace(source_data->>'stats_text','물리 데미지 : 12','물리 데미지 : 13')))where id=$1`,[snail.id]);
const changes=(await db.query('select changes from catalog_changes order by id desc limit 1')).rows[0].changes;assert.deepEqual(changes.physical_attack,{before:12,after:13});
// 기존 명중이 남아 있어도 원문 값을 우선하며 이전 값은 감사 백업에 남습니다.
const firstAccuracy=(await db.query("select changes from catalog_changes where entity_id=$1 and changes ? 'required_accuracy' order by id limit 1",[snail.id])).rows[0].changes;
assert.deepEqual(firstAccuracy.required_accuracy,{before:999,after:0});
const backup=(await db.query("select old_row from catalog_import_private.change_backups where old_row->>'id'=$1 and old_row->>'required_accuracy'='999' limit 1",[snail.id])).rows[0];assert(backup);
await db.exec("update catalog_monsters set required_accuracy=999 where source_id='100100'");await db.exec(sql);
assert.equal(Number((await db.query("select required_accuracy from catalog_monsters where source_id='100100'")).rows[0].required_accuracy),0);
// 원문에서 명중 숫자가 사라진 경우에는 기존 값을 버리거나 0으로 만들지 않습니다.
await db.query(`update catalog_monsters set source_data=jsonb_set(source_data,'{stats_text}',to_jsonb(replace(source_data->>'stats_text','필요 명중 : 0','필요 명중 : ???')))where id=$1`,[snail.id]);
await db.exec("update catalog_monsters set required_accuracy=77 where source_id='100100'");await db.exec(sql);
assert.equal(Number((await db.query("select required_accuracy from catalog_monsters where source_id='100100'")).rows[0].required_accuracy),77);
console.log(`${count}개 자료 수치정규화·0/음수/소수·미제공·정밀표기오해차단·UUID/기본수치보존·재실행·원문권한차단·추가수치변경이력·기존명중 덮어쓰기/원문미제공 보존/이전값 감사백업 통과`);await db.close();
