-- 아이템 도감 분류(2026-11-23 사용자 요청): 종류 → 장비면 직업 5개(전사·마법사·궁수·도적·해적) → 부위로 좁혀 보기.
-- - catalog_search_items 에 p_kind·p_job·p_part·p_common 을 더한다. 예전 화면처럼 (검색어, 쪽)만 넘겨도 같은 결과다.
-- - 착용 직업은 catalog_item_jobs(044)를 쓴다. 공용 장비는 p_common 이 참이면(기본) 고른 직업 목록에도 함께 나온다.
--   듀얼블레이드는 도적, 배틀메이지는 마법사 장비를 쓰므로 직업은 5개만 둔다.
-- - 같은 부위의 다른 이름(Pole Arm=Polearm, Two-Handed Blunt Weapon=Two-Handed Blunt)은 한 부위로 묶는다(js/equipment-groups.js 와 같은 규칙).
-- - 결과에 칩 옆 숫자용 개수(kinds·jobs·parts)를 함께 돌려준다.
-- 074 이후 운영자가 SQL Editor 또는 DBeaver에서 전체 실행합니다. 같은 파일을 다시 실행해도 안전합니다.
-- 화면은 분류를 고를 때만 새 인자를 보내므로, 이 파일을 실행하기 전에 배포해도 기존 검색은 그대로 동작합니다.
begin;
select pg_advisory_xact_lock(20261028,43);

create or replace function public.catalog_item_part(sub text) returns text
language sql immutable set search_path='' as $$
  select case sub when 'Pole Arm' then 'Polearm' when 'Two-Handed Blunt Weapon' then 'Two-Handed Blunt' else nullif(sub,'') end
$$;

create or replace function public.catalog_item_kind(cat text) returns text
language sql immutable set search_path='' as $$
  select case
    when cat in ('장비','방어구','무기','Equip') then 'equip'
    when cat in ('소비','Use') then 'use'
    when cat in ('설치','Setup') then 'setup'
    when cat in ('기타','Etc') then 'etc'
    when cat = 'Cash' then 'cash'
    else 'other' end
$$;
grant execute on function public.catalog_item_part(text), public.catalog_item_kind(text) to anon, authenticated, service_role;

-- 예전 두 인자 함수는 지운다(같은 이름에 기본값 있는 함수가 둘이면 호출이 모호해짐).
drop function if exists public.catalog_search_items(text, integer);

create or replace function public.catalog_search_items(
  p_query text default '', p_page integer default 0,
  p_kind text default '', p_job text default '', p_part text default '', p_common boolean default true)
returns jsonb language sql stable security invoker set search_path='' as $$
 with q as (
  select coalesce(p_query, '') raw, lower(regexp_replace(coalesce(p_query, ''), '\s+', '', 'g')) norm
 ), opts as (
  select coalesce(nullif(p_kind, ''), case when coalesce(p_job, '') <> '' or coalesce(p_part, '') <> '' then 'equip' end) kind,
         nullif(p_job, '') job, nullif(p_part, '') part, coalesce(p_common, true) common
 ), variants as (
  select norm v from q where norm <> ''
  union
  select replace(q.norm, a.alias, a.target) from q join public.catalog_search_aliases a on q.norm <> '' and strpos(q.norm, a.alias) > 0
 ), patterns as (
  -- 글자 사이에 % 를 넣은 LIKE 패턴(054와 같음). 검색어의 % _ \ 는 글자 그대로 찾게 이스케이프한다.
  select v, '%' || (select string_agg(case when c in ('%', '_', '\') then '\' || c else c end, '%' order by o)
                    from regexp_split_to_table(v, '') with ordinality t(c, o)) || '%' sub
  from variants
 ), scored as (
  select i.id, i.name, i.category, i.middle_category, i.subcategory, i.required_level, i.image_url, i.source_id,
   (select min(case when strpos(n.name_norm, p.v) > 0 then 0 when n.name_norm like p.sub escape '\' then 1 end)
      from patterns p, (select lower(regexp_replace(i.name, '\s+', '', 'g')) name_norm) n) name_rank
  from public.catalog_items i
 ), matched as (
  select s.*, coalesce(s.name_rank, 2) match_rank, public.catalog_item_kind(s.category) kind, public.catalog_item_part(s.subcategory) part,
   array(select j.job_name from public.catalog_item_jobs j where j.item_id = s.id) jobs
  from scored s, q
  where q.norm = '' or s.name_rank is not null
   or strpos(lower(s.category), lower(q.raw)) > 0 or strpos(lower(coalesce(s.middle_category, '')), lower(q.raw)) > 0 or s.source_id = q.raw
 ), by_kind as (
  select m.* from matched m, opts o where o.kind is null or m.kind = o.kind
 ), by_job as (
  select b.* from by_kind b, opts o where o.job is null or o.job = any(b.jobs) or (o.common and '공용' = any(b.jobs))
 ), filtered as (
  select b.* from by_job b, opts o where o.part is null or b.part = o.part
 ), page as (
  select f.id, f.name, f.category, f.middle_category, f.subcategory, f.required_level, f.image_url, f.source_id,
   row_number() over (order by
     case when (select norm from q) = '' then 0 else f.match_rank end,
     case when (select norm from q) = '' then 0 else char_length(f.name) end,
     f.required_level asc nulls last, f.name, f.id) rn
  from filtered f
  order by rn
  limit 24 offset greatest(0, least(coalesce(p_page, 0), 10000)) * 24
 ) select jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(p) - 'rn' order by p.rn) from page p), '[]'),
  'total', (select count(*) from filtered),
  -- 칩 옆 숫자: 종류는 검색어만, 직업은 검색어+종류, 부위는 검색어+종류+직업 기준.
  'kinds', coalesce((select jsonb_object_agg(kind, n) from (select kind, count(*) n from matched group by kind) k), '{}'),
  'jobs', coalesce((select jsonb_object_agg(j, n) from (
     select j, count(*) n from by_kind b cross join unnest(array['전사','마법사','궁수','도적','해적']) j, opts o
     where b.kind = 'equip' and (j = any(b.jobs) or (o.common and '공용' = any(b.jobs))) group by j) c), '{}'),
  'common', (select count(*) from by_kind b where b.kind = 'equip' and '공용' = any(b.jobs)),
  'parts', coalesce((select jsonb_object_agg(part, n) from (
     select part, count(*) n from by_job where kind = 'equip' and part is not null group by part) c), '{}'),
  'revision', (select revision from public.catalog_revision where singleton))
$$;
revoke all on function public.catalog_search_items(text, integer, text, text, text, boolean) from public;
grant execute on function public.catalog_search_items(text, integer, text, text, text, boolean) to anon, authenticated, service_role;

insert into catalog_import_private.completed_migrations(name) values('075_catalog_item_categories') on conflict do nothing;
commit;
