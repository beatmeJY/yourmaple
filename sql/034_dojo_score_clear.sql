-- 이미 사용 중인 데이터베이스용입니다.
-- Supabase SQL Editor에 이 파일 전체를 붙여 넣고 Run 합니다.
-- 033까지 이미 실행했다면 이 파일만 실행합니다.
-- 무릉 "오늘 초기화": 오늘 쌓은 점수(3,500점 중)만 0으로 되돌리는 기록 kind = 'clear' 를 허용합니다.
-- 통합 점수는 그대로이고, 그 뒤로 오른 점수부터 다시 셉니다.
-- 이미 이 파일을 실행했다면 같은 파일을 다시 실행해도 됩니다.

alter table public.dojo_score_log drop constraint if exists dojo_score_log_kind_check;
alter table public.dojo_score_log
  add constraint dojo_score_log_kind_check check (kind in ('set', 'reset', 'clear'));

comment on table public.dojo_score_log is '무릉 통합 점수 기록. 적을 때마다 한 줄. kind: set(현재 점수 입력), reset(12,000점 초기화 뒤 점수), clear(오늘 쌓은 점수만 0으로)';
