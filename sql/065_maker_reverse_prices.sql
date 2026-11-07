-- 리버스 무기별·공격력 단계별 시장가 기록(2026-11-07).
-- 메이커 > 리버스 제작에서 무기를 고르고 정옵~+5 시장가를 적으면 한 줄씩 쌓입니다.
-- 같은 파일을 다시 실행해도 안전합니다.

create table if not exists public.maker_reverse_prices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references public.catalog_items (id),
  bonus smallint not null,
  price bigint not null,
  created_at timestamptz not null default now()
);

comment on table public.maker_reverse_prices is '리버스 무기 공격력 단계별 시장가. 바꿀 때마다 한 줄씩 쌓입니다';
comment on column public.maker_reverse_prices.item_id is '공용 도감(catalog_items)의 리버스 무기';
comment on column public.maker_reverse_prices.bonus is '촉진제 결과 단계: 0(정옵)~5(+5)';
comment on column public.maker_reverse_prices.price is '기록한 시점의 시장가';

alter table public.maker_reverse_prices drop constraint if exists maker_reverse_prices_bonus_check;
alter table public.maker_reverse_prices
  add constraint maker_reverse_prices_bonus_check
  check (bonus between 0 and 5);

alter table public.maker_reverse_prices drop constraint if exists maker_reverse_prices_price_check;
alter table public.maker_reverse_prices
  add constraint maker_reverse_prices_price_check
  check (price >= 0);

create index if not exists maker_reverse_prices_user_item_idx
  on public.maker_reverse_prices (user_id, item_id, bonus, created_at desc);
create index if not exists maker_reverse_prices_item_idx
  on public.maker_reverse_prices (item_id);

drop trigger if exists maker_reverse_prices_assign_user_id on public.maker_reverse_prices;
create trigger maker_reverse_prices_assign_user_id
  before insert or update on public.maker_reverse_prices
  for each row execute function public.assign_user_id();

alter table public.maker_reverse_prices enable row level security;
revoke all on table public.maker_reverse_prices from anon, authenticated;
grant select, insert, update, delete on table public.maker_reverse_prices to authenticated;
grant all on table public.maker_reverse_prices to service_role;

drop policy if exists maker_reverse_prices_select_own on public.maker_reverse_prices;
create policy maker_reverse_prices_select_own
on public.maker_reverse_prices for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists maker_reverse_prices_insert_own on public.maker_reverse_prices;
create policy maker_reverse_prices_insert_own
on public.maker_reverse_prices for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists maker_reverse_prices_update_own on public.maker_reverse_prices;
create policy maker_reverse_prices_update_own
on public.maker_reverse_prices for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists maker_reverse_prices_delete_own on public.maker_reverse_prices;
create policy maker_reverse_prices_delete_own
on public.maker_reverse_prices for delete to authenticated
using ((select auth.uid()) = user_id);
