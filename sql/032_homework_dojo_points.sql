-- 이미 사용 중인 데이터베이스용입니다.
-- Supabase SQL Editor에 이 파일 전체를 붙여 넣고 Run 합니다.
-- 031까지 이미 실행했다면 이 파일만 실행합니다.
-- 숙제 체크리스트 무릉도장 점수: 캐릭터마다 오늘 점수와 누적 점수를 저장합니다.
-- 오늘 점수가 3,500점이 되면 무릉도장 숙제를 끝낸 것으로 봅니다. 누적 점수는 사용자가 12,000점 초기화를 누를 때까지 쌓입니다.
-- 이미 이 파일을 실행했다면 같은 파일을 다시 실행해도 됩니다.

create table if not exists public.homework_dojo_points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  character_id uuid not null references public.characters (id) on delete cascade,
  total integer not null default 0,
  day date,
  day_score integer not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.homework_dojo_points is '숙제 체크리스트 무릉도장 점수. day 가 오늘이 아니면 화면이 오늘 점수를 0으로 봅니다';
comment on column public.homework_dojo_points.total is '누적 점수. 12,000점 초기화를 누르면 12,000점을 뺍니다';
comment on column public.homework_dojo_points.day is 'day_score 를 쌓은 날(기기 시간 기준 날짜)';
comment on column public.homework_dojo_points.day_score is '그날 쌓은 점수. 3,500점 이상이면 그날 무릉도장 숙제 완료';

alter table public.homework_dojo_points drop constraint if exists homework_dojo_points_total_check;
alter table public.homework_dojo_points
  add constraint homework_dojo_points_total_check check (total >= 0 and total <= 10000000);

alter table public.homework_dojo_points drop constraint if exists homework_dojo_points_day_score_check;
alter table public.homework_dojo_points
  add constraint homework_dojo_points_day_score_check check (day_score >= 0 and day_score <= 1000000);

create unique index if not exists homework_dojo_points_character_idx on public.homework_dojo_points (character_id);

drop trigger if exists homework_dojo_points_assign_user_id on public.homework_dojo_points;
create trigger homework_dojo_points_assign_user_id
  before insert or update on public.homework_dojo_points
  for each row execute function public.assign_user_id();

drop trigger if exists homework_dojo_points_check_character on public.homework_dojo_points;
create trigger homework_dojo_points_check_character
  before insert or update of character_id on public.homework_dojo_points
  for each row execute function public.check_homework_character();

alter table public.homework_dojo_points enable row level security;
revoke all on table public.homework_dojo_points from anon, authenticated;
grant select, insert, update, delete on table public.homework_dojo_points to authenticated;
grant all on table public.homework_dojo_points to service_role;

drop policy if exists homework_dojo_points_select_own on public.homework_dojo_points;
create policy homework_dojo_points_select_own
on public.homework_dojo_points for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists homework_dojo_points_insert_own on public.homework_dojo_points;
create policy homework_dojo_points_insert_own
on public.homework_dojo_points for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists homework_dojo_points_update_own on public.homework_dojo_points;
create policy homework_dojo_points_update_own
on public.homework_dojo_points for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists homework_dojo_points_delete_own on public.homework_dojo_points;
create policy homework_dojo_points_delete_own
on public.homework_dojo_points for delete to authenticated
using ((select auth.uid()) = user_id);
