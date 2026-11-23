-- 퀘스트 삭제·조건/보상 수정(2026-11-23 사용자 요청, 도감 관리자 전용).
-- - 삭제는 몬스터(071)처럼 논리 삭제: 행은 남기고 공개 목록·상세·다른 퀘스트의 선행/다음 연결에서만 숨긴다.
--   관리자는 "삭제한 퀘스트" 화면에서 보고 되살린다. 수집 자료를 다시 등록해도 삭제 표시는 그대로다.
-- - 조건·보상 수정: 완료 조건(아이템 모으기·몬스터 물리치기)과 보상 아이템(개수, 그중 하나 r, 맞는 직업만 j)을 통째로 저장한다.
--   보상 방식은 r 표시로 정한다: r 이 하나라도 있으면 random(무작위) 또는 select(고름), 없으면 fixed, 보상이 없으면 null.
--   저장한 퀘스트는 source 'operator' 가 되고, 비공개 도구가 만든 등록 SQL 은 관리자 퀘스트의 조건·보상을 덮지 않는다.
-- 077 이후 운영자가 SQL Editor 또는 DBeaver에서 전체 실행합니다. 같은 파일을 다시 실행해도 안전합니다.
begin;
select pg_advisory_xact_lock(20261028,43);

do $$
begin
  if not exists (select 1 from catalog_import_private.completed_migrations where name='077_catalog_quests') then
    raise exception '077_catalog_quests.sql 을 먼저 실행해 주세요';
  end if;
end $$;

alter table public.catalog_quests
 add column if not exists deleted_at timestamptz,
 add column if not exists deleted_reason text;
alter table public.catalog_quests drop constraint if exists catalog_quests_deleted_reason_len;
alter table public.catalog_quests add constraint catalog_quests_deleted_reason_len check (deleted_reason is null or length(deleted_reason)<=500);

-- 공개 읽기: 지운 퀘스트는 보이지 않는다(검색·상세 함수는 security invoker 라 함께 숨겨지고, 선행/다음 연결도 빠진다).
drop policy if exists catalog_read on public.catalog_quests;
create policy catalog_read on public.catalog_quests for select to anon,authenticated using (deleted_at is null);

-- 삭제·복구: p_deleted=true 면 숨기고 false 면 되살린다. 이유는 관리자만 본다(500자까지).
create or replace function public.catalog_quest_set_deleted(p_id uuid,p_deleted boolean,p_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.catalog_quests; reason text:=nullif(btrim(coalesce(p_reason,'')),'');
begin
 if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
 if p_deleted is null then raise exception '삭제 여부를 정해 주세요'; end if;
 if length(reason)>500 then raise exception '삭제 이유는 500자까지 적을 수 있습니다'; end if;
 select * into old from public.catalog_quests where id=p_id for update;
 if not found then raise exception '퀘스트를 찾을 수 없습니다'; end if;
 if (old.deleted_at is not null)=p_deleted then
  return jsonb_build_object('id',old.id,'deleted_at',old.deleted_at,'deleted_reason',old.deleted_reason); end if;
 update public.catalog_quests
  set deleted_at=case when p_deleted then now() end, deleted_reason=case when p_deleted then reason end
  where id=p_id returning * into old;
 insert into public.catalog_changes(entity_type,entity_id,entity_name,operation,changes,release_label)
 values('quest',p_id,old.name,'UPDATE',
  jsonb_build_object('deleted',jsonb_build_object('before',not p_deleted,'after',p_deleted))
   ||case when p_deleted and reason is not null then jsonb_build_object('deleted_reason',jsonb_build_object('before',null,'after',reason)) else '{}'::jsonb end,
  case when p_deleted then '운영자 퀘스트 삭제' else '운영자 퀘스트 복구' end);
 update public.catalog_revision set revision=revision+1,updated_at=now() where singleton;
 return jsonb_build_object('id',old.id,'deleted_at',old.deleted_at,'deleted_reason',old.deleted_reason);
end $$;

-- 삭제한 퀘스트 목록(관리자 화면): 최근에 지운 순.
create or replace function public.catalog_quest_deleted_list()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'source_id',q.source_id,'name',q.name,'min_level',q.min_level,'max_level',q.max_level,
   'region',q.region,'start_npc',q.start_npc,'deleted_at',q.deleted_at,'deleted_reason',q.deleted_reason,
   'condition_count',jsonb_array_length(q.conditions),'reward_count',jsonb_array_length(q.reward_items))
  order by q.deleted_at desc,q.name,q.id)
  from public.catalog_quests q where q.deleted_at is not null),'[]'::jsonb);
end $$;

