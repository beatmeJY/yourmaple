-- 퀘스트 정보(2026-11-23 사용자 요청: 할 일 목록 5번).
-- - 퀘스트(catalog_quests): 수집한 퀘스트 전부(게임 퀘스트 번호 source_id). 공개 읽기(비로그인 포함), 쓰기는 SQL(운영자)·관리자 수정 함수만.
-- - 칸: 이름, 레벨(min/max), 직업 제한(jobs: 게임 직업 번호 배열, 비면 제한 없음), 보상 경험치·메소·인기도,
--   시작·완료 NPC(start_npc/end_npc: {id 번호, n 이름, v 그림 버전}), 시작·완료 맵 번호(start_map/end_map, 맵 표에 없을 수 있어 외래키 없음),
--   지역(region: 시작 맵의 지역 묶음, region_group: 그 위 묶음), 게임 안 안내 글(start_text 시작 조건·progress_text 진행·complete_text 완료),
--   완료 조건(conditions: [{i 아이템 번호 | m 몬스터 번호, c 개수, n 이름, v 그림 버전}]),
--   보상 아이템(reward_method: fixed 모두 받음·random 하나 무작위·select 하나 고름, reward_items: [{i, c, n, v}]),
--   선행 퀘스트(prerequisites)·다음 퀘스트(next_quests) 번호 배열.
-- - 아이템·몬스터는 번호로 우리 도감과 잇는다(상세 함수가 도감 이름·그림을 붙이고, 도감에 없으면 수집 이름 그대로).
-- - 관리자(검토 운영자)가 고친 퀘스트는 source 'operator' 가 되어 다시 등록해도 그대로 남는다.
-- - 등록 자료는 비공개 도구가 만든 quests.sql 로 넣는다. 076 이후 운영자가 SQL Editor 또는 DBeaver에서 전체 실행합니다.
--   같은 파일을 다시 실행해도 안전합니다.
begin;
select pg_advisory_xact_lock(20261028,43);

create table if not exists public.catalog_quests (
  id uuid primary key default gen_random_uuid(),
  source_id integer not null unique,
  name text not null,
  min_level integer,
  max_level integer,
  jobs integer[] not null default '{}',
  reward_exp bigint,
  reward_meso bigint,
  reward_fame integer,
  start_npc jsonb,
  end_npc jsonb,
  start_map integer,
  end_map integer,
  region text,
  region_group text,
  start_text text,
  progress_text text,
  complete_text text,
  conditions jsonb not null default '[]',
  reward_method text,
  reward_items jsonb not null default '[]',
  prerequisites integer[] not null default '{}',
  next_quests integer[] not null default '{}',
  source text not null default 'collected',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.catalog_quests drop constraint if exists catalog_quests_values_check;
alter table public.catalog_quests add constraint catalog_quests_values_check check (
  source_id > 0 and btrim(name) <> '' and length(name) <= 200
  and (min_level is null or min_level between 1 and 300) and (max_level is null or max_level between 1 and 300)
  and (min_level is null or max_level is null or min_level <= max_level)
  and (reward_exp is null or reward_exp between 0 and 100000000000) and (reward_meso is null or reward_meso between -100000000000 and 100000000000)
  and (reward_fame is null or reward_fame between -10000 and 10000)
  and length(coalesce(region,'')) <= 100 and length(coalesce(region_group,'')) <= 100
  and length(coalesce(start_text,'')) <= 4000 and length(coalesce(progress_text,'')) <= 4000 and length(coalesce(complete_text,'')) <= 4000
  and jsonb_typeof(conditions) = 'array' and jsonb_typeof(reward_items) = 'array'
  and (start_npc is null or jsonb_typeof(start_npc) = 'object') and (end_npc is null or jsonb_typeof(end_npc) = 'object')
  and (reward_method is null or reward_method in ('fixed','random','select'))
  and source in ('collected','operator'));
create index if not exists catalog_quests_level_idx on public.catalog_quests(min_level);

create or replace function public.catalog_quests_touch() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at:=now(); return new; end $$;
drop trigger if exists catalog_quests_touch on public.catalog_quests;
create trigger catalog_quests_touch before update on public.catalog_quests for each row
  when (old.* is distinct from new.*) execute function public.catalog_quests_touch();

alter table public.catalog_quests enable row level security;
drop policy if exists catalog_read on public.catalog_quests;
create policy catalog_read on public.catalog_quests for select to anon, authenticated using (true);
revoke all on public.catalog_quests from anon, authenticated;
grant select on public.catalog_quests to anon, authenticated;

-- 퀘스트 목록: 검색어(이름·NPC·지역·조건/보상 아이템·몬스터 이름·퀘스트 번호, 띄어쓰기 무시), 지역, 레벨(그 레벨에 받을 수 있는 것).
-- 레벨 낮은 순(레벨 없는 것은 뒤). 지역 칩용 개수(regions)를 함께 돌려준다.
create or replace function public.catalog_search_quests(p_query text default '', p_region text default '', p_level integer default null, p_page integer default 0)
returns jsonb language sql stable security invoker set search_path='' as $$
 with q as (
  select btrim(coalesce(p_query,'')) raw, lower(regexp_replace(coalesce(p_query,''),'\s+','','g')) norm, nullif(btrim(coalesce(p_region,'')),'') region,
   case when p_level between 1 and 300 then p_level end lv
 ), matched as (
  select t.* from public.catalog_quests t, q
  where (q.norm='' or t.source_id::text=q.raw
    or strpos(lower(regexp_replace(t.name||' '||coalesce(t.start_npc->>'n','')||' '||coalesce(t.end_npc->>'n','')||' '||coalesce(t.region,''),'\s+','','g')), q.norm)>0
    or exists(select 1 from jsonb_array_elements(t.conditions||t.reward_items) x where strpos(lower(regexp_replace(coalesce(x->>'n',''),'\s+','','g')), q.norm)>0))
   and (q.lv is null or ((t.min_level is null or t.min_level<=q.lv) and (t.max_level is null or t.max_level>=q.lv)))
 ), filtered as (
  select m.* from matched m, q where q.region is null or coalesce(m.region,'')=case when q.region='-' then '' else q.region end
 ), page as (
  select f.*, row_number() over (order by f.min_level nulls last, f.region nulls last, f.name, f.source_id) rn
  from filtered f order by rn
  limit 24 offset greatest(0, least(coalesce(p_page,0),10000))*24
 ) select jsonb_build_object(
  'rows', coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'source_id',p.source_id,'name',p.name,'min_level',p.min_level,'max_level',p.max_level,
     'jobs',to_jsonb(p.jobs),'reward_exp',p.reward_exp,'reward_meso',p.reward_meso,'region',p.region,'start_npc',p.start_npc,
     'condition_count',jsonb_array_length(p.conditions),'reward_count',jsonb_array_length(p.reward_items),
     'rewards',(select coalesce(jsonb_agg(x),'[]') from (select x from jsonb_array_elements(p.reward_items) x limit 4) s),
     'chain',cardinality(p.prerequisites)+cardinality(p.next_quests)>0) order by p.rn) from page p),'[]'),
  'total', (select count(*) from filtered),
  'regions', coalesce((select jsonb_object_agg(coalesce(region,''), n) from (select region, count(*) n from matched group by region) s),'{}'),
  'revision', (select revision from public.catalog_revision where singleton))
