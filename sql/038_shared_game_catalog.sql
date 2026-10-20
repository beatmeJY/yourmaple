-- 공용 도감과 개인 거래를 분리합니다. SQL Editor 운영자만 실행합니다.
-- 기존 monsters·trades 행을 삭제하지 않습니다. 충돌한 몬스터는 비공개 검토 표에 남깁니다.
-- 전체 파일을 한 번에 실행하세요. 재실행해도 공용 도감의 수정 내용을 덮어쓰지 않습니다.
begin;

create table if not exists public.catalog_monsters (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> ''),
  level integer check (level is null or level >= 1),
  hp bigint check (hp is null or hp >= 0),
  exp bigint check (exp is null or exp >= 0),
  required_accuracy numeric check (required_accuracy is null or required_accuracy >= 0),
  accuracy_per_level numeric check (accuracy_per_level is null or accuracy_per_level >= 0),
  hp_per_exp numeric generated always as (case when exp > 0 then round(hp::numeric / exp, 4) end) stored,
  drop_items text, weak_elements text, resist_elements text,
  image_url text check (image_url is null or image_url ~ '^https://'),
  source text, source_id text, source_url text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint catalog_monsters_weak_check check (weak_elements is null or weak_elements ~ '^(불|냉기|전기|독|성)(, (불|냉기|전기|독|성))*$'),
  constraint catalog_monsters_resist_check check (resist_elements is null or resist_elements ~ '^(불|냉기|전기|독|성)(, (불|냉기|전기|독|성))*$'),
  constraint catalog_monsters_elements_disjoint check (not (coalesce(string_to_array(weak_elements, ', '), array[]::text[]) && coalesce(string_to_array(resist_elements, ', '), array[]::text[])))
);
create index if not exists catalog_monsters_level_idx on public.catalog_monsters(level);
create unique index if not exists catalog_monsters_source_idx on public.catalog_monsters(source, source_id) where source_id is not null;

