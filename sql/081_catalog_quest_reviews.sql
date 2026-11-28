-- 081: 퀘스트 검토함(관리자 전용, 2026-11-24 사용자 요청 "문제들을 내가 확인하고 반영할 수 있는 것").
-- 두 가지를 관리자가 하나씩 보고 반영하거나 건너뛴다.
--   exp     : 경험치·메소가 게임 원본(v83)과 다른 퀘스트. 지금 값 / 원본 값 / 직접 적은 값 중 하나로 반영
--   missing : 수집 자료에 없는 원본 퀘스트(예: 사쿠라의 물개인형). 한국어 이름을 적어 퀘스트로 추가하거나 "메이플랜드에 없음"
-- 검토 항목(data)은 비공개 도구가 만든 등록 SQL(data/local/quest-collect/quest-reviews.sql)이 넣는다. 반영·건너뜀한 항목은 다시 등록해도 그대로.
-- 반영하면 그 퀘스트는 source='operator' 라 수집 자료를 다시 등록해도 고친 칸이 남는다.
-- 080 이후 실행. 다시 실행해도 안전.
begin;

do $$ begin
  if not exists(select 1 from catalog_import_private.completed_migrations where name='080_catalog_quest_npc_edit') then
    raise exception 'sql/080 을 먼저 실행해 주세요';
  end if;
end $$;

create table if not exists public.catalog_quest_reviews (
  id uuid primary key default gen_random_uuid(),
  source_id integer not null,
  kind text not null,
  data jsonb not null default '{}',
  status text not null default 'open',
  decided jsonb,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, kind)
);
alter table public.catalog_quest_reviews drop constraint if exists catalog_quest_reviews_values_check;
alter table public.catalog_quest_reviews add constraint catalog_quest_reviews_values_check check (
  source_id > 0 and kind in ('exp','missing') and status in ('open','applied','skipped') and jsonb_typeof(data) = 'object'
  and (decided is null or jsonb_typeof(decided) = 'object'));
-- 관리자 함수로만 읽고 쓴다(직접 읽기·쓰기 정책 없음)
alter table public.catalog_quest_reviews enable row level security;
revoke all on public.catalog_quest_reviews from public, anon, authenticated;

-- 목록: 종류별. 지금 퀘스트 값(경험치·메소·버전)을 함께 준다. 레벨 낮은 순.
create or replace function public.catalog_quest_review_list(p_kind text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
  if p_kind is null or p_kind not in ('exp','missing') then raise exception '검토 종류가 잘못되었습니다'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'source_id',r.source_id,'kind',r.kind,'data',r.data,'status',r.status,
      'decided',r.decided,'decided_at',r.decided_at,
      'quest',case when q.id is null then null else jsonb_build_object('id',q.id,'name',q.name,'reward_exp',q.reward_exp,'reward_meso',q.reward_meso,
        'min_level',q.min_level,'region',q.region,'start_npc',q.start_npc,'source',q.source,'deleted',q.deleted_at is not null,
        'version',md5(extract(epoch from q.updated_at)::text)) end)
    order by coalesce(q.min_level, case when (r.data->>'min_level') ~ '^[0-9]{1,3}$' then (r.data->>'min_level')::int end, 999), r.source_id)
    from public.catalog_quest_reviews r left join public.catalog_quests q on q.source_id=r.source_id
    where r.kind=p_kind), '[]'::jsonb);
end $$;

