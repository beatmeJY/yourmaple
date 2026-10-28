-- 046 이후 SQL Editor에서 전체 실행합니다. 서버 검색/개별 상세/공개 변경 이력/비공개 복구 원문.
begin;
select pg_advisory_xact_lock(20261028,43);
create table if not exists public.catalog_revision (
 singleton boolean primary key default true check(singleton), revision bigint not null default 1,
 updated_at timestamptz not null default now()
);
insert into public.catalog_revision(singleton) values(true) on conflict do nothing;
create table if not exists public.catalog_changes (
 id bigint generated always as identity primary key,
 entity_type text not null, entity_id uuid not null, entity_name text not null,
 operation text not null, changes jsonb not null, release_label text,
 changed_at timestamptz not null default now()
);
create index if not exists catalog_changes_entity_idx on public.catalog_changes(entity_type,entity_id,id desc);
create index if not exists catalog_changes_recent_idx on public.catalog_changes(id desc);
create table if not exists catalog_import_private.change_backups (
 change_id bigint primary key references public.catalog_changes(id) on delete restrict,
 table_name text not null, old_row jsonb, new_row jsonb
);
revoke all on catalog_import_private.change_backups from public,anon,authenticated;
do $$ declare t text; begin
 foreach t in array array['catalog_revision','catalog_changes'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('drop policy if exists catalog_read on public.%I',t);
  execute format('create policy catalog_read on public.%I for select to anon,authenticated using(true)',t);
 end loop;
end $$;
-- 기존 복합 키는 외부 ID 유일성, 아래 인덱스는 정렬/아이템별 드랍 검색에 사용합니다.
create index if not exists catalog_monsters_level_name_id_idx on public.catalog_monsters(level,name,id);
create index if not exists catalog_monsters_eff_id_idx on public.catalog_monsters(hp_per_exp,id);
create index if not exists catalog_drops_item_monster_idx on public.catalog_monster_drops(item_id,monster_id);
create index if not exists catalog_items_level_name_id_idx on public.catalog_items(required_level,name,id);

create or replace function public.catalog_search_monsters(
 p_query text default '', p_drop text default '', p_min integer default null, p_max integer default null,
 p_weak text[] default '{}', p_resist text[] default '{}', p_sort text default 'level', p_page integer default 0
) returns jsonb language sql stable security invoker set search_path='' as $$
 with filtered as (
 select m.id,m.name,m.level,m.hp,m.exp,m.required_accuracy,m.accuracy_per_level,m.hp_per_exp,m.weak_elements,m.resist_elements,m.image_url,m.source_id
 from public.catalog_monsters m
 where (coalesce(p_query,'')='' or strpos(lower(m.name),lower(p_query))>0 or m.source_id=p_query)
 and (p_min is null or m.level>=p_min) and (p_max is null or m.level<=p_max)
 and coalesce(p_weak,'{}') <@ coalesce(string_to_array(m.weak_elements,', '),'{}')
 and coalesce(p_resist,'{}') <@ coalesce(string_to_array(m.resist_elements,', '),'{}')
 and (coalesce(p_drop,'')='' or exists(select 1 from public.catalog_monster_drops d join public.catalog_items i on i.id=d.item_id
 where d.monster_id=m.id and (strpos(lower(i.name),lower(p_drop))>0 or i.source_id=p_drop)))
 ), page as (
 select * from filtered order by case when p_sort='eff' then hp_per_exp end asc nulls last,level asc nulls last,name,id
 limit 24 offset greatest(0,least(coalesce(p_page,0),10000))*24
 ) select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)) from page p),'[]'),
 'total',(select count(*) from filtered),'revision',(select revision from public.catalog_revision where singleton))
$$;
create or replace function public.catalog_search_items(p_query text default '',p_page integer default 0)
returns jsonb language sql stable security invoker set search_path='' as $$
 with filtered as (
 select id,name,category,middle_category,subcategory,required_level,image_url,source_id
 from public.catalog_items where coalesce(p_query,'')='' or strpos(lower(name),lower(p_query))>0
 or strpos(lower(category),lower(p_query))>0 or strpos(lower(coalesce(middle_category,'')),lower(p_query))>0 or source_id=p_query
 ), page as (
 select * from filtered order by required_level asc nulls last,name,id limit 24 offset greatest(0,least(coalesce(p_page,0),10000))*24
 ) select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)) from page p),'[]'),
 'total',(select count(*) from filtered),'revision',(select revision from public.catalog_revision where singleton))
