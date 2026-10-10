-- 이미 사용 중인 데이터베이스용입니다.
-- Supabase SQL Editor에 이 파일 전체를 붙여 넣고 Run 합니다.
-- 029까지 이미 실행했다면 이 파일만 실행합니다.
-- 숙제 체크리스트: 직접 추가한 숙제 목록과, 캐릭터마다 숙제를 끝낸 시각을 저장합니다.
-- 보스(파풀라투스·차원의 균열 조각·피아누스)는 캐릭터 표의 도전 시각 칸을 그대로 씁니다.
-- 이미 이 파일을 실행했다면 같은 파일을 다시 실행해도 됩니다.

-- ---------------------------------------------------------------------------
-- 직접 추가한 숙제
-- ---------------------------------------------------------------------------
create table if not exists public.homework_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  reset_kind text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.homework_tasks is '숙제 체크리스트에 직접 추가한 숙제';
comment on column public.homework_tasks.reset_kind is 'daily(매일 00시 초기화), after24h(끝낸 뒤 24시간), after7d(끝낸 뒤 7일)';

alter table public.homework_tasks drop constraint if exists homework_tasks_name_check;
alter table public.homework_tasks
  add constraint homework_tasks_name_check check (char_length(btrim(name)) between 1 and 40);

alter table public.homework_tasks drop constraint if exists homework_tasks_reset_kind_check;
alter table public.homework_tasks
  add constraint homework_tasks_reset_kind_check check (reset_kind in ('daily', 'after24h', 'after7d'));

create index if not exists homework_tasks_user_idx on public.homework_tasks (user_id, sort_order, created_at);

drop trigger if exists homework_tasks_assign_user_id on public.homework_tasks;
create trigger homework_tasks_assign_user_id
  before insert or update on public.homework_tasks
  for each row execute function public.assign_user_id();

alter table public.homework_tasks enable row level security;
revoke all on table public.homework_tasks from anon, authenticated;
grant select, insert, update, delete on table public.homework_tasks to authenticated;
grant all on table public.homework_tasks to service_role;

drop policy if exists homework_tasks_select_own on public.homework_tasks;
create policy homework_tasks_select_own
on public.homework_tasks for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists homework_tasks_insert_own on public.homework_tasks;
create policy homework_tasks_insert_own
on public.homework_tasks for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists homework_tasks_update_own on public.homework_tasks;
create policy homework_tasks_update_own
on public.homework_tasks for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists homework_tasks_delete_own on public.homework_tasks;
create policy homework_tasks_delete_own
on public.homework_tasks for delete to authenticated
using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 캐릭터별 숙제 완료 시각 (캐릭터·숙제마다 한 줄, 체크를 풀면 줄을 지웁니다)
-- task_key: 기본 숙제는 'dojo'(무릉도장), 직접 추가한 숙제는 homework_tasks.id 문자열
-- ---------------------------------------------------------------------------
create table if not exists public.homework_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  character_id uuid not null references public.characters (id) on delete cascade,
  task_key text not null,
  checked_at timestamptz not null default now()
);

comment on table public.homework_checks is '캐릭터별 숙제를 마지막으로 끝낸 시각. 초기화 방식에 따라 화면이 다시 비어 있는 칸으로 봅니다';

alter table public.homework_checks drop constraint if exists homework_checks_task_key_check;
alter table public.homework_checks
  add constraint homework_checks_task_key_check check (char_length(task_key) between 1 and 64);

create unique index if not exists homework_checks_character_task_idx on public.homework_checks (character_id, task_key);

drop trigger if exists homework_checks_assign_user_id on public.homework_checks;
create trigger homework_checks_assign_user_id
  before insert or update on public.homework_checks
  for each row execute function public.assign_user_id();

-- 본인 캐릭터에만 체크를 남길 수 있게 막습니다.
create or replace function public.check_homework_character()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.characters c
    where c.id = new.character_id and c.user_id = new.user_id
  ) then
    raise exception '본인 캐릭터에만 숙제를 체크할 수 있습니다.';
  end if;
  return new;
end;
$$;

drop trigger if exists homework_checks_check_character on public.homework_checks;
create trigger homework_checks_check_character
  before insert or update of character_id on public.homework_checks
  for each row execute function public.check_homework_character();

revoke all on function public.check_homework_character() from public, anon;
grant execute on function public.check_homework_character() to authenticated, service_role;

alter table public.homework_checks enable row level security;
revoke all on table public.homework_checks from anon, authenticated;
grant select, insert, update, delete on table public.homework_checks to authenticated;
grant all on table public.homework_checks to service_role;

drop policy if exists homework_checks_select_own on public.homework_checks;
create policy homework_checks_select_own
on public.homework_checks for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists homework_checks_insert_own on public.homework_checks;
create policy homework_checks_insert_own
on public.homework_checks for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists homework_checks_update_own on public.homework_checks;
create policy homework_checks_update_own
on public.homework_checks for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists homework_checks_delete_own on public.homework_checks;
create policy homework_checks_delete_own
on public.homework_checks for delete to authenticated
using ((select auth.uid()) = user_id);
