-- 사용 중지: 사용자 요청이 전체 몬스터 삭제로 변경됐습니다. 042만 실행하세요(2026-10-27).
-- 요청한 2026-10-27 19:23:15(한국 시각) 등록분 220개의 드랍 정보만 초기화합니다.
-- 전체를 한 번에 실행합니다. 원본 전체 행을 비공개 백업한 뒤 드랍만 비웁니다.
-- 재실행은 이미 초기화한 등록분을 다시 지우지 않습니다.
begin;
create table if not exists public.catalog_monster_drop_backups (
  batch_key text not null,
  monster_id uuid not null,
  row_data jsonb not null,
  backed_up_at timestamptz not null default now(),
  primary key(batch_key,monster_id)
);
alter table public.catalog_monster_drop_backups enable row level security;
revoke all on public.catalog_monster_drop_backups from public, anon, authenticated;
grant all on public.catalog_monster_drop_backups to service_role;
do $$
declare batch constant text := 'operator-sheet-20261027T102315535098Z'; row_count integer; changed boolean;
begin
  -- 같은 시각의 추가/수정과 겹치지 않도록 백업·검사·초기화를 한 잠금 안에서 처리합니다.
  lock table public.catalog_monsters in share row exclusive mode;
  select count(*) into row_count from public.catalog_monster_drop_backups where batch_key=batch;
  if row_count=220 then return; end if;
  if row_count<>0 then raise exception '초기화 백업 수가 다릅니다. 운영자 검토가 필요합니다.'; end if;
  select count(*), coalesce(bool_or(updated_at<>created_at),false) into row_count,changed
  from public.catalog_monsters where source='operator-sheet' and created_at='2026-10-27 10:23:15.535098+00'::timestamptz;
  if row_count<>220 or changed then
    raise exception '대상 220개가 삭제되었거나 등록 후 수정되었습니다. 초기화하지 않았습니다.';
  end if;
  insert into public.catalog_monster_drop_backups(batch_key,monster_id,row_data)
  select batch,id,to_jsonb(m) from public.catalog_monsters m
  where source='operator-sheet' and created_at='2026-10-27 10:23:15.535098+00'::timestamptz;
  update public.catalog_monsters set drop_items=null
  where id in (select monster_id from public.catalog_monster_drop_backups where batch_key=batch)
    and drop_items is not null;
end $$;
commit;
