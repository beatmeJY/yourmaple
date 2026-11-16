-- 몬스터 그림 점검·대체 그림 연결(2026-11-16 사용자 요청, 도감 관리자 전용).
-- 우선순위: 원본 그림(image_url) → 안 뜨거나 없으면 관리자가 이어 둔 다른 몬스터의 그림.
-- 예: 스티지(월묘)의 원본 그림이 안 뜨면 스티지 그림을 대신 보여 준다. 원본 주소는 덮어쓰지 않는다.
-- 원본 API로 확인해 주소 자체가 틀렸던 경우(예: 없는 동작 stand)는 관리자가 원본 API 주소로 고칠 수 있다.
-- 069 이후 운영자가 SQL Editor 또는 DBeaver에서 전체 실행합니다. 같은 파일을 다시 실행해도 안전합니다.
begin;
select pg_advisory_xact_lock(20261028,43);

alter table public.catalog_monsters
 add column if not exists image_link_monster_id uuid references public.catalog_monsters(id) on delete set null;
alter table public.catalog_monsters drop constraint if exists catalog_monsters_image_link_not_self;
alter table public.catalog_monsters add constraint catalog_monsters_image_link_not_self check (image_link_monster_id is distinct from id);
grant select(image_link_monster_id) on public.catalog_monsters to anon,authenticated;

-- 목록 검색(048과 같음)에 대체 그림 주소(image_fallback_url)만 더한다. 이어 둔 몬스터의 그림이 바뀌면 따라간다.
create or replace function public.catalog_search_monsters(
 p_query text default '', p_drop text default '', p_min integer default null, p_max integer default null,
 p_weak text[] default '{}', p_resist text[] default '{}', p_sort text default 'level', p_page integer default 0
) returns jsonb language sql stable security invoker set search_path='' as $$
 with matched_items as materialized (
 select id from public.catalog_items
 where coalesce(p_drop,'')<>'' and (strpos(lower(name),lower(p_drop))>0 or source_id=p_drop)
 ), matched_monsters as materialized (
 select distinct d.monster_id from matched_items i
 join public.catalog_monster_drops d on d.item_id=i.id
 ), filtered as (
 select m.id,m.name,m.level,m.hp,m.exp,m.required_accuracy,m.accuracy_per_level,m.hp_per_exp,m.weak_elements,m.resist_elements,m.image_url,m.source_id,
  (select l.image_url from public.catalog_monsters l where l.id=m.image_link_monster_id) image_fallback_url
 from public.catalog_monsters m
 where (coalesce(p_query,'')='' or strpos(lower(m.name),lower(p_query))>0 or m.source_id=p_query)
 and (p_min is null or m.level>=p_min) and (p_max is null or m.level<=p_max)
 and coalesce(p_weak,'{}') <@ coalesce(string_to_array(m.weak_elements,', '),'{}')
 and coalesce(p_resist,'{}') <@ coalesce(string_to_array(m.resist_elements,', '),'{}')
 and (coalesce(p_drop,'')='' or m.id in(select monster_id from matched_monsters))
 ), page as (
 select * from filtered order by case when p_sort='eff' then hp_per_exp end asc nulls last,level asc nulls last,name,id
 limit 24 offset greatest(0,least(coalesce(p_page,0),10000))*24
 ) select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)) from page p),'[]'),
 'total',(select count(*) from filtered),'revision',(select revision from public.catalog_revision where singleton))
$$;
revoke all on function public.catalog_search_monsters(text,text,integer,integer,text[],text[],text,integer) from public;
grant execute on function public.catalog_search_monsters(text,text,integer,integer,text[],text[],text,integer) to anon,authenticated,service_role;

-- 점검용 전체 목록: 원본 주소·이어 둔 몬스터까지 한 번에 받는다.
create or replace function public.catalog_monster_image_audit()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'level',m.level,'source_id',m.source_id,'image_url',m.image_url,
   'image_link_monster_id',m.image_link_monster_id,'image_link_name',l.name,'image_fallback_url',l.image_url)
  order by m.level nulls last,m.name,m.id) from public.catalog_monsters m left join public.catalog_monsters l on l.id=m.image_link_monster_id),'[]'::jsonb);
