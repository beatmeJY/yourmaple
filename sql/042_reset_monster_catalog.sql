-- 공용 몬스터 전체 초기화: 2026-10-27 사용자 요청.
-- SQL Editor에서 전체 실행합니다. 040/041을 이미 실행했어도 사용할 수 있습니다.
-- 041의 원본 백업을 새 백업 공간으로 옮긴 뒤 구 백업 테이블을 정리합니다. 041은 다시 실행하지 않습니다.
-- 현재 확인한 220개를 전부 비공개 백업 후 삭제합니다. 다른 도감·개인 기록은 건드리지 않습니다.
-- 한 번 성공한 뒤 재실행해도 다시 등록한 몬스터는 지우지 않습니다.
begin;
create table if not exists public.catalog_monster_reset_runs (
  run_key text primary key,
  backed_up_count integer not null,
  completed_at timestamptz not null default now()
);
create table if not exists public.catalog_monster_reset_rows (
  run_key text not null references public.catalog_monster_reset_runs(run_key),
  monster_id uuid not null,
  row_data jsonb not null,
  primary key(run_key,monster_id)
);
alter table public.catalog_monster_reset_runs enable row level security;
alter table public.catalog_monster_reset_rows enable row level security;
revoke all on public.catalog_monster_reset_runs,public.catalog_monster_reset_rows from public,anon,authenticated;
grant all on public.catalog_monster_reset_runs,public.catalog_monster_reset_rows to service_role;
-- 041과 같은 잠금 순서(도감 → 구 백업)로 동시에 실행해도 잠금 순환을 피합니다.
lock table public.catalog_monsters in share row exclusive mode;
-- 이미 041을 실행한 경우 최초 드랍까지 복구할 수 있도록 백업을 통합합니다.
do $$
begin
  if to_regclass('public.catalog_monster_drop_backups') is not null then
    lock table public.catalog_monster_drop_backups in share row exclusive mode;
    insert into public.catalog_monster_reset_runs(run_key,backed_up_count,completed_at)
      select 'archived-drop-reset:' || batch_key,count(*)::integer,max(backed_up_at)
      from public.catalog_monster_drop_backups group by batch_key
      on conflict(run_key) do nothing;
    insert into public.catalog_monster_reset_rows(run_key,monster_id,row_data)
      select 'archived-drop-reset:' || batch_key,monster_id,row_data
      from public.catalog_monster_drop_backups
      on conflict(run_key,monster_id) do nothing;
    if exists(select 1 from public.catalog_monster_drop_backups old
      left join public.catalog_monster_reset_rows saved
        on saved.run_key='archived-drop-reset:' || old.batch_key and saved.monster_id=old.monster_id
      where saved.row_data is distinct from old.row_data) then
      raise exception '기존 드랍 백업을 온전히 옮기지 못했습니다. 삭제하지 않았습니다.';
    end if;
    drop table public.catalog_monster_drop_backups;
  end if;
end $$;
do $$
declare key constant text := 'reset-all-monsters-20261027'; total integer;
begin
  lock table public.catalog_monsters in share row exclusive mode;
  if exists(select 1 from public.catalog_monster_reset_runs where run_key=key) then return; end if;
  select count(*) into total from public.catalog_monsters;
  if total<>220 or exists(select 1 from public.catalog_monsters where source is distinct from 'operator-sheet'
    or created_at is distinct from '2026-10-27 10:23:15.535098+00'::timestamptz) then
    raise exception '확인한 220개와 현재 몬스터 목록이 다릅니다. 삭제하지 않았습니다. 목록을 다시 확인해 주세요.';
  end if;
  insert into public.catalog_monster_reset_runs(run_key,backed_up_count) values(key,total);
  insert into public.catalog_monster_reset_rows(run_key,monster_id,row_data)
    select key,id,to_jsonb(m) from public.catalog_monsters m;
  delete from public.catalog_monsters;
end $$;
commit;
