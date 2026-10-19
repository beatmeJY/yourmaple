-- 이미 사용 중인 데이터베이스용입니다.
-- Supabase SQL Editor에 이 파일 전체를 붙여 넣고 Run 합니다.
-- 035까지 이미 실행했다면 이 파일만 실행합니다(035를 안 했어도 이 파일만으로 됩니다).
-- 회원 탈퇴 7일 유예(2026-10-19, 실수로 탈퇴해 기록을 잃은 일 뒤 사용자 요청):
--   화면의 "탈퇴 신청"은 바로 지우지 않고 account_deletions 에 한 줄만 남깁니다(7일 뒤 삭제 예정).
--   7일 안에 "탈퇴 취소"를 누르면 그 줄을 지우고 아무것도 지워지지 않습니다.
--   7일이 지난 신청은 매일 1회 예약 작업(pg_cron)이 계정을 지웁니다. 모든 표의 기록은 cascade 로 함께 지워집니다.
--   예전 즉시 삭제 함수(delete_my_account, sql/035)는 화면에서 부르지 못하게 막습니다.
-- 이미 이 파일을 실행했다면 같은 파일을 다시 실행해도 됩니다.

create table if not exists public.account_deletions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  requested_at timestamptz not null default now(),
  delete_after timestamptz not null default (now() + interval '7 days')
);

comment on table public.account_deletions is '탈퇴 신청(7일 유예). delete_after 가 지나면 purge_account_deletions() 가 계정을 지운다. 줄을 지우면 탈퇴 취소';

-- 신청 시각·삭제 예정 시각은 서버가 정한다(화면이 7일보다 짧게 바꾸지 못하게).
create or replace function public.account_deletions_fix_times()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.user_id := auth.uid();
  new.requested_at := now();
  new.delete_after := now() + interval '7 days';
  return new;
end;
$$;

drop trigger if exists account_deletions_fix_times on public.account_deletions;
create trigger account_deletions_fix_times
  before insert or update on public.account_deletions
  for each row execute function public.account_deletions_fix_times();

alter table public.account_deletions enable row level security;
revoke all on table public.account_deletions from anon, authenticated;
grant select, insert, delete on table public.account_deletions to authenticated;
grant all on table public.account_deletions to service_role;

drop policy if exists account_deletions_select_own on public.account_deletions;
create policy account_deletions_select_own
on public.account_deletions for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists account_deletions_insert_own on public.account_deletions;
create policy account_deletions_insert_own
on public.account_deletions for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists account_deletions_delete_own on public.account_deletions;
create policy account_deletions_delete_own
on public.account_deletions for delete to authenticated
using ((select auth.uid()) = user_id);

-- 7일이 지난 신청을 실제로 지운다(예약 작업이 부름). 얼굴 이미지 파일 정보도 지워 본다.
-- 저장소가 직접 삭제를 막는 환경이면 이미지 정보는 남을 수 있어 실패해도 계정 삭제는 계속한다.
create or replace function public.purge_account_deletions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
  removed integer := 0;
begin
  for target in select user_id from public.account_deletions where delete_after <= now() loop
    begin
      delete from storage.objects where bucket_id = 'character-faces' and name like target.user_id::text || '/%';
    exception when others then
      raise notice '얼굴 이미지 정보를 지우지 못함: %', sqlerrm;
    end;
    delete from auth.users where id = target.user_id;
    removed := removed + 1;
  end loop;
  return removed;
end;
$$;

comment on function public.purge_account_deletions() is '유예 7일이 지난 탈퇴 신청의 계정을 지운다. 매일 pg_cron 이 부른다';
revoke all on function public.purge_account_deletions() from public, anon, authenticated;

-- 즉시 삭제 함수는 화면에서 더는 부르지 못하게 한다(있을 때만).
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'delete_my_account') then
    execute 'revoke all on function public.delete_my_account(boolean) from authenticated';
  end if;
end;
$$;

-- 매일 03:00(UTC, 한국 12:00)에 한 번 지운다.
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'yourmaple-purge-account-deletions';
select cron.schedule('yourmaple-purge-account-deletions', '0 3 * * *', 'select public.purge_account_deletions();');
