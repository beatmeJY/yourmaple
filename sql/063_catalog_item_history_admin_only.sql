-- 아이템 정보 수정 이력은 도감 관리자(검토 운영자)만 읽는다(2026-11-05 사용자 요청).
-- 몬스터 이력과 catalog_revision 은 지금처럼 누구나 읽는다. 같은 파일을 다시 실행해도 안전하다.
-- 주의: sql/047 을 다시 실행하면 catalog_read 정책이 using(true)로 돌아오므로 이 파일도 다시 실행한다.
alter table public.catalog_changes enable row level security;
drop policy if exists catalog_read on public.catalog_changes;
drop policy if exists catalog_changes_read on public.catalog_changes;
create policy catalog_changes_read on public.catalog_changes for select to anon,authenticated
 using (entity_type <> 'item' or (select public.can_review_catalog()));
