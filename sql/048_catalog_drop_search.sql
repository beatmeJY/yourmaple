-- SQL047 이후 실행합니다. 검색 조건·반환 형식·권한·데이터는 유지합니다.
-- 같은 파일 재실행 가능. 운영 DB는 사용자가 SQL Editor에서 실행합니다.
begin;
create or replace function public.catalog_search_monsters(
 p_query text default '', p_drop text default '', p_min integer default null, p_max integer default null,
 p_weak text[] default '{}', p_resist text[] default '{}', p_sort text default 'level', p_page integer default 0
) returns jsonb language sql stable security invoker set search_path='' as $$
 -- 아이템 검색을 한 번 수행한 뒤 해당 몬스터 ID 집합을 재사용합니다.
 -- 빈 검색은 아이템/드랍을 읽지 않습니다. 동일 아이템 복수 드랍은 ID 집합에서만 중복 제거합니다.
 with matched_items as materialized (
 select id from public.catalog_items
 where coalesce(p_drop,'')<>'' and (strpos(lower(name),lower(p_drop))>0 or source_id=p_drop)
 ), matched_monsters as materialized (
 select distinct d.monster_id from matched_items i
 join public.catalog_monster_drops d on d.item_id=i.id
 ), filtered as (
 select m.id,m.name,m.level,m.hp,m.exp,m.required_accuracy,m.accuracy_per_level,m.hp_per_exp,m.weak_elements,m.resist_elements,m.image_url,m.source_id
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

insert into catalog_import_private.completed_migrations(name) values('048_catalog_drop_search') on conflict do nothing;
commit;
