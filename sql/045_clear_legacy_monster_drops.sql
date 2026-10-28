-- 사용자 승인: 기존 수동 드랍은 폐기하고 수집처 수집 자료로 새로 등록합니다.
-- 몬스터 행/능력치, 아이템, 거래, 수집처 드랍 관계는 유지합니다.
-- 038 이후 실행. 043/044 및 전체 수집 자료 등록 전후 모두 실행 가능합니다.
begin;
select pg_advisory_xact_lock(20261028,43);
lock table public.catalog_monsters in share row exclusive mode;
create schema if not exists catalog_import_private;
revoke all on schema catalog_import_private from public,anon,authenticated;
create table if not exists catalog_import_private.legacy_drop_backup (
  monster_id uuid primary key,
  drop_items text not null,
  backed_up_at timestamptz not null default now()
);
create table if not exists catalog_import_private.completed_migrations (
  name text primary key,
  completed_at timestamptz not null default now()
);
revoke all on all tables in schema catalog_import_private from public,anon,authenticated;
do $$
begin
  if exists(select 1 from catalog_import_private.completed_migrations where name='045_clear_legacy_monster_drops') then
    return;
  end if;
  insert into catalog_import_private.legacy_drop_backup(monster_id,drop_items)
  select id,drop_items from public.catalog_monsters
  where source is distinct from 'collected' and nullif(btrim(drop_items),'') is not null;
  update public.catalog_monsters set drop_items=''
  where source is distinct from 'collected' and nullif(btrim(drop_items),'') is not null;
  insert into catalog_import_private.completed_migrations(name) values('045_clear_legacy_monster_drops');
end $$;
commit;
