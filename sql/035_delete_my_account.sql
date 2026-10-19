-- 이미 사용 중인 데이터베이스용입니다.
-- Supabase SQL Editor에 이 파일 전체를 붙여 넣고 Run 합니다.
-- 034까지 이미 실행했다면 이 파일만 실행합니다.
-- 회원 탈퇴(2026-10-19): 로그인한 사용자가 자기 계정을 지웁니다.
-- 모든 표의 user_id 가 auth.users 를 on delete cascade 로 가리키므로, 계정을 지우면 그 사용자의 기록도 함께 지워집니다.
-- 얼굴 이미지(character-faces 버킷의 user_id/ 폴더)는 화면이 먼저 지운 뒤 이 함수를 부릅니다.
-- 이미 이 파일을 실행했다면 같은 파일을 다시 실행해도 됩니다.

-- dry_run = true 면 지우지 않고 부를 수 있는지만 확인합니다(화면이 얼굴 이미지를 지우기 전에 먼저 확인).
drop function if exists public.delete_my_account();

create or replace function public.delete_my_account(dry_run boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception '로그인한 사용자만 탈퇴할 수 있습니다.' using errcode = '42501';
  end if;
  if dry_run then
    return;
  end if;
  delete from auth.users where id = me;
end;
$$;

comment on function public.delete_my_account(boolean) is '회원 탈퇴: 호출한 사용자(auth.uid())의 계정과 cascade 로 연결된 모든 기록을 지운다';

revoke all on function public.delete_my_account(boolean) from public, anon;
grant execute on function public.delete_my_account(boolean) to authenticated;
