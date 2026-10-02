-- 이미 사용 중인 데이터베이스용입니다.
-- Supabase SQL Editor에 이 파일 전체를 붙여 넣고 Run 합니다.
-- 026까지 이미 실행했다면 이 파일만 실행합니다.
-- 메이커 계산에 쓰는 원석·상급 시세 기록을 만듭니다.
-- 이 파일을 예전 버전으로 이미 실행했더라도, 같은 파일을 다시 실행하면 최신 상태로 맞춰집니다.

create table if not exists public.maker_gem_prices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item text not null,
  tier text not null,
  price bigint not null,
  created_at timestamptz not null default now()
);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'maker_gem_prices' and column_name = 'gem'
  ) then
    alter table public.maker_gem_prices rename column gem to item;
  end if;
end $$;

comment on table public.maker_gem_prices is '메이커 보석·크리스탈 시세. 바꿀 때마다 한 줄씩 쌓입니다';
comment on column public.maker_gem_prices.item is 'diamond, garnet, amethyst, aquamarine, opal, sapphire, topaz, emerald, str_crystal, dex_crystal, luk_crystal, int_crystal';
comment on column public.maker_gem_prices.tier is 'ore(원석), low(하급), mid(중급), high(상급) 경매장 실거래가';
comment on column public.maker_gem_prices.price is '기록한 시점의 시세';

alter table public.maker_gem_prices drop constraint if exists maker_gem_prices_gem_check;
alter table public.maker_gem_prices drop constraint if exists maker_gem_prices_item_check;
alter table public.maker_gem_prices
  add constraint maker_gem_prices_item_check
  check (item in ('diamond', 'garnet', 'amethyst', 'aquamarine', 'opal', 'sapphire', 'topaz', 'emerald', 'str_crystal', 'dex_crystal', 'luk_crystal', 'int_crystal'));

alter table public.maker_gem_prices drop constraint if exists maker_gem_prices_tier_check;
alter table public.maker_gem_prices
  add constraint maker_gem_prices_tier_check
  check (tier in ('ore', 'low', 'mid', 'high'));

alter table public.maker_gem_prices drop constraint if exists maker_gem_prices_price_check;
alter table public.maker_gem_prices
  add constraint maker_gem_prices_price_check
  check (price >= 0);

drop index if exists public.maker_gem_prices_user_gem_idx;
create index if not exists maker_gem_prices_user_item_idx on public.maker_gem_prices (user_id, item, tier, created_at desc);

drop trigger if exists maker_gem_prices_assign_user_id on public.maker_gem_prices;
create trigger maker_gem_prices_assign_user_id
  before insert or update on public.maker_gem_prices
  for each row execute function public.assign_user_id();

alter table public.maker_gem_prices enable row level security;
revoke all on table public.maker_gem_prices from anon, authenticated;
grant select, insert, update, delete on table public.maker_gem_prices to authenticated;
grant all on table public.maker_gem_prices to service_role;

drop policy if exists maker_gem_prices_select_own on public.maker_gem_prices;
create policy maker_gem_prices_select_own
on public.maker_gem_prices for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists maker_gem_prices_insert_own on public.maker_gem_prices;
create policy maker_gem_prices_insert_own
on public.maker_gem_prices for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists maker_gem_prices_update_own on public.maker_gem_prices;
create policy maker_gem_prices_update_own
on public.maker_gem_prices for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists maker_gem_prices_delete_own on public.maker_gem_prices;
create policy maker_gem_prices_delete_own
on public.maker_gem_prices for delete to authenticated
using ((select auth.uid()) = user_id);
