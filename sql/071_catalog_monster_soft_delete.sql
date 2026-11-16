-- 몬스터 논리 삭제(2026-11-16 사용자 요청, 도감 관리자 전용).
-- 지운 몬스터는 행을 남겨 둔 채 공개 도감·검색·아이템의 드랍 몬스터에서만 숨긴다. 관리자는 "삭제한 몬스터" 화면에서 보고 복구한다.
-- 038·043을 다시 실행하면 공개 읽기 정책이 using(true)로 돌아가므로 이 파일도 다시 실행한다.
-- 070 이후 운영자가 SQL Editor 또는 DBeaver에서 전체 실행합니다. 같은 파일을 다시 실행해도 안전합니다.
begin;
select pg_advisory_xact_lock(20261028,43);

alter table public.catalog_monsters
 add column if not exists deleted_at timestamptz,
 add column if not exists deleted_reason text;
alter table public.catalog_monsters drop constraint if exists catalog_monsters_deleted_reason_len;
alter table public.catalog_monsters add constraint catalog_monsters_deleted_reason_len check (deleted_reason is null or length(deleted_reason)<=500);

-- 공개 읽기: 지운 몬스터는 보이지 않는다(검색 함수는 security invoker 라 함께 숨겨진다).
drop policy if exists catalog_read on public.catalog_monsters;
create policy catalog_read on public.catalog_monsters for select to anon,authenticated using (deleted_at is null);
-- 드랍도 지운 몬스터의 것은 숨긴다(아이템 상세의 드랍 몬스터·드랍템 검색). 하위 조회에도 위 정책이 적용된다.
drop policy if exists catalog_read on public.catalog_monster_drops;
create policy catalog_read on public.catalog_monster_drops for select to anon,authenticated
 using (exists (select 1 from public.catalog_monsters m where m.id=monster_id));

-- 그림 점검 목록(070)에서도 지운 몬스터는 뺀다.
create or replace function public.catalog_monster_image_audit()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'level',m.level,'source_id',m.source_id,'image_url',m.image_url,
   'image_link_monster_id',m.image_link_monster_id,'image_link_name',l.name,'image_fallback_url',l.image_url)
  order by m.level nulls last,m.name,m.id) from public.catalog_monsters m left join public.catalog_monsters l on l.id=m.image_link_monster_id
  where m.deleted_at is null),'[]'::jsonb);
end $$;

-- 삭제·복구: p_deleted=true 면 숨기고 false 면 되살린다. 이유는 관리자만 본다(500자까지).
create or replace function public.catalog_monster_set_deleted(p_id uuid,p_deleted boolean,p_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.catalog_monsters; reason text:=nullif(btrim(coalesce(p_reason,'')),'');
begin
 if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
 if p_deleted is null then raise exception '삭제 여부를 정해 주세요'; end if;
 if length(reason)>500 then raise exception '삭제 이유는 500자까지 적을 수 있습니다'; end if;
 select * into old from public.catalog_monsters where id=p_id for update;
 if not found then raise exception '몬스터를 찾을 수 없습니다'; end if;
 if (old.deleted_at is not null)=p_deleted then
  return jsonb_build_object('id',old.id,'deleted_at',old.deleted_at,'deleted_reason',old.deleted_reason); end if;
 update public.catalog_monsters
  set deleted_at=case when p_deleted then now() end, deleted_reason=case when p_deleted then reason end
  where id=p_id returning * into old;
 -- 공개 이력 트리거는 이 칸을 기록하지 않으므로 이력 한 건을 직접 남긴다(읽기는 관리자만, 069).
 insert into public.catalog_changes(entity_type,entity_id,entity_name,operation,changes,release_label)
 values('monster',p_id,old.name,'UPDATE',
  jsonb_build_object('deleted',jsonb_build_object('before',not p_deleted,'after',p_deleted))
   ||case when p_deleted and reason is not null then jsonb_build_object('deleted_reason',jsonb_build_object('before',null,'after',reason)) else '{}'::jsonb end,
  case when p_deleted then '운영자 몬스터 삭제' else '운영자 몬스터 복구' end);
 update public.catalog_revision set revision=revision+1,updated_at=now() where singleton;
 return jsonb_build_object('id',old.id,'deleted_at',old.deleted_at,'deleted_reason',old.deleted_reason);
end $$;

-- 삭제한 몬스터 목록(관리자 화면): 최근에 지운 순.
create or replace function public.catalog_monster_deleted_list()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'level',m.level,'hp',m.hp,'exp',m.exp,'source_id',m.source_id,
   'image_url',m.image_url,'image_fallback_url',l.image_url,'deleted_at',m.deleted_at,'deleted_reason',m.deleted_reason,
   'drop_count',(select count(*) from public.catalog_monster_drops d where d.monster_id=m.id))
  order by m.deleted_at desc,m.name,m.id)
  from public.catalog_monsters m left join public.catalog_monsters l on l.id=m.image_link_monster_id
  where m.deleted_at is not null),'[]'::jsonb);
end $$;

revoke all on function public.catalog_monster_set_deleted(uuid,boolean,text),public.catalog_monster_deleted_list() from public,anon;
grant execute on function public.catalog_monster_set_deleted(uuid,boolean,text),public.catalog_monster_deleted_list() to authenticated;
revoke all on function public.catalog_monster_image_audit() from public,anon;
grant execute on function public.catalog_monster_image_audit() to authenticated;
commit;
