import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const root=new URL('..',import.meta.url).pathname; const db=new PGlite();
try {
await db.exec(`create schema auth;create role anon;create role authenticated;create role service_role bypassrls;
create table auth.users(id uuid primary key,email_confirmed_at timestamptz,email text);
insert into auth.users values ('00000000-0000-0000-0000-000000000001',now(),'owner@example.test'),('00000000-0000-0000-0000-000000000002',now(),'other@example.test'),('00000000-0000-0000-0000-000000000003',null,'pending@example.test');
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
create function public.assign_user_id() returns trigger language plpgsql as $$begin new.user_id:=auth.uid();return new;end$$;
create function public.touch_updated_at() returns trigger language plpgsql as $$begin new.updated_at:=now();return new;end$$;`);
await db.exec(readFileSync(root+'/sql/006_trades.sql','utf8'));
const schema=readFileSync(root+'/sql/001_schema.sql','utf8');await db.exec(schema.slice(schema.indexOf('create table if not exists public.monsters ('),schema.indexOf('-- trades:')));
await db.exec(readFileSync(root+'/sql/038_shared_game_catalog.sql','utf8'));
const sql=readFileSync(root+'/sql/039_monster_sheet_import.sql','utf8');await db.exec(sql);await db.exec(sql);
const row={name:'스포아',level:2,hp:20,exp:5,required_accuracy:0,drop_items:'망체60'};
const apply=rows=>db.query('select public.import_catalog_monsters($1::jsonb) result',[JSON.stringify(rows)]).then(x=>x.rows[0].result);
const allowed=()=>db.query('select public.can_import_catalog_monsters() allowed').then(x=>x.rows[0].allowed);
await db.exec('set role anon');assert.equal(await allowed(),false);await assert.rejects(()=>apply([row]),/permission denied/);
await db.exec(`set role authenticated;set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'`);
assert.equal(await allowed(),false);await assert.rejects(()=>apply([row]),/권한/);
await db.exec(`reset role;insert into public.catalog_monster_import_admin(user_id,verified_email) values ('00000000-0000-0000-0000-000000000001','owner@example.test');set role authenticated;`);
assert.equal(await allowed(),true);
await db.exec("reset role;update auth.users set email='changed@example.test' where id=auth.uid();set role authenticated;");assert.equal(await allowed(),false);await assert.rejects(()=>apply([row]),/권한/);await db.exec("reset role;update auth.users set email='owner@example.test' where id=auth.uid();set role authenticated;");
assert.deepEqual(await apply([row]),{inserted:1,unchanged:0,conflicts:[]});
assert.deepEqual(await apply([row]),{inserted:0,unchanged:1,conflicts:[]});
assert.deepEqual(await apply([{...row,hp:99}]),{inserted:0,unchanged:0,conflicts:['스포아']});
assert.equal((await db.query('select hp,hp_per_exp from catalog_monsters')).rows[0].hp,20);
assert.equal((await db.query('select hp_per_exp from catalog_monsters')).rows[0].hp_per_exp,'4.0000');
await assert.rejects(()=>db.exec("insert into public.catalog_monsters(name) values ('직접쓰기')"),/permission denied/);
await assert.rejects(()=>db.exec('select * from public.catalog_monster_import_admin'),/permission denied/);
await assert.rejects(()=>db.exec("update public.catalog_monster_import_admin set user_id='00000000-0000-0000-0000-000000000002'"),/permission denied/);
for(const rows of [[{...row,name:'새이름'},{...row,name:'잘못됨',hp:-1}], [{...row,name:'새이름'},{...row,name:'새 이름'}], [{...row,name:'',hp:2}], [{...row,source:'forged'}], [{...row,required_accuracy:null}], Array(501).fill(row)]) {
 await assert.rejects(()=>apply(rows));assert.equal((await db.query('select count(*)::int n from catalog_monsters')).rows[0].n,1);
}
await db.exec(`set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'`);assert.equal(await allowed(),false);await assert.rejects(()=>apply([row]),/권한/);
// JWT 메타데이터를 조작해도 서버 등록표/인증 테이블을 사용하므로 권한이 생기지 않습니다.
await db.exec(`set request.jwt.claims='{"email":"forged","user_metadata":{"admin":true}}'`);await assert.rejects(()=>apply([row]),/권한/);
await db.exec(`reset role;update catalog_monster_import_admin set user_id='00000000-0000-0000-0000-000000000003';set role authenticated;set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003'`);
assert.equal(await allowed(),false);await assert.rejects(()=>apply([row]),/권한/);
await db.exec(`reset role;update catalog_monster_import_admin set user_id='00000000-0000-0000-0000-000000000001'`);await db.exec(sql);
assert.equal((await db.query('select count(*)::int n from catalog_monster_import_admin')).rows[0].n,1);
console.log('SQL039: 재실행·운영자단독·미인증/일반/익명차단·직접쓰기/권한승격차단·동일/충돌보존·입력검증/원자적롤백 통과');
}finally{await db.close();}