$$;
create or replace function public.catalog_item_detail(p_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('item',jsonb_build_object('id',i.id,'name',i.name,'category',i.category,
 'middle_category',i.middle_category,'subcategory',i.subcategory,'required_level',i.required_level,'gender_restriction',i.gender_restriction,
 'attack_speed',i.attack_speed,'attack_speed_label',i.attack_speed_label,'shop_sell_price',i.shop_sell_price::text,
 'description',i.description,'effect_description',i.effect_description,'image_url',i.image_url,'source_id',i.source_id,'source_url',i.source_url),
 'stats',coalesce((select jsonb_agg(to_jsonb(s) order by stat_key) from public.catalog_item_stats s where s.item_id=i.id),'[]'),
 'requirements',coalesce((select jsonb_agg(to_jsonb(s) order by requirement_key) from public.catalog_item_requirements s where s.item_id=i.id),'[]'),
 'jobs',coalesce((select jsonb_agg(job_name order by job_name) from public.catalog_item_jobs s where s.item_id=i.id),'[]'),
 'attributes',coalesce((select jsonb_agg(to_jsonb(s) order by origin,entry_no) from public.catalog_item_source_attributes s where s.item_id=i.id),'[]'))
 from public.catalog_items i where i.id=p_id
$$;
-- 공개 이력에는 공개 도감의 변경 필드만, 복구 원문은 비공개 스키마에 보관합니다.
create or replace function public.record_catalog_change() returns trigger
language plpgsql security invoker set search_path='' as $$
declare before_row jsonb; after_row jsonb; a jsonb; b jsonb; diff jsonb; k text;
 entity uuid; label text; kind text; change_no bigint; allowed text[];
begin
 -- 정규화 함수가 같은 관계표를 재생성하는 과정은 부모 아이템 이력 한 건으로 처리합니다.
 if tg_table_name like 'catalog_item_%' and pg_trigger_depth()>1 then return null; end if;
 if tg_op<>'INSERT' then before_row:=to_jsonb(old); end if;
 if tg_op<>'DELETE' then after_row:=to_jsonb(new); end if;
 a:=coalesce(before_row,'{}'); b:=coalesce(after_row,'{}');
 if tg_table_name='catalog_items' then
  kind:='item';entity:=coalesce(b->>'id',a->>'id')::uuid;label:=coalesce(b->>'name',a->>'name');
  allowed:=array['name','category','middle_category','subcategory','required_level','gender_restriction','attack_speed','attack_speed_label','shop_sell_price','description','effect_description','base_options','requirements','image_url','source_url'];
  a:=a||jsonb_build_object('option_ranges',a#>'{source_data,option_ranges}','extra_effects',a#>'{source_data,other_effects}');b:=b||jsonb_build_object('option_ranges',b#>'{source_data,option_ranges}','extra_effects',b#>'{source_data,other_effects}');
  allowed:=allowed||array['option_ranges','extra_effects'];
 elsif tg_table_name='catalog_monsters' then
  kind:='monster';entity:=coalesce(b->>'id',a->>'id')::uuid;label:=coalesce(b->>'name',a->>'name');
  allowed:=array['name','level','hp','exp','required_accuracy','accuracy_per_level','weak_elements','resist_elements','image_url','source_url'];
 elsif tg_table_name='catalog_monster_drops' then
  kind:='monster';entity:=coalesce(b->>'monster_id',a->>'monster_id')::uuid;
  select name into label from public.catalog_monsters where id=entity;
  allowed:=array['item_id','rate_percent'];
 else
  kind:='item';entity:=coalesce(b->>'item_id',a->>'item_id')::uuid;
  select name into label from public.catalog_items where id=entity;
  allowed:=array['stat_key','base_value','minimum_value','maximum_value','requirement_key','required_value','job_name','attribute_name','value_text'];
 end if;
 diff:='{}';
 foreach k in array allowed loop
  if a->k is distinct from b->k then
   if k='shop_sell_price' then diff:=diff||jsonb_build_object(k,jsonb_build_object('before',a->>k,'after',b->>k));
   else diff:=diff||jsonb_build_object(k,jsonb_build_object('before',a->k,'after',b->k)); end if;
  end if;
 end loop;
 if diff='{}' then return null; end if;
 if tg_table_name='catalog_monster_drops' and diff ? 'item_id' then
  diff:=jsonb_set(diff,'{item_id}',jsonb_build_object(
   'before',(select name from public.catalog_items where id=(a->>'item_id')::uuid),
   'after',(select name from public.catalog_items where id=(b->>'item_id')::uuid)));
 end if;
 insert into public.catalog_changes(entity_type,entity_id,entity_name,operation,changes,release_label)
 values(kind,entity,coalesce(label,'삭제된 정보'),tg_op,diff,nullif(current_setting('yourmaple.release_label',true),'')) returning id into change_no;
 insert into catalog_import_private.change_backups(change_id,table_name,old_row,new_row)
 values(change_no,tg_table_name,before_row,after_row);
 update public.catalog_revision set revision=revision+1,updated_at=now() where singleton;
 return null;
end $$;
revoke all on function public.record_catalog_change() from public,anon,authenticated;
do $$ declare t text; begin
 foreach t in array array['catalog_items','catalog_monsters','catalog_monster_drops','catalog_item_stats','catalog_item_requirements','catalog_item_jobs','catalog_item_source_attributes'] loop
  execute format('drop trigger if exists catalog_change_log on public.%I',t);
  execute format('create trigger catalog_change_log after insert or update or delete on public.%I for each row execute function public.record_catalog_change()',t);
 end loop;
end $$;
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
        if found and old is not distinct from payload then skipped:=skipped+1; continue; end if;
        existed:=found;
        insert into public.catalog_items(name,category,base_options,requirements,image_url,source,source_id,source_url,source_data)
        values(r->>'name',r->>'category',r->'base_options',r->'requirements',r->>'image_url',src,r->>'source_id',r->>'source_url',
          (r->'source_data')||jsonb_build_object('import_payload',payload))
        on conflict(source,source_id) where source_id is not null do update
        set name=excluded.name,category=excluded.category,base_options=excluded.base_options,requirements=excluded.requirements,
         image_url=excluded.image_url,source_url=excluded.source_url,source_data=excluded.source_data;

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


revoke all on function public.catalog_search_monsters(text,text,integer,integer,text[],text[],text,integer) from public;
grant execute on function public.catalog_search_monsters(text,text,integer,integer,text[],text[],text,integer) to anon,authenticated,service_role;
revoke all on function public.catalog_search_items(text,integer) from public;
grant execute on function public.catalog_search_items(text,integer) to anon,authenticated,service_role;
revoke all on function public.catalog_item_detail(uuid) from public;
grant execute on function public.catalog_item_detail(uuid) to anon,authenticated,service_role;
grant usage on schema catalog_import_private to service_role;
grant select,insert on catalog_import_private.change_backups to service_role;
grant usage,select on sequence public.catalog_changes_id_seq to service_role;
insert into catalog_import_private.completed_migrations(name) values('047_catalog_search_history') on conflict do nothing;
-- 운영 DB가 비교 기준에서 달라졌다면 변경 전체를 중단합니다. 익명/일반 사용자 실행 금지.
create or replace function public.assert_catalog_release(p_expected jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare r jsonb; actual jsonb; drops jsonb;
begin
 if jsonb_typeof(p_expected)<>'array' then raise exception '비교 기준 형식 오류'; end if;
 for r in select value from jsonb_array_elements(p_expected) loop
  if r->>'kind'='items' then
   select source_data->'import_payload' into actual from public.catalog_items where source='collected' and source_id=r->>'source_id';
  elsif r->>'kind'='monsters' then
   select source_data->'import_payload' into actual from public.catalog_monsters where source='collected' and source_id=r->>'source_id';
   select coalesce(jsonb_agg(jsonb_build_object('entry',d.source_entry,'item_source_id',i.source_id,'rate_percent',d.rate_percent::text,'rate_text',d.rate_text) order by d.source_entry),'[]')
    into drops from public.catalog_monster_drops d join public.catalog_items i on i.id=d.item_id
    where d.source='collected' and d.monster_source_id=r->>'source_id';
   -- JSON 숫자/문자 표기의 차이를 없애고 확률은 숫자로 비교합니다.
   if r->'drops'<>'null'::jsonb then
    if (select coalesce(jsonb_agg(jsonb_build_object('entry',(v->>'entry')::integer,'item_source_id',v->>'item_source_id','rate_percent',(v->>'rate_percent')::numeric,'rate_text',v->>'rate_text') order by (v->>'entry')::integer),'[]') from jsonb_array_elements(drops) v)
     is distinct from (select coalesce(jsonb_agg(jsonb_build_object('entry',(v->>'entry')::integer,'item_source_id',v->>'item_source_id','rate_percent',(v->>'rate_percent')::numeric,'rate_text',v->>'rate_text') order by (v->>'entry')::integer),'[]') from jsonb_array_elements(r->'drops') v) then
     raise exception '기준 이후 드랍 변경: %',r->>'source_id';
    end if;
   end if;
  else raise exception '비교 대상 오류'; end if;
  if coalesce(actual,'null') is distinct from r->'payload' then raise exception '기준 이후 도감 변경: %/%',r->>'kind',r->>'source_id'; end if;
 end loop;
end $$;
revoke all on function public.assert_catalog_release(jsonb) from public,anon,authenticated;
grant execute on function public.assert_catalog_release(jsonb) to service_role;

commit;
