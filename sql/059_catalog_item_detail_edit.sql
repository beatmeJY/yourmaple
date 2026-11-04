-- 058 이후 운영자가 전체 실행합니다. 공개 설명만 편집하며 비공개 검토 메모는 반환하지 않습니다.
begin;
create or replace function public.catalog_item_edit_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare i public.catalog_items;
begin
 if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
 select * into i from public.catalog_items where id=p_id;
 if not found then raise exception '아이템을 찾을 수 없습니다'; end if;
 return jsonb_build_object('version',md5(to_jsonb(i)::text),'draft',jsonb_build_object('name',i.name,'description',coalesce(i.description,''),'effect_description',coalesce(i.effect_description,''),'base_options',i.base_options,'requirements',i.requirements,'review_note',''));
end $$;
create or replace function public.catalog_item_edit_save(p_id uuid,p_version text,p_draft jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.catalog_items; ranges jsonb; data jsonb; review catalog_review_private.items;
begin
 if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
 if not catalog_review_private.valid_draft(p_draft) or p_draft->>'review_note'<>'' then raise exception '이름·설명·옵션 입력을 확인해 주세요'; end if;
 perform pg_advisory_xact_lock(20261028,43);
 select * into old from public.catalog_items where id=p_id for update;
 if not found then raise exception '아이템을 찾을 수 없습니다'; end if;
 if p_version is null or md5(to_jsonb(old)::text)<>p_version then raise exception '다른 화면에서 수정되었습니다. 다시 불러온 뒤 저장해 주세요' using errcode='40001'; end if;
 if old.name=p_draft->>'name' and coalesce(old.description,'')=p_draft->>'description'
  and coalesce(old.effect_description,'')=p_draft->>'effect_description' and old.base_options=p_draft->'base_options' and old.requirements=p_draft->'requirements' then
  return public.catalog_item_detail(p_id);
 end if;
 select coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb) into ranges from jsonb_each(coalesce(old.source_data->'option_ranges','{}'::jsonb)) e
 where old.base_options->e.key is not distinct from p_draft->'base_options'->e.key and p_draft->'base_options' ? e.key;
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
revoke all on function public.catalog_item_edit_detail(uuid),public.catalog_item_edit_save(uuid,text,jsonb) from public,anon;
grant execute on function public.catalog_item_edit_detail(uuid),public.catalog_item_edit_save(uuid,text,jsonb) to authenticated;
commit;
