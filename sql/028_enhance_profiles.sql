-- 이미 사용 중인 데이터베이스용입니다.
-- Supabase SQL Editor에 이 파일 전체를 붙여 넣고 Run 합니다.
-- 027까지 이미 실행했다면 이 파일만 실행합니다.
-- 사용자별 강화 계산 아이템 프로필을 저장합니다.
-- 같은 파일을 다시 실행해도 안전합니다.

create table if not exists public.enhance_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.enhance_profiles is '사용자별 강화 계산 아이템 설정. 화면에서는 현재 최대 5개를 사용하지만 DB 개수는 제한하지 않습니다';
comment on column public.enhance_profiles.name is '강화 계산에서 표시할 아이템 이름';
comment on column public.enhance_profiles.sort_order is '사용자 화면의 표시 순서';
comment on column public.enhance_profiles.settings is '무기 종류, 상점가, 주문서 시세, 노작·완성 공격력별 시세를 문자열 금액으로 저장한 JSON';

alter table public.enhance_profiles drop constraint if exists enhance_profiles_name_check;
alter table public.enhance_profiles
  add constraint enhance_profiles_name_check
  check (char_length(btrim(name)) between 1 and 60);

alter table public.enhance_profiles drop constraint if exists enhance_profiles_sort_order_check;
alter table public.enhance_profiles
  add constraint enhance_profiles_sort_order_check
  check (sort_order >= 0);

alter table public.enhance_profiles drop constraint if exists enhance_profiles_settings_check;
alter table public.enhance_profiles
  add constraint enhance_profiles_settings_check
  check (jsonb_typeof(settings) = 'object');

create index if not exists enhance_profiles_user_order_idx
  on public.enhance_profiles (user_id, sort_order, updated_at desc);

drop trigger if exists enhance_profiles_assign_user_id on public.enhance_profiles;
create trigger enhance_profiles_assign_user_id
  before insert or update on public.enhance_profiles
  for each row execute function public.assign_user_id();

drop trigger if exists enhance_profiles_touch_updated_at on public.enhance_profiles;
create trigger enhance_profiles_touch_updated_at
  before update on public.enhance_profiles
  for each row execute function public.touch_updated_at();

alter table public.enhance_profiles enable row level security;
revoke all on table public.enhance_profiles from anon, authenticated;
grant select, insert, update, delete on table public.enhance_profiles to authenticated;
grant all on table public.enhance_profiles to service_role;

drop policy if exists enhance_profiles_select_own on public.enhance_profiles;
create policy enhance_profiles_select_own
on public.enhance_profiles for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists enhance_profiles_insert_own on public.enhance_profiles;
create policy enhance_profiles_insert_own
on public.enhance_profiles for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists enhance_profiles_update_own on public.enhance_profiles;
create policy enhance_profiles_update_own
on public.enhance_profiles for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists enhance_profiles_delete_own on public.enhance_profiles;
create policy enhance_profiles_delete_own
on public.enhance_profiles for delete to authenticated
using ((select auth.uid()) = user_id);
