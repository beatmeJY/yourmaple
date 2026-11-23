-- 아이템 설명 정리(2026-11-23 사용자 요청).
-- - 설명에 남은 게임 글자색 기호 #c…# 를 지운다(설명 427개·착용 조건 칸 174개).
-- - 주문서의 "#c성공률 10%STR +3공격력 +5#" 같은 덩어리는 설명이 아니라 효과다. 능력치는 장비처럼 기본 옵션(catalog_item_stats)으로,
--   성공률·파괴 확률·조건·업그레이드 회복 같은 글은 효과(effect_description)로 옮긴다. 옵션 칸이 없는 능력치(손재주)는 효과 글로 둔다.
-- - 빠진 줄바꿈을 넣는다: "다." 바로 뒤에 글자가 붙은 곳, "직업 : "·"조건 : " 앞, 문장 끝 뒤에서 시작하는 강조 글.
-- - 규칙은 js/item-text.js 와 같다(검사 tools/item-text-db.check.mjs 가 같은 예시로 두 쪽 결과를 비교한다).
-- - 수집 자료를 다시 등록해도 같은 정리를 거치도록 정규화 트리거(catalog_item_columns)에 넣는다. 원문(source_data)은 그대로 둔다.
-- - 착용 조건 칸에 설명이 잘못 들어간 174개를 설명으로 옮기는 일은 보류(사용자 결정). 여기서는 기호만 지운다.
-- - 바뀌기 전 값은 catalog_import_private.scrub_073_rows 에 비공개로 보관하고, 바뀐 아이템마다 변경 이력이 남는다.
-- 072 이후 운영자가 SQL Editor 또는 DBeaver에서 전체 실행합니다. 같은 파일을 다시 실행해도 안전합니다.
begin;
select pg_advisory_xact_lock(20261028,43);

create or replace function public.catalog_item_text(raw text) returns jsonb
language plpgsql immutable set search_path='' as $$
declare
  token constant text:='(STR|DEX|INT|LUK|공격력|마법방어력|마력|방어력|최대 HP|최대 MP|명중치|회피치|이동속도|점프력|손재주) ([+-][0-9]+)';
  keys constant jsonb:='{"STR":"str","DEX":"dex","INT":"int","LUK":"luk","공격력":"attack","마력":"magic_attack","방어력":"defense","마법방어력":"magic_defense","최대 HP":"hp","최대 MP":"mp","명중치":"accuracy","회피치":"avoidability","이동속도":"speed","점프력":"jump"}';
  s text:=coalesce(raw,''); out_text text:=''; body text; rest text; words text; k text;
  pos integer; m text[]; effects text[]:='{}'; opts jsonb:='{}';
begin
  loop
    pos:=strpos(s,'#c'); exit when pos=0;
    out_text:=out_text||substr(s,1,pos-1); s:=substr(s,pos+2);
    pos:=strpos(s,'#');
    if pos=0 then body:=s; s:=''; else body:=substr(s,1,pos-1); s:=substr(s,pos+1); end if;
    if body ~ '^(조건 : 잔여 업그레이드 가능 횟수 [0-9]+회 이상)?성공률 [0-9]+%' then
      -- 주문서 효과 덩어리: 조건 → 성공률 → 파괴 확률 → 능력치·글 순서로 읽는다.
      rest:=body;
      m:=regexp_match(rest,'^(조건 : (잔여 업그레이드 가능 횟수 [0-9]+회 이상))');
      if m is not null then effects:=effects||('조건 : '||m[2]); rest:=substr(rest,length(m[1])+1); end if;
      m:=regexp_match(rest,'^(성공률 ([0-9]+)%)');
      if m is not null then effects:=effects||('성공률 '||m[2]||'%'); rest:=substr(rest,length(m[1])+1); end if;
      m:=regexp_match(rest,'^(실패시 ([0-9]+)% 확률로 파괴)');
      if m is not null then effects:=effects||('실패 시 '||m[2]||'% 확률로 파괴'); rest:=substr(rest,length(m[1])+1); end if;
      while rest<>'' loop
        m:=regexp_match(rest,'^('||token||')');
        if m is not null then
          rest:=substr(rest,length(m[1])+1);
          k:=keys->>m[2];
          if k is not null and not opts ? k then opts:=opts||jsonb_build_object(k,m[3]::integer);
          else effects:=effects||(m[2]||' '||m[3]); end if;
          continue;
        end if;
        pos:=regexp_instr(rest,token);
        words:=btrim(case when pos>1 then substr(rest,1,pos-1) else rest end,E' \t\n\r');
        if words<>'' then effects:=effects||words; end if;
        rest:=case when pos>1 then substr(rest,pos) else '' end;
      end loop;
      continue;
    end if;
    -- 강조 글: 문장 끝 뒤에서 시작하면 새 줄로.
    if out_text ~ '[.!?][ \t]*$' then out_text:=rtrim(out_text,E' \t')||chr(10); end if;
    out_text:=out_text||body;
  end loop;
  return jsonb_build_object('description',public.catalog_item_tidy(out_text||s),'effects',to_jsonb(effects),'options',opts);
end $$;

create or replace function public.catalog_item_tidy(raw text) returns text
language sql immutable set search_path='' as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(raw,''),
    '([^[:space:]])(직업|조건) : ','\1'||chr(10)||'\2 : ','g'),
    '다\.([가-힣A-Za-z])','다.'||chr(10)||'\1','g'),
    '[ \t]*\n[ \t]*',chr(10),'g'),
    '\n{3,}',chr(10)||chr(10),'g'),E' \t\n\r')
