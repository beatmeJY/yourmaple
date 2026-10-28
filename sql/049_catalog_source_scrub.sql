-- 048 이후 SQL Editor 또는 DBeaver 쓰기 연결에서 전체 실행합니다(재실행 가능).
-- 공개 도감에서 수집 주소를 지우고 수집 관련 값·함수·트리거 이름을 중립 이름으로 바꿉니다.
-- 아이템/몬스터 UUID, 거래·드랍 참조, 수치는 바꾸지 않습니다. 원래 값은 비공개 스키마에 보관합니다.
begin;
select pg_advisory_xact_lock(20261028,43);

-- 알려진 값 외의 수집 출처는 한 종류만 있어야 합니다. 여러 개면 임의로 합치지 않고 중단합니다.
do $$ declare n integer; begin
  select count(distinct s) into n from (
    select source s from public.catalog_items union all select source from public.catalog_monsters
    union all select source from public.catalog_monster_drops) x
  where s is not null and s not in ('operator-sheet','legacy','collected');
  if n>1 then raise exception '예상하지 못한 출처 값이 여러 개입니다: 운영 검토 필요'; end if;
end $$;

-- 수집 원문(JSON) 안의 외부 링크는 마지막 경로(ID)만 남기고 source_url 키는 뺍니다. 이미지(maplestory.io)는 유지합니다.
create or replace function catalog_import_private.scrub_json(v jsonb) returns jsonb
language sql immutable set search_path='' as $$
  select case jsonb_typeof(v)
    when 'object' then coalesce((select jsonb_object_agg(k,catalog_import_private.scrub_json(x)) from jsonb_each(v-'source_url') e(k,x)),'{}'::jsonb)
    when 'array' then coalesce((select jsonb_agg(catalog_import_private.scrub_json(x) order by o) from jsonb_array_elements(v) with ordinality a(x,o)),'[]'::jsonb)
    when 'string' then case when v#>>'{}' ~ '^https?://' and v#>>'{}' !~ '^https://maplestory\.io/'
      then to_jsonb(regexp_replace(v#>>'{}','^.*/','')) else v end
    else v end
$$;
revoke all on function catalog_import_private.scrub_json(jsonb) from public,anon,authenticated;
grant execute on function catalog_import_private.scrub_json(jsonb) to service_role;

create table if not exists catalog_import_private.scrub_049_rows (
  table_name text not null, row_id uuid not null, source text, source_url text, source_data jsonb,
  saved_at timestamptz not null default now(), primary key(table_name,row_id)
);
create table if not exists catalog_import_private.scrub_049_changes (
  change_id bigint primary key, changes jsonb not null, saved_at timestamptz not null default now()
);
revoke all on catalog_import_private.scrub_049_rows, catalog_import_private.scrub_049_changes from public,anon,authenticated;

insert into catalog_import_private.scrub_049_rows(table_name,row_id,source,source_url,source_data)
select 'catalog_items',id,source,source_url,source_data from public.catalog_items
 where source_url is not null or source_data is distinct from catalog_import_private.scrub_json(source_data)
union all
select 'catalog_monsters',id,source,source_url,source_data from public.catalog_monsters
 where source_url is not null or source_data is distinct from catalog_import_private.scrub_json(source_data)
union all
select 'catalog_monster_drops',id,source,source_url,null from public.catalog_monster_drops where source_url is not null
on conflict do nothing;
insert into catalog_import_private.scrub_049_changes(change_id,changes)
select id,changes from public.catalog_changes where changes is distinct from catalog_import_private.scrub_json(changes) on conflict do nothing;

-- 정리 중에는 정규화·변경 기록 트리거를 끕니다(수치·관계표 재생성 없음, 공개 이력에 주소가 남지 않음).
alter table public.catalog_items disable trigger user;
alter table public.catalog_monsters disable trigger user;
alter table public.catalog_monster_drops disable trigger user;
alter table public.catalog_monster_drops alter column source_url drop not null;
alter table public.catalog_monster_drops drop constraint if exists catalog_monster_drops_source_url_check;

update public.catalog_items set source='collected' where source is not null and source not in ('operator-sheet','legacy','collected');
update public.catalog_monsters set source='collected' where source is not null and source not in ('operator-sheet','legacy','collected');
update public.catalog_monster_drops set source='collected' where source not in ('operator-sheet','legacy','collected');
update public.catalog_items t set source_url=null,source_data=x.cleaned
 from (select id,catalog_import_private.scrub_json(source_data) cleaned from public.catalog_items) x
 where x.id=t.id and (t.source_url is not null or t.source_data is distinct from x.cleaned);
update public.catalog_monsters t set source_url=null,source_data=x.cleaned
 from (select id,catalog_import_private.scrub_json(source_data) cleaned from public.catalog_monsters) x
 where x.id=t.id and (t.source_url is not null or t.source_data is distinct from x.cleaned);
update public.catalog_monster_drops set source_url=null where source_url is not null;
update public.catalog_changes set changes=catalog_import_private.scrub_json(changes) where changes is distinct from catalog_import_private.scrub_json(changes);

alter table public.catalog_items enable trigger user;
alter table public.catalog_monsters enable trigger user;
alter table public.catalog_monster_drops enable trigger user;

-- 예전 이름의 등록 함수·정규화 트리거를 지우고 중립 이름으로 다시 만듭니다.
do $$ declare r record; begin
  for r in select t.tgname from pg_trigger t where t.tgrelid='public.catalog_items'::regclass and not t.tgisinternal
    and t.tgname ~ '_item_(columns|relations)$' and t.tgname not in ('catalog_item_columns','catalog_item_relations') loop
    execute format('drop trigger %I on public.catalog_items',r.tgname);
  end loop;
  for r in select p.oid::regprocedure f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and ((p.proname ~ '_item_(columns|relations)$' and p.proname not in ('catalog_item_columns','catalog_item_relations'))
      or (p.proname ~ '^import_.+_batch$' and p.proname<>'import_catalog_batch')) loop
    execute 'drop function '||r.f;
  end loop;
end $$;

create or replace function public.catalog_item_columns()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v text; n text; e jsonb;
begin
  if new.source is distinct from 'collected' then return new; end if;
  new.middle_category:=nullif(new.source_data#>>'{categories,중분류}','');
  new.subcategory:=nullif(new.source_data#>>'{categories,소분류}','');
  new.required_level:=(new.requirements->>'level')::integer;
  new.gender_restriction:=nullif(new.requirements->>'GENDER','');
  new.attack_speed:=null; new.attack_speed_label:=null; new.shop_sell_price:=null;
  new.description:=nullif(new.source_data->>'description_text','');
  new.effect_description:=nullif(new.source_data->>'effect_text','');
  new.source_collected_at:=(new.source_data->>'collected_at')::timestamptz;
  new.source_html_sha256:=nullif(new.source_data->>'html_sha256','');
  for e in select value from jsonb_array_elements(coalesce(new.source_data->'other_effects','[]'::jsonb)) loop
    v:=e#>>'{}'; n:=btrim(split_part(v,':',1));
    v:=btrim(substr(v,strpos(v,':')+1));
    if n='상점가' then
      if v in ('','메소','???','-') then continue; end if;
      if v !~ '^[0-9,]+[[:space:]]*메소$' then raise exception '상점가 해석 불가: %',v; end if;
      new.shop_sell_price:=regexp_replace(v,'[^0-9]','','g')::bigint;
    elsif n='공격속도' then
      if v !~ '^[0-9]+([[:space:]]|\(|$)' then raise exception '공격속도 해석 불가: %',v; end if;
      new.attack_speed:=substring(v from '^[0-9]+')::integer;
      new.attack_speed_label:=v;
    end if;
  end loop;
  return new;
end $$;

create or replace function public.catalog_item_relations()
returns trigger language plpgsql security invoker set search_path='' as $$
declare e record; idx integer:=0; job text;
begin
  if new.source is distinct from 'collected' then return new; end if;
  delete from public.catalog_item_stats where item_id=new.id;
  delete from public.catalog_item_requirements where item_id=new.id;
  delete from public.catalog_item_jobs where item_id=new.id;
  delete from public.catalog_item_source_attributes where item_id=new.id;
  insert into public.catalog_item_stats(item_id,stat_key,base_value,minimum_value,maximum_value)
  select new.id,key,(value#>>'{}')::integer,
    (new.source_data->'option_ranges'->key->>'min')::integer,
    (new.source_data->'option_ranges'->key->>'max')::integer
  from jsonb_each(new.base_options);
  for e in select key,value from jsonb_each(new.requirements) order by key loop
    if e.key in ('str','dex','int','luk','fame') then
      insert into public.catalog_item_requirements values(new.id,e.key,(e.value#>>'{}')::integer);
    end if;
    insert into public.catalog_item_source_attributes values(new.id,'requirement',idx,e.key,e.value#>>'{}');
    idx:=idx+1;
  end loop;
  for job in select distinct btrim(x) from regexp_split_to_table(coalesce(new.requirements->>'REQ JOB',''),'[/,·[:space:]]+') x where btrim(x)<>'' loop
    insert into public.catalog_item_jobs values(new.id,job);
  end loop;
  insert into public.catalog_item_source_attributes(item_id,origin,entry_no,attribute_name,value_text)
  select new.id,'effect',(ordinality-1)::integer,
    btrim(split_part(value#>>'{}',':',1)),btrim(substr(value#>>'{}',strpos(value#>>'{}',':')+1))
  from jsonb_array_elements(coalesce(new.source_data->'other_effects','[]'::jsonb)) with ordinality;
  return new;
end $$;
revoke all on function public.catalog_item_columns() from public,anon,authenticated;
revoke all on function public.catalog_item_relations() from public,anon,authenticated;
grant execute on function public.catalog_item_columns(),public.catalog_item_relations() to service_role;
drop trigger if exists catalog_item_columns on public.catalog_items;
create trigger catalog_item_columns before insert or update of base_options,requirements,source_data,source
  on public.catalog_items for each row execute function public.catalog_item_columns();
drop trigger if exists catalog_item_relations on public.catalog_items;
create trigger catalog_item_relations after insert or update of base_options,requirements,source_data,source
  on public.catalog_items for each row execute function public.catalog_item_relations();

-- 공개 상세 응답과 공개 변경 이력에서 수집 주소를 뺍니다.
create or replace function public.catalog_item_detail(p_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('item',jsonb_build_object('id',i.id,'name',i.name,'category',i.category,
 'middle_category',i.middle_category,'subcategory',i.subcategory,'required_level',i.required_level,'gender_restriction',i.gender_restriction,
 'attack_speed',i.attack_speed,'attack_speed_label',i.attack_speed_label,'shop_sell_price',i.shop_sell_price::text,
 'description',i.description,'effect_description',i.effect_description,'image_url',i.image_url,'source_id',i.source_id),
 'stats',coalesce((select jsonb_agg(to_jsonb(s) order by stat_key) from public.catalog_item_stats s where s.item_id=i.id),'[]'),
 'requirements',coalesce((select jsonb_agg(to_jsonb(s) order by requirement_key) from public.catalog_item_requirements s where s.item_id=i.id),'[]'),
 'jobs',coalesce((select jsonb_agg(job_name order by job_name) from public.catalog_item_jobs s where s.item_id=i.id),'[]'),
 'attributes',coalesce((select jsonb_agg(to_jsonb(s) order by origin,entry_no) from public.catalog_item_source_attributes s where s.item_id=i.id),'[]'))
 from public.catalog_items i where i.id=p_id
$$;
revoke all on function public.catalog_item_detail(uuid) from public;
grant execute on function public.catalog_item_detail(uuid) to anon,authenticated,service_role;

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
  allowed:=array['name','category','middle_category','subcategory','required_level','gender_restriction','attack_speed','attack_speed_label','shop_sell_price','description','effect_description','base_options','requirements','image_url'];
  a:=a||jsonb_build_object('option_ranges',a#>'{source_data,option_ranges}','extra_effects',a#>'{source_data,other_effects}');b:=b||jsonb_build_object('option_ranges',b#>'{source_data,option_ranges}','extra_effects',b#>'{source_data,other_effects}');
  allowed:=allowed||array['option_ranges','extra_effects'];
 elsif tg_table_name='catalog_monsters' then
  kind:='monster';entity:=coalesce(b->>'id',a->>'id')::uuid;label:=coalesce(b->>'name',a->>'name');
  allowed:=array['name','level','hp','exp','required_accuracy','accuracy_per_level','weak_elements','resist_elements','image_url'];
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
        or jsonb_typeof(r->'source_data') is distinct from 'object'
        or jsonb_typeof(r->'image_url') not in ('null','string')
        or (r->>'image_url' is not null and r->>'image_url' !~ '^https://') then
        raise exception '도감 필수 값 오류: %',r->>'source_id';
      end if;
      -- 수집 주소·외부 링크는 저장하지 않습니다(049).
      body:=catalog_import_private.scrub_json(r-'drops');
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
        insert into public.catalog_items(name,category,base_options,requirements,image_url,source,source_id,source_data)
        values(r->>'name',r->>'category',r->'base_options',r->'requirements',r->>'image_url',src,r->>'source_id',
          (body->'source_data')||jsonb_build_object('import_payload',payload))
        on conflict(source,source_id) where source_id is not null do update
        set name=excluded.name,category=excluded.category,base_options=excluded.base_options,requirements=excluded.requirements,
         image_url=excluded.image_url,source_data=excluded.source_data;

      else
        if (r->>'level')::numeric<1 or (r->>'hp')::numeric<0 or (r->>'exp')::numeric<0
          or not (r ? 'level' and r ? 'hp' and r ? 'exp') then raise exception '몬스터 수치 오류'; end if;
        select exists(select 1 from public.catalog_monsters where source=src and source_id=r->>'source_id') into existed;
        -- 같은 외부 ID는 기존 행을 갱신하며 UUID와 드랍 참조를 유지합니다.
        insert into public.catalog_monsters(name,level,hp,exp,image_url,source,source_id,source_data)
        values(r->>'name',(r->>'level')::integer,(r->>'hp')::bigint,(r->>'exp')::bigint,r->>'image_url',src,r->>'source_id',
          (body->'source_data')||jsonb_build_object('import_payload',payload))
        on conflict(source,source_id) where source_id is not null do update
        set name=excluded.name,level=excluded.level,hp=excluded.hp,exp=excluded.exp,image_url=excluded.image_url,
            source_data=excluded.source_data;
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
      insert into public.catalog_monster_drops(monster_id,item_id,source,monster_source_id,source_entry,rate_percent,rate_text)
      values(mid,iid,src,r->>'monster_source_id',(r->>'entry')::integer,(r->>'rate_percent')::numeric,r->>'rate_text')
      on conflict(source,monster_source_id,source_entry) do update
      set monster_id=excluded.monster_id,item_id=excluded.item_id,rate_percent=excluded.rate_percent,rate_text=excluded.rate_text;
    end if;
    if existed then updated:=updated+1; else inserted:=inserted+1; end if;
  end loop;
  return jsonb_build_object('kind',kind,'inserted',inserted,'skipped',skipped,'updated',updated);
end $$;
revoke all on function public.import_catalog_batch(text,jsonb) from public,anon,authenticated;
grant execute on function public.import_catalog_batch(text,jsonb) to service_role;

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
  if coalesce(actual,'null') is distinct from catalog_import_private.scrub_json(r->'payload') then raise exception '기준 이후 도감 변경: %/%',r->>'kind',r->>'source_id'; end if;
 end loop;
end $$;
revoke all on function public.assert_catalog_release(jsonb) from public,anon,authenticated;
grant execute on function public.assert_catalog_release(jsonb) to service_role;

grant select on catalog_import_private.scrub_049_rows, catalog_import_private.scrub_049_changes to service_role;
update public.catalog_revision set revision=revision+1,updated_at=now() where singleton;
insert into catalog_import_private.completed_migrations(name) values('049_catalog_source_scrub') on conflict do nothing;
commit;
