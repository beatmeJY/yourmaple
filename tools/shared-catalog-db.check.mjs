const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';
const root=new URL('..', import.meta.url).pathname;const db=new PGlite();
await db.exec(`create schema auth;create role anon;create role authenticated;create role service_role bypassrls;create table auth.users(id uuid primary key);insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;create function public.assign_user_id() returns trigger language plpgsql as $$begin if auth.uid() is not null then new.user_id:=auth.uid();end if;return new;end$$;create function public.touch_updated_at() returns trigger language plpgsql as $$begin new.updated_at:=now();return new;end$$;`);
await db.exec(readFileSync(root+'/sql/006_trades.sql','utf8'));
const all=readFileSync(root+'/sql/001_schema.sql','utf8');await db.exec(all.slice(all.indexOf('create table if not exists public.monsters ('),all.indexOf('-- trades:')));
await db.exec(`insert into public.monsters(user_id,name,level,hp,exp) values ('00000000-0000-0000-0000-000000000001','달 팽이',1,15,3),('00000000-0000-0000-0000-000000000002','달팽이',null,15,null),('00000000-0000-0000-0000-000000000001','충돌',2,30,5),('00000000-0000-0000-0000-000000000002','충돌',2,31,5);`);
const sql=readFileSync(root+'/sql/038_shared_game_catalog.sql','utf8');await db.exec(sql);await db.exec(sql);
assert.equal((await db.query('select * from public.monsters')).rows.length,4);assert.equal((await db.query('select * from public.catalog_monsters')).rows.length,1);assert.equal((await db.query('select * from public.catalog_monster_reviews')).rows.length,1);assert.equal((await db.query('select hp_per_exp from public.catalog_monsters')).rows[0].hp_per_exp,'5.0000');
await db.exec(`insert into public.catalog_items(id,name,category,base_options) values ('e0000000-0000-0000-0000-000000000001','아대','아대','{"attack":30}');`);
await db.exec('set role anon');assert.equal((await db.query('select * from public.catalog_monsters')).rows.length,1);assert.equal((await db.query('select * from public.catalog_items')).rows.length,1);await assert.rejects(()=>db.exec("insert into public.catalog_monsters(name) values ('공격')"),/permission denied/);await assert.rejects(()=>db.exec('select * from public.catalog_monster_reviews'),/permission denied/);
await db.exec(`set role authenticated;set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'`);
await assert.rejects(()=>db.exec("update public.catalog_items set name='조작'"),/permission denied/);
async function apply(expected,replacement,restore=false){return (await db.query('select public.replace_my_trades_v2($1::jsonb,$2::jsonb,$3) x',[JSON.stringify(expected),JSON.stringify(replacement),restore])).rows[0].x}
const row={id:'10000000-0000-0000-0000-000000000001',name:'아대',buy_price:100,buy_qty:1,sell_price:null,sell_qty:0,item_id:'e0000000-0000-0000-0000-000000000001',item_snapshot:{name:'아대',base_options:{attack:30}},item_options:{attack:35,remaining_upgrades:7}};
const saved=await apply([],[row]);assert.equal(saved.after[0].item_options.attack,35);const edited=await apply(saved.after,[{...saved.after[0],item_options:{attack:36}}]);await apply(edited.after,edited.before,true);const after=(await db.query('select to_jsonb(t)-\'user_id\' x from trades t')).rows.map(r=>r.x);assert.deepEqual(after,saved.after);
await assert.rejects(()=>apply(after,[{...row,item_options:{attack:'BAD'}}]));assert.equal((await db.query('select * from trades')).rows.length,1);
await db.exec('reset role');await db.exec("update public.catalog_items set base_options='{\"attack\":999}'");await db.exec(`set role authenticated;set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'`);assert.equal((await db.query('select * from trades')).rows[0].item_snapshot.base_options.attack,30);
await db.exec(`set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'`);assert.equal((await db.query('select * from trades')).rows.length,0);assert.equal((await db.query('select * from public.catalog_monsters')).rows.length,1);await assert.rejects(()=>apply(after,[]),/다른 곳/);
await db.exec('set role anon');await assert.rejects(()=>apply([],[]),/permission denied/);
// 같은 사용자의 동시 수정도 덮어쓰지 않으며, 미기록 구버전 거래의 저장도 유지한다.
await db.exec(`set role authenticated;set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'`);
await db.exec(`update public.trades set item_options='{"attack":99}'`);
await assert.rejects(()=>apply(saved.after,saved.before,true),/다른 곳/);
assert.equal((await db.query('select * from trades')).rows[0].item_options.attack,99);
const legacy={id:'10000000-0000-0000-0000-000000000002',name:'직접 입력',buy_price:10,buy_qty:2,sell_price:null,sell_qty:0};
const old=await db.query('select public.replace_my_trades($1::jsonb,$2::jsonb,false) x',['[]',JSON.stringify([legacy])]);
assert.deepEqual(old.rows[0].x.after[0].item_options,{});
await assert.rejects(()=>db.exec(`insert into catalog_items(name,base_options) values ('조작','{}')`),/permission denied/);
await db.exec('reset role');
for (const value of [{attack:1.5},{unknown:1},{remaining_upgrades:-1},{attack:'문자'}]) {
  assert.equal((await db.query('select public.valid_item_options($1::jsonb) valid',[JSON.stringify(value)])).rows[0].valid,false);
}
await db.exec(`update public.catalog_monsters set hp=99;update public.catalog_monster_reviews set status='resolved'`);
await db.exec(sql);
assert.equal((await db.query('select hp from public.catalog_monsters')).rows[0].hp,99);
assert.equal((await db.query('select status from public.catalog_monster_reviews')).rows[0].status,'resolved');
console.log('SQL: 재실행·비충돌 이전/충돌 보류·원본 보존·공용 읽기/쓰기 차단·개인 RLS·옵션 저장/취소·스냅샷 독립·오류 롤백 통과');await db.close();
