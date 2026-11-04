-- 061 이후 전체 실행합니다. 공격속도는 기본 옵션과 별도이며 등급만 있을 때 숫자를 추측하지 않습니다.
begin;
create or replace function catalog_review_private.valid_speed_label(v text)
returns boolean language sql immutable set search_path='' as $$
 select v is not null and length(v)<=50 and (v='' or v ~ '^[0-9]+([[:space:]]|\(|$)' or v in ('매우 빠름','빠름','보통','느림','매우 느림'))
$$;
create or replace function catalog_review_private.effects_with_speed(effects jsonb,v text)
returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb;
begin
 if not catalog_review_private.valid_speed_label(v) then raise exception '공격속도는 빠름 등의 등급 또는 숫자로 입력해 주세요'; end if;
 select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) into result from jsonb_array_elements(coalesce(effects,'[]'::jsonb)) with ordinality
 where btrim(split_part(value#>>'{}',':',1))<>'공격속도';
 return case when v='' then result else result||jsonb_build_array('공격속도: '||v) end;
end $$;
revoke all on function catalog_review_private.valid_speed_label(text),catalog_review_private.effects_with_speed(jsonb,text) from public,anon,authenticated;
create or replace function catalog_review_private.valid_draft(d jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare e record;
begin
 if d is null or jsonb_typeof(d)<>'object' or octet_length(d::text)>100000
  or (d-array['name','description','effect_description','base_options','requirements','review_note','attack_speed_label'])<>'{}'::jsonb
  or jsonb_typeof(d->'name') is distinct from 'string' or length(btrim(d->>'name')) not between 1 and 200
  or jsonb_typeof(d->'description') is distinct from 'string' or length(d->>'description')>20000
  or jsonb_typeof(d->'effect_description') is distinct from 'string' or length(d->>'effect_description')>20000
  or jsonb_typeof(d->'review_note') is distinct from 'string' or length(d->>'review_note')>4000
  or not public.valid_item_options(d->'base_options')
  or jsonb_typeof(d->'requirements') is distinct from 'object' then return false; end if;
 if d ? 'attack_speed_label' and (jsonb_typeof(d->'attack_speed_label') is distinct from 'string'
  or not catalog_review_private.valid_speed_label(d->>'attack_speed_label')) then return false; end if;
 for e in select key,value from jsonb_each(d->'requirements') loop
  if e.key in ('level','str','dex','int','luk','fame') then
   if jsonb_typeof(e.value)<>'number' or (e.value::text)::numeric<>trunc((e.value::text)::numeric)
    or (e.value::text)::numeric<0 or (e.value::text)::numeric>2147483647 then return false; end if;
  elsif e.key in ('REQ JOB','GENDER') then
   if jsonb_typeof(e.value)<>'string' or length(e.value#>>'{}')>100 then return false; end if;
  else return false; end if;
 end loop;
 return true;
end $$;
revoke all on function catalog_review_private.valid_draft(jsonb) from public,anon,authenticated;

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
      if not catalog_review_private.valid_speed_label(v) or v='' then raise exception '공격속도 해석 불가: %',v; end if;
      new.attack_speed:=case when v ~ '^[0-9]+' then substring(v from '^[0-9]+')::integer else null end;
      new.attack_speed_label:=v;
    end if;
  end loop;
  return new;
end $$;
create or replace function public.catalog_review_save(p_id text,p_revision integer,p_draft jsonb,p_status text default 'draft',p_publish boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old catalog_review_private.items; existing public.catalog_items; result jsonb; data jsonb; payload jsonb; iid uuid; ranges jsonb;
begin
 if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
 if p_status is null or p_status not in ('draft','ready') or p_publish is null or (p_publish and p_status<>'ready')
  or not catalog_review_private.valid_draft(p_draft) then raise exception '이름·설명·옵션 입력을 확인해 주세요'; end if;
 if p_publish then
  perform pg_advisory_xact_lock(20261028,43);
  lock table public.catalog_items in share row exclusive mode;
 end if;
 select * into old from catalog_review_private.items where source_id=p_id for update;
 if not found then raise exception '검토 항목이 없습니다'; end if;
 if old.deleted_at is not null then raise exception '삭제한 검토 항목입니다. 먼저 복구해 주세요'; end if;
 if p_revision is null or old.revision<>p_revision then raise exception '다른 화면에서 수정되었습니다. 다시 불러온 뒤 저장해 주세요' using errcode='40001'; end if;
 if old.draft=p_draft and old.status=p_status and (not p_publish or old.published_revision=old.revision) then return to_jsonb(old); end if;
 if p_publish then
  if exists(select 1 from public.catalog_items where source_id=p_id and source is distinct from 'collected') then raise exception '다른 기준의 기존 아이템 ID가 있습니다. 운영 확인이 필요합니다'; end if;
  select * into existing from public.catalog_items where source='collected' and source_id=p_id for update;
  -- 기존 분류·공격속도·상점가 등은 보존하고, 검토에서 수정한 필드만 교체합니다.
  data:=coalesce(existing.source_data-'import_payload','{}'::jsonb);
  if existing.id is null then data:=data||jsonb_build_object('categories',coalesce(old.publication_data->'categories',jsonb_build_object('대분류',old.category)),
    'other_effects',coalesce(old.publication_data->'other_effects','[]'::jsonb),'option_ranges',coalesce(old.publication_data->'option_ranges','{}'::jsonb)); end if;
  -- 기본값을 바꿨을 때 기존 변동 범위를 임의 재계산하거나 범위 밖 수치를 만들지 않습니다.
  select coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb) into ranges
   from jsonb_each(coalesce(data->'option_ranges','{}'::jsonb)) e
   where existing.base_options->e.key is not distinct from p_draft->'base_options'->e.key
    and p_draft->'base_options' ? e.key;
  data:=data||jsonb_build_object('description_text',p_draft->>'description','effect_text',p_draft->>'effect_description','option_ranges',ranges);
  if p_draft ? 'attack_speed_label' then data:=jsonb_set(data,'{other_effects}',catalog_review_private.effects_with_speed(data->'other_effects',p_draft->>'attack_speed_label')); end if;
  payload:=jsonb_build_object('source_id',p_id,'name',p_draft->>'name','category',coalesce(existing.category,old.category),
   'image_url',coalesce(existing.image_url,old.image_url),'base_options',p_draft->'base_options','requirements',p_draft->'requirements','source_data',data);
  perform set_config('yourmaple.release_label','운영자 검토 반영',true);
  perform public.import_catalog_batch('items',jsonb_build_array(payload));
  select id into iid from public.catalog_items where source='collected' and source_id=p_id;
  if iid is null then raise exception '공개 도감 반영을 확인하지 못했습니다'; end if;
 end if;
 insert into catalog_review_private.edits(source_id,before_draft,after_draft,before_status,after_status,changed_by,published_item_id)
 values(p_id,old.draft,p_draft,old.status,p_status,auth.uid(),iid);
 update catalog_review_private.items set draft=p_draft,status=p_status,revision=revision+1,updated_at=now(),updated_by=auth.uid(),
  published_item_id=coalesce(iid,published_item_id),published_revision=case when p_publish then revision+1 else published_revision end
 where source_id=p_id returning to_jsonb(items) into result;
 return result;
end $$;
revoke all on function public.catalog_review_save(text,integer,jsonb,text,boolean) from public,anon;
grant execute on function public.catalog_review_save(text,integer,jsonb,text,boolean) to authenticated;
create or replace function public.catalog_item_edit_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare i public.catalog_items;
begin
 if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
 select * into i from public.catalog_items where id=p_id;
 if not found then raise exception '아이템을 찾을 수 없습니다'; end if;
 return jsonb_build_object('version',md5(to_jsonb(i)::text),'speed_supported',true,'percent_supported',true,'level_up_supported',true,'ranges_supported',true,'ranges',coalesce(i.source_data->'option_ranges','{}'::jsonb),'draft',jsonb_build_object('name',i.name,'description',coalesce(i.description,''),'effect_description',coalesce(i.effect_description,''),'base_options',i.base_options,'requirements',i.requirements,'review_note','','level_up_count',i.level_up_count,'attack_speed_label',coalesce(i.attack_speed_label,i.attack_speed::text,'')));
end $$;
drop function if exists public.catalog_item_edit_save(uuid,text,jsonb);
create or replace function public.catalog_item_edit_save(p_id uuid,p_version text,p_draft jsonb,p_ranges jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.catalog_items; ranges jsonb; data jsonb; review catalog_review_private.items; e record; lo numeric; hi numeric; level_count integer;
begin
 if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
 if not catalog_review_private.valid_draft(p_draft-array['level_up_count','percent_options_supported']) or p_draft->>'review_note'<>'' then raise exception '이름·설명·옵션 입력을 확인해 주세요'; end if;
 if p_draft ? 'percent_options_supported' and p_draft->'percent_options_supported'<>'true'::jsonb then raise exception '퍼센트 옵션 지원 여부를 확인해 주세요'; end if;
 if p_draft ? 'level_up_count' and p_draft->'level_up_count'<>'null'::jsonb then
  if jsonb_typeof(p_draft->'level_up_count') is distinct from 'number' then raise exception '레벨업 가능 횟수는 0 이상의 정수로 입력해 주세요'; end if;
  lo:=(p_draft->>'level_up_count')::numeric;
  if lo<>trunc(lo) or lo<0 or lo>2147483647 then raise exception '레벨업 가능 횟수는 0 이상의 정수로 입력해 주세요'; end if;
 end if;
 perform pg_advisory_xact_lock(20261028,43);
 select * into old from public.catalog_items where id=p_id for update;
 if not found then raise exception '아이템을 찾을 수 없습니다'; end if;
 if p_version is null or md5(to_jsonb(old)::text)<>p_version then raise exception '다른 화면에서 수정되었습니다. 다시 불러온 뒤 저장해 주세요' using errcode='40001'; end if;
 if p_draft->'percent_options_supported' is distinct from 'true'::jsonb and
  ((old.base_options->'hp_percent' is not null and old.base_options->'hp_percent' is distinct from p_draft->'base_options'->'hp_percent')
   or (old.base_options->'mp_percent' is not null and old.base_options->'mp_percent' is distinct from p_draft->'base_options'->'mp_percent')) then
  raise exception 'HP/MP 증가율을 보존하려면 새 화면에서 다시 수정해 주세요';
 end if;
 level_count:=case when p_draft ? 'level_up_count' then (p_draft->>'level_up_count')::integer else old.level_up_count end;
 -- 새 화면은 범위 전체를 명시합니다. 구 화면은 변경한 기본값의 기존 범위만 제거합니다.
 if p_ranges is not null then
  if jsonb_typeof(p_ranges)<>'object' or octet_length(p_ranges::text)>10000 then raise exception '옵션 범위 형식을 확인해 주세요'; end if;
  for e in select key,value from jsonb_each(p_ranges) loop
   if not (p_draft->'base_options' ? e.key) or jsonb_typeof(e.value) is distinct from 'object'
    or (e.value-array['min','max'])<>'{}'::jsonb or jsonb_typeof(e.value->'min') is distinct from 'number'
    or jsonb_typeof(e.value->'max') is distinct from 'number' then raise exception '범위에는 기본값과 최소·최대 정수가 필요합니다'; end if;
   lo:=(e.value->>'min')::numeric;hi:=(e.value->>'max')::numeric;
   if lo<>trunc(lo) or hi<>trunc(hi) or abs(lo)>2147483647 or abs(hi)>2147483647
    or lo>(p_draft->'base_options'->>e.key)::numeric or hi<(p_draft->'base_options'->>e.key)::numeric then
    raise exception '최소 ≤ 기본값 ≤ 최대인 정수 범위를 입력해 주세요'; end if;
  end loop;
  ranges:=p_ranges;
 else
  select coalesce(jsonb_object_agg(range_row.key,range_row.value),'{}'::jsonb) into ranges from jsonb_each(coalesce(old.source_data->'option_ranges','{}'::jsonb)) range_row
  where old.base_options->range_row.key is not distinct from p_draft->'base_options'->range_row.key and p_draft->'base_options' ? range_row.key;
 end if;
 if old.name=p_draft->>'name' and coalesce(old.description,'')=p_draft->>'description'
  and coalesce(old.effect_description,'')=p_draft->>'effect_description' and old.base_options=p_draft->'base_options' and old.requirements=p_draft->'requirements'
  and (not(p_draft ? 'attack_speed_label') or coalesce(old.attack_speed_label,old.attack_speed::text,'')=p_draft->>'attack_speed_label') and old.level_up_count is not distinct from level_count and coalesce(old.source_data->'option_ranges','{}'::jsonb)=ranges then return public.catalog_item_detail(p_id); end if;
 data:=(old.source_data-'import_payload')||jsonb_build_object('description_text',p_draft->>'description','effect_text',p_draft->>'effect_description','option_ranges',ranges);
 if p_draft ? 'attack_speed_label' then data:=jsonb_set(data,'{other_effects}',catalog_review_private.effects_with_speed(data->'other_effects',p_draft->>'attack_speed_label')); end if;
 perform set_config('yourmaple.release_label','운영자 상세 수정',true);
 update public.catalog_items set level_up_count=level_count,name=p_draft->>'name',base_options=p_draft->'base_options',requirements=p_draft->'requirements',source_data=data where id=p_id;
 -- 검토 중인 초안을 덮지 않습니다. 공개본이 바뀌었음을 표시하고 이전 검토창의 저장을 막습니다.
 for review in select * from catalog_review_private.items where published_item_id=p_id for update loop
  insert into catalog_review_private.edits(source_id,before_draft,after_draft,before_status,after_status,changed_by,published_item_id)
  values(review.source_id,review.draft,review.draft,review.status,review.status,auth.uid(),p_id);
  update catalog_review_private.items set revision=revision+1,published_revision=null,updated_at=now(),updated_by=auth.uid() where source_id=review.source_id;
 end loop;
 return public.catalog_item_detail(p_id);
end $$;
revoke all on function public.catalog_item_edit_detail(uuid),public.catalog_item_edit_save(uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.catalog_item_edit_detail(uuid),public.catalog_item_edit_save(uuid,text,jsonb,jsonb) to authenticated;
commit;
