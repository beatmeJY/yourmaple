-- 맵 정보(2026-11-23 사용자 결정).
-- - 맵(catalog_maps): 수집한 맵 전부를 보관한다(게임 맵 번호 source_id). 화면에는 우리 도감 몬스터가 나오는 맵만 보인다.
-- - 이름: 수집한 한국어 이름(name_source 'collected'). 관리자(검토 운영자)가 맵 상세에서 고치면 name_source 'operator' 가 되어
--   다시 등록해도 그대로 남는다. name_en·street_name_en 은 예비 칸이다.
-- - 몬스터 출현(catalog_map_monsters): 우리 도감 몬스터 ↔ 맵. 수집 연결(source 'collected')과 관리자 연결('operator')을 구분한다.
-- - 맵 상세(2026-11-23 사용자 요청): 맵 전체 그림(render: 공개 게임 데이터 서버 버전 v·기준점 ox,oy·크기 w,h — 그림 좌표 비율 = (게임 좌표 - 기준점) / 크기),
--   미니맵(minimap: 버전 v·중심 cx,cy·크기 w,h — 비율 = (게임 좌표 + 중심) / 크기),
--   다른 맵으로 가는 포탈(portals: 이름 n·위치 x,y·목적지 맵 번호 to·도착 포탈 tp·종류 t·보임 v), 도감 몬스터 등장 위치(spawns: 몬스터 번호 m·x,y),
--   맵마다 몬스터 최대 마릿수(catalog_map_monsters.max_count).
--   화면은 미니맵 위에 포탈과 몬스터 그림을 올리고, 포탈을 누르면 목적지 맵으로 넘어간다(몬스터가 없는 마을도 포탈로는 열린다).
-- - 공개 읽기(비로그인 포함), 쓰기는 SQL(운영자)·관리자 수정 함수만. 맵·연결 자료는 비공개 도구가 만든 maps.sql·map-monsters.sql 로 넣는다.
-- 075 이후 운영자가 SQL Editor 또는 DBeaver에서 전체 실행합니다. 같은 파일을 다시 실행해도 안전합니다.
begin;
select pg_advisory_xact_lock(20261028,43);

