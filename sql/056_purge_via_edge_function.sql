-- SQL Editor 또는 DBeaver 쓰기 연결에서 전체 실행합니다(재실행 가능).
-- 탈퇴 7일 유예가 지난 계정 삭제를 Edge Function(purge-account-deletions)으로 옮깁니다(2026-11-01).
-- 이유: sql/036 의 purge_account_deletions() 는 얼굴 이미지를 storage.objects 행 삭제(SQL)로 지워
--       실제 파일이 버킷에 남는다(Supabase "Delete Objects" 문서). Edge Function은 Storage API로 파일을 지운 뒤 계정을 지운다.
--
-- 실행 전에 할 일(README "탈퇴 계정 삭제 Edge Function" 참고):
--   1) Edge Function purge-account-deletions 배포(supabase/functions/purge-account-deletions)
--   2) 함수 비밀 CRON_SECRET 저장(Edge Functions → Secrets, `openssl rand -hex 32` 로 만든 값)
--   3) Vault에 비밀 2개 저장(값은 저장소·대화에 남기지 않는다. cron_secret 은 2)와 같은 값):
--        select vault.create_secret('https://<프로젝트 ref>.supabase.co', 'project_url');
--        select vault.create_secret('<CRON_SECRET 과 같은 값>', 'cron_secret');
--   4) 함수 설정의 Verify JWT 는 끈다. 함수가 x-cron-secret 헤더를 직접 확인한다.
-- 두 비밀이 없으면 이 파일은 아무것도 바꾸지 않고 오류로 멈춥니다(기존 매일 삭제 작업 유지).
begin;

create extension if not exists pg_net;

do $$ begin
  if (select count(*) from vault.decrypted_secrets where name in ('project_url', 'cron_secret')) < 2 then
    raise exception 'Vault 비밀 project_url·cron_secret 를 먼저 저장하세요(파일 머리말 참고). 아무것도 바꾸지 않았습니다.';
  end if;
end $$;

-- 매일 03:00(UTC, 한국 12:00) 같은 이름의 작업을 Edge Function 호출로 바꿉니다.
select cron.unschedule(jobid) from cron.job where jobname = 'yourmaple-purge-account-deletions';
select cron.schedule(
  'yourmaple-purge-account-deletions',
  '0 3 * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/purge-account-deletions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);

-- 예전 SQL 삭제 함수는 일정에서 빠졌다. 실수로 불러도 고아 파일이 생기지 않게 실행 권한을 막아 둔다.
revoke all on function public.purge_account_deletions() from public, anon, authenticated;
comment on function public.purge_account_deletions() is '사용 안 함(2026-11-01 sql/056): Edge Function purge-account-deletions 가 대신한다. 이 함수는 이미지 파일을 남긴다';

commit;
