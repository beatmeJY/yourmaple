-- SQL Editor 또는 DBeaver 쓰기 연결에서 전체 실행합니다(재실행 가능). 화면 배포는 이 파일과 순서 상관없음.
-- 아이템 검색을 편하게(2026-10-30 사용자 요청): 띄어쓰기 무시, 글자가 이름에 순서대로만 있어도 찾기(혼주문 → 혼돈의 주문서 60%),
-- 별명으로도 찾기(혼줌 → 혼돈의 주문서). 검색어가 있으면 그대로 들어간 이름 → 글자 순서만 맞는 이름 → 분류·외부 ID 순, 같은 순위는 짧은 이름 먼저.
-- 검색어가 없으면 예전처럼 착용 레벨·이름 순. 반환 형식(rows·total·revision)과 권한은 그대로. 규칙은 js/search-match.js 와 같다.
begin;
select pg_advisory_xact_lock(20261028,43);

-- 별명 표: 별명·본래 이름 모두 띄어쓰기 없는 소문자. 공개 읽기, 쓰기는 SQL Editor 운영자만.
create table if not exists public.catalog_search_aliases (
  alias text primary key check (alias <> '' and alias = lower(regexp_replace(alias, '\s+', '', 'g'))),
  target text not null check (target <> '' and target = lower(regexp_replace(target, '\s+', '', 'g'))),
  created_at timestamptz not null default now()
);
alter table public.catalog_search_aliases enable row level security;
revoke all on public.catalog_search_aliases from public, anon, authenticated;
grant select on public.catalog_search_aliases to anon, authenticated;
grant all on public.catalog_search_aliases to service_role;
drop policy if exists catalog_read on public.catalog_search_aliases;
create policy catalog_read on public.catalog_search_aliases for select to anon, authenticated using (true);
insert into public.catalog_search_aliases(alias, target) values ('혼줌', '혼돈의주문서') on conflict do nothing;

create or replace function public.catalog_search_items(p_query text default '', p_page integer default 0)
returns jsonb language sql stable security invoker set search_path='' as $$
 with q as (
  select coalesce(p_query, '') raw, lower(regexp_replace(coalesce(p_query, ''), '\s+', '', 'g')) norm
 ), variants as (
  select norm v from q where norm <> ''
  union
  select replace(q.norm, a.alias, a.target) from q join public.catalog_search_aliases a on q.norm <> '' and strpos(q.norm, a.alias) > 0
 ), patterns as (
  -- 글자 사이에 % 를 넣은 LIKE 패턴. 검색어의 % _ \ 는 글자 그대로 찾게 이스케이프한다.
  select v, '%' || (select string_agg(case when c in ('%', '_', '\') then '\' || c else c end, '%' order by o)
                    from regexp_split_to_table(v, '') with ordinality t(c, o)) || '%' sub
  from variants
 ), scored as (
  select i.id, i.name, i.category, i.middle_category, i.subcategory, i.required_level, i.image_url, i.source_id,
   (select min(case when strpos(n.name_norm, p.v) > 0 then 0 when n.name_norm like p.sub escape '\' then 1 end)
      from patterns p, (select lower(regexp_replace(i.name, '\s+', '', 'g')) name_norm) n) name_rank
  from public.catalog_items i
 ), filtered as (
  select s.*, coalesce(s.name_rank, 2) match_rank from scored s, q
  where q.norm = '' or s.name_rank is not null
   or strpos(lower(s.category), lower(q.raw)) > 0 or strpos(lower(coalesce(s.middle_category, '')), lower(q.raw)) > 0 or s.source_id = q.raw
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
  'total', (select count(*) from filtered), 'revision', (select revision from public.catalog_revision where singleton))
$$;
revoke all on function public.catalog_search_items(text, integer) from public;
grant execute on function public.catalog_search_items(text, integer) to anon, authenticated, service_role;

insert into catalog_import_private.completed_migrations(name) values('054_catalog_item_fuzzy_search') on conflict do nothing;
commit;