-- 옵션은 허용된 능력치의 정수만 저장한다. 0도 실제 옵션 값이며 빈 값과 구분한다.
create or replace function public.valid_item_options(value jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(value) <> 'object' or value is null then false else
    not exists (select 1 from jsonb_each(value) as p(key, val) where
      key not in ('attack','magic_attack','str','dex','int','luk','hp','mp','defense','magic_defense','accuracy','avoidability','speed','jump','remaining_upgrades','used_upgrades')
      or case when jsonb_typeof(val) <> 'number' then true else
        (val::text)::numeric <> trunc((val::text)::numeric)
        or abs((val::text)::numeric) > 2147483647
        or (key in ('remaining_upgrades','used_upgrades') and (val::text)::numeric < 0) end)
  end
$$;
revoke all on function public.valid_item_options(jsonb) from public;
grant execute on function public.valid_item_options(jsonb) to anon, authenticated, service_role;

create table if not exists public.catalog_items (
  id uuid primary key default gen_random_uuid(), name text not null check (btrim(name) <> ''),
  category text not null default '기타',
  base_options jsonb not null default '{}'::jsonb check (public.valid_item_options(base_options)),
  requirements jsonb not null default '{}'::jsonb check (jsonb_typeof(requirements) = 'object'),
  image_url text check (image_url is null or image_url ~ '^https://'),
  source text, source_id text, source_url text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists catalog_items_name_idx on public.catalog_items(name);
create unique index if not exists catalog_items_source_idx on public.catalog_items(source, source_id) where source_id is not null;

-- 공용 도감은 비로그인 포함 조회만 허용. SQL Editor/서버 운영자만 수정한다.
do $$ declare t text; begin
  foreach t in array array['catalog_monsters','catalog_items'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('grant select on public.%I to anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('drop policy if exists catalog_read on public.%I',t);
    execute format('create policy catalog_read on public.%I for select to anon, authenticated using (true)',t);
    execute format('drop trigger if exists catalog_touch_updated_at on public.%I',t);
    execute format('create trigger catalog_touch_updated_at before update on public.%I for each row execute function public.touch_updated_at()',t);
  end loop;
end $$;

-- 검토용 원본은 API에 공개하지 않는다. 사용자 ID는 복사하지 않는다.
create table if not exists public.catalog_monster_reviews (
  name text primary key, variants jsonb not null, reason text not null,
  status text not null default 'pending' check(status in ('pending','resolved')),
  created_at timestamptz not null default now()
);
alter table public.catalog_monster_reviews enable row level security;
revoke all on public.catalog_monster_reviews from public, anon, authenticated;
grant all on public.catalog_monster_reviews to service_role;

-- 같은 이름의 non-null 값이 서로 다르면 그룹 전체를 검토 대기로 둔다.
-- 비어 있는 값과 하나의 값만 공존하면 그 값을 쓰고, 계산 비율은 DB가 재계산한다.
with normalized as (
  select regexp_replace(name, '[[:space:]' || chr(8203) || chr(8204) || chr(8205) || chr(12288) || chr(160) || ']', '', 'g') as key, m.*
  from public.monsters m
), grouped as (
  select key, max(level) level, max(hp) hp, max(exp) exp,
    max(required_accuracy) required_accuracy, max(accuracy_per_level) accuracy_per_level,
    max(nullif(btrim(drop_items),'')) drop_items,
    max(nullif(btrim(weak_elements),'')) weak_elements, max(nullif(btrim(resist_elements),'')) resist_elements,
    count(distinct level)>1 or count(distinct hp)>1 or count(distinct exp)>1
      or count(distinct required_accuracy)>1 or count(distinct accuracy_per_level)>1
      or count(distinct nullif(btrim(drop_items),''))>1
      or count(distinct nullif(btrim(weak_elements),''))>1 or count(distinct nullif(btrim(resist_elements),''))>1
      or (coalesce(string_to_array(max(nullif(btrim(weak_elements),'')), ', '), array[]::text[]) && coalesce(string_to_array(max(nullif(btrim(resist_elements),'')), ', '), array[]::text[])) as conflicting,
    jsonb_agg(jsonb_build_object('legacy_id',id,'name',name,'level',level,'hp',hp,'exp',exp,
      'required_accuracy',required_accuracy,'accuracy_per_level',accuracy_per_level,
      'drop_items',drop_items,'weak_elements',weak_elements,'resist_elements',resist_elements) order by id) variants
  from normalized group by key
), reviewed as (
  insert into public.catalog_monster_reviews(name,variants,reason)
  select key, variants, case when key='' then '이름 없음' else '같은 이름의 값이 다름' end
  from grouped where conflicting or key=''
  on conflict(name) do nothing returning name
)
insert into public.catalog_monsters(name,level,hp,exp,required_accuracy,accuracy_per_level,drop_items,weak_elements,resist_elements,source)
select key,level,hp,exp,required_accuracy,accuracy_per_level,drop_items,weak_elements,resist_elements,'legacy'
from grouped where not conflicting and key<>''
on conflict(name) do nothing;

-- 거래는 계속 사용자별 RLS 적용. 공용 아이템을 선택하지 않은 기존 거래도 유지한다.
alter table public.trades add column if not exists item_id uuid references public.catalog_items(id) on delete restrict;
alter table public.trades add column if not exists item_snapshot jsonb not null default '{}'::jsonb;
alter table public.trades add column if not exists item_options jsonb not null default '{}'::jsonb;
alter table public.trades drop constraint if exists trades_item_options_check;
alter table public.trades add constraint trades_item_options_check check(public.valid_item_options(item_options));
alter table public.trades drop constraint if exists trades_item_snapshot_check;
alter table public.trades add constraint trades_item_snapshot_check check(jsonb_typeof(item_snapshot)='object');
create index if not exists trades_user_item_idx on public.trades(user_id,item_id);
comment on column public.trades.item_snapshot is '거래 당시 공용 아이템 기본 정보 복사. 도감 수정에 영향받지 않음';
comment on column public.trades.item_options is '사용자가 입력한 실제 아이템 옵션. 같은 이름이라도 다르면 합산하지 않음';

create or replace function public.replace_my_trades(
  expected jsonb,
  replacement jsonb,
  restore_times boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  affected uuid[];
  current_rows jsonb;
  expected_rows jsonb;
  result_rows jsonb;
begin
  if me is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  if expected is null or replacement is null
     or jsonb_typeof(expected) <> 'array' or jsonb_typeof(replacement) <> 'array' then
    raise exception '거래 변경 형식이 올바르지 않습니다.';
  end if;
  if jsonb_array_length(expected) > 2 or jsonb_array_length(replacement) > 2 then
    raise exception '한 번에 마지막 거래 작업만 처리할 수 있습니다.';
  end if;
  select array_agg(distinct (v->>'id')::uuid) into affected
  from (select jsonb_array_elements(expected) v union all select jsonb_array_elements(replacement) v) changes;
  if affected is null or array_position(affected, null) is not null then
    raise exception '거래 식별자가 필요합니다.';
  end if;
  if (select count(distinct v->>'id') from jsonb_array_elements(expected) v) <> jsonb_array_length(expected)
    or (select count(distinct v->>'id') from jsonb_array_elements(replacement) v) <> jsonb_array_length(replacement) then
    raise exception '거래 식별자가 중복되었습니다.';
  end if;

  -- 잠근 뒤 비교한다. 다른 요청의 수정·삭제가 먼저 반영됐다면 복원하지 않는다.
  perform id from public.trades where user_id = me and id = any(affected) order by id for update;
  select coalesce(jsonb_agg(to_jsonb(t) - 'user_id' order by t.id), '[]'::jsonb)
    into current_rows from public.trades t where user_id = me and id = any(affected);
  -- timestamptz/bigint 등을 DB 형식으로 정규화해 JSON 문자열 표기 차이를 없앤다.
  select coalesce(jsonb_agg((to_jsonb(t) || jsonb_build_object('item_snapshot',coalesce(t.item_snapshot,'{}'::jsonb),'item_options',coalesce(t.item_options,'{}'::jsonb))) order by t.id), '[]'::jsonb) into expected_rows
  from jsonb_to_recordset(expected) as t(id uuid, name text, buy_price bigint, buy_qty integer,
    sell_price bigint, sell_qty integer, created_at timestamptz, updated_at timestamptz, item_id uuid, item_snapshot jsonb, item_options jsonb);
  if current_rows <> expected_rows then
    raise exception '다른 곳에서 거래가 변경되었습니다. 최신 목록을 확인한 뒤 다시 진행해 주세요.' using errcode = '40001';
  end if;

  -- 현재 trades를 참조하는 하위 테이블은 없다. 재삽입으로 최초 등록 시각까지 복원한다.
  -- RLS와 assign_user_id 트리거가 모두 적용되며 다른 사용자의 행은 처리할 수 없다.
  delete from public.trades where user_id = me and id = any(affected);
  insert into public.trades(id, user_id, name, buy_price, buy_qty, sell_price, sell_qty, created_at, updated_at, item_id, item_snapshot, item_options)
  select t.id, me, t.name, t.buy_price, t.buy_qty, t.sell_price, t.sell_qty,
    coalesce(t.created_at, now()), case when restore_times then coalesce(t.updated_at, now()) else now() end, t.item_id, coalesce(t.item_snapshot,'{}'::jsonb), coalesce(t.item_options,'{}'::jsonb)
  from jsonb_to_recordset(replacement) as t(id uuid, name text, buy_price bigint, buy_qty integer,
    sell_price bigint, sell_qty integer, created_at timestamptz, updated_at timestamptz, item_id uuid, item_snapshot jsonb, item_options jsonb);
  select coalesce(jsonb_agg(to_jsonb(t) - 'user_id' order by t.id), '[]'::jsonb)
    into result_rows from public.trades t where user_id = me and id = any(affected);
  return jsonb_build_object('before', current_rows, 'after', result_rows);
end;
$$;

revoke all on function public.replace_my_trades(jsonb, jsonb, boolean) from public, anon;
grant execute on function public.replace_my_trades(jsonb, jsonb, boolean) to authenticated;

-- 새 화면은 전용 함수명을 사용해 038 미실행 시 옵션을 잃는 구버전 저장을 막는다.
create or replace function public.replace_my_trades_v2(expected jsonb,replacement jsonb,restore_times boolean default false)
returns jsonb language sql security invoker set search_path = '' as $$
  select public.replace_my_trades(expected,replacement,restore_times)
$$;
revoke all on function public.replace_my_trades_v2(jsonb,jsonb,boolean) from public,anon;
grant execute on function public.replace_my_trades_v2(jsonb,jsonb,boolean) to authenticated;
-- 구버전 화면이 개인 몬스터를 계속 고쳐 공용 도감과 어긋나지 않게 원본을 읽기 보관한다.
revoke insert, update, delete on public.monsters from anon, authenticated;
commit;
