-- 사냥 기록 실측값(2026-11-09).
-- 파풀라투스처럼 한 판 경험치는 고정이고 걸리는 시간이 사람마다 다른 기록을 그대로 남기려고,
-- 1시간 환산값(exp_per_hour 등) 옆에 실제로 걸린 시간과 얻은 양을 함께 저장합니다.
-- 화면은 실측값이 있으면 그것으로 1분·15분·1시간 값을 다시 계산하고, 없으면(예전 기록) 1시간 값을 비례해 바꿉니다.
-- 기존 기록은 바꾸지 않습니다(새 칸은 비어 있음). 같은 파일을 다시 실행해도 안전합니다.

alter table public.hunts add column if not exists measured_seconds integer;
alter table public.hunts add column if not exists exp_gain numeric(40, 0);
alter table public.hunts add column if not exists meso_gain numeric(40, 0);

comment on column public.hunts.measured_seconds is '실제로 잰 시간(초). 비어 있으면 1시간 기준으로만 적은 기록';
comment on column public.hunts.exp_gain is '잰 시간 동안 얻은 경험치';
comment on column public.hunts.meso_gain is '잰 시간 동안 얻은 메소(쩔비·물약 제외)';

alter table public.hunts drop constraint if exists hunts_measured_seconds_check;
alter table public.hunts
  add constraint hunts_measured_seconds_check
  check (measured_seconds is null or (measured_seconds between 1 and 86400));

alter table public.hunts drop constraint if exists hunts_exp_gain_check;
alter table public.hunts
  add constraint hunts_exp_gain_check
  check (exp_gain is null or exp_gain >= 1);

-- 시간과 경험치는 함께 있거나 함께 비어 있어야 환산할 수 있습니다. 메소는 시간이 있을 때만 적습니다.
alter table public.hunts drop constraint if exists hunts_measured_pair_check;
alter table public.hunts
  add constraint hunts_measured_pair_check
  check (
    (measured_seconds is null and exp_gain is null and meso_gain is null)
    or (measured_seconds is not null and exp_gain is not null)
  );
