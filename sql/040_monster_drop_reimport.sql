-- 039 적용 후 전체 실행합니다. 권한은 기존의 단일 지정 운영자로 유지합니다.
-- 기존 능력치·기존 비어 있지 않은 드랍은 덮어쓰지 않습니다.
begin;
create or replace function public.normalize_catalog_monster_drops(value text)
returns text language sql immutable set search_path='' as $$
  with tokens as (
    select array(select part from regexp_split_to_table(coalesce(value,''),'[[:space:],·/' || chr(160) || chr(12288) || ']+' ) part where part<>'') items
  )
  select case when cardinality(items)=0 or (cardinality(items)=1 and lower(items[1]) in ('x','-','없음')) then null
    else array_to_string(items, ', ') end from tokens;
$$;
revoke all on function public.normalize_catalog_monster_drops(text) from public;
create or replace function public.import_catalog_monsters(rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; k text; n text; seen text[] := '{}'; inserted integer := 0; unchanged integer := 0; filled integer := 0;
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
      public.normalize_catalog_monster_drops(r->>'drop_items'),'operator-sheet')
    on conflict(name) do nothing returning id into new_id;
    if new_id is not null then inserted := inserted+1;
    else
      select * into saved from public.catalog_monsters where name=n for update;
      if saved.level is not distinct from (r->>'level')::integer
        and saved.hp is not distinct from (r->>'hp')::bigint
        and saved.exp is not distinct from (r->>'exp')::bigint
        and saved.required_accuracy is not distinct from (r->>'required_accuracy')::numeric
      then
        if public.normalize_catalog_monster_drops(saved.drop_items) is not distinct from public.normalize_catalog_monster_drops(r->>'drop_items') then
          unchanged := unchanged+1;
        elsif public.normalize_catalog_monster_drops(saved.drop_items) is null and public.normalize_catalog_monster_drops(r->>'drop_items') is not null then
          update public.catalog_monsters set drop_items=public.normalize_catalog_monster_drops(r->>'drop_items') where id=saved.id;
          filled := filled+1;
        else conflicts := conflicts || jsonb_build_array(n);
        end if;
      else conflicts := conflicts || jsonb_build_array(n);
      end if;
    end if;
  end loop;
  return jsonb_build_object('inserted',inserted,'filled',filled,'unchanged',unchanged,'conflicts',conflicts);
end;
$$;
revoke all on function public.import_catalog_monsters(jsonb) from public, anon;
grant execute on function public.import_catalog_monsters(jsonb) to authenticated;
commit;