-- 결정: p_status 'applied'(반영) / 'skipped'(건너뜀·메이플랜드에 없음) / 'open'(되돌리기, 반영한 것은 되돌릴 수 없음).
-- exp 반영: p_exp·p_meso 로 퀘스트 보상을 바꾼다(p_version 은 목록에서 받은 퀘스트 버전).
-- missing 반영: p_name(한국어 이름)과 p_exp·p_meso 로 퀘스트를 새로 넣는다. 나머지 칸은 검토 항목(data.quest)의 원본 값.
create or replace function public.catalog_quest_review_decide(p_review uuid, p_status text, p_name text default null,
  p_exp bigint default null, p_meso bigint default null, p_version text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.catalog_quest_reviews; q public.catalog_quests; diff jsonb:='{}'; change_no bigint; nm text; src jsonb;
  new_id uuid; pre integer[];
begin
  if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
  if p_status is null or p_status not in ('open','applied','skipped') then raise exception '결정이 잘못되었습니다'; end if;
  select * into r from public.catalog_quest_reviews where id=p_review for update;
  if not found then raise exception '검토 항목을 찾을 수 없습니다'; end if;
  if r.status='applied' then raise exception '이미 반영한 항목입니다. 바꾸려면 퀘스트 정보에서 직접 고쳐 주세요'; end if;

  if p_status<>'applied' then
    update public.catalog_quest_reviews set status=p_status, decided=null,
      decided_at=case when p_status='open' then null else now() end, updated_at=now() where id=p_review;
    return jsonb_build_object('id',p_review,'status',p_status);
  end if;

  if (p_exp is not null and p_exp not between 0 and 100000000000) or (p_meso is not null and abs(p_meso)>100000000000) then
    raise exception '보상 값이 범위를 벗어났습니다';
  end if;

  if r.kind='exp' then
    select * into q from public.catalog_quests where source_id=r.source_id for update;
    if not found then raise exception '퀘스트를 찾을 수 없습니다'; end if;
    if p_version is null or md5(extract(epoch from q.updated_at)::text)<>p_version then
      raise exception '다른 화면에서 수정되었습니다. 다시 불러온 뒤 저장해 주세요' using errcode='40001';
    end if;
    if q.reward_exp is distinct from p_exp then diff:=diff||jsonb_build_object('reward_exp',jsonb_build_object('before',q.reward_exp,'after',p_exp)); end if;
    if q.reward_meso is distinct from p_meso then diff:=diff||jsonb_build_object('reward_meso',jsonb_build_object('before',q.reward_meso,'after',p_meso)); end if;
    if diff<>'{}' then
      update public.catalog_quests set reward_exp=p_exp, reward_meso=p_meso, source='operator' where id=q.id;
      insert into public.catalog_changes(entity_type,entity_id,entity_name,operation,changes,release_label)
      values('quest',q.id,q.name,'UPDATE',diff,'운영자 퀘스트 검토 반영') returning id into change_no;
      insert into catalog_import_private.change_backups(change_id,table_name,old_row,new_row)
      values(change_no,'catalog_quests',to_jsonb(q),(select to_jsonb(x) from public.catalog_quests x where id=q.id));
      update public.catalog_revision set revision=revision+1, updated_at=now() where singleton;
    end if;
    new_id:=q.id;
    nm:=q.name;
  else
    nm:=btrim(coalesce(p_name,''));
    if nm='' or length(nm)>200 then raise exception '퀘스트 이름은 1~200자로 입력해 주세요'; end if;
    if exists(select 1 from public.catalog_quests where source_id=r.source_id) then raise exception '이미 등록된 퀘스트 번호입니다'; end if;
    src:=coalesce(r.data->'quest','{}'::jsonb);
    pre:=coalesce(array(select x::integer from jsonb_array_elements_text(coalesce(src->'prerequisites','[]')) x where x ~ '^[1-9][0-9]{0,8}$'),'{}');
    insert into public.catalog_quests(source_id,name,min_level,max_level,jobs,reward_exp,reward_meso,start_npc,end_npc,start_map,end_map,
      region,conditions,reward_method,reward_items,prerequisites,next_quests,source)
    values(r.source_id, nm,
      case when (src->>'min_level') ~ '^[0-9]{1,3}$' then (src->>'min_level')::int end,
      case when (src->>'max_level') ~ '^[0-9]{1,3}$' then (src->>'max_level')::int end,
      coalesce(array(select x::integer from jsonb_array_elements_text(coalesce(src->'jobs','[]')) x where x ~ '^[0-9]{1,4}$'),'{}'),
      p_exp, p_meso,
      catalog_import_private.quest_npc(nullif(src->'start_npc','null'::jsonb)), catalog_import_private.quest_npc(nullif(src->'end_npc','null'::jsonb)),
      case when (src->>'start_map') ~ '^[1-9][0-9]{0,9}$' then (src->>'start_map')::int end,
      case when (src->>'end_map') ~ '^[1-9][0-9]{0,9}$' then (src->>'end_map')::int end,
      nullif(btrim(coalesce(src->>'region','')),''),
      coalesce((select jsonb_agg(catalog_import_private.quest_entry(e,'c')) from jsonb_array_elements(coalesce(src->'conditions','[]')) e),'[]'),
      case when src->>'reward_method' in ('fixed','random','select') then src->>'reward_method' end,
      coalesce((select jsonb_agg(catalog_import_private.quest_entry(e,'r')) from jsonb_array_elements(coalesce(src->'reward_items','[]')) e),'[]'),
      pre, '{}', 'operator')
    returning id into new_id;
    -- 선행 퀘스트의 "다음 퀘스트"에 더한다(수집 자료를 다시 등록하면 다음 칸은 다시 만들어짐)
    update public.catalog_quests set next_quests=(select array_agg(distinct x order by x) from unnest(next_quests||r.source_id) x)
      where source_id=any(pre) and not (r.source_id=any(next_quests));
    insert into public.catalog_changes(entity_type,entity_id,entity_name,operation,changes,release_label)
    values('quest',new_id,nm,'INSERT',jsonb_build_object('name',jsonb_build_object('before',null,'after',nm),
      'reward_exp',jsonb_build_object('before',null,'after',p_exp),'reward_meso',jsonb_build_object('before',null,'after',p_meso)),
      '운영자 퀘스트 추가(원본)') returning id into change_no;
    insert into catalog_import_private.change_backups(change_id,table_name,old_row,new_row)
    values(change_no,'catalog_quests',null,(select to_jsonb(x) from public.catalog_quests x where id=new_id));
    update public.catalog_revision set revision=revision+1, updated_at=now() where singleton;
  end if;

  update public.catalog_quest_reviews set status='applied', updated_at=now(), decided_at=now(),
    decided=jsonb_strip_nulls(jsonb_build_object('name',nm,'exp',p_exp,'meso',p_meso)) where id=p_review;
  return jsonb_build_object('id',p_review,'status','applied','quest_id',new_id,'name',nm);
end $$;

revoke all on function public.catalog_quest_review_list(text), public.catalog_quest_review_decide(uuid,text,text,bigint,bigint,text) from public, anon;
grant execute on function public.catalog_quest_review_list(text), public.catalog_quest_review_decide(uuid,text,text,bigint,bigint,text) to authenticated;

insert into catalog_import_private.completed_migrations(name) values('081_catalog_quest_reviews') on conflict do nothing;
commit;