end $$;

-- 원본 그림 주소 고치기: 원본 API에서 확인한 주소로만 쓴다. p_expected 는 화면이 본 지금 주소(그사이 바뀌면 거절).
create or replace function public.catalog_monster_set_image(p_id uuid,p_expected text,p_image_url text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.catalog_monsters;
begin
 if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
 if p_image_url is not null and (p_image_url !~ '^https://[^[:space:]]+$' or length(p_image_url)>2000) then
  raise exception 'https:// 로 시작하는 그림 주소를 입력해 주세요'; end if;
 select * into old from public.catalog_monsters where id=p_id for update;
 if not found then raise exception '몬스터를 찾을 수 없습니다'; end if;
 if old.image_url is distinct from p_expected then
  raise exception '다른 화면에서 그림이 바뀌었습니다. 다시 확인해 주세요' using errcode='40001'; end if;
 if old.image_url is not distinct from p_image_url then return jsonb_build_object('id',old.id,'image_url',old.image_url); end if;
 perform set_config('yourmaple.release_label','운영자 원본 그림 주소 수정',true);
 update public.catalog_monsters set image_url=p_image_url where id=p_id;
 return jsonb_build_object('id',p_id,'image_url',p_image_url);
end $$;

-- 대체 그림 연결: p_link 몬스터의 그림을 원본이 안 뜰 때 보여 준다. null 이면 연결 해제.
create or replace function public.catalog_monster_set_image_link(p_id uuid,p_expected uuid,p_link uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.catalog_monsters; target public.catalog_monsters; before_name text; change_no bigint;
begin
 if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
 select * into old from public.catalog_monsters where id=p_id for update;
 if not found then raise exception '몬스터를 찾을 수 없습니다'; end if;
 if old.image_link_monster_id is distinct from p_expected then
  raise exception '다른 화면에서 그림 연결이 바뀌었습니다. 다시 확인해 주세요' using errcode='40001'; end if;
 if p_link is not null then
  if p_link=p_id then raise exception '자기 자신은 연결할 수 없습니다'; end if;
  select * into target from public.catalog_monsters where id=p_link;
  if not found then raise exception '연결할 몬스터를 찾을 수 없습니다'; end if;
  if target.image_url is null then raise exception '연결할 몬스터에 그림이 없습니다'; end if;
 end if;
 if old.image_link_monster_id is not distinct from p_link then
  return jsonb_build_object('id',old.id,'image_link_monster_id',p_link,'image_fallback_url',target.image_url); end if;
 select name into before_name from public.catalog_monsters where id=old.image_link_monster_id;
 update public.catalog_monsters set image_link_monster_id=p_link where id=p_id;
 -- 공개 이력 트리거는 이 칸을 기록하지 않으므로 이력 한 건을 직접 남긴다(읽기는 관리자만, 069).
 insert into public.catalog_changes(entity_type,entity_id,entity_name,operation,changes,release_label)
 values('monster',p_id,old.name,'UPDATE',jsonb_build_object('image_link',jsonb_build_object('before',before_name,'after',target.name)),'운영자 대체 그림 연결')
 returning id into change_no;
 update public.catalog_revision set revision=revision+1,updated_at=now() where singleton;
 return jsonb_build_object('id',p_id,'image_link_monster_id',p_link,'image_fallback_url',target.image_url);
end $$;

revoke all on function public.catalog_monster_image_audit(),public.catalog_monster_set_image(uuid,text,text),public.catalog_monster_set_image_link(uuid,uuid,uuid) from public,anon;
grant execute on function public.catalog_monster_image_audit(),public.catalog_monster_set_image(uuid,text,text),public.catalog_monster_set_image_link(uuid,uuid,uuid) to authenticated;
commit;
