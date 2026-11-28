-- 현금·메소·포인트 계산기 시세 기록(2026-11-28).
-- 계산기 화면(/meso-point/)에서 두 시세를 적고 "시세 기록"을 누르면 한 줄씩 쌓입니다.
--   exchange_meso = 게임 내 교환: 1만 포인트당 메소
--   cash_won      = 유저 현금 거래: 100만 메소당 원
-- 본인 기록만 읽고 쓰고 지웁니다. 같은 파일을 다시 실행해도 안전합니다.

create table if not exists public.meso_point_rates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  exchange_meso bigint not null,
  cash_won integer not null,
  memo text,
  created_at timestamptz not null default now()
);

comment on table public.meso_point_rates is '현금·메소·포인트 계산기 시세 기록. 기록할 때마다 한 줄씩 쌓입니다';
comment on column public.meso_point_rates.exchange_meso is '게임 내 교환: 1만 포인트당 메소';
comment on column public.meso_point_rates.cash_won is '유저 현금 거래: 100만 메소당 원';
comment on column public.meso_point_rates.memo is '짧은 메모(선택, 100자까지)';

alter table public.meso_point_rates drop constraint if exists meso_point_rates_exchange_check;
alter table public.meso_point_rates
  add constraint meso_point_rates_exchange_check
  check (exchange_meso between 1 and 1000000000000);

alter table public.meso_point_rates drop constraint if exists meso_point_rates_cash_check;
alter table public.meso_point_rates
  add constraint meso_point_rates_cash_check
  check (cash_won between 1 and 1000000);

alter table public.meso_point_rates drop constraint if exists meso_point_rates_memo_check;
alter table public.meso_point_rates
  add constraint meso_point_rates_memo_check
  check (memo is null or char_length(memo) <= 100);

create index if not exists meso_point_rates_user_idx
  on public.meso_point_rates (user_id, created_at desc);

drop trigger if exists meso_point_rates_assign_user_id on public.meso_point_rates;
create trigger meso_point_rates_assign_user_id
  before insert or update on public.meso_point_rates
  for each row execute function public.assign_user_id();

alter table public.meso_point_rates enable row level security;
revoke all on table public.meso_point_rates from anon, authenticated;
grant select, insert, update, delete on table public.meso_point_rates to authenticated;
grant all on table public.meso_point_rates to service_role;

drop policy if exists meso_point_rates_select_own on public.meso_point_rates;
create policy meso_point_rates_select_own
on public.meso_point_rates for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists meso_point_rates_insert_own on public.meso_point_rates;
create policy meso_point_rates_insert_own
on public.meso_point_rates for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists meso_point_rates_update_own on public.meso_point_rates;
create policy meso_point_rates_update_own
on public.meso_point_rates for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists meso_point_rates_delete_own on public.meso_point_rates;
create policy meso_point_rates_delete_own
on public.meso_point_rates for delete to authenticated
using ((select auth.uid()) = user_id);