create table if not exists public.catalog_maps (
  id uuid primary key default gen_random_uuid(),
  source_id integer not null unique,
  name text not null,
  street_name text,
  name_en text,
  street_name_en text,
  name_source text not null default 'collected',
  in_old_version boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.catalog_maps drop constraint if exists catalog_maps_name_check;
alter table public.catalog_maps add constraint catalog_maps_name_check check (btrim(name)<>'' and length(name)<=200 and length(coalesce(street_name,''))<=200);
alter table public.catalog_maps add column if not exists minimap jsonb;
alter table public.catalog_maps add column if not exists render jsonb;
alter table public.catalog_maps add column if not exists portals jsonb not null default '[]';
alter table public.catalog_maps add column if not exists spawns jsonb not null default '[]';
alter table public.catalog_maps drop constraint if exists catalog_maps_detail_check;
alter table public.catalog_maps add constraint catalog_maps_detail_check check (
  jsonb_typeof(portals)='array' and jsonb_typeof(spawns)='array'
  and (minimap is null or (jsonb_typeof(minimap)='object' and (minimap->>'w')::numeric>0 and (minimap->>'h')::numeric>0))
  -- render: 그림 버전 v(예 gms/62) 필수, 기준점·크기는 있으면 넷 다(크기 > 0). 없으면 화면은 그림만 보인다.
  and (render is null or (jsonb_typeof(render)='object' and coalesce(render->>'v','') ~ '^[a-z]{3}/[0-9]{1,4}$'
       and ((render ?& array['ox','oy','w','h'] and (render->>'w')::numeric>0 and (render->>'h')::numeric>0)
            or not (render ?| array['ox','oy','w','h'])))));
alter table public.catalog_maps drop constraint if exists catalog_maps_name_source_check;
alter table public.catalog_maps add constraint catalog_maps_name_source_check check (name_source in ('collected','operator'));

create table if not exists public.catalog_map_monsters (
  map_id uuid not null references public.catalog_maps(id) on delete cascade,
  monster_id uuid not null references public.catalog_monsters(id) on delete cascade,
  source text not null default 'collected',
  created_at timestamptz not null default now(),
  primary key (map_id, monster_id)
);
alter table public.catalog_map_monsters add column if not exists max_count integer;
alter table public.catalog_map_monsters drop constraint if exists catalog_map_monsters_max_count_check;
alter table public.catalog_map_monsters add constraint catalog_map_monsters_max_count_check check (max_count is null or max_count between 1 and 1000);
alter table public.catalog_map_monsters drop constraint if exists catalog_map_monsters_source_check;
alter table public.catalog_map_monsters add constraint catalog_map_monsters_source_check check (source in ('collected','operator'));
create index if not exists catalog_map_monsters_monster_idx on public.catalog_map_monsters(monster_id);

-- 이름이 바뀌면 updated_at 을 갱신한다(관리자 수정의 버전 확인에 쓴다).
create or replace function public.catalog_maps_touch() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at:=now(); return new; end $$;
drop trigger if exists catalog_maps_touch on public.catalog_maps;
create trigger catalog_maps_touch before update on public.catalog_maps for each row
 when (old.* is distinct from new.*) execute function public.catalog_maps_touch();

-- 공용 도감처럼: 비로그인 포함 읽기만, 쓰기는 SQL Editor 운영자와 security definer 함수만.
alter table public.catalog_maps enable row level security;
alter table public.catalog_map_monsters enable row level security;
drop policy if exists catalog_read on public.catalog_maps;
create policy catalog_read on public.catalog_maps for select to anon, authenticated using (true);
drop policy if exists catalog_read on public.catalog_map_monsters;
create policy catalog_read on public.catalog_map_monsters for select to anon, authenticated using (true);
revoke all on public.catalog_maps, public.catalog_map_monsters from anon, authenticated;
grant select on public.catalog_maps, public.catalog_map_monsters to anon, authenticated;

-- 수집 연결 등록: 비공개 도구의 map-monsters.sql 이 이 표에 (몬스터 번호, 맵 번호)를 넣고 sync_map_monsters() 를 부른다.
-- (SQL Editor 에서 임시 표가 사라지는 일이 있어 일반 비공개 표를 쓴다.)
create table if not exists catalog_import_private.map_links_in (monster_source_id text not null, map_source_id integer not null);
alter table catalog_import_private.map_links_in add column if not exists max_count integer;
revoke all on catalog_import_private.map_links_in from public, anon, authenticated;

create or replace function catalog_import_private.sync_map_monsters() returns jsonb
language plpgsql set search_path='' as $$
declare added integer; updated integer; removed integer;
begin
  -- 수집 연결만 다시 맞춘다. 관리자가 넣은 연결(operator)은 건드리지 않는다.
  -- 새 연결은 넣고, 수집 연결의 최대 마릿수가 바뀌었으면 고친다(관리자 연결은 그대로).
  with wanted as (
    select mp.id map_id, mo.id monster_id, max(l.max_count) max_count
    from catalog_import_private.map_links_in l
    join public.catalog_maps mp on mp.source_id=l.map_source_id
    join public.catalog_monsters mo on mo.source_id=l.monster_source_id
    group by mp.id, mo.id
  ), ins as (
    insert into public.catalog_map_monsters(map_id, monster_id, source, max_count)
    select map_id, monster_id, 'collected', max_count from wanted
    on conflict (map_id, monster_id) do update set max_count=excluded.max_count
    where catalog_map_monsters.source='collected' and catalog_map_monsters.max_count is distinct from excluded.max_count
    returning (xmax=0) inserted
  ) select count(*) filter (where inserted), count(*) filter (where not inserted) into added, updated from ins;
  with del as (
    delete from public.catalog_map_monsters c
    where c.source='collected' and not exists (
      select 1 from catalog_import_private.map_links_in l
      join public.catalog_maps mp on mp.source_id=l.map_source_id
      join public.catalog_monsters mo on mo.source_id=l.monster_source_id
      where mp.id=c.map_id and mo.id=c.monster_id)
    returning 1
  ) select count(*) into removed from del;
  delete from catalog_import_private.map_links_in;
  if added+updated+removed>0 then update public.catalog_revision set revision=revision+1, updated_at=now() where singleton; end if;
  return jsonb_build_object('added', added, 'updated', updated, 'removed', removed);
end $$;
revoke all on function catalog_import_private.sync_map_monsters() from public, anon, authenticated;

-- 맵 목록: 우리 도감 몬스터(지우지 않은)가 하나라도 나오는 맵만. 검색어는 이름·지역·맵 번호, 지역(p_street)으로 좁힌다.
-- 같은 순위면 몬스터 최저 레벨 순. 지역 칩용 개수(streets)를 함께 돌려준다.
create or replace function public.catalog_search_maps(p_query text default '', p_street text default '', p_page integer default 0)
returns jsonb language sql stable security invoker set search_path='' as $$
 with q as (
  select btrim(coalesce(p_query,'')) raw, lower(regexp_replace(coalesce(p_query,''),'\s+','','g')) norm, nullif(btrim(coalesce(p_street,'')),'') street
 ), shown as (
  select m.id, m.source_id, m.name, m.street_name, m.name_source, coalesce(m.minimap->>'v', m.render->>'v') image_v,
   count(mo.id) monster_count, min(mo.level) min_level, max(mo.level) max_level,
   (array_agg(jsonb_build_object('id',mo.id,'name',mo.name,'level',mo.level,'source_id',mo.source_id,'image_url',mo.image_url,'image_fallback_url',(select l.image_url from public.catalog_monsters l where l.id=mo.image_link_monster_id)) order by mo.level, mo.name))[1:4] monsters
  from public.catalog_maps m
  join public.catalog_map_monsters c on c.map_id=m.id
  join public.catalog_monsters mo on mo.id=c.monster_id and mo.deleted_at is null
  group by m.id
 ), matched as (
  select s.* from shown s, q
  where q.norm='' or strpos(lower(regexp_replace(s.name,'\s+','','g')), q.norm)>0
   or strpos(lower(regexp_replace(coalesce(s.street_name,''),'\s+','','g')), q.norm)>0 or s.source_id::text=q.raw
   or exists(select 1 from public.catalog_map_monsters c join public.catalog_monsters mo on mo.id=c.monster_id and mo.deleted_at is null
             where c.map_id=s.id and strpos(lower(regexp_replace(mo.name,'\s+','','g')), q.norm)>0)
 ), filtered as (
  select m.* from matched m, q where q.street is null or m.street_name=q.street
 ), page as (
  select f.*, row_number() over (order by f.min_level nulls last, f.street_name nulls last, f.name, f.source_id) rn
  from filtered f order by rn
  limit 24 offset greatest(0, least(coalesce(p_page,0),10000))*24
 ) select jsonb_build_object(
  'rows', coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'source_id',p.source_id,'name',p.name,'street_name',p.street_name,'name_source',p.name_source,'image_v',p.image_v,
     'monster_count',p.monster_count,'min_level',p.min_level,'max_level',p.max_level,'monsters',to_jsonb(p.monsters)) order by p.rn) from page p),'[]'),
  'total', (select count(*) from filtered),
  'streets', coalesce((select jsonb_object_agg(coalesce(street_name,''), n) from (select street_name, count(*) n from matched group by street_name) s),'{}'),
  'revision', (select revision from public.catalog_revision where singleton))