$$;

-- 퀘스트 상세: 조건·보상에 우리 도감 아이템·몬스터(번호가 같은 것, 지운 몬스터 제외)를 붙이고,
-- 시작·완료 맵 이름, 선행·다음 퀘스트 이름·레벨을 붙인다. 퀘스트 번호(p_source_id)나 id 로 찾는다.
create or replace function public.catalog_quest_detail(p_id uuid default null, p_source_id integer default null)
returns jsonb language sql stable security invoker set search_path='' as $$
 with t as (select * from public.catalog_quests where id=p_id or (p_id is null and source_id=p_source_id) limit 1),
 linked as (
  select x.kind, x.ord, x.value || jsonb_strip_nulls(jsonb_build_object(
     'item', (select jsonb_build_object('id',it.id,'name',it.name,'image_url',it.image_url,'source_id',it.source_id) from public.catalog_items it where x.value ? 'i' and it.source_id=x.value->>'i' limit 1),
     'monster', (select jsonb_build_object('id',mo.id,'name',mo.name,'level',mo.level,'image_url',mo.image_url,'source_id',mo.source_id,
                   'image_fallback_url',(select l.image_url from public.catalog_monsters l where l.id=mo.image_link_monster_id))
                 from public.catalog_monsters mo where x.value ? 'm' and mo.source_id=x.value->>'m' and mo.deleted_at is null limit 1))) value
  from t, lateral (select 'c' kind, value, ord from jsonb_array_elements(t.conditions) with ordinality c(value,ord)
                   union all select 'r', value, ord from jsonb_array_elements(t.reward_items) with ordinality r(value,ord)) x
 ), quest_refs as (
  select k.kind, k.ord, q.id, q.source_id, q.name, q.min_level from t,
   lateral (select 'p' kind, n, ord from unnest(t.prerequisites) with ordinality p(n,ord) union all select 'n', n, ord from unnest(t.next_quests) with ordinality n(n,ord)) k
   join public.catalog_quests q on q.source_id=k.n
 )
 select case when not exists(select 1 from t) then null else jsonb_build_object(
  'quest', (select to_jsonb(t) - 'created_at' - 'updated_at' || jsonb_build_object('version',md5(extract(epoch from t.updated_at)::text)) from t),
  'conditions', coalesce((select jsonb_agg(value order by ord) from linked where kind='c'),'[]'),
  'rewards', coalesce((select jsonb_agg(value order by ord) from linked where kind='r'),'[]'),
  'start_map', (select jsonb_build_object('id',m.id,'source_id',m.source_id,'name',m.name,'street_name',m.street_name) from t join public.catalog_maps m on m.source_id=t.start_map),
  'end_map', (select jsonb_build_object('id',m.id,'source_id',m.source_id,'name',m.name,'street_name',m.street_name) from t join public.catalog_maps m on m.source_id=t.end_map),
  'prerequisites', coalesce((select jsonb_agg(jsonb_build_object('id',id,'source_id',source_id,'name',name,'min_level',min_level) order by ord) from quest_refs where kind='p'),'[]'),
  'next_quests', coalesce((select jsonb_agg(jsonb_build_object('id',id,'source_id',source_id,'name',name,'min_level',min_level) order by ord) from quest_refs where kind='n'),'[]'),
  'revision', (select revision from public.catalog_revision where singleton)) end
