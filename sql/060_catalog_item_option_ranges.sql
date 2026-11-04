-- 059 이후 전체 실행합니다(재실행 가능). 옵션 범위 수정과 구 화면 호환을 함께 적용합니다.
begin;
create or replace function public.catalog_item_edit_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare i public.catalog_items;
begin
 if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
 select * into i from public.catalog_items where id=p_id;
 if not found then raise exception '아이템을 찾을 수 없습니다'; end if;
 return jsonb_build_object('version',md5(to_jsonb(i)::text),'ranges_supported',true,'ranges',coalesce(i.source_data->'option_ranges','{}'::jsonb),'draft',jsonb_build_object('name',i.name,'description',coalesce(i.description,''),'effect_description',coalesce(i.effect_description,''),'base_options',i.base_options,'requirements',i.requirements,'review_note',''));
end $$;
drop function if exists public.catalog_item_edit_save(uuid,text,jsonb);
create or replace function public.catalog_item_edit_save(p_id uuid,p_version text,p_draft jsonb,p_ranges jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.catalog_items; ranges jsonb; data jsonb; review catalog_review_private.items; e record; lo numeric; hi numeric;
begin
 if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
 if not catalog_review_private.valid_draft(p_draft) or p_draft->>'review_note'<>'' then raise exception '이름·설명·옵션 입력을 확인해 주세요'; end if;
 perform pg_advisory_xact_lock(20261028,43);
 select * into old from public.catalog_items where id=p_id for update;
 if not found then raise exception '아이템을 찾을 수 없습니다'; end if;
 if p_version is null or md5(to_jsonb(old)::text)<>p_version then raise exception '다른 화면에서 수정되었습니다. 다시 불러온 뒤 저장해 주세요' using errcode='40001'; end if;
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
  and coalesce(old.source_data->'option_ranges','{}'::jsonb)=ranges then return public.catalog_item_detail(p_id); end if;
 data:=(old.source_data-'import_payload')||jsonb_build_object('description_text',p_draft->>'description','effect_text',p_draft->>'effect_description','option_ranges',ranges);
 perform set_config('yourmaple.release_label','운영자 상세 수정',true);
 update public.catalog_items set name=p_draft->>'name',base_options=p_draft->'base_options',requirements=p_draft->'requirements',source_data=data where id=p_id;
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
