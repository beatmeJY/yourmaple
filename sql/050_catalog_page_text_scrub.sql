-- 049 이후 SQL Editor 또는 DBeaver 쓰기 연결에서 전체 실행합니다(재실행 가능).
-- 아이템 효과 문구에 섞여 들어간 원래 페이지의 버튼 글자를 지우고, 화면 문구의 칸 이름(DSC·EFFECT)을 뺍니다.
-- UUID·수치·관계표는 바꾸지 않습니다. 원래 값은 비공개 스키마에 보관합니다.
begin;
select pg_advisory_xact_lock(20261028,43);
do $$ begin
  if not exists(select 1 from catalog_import_private.completed_migrations where name='049_catalog_source_scrub') then
    raise exception '049를 먼저 실행하세요';
  end if;
end $$;

create or replace function catalog_import_private.scrub_json(v jsonb) returns jsonb
language sql immutable set search_path='' as $$
  select case jsonb_typeof(v)
    when 'object' then coalesce((select jsonb_object_agg(k,catalog_import_private.scrub_json(x)) from jsonb_each(v-'source_url') e(k,x)),'{}'::jsonb)
    when 'array' then coalesce((select jsonb_agg(catalog_import_private.scrub_json(x) order by o) from jsonb_array_elements(v) with ordinality a(x,o)),'[]'::jsonb)
    when 'string' then case when v#>>'{}' ~ '^https?://' and v#>>'{}' !~ '^https://maplestory\.io/'
      then to_jsonb(regexp_replace(v#>>'{}','^.*/',''))
      -- 원래 페이지의 버튼 글자(050)
      when v#>>'{}' ~ '바로보기 스탯 커스텀 스탯 초기화[[:space:]]*$'
      then to_jsonb(regexp_replace(v#>>'{}','[[:space:]]*[A-Za-z0-9.]+\.[A-Za-z]{2,} 바로보기 스탯 커스텀 스탯 초기화[[:space:]]*$',''))
      else v end
    else v end
$$;

create table if not exists catalog_import_private.scrub_050_rows (
  row_id uuid primary key, description text, effect_description text, source_data jsonb,
  saved_at timestamptz not null default now()
);
create table if not exists catalog_import_private.scrub_050_changes (
  change_id bigint primary key, changes jsonb not null, saved_at timestamptz not null default now()
);
revoke all on catalog_import_private.scrub_050_rows, catalog_import_private.scrub_050_changes from public,anon,authenticated;
grant select on catalog_import_private.scrub_050_rows, catalog_import_private.scrub_050_changes to service_role;

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
  -- 원래 페이지의 칸 이름(DSC·EFFECT)은 화면 문구에서 뺍니다(050).
  new.description:=nullif(btrim(regexp_replace(new.source_data->>'description_text','^DSC[[:space:]]+','')),'');
  new.effect_description:=nullif(btrim(regexp_replace(new.source_data->>'effect_text','^EFFECT[[:space:]]+','')),'');
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

-- 고칠 행만 골라 원래 값을 보관합니다.
create temporary table scrub_050_target on commit drop as
select id, catalog_import_private.scrub_json(source_data) cleaned from public.catalog_items where source='collected';
delete from scrub_050_target t using public.catalog_items i
 where i.id=t.id and i.source_data is not distinct from t.cleaned
   and i.description is not distinct from nullif(btrim(regexp_replace(t.cleaned->>'description_text','^DSC[[:space:]]+','')),'')
   and i.effect_description is not distinct from nullif(btrim(regexp_replace(t.cleaned->>'effect_text','^EFFECT[[:space:]]+','')),'');
insert into catalog_import_private.scrub_050_rows(row_id,description,effect_description,source_data)
select i.id,i.description,i.effect_description,i.source_data from public.catalog_items i join scrub_050_target t on t.id=i.id
on conflict do nothing;
insert into catalog_import_private.scrub_050_changes(change_id,changes)
select id,changes from public.catalog_changes where changes is distinct from catalog_import_private.scrub_json(changes)
on conflict do nothing;

-- 정리 중에는 정규화·변경 기록 트리거를 끕니다(관계표 재생성 없음, 공개 이력에 예전 문구가 남지 않음).
alter table public.catalog_items disable trigger user;
update public.catalog_items i set source_data=t.cleaned,
  description=nullif(btrim(regexp_replace(t.cleaned->>'description_text','^DSC[[:space:]]+','')),''),
  effect_description=nullif(btrim(regexp_replace(t.cleaned->>'effect_text','^EFFECT[[:space:]]+','')),'')
 from scrub_050_target t where t.id=i.id;
alter table public.catalog_items enable trigger user;
update public.catalog_changes set changes=catalog_import_private.scrub_json(changes)
 where changes is distinct from catalog_import_private.scrub_json(changes);

update public.catalog_revision set revision=revision+1,updated_at=now() where singleton;
insert into catalog_import_private.completed_migrations(name) values('050_catalog_page_text_scrub') on conflict do nothing;
commit;
