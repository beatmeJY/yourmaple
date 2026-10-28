-- 043~045 이후 실행합니다. 공용 원본은 catalog_monsters로 통일합니다.
-- 수동 도감은 비공개 백업으로 옮기고, 외부 ID가 다른 동명 몬스터는 별개로 유지합니다.
begin;
select pg_advisory_xact_lock(20261028,43);
lock table public.catalog_monsters,public.catalog_monster_drops in share row exclusive mode;
create schema if not exists catalog_import_private;
revoke all on schema catalog_import_private from public,anon,authenticated;
create table if not exists catalog_import_private.catalog_cleanup_backup (
  table_name text not null, row_id uuid not null, row_data jsonb not null,
  primary key(table_name,row_id)
);
revoke all on catalog_import_private.catalog_cleanup_backup from public,anon,authenticated;
do $$ begin
  if not exists(select 1 from catalog_import_private.completed_migrations where name='046_catalog_cleanup') then
    insert into catalog_import_private.catalog_cleanup_backup
    select 'catalog_monsters',id,to_jsonb(m) from public.catalog_monsters m;
    insert into catalog_import_private.catalog_cleanup_backup
    select 'catalog_monster_drops',id,to_jsonb(d) from public.catalog_monster_drops d;
    -- 수집 이외 출처가 새로 생겼다면 임의 삭제하지 않습니다.
    if exists(select 1 from public.catalog_monsters where source is null or source not in ('operator-sheet','legacy','collected')) then
      raise exception '예상하지 못한 몬스터 출처: 운영 검토 필요';
    end if;
    -- 개인 monsters는 운영 확인 시 0행. 값이 생겼다면 삭제하지 않고 중단합니다.
    if to_regclass('public.monsters') is not null then
      execute 'lock table public.monsters in access exclusive mode';
      if exists(select 1 from public.monsters) then raise exception '구 monsters에 데이터가 있어 정리를 중단합니다'; end if;
      drop table public.monsters;
    end if;
    -- 수동 명중값은 같은 이름의 수집 결과가 정확히 하나일 때만 이어받습니다.
    with pairs as (
      select old.id old_id,min(new.id::text)::uuid new_id,count(*) n
      from public.catalog_monsters old join public.catalog_monsters new
      on regexp_replace(old.name,'[[:space:]]','','g')=regexp_replace(new.source_data->'import_payload'->>'name','[[:space:]]','','g')
      and new.source='collected' where old.source in ('operator-sheet','legacy') group by old.id
    )
    update public.catalog_monsters m set required_accuracy=o.required_accuracy,accuracy_per_level=o.accuracy_per_level
    from pairs p,public.catalog_monsters o where p.n=1 and o.id=p.old_id and m.id=p.new_id;
    -- 수동 행에 새 참조가 생겼으면 FK로 중단합니다. CASCADE 삭제는 사용하지 않습니다.
    delete from public.catalog_monsters where source in ('operator-sheet','legacy');
    insert into catalog_import_private.completed_migrations(name) values('046_catalog_cleanup');
  end if;
end $$;
-- 이름은 식별자가 아닙니다. 같은 이름의 다른 외부 ID를 허용합니다.
alter table public.catalog_monsters drop constraint if exists catalog_monsters_name_key;
update public.catalog_monsters set name=source_data->'import_payload'->>'name',
 source_data=jsonb_set(source_data,'{import_payload}',(source_data->'import_payload')-'drop_items')
