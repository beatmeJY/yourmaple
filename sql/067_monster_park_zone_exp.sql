-- 057 적용 후 실행합니다. 초기값은 앱의 몬스터파크 기본값과 같습니다.
begin;

create table if not exists public.monster_park_settings (
  singleton boolean primary key default true check (singleton),
  low bigint not null check (low between 1 and 9007199254740991),
  mid bigint not null check (mid between 1 and 9007199254740991),
  high bigint not null check (high between 1 and 9007199254740991)
);

insert into public.monster_park_settings (singleton, low, mid, high)
values (true, 418840, 2898000, 6289333)
on conflict (singleton) do nothing;

alter table public.monster_park_settings enable row level security;
revoke all on public.monster_park_settings from public, anon, authenticated;
grant select on public.monster_park_settings to anon, authenticated;
grant update (low, mid, high) on public.monster_park_settings to authenticated;

drop policy if exists monster_park_settings_read on public.monster_park_settings;
create policy monster_park_settings_read on public.monster_park_settings
  for select to anon, authenticated using (true);

drop policy if exists monster_park_settings_update on public.monster_park_settings;
create policy monster_park_settings_update on public.monster_park_settings
  for update to authenticated
  using (public.can_review_catalog())
  with check (public.can_review_catalog());

commit;
