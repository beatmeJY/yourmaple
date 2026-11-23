// sql/073 검사(PGlite): 아이템 설명의 #c 기호 정리·주문서 효과 분리·줄바꿈이 js/item-text.js 와 같은 결과인지,
// 정규화 트리거로 기본 옵션·효과·변경 이력이 맞게 바뀌고 다시 실행·재등록해도 안전한지 본다.
// ITEMS_JSON=<공개 도감 아이템 JSON 파일>을 주면 그 자료 전부로 SQL·JS 결과를 비교한다(로컬 전용).
process.on("uncaughtException",error=>{console.error(error.stack);process.exit(1);});
import fs from 'node:fs';import assert from 'node:assert/strict';
import {cleanItemText} from '../js/item-text.js';
import {itemTextCases} from './item-text-fixtures.mjs';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite();
const slice=(file,from,to)=>{const s=fs.readFileSync(file,'utf8');const a=s.indexOf(from),b=to?s.indexOf(to,a):s.length;assert(a>=0&&b>a,`${file} 자르기`);return s.slice(a,b);};
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema catalog_import_private;create schema catalog_review_private;`);
await db.exec(slice('sql/038_shared_game_catalog.sql','create table if not exists public.catalog_monsters','-- 공용 도감은 비로그인'));
// 038 의 옛 옵션 검사를 061 판(HP/MP 증가율 포함)으로 바꾼다.
await db.exec(slice('sql/061_catalog_item_level_up_count.sql','create or replace function public.valid_item_options','revoke all on function public.valid_item_options'));
await db.exec(`alter table catalog_items add column if not exists source_data jsonb not null default '{}'::jsonb;`);
await db.exec(slice('sql/044_normalize_catalog_items.sql','alter table public.catalog_items','do $$ declare t text;'));
await db.exec(slice('sql/062_catalog_attack_speed_review.sql','create or replace function catalog_review_private.valid_speed_label','create or replace function catalog_review_private.effects_with_speed'));
await db.exec(`create table catalog_changes(id bigint generated always as identity primary key,entity_type text,entity_id uuid,entity_name text,operation text,changes jsonb,release_label text,changed_at timestamptz default now());
create table catalog_revision(singleton boolean,revision bigint,updated_at timestamptz);insert into catalog_revision values(true,1,now());
create table catalog_import_private.change_backups(change_id bigint,table_name text,old_row jsonb,new_row jsonb);`);
await db.exec(slice('sql/061_catalog_item_level_up_count.sql','create or replace function public.record_catalog_change()','revoke all on function public.record_catalog_change()'));
await db.exec(slice('sql/062_catalog_attack_speed_review.sql','create or replace function public.catalog_item_columns()','create or replace function public.catalog_review_save'));
await db.exec(slice('sql/049_catalog_source_scrub.sql','create or replace function public.catalog_item_relations()','revoke all on function public.catalog_item_columns()'));
await db.exec(`create trigger catalog_item_columns before insert or update of base_options,requirements,source_data,source on catalog_items for each row execute function catalog_item_columns();
create trigger catalog_item_relations after insert or update of base_options,requirements,source_data,source on catalog_items for each row execute function catalog_item_relations();`);
for(const t of ['catalog_items','catalog_item_stats']) await db.exec(`create trigger catalog_change_log after insert or update or delete on ${t} for each row execute function record_catalog_change()`);
const q=async(sql,params)=>(await db.query(sql,params)).rows;
const one=async(sql,params)=>(await q(sql,params))[0];

// 073 전(062 트리거)에 수집 자료처럼 등록한다.
const raw=(desc,extra={})=>JSON.stringify({description_text:desc==null?null:`DSC ${desc}`,...extra});
const add=(name,desc,extra={},opts={},req={})=>db.query(`insert into catalog_items(name,category,source,source_id,source_data,base_options,requirements)values($1,'소비','collected',$2,$3,$4,$5)`,[name,String(Math.random()),raw(desc,extra),JSON.stringify(opts),JSON.stringify(req)]);
await add('한손검 공격력 주문서 10%',itemTextCases[0].raw);
await add('드래곤의 돌',itemTextCases[4].raw);
await add('[마스터리북]슈퍼 트랜스폼 20',itemTextCases[7].raw,{},{},{'70%의 확률로 #c슈퍼 트랜스폼#의 마스터 레벨을 20까지 올려준다.직업':'바이퍼조건 : 스킬 레벨 5이상',level:0});
await add('사과','빨갛게 잘 익은 사과이다.HP를 약 30 회복시킨다.',{effect_text:'EFFECT HP를 약 30 회복시킨다.'});
await add('운영자가 고친 주문서',itemTextCases[1].raw,{},{str:9});
await add('평범한 설명','평범한 설명이다.');
await add('설명 없음',null);
// 074 대상(자유 글 효과) 예시: 실제 번호·이름·원문 그대로. 실자료를 넣을 때는 실자료가 대신한다.
const free=[['2070001','월비 표창','강철로 만든 표창이다. 여러 개가 들어있으며 모두 사용했다면 다시 충전해야 한다.','공격력 + 17, 충전량 500'],
 ['2040037','기적의 주문서(얼굴장식)','베이컨트 서클릿에 옵션 추가. 성공률 5%, STR/INT/DEX/LUK +4, 방어력 +14, 최대HP/최대MP +40, 이동속도 +4, 점프력 +4.',null],
 ['2022121','겔트 초콜릿','성탄 페스티벌에서 나누어주는 맛있는 초콜릿이다. HP/MP 100 회복, 10분간 공격력 +120, 방어력 +120, 명중률 +30, 회피율 +30, 이동속도 +10, 점프력 +10.',null],
 ['2060001','활전용 청동화살','청동화살이 들어있는 화살통이다. 반드시 활과 함께 사용해야 한다.공격력 + 1',null]];
if(!process.env.ITEMS_JSON) for(const [sid,name,desc,effect] of free) await db.query(`insert into catalog_items(name,category,source,source_id,source_data)values($1,'소비','collected',$2,$3)`,[name,sid,JSON.stringify({description_text:`DSC ${desc}`,effect_text:effect&&`EFFECT ${effect}`,import_payload:{x:1}})]);
const id=async name=>(await one('select id from catalog_items where name=$1',[name])).id;
assert.match((await one("select description from catalog_items where name='한손검 공격력 주문서 10%'")).description,/#c/,'073 전에는 #c 그대로');
const untouched=await one("select to_jsonb(i) j from catalog_items i where name='평범한 설명'");

// (로컬) 공개 도감 전체를 073 전 상태로 넣는다(062 트리거가 지금 운영처럼 #c 가 남은 설명을 만든다).
const realRows=process.env.ITEMS_JSON?JSON.parse(fs.readFileSync(process.env.ITEMS_JSON,'utf8')):[];
for(const r of realRows) await db.query(`insert into catalog_items(name,category,source,source_id,source_data,base_options,requirements)values($1,'소비','collected',$2,$3,$4,$5)`,['실자료 '+r.name,r.source_id??('real-'+r.id),JSON.stringify(r.source_data),JSON.stringify(r.base_options??{}),JSON.stringify(r.requirements??{})]);
if(realRows.length) assert.equal((await one("select count(*)::int n from catalog_items where name like '실자료 %' and description like '%#c%'")).n,realRows.filter(r=>/#c/.test(r.source_data?.description_text??'')).length,'원문의 #c 설명이 그대로 나옴');

const sql=fs.readFileSync('sql/073_catalog_item_text_cleanup.sql','utf8');
const started=Date.now();
await db.exec(sql);
const took=Date.now()-started;

// 1) SQL 함수와 JS 규칙이 같은 결과
for(const sample of itemTextCases){
  const got=(await one('select catalog_item_text($1) t',[sample.raw])).t;
  assert.deepEqual(got,{description:sample.description,effects:sample.effects,options:sample.options},`SQL ${sample.name}`);
}
assert.deepEqual((await one('select catalog_item_text(null) t')).t,{description:'',effects:[],options:{}});

// 2) 기존 자료 정리
const item=async name=>one('select * from catalog_items where name=$1',[name]);
const sword=await item('한손검 공격력 주문서 10%');
assert.equal(sword.description,'한손검에 공격력 향상 옵션을 추가한다.');
assert.equal(sword.effect_description,'성공률 10%');
assert.deepEqual(sword.base_options,{str:3,attack:5,defense:10});
assert.deepEqual((await q('select stat_key,base_value from catalog_item_stats where item_id=$1 order by stat_key',[sword.id])).map(r=>[r.stat_key,r.base_value]),[['attack',5],['defense',10],['str',3]],'옵션은 관계표에도');
const stone=await item('드래곤의 돌');
assert.equal(stone.effect_description,'조건 : 잔여 업그레이드 가능 횟수 3회 이상\n성공률 100%');
assert.equal(Object.keys(stone.base_options).length,6);
const book=await item('[마스터리북]슈퍼 트랜스폼 20');
assert.equal(book.description,itemTextCases[7].description);
assert.deepEqual(book.requirements,{'70%의 확률로 슈퍼 트랜스폼의 마스터 레벨을 20까지 올려준다.직업':'바이퍼조건 : 스킬 레벨 5이상',level:0},'착용 조건은 기호만 지움(옮기기 보류)');
assert.equal((await one("select count(*)::int n from catalog_item_source_attributes where item_id=$1 and attribute_name like '%#%'",[book.id])).n,0,'추가 정보 행도 정리');
const apple=await item('사과');
assert.equal(apple.description,'빨갛게 잘 익은 사과이다.\nHP를 약 30 회복시킨다.');
assert.equal(apple.effect_description,'HP를 약 30 회복시킨다.');
const edited=await item('운영자가 고친 주문서');
assert.deepEqual(edited.base_options,{str:9},'이미 있는 기본 옵션은 덮지 않음');
assert.equal(edited.effect_description,'성공률 30%\n실패 시 50% 확률로 파괴');
assert.deepEqual((await one("select to_jsonb(i) j from catalog_items i where name='평범한 설명'")).j,untouched.j,'고칠 것 없는 아이템은 그대로');
assert.equal((await item('설명 없음')).description,null);

// 3) 이력·보관
const logs=await q("select entity_name,changes from catalog_changes where release_label='설명 정리·주문서 효과 분리' and entity_type='item' and entity_name not like '실자료 %' order by id");
assert.deepEqual([...new Set(logs.map(l=>l.entity_name).filter(n=>!free.some(f=>f[1]===n)))].sort(),['[마스터리북]슈퍼 트랜스폼 20','드래곤의 돌','사과','운영자가 고친 주문서','한손검 공격력 주문서 10%'].sort(),'바뀐 아이템만 이력');
assert(logs.find(l=>l.entity_name==='한손검 공격력 주문서 10%').changes.base_options,'옵션 바뀜 이력');
const kept=await one('select * from catalog_import_private.scrub_073_rows where row_id=$1',[sword.id]);
assert.match(kept.description,/#c성공률/);assert.deepEqual(kept.base_options,{});
assert.equal((await one("select count(*)::int n from catalog_import_private.scrub_073_rows r join catalog_items i on i.id=r.row_id where i.name not like '실자료 %' and i.source_id not in ('2070001','2040037','2022121','2060001')")).n,5);

// 4) 다시 실행: 바뀌는 값·이력 없음, 보관한 처음 값 유지
const n0=(await one('select count(*)::int n from catalog_changes')).n;
await db.exec(sql);
assert.equal((await one('select count(*)::int n from catalog_changes')).n,n0,'재실행은 무기록');
assert.match((await one('select description from catalog_import_private.scrub_073_rows where row_id=$1',[sword.id])).description,/#c/);
assert.deepEqual((await item('한손검 공격력 주문서 10%')).base_options,{str:3,attack:5,defense:10});

// 5) 수집 자료 재등록(원문과 빈 옵션으로 다시 씀)·새 등록도 같은 정리
await db.query(`update catalog_items set source_data=$2,base_options='{}' where id=$1`,[sword.id,raw(itemTextCases[0].raw)]);
assert.deepEqual((await item('한손검 공격력 주문서 10%')).base_options,{str:3,attack:5,defense:10});
await add('새 주문서',itemTextCases[5].raw);
const fresh=await item('새 주문서');
assert.equal(fresh.description,itemTextCases[5].description);assert.equal(fresh.effect_description,'성공률 70%\n손재주 +1');
assert.deepEqual(fresh.base_options,{int:2,magic_attack:1,magic_defense:3});
// 운영자 수정창 저장처럼 정리된 글을 원문 칸에 쓰면 그대로 남는다.
await db.query(`update catalog_items set source_data=source_data||$2 where id=$1`,[sword.id,JSON.stringify({description_text:'고친 설명이다.',effect_text:'성공률 10%\n주의 문구'})]);
assert.deepEqual([(await item('한손검 공격력 주문서 10%')).description,(await item('한손검 공격력 주문서 10%')).effect_description],['고친 설명이다.','성공률 10%\n주의 문구']);

// 6) 074: 자유 글 효과 42개(예시 4개)
const sql74=fs.readFileSync('sql/074_catalog_item_free_text_effects.sql','utf8');
await db.exec(sql74);
const star=await one("select * from catalog_items where source_id='2070001'");
assert.deepEqual([star.description,star.effect_description,star.base_options],['강철로 만든 표창이다. 여러 개가 들어있으며 모두 사용했다면 다시 충전해야 한다.','충전량 500',{attack:17}],'표창');
assert.deepEqual((await q("select stat_key,base_value from catalog_item_stats where item_id=$1",[star.id])).map(r=>[r.stat_key,r.base_value]),[['attack',17]]);
if(!process.env.ITEMS_JSON) assert.deepEqual(star.source_data.import_payload,{x:1},'등록 판단용 원문 묶음 유지');
const miracle=await one("select * from catalog_items where source_id='2040037'");
assert.deepEqual([miracle.description,miracle.effect_description],['베이컨트 서클릿에 옵션 추가.','성공률 5%']);
assert.deepEqual(miracle.base_options,{str:4,int:4,dex:4,luk:4,defense:14,hp:40,mp:40,speed:4,jump:4});
const choco=await one("select * from catalog_items where source_id='2022121'");
assert.deepEqual([choco.description,choco.effect_description,choco.base_options],['성탄 페스티벌에서 나누어주는 맛있는 초콜릿이다.','HP/MP 100 회복\n10분간 공격력 +120, 방어력 +120, 명중률 +30, 회피율 +30, 이동속도 +10, 점프력 +10',{}],'음식은 효과 글만');
const arrow=await one("select * from catalog_items where source_id='2060001'");
assert.deepEqual([arrow.description,arrow.base_options],['청동화살이 들어있는 화살통이다. 반드시 활과 함께 사용해야 한다.',{attack:1}],'073 줄바꿈 뒤 설명으로 맞춰 고름');
const n74=(await one("select count(*)::int n from catalog_changes where release_label='자유 글 효과 정리'")).n;
assert.equal(n74,process.env.ITEMS_JSON?42:4,'바뀐 아이템마다 이력');
await db.exec(sql74);
assert.equal((await one("select count(*)::int n from catalog_changes where release_label='자유 글 효과 정리'")).n,n74,'074 재실행 무기록');
assert.match((await one('select description from catalog_import_private.scrub_074_rows where row_id=$1',[star.id])).description??'',/표창/);
// 이미 다르게 고친 아이템은 건너뛴다.
await db.query("update catalog_items set source_data=source_data||'{\"description_text\":\"운영자가 고친 설명.\"}', base_options='{}' where id=$1",[star.id]);
await db.exec(sql74);
assert.deepEqual([(await one('select description,base_options from catalog_items where id=$1',[star.id]))].map(r=>[r.description,r.base_options])[0],['운영자가 고친 설명.',{}],'이전 값이 다르면 건너뜀');
const free74=` · 074 자유 글 ${n74}개 정리(표창·기적의 주문서·음식·화살)·재실행 무기록·다른 값 건너뜀`;

// 6) (로컬) 공개 도감 전체 자료로 SQL·JS 비교
let real='';
if(realRows.length){
  const rows=realRows;
  let changed=0,optionItems=0;
  for(const r of rows){
    for(const text of [r.source_data?.description_text?.replace(/^DSC\s+/,''),r.source_data?.effect_text?.replace(/^EFFECT\s+/,'')]){
      if(text==null) continue;
      const got=(await one('select catalog_item_text($1) t',[text])).t;
      assert.deepEqual(got,cleanItemText(text),r.name);
      if(got.description!==text.trim()) changed++;
      if(Object.keys(got.options).length) optionItems++;
      assert(!/#c/.test(got.description)&&!got.effects.some(e=>/#/.test(e)),`${r.name} 기호 남음`);
    }
  }
  const real073=await one(`select count(*) filter(where description like '%#c%' or effect_description like '%#%' or requirements::text like '%#c%')::int left_marks,
    count(*) filter(where base_options<>'{}')::int with_options,(select count(*)::int from catalog_import_private.scrub_073_rows r join catalog_items x on x.id=r.row_id where x.name like '실자료 %') saved,
    (select count(distinct entity_id)::int from catalog_changes c join catalog_items x on x.id=c.entity_id where x.name like '실자료 %' and c.release_label='설명 정리·주문서 효과 분리') logged
    from catalog_items where name like '실자료 %'`);
  assert.equal(real073.left_marks,0,'실자료 기호 남음');
  real+=` · 실자료 073 적용 ${took}ms: 대상 ${real073.saved}개·이력 ${real073.logged}개·옵션 있는 아이템 ${real073.with_options}개·기호 0`;
  real+=` · 공개 도감 ${rows.length}개 SQL=JS 일치(설명 바뀜 ${changed}, 옵션 꺼냄 ${optionItems})`;
}
console.log(`073 아이템 설명 정리: SQL·JS 예시 ${itemTextCases.length}개 일치, 주문서 옵션(관계표)·효과·조건/파괴·마스터리북 줄바꿈·착용 조건 기호만 제거·운영자 옵션 보존·변경 없는 아이템 그대로, 바뀐 아이템만 이력·처음 값 비공개 보관, 재실행 무기록, 재등록·새 등록·수정 저장 통과${free74}${real}`);
await db.close();
