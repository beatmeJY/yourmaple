-- 몬스터 드랍 테이블 수정(2026-11-16 사용자 요청, 도감 관리자 전용).
-- 관리자는 몬스터 상세의 "드랍 수정" 창에서 드랍 아이템·확률을 고치고, 빼고, 새로 넣는다. 저장하면 공개 도감에 바로 반영된다.
-- - 저장은 "드랍 목록 전체"를 한 번에 받는다(창에서 본 그대로). 다른 화면에서 먼저 고쳤으면 버전이 달라 저장을 막는다.
-- - 새로 넣은 드랍은 source='operator' 로 남겨, 수집 자료를 다시 등록해도(같은 외부 ID 의 collected 드랍만 지우고 다시 넣음) 지워지지 않는다.
--   수집 드랍(collected)을 고친 값은 069 의 몬스터 수정과 같이, 다시 수집해 등록하면 원문 값으로 돌아간다.
-- - 바뀐 줄마다 변경 이력(catalog_changes, 관리자만 읽음)이 남고 도감 버전이 오른다(record_catalog_change 트리거).
-- 071 이후 운영자가 SQL Editor 또는 DBeaver에서 전체 실행합니다. 같은 파일을 다시 실행해도 안전합니다.
begin;
select pg_advisory_xact_lock(20261028,43);

-- 수정창이 불러오는 드랍 목록과 버전(드랍 행 전체의 해시). 지운 몬스터는 고치지 않는다.
create or replace function public.catalog_monster_drops_edit_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m public.catalog_monsters;
begin
 if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
 select * into m from public.catalog_monsters where id=p_id;
 if not found or m.deleted_at is not null then raise exception '몬스터를 찾을 수 없습니다'; end if;
 return jsonb_build_object(
  'version',(select md5(coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]'::jsonb)::text) from public.catalog_monster_drops d where d.monster_id=p_id),
  'drops',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'item_id',d.item_id,'rate_percent',d.rate_percent,'source',d.source,
     'item',jsonb_build_object('id',i.id,'name',i.name,'image_url',i.image_url,'source_id',i.source_id))
    order by d.rate_percent desc nulls last,d.source_entry,d.id)
   from public.catalog_monster_drops d join public.catalog_items i on i.id=d.item_id where d.monster_id=p_id),'[]'::jsonb));
end $$;

-- 저장: p_drops = [{id: 기존 드랍 id 또는 null(새 드랍), item_id, rate_percent: 0~100 숫자 또는 null(확률 미상)}].
-- 목록에 없는 기존 드랍은 지운다. 같은 아이템을 여러 줄 두는 것은 허용한다(수집 자료에도 있는 형태).
create or replace function public.catalog_monster_drops_save(p_id uuid,p_version text,p_drops jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.catalog_monsters; e jsonb; did uuid; iid uuid; rate numeric; cur public.catalog_monster_drops;
 kept uuid[]:=array[]::uuid[]; next_entry integer; label text;
begin
 if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
 if coalesce(jsonb_typeof(p_drops),'')<>'array' then raise exception '드랍 목록 형식이 아닙니다'; end if;
 if jsonb_array_length(p_drops)>500 then raise exception '드랍은 500개까지 둘 수 있습니다'; end if;
 select * into m from public.catalog_monsters where id=p_id for update;
 if not found or m.deleted_at is not null then raise exception '몬스터를 찾을 수 없습니다'; end if;
 perform 1 from public.catalog_monster_drops where monster_id=p_id for update;
 if p_version is null or p_version<>(select md5(coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]'::jsonb)::text) from public.catalog_monster_drops d where d.monster_id=p_id)
  then raise exception '다른 화면에서 드랍이 바뀌었습니다. 다시 불러온 뒤 저장해 주세요' using errcode='40001'; end if;

 -- 먼저 모두 검사한다(하나라도 틀리면 아무것도 바꾸지 않는다).
 for e in select value from jsonb_array_elements(p_drops) loop
  if jsonb_typeof(e)<>'object' or coalesce(jsonb_typeof(e->'item_id'),'')<>'string' then raise exception '드랍할 아이템을 골라 주세요'; end if;
  begin iid:=(e->>'item_id')::uuid; exception when others then raise exception '아이템 값을 확인해 주세요'; end;
  if not exists(select 1 from public.catalog_items where id=iid) then raise exception '도감에 없는 아이템입니다'; end if;
  if jsonb_typeof(e->'rate_percent') not in ('null','number') then raise exception '드랍 확률은 숫자여야 합니다'; end if;
  rate:=(e->>'rate_percent')::numeric;
  if rate is not null and (rate<0 or rate>100) then raise exception '드랍 확률은 0~100%% 사이로 입력해 주세요'; end if;
  if jsonb_typeof(e->'id') not in ('null','string') then raise exception '드랍 값을 확인해 주세요'; end if;
  if jsonb_typeof(e->'id')='string' then
   begin did:=(e->>'id')::uuid; exception when others then raise exception '드랍 값을 확인해 주세요'; end;
   if not exists(select 1 from public.catalog_monster_drops where id=did and monster_id=p_id) then raise exception '이 몬스터의 드랍이 아닙니다'; end if;
   if did=any(kept) then raise exception '같은 드랍이 두 번 들어 있습니다'; end if;
   kept:=kept||did;
  end if;
 end loop;

 perform set_config('yourmaple.release_label','운영자 드랍 수정',true);
 -- 목록에서 뺀 드랍은 지운다.
 delete from public.catalog_monster_drops where monster_id=p_id and not (id=any(kept));
 -- 운영자 드랍의 순번은 이 몬스터 안에서만 이어 붙인다(외부 ID 대신 몬스터 id 로 묶어 다른 몬스터와 겹치지 않게).
 select coalesce(max(source_entry),-1)+1 into next_entry from public.catalog_monster_drops where source='operator' and monster_source_id=p_id::text;
 for e in select value from jsonb_array_elements(p_drops) loop
  iid:=(e->>'item_id')::uuid; rate:=(e->>'rate_percent')::numeric;
  label:=case when rate is null then '확률 미상' when rate::text like '%.%' then rtrim(rtrim(rate::text,'0'),'.')||'%' else rate::text||'%' end;
  if jsonb_typeof(e->'id')='string' then
   select * into cur from public.catalog_monster_drops where id=(e->>'id')::uuid;
   -- 값이 같으면 고치지 않아 이력도 남지 않는다.
   if cur.item_id is distinct from iid or cur.rate_percent is distinct from rate then
    update public.catalog_monster_drops set item_id=iid,rate_percent=rate,rate_text=label where id=cur.id;
   end if;
  else
   insert into public.catalog_monster_drops(monster_id,item_id,source,monster_source_id,source_entry,rate_percent,rate_text)
   values(p_id,iid,'operator',p_id::text,next_entry,rate,label);
   next_entry:=next_entry+1;
  end if;
 end loop;
 return public.catalog_monster_drops_edit_detail(p_id);
end $$;

revoke all on function public.catalog_monster_drops_edit_detail(uuid),public.catalog_monster_drops_save(uuid,text,jsonb) from public,anon;
grant execute on function public.catalog_monster_drops_edit_detail(uuid),public.catalog_monster_drops_save(uuid,text,jsonb) to authenticated;
commit;
