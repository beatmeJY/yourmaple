-- 이미 사용 중인 데이터베이스용입니다.
-- Supabase SQL Editor에 이 파일 전체를 붙여 넣고 Run 합니다.
-- 030까지 이미 실행했다면 이 파일만 실행합니다.
-- 숙제마다 표시할 캐릭터(무릉도장·직접 추가한 숙제)와, 숨긴 숙제를 저장합니다.
-- 보스 숙제의 캐릭터는 지금처럼 캐릭터 표의 …_enabled 칸을 씁니다.
-- 이미 이 파일을 실행했다면 같은 파일을 다시 실행해도 됩니다(처음 채워 넣기는 한 번만 합니다).

-- ---------------------------------------------------------------------------
-- 숙제별 표시 캐릭터: 줄이 있으면 그 숙제 카드에 캐릭터가 나옵니다.
-- task_key: 'dojo'(무릉도장) 또는 homework_tasks.id 문자열
-- ---------------------------------------------------------------------------
create table if not exists public.homework_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  character_id uuid not null references public.characters (id) on delete cascade,
  task_key text not null,
  created_at timestamptz not null default now()
);

comment on table public.homework_members is '숙제 체크리스트에서 숙제마다 표시할 캐릭터(무릉도장·직접 추가한 숙제)';

alter table public.homework_members drop constraint if exists homework_members_task_key_check;
alter table public.homework_members
  add constraint homework_members_task_key_check check (char_length(task_key) between 1 and 64);

create unique index if not exists homework_members_character_task_idx on public.homework_members (character_id, task_key);

drop trigger if exists homework_members_assign_user_id on public.homework_members;
create trigger homework_members_assign_user_id
  before insert or update on public.homework_members
  for each row execute function public.assign_user_id();

-- 본인 캐릭터만 넣을 수 있게 막습니다(sql/030의 함수를 함께 씁니다).
drop trigger if exists homework_members_check_character on public.homework_members;
create trigger homework_members_check_character
  before insert or update of character_id on public.homework_members
  for each row execute function public.check_homework_character();

alter table public.homework_members enable row level security;
revoke all on table public.homework_members from anon, authenticated;
grant select, insert, update, delete on table public.homework_members to authenticated;
grant all on table public.homework_members to service_role;

drop policy if exists homework_members_select_own on public.homework_members;
create policy homework_members_select_own
on public.homework_members for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists homework_members_insert_own on public.homework_members;
create policy homework_members_insert_own
on public.homework_members for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists homework_members_update_own on public.homework_members;
create policy homework_members_update_own
on public.homework_members for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists homework_members_delete_own on public.homework_members;
create policy homework_members_delete_own
on public.homework_members for delete to authenticated
using ((select auth.uid()) = user_id);

-- 처음 한 번: 지금까지처럼 모든 캐릭터가 무릉도장·직접 추가한 숙제에 보이도록 채웁니다.
-- 이미 표시 캐릭터를 한 명이라도 정한 계정은 건드리지 않습니다(다시 실행해도 뺀 캐릭터가 돌아오지 않게).
insert into public.homework_members (user_id, character_id, task_key)
select c.user_id, c.id, 'dojo'
from public.characters c
where not exists (select 1 from public.homework_members m where m.user_id = c.user_id)
on conflict (character_id, task_key) do nothing;

insert into public.homework_members (user_id, character_id, task_key)
select c.user_id, c.id, t.id::text
from public.homework_tasks t
join public.characters c on c.user_id = t.user_id
where not exists (select 1 from public.homework_members m where m.user_id = c.user_id and m.task_key <> 'dojo')
on conflict (character_id, task_key) do nothing;

-- ---------------------------------------------------------------------------
-- 숙제 체크리스트 설정: 숨긴 숙제(예: 'dojo')
-- ---------------------------------------------------------------------------
create table if not exists public.homework_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  hidden_tasks text[] not null default '{}',
  updated_at timestamptz not null default now()
);

comment on table public.homework_prefs is '숙제 체크리스트 설정. hidden_tasks 에 있는 숙제는 카드를 숨깁니다';

drop trigger if exists homework_prefs_assign_user_id on public.homework_prefs;
create trigger homework_prefs_assign_user_id
  before insert or update on public.homework_prefs
  for each row execute function public.assign_user_id();

alter table public.homework_prefs enable row level security;
revoke all on table public.homework_prefs from anon, authenticated;
grant select, insert, update, delete on table public.homework_prefs to authenticated;
grant all on table public.homework_prefs to service_role;

drop policy if exists homework_prefs_select_own on public.homework_prefs;
create policy homework_prefs_select_own
on public.homework_prefs for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists homework_prefs_insert_own on public.homework_prefs;
create policy homework_prefs_insert_own
on public.homework_prefs for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists homework_prefs_update_own on public.homework_prefs;
create policy homework_prefs_update_own
on public.homework_prefs for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists homework_prefs_delete_own on public.homework_prefs;
create policy homework_prefs_delete_own
on public.homework_prefs for delete to authenticated
using ((select auth.uid()) = user_id);
