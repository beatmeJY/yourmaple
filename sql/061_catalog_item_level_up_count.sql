-- 060 이후 전체 실행합니다(재실행 가능). 장비 레벨업 가능 횟수와 HP/MP 퍼센트 옵션을 별도 저장합니다. 미입력 횟수는 NULL입니다.
begin;
alter table public.catalog_items add column if not exists level_up_count integer;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.catalog_items'::regclass and conname='catalog_items_level_up_count_check') then
  alter table public.catalog_items add constraint catalog_items_level_up_count_check check(level_up_count is null or level_up_count>=0);
 end if;
end $$;
create or replace function public.valid_item_options(value jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(value) <> 'object' or value is null then false else
    not exists (select 1 from jsonb_each(value) as p(key, val) where
      key not in ('attack','magic_attack','str','dex','int','luk','hp','mp','hp_percent','mp_percent','defense','magic_defense','accuracy','avoidability','speed','jump','remaining_upgrades','used_upgrades')
      or case when jsonb_typeof(val) <> 'number' then true else
        (val::text)::numeric <> trunc((val::text)::numeric)
        or abs((val::text)::numeric) > 2147483647
        or (key in ('remaining_upgrades','used_upgrades') and (val::text)::numeric < 0) end)
  end
$$;
revoke all on function public.valid_item_options(jsonb) from public;
grant execute on function public.valid_item_options(jsonb) to anon, authenticated, service_role;


create or replace function public.catalog_item_edit_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare i public.catalog_items;
begin
 if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
 select * into i from public.catalog_items where id=p_id;
 if not found then raise exception '아이템을 찾을 수 없습니다'; end if;
 return jsonb_build_object('version',md5(to_jsonb(i)::text),'percent_supported',true,'level_up_supported',true,'ranges_supported',true,'ranges',coalesce(i.source_data->'option_ranges','{}'::jsonb),'draft',jsonb_build_object('name',i.name,'description',coalesce(i.description,''),'effect_description',coalesce(i.effect_description,''),'base_options',i.base_options,'requirements',i.requirements,'review_note','','level_up_count',i.level_up_count));
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
  and old.level_up_count is not distinct from level_count and coalesce(old.source_data->'option_ranges','{}'::jsonb)=ranges then return public.catalog_item_detail(p_id); end if;
 data:=(old.source_data-'import_payload')||jsonb_build_object('description_text',p_draft->>'description','effect_text',p_draft->>'effect_description','option_ranges',ranges);
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
create or replace function public.catalog_item_detail(p_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('item',jsonb_build_object('id',i.id,'name',i.name,'category',i.category,
 'middle_category',i.middle_category,'subcategory',i.subcategory,'required_level',i.required_level,'gender_restriction',i.gender_restriction,
 'attack_speed',i.attack_speed,'attack_speed_label',i.attack_speed_label,'shop_sell_price',i.shop_sell_price::text,
 'description',i.description,'effect_description',i.effect_description,'image_url',i.image_url,'source_id',i.source_id,'level_up_count',i.level_up_count),
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
  allowed:=array['name','category','middle_category','subcategory','required_level','gender_restriction','attack_speed','attack_speed_label','shop_sell_price','description','effect_description','base_options','requirements','image_url','level_up_count'];
  a:=a||jsonb_build_object('option_ranges',a#>'{source_data,option_ranges}','extra_effects',a#>'{source_data,other_effects}');b:=b||jsonb_build_object('option_ranges',b#>'{source_data,option_ranges}','extra_effects',b#>'{source_data,other_effects}');
  allowed:=allowed||array['option_ranges','extra_effects'];
 elsif tg_table_name='catalog_monsters' then
  kind:='monster';entity:=coalesce(b->>'id',a->>'id')::uuid;label:=coalesce(b->>'name',a->>'name');
  allowed:=array['name','level','hp','exp','required_accuracy','accuracy_per_level','weak_elements','resist_elements','image_url','mp','physical_attack','magic_attack','physical_defense','magic_defense','movement_speed','knockback_damage','meso_value','accuracy_reference_level'];
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
commit;
