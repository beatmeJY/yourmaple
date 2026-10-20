-- 거래 저장·마지막 저장 취소를 한 트랜잭션에서 처리합니다. 다시 실행해도 안전합니다.
-- Supabase SQL Editor에서 이 파일을 실행한 뒤 새 거래 저장 기능을 사용하세요.
create or replace function public.replace_my_trades(
  expected jsonb,
  replacement jsonb,
  restore_times boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  affected uuid[];
  current_rows jsonb;
  expected_rows jsonb;
  result_rows jsonb;
begin
  if me is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  if expected is null or replacement is null
     or jsonb_typeof(expected) <> 'array' or jsonb_typeof(replacement) <> 'array' then
    raise exception '거래 변경 형식이 올바르지 않습니다.';
  end if;
  if jsonb_array_length(expected) > 2 or jsonb_array_length(replacement) > 2 then
    raise exception '한 번에 마지막 거래 작업만 처리할 수 있습니다.';
  end if;
  select array_agg(distinct (v->>'id')::uuid) into affected
  from (select jsonb_array_elements(expected) v union all select jsonb_array_elements(replacement) v) changes;
  if affected is null or array_position(affected, null) is not null then
    raise exception '거래 식별자가 필요합니다.';
  end if;
  if (select count(distinct v->>'id') from jsonb_array_elements(expected) v) <> jsonb_array_length(expected)
    or (select count(distinct v->>'id') from jsonb_array_elements(replacement) v) <> jsonb_array_length(replacement) then
    raise exception '거래 식별자가 중복되었습니다.';
  end if;

  -- 잠근 뒤 비교한다. 다른 요청의 수정·삭제가 먼저 반영됐다면 복원하지 않는다.
  perform id from public.trades where user_id = me and id = any(affected) order by id for update;
  select coalesce(jsonb_agg(to_jsonb(t) - 'user_id' order by t.id), '[]'::jsonb)
    into current_rows from public.trades t where user_id = me and id = any(affected);
  -- timestamptz/bigint 등을 DB 형식으로 정규화해 JSON 문자열 표기 차이를 없앤다.
  select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) into expected_rows
  from jsonb_to_recordset(expected) as t(id uuid, name text, buy_price bigint, buy_qty integer,
    sell_price bigint, sell_qty integer, created_at timestamptz, updated_at timestamptz);
  if current_rows <> expected_rows then
    raise exception '다른 곳에서 거래가 변경되었습니다. 최신 목록을 확인한 뒤 다시 진행해 주세요.' using errcode = '40001';
  end if;

  -- 현재 trades를 참조하는 하위 테이블은 없다. 재삽입으로 최초 등록 시각까지 복원한다.
  -- RLS와 assign_user_id 트리거가 모두 적용되며 다른 사용자의 행은 처리할 수 없다.
  delete from public.trades where user_id = me and id = any(affected);
  insert into public.trades(id, user_id, name, buy_price, buy_qty, sell_price, sell_qty, created_at, updated_at)
  select t.id, me, t.name, t.buy_price, t.buy_qty, t.sell_price, t.sell_qty,
    coalesce(t.created_at, now()), case when restore_times then coalesce(t.updated_at, now()) else now() end
  from jsonb_to_recordset(replacement) as t(id uuid, name text, buy_price bigint, buy_qty integer,
    sell_price bigint, sell_qty integer, created_at timestamptz, updated_at timestamptz);
  select coalesce(jsonb_agg(to_jsonb(t) - 'user_id' order by t.id), '[]'::jsonb)
    into result_rows from public.trades t where user_id = me and id = any(affected);
  return jsonb_build_object('before', current_rows, 'after', result_rows);
end;
$$;

revoke all on function public.replace_my_trades(jsonb, jsonb, boolean) from public, anon;
grant execute on function public.replace_my_trades(jsonb, jsonb, boolean) to authenticated;
