-- 080: 관리자 퀘스트 수정에 시작·완료 NPC와 맵·지역을 더한다(2026-11-24 사용자 요청: 수집 자료의 NPC가 메이플랜드와 다른 퀘스트를 고치기).
-- 077 의 catalog_quest_edit_save(이름·레벨·보상 수치)에 칸을 늘린 같은 이름 함수(인자 13개)를 만든다. 예전 8개 인자 함수는 그대로 둔다.
-- NPC 는 {id: 게임 NPC 번호, n: 이름, v: 그림 버전} 모양. 저장하면 source='operator' 라 수집 자료를 다시 등록해도 고친 칸이 남는다.
-- 077 이후 실행. 다시 실행해도 안전.
begin;

do $$ begin
  if not exists(select 1 from catalog_import_private.completed_migrations where name='077_catalog_quests') then
    raise exception 'sql/077 을 먼저 실행해 주세요';
  end if;
end $$;

-- NPC 한 칸 검사·정리: 비었으면 null, 번호 1~1,000,000,000 정수, 이름 1~100자(없으면 null), 그림 버전은 맞는 모양만 남김
create or replace function catalog_import_private.quest_npc(p_value jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare nid text; nm text; ver text;
begin
  if p_value is null or p_value='null'::jsonb then return null; end if;
  if jsonb_typeof(p_value)<>'object' then raise exception 'NPC 정보 모양이 잘못되었습니다'; end if;
  nid:=p_value->>'id';
  if nid is null or jsonb_typeof(p_value->'id') not in ('number','string') or nid !~ '^[1-9][0-9]{0,9}$' or nid::bigint>1000000000 then
    raise exception 'NPC 번호는 1 이상 정수로 적어 주세요';
  end if;
  nm:=nullif(btrim(coalesce(p_value->>'n','')),'');
  if length(nm)>100 then raise exception 'NPC 이름은 100자까지 적을 수 있습니다'; end if;
  ver:=p_value->>'v';
  if ver is not null and ver !~ '^[a-z]{3}/[0-9]{1,4}$' then ver:=null; end if;
  return jsonb_strip_nulls(jsonb_build_object('id',nid::bigint,'n',nm,'v',ver));
end $$;

create or replace function public.catalog_quest_edit_save(p_id uuid, p_version text, p_name text, p_min_level integer, p_max_level integer,
  p_reward_exp bigint, p_reward_meso bigint, p_reward_fame integer,
  p_start_npc jsonb, p_end_npc jsonb, p_start_map integer, p_end_map integer, p_region text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.catalog_quests; diff jsonb:='{}'; change_no bigint; k text; before jsonb; after jsonb;
  s_npc jsonb; e_npc jsonb; reg text;
begin
  if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
  if p_name is null or btrim(p_name)='' or length(btrim(p_name))>200 then raise exception '퀘스트 이름은 1~200자로 입력해 주세요'; end if;
  if (p_min_level is not null and p_min_level not between 1 and 300) or (p_max_level is not null and p_max_level not between 1 and 300) then raise exception '레벨은 1~300 사이로 입력해 주세요'; end if;
  if p_min_level is not null and p_max_level is not null and p_min_level>p_max_level then raise exception '최소 레벨이 최대 레벨보다 큽니다'; end if;
  if (p_reward_exp is not null and p_reward_exp not between 0 and 100000000000) or (p_reward_meso is not null and abs(p_reward_meso)>100000000000)
     or (p_reward_fame is not null and abs(p_reward_fame)>10000) then raise exception '보상 값이 범위를 벗어났습니다'; end if;
  if (p_start_map is not null and p_start_map<1) or (p_end_map is not null and p_end_map<1) then raise exception '맵 번호는 1 이상 정수로 적어 주세요'; end if;
  reg:=nullif(btrim(coalesce(p_region,'')),'');
  if length(reg)>100 then raise exception '지역 이름은 100자까지 적을 수 있습니다'; end if;
  s_npc:=catalog_import_private.quest_npc(p_start_npc);
  e_npc:=catalog_import_private.quest_npc(p_end_npc);
  select * into old from public.catalog_quests where id=p_id for update;
  if not found then raise exception '퀘스트를 찾을 수 없습니다'; end if;
  if p_version is null or md5(extract(epoch from old.updated_at)::text)<>p_version then raise exception '다른 화면에서 수정되었습니다. 다시 불러온 뒤 저장해 주세요' using errcode='40001'; end if;
  -- 이름·번호가 그대로인 NPC 는 예전 그림 버전을 유지한다(화면은 버전을 보내지 않음)
  if s_npc is not null and old.start_npc is not null and s_npc->'id'=old.start_npc->'id' and old.start_npc ? 'v' and not s_npc ? 'v' then s_npc:=s_npc||jsonb_build_object('v',old.start_npc->'v'); end if;
  if e_npc is not null and old.end_npc is not null and e_npc->'id'=old.end_npc->'id' and old.end_npc ? 'v' and not e_npc ? 'v' then e_npc:=e_npc||jsonb_build_object('v',old.end_npc->'v'); end if;
  for k, before, after in select * from (values
      ('name', to_jsonb(old.name), to_jsonb(btrim(p_name))), ('min_level', to_jsonb(old.min_level), to_jsonb(p_min_level)),
      ('max_level', to_jsonb(old.max_level), to_jsonb(p_max_level)), ('reward_exp', to_jsonb(old.reward_exp), to_jsonb(p_reward_exp)),
      ('reward_meso', to_jsonb(old.reward_meso), to_jsonb(p_reward_meso)), ('reward_fame', to_jsonb(old.reward_fame), to_jsonb(p_reward_fame)),
      ('start_npc', old.start_npc, s_npc), ('end_npc', old.end_npc, e_npc),
      ('start_map', to_jsonb(old.start_map), to_jsonb(p_start_map)), ('end_map', to_jsonb(old.end_map), to_jsonb(p_end_map)),
      ('region', to_jsonb(old.region), to_jsonb(reg))) v(a,b,c)
  loop
    if before is distinct from after then diff:=diff||jsonb_build_object(k,jsonb_build_object('before',before,'after',after)); end if;
  end loop;
  if diff<>'{}' then
    update public.catalog_quests set name=btrim(p_name), min_level=p_min_level, max_level=p_max_level, reward_exp=p_reward_exp,
      reward_meso=p_reward_meso, reward_fame=p_reward_fame, start_npc=s_npc, end_npc=e_npc, start_map=p_start_map, end_map=p_end_map,
      region=reg, source='operator' where id=p_id;
    insert into public.catalog_changes(entity_type,entity_id,entity_name,operation,changes,release_label)
    values('quest',p_id,btrim(p_name),'UPDATE',diff,'운영자 퀘스트 수정') returning id into change_no;
    insert into catalog_import_private.change_backups(change_id,table_name,old_row,new_row)
    values(change_no,'catalog_quests',to_jsonb(old),(select to_jsonb(q) from public.catalog_quests q where id=p_id));
    update public.catalog_revision set revision=revision+1, updated_at=now() where singleton;
  end if;
  return public.catalog_quest_detail(p_id, null);
end $$;

revoke all on function catalog_import_private.quest_npc(jsonb) from public, anon, authenticated;
revoke all on function public.catalog_quest_edit_save(uuid,text,text,integer,integer,bigint,bigint,integer,jsonb,jsonb,integer,integer,text) from public, anon;
grant execute on function public.catalog_quest_edit_save(uuid,text,text,integer,integer,bigint,bigint,integer,jsonb,jsonb,integer,integer,text) to authenticated;

insert into catalog_import_private.completed_migrations(name) values('080_catalog_quest_npc_edit') on conflict do nothing;
commit;