$$;

-- 착용 조건 칸처럼 덩어리를 나누지 않는 곳은 기호만 지운다(#c 가 있는 글만).
create or replace function public.catalog_item_strip_marks(raw text) returns text
language sql immutable set search_path='' as $$
  select case when raw like '%#c%' then replace(replace(raw,'#c',''),'#','') else raw end
$$;

revoke all on function public.catalog_item_text(text),public.catalog_item_tidy(text),public.catalog_item_strip_marks(text) from public,anon,authenticated;
grant execute on function public.catalog_item_text(text),public.catalog_item_tidy(text),public.catalog_item_strip_marks(text) to service_role;

-- 062 의 정규화 트리거에 설명 정리만 더한다(나머지는 062 와 같음).
create or replace function public.catalog_item_columns()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v text; n text; e jsonb; t jsonb; f jsonb;
begin
  if new.source is distinct from 'collected' then return new; end if;
  if new.requirements::text like '%#c%' then
    select coalesce(jsonb_object_agg(public.catalog_item_strip_marks(r.key),
      case when jsonb_typeof(r.value)='string' then to_jsonb(public.catalog_item_strip_marks(r.value#>>'{}')) else r.value end),'{}'::jsonb)
    into new.requirements from jsonb_each(new.requirements) r;
  end if;
  new.middle_category:=nullif(new.source_data#>>'{categories,중분류}','');
  new.subcategory:=nullif(new.source_data#>>'{categories,소분류}','');
  new.required_level:=(new.requirements->>'level')::integer;
  new.gender_restriction:=nullif(new.requirements->>'GENDER','');
  new.attack_speed:=null; new.attack_speed_label:=null; new.shop_sell_price:=null;
  -- 원래 페이지의 칸 이름(DSC·EFFECT)은 화면 문구에서 뺍니다(050). 글자색 기호·주문서 효과·줄바꿈은 073.
  t:=public.catalog_item_text(regexp_replace(new.source_data->>'description_text','^DSC[[:space:]]+',''));
  f:=public.catalog_item_text(regexp_replace(new.source_data->>'effect_text','^EFFECT[[:space:]]+',''));
  new.description:=nullif(t->>'description','');
  new.effect_description:=nullif(array_to_string(
    array_remove(array[nullif(f->>'description','')],null)
    ||array(select jsonb_array_elements_text(f->'effects'))
    ||array(select jsonb_array_elements_text(t->'effects')),chr(10)),'');
  -- 설명에서 꺼낸 능력치는 기본 옵션이 비어 있을 때만 넣는다(운영자가 고친 옵션은 그대로).
  if coalesce(new.base_options,'{}'::jsonb)='{}'::jsonb and ((f->'options')||(t->'options'))<>'{}'::jsonb then
    new.base_options:=(f->'options')||(t->'options');
  end if;
  new.source_collected_at:=(new.source_data->>'collected_at')::timestamptz;
  new.source_html_sha256:=nullif(new.source_data->>'html_sha256','');
  for e in select value from jsonb_array_elements(coalesce(new.source_data->'other_effects','[]'::jsonb)) loop
    v:=e#>>'{}'; n:=btrim(split_part(v,':',1));
    v:=btrim(substr(v,strpos(v,':')+1));
    if n='상점가' then
      if v in ('','메소','???','-') then continue; end if;
      if v !~ '^[0-9,]+[[:space:]]*메소$' then raise exception '상점가 해석 불가: %',v; end if;
      new.shop_sell_price:=regexp_replace(v,'[^0-9]','','g')::bigint;
    elsif n='공격속도' then
      if not catalog_review_private.valid_speed_label(v) or v='' then raise exception '공격속도 해석 불가: %',v; end if;
      new.attack_speed:=case when v ~ '^[0-9]+' then substring(v from '^[0-9]+')::integer else null end;
      new.attack_speed_label:=v;
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.catalog_item_columns() from public,anon,authenticated;
grant execute on function public.catalog_item_columns() to service_role;

-- 바뀌기 전 값(비공개). 다시 실행해도 처음 값을 지킨다.
create table if not exists catalog_import_private.scrub_073_rows(
  row_id uuid primary key, description text, effect_description text, base_options jsonb, requirements jsonb,
  saved_at timestamptz not null default now());
revoke all on catalog_import_private.scrub_073_rows from public,anon,authenticated;

-- 정리할 아이템 판정. SQL Editor 에서 임시 표가 사라지는 일이 있어(2026-11-23 실행 오류 42P01) 임시 표 대신 함수로 두 번 고른다.
create or replace function catalog_import_private.needs_073(src text,data jsonb,req jsonb) returns boolean
language sql immutable set search_path='' as $$
  select src='collected' and (
    coalesce(data->>'description_text','')||' '||coalesce(data->>'effect_text','') ~ '#c|다\.[가-힣A-Za-z]|[^[:space:]](직업|조건) : '
    or coalesce(req::text,'') like '%#c%')
$$;
revoke all on function catalog_import_private.needs_073(text,jsonb,jsonb) from public,anon,authenticated;

insert into catalog_import_private.scrub_073_rows(row_id,description,effect_description,base_options,requirements)
select i.id,i.description,i.effect_description,i.base_options,i.requirements from public.catalog_items i
where catalog_import_private.needs_073(i.source,i.source_data,i.requirements)
on conflict(row_id) do nothing;

select set_config('yourmaple.release_label','설명 정리·주문서 효과 분리',true);
update public.catalog_items i set source_data=i.source_data
where catalog_import_private.needs_073(i.source,i.source_data,i.requirements);
commit;
