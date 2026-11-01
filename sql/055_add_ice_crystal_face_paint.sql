-- SQL Editor 또는 DBeaver 쓰기 연결에서 전체 실행합니다(재실행 가능).
-- 도감에 없던 얼음결정 페이스페인팅(외부 ID 1012281)을 추가합니다(2026-10-30 사용자 요청·사용자 제공 옵션).
-- 옵션은 메이플랜드 밸런스 패치 후 값(사용자 제공): 착용 레벨 90, 전 직업, 얼굴장식, STR·DEX·INT·LUK +3, HP·MP +30,
-- 업그레이드 가능 횟수 3, 1회 교환 가능. 옵션 범위(사용자 제공): STR·DEX·INT·LUK 2~4, HP·MP 20~40.
-- 그림은 다른 도감 아이템과 같은 공개 게임 데이터 주소.
-- 다른 수집 아이템과 같은 형식(source 'collected')으로 넣어 정규화 트리거가 착용 조건·직업·옵션 관계표를 만듭니다.
-- 이미 같은 외부 ID가 있으면 아무것도 바꾸지 않습니다.
begin;
select pg_advisory_xact_lock(20261028,43);

do $$ begin
  if exists (select 1 from public.catalog_items where source='collected' and source_id='1012281') then
    return;
  end if;
  perform set_config('yourmaple.release_label', '얼음결정 페이스페인팅 추가', true);
  insert into public.catalog_items(name, category, base_options, requirements, image_url, source, source_id, source_data)
  values (
    '얼음결정 페이스페인팅',
    '장비',
    '{"str":3,"dex":3,"int":3,"luk":3,"hp":30,"mp":30,"remaining_upgrades":3}'::jsonb,
    '{"level":90,"str":0,"dex":0,"int":0,"luk":0,"fame":0,"REQ JOB":"공용","GENDER":"공용"}'::jsonb,
    'https://maplestory.io/api/gms/200/item/1012281/icon?resize=2',
    'collected',
    '1012281',
    jsonb_build_object(
      'categories', jsonb_build_object('대분류', '장비', '중분류', '장신구', '소분류', 'Face Accessory'),
      'option_ranges', '{"str":{"min":2,"max":4},"dex":{"min":2,"max":4},"int":{"min":2,"max":4},"luk":{"min":2,"max":4},"hp":{"min":20,"max":40},"mp":{"min":20,"max":40}}'::jsonb,
      'other_effects', '[]'::jsonb,
      'description_text', '1회 교환 가능(거래 후 교환 불가)',
      'manual_entry', jsonb_build_object('by', 'operator', 'at', '2026-10-30', 'note', '메이플랜드 밸런스 패치 후 옵션(사용자 제공)')
    )
  );
end $$;

update public.catalog_revision set revision=revision+1, updated_at=now() where singleton;
insert into catalog_import_private.completed_migrations(name) values('055_add_ice_crystal_face_paint') on conflict do nothing;
commit;
