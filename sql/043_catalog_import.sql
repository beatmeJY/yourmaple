-- 038 적용 후 운영자가 SQL Editor에서 전체 실행합니다. 브라우저에는 쓰기 권한을 열지 않습니다.
-- 기존 도감/거래/개인 기록을 삭제하지 않습니다. 외부 ID는 source_id로 보존합니다.
begin;
alter table public.catalog_items add column if not exists source_data jsonb not null default '{}'::jsonb;
alter table public.catalog_monsters add column if not exists source_data jsonb not null default '{}'::jsonb;
create table if not exists public.catalog_monster_drops (
  id uuid primary key default gen_random_uuid(),
  monster_id uuid not null references public.catalog_monsters(id) on delete restrict,
  item_id uuid not null references public.catalog_items(id) on delete restrict,
  source text not null,
  monster_source_id text not null,
  source_entry integer not null check(source_entry>=0),
  rate_percent numeric check(rate_percent between 0 and 100),
  rate_text text not null,
  source_url text not null check(source_url ~ '^https://'),
  created_at timestamptz not null default now(),
  unique(source,monster_source_id,source_entry)
);
create index if not exists catalog_monster_drops_monster_idx on public.catalog_monster_drops(monster_id);
create index if not exists catalog_monster_drops_item_idx on public.catalog_monster_drops(item_id);
alter table public.catalog_monster_drops enable row level security;
revoke all on public.catalog_monster_drops from public,anon,authenticated;
grant select on public.catalog_monster_drops to anon,authenticated;
grant all on public.catalog_monster_drops to service_role;
drop policy if exists catalog_read on public.catalog_monster_drops;
create policy catalog_read on public.catalog_monster_drops for select to anon,authenticated using(true);

