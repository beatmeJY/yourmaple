-- 이미 사용 중인 데이터베이스용입니다.
-- Supabase SQL Editor에 이 파일 전체를 붙여 넣고 Run 합니다.
-- 032까지 이미 실행했다면 이 파일만 실행합니다.
-- 무릉 통합 점수 기록: 사용자가 게임에서 본 "현재 통합 점수"를 적을 때마다 한 줄씩 쌓습니다.
-- 오늘 번 점수 = 오늘 00시 전 마지막 기록부터 지금까지 오른 점수(숙제 체크리스트에서 3,500점이면 완료).
-- 12,000점 초기화를 누르면 kind = 'reset' 줄을 남깁니다. 무릉 화면에서 자세한 기록을 봅니다.
-- sql/032의 homework_dojo_points 는 더 쓰지 않습니다(지워도 되지만 이 파일은 건드리지 않습니다).
-- 이미 이 파일을 실행했다면 같은 파일을 다시 실행해도 됩니다.

create table if not exists public.dojo_score_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  character_id uuid not null references public.characters (id) on delete cascade,
  total integer not null,
  kind text not null default 'set',
  recorded_at timestamptz not null default now()
);

comment on table public.dojo_score_log is '무릉 통합 점수 기록. 적을 때마다 한 줄. kind: set(현재 점수 입력), reset(12,000점 초기화 뒤 점수)';
comment on column public.dojo_score_log.total is '그때의 통합 점수';

alter table public.dojo_score_log drop constraint if exists dojo_score_log_total_check;
alter table public.dojo_score_log
  add constraint dojo_score_log_total_check check (total >= 0 and total <= 10000000);

alter table public.dojo_score_log drop constraint if exists dojo_score_log_kind_check;
alter table public.dojo_score_log
  add constraint dojo_score_log_kind_check check (kind in ('set', 'reset'));

create index if not exists dojo_score_log_character_idx on public.dojo_score_log (character_id, recorded_at);

drop trigger if exists dojo_score_log_assign_user_id on public.dojo_score_log;
create trigger dojo_score_log_assign_user_id
  before insert or update on public.dojo_score_log
  for each row execute function public.assign_user_id();

-- 본인 캐릭터에만 기록할 수 있게 막습니다(sql/030의 함수를 함께 씁니다).
drop trigger if exists dojo_score_log_check_character on public.dojo_score_log;
create trigger dojo_score_log_check_character
  before insert or update of character_id on public.dojo_score_log
  for each row execute function public.check_homework_character();

alter table public.dojo_score_log enable row level security;
revoke all on table public.dojo_score_log from anon, authenticated;
grant select, insert, update, delete on table public.dojo_score_log to authenticated;
grant all on table public.dojo_score_log to service_role;

drop policy if exists dojo_score_log_select_own on public.dojo_score_log;
create policy dojo_score_log_select_own
on public.dojo_score_log for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists dojo_score_log_insert_own on public.dojo_score_log;
create policy dojo_score_log_insert_own
on public.dojo_score_log for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists dojo_score_log_update_own on public.dojo_score_log;
create policy dojo_score_log_update_own
on public.dojo_score_log for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists dojo_score_log_delete_own on public.dojo_score_log;
create policy dojo_score_log_delete_own
on public.dojo_score_log for delete to authenticated
using ((select auth.uid()) = user_id);
