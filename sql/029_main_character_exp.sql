-- 이미 사용 중인 데이터베이스용입니다.
-- Supabase SQL Editor에 이 파일 전체를 붙여 넣고 Run 합니다.
-- 대표 캐릭터(모든 기기에서 같게), 캐릭터 현재 경험치, 캐릭터별 대표 사냥터를 저장할 칸을 만듭니다.
-- 이미 이 파일을 실행했다면 같은 파일을 다시 실행해도 됩니다.

-- ---------------------------------------------------------------------------
-- 대표 캐릭터: 로그인 계정마다 한 줄인 profiles 에 둡니다.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists main_character_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_main_character_id_fkey') then
    alter table public.profiles
      add constraint profiles_main_character_id_fkey
      foreign key (main_character_id) references public.characters (id) on delete set null;
  end if;
end $$;

comment on column public.profiles.main_character_id is '대표 캐릭터. 홈과 헤더 프로필에 보입니다. 캐릭터를 지우면 비워집니다.';

-- 예전에 가입해 profiles 줄이 없는 계정이 있으면 만들어 둡니다(화면은 update 만 합니다).
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 캐릭터 현재 경험치와 대표 사냥터
-- ---------------------------------------------------------------------------
alter table public.characters
  add column if not exists exp numeric(40, 0),
  add column if not exists main_hunt_id uuid;

alter table public.characters drop constraint if exists characters_exp_check;
alter table public.characters
  add constraint characters_exp_check check (exp is null or exp >= 0);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'characters_main_hunt_id_fkey') then
    alter table public.characters
      add constraint characters_main_hunt_id_fkey
      foreign key (main_hunt_id) references public.hunts (id) on delete set null;
  end if;
end $$;

comment on column public.characters.exp is '현재 레벨에서 쌓은 경험치. 비어 있으면 입력하지 않은 것입니다.';
comment on column public.characters.main_hunt_id is '남은 시간 계산에 쓸 대표 사냥 기록. 비어 있으면 이 캐릭터의 가장 좋은 기록을 씁니다.';

-- ---------------------------------------------------------------------------
-- 본인 것만 가리키게: 다른 사람의 캐릭터·사냥 기록 id 를 넣지 못하게 막습니다.
-- ---------------------------------------------------------------------------
create or replace function public.check_profile_main_character()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.main_character_id is not null and not exists (
    select 1 from public.characters c
    where c.id = new.main_character_id and c.user_id = new.id
  ) then
    raise exception '본인 캐릭터만 대표로 고를 수 있습니다.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_check_main_character on public.profiles;
create trigger profiles_check_main_character
  before insert or update of main_character_id on public.profiles
  for each row execute function public.check_profile_main_character();

create or replace function public.check_character_main_hunt()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.main_hunt_id is not null and not exists (
    select 1 from public.hunts h
    where h.id = new.main_hunt_id and h.user_id = new.user_id
  ) then
    raise exception '본인 사냥 기록만 대표 사냥터로 고를 수 있습니다.';
  end if;
  return new;
end;
$$;

drop trigger if exists characters_check_main_hunt on public.characters;
create trigger characters_check_main_hunt
  before insert or update of main_hunt_id on public.characters
  for each row execute function public.check_character_main_hunt();

revoke all on function public.check_profile_main_character() from public, anon;
revoke all on function public.check_character_main_hunt() from public, anon;
grant execute on function public.check_profile_main_character() to authenticated, service_role;
grant execute on function public.check_character_main_hunt() to authenticated, service_role;