-- 조건·보상 한 줄 정리: 허용한 칸만 남기고 형식을 검사한다. p_kind 'c'(조건: 아이템 i 또는 몬스터 m) / 'r'(보상: 아이템 i).
create or replace function catalog_import_private.quest_entry(p_value jsonb,p_kind text)
returns jsonb language plpgsql immutable set search_path='' as $$
declare item text:=p_value->>'i'; mob text:=p_value->>'m'; cnt numeric; name text:=nullif(btrim(coalesce(p_value->>'n','')),''); ver text:=lower(p_value->>'v');
begin
 if jsonb_typeof(p_value)<>'object' then raise exception '조건·보상 형식이 올바르지 않습니다'; end if;
 if p_kind='r' and mob is not null then raise exception '보상에는 아이템만 넣을 수 있습니다'; end if;
 if (item is null)=(mob is null) then raise exception '아이템 또는 몬스터 하나를 골라 주세요'; end if;
 if coalesce(item,mob)!~'^[1-9][0-9]{0,9}$' then raise exception '아이템·몬스터 번호가 올바르지 않습니다'; end if;
 if jsonb_typeof(coalesce(p_value->'c','1'::jsonb))<>'number' then raise exception '개수는 숫자로 적어 주세요'; end if;
 cnt:=coalesce((p_value->>'c')::numeric,1);
 if cnt<>trunc(cnt) or cnt<1 or cnt>1000000000 then raise exception '개수는 1~1,000,000,000 사이 정수로 적어 주세요'; end if;
 if length(name)>200 then raise exception '이름은 200자까지 적을 수 있습니다'; end if;
 if ver is not null and ver!~'^[a-z]{3}/[0-9]{1,4}$' then ver:=null; end if;
 return jsonb_strip_nulls(jsonb_build_object('i',item,'m',mob,'c',cnt::bigint,'n',name,'v',ver,
  'r',case when p_kind='r' and (p_value->>'r') in ('1','true') then 1 end,
  'j',case when p_kind='r' and (p_value->>'j') in ('1','true') then 1 end));
end $$;

-- 관리자 조건·보상 저장: 목록 전체를 받아 바꾼다. 다른 화면에서 먼저 고쳤으면(버전) 막는다.
-- p_pick: 그중 하나 보상을 받는 방식 'random'(무작위)·'select'(고름). r 이 없으면 무시하고 fixed.
create or replace function public.catalog_quest_items_save(p_id uuid,p_version text,p_conditions jsonb,p_rewards jsonb,p_pick text default 'random')
returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.catalog_quests; conds jsonb; rewards jsonb; method text; diff jsonb:='{}'; change_no bigint;
begin
 if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
 if jsonb_typeof(p_conditions) is distinct from 'array' or jsonb_typeof(p_rewards) is distinct from 'array' then raise exception '조건·보상 목록 형식이 올바르지 않습니다'; end if;
 if jsonb_array_length(p_conditions)>100 or jsonb_array_length(p_rewards)>100 then raise exception '조건과 보상은 각각 100개까지 둘 수 있습니다'; end if;
 if coalesce(p_pick,'random') not in ('random','select') then raise exception '보상 받는 방식이 올바르지 않습니다'; end if;
 select * into old from public.catalog_quests where id=p_id for update;
 if not found then raise exception '퀘스트를 찾을 수 없습니다'; end if;
 if p_version is null or md5(extract(epoch from old.updated_at)::text)<>p_version then raise exception '다른 화면에서 수정되었습니다. 다시 불러온 뒤 저장해 주세요' using errcode='40001'; end if;
 select coalesce(jsonb_agg(catalog_import_private.quest_entry(x,'c') order by o),'[]') into conds from jsonb_array_elements(p_conditions) with ordinality e(x,o);
 select coalesce(jsonb_agg(catalog_import_private.quest_entry(x,'r') order by o),'[]') into rewards from jsonb_array_elements(p_rewards) with ordinality e(x,o);
 method:=case when jsonb_array_length(rewards)=0 then null
   when exists(select 1 from jsonb_array_elements(rewards) x where x ? 'r') then coalesce(p_pick,'random') else 'fixed' end;
 if conds is distinct from old.conditions then diff:=diff||jsonb_build_object('conditions',jsonb_build_object('before',old.conditions,'after',conds)); end if;
 if rewards is distinct from old.reward_items then diff:=diff||jsonb_build_object('reward_items',jsonb_build_object('before',old.reward_items,'after',rewards)); end if;
 if method is distinct from old.reward_method then diff:=diff||jsonb_build_object('reward_method',jsonb_build_object('before',old.reward_method,'after',method)); end if;
 if diff<>'{}' then
  update public.catalog_quests set conditions=conds,reward_items=rewards,reward_method=method,source='operator' where id=p_id;
  insert into public.catalog_changes(entity_type,entity_id,entity_name,operation,changes,release_label)
  values('quest',p_id,old.name,'UPDATE',diff,'운영자 퀘스트 조건·보상 수정') returning id into change_no;
  insert into catalog_import_private.change_backups(change_id,table_name,old_row,new_row)
  values(change_no,'catalog_quests',to_jsonb(old),(select to_jsonb(q) from public.catalog_quests q where id=p_id));
  update public.catalog_revision set revision=revision+1,updated_at=now() where singleton;
 end if;
 return public.catalog_quest_detail(p_id,null);
end $$;

revoke all on function catalog_import_private.quest_entry(jsonb,text) from public,anon,authenticated;
revoke all on function public.catalog_quest_set_deleted(uuid,boolean,text),public.catalog_quest_deleted_list(),
  public.catalog_quest_items_save(uuid,text,jsonb,jsonb,text) from public,anon;
grant execute on function public.catalog_quest_set_deleted(uuid,boolean,text),public.catalog_quest_deleted_list(),
  public.catalog_quest_items_save(uuid,text,jsonb,jsonb,text) to authenticated;

insert into catalog_import_private.completed_migrations(name) values('079_catalog_quest_items_delete') on conflict do nothing;
commit;
