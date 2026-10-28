-- 043 적용 후 SQL Editor에서 전체 실행합니다. 기존 아이템 UUID/거래 참조는 유지합니다.
-- 수집기는 멈출 필요 없습니다. 043 방식의 등록도 트리거가 새 구조로 함께 반영합니다.
begin;
alter table public.catalog_items
  add column if not exists middle_category text,
  add column if not exists subcategory text,
  add column if not exists required_level integer check(required_level>=0),
  add column if not exists gender_restriction text,
  add column if not exists attack_speed integer check(attack_speed>=0),
  add column if not exists attack_speed_label text,
  add column if not exists shop_sell_price bigint check(shop_sell_price>=0),
  add column if not exists description text,
  add column if not exists effect_description text,
  add column if not exists source_collected_at timestamptz,
  add column if not exists source_html_sha256 text;
create index if not exists catalog_items_category_level_idx on public.catalog_items(category,middle_category,required_level);
create index if not exists catalog_items_shop_sell_price_idx on public.catalog_items(shop_sell_price);

create table if not exists public.catalog_item_stats (
  item_id uuid not null references public.catalog_items(id) on delete cascade,
  stat_key text not null,
  base_value integer not null,
  minimum_value integer,
  maximum_value integer,
  primary key(item_id,stat_key),
  check(public.valid_item_options(jsonb_build_object(stat_key,base_value))),
  check((minimum_value is null and maximum_value is null) or
    (minimum_value is not null and maximum_value is not null and minimum_value<=base_value and base_value<=maximum_value))
);
create index if not exists catalog_item_stats_search_idx on public.catalog_item_stats(stat_key,base_value,item_id);
create table if not exists public.catalog_item_requirements (
  item_id uuid not null references public.catalog_items(id) on delete cascade,
  requirement_key text not null check(requirement_key in ('str','dex','int','luk','fame')),
  required_value integer not null,
  primary key(item_id,requirement_key)
);
create index if not exists catalog_item_requirements_search_idx on public.catalog_item_requirements(requirement_key,required_value,item_id);
create table if not exists public.catalog_item_jobs (
  item_id uuid not null references public.catalog_items(id) on delete cascade,
  job_name text not null check(btrim(job_name)<>''),
  primary key(item_id,job_name)
);
-- 새 출처 필드도 통째 JSON으로 숨기지 않고 원문 속성 행으로 노출합니다.
-- 해석 전 원문이며 숫자 계산에는 stats/requirements/고정 컬럼을 사용합니다.
create table if not exists public.catalog_item_source_attributes (
  item_id uuid not null references public.catalog_items(id) on delete cascade,
  origin text not null check(origin in ('requirement','effect')),
  entry_no integer not null check(entry_no>=0),
  attribute_name text not null,
  value_text text not null,
  primary key(item_id,origin,entry_no)
);

do $$ declare t text; begin
  foreach t in array array['catalog_item_stats','catalog_item_requirements','catalog_item_jobs','catalog_item_source_attributes'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('drop policy if exists catalog_read on public.%I',t);
    execute format('create policy catalog_read on public.%I for select to anon,authenticated using(true)',t);
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

-- 기존 513개를 포함해 이미 등록한 수집처 아이템을 원본 값에서 이전합니다.
-- UUID를 재발급하거나 거래/드랍 행을 삭제하지 않습니다. 실패하면 전체 롤백합니다.
update public.catalog_items set source_data=source_data where source='collected';
comment on column public.catalog_items.base_options is '기존 화면 호환 복사. 분리된 능력치는 catalog_item_stats에서 조회';
comment on column public.catalog_items.requirements is '기존 화면 호환/수집 입력. required_level·gender_restriction·catalog_item_requirements·catalog_item_jobs로 분리';
comment on table public.catalog_item_source_attributes is '해석 가능한 고정값은 정식 컬럼/관계표에 저장. 추가 속성의 원문은 행 단위로 보존';
commit;
