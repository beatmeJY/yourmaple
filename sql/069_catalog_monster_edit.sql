-- 몬스터 도감 수정·변경 이력 관리자 전용(2026-11-16 사용자 요청).
-- 1) 도감 관리자(검토 운영자, can_review_catalog)는 몬스터 상세에서 이름·수치·속성을 고쳐 공개 도감에 바로 반영한다.
-- 2) 변경 이력(catalog_changes)은 아이템·몬스터 모두 관리자만 읽는다(063은 아이템만 막았음).
-- 057·063 이후 운영자가 SQL Editor 또는 DBeaver에서 전체 실행합니다. 같은 파일을 다시 실행해도 안전합니다.
-- 주의: sql/047·063 을 다시 실행하면 이력 읽기 정책이 예전으로 돌아오므로 이 파일도 다시 실행합니다.
begin;
select pg_advisory_xact_lock(20261028,43);

-- 이력 읽기: 관리자만. 일반 사용자·비로그인은 0행.
alter table public.catalog_changes enable row level security;
drop policy if exists catalog_read on public.catalog_changes;
drop policy if exists catalog_changes_read on public.catalog_changes;
create policy catalog_changes_read on public.catalog_changes for select to anon,authenticated
 using ((select public.can_review_catalog()));

-- 관리자가 고친 전투 수치는 source_data.manual_edit 에 함께 남겨,
-- 정규화 트리거가 다시 돌아도(sql/052 재실행 등) 원문 해석값이 덮어쓰지 않게 한다.
-- 같은 외부 ID를 다시 수집해 등록하면 source_data 전체가 새 원문으로 바뀌므로 수정값도 원문으로 돌아간다.
create or replace function public.catalog_monster_columns()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v text; m jsonb; k text;
begin
 if new.source is not distinct from 'collected' then
  v:=new.source_data->>'stats_text';
  -- MP는 이미 해석된 숫자를 우선 사용해 50K 같은 축약 표기를 잘못 읽지 않습니다.
  new.mp:=case when jsonb_typeof(new.source_data->'mp')='number' then (new.source_data->>'mp')::numeric else catalog_import_private.monster_stat(v,'MP') end;
  new.physical_attack:=catalog_import_private.monster_stat(v,'물리 데미지');
  new.magic_attack:=catalog_import_private.monster_stat(v,'마법 데미지');
  new.physical_defense:=catalog_import_private.monster_stat(v,'물리 방어력');
  new.magic_defense:=catalog_import_private.monster_stat(v,'마법 방어력');
  new.movement_speed:=catalog_import_private.monster_stat(v,'속도');
  new.knockback_damage:=catalog_import_private.monster_stat(v,'넉백 가능 데미지');
  new.meso_value:=catalog_import_private.monster_stat(v,'메소');
  new.required_accuracy:=coalesce(catalog_import_private.monster_stat(v,'필요 명중'),new.required_accuracy);
  new.accuracy_reference_level:=(regexp_match(v,'([0-9]+)레벨[[:space:]]*에서의 필요 명중'))[1]::integer;
 end if;
 m:=new.source_data->'manual_edit';
 if jsonb_typeof(m)='object' then
  foreach k in array array['mp','required_accuracy','accuracy_reference_level','physical_attack','magic_attack','physical_defense','magic_defense','movement_speed','knockback_damage','meso_value'] loop
   if m ? k then
    case k
     when 'mp' then new.mp:=(m->>k)::numeric;
     when 'required_accuracy' then new.required_accuracy:=(m->>k)::numeric;
     when 'accuracy_reference_level' then new.accuracy_reference_level:=(m->>k)::integer;
     when 'physical_attack' then new.physical_attack:=(m->>k)::numeric;
     when 'magic_attack' then new.magic_attack:=(m->>k)::numeric;
     when 'physical_defense' then new.physical_defense:=(m->>k)::numeric;
     when 'magic_defense' then new.magic_defense:=(m->>k)::numeric;
     when 'movement_speed' then new.movement_speed:=(m->>k)::numeric;
     when 'knockback_damage' then new.knockback_damage:=(m->>k)::numeric;
     when 'meso_value' then new.meso_value:=(m->>k)::numeric;
    end case;
   end if;
  end loop;
 end if;
 return new;
end $$;
revoke all on function public.catalog_monster_columns() from public,anon,authenticated;
grant execute on function public.catalog_monster_columns() to service_role;

create or replace function public.catalog_monster_edit_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m public.catalog_monsters;
begin
 if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
 select * into m from public.catalog_monsters where id=p_id;
 if not found then raise exception '몬스터를 찾을 수 없습니다'; end if;
 return jsonb_build_object('version',md5(to_jsonb(m)::text),'draft',jsonb_build_object(
  'name',m.name,'level',m.level,'hp',m.hp,'exp',m.exp,'mp',m.mp,
  'required_accuracy',m.required_accuracy,'accuracy_reference_level',m.accuracy_reference_level,'accuracy_per_level',m.accuracy_per_level,
  'physical_attack',m.physical_attack,'magic_attack',m.magic_attack,'physical_defense',m.physical_defense,'magic_defense',m.magic_defense,
  'movement_speed',m.movement_speed,'knockback_damage',m.knockback_damage,'meso_value',m.meso_value,
  'weak_elements',to_jsonb(coalesce(string_to_array(m.weak_elements,', '),array[]::text[])),
  'resist_elements',to_jsonb(coalesce(string_to_array(m.resist_elements,', '),array[]::text[]))));
