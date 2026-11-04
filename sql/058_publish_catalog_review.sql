-- 057 이후 전체 실행합니다. 기존 검토 완료 항목을 자동 공개하지 않습니다.
begin;
alter table catalog_review_private.items
 add column if not exists deleted_at timestamptz,
 add column if not exists publication_data jsonb not null default '{}'::jsonb,
 add column if not exists published_item_id uuid references public.catalog_items(id) on delete restrict,
 add column if not exists published_revision integer;
alter table catalog_review_private.edits add column if not exists published_item_id uuid, add column if not exists before_deleted_at timestamptz, add column if not exists after_deleted_at timestamptz;

-- 새 화면은 p_publish를 명시합니다. 예전 화면의 저장은 기본false로 공개하지 않습니다.
drop function if exists public.catalog_review_save(text,integer,jsonb,text);
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

create or replace function public.catalog_review_list(p_query text default '',p_kind text default '',p_status text default '',p_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
 if p_query is null or length(p_query)>100 or p_kind is null or p_kind not in ('','different','unverified')
  or p_status is null or p_status not in ('','draft','ready','deleted') or p_page is null or p_page<0 or p_page>10000 then raise exception '조회 조건 오류'; end if;
 with filtered as (select * from catalog_review_private.items
  where (p_query='' or strpos(lower(draft->>'name'),lower(p_query))>0 or source_id=p_query)
  and (p_kind='' or review_kind=p_kind) and (case when p_status='deleted' then deleted_at is not null else deleted_at is null and (p_status='' or status=p_status) end)),
 paged as (select source_id,category,review_kind,status,revision,updated_at,deleted_at,published_item_id,published_revision,draft->>'name' name,image_url
  from filtered order by source_id::bigint limit 24 offset p_page*24)
 select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(p) order by source_id::bigint) from paged p),'[]'),
 'counts',jsonb_build_object('all',(select count(*) from catalog_review_private.items where deleted_at is null),'deleted',(select count(*) from catalog_review_private.items where deleted_at is not null),'ready',(select count(*) from catalog_review_private.items where status='ready' and deleted_at is null),'published',(select count(*) from catalog_review_private.items where published_item_id is not null and deleted_at is null))) into result;
 return result;
end $$;


revoke all on function public.catalog_review_list(text,text,text,integer) from public,anon;
grant execute on function public.catalog_review_list(text,text,text,integer) to authenticated;
-- 검토 목록에서만 삭제합니다. 공개 아이템과 연결 데이터는 변경하지 않습니다.
create or replace function public.catalog_review_set_deleted(p_id text,p_revision integer,p_deleted boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old catalog_review_private.items; result jsonb; removed_at timestamptz;
begin
 if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
 if p_deleted is null then raise exception '삭제 여부를 확인해 주세요'; end if;
 select * into old from catalog_review_private.items where source_id=p_id for update;
 if not found then raise exception '검토 항목이 없습니다'; end if;
 if p_revision is null or old.revision<>p_revision then raise exception '다른 화면에서 수정되었습니다. 다시 불러온 뒤 저장해 주세요' using errcode='40001'; end if;
 if (old.deleted_at is not null)=p_deleted then return to_jsonb(old); end if;
 removed_at:=case when p_deleted then now() else null end;
 insert into catalog_review_private.edits(source_id,before_draft,after_draft,before_status,after_status,changed_by,before_deleted_at,after_deleted_at)
 values(p_id,old.draft,old.draft,old.status,old.status,auth.uid(),old.deleted_at,removed_at);
 update catalog_review_private.items set deleted_at=removed_at,revision=revision+1,updated_at=now(),updated_by=auth.uid(),
  published_revision=case when published_revision=revision then revision+1 else published_revision end
 where source_id=p_id returning to_jsonb(items) into result;
 return result;
end $$;
revoke all on function public.catalog_review_set_deleted(text,integer,boolean) from public,anon;
grant execute on function public.catalog_review_set_deleted(text,integer,boolean) to authenticated;
commit;
