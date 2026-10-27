-- 038 적용 후 전체 실행합니다. 운영자 계정 지정은 README의 별도 SQL을 따릅니다.
-- 이메일·사용자 ID는 공개 저장소에 넣지 않습니다. 지정 전에는 모두 등록 불가입니다.
begin;
create table if not exists public.catalog_monster_import_admin (
  singleton boolean primary key default true check(singleton),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  verified_email text not null check (btrim(verified_email) <> '')
);
alter table public.catalog_monster_import_admin enable row level security;
revoke all on public.catalog_monster_import_admin from public, anon, authenticated;
grant all on public.catalog_monster_import_admin to service_role;

create or replace function public.can_import_catalog_monsters()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.catalog_monster_import_admin a
    join auth.users u on u.id=a.user_id
    where a.user_id=auth.uid() and u.email_confirmed_at is not null
      and lower(u.email)=lower(a.verified_email));
$$;
revoke all on function public.can_import_catalog_monsters() from public;
grant execute on function public.can_import_catalog_monsters() to anon, authenticated;

create or replace function public.import_catalog_monsters(rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; k text; n text; seen text[] := '{}'; inserted integer := 0; unchanged integer := 0;
  conflicts jsonb := '[]'; saved public.catalog_monsters%rowtype; new_id uuid;
begin
  if not public.can_import_catalog_monsters() then
    raise exception '몬스터 등록 권한이 없습니다.' using errcode='42501';
  end if;
  if rows is null or jsonb_typeof(rows)<>'array' then raise exception '표 형식이 올바르지 않습니다.'; end if;
  if jsonb_array_length(rows)<1 or jsonb_array_length(rows)>500 then raise exception '한 번에 1~500행만 등록할 수 있습니다.'; end if;
  for r in select value from jsonb_array_elements(rows) loop
    if jsonb_typeof(r)<>'object' then raise exception '행 형식이 올바르지 않습니다.'; end if;
    if exists(select 1 from jsonb_object_keys(r) f where f not in ('name','level','hp','exp','required_accuracy','drop_items')) then
      raise exception '지원하지 않는 열입니다.';
    end if;
    n := regexp_replace(r->>'name', '[[:space:]' || chr(8203) || chr(8204) || chr(8205) || chr(12288) || chr(160) || ']', '', 'g');
    if jsonb_typeof(r->'name') is distinct from 'string' or n is null or length(n) not between 1 and 100 then raise exception '몬스터 이름이 필요합니다.'; end if;
    if n=any(seen) then raise exception '파일에 같은 몬스터 이름이 중복되었습니다.'; end if;
    seen := array_append(seen,n);
    foreach k in array array['level','hp','exp','required_accuracy'] loop
      if jsonb_typeof(r->k) is distinct from 'number' then raise exception '레벨·HP·경험치·명중률은 숫자여야 합니다.'; end if;
      if (r->>k)::numeric < 0 or (r->>k)::numeric > 9007199254740991 then raise exception '숫자 범위를 확인해 주세요.'; end if;
      if k<>'required_accuracy' and (r->>k)::numeric <> trunc((r->>k)::numeric) then raise exception '레벨·HP·경험치는 정수여야 합니다.'; end if;
    end loop;
    if (r->>'level')::numeric not between 1 and 2147483647 then raise exception '레벨 범위를 확인해 주세요.'; end if;
    if jsonb_typeof(r->'drop_items') is distinct from 'string' and jsonb_typeof(r->'drop_items') is distinct from 'null' then raise exception '드랍템 열이 필요합니다.'; end if;
    if length(r->>'drop_items')>2000 then raise exception '드랍템 설명이 너무 깁니다.'; end if;
    new_id := null;
    insert into public.catalog_monsters(name,level,hp,exp,required_accuracy,drop_items,source)
    values(n,(r->>'level')::integer,(r->>'hp')::bigint,(r->>'exp')::bigint,(r->>'required_accuracy')::numeric,
      case when upper(btrim(r->>'drop_items'))='X' then null else nullif(btrim(r->>'drop_items'),'') end,'operator-sheet')
    on conflict(name) do nothing returning id into new_id;
    if new_id is not null then inserted := inserted+1;
    else
      select * into saved from public.catalog_monsters where name=n;
      if saved.level is not distinct from (r->>'level')::integer
        and saved.hp is not distinct from (r->>'hp')::bigint
        and saved.exp is not distinct from (r->>'exp')::bigint
        and saved.required_accuracy is not distinct from (r->>'required_accuracy')::numeric
        and nullif(btrim(saved.drop_items),'') is not distinct from
          (case when upper(btrim(r->>'drop_items'))='X' then null else nullif(btrim(r->>'drop_items'),'') end)
      then unchanged := unchanged+1;
      else conflicts := conflicts || jsonb_build_array(n);
      end if;
    end if;
  end loop;
  return jsonb_build_object('inserted',inserted,'unchanged',unchanged,'conflicts',conflicts);
end;
$$;
revoke all on function public.import_catalog_monsters(jsonb) from public, anon;
grant execute on function public.import_catalog_monsters(jsonb) to authenticated;
commit;