-- SQL Editor용 함수. SECURITY INVOKER이며 anon/authenticated는 실행 불가합니다.
-- 같은 출처 ID의 내용이 달라지면 덮어쓰지 않고 배치 전체를 중단합니다.
create or replace function public.import_catalog_batch(kind text, rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  r jsonb; old jsonb; body jsonb; payload jsonb; chosen_name text;
  mid uuid; iid uuid; inserted integer:=0; skipped integer:=0;
  src constant text:='collected';
begin
  if kind is null or kind not in ('items','monsters','drops') or rows is null or jsonb_typeof(rows)<>'array'
    or jsonb_array_length(rows)>500 then raise exception '배치 형식 오류'; end if;
  -- SQL Editor 두 창에서 동시에 실행해도 이름 선택/검증이 어긋나지 않게 직렬화합니다.
  perform pg_advisory_xact_lock(20261028,43);
  for r in select value from jsonb_array_elements(rows) loop
    if kind in ('items','monsters') then
      if r->>'source_id' is null or r->>'source_id' !~ '^[0-9]+$'
        or nullif(btrim(r->>'name'),'') is null
        or r->>'source_url' <> 'https://source.invalid/' || (case when kind='items' then 'item' else 'monster' end) || '_detail/' || (r->>'source_id')
        or jsonb_typeof(r->'source_data') is distinct from 'object'
        or jsonb_typeof(r->'image_url') not in ('null','string')
        or (r->>'image_url' is not null and r->>'image_url' !~ '^https://') then
        raise exception '도감 필수 값 오류: %',r->>'source_id';
      end if;
      body:=r-'drops';
      -- 수집 시각은 내용 충돌 판단에서 제외하지만 저장은 유지합니다.
      payload:=jsonb_set(body,'{source_data}',(body->'source_data')-'collected_at'-'html_sha256');
      if kind='items' then
        if not public.valid_item_options(r->'base_options')
          or jsonb_typeof(r->'requirements') is distinct from 'object'
          or nullif(btrim(r->>'category'),'') is null then raise exception '아이템 옵션 형식 오류'; end if;
        select source_data->'import_payload' into old from public.catalog_items where source=src and source_id=r->>'source_id';
        if found then
          if old is distinct from payload then raise exception '기존 아이템 내용 충돌: %',r->>'source_id'; end if;
          skipped:=skipped+1; continue;
        end if;
        insert into public.catalog_items(name,category,base_options,requirements,image_url,source,source_id,source_url,source_data)
        values(r->>'name',r->>'category',r->'base_options',r->'requirements',r->>'image_url',src,r->>'source_id',r->>'source_url',
          (r->'source_data')||jsonb_build_object('import_payload',payload));
      else
        if (r->>'level')::numeric<1 or (r->>'hp')::numeric<0 or (r->>'exp')::numeric<0
          or not (r ? 'level' and r ? 'hp' and r ? 'exp') then raise exception '몬스터 수치 오류'; end if;
        select source_data->'import_payload' into old from public.catalog_monsters where source=src and source_id=r->>'source_id';
        if found then
          if old is distinct from payload then raise exception '기존 몬스터 내용 충돌: %',r->>'source_id'; end if;
          skipped:=skipped+1; continue;
        end if;
        chosen_name:=r->>'name';
        -- 기존 수동 몬스터와 동명 몬스터는 자동 합치지 않습니다. 원본 이름은 payload에 보존합니다.
        if exists(select 1 from public.catalog_monsters where name=chosen_name) then
          chosen_name:=chosen_name||' [수집처 '||(r->>'source_id')||']';
        end if;
        insert into public.catalog_monsters(name,level,hp,exp,drop_items,image_url,source,source_id,source_url,source_data)
        values(chosen_name,(r->>'level')::integer,(r->>'hp')::bigint,(r->>'exp')::bigint,r->>'drop_items',r->>'image_url',src,r->>'source_id',r->>'source_url',
          (r->'source_data')||jsonb_build_object('import_payload',payload));
      end if;
    else
      if r->>'monster_source_id' is null or r->>'item_source_id' is null
        or r->>'monster_source_id' !~ '^[0-9]+$' or r->>'item_source_id' !~ '^[0-9]+$'
        or r->>'entry' is null or r->>'entry' !~ '^[0-9]+$'
        or r->>'rate_text' is null or not (r ? 'rate_percent') then raise exception '드랍 필수 값 오류'; end if;
      select id into mid from public.catalog_monsters where source=src and source_id=r->>'monster_source_id';
      select id into iid from public.catalog_items where source=src and source_id=r->>'item_source_id';
      if mid is null or iid is null then raise exception '드랍 연결 누락: %/%',r->>'monster_source_id',r->>'item_source_id'; end if;
      select jsonb_build_object('monster_id',monster_id,'item_id',item_id,'rate_percent',rate_percent,'rate_text',rate_text)
        into old from public.catalog_monster_drops where source=src and monster_source_id=r->>'monster_source_id' and source_entry=(r->>'entry')::integer;
      payload:=jsonb_build_object('monster_id',mid,'item_id',iid,'rate_percent',(r->>'rate_percent')::numeric,'rate_text',r->>'rate_text');
      if found then
        if old is distinct from payload then raise exception '기존 드랍 내용 충돌: %/%',r->>'monster_source_id',r->>'entry'; end if;
        skipped:=skipped+1; continue;
      end if;
      insert into public.catalog_monster_drops(monster_id,item_id,source,monster_source_id,source_entry,rate_percent,rate_text,source_url)
      values(mid,iid,src,r->>'monster_source_id',(r->>'entry')::integer,(r->>'rate_percent')::numeric,r->>'rate_text',
        'https://source.invalid/monster_detail/'||(r->>'monster_source_id'));
    end if;
    inserted:=inserted+1;
  end loop;
  return jsonb_build_object('kind',kind,'inserted',inserted,'skipped',skipped);
end $$;
revoke all on function public.import_catalog_batch(text,jsonb) from public,anon,authenticated;
grant execute on function public.import_catalog_batch(text,jsonb) to service_role;
commit;
