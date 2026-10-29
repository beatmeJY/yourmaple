-- SQL Editor 또는 DBeaver 쓰기 연결에서 전체 실행합니다(재실행 가능).
-- 혼돈의 주문서 60%(외부 ID 2049100) 설명을 사용자가 정한 문구로 바꿉니다(2026-10-30 사용자 요청).
-- 설명 칸은 원문(source_data.description_text)에서 정규화 트리거가 다시 계산하므로 원문을 바꿉니다.
-- 바꾸기 전 원문은 비공개 표에 보관하고, 공개 변경 이력에는 설명 변경 1건이 남습니다.
begin;
select pg_advisory_xact_lock(20261028,43);

create table if not exists catalog_import_private.item_text_backup (
  item_id uuid not null,
  migration text not null,
  description_text text,
  description text,
  saved_at timestamptz not null default now(),
  primary key(item_id, migration)
);
revoke all on catalog_import_private.item_text_backup from public,anon,authenticated;
grant select on catalog_import_private.item_text_backup to service_role;

do $$
declare
  target_id uuid;
  wanted constant text := E'펜던트, 벨트, 반지, 얼굴장식, 눈장식, 어깨장식에 사용하여 현재 옵션을 더 좋거나 나쁘게 조정한다.\n성공률 60%';
begin
  -- 이름과 외부 ID가 둘 다 맞는 한 행만 바꿉니다. 없거나 여러 개면 바꾸지 않고 중단합니다.
  select id into strict target_id from public.catalog_items
    where source='collected' and source_id='2049100' and name='혼돈의 주문서 60%';
  if (select source_data->>'description_text' from public.catalog_items where id=target_id) is not distinct from wanted then
    return;
  end if;
  insert into catalog_import_private.item_text_backup(item_id, migration, description_text, description)
  select id, '053_chaos_scroll_description', source_data->>'description_text', description from public.catalog_items where id=target_id
  on conflict do nothing;
  perform set_config('yourmaple.release_label', '혼돈의 주문서 설명 정리', true);
  update public.catalog_items
    set source_data = jsonb_set(source_data, '{description_text}', to_jsonb(wanted))
    where id=target_id;
end $$;

update public.catalog_revision set revision=revision+1, updated_at=now() where singleton;
insert into catalog_import_private.completed_migrations(name) values('053_chaos_scroll_description') on conflict do nothing;
commit;