end $$;

create or replace function public.catalog_monster_edit_save(p_id uuid,p_version text,p_draft jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.catalog_monsters; k text; kind text; n numeric; weak text; resist text; manual jsonb;
 allowed constant text[]:=array['불','냉기','전기','독','성'];
 combat constant text[]:=array['mp','required_accuracy','accuracy_reference_level','physical_attack','magic_attack','physical_defense','magic_defense','movement_speed','knockback_damage','meso_value'];
begin
 if not public.can_review_catalog() then raise exception '검토 권한이 없습니다' using errcode='42501'; end if;
 if coalesce(jsonb_typeof(p_draft),'')<>'object' or coalesce(jsonb_typeof(p_draft->'name'),'')<>'string'
  or btrim(p_draft->>'name')='' or length(p_draft->>'name')>200 then raise exception '몬스터 이름은 1~200자로 입력해 주세요'; end if;
 -- 숫자 칸: 빈칸(null)은 미제공, 0은 실제 값. 화면(js/monster-edit.js)과 같은 규칙.
 foreach k in array array['level','hp','exp','accuracy_reference_level','mp','required_accuracy','accuracy_per_level','physical_attack','magic_attack','physical_defense','magic_defense','knockback_damage','meso_value','movement_speed'] loop
  if not p_draft ? k then raise exception '% 값이 없습니다',k; end if;
  continue when jsonb_typeof(p_draft->k)='null';
  if jsonb_typeof(p_draft->k)<>'number' then raise exception '% 값은 숫자여야 합니다',k; end if;
  n:=(p_draft->>k)::numeric;
  kind:=case when k in ('level','accuracy_reference_level') then 'pos' when k in ('hp','exp') then 'int' when k='movement_speed' then 'signed' else 'num' end;
  if abs(n)>1e15 or (kind<>'signed' and n<0) or (kind in ('pos','int') and n<>trunc(n))
   or (kind='pos' and (n<1 or n>2147483647)) then raise exception '% 값 범위를 확인해 주세요',k; end if;
 end loop;
 foreach k in array array['weak_elements','resist_elements'] loop
  if coalesce(jsonb_typeof(p_draft->k),'')<>'array' or exists(select 1 from jsonb_array_elements(p_draft->k) e where jsonb_typeof(e)<>'string' or not (e#>>'{}' = any(allowed)))
   then raise exception '속성 값을 확인해 주세요'; end if;
 end loop;
 -- 속성은 정해진 순서로 ", " 로 잇는다(038 의 검사 규칙).
 select nullif(string_agg(a,', ' order by array_position(allowed,a)),'') into weak from (select distinct e#>>'{}' a from jsonb_array_elements(p_draft->'weak_elements') e) x;
 select nullif(string_agg(a,', ' order by array_position(allowed,a)),'') into resist from (select distinct e#>>'{}' a from jsonb_array_elements(p_draft->'resist_elements') e) x;
 if string_to_array(weak,', ') && string_to_array(resist,', ') then raise exception '한 속성을 약점과 반감에 함께 둘 수 없습니다'; end if;

 select * into old from public.catalog_monsters where id=p_id for update;
 if not found then raise exception '몬스터를 찾을 수 없습니다'; end if;
 if p_version is null or md5(to_jsonb(old)::text)<>p_version then raise exception '다른 화면에서 수정되었습니다. 다시 불러온 뒤 저장해 주세요' using errcode='40001'; end if;

 select coalesce(jsonb_object_agg(c,p_draft->c),'{}'::jsonb) into manual from unnest(combat) c;
 perform set_config('yourmaple.release_label','운영자 상세 수정',true);
 -- 값이 같으면 update 해도 이력 트리거가 차이가 없어 기록하지 않는다.
 update public.catalog_monsters set
  name=btrim(p_draft->>'name'),level=(p_draft->>'level')::integer,hp=(p_draft->>'hp')::bigint,exp=(p_draft->>'exp')::bigint,
  accuracy_per_level=(p_draft->>'accuracy_per_level')::numeric,weak_elements=weak,resist_elements=resist,
  source_data=source_data||jsonb_build_object('manual_edit',manual)
 where id=p_id;
 return public.catalog_monster_detail(p_id);
end $$;
revoke all on function public.catalog_monster_edit_detail(uuid),public.catalog_monster_edit_save(uuid,text,jsonb) from public,anon;
grant execute on function public.catalog_monster_edit_detail(uuid),public.catalog_monster_edit_save(uuid,text,jsonb) to authenticated;
commit;