where source='collected' and source_data->'import_payload'->>'name' is not null;
-- 수동 문자열을 다시 쓰는 구 운영자 RPC를 폐기합니다. 구 화면에서는 버튼이 나타나지 않습니다.
drop function if exists public.import_catalog_monsters(jsonb);
create or replace function public.can_import_catalog_monsters() returns boolean language sql security invoker set search_path='' as $$ select false $$;
alter table public.catalog_monsters drop column if exists drop_items;
comment on table public.catalog_monsters is '공용 몬스터 원본. 외부 식별자는 (source, source_id), 내부 참조는 UUID id. 구 개인 monsters는 폐기';
create or replace function public.import_catalog_batch(kind text, rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  r jsonb; old jsonb; body jsonb; payload jsonb;
  mid uuid; iid uuid; inserted integer:=0; skipped integer:=0; updated integer:=0; existed boolean;
  src constant text:='collected';
begin
  if kind is null or kind not in ('items','monsters','drops') or rows is null or jsonb_typeof(rows)<>'array'
    or jsonb_array_length(rows)>500 then raise exception '배치 형식 오류'; end if;
  -- SQL Editor 두 창에서 동시에 실행해도 이름 선택/검증이 어긋나지 않게 직렬화합니다.
  perform pg_advisory_xact_lock(20261028,43);
  for r in select value from jsonb_array_elements(rows) loop
    existed:=false;
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
      if kind='monsters' then body:=body-'drop_items'; end if;
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
        select exists(select 1 from public.catalog_monsters where source=src and source_id=r->>'source_id') into existed;
        -- 같은 외부 ID는 기존 행을 갱신하며 UUID와 드랍 참조를 유지합니다.
        insert into public.catalog_monsters(name,level,hp,exp,image_url,source,source_id,source_url,source_data)
        values(r->>'name',(r->>'level')::integer,(r->>'hp')::bigint,(r->>'exp')::bigint,r->>'image_url',src,r->>'source_id',r->>'source_url',
          (r->'source_data')||jsonb_build_object('import_payload',payload))
        on conflict(source,source_id) where source_id is not null do update
        set name=excluded.name,level=excluded.level,hp=excluded.hp,exp=excluded.exp,image_url=excluded.image_url,
            source_url=excluded.source_url,source_data=excluded.source_data;
        -- 이번에 확보한 전체 드랍 목록에서 사라진 항목만 제거합니다.
        -- 드랍 영역 자체가 미제공이면 기존 연결을 임의로 지우지 않습니다.
        if r->'source_data'->>'drop_section_present'='true' and jsonb_typeof(r->'drops')='array' then
          delete from public.catalog_monster_drops d where d.source=src and d.monster_source_id=r->>'source_id'
          and not exists(select 1 from jsonb_array_elements(r->'drops') e where (e->>'entry')::integer=d.source_entry);
        end if;


      end if;
    else
      if r->>'monster_source_id' is null or r->>'item_source_id' is null
        or r->>'monster_source_id' !~ '^[0-9]+$' or r->>'item_source_id' !~ '^[0-9]+$'
        or r->>'entry' is null or r->>'entry' !~ '^[0-9]+$'
        or r->>'rate_text' is null or not (r ? 'rate_percent') then raise exception '드랍 필수 값 오류'; end if;
      select id into mid from public.catalog_monsters where source=src and source_id=r->>'monster_source_id';
      select id into iid from public.catalog_items where source=src and source_id=r->>'item_source_id';
      if mid is null or iid is null then raise exception '드랍 연결 누락: %/%',r->>'monster_source_id',r->>'item_source_id'; end if;
      select exists(select 1 from public.catalog_monster_drops where source=src and monster_source_id=r->>'monster_source_id' and source_entry=(r->>'entry')::integer) into existed;
      insert into public.catalog_monster_drops(monster_id,item_id,source,monster_source_id,source_entry,rate_percent,rate_text,source_url)
      values(mid,iid,src,r->>'monster_source_id',(r->>'entry')::integer,(r->>'rate_percent')::numeric,r->>'rate_text',
        'https://source.invalid/monster_detail/'||(r->>'monster_source_id'))
      on conflict(source,monster_source_id,source_entry) do update
      set monster_id=excluded.monster_id,item_id=excluded.item_id,rate_percent=excluded.rate_percent,rate_text=excluded.rate_text,source_url=excluded.source_url;
    end if;
    if existed then updated:=updated+1; else inserted:=inserted+1; end if;
  end loop;
  return jsonb_build_object('kind',kind,'inserted',inserted,'skipped',skipped,'updated',updated);
end $$;
revoke all on function public.import_catalog_batch(text,jsonb) from public,anon,authenticated;
grant execute on function public.import_catalog_batch(text,jsonb) to service_role;

commit;