$$;

-- 맵 상세: 맵 + 나오는 우리 몬스터(레벨 순). 맵 번호(p_source_id)나 id 로 찾는다.
create or replace function public.catalog_map_detail(p_id uuid default null, p_source_id integer default null)
returns jsonb language sql stable security invoker set search_path='' as $$
 with m as (select * from public.catalog_maps where id=p_id or (p_id is null and source_id=p_source_id) limit 1)
 select case when not exists(select 1 from m) then null else jsonb_build_object(
  'map', (select jsonb_build_object('id',id,'source_id',source_id,'name',name,'street_name',street_name,'name_en',name_en,'street_name_en',street_name_en,
          'name_source',name_source,'in_old_version',in_old_version,'version',md5(extract(epoch from updated_at)::text)) from m),
  'monsters', coalesce((select jsonb_agg(jsonb_build_object('id',mo.id,'name',mo.name,'level',mo.level,'hp',mo.hp,'exp',mo.exp,'source_id',mo.source_id,'image_url',mo.image_url,'image_fallback_url',(select l.image_url from public.catalog_monsters l where l.id=mo.image_link_monster_id),'source',c.source,'max_count',c.max_count)
          order by mo.level, mo.name) from m join public.catalog_map_monsters c on c.map_id=m.id join public.catalog_monsters mo on mo.id=c.monster_id and mo.deleted_at is null),'[]'),
  'minimap', (select minimap from m),
  'render', (select render from m),
  -- 포탈마다 목적지 맵 이름·지역을 붙인다(목적지가 표에 없으면 빠짐).
  'portals', coalesce((select jsonb_agg(p.value || jsonb_build_object('to_name',t.name,'to_street',t.street_name) order by p.ord)
          from m, jsonb_array_elements(m.portals) with ordinality p(value,ord)
          join public.catalog_maps t on t.source_id=(p.value->>'to')::integer),'[]'),
  -- 등장 위치는 지우지 않은 도감 몬스터만, 몬스터 정보와 함께.
  'spawns', coalesce((select jsonb_agg(jsonb_build_object('x',sp.value->'x','y',sp.value->'y','monster_id',mo.id) order by sp.ord)
          from m, jsonb_array_elements(m.spawns) with ordinality sp(value,ord)
          join public.catalog_monsters mo on mo.source_id=sp.value->>'m' and mo.deleted_at is null),'[]'),
  'revision', (select revision from public.catalog_revision where singleton)) end
