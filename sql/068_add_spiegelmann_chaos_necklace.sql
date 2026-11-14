-- SQL061 이후 SQL Editor 또는 DBeaver 쓰기 연결에서 전체 실행합니다.
-- ID는 공개 게임 데이터와 같고, 기본 옵션과 강화 횟수는 메이플랜드 화면 기준입니다.
begin;
select pg_advisory_xact_lock(20261028, 43);
select set_config('yourmaple.release_label', '슈피겔만의 혼돈 목걸이 추가', true);

insert into public.catalog_items (
  name, category, base_options, requirements, image_url, source, source_id, source_data
)
values (
  '슈피겔만의 혼돈 목걸이',
  '장비',
  '{"str":1,"dex":1,"int":1,"luk":1,"attack":1,"magic_attack":1,"defense":27,"magic_defense":27,"remaining_upgrades":1}'::jsonb,
  '{"level":51,"str":0,"dex":0,"int":0,"luk":0,"fame":0,"REQ JOB":"공용","GENDER":"공용"}'::jsonb,
  'https://maplestory.io/api/gms/200/item/1122058/icon?resize=2',
  'collected',
  '1122058',
  '{"categories":{"대분류":"장비","중분류":"장신구","소분류":"Pendant"}}'::jsonb
)
on conflict (source, source_id) where source_id is not null do nothing;

insert into catalog_import_private.completed_migrations(name)
values ('068_add_spiegelmann_chaos_necklace') on conflict do nothing;
commit;
