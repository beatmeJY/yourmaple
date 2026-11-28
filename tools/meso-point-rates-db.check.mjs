// sql/082 검사(PGlite): 시세 기록은 본인 행만 읽고 쓰고 지우며, 비로그인은 막히고 범위 밖 값은 거절된다.
process.on("uncaughtException", (error) => { console.error(error.stack); process.exit(1); });
import fs from "node:fs";
import assert from "node:assert/strict";
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
// Supabase 흉내: auth.users·auth.uid()(시험용 설정값)
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;`);
const base = fs.readFileSync("sql/001_schema.sql", "utf8");
await db.exec(base.slice(base.indexOf("create or replace function public.assign_user_id()"), base.indexOf("create or replace function public.handle_new_user()")));
await db.exec("grant execute on function public.assign_user_id() to authenticated");
const sql = fs.readFileSync("sql/082_meso_point_rates.sql", "utf8");
await db.exec(sql);
await db.exec(sql); // 다시 실행해도 안전

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
await db.query("insert into auth.users values ($1), ($2)", [A, B]);
const as = async (role, uid, fn) => {
  await db.exec(`set role ${role}; set test.uid = '${uid}'`);
  try { return await fn(); } finally { await db.exec("reset role; reset test.uid"); }
};
const insert = (exchange, cash, memo = null, userId = null) =>
  db.query("insert into meso_point_rates(exchange_meso, cash_won, memo, user_id) values ($1, $2, $3, $4) returning *", [exchange, cash, memo, userId]);

// 비로그인은 읽기·쓰기 모두 막힘
await as("anon", "", async () => {
  await assert.rejects(db.query("select * from meso_point_rates"), /permission denied/);
  await assert.rejects(insert(30000000, 300), /permission denied/);
});

// user_id 는 트리거가 본인으로 채운다(남의 id 를 넣어도 본인)
const rowA = (await as("authenticated", A, () => insert(30000000, 300, "  첫 기록", B))).rows[0];
assert.equal(rowA.user_id, A);
await as("authenticated", A, () => insert(32000000, 310));
await as("authenticated", B, () => insert(29000000, 280));

// 본인 행만 보인다
const mine = await as("authenticated", A, () => db.query("select exchange_meso, cash_won from meso_point_rates order by created_at"));
assert.equal(mine.rows.length, 2);
assert.equal((await as("authenticated", B, () => db.query("select * from meso_point_rates"))).rows.length, 1);

// 남의 행은 지우지도 고치지도 못한다(0행)
const delOther = await as("authenticated", B, () => db.query("delete from meso_point_rates where id = $1", [rowA.id]));
assert.equal(delOther.affectedRows, 0);
const updOther = await as("authenticated", B, () => db.query("update meso_point_rates set cash_won = 1 where id = $1", [rowA.id]));
assert.equal(updOther.affectedRows, 0);
// 고쳐도 user_id 는 그대로
await as("authenticated", A, () => db.query("update meso_point_rates set user_id = $2 where id = $1", [rowA.id, B]));
assert.equal((await db.query("select user_id from meso_point_rates where id = $1", [rowA.id])).rows[0].user_id, A);

// 범위 검사: 0·음수·너무 큰 값·긴 메모 거절
await as("authenticated", A, async () => {
  await assert.rejects(insert(0, 300), /exchange_check/);
  await assert.rejects(insert(30000000, 0), /cash_check/);
  await assert.rejects(insert(30000000, 1000001), /cash_check/);
  await assert.rejects(insert("1000000000001", 300), /exchange_check/);
  await assert.rejects(insert(30000000, 300, "가".repeat(101)), /memo_check/);
  await insert(30000000, 300, "가".repeat(100));
});

// 본인 행 삭제, 계정이 지워지면 기록도 함께
const delMine = await as("authenticated", A, () => db.query("delete from meso_point_rates where id = $1", [rowA.id]));
assert.equal(delMine.affectedRows, 1);
await db.query("delete from auth.users where id = $1", [B]);
assert.equal((await db.query("select count(*)::int n from meso_point_rates where user_id = $1", [B])).rows[0].n, 0);

console.log("082 시세 기록: 두 번 실행, 비로그인 거절, user_id 본인 고정, 본인 행만 읽기/수정/삭제, 범위·메모 100자 검사, 계정 삭제 시 함께 삭제 통과");
await db.close();