$$;

-- 관리자 퀘스트 수정: 이름·레벨·보상 경험치/메소/인기도. 버전(md5(updated_at 의 epoch))이 다르면 거절, 바뀐 값만 이력에 남긴다.
create or replace function public.catalog_quest_edit_save(p_id uuid, p_version text, p_name text, p_min_level integer, p_max_level integer,
  p_reward_exp bigint, p_reward_meso bigint, p_reward_fame integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.catalog_quests; diff jsonb:='{}'; change_no bigint; k text; before jsonb; after jsonb;
begin
  if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
  if p_name is null or btrim(p_name)='' or length(btrim(p_name))>200 then raise exception '퀘스트 이름은 1~200자로 입력해 주세요'; end if;
  if (p_min_level is not null and p_min_level not between 1 and 300) or (p_max_level is not null and p_max_level not between 1 and 300) then raise exception '레벨은 1~300 사이로 입력해 주세요'; end if;
  if p_min_level is not null and p_max_level is not null and p_min_level>p_max_level then raise exception '최소 레벨이 최대 레벨보다 큽니다'; end if;
  if (p_reward_exp is not null and p_reward_exp not between 0 and 100000000000) or (p_reward_meso is not null and abs(p_reward_meso)>100000000000)
     or (p_reward_fame is not null and abs(p_reward_fame)>10000) then raise exception '보상 값이 범위를 벗어났습니다'; end if;
  select * into old from public.catalog_quests where id=p_id for update;
  if not found then raise exception '퀘스트를 찾을 수 없습니다'; end if;
  if p_version is null or md5(extract(epoch from old.updated_at)::text)<>p_version then raise exception '다른 화면에서 수정되었습니다. 다시 불러온 뒤 저장해 주세요' using errcode='40001'; end if;
  for k, before, after in select * from (values
      ('name', to_jsonb(old.name), to_jsonb(btrim(p_name))), ('min_level', to_jsonb(old.min_level), to_jsonb(p_min_level)),
      ('max_level', to_jsonb(old.max_level), to_jsonb(p_max_level)), ('reward_exp', to_jsonb(old.reward_exp), to_jsonb(p_reward_exp)),
      ('reward_meso', to_jsonb(old.reward_meso), to_jsonb(p_reward_meso)), ('reward_fame', to_jsonb(old.reward_fame), to_jsonb(p_reward_fame))) v(a,b,c)
  loop
    if before is distinct from after then diff:=diff||jsonb_build_object(k,jsonb_build_object('before',before,'after',after)); end if;
  end loop;
  if diff<>'{}' then
    update public.catalog_quests set name=btrim(p_name), min_level=p_min_level, max_level=p_max_level, reward_exp=p_reward_exp,
      reward_meso=p_reward_meso, reward_fame=p_reward_fame, source='operator' where id=p_id;
    insert into public.catalog_changes(entity_type,entity_id,entity_name,operation,changes,release_label)
    values('quest',p_id,btrim(p_name),'UPDATE',diff,'운영자 퀘스트 수정') returning id into change_no;
    insert into catalog_import_private.change_backups(change_id,table_name,old_row,new_row)
    values(change_no,'catalog_quests',to_jsonb(old),(select to_jsonb(q) from public.catalog_quests q where id=p_id));
    update public.catalog_revision set revision=revision+1, updated_at=now() where singleton;
  end if;
  return public.catalog_quest_detail(p_id, null);
end $$;

revoke all on function public.catalog_search_quests(text,text,integer,integer), public.catalog_quest_detail(uuid,integer) from public;
grant execute on function public.catalog_search_quests(text,text,integer,integer), public.catalog_quest_detail(uuid,integer) to anon, authenticated;
revoke all on function public.catalog_quest_edit_save(uuid,text,text,integer,integer,bigint,bigint,integer), public.catalog_quests_touch() from public, anon;
grant execute on function public.catalog_quest_edit_save(uuid,text,text,integer,integer,bigint,bigint,integer) to authenticated;

insert into catalog_import_private.completed_migrations(name) values('077_catalog_quests') on conflict do nothing;
commit;
