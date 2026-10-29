-- SQL Editor 또는 DBeaver 쓰기 연결에서 전체 실행합니다(재실행 가능).
-- 자쿰(3페이즈), 외부 ID 8800002의 지정 드랍 4개 연결만 제거합니다.
-- 아이템 원본·다른 자쿰·몬스터 정보는 유지하고, 삭제 전 연결은 비공개 보관합니다.
begin;
select pg_advisory_xact_lock(20261028,43);

create table if not exists catalog_import_private.zakum_phase3_drop_backup (
  drop_id uuid primary key,
  row_data jsonb not null,
  saved_at timestamptz not null default now()
);
revoke all on catalog_import_private.zakum_phase3_drop_backup from public,anon,authenticated;
grant select on catalog_import_private.zakum_phase3_drop_backup to service_role;

do $$
declare target_id uuid; amount integer;
begin
  select id into strict target_id from public.catalog_monsters
    where source='collected' and source_id='8800002' and name='자쿰(3페이즈)';
  select count(*) into amount from public.catalog_monster_drops where monster_id=target_id;
  if amount=0 then return; end if;
  if amount<>4 or exists (
    select 1 from public.catalog_monster_drops d
    join public.catalog_items i on i.id=d.item_id
    where d.monster_id=target_id and
      (i.source is distinct from 'collected' or i.source_id is null or
       i.source_id not in ('2290110','2290115','2290230','2290007'))
  ) or (select count(distinct i.source_id) from public.catalog_monster_drops d
        join public.catalog_items i on i.id=d.item_id where d.monster_id=target_id)<>4 then
    raise exception '자쿰 3페이즈 드랍이 예상한 4개와 다릅니다. 삭제하지 않았습니다.';
  end if;
  insert into catalog_import_private.zakum_phase3_drop_backup(drop_id,row_data)
    select d.id,to_jsonb(d) from public.catalog_monster_drops d where d.monster_id=target_id
    on conflict do nothing;
  delete from public.catalog_monster_drops where monster_id=target_id;
  update public.catalog_revision set revision=revision+1,updated_at=now() where singleton;
end $$;
commit;