$$;

-- 몬스터가 나오는 맵(몬스터 상세용).
create or replace function public.catalog_monster_maps(p_monster_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'source_id',m.source_id,'name',m.name,'street_name',m.street_name) order by m.street_name nulls last, m.name),'[]')
 from public.catalog_map_monsters c join public.catalog_maps m on m.id=c.map_id where c.monster_id=p_monster_id
$$;

-- 관리자 맵 이름 수정. 버전(md5(updated_at 의 epoch))이 다르면 거절, 바뀐 값만 이력에 남긴다.
create or replace function public.catalog_map_edit_save(p_id uuid, p_version text, p_name text, p_street_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.catalog_maps; diff jsonb:='{}'; change_no bigint;
begin
  if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
  if p_name is null or btrim(p_name)='' or length(btrim(p_name))>200 then raise exception '맵 이름은 1~200자로 입력해 주세요'; end if;
  if length(coalesce(p_street_name,''))>200 then raise exception '지역 이름은 200자까지 입력할 수 있습니다'; end if;
  select * into old from public.catalog_maps where id=p_id for update;
  if not found then raise exception '맵을 찾을 수 없습니다'; end if;
  if p_version is null or md5(extract(epoch from old.updated_at)::text)<>p_version then raise exception '다른 화면에서 수정되었습니다. 다시 불러온 뒤 저장해 주세요' using errcode='40001'; end if;
  if old.name is distinct from btrim(p_name) then diff:=diff||jsonb_build_object('name',jsonb_build_object('before',old.name,'after',btrim(p_name))); end if;
  if old.street_name is distinct from nullif(btrim(coalesce(p_street_name,'')),'') then
    diff:=diff||jsonb_build_object('street_name',jsonb_build_object('before',old.street_name,'after',nullif(btrim(coalesce(p_street_name,'')),''))); end if;
  if diff<>'{}' then
    update public.catalog_maps set name=btrim(p_name), street_name=nullif(btrim(coalesce(p_street_name,'')),''), name_source='operator' where id=p_id;
    insert into public.catalog_changes(entity_type,entity_id,entity_name,operation,changes,release_label)
    values('map',p_id,btrim(p_name),'UPDATE',diff,'운영자 맵 수정') returning id into change_no;
    insert into catalog_import_private.change_backups(change_id,table_name,old_row,new_row)
    values(change_no,'catalog_maps',to_jsonb(old),(select to_jsonb(m) from public.catalog_maps m where id=p_id));
    update public.catalog_revision set revision=revision+1, updated_at=now() where singleton;
  end if;
  return public.catalog_map_detail(p_id, null);
end $$;

revoke all on function public.catalog_search_maps(text,text,integer), public.catalog_map_detail(uuid,integer), public.catalog_monster_maps(uuid) from public;
grant execute on function public.catalog_search_maps(text,text,integer), public.catalog_map_detail(uuid,integer), public.catalog_monster_maps(uuid) to anon, authenticated, service_role;
revoke all on function public.catalog_map_edit_save(uuid,text,text,text), public.catalog_maps_touch() from public, anon;
grant execute on function public.catalog_map_edit_save(uuid,text,text,text) to authenticated;

insert into catalog_import_private.completed_migrations(name) values('076_catalog_maps') on conflict do nothing;
commit;
