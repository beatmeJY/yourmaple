-- 063 이후 SQL Editor 또는 DBeaver 쓰기 연결에서 전체 실행합니다(재실행 가능).
-- 사용자 확인 규칙: 리버스 장비 3회, 타임리스 장비 5회. 강화 가능 횟수와는 별도입니다.
begin;
select pg_advisory_xact_lock(20261028, 43);
select set_config('yourmaple.release_label', '리버스·타임리스 장비 레벨업 횟수 보완', true);

-- 공용 도감 장비만 수정합니다. 이름에 같은 단어가 들어간 소비/재료는 제외합니다.
-- 기존 도감 변경 이력 트리거가 이전 값과 변경 값을 남깁니다.
update public.catalog_items
set level_up_count = case when name like '리버스%' then 3 else 5 end
where category in ('장비', '방어구', '무기', 'Equip')
  and (name like '리버스%' or name like '타임리스%')
  and level_up_count is distinct from case when name like '리버스%' then 3 else 5 end;

-- 반영 결과를 확인합니다. 공개 상세 화면도 이 컬럼을 그대로 읽습니다.
select id, name, category, level_up_count
from public.catalog_items
where category in ('장비', '방어구', '무기', 'Equip')
  and (name like '리버스%' or name like '타임리스%')
order by name, id;
commit;
