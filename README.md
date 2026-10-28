# Your Maple

개인용 메이플스토리 정보와 메모를 저장하는 웹앱입니다.  
데이터는 Supabase에 저장됩니다. 캐릭터·거래 등 개인 기록은 본인만 볼 수 있고, 몬스터·아이템 공용 도감은 로그인 없이 조회할 수 있습니다.

## 구성

- 화면: HTML, CSS, JavaScript
- 로그인과 데이터베이스: Supabase
- 주소로 공개: GitHub Pages
- 별도의 유료 서버는 사용하지 않습니다.

## 폴더

```text
index.html              화면의 시작 파일
css/styles.css          공통 디자인
js/main.js              앱 시작
js/routes.js            왼쪽 메뉴 목록
js/router.js            메뉴 이동
js/ui.js                레이아웃, 다크 모드
js/auth.js              로그인 (STEP 3)
js/supabase-client.js   DB 연결 (STEP 3)
js/config.example.js    설정 예시
js/config.js            내 설정. GitHub에 올리지 않음
js/pages/               메뉴별 화면
sql/001_schema.sql      테이블 생성
sql/002_rls.sql         사용자별 접근 권한
sql/003_check.sql       권한이 켜졌는지 확인
sql/004_accounts_and_monsters.sql  계정과 몬스터로 바꾸는 추가 작업
.github/workflows/pages.yml  GitHub Pages 배포
```

## 데이터베이스 만들기

Supabase SQL Editor에서 아래 순서대로 파일 전체를 붙여 넣고 Run 합니다.

1. `sql/001_schema.sql`
2. `sql/002_rls.sql`
3. `sql/003_check.sql` 로 결과 확인

이미 001과 002를 실행했다면, 그 파일을 다시 실행하지 말고 `sql/004_accounts_and_monsters.sql` 만 실행합니다.

004까지 이미 실행했다면 `sql/005_glance_columns.sql` 만 실행합니다. 퀘스트 필요 재료와 몬스터의 1경험치당 HP 칸을 추가합니다.

005까지 이미 실행했다면 `sql/006_trades.sql` 만 실행합니다. 아이템/시세 표를 지우고 거래 내역 표를 만듭니다. 시세에 적어 둔 내용은 삭제됩니다.

006까지 이미 실행했다면 `sql/007_quest_duration.sql` 만 실행합니다. 퀘스트에 진행 시간 칸을 추가합니다.

007까지 이미 실행했다면 `sql/008_jobs.sql` 만 실행합니다. 직업 표를 만들고, 캐릭터에 적어 둔 직업을 그 목록에 연결합니다. 이미 이 파일을 실행했다면 같은 파일을 다시 실행합니다. 소울마스터, 나이트워커, 윈드브레이커, 플레임위자드, 스트라이커, 배틀메이지가 추가됩니다.

007까지 이미 실행했다면 `sql/008_hunts.sql` 만 실행합니다. 1시간 사냥 기록과 레벨별 필요 경험치 표를 만듭니다.

008까지 이미 실행했다면 `sql/009_quest_material_cost.sql` 만 실행합니다. 퀘스트에 재료비 칸을 추가합니다.

009까지 이미 실행했다면 `sql/010_hunt_memo.sql` 만 실행합니다. 사냥 기록에 메모 칸을 추가합니다.

010까지 이미 실행했다면 `sql/011_hunt_title.sql` 만 실행합니다. 사냥 이름 칸을 추가하고, 메모에 적어 둔 사냥 이름을 그 칸으로 옮깁니다.

011까지 이미 실행했다면 `sql/013_hunt_leech_fee.sql` 만 실행합니다. 사냥 기록에 1시간 쩔비 칸을 추가합니다.

013까지 이미 실행했다면 `sql/014_monster_elements.sql` 만 실행합니다. 몬스터에 속성 약점과 속성 반감 칸을 추가합니다. 이미 이 파일을 실행했다면 같은 파일을 다시 실행합니다.

014까지 이미 실행했다면 `sql/015_hunt_leech_signed.sql` 만 한 번 실행합니다. 쩔비는 받으면 양수, 내가 내면 음수로 저장됩니다. 예전에 양수로 저장된 쩔비는 음수로 바뀝니다. 받는 쩔비를 양수로 저장한 뒤에는 이 파일을 다시 실행하지 않습니다.

015까지 이미 실행했다면 `sql/016_dojo.sql` 만 실행합니다. 무릉도장 층별 시간과 허리띠 시세 표를 만듭니다. 이미 이 파일을 실행했다면 같은 파일을 다시 실행합니다.

016까지 이미 실행했다면 `sql/017_dojo_actual_minutes.sql` 만 실행합니다. 무릉 기록에 실제 한 바퀴 시간 칸을 추가합니다. 이미 이 파일을 실행했다면 같은 파일을 다시 실행합니다.

017까지 이미 실행했다면 `sql/018_dojo_character_runs.sql` 만 실행합니다. 캐릭터마다 구간 시간을 하나로 두고, 참고별로 실제로 돈 초를 저장합니다. 이미 이 파일을 실행했다면 같은 파일을 다시 실행합니다.

018까지 이미 실행했다면 `sql/019_dojo_party.sql` 만 실행합니다. 같은 캐릭터의 개인과 팀 구간 시간을 따로 둡니다. 이미 이 파일을 실행했다면 같은 파일을 다시 실행합니다.

019까지 이미 실행했다면 `sql/020_boss_runs.sql` 만 실행합니다. 캐릭터에 피아누스와 파풀라투스 도전 시각 칸을 추가합니다. 이미 이 파일을 실행했다면 같은 파일을 다시 실행합니다.

020까지 이미 실행했다면 `sql/021_rift_fragment.sql` 만 실행합니다. 캐릭터에 차원의 균열 조각 획득 시각 칸을 추가합니다. 파풀라투스와 같이 기록한 시각부터 1일 뒤에 다시 얻을 수 있습니다. 이미 이 파일을 실행했다면 같은 파일을 다시 실행합니다.

021까지 이미 실행했다면 `sql/022_links.sql` 만 실행합니다. 다시 열고 싶은 주소를 저장하는 링크 표를 만듭니다. 이미 이 파일을 실행했다면 같은 파일을 다시 실행합니다.

022까지 이미 실행했다면 `sql/023_character_quests_hidden.sql` 만 실행합니다. 캐릭터에 퀘스트 표에서 빼기 칸을 추가합니다. 이미 이 파일을 실행했다면 같은 파일을 다시 실행합니다.

023까지 이미 실행했다면 `sql/026_character_face.sql` 만 실행합니다. 캐릭터 얼굴 사진을 저장할 칸과 저장 공간을 만듭니다. 이미 이 파일을 실행했다면 같은 파일을 다시 실행합니다.

026까지 이미 실행했다면 `sql/027_maker.sql` 만 실행합니다. 메이커 계산에 쓰는 보석·크리스탈의 원석·하급·중급·상급 시세 기록 표를 만듭니다. 이미 이 파일을 실행했다면 같은 파일을 다시 실행합니다.

027까지 이미 실행했다면 `sql/028_enhance_profiles.sql` 만 실행합니다. 사용자별 강화 계산 아이템 프로필을 저장하는 표를 만듭니다. 화면에서는 현재 5개까지 등록하지만 데이터베이스에는 개수 제한을 두지 않습니다.

028까지 이미 실행했다면 `sql/029_main_character_exp.sql` 만 실행합니다. 대표 캐릭터(모든 기기에서 같게), 캐릭터 현재 경험치, 캐릭터별 대표 사냥터를 저장할 칸을 만들고, 본인 캐릭터·사냥 기록만 고를 수 있게 막습니다. 이미 이 파일을 실행했다면 같은 파일을 다시 실행합니다.

029까지 이미 실행했다면 `sql/030_homework.sql` 만 실행합니다. 숙제 체크리스트에 직접 추가한 숙제 목록과, 캐릭터마다 숙제(무릉도장·직접 추가한 숙제)를 끝낸 시각을 저장하는 표를 만듭니다. 보스 숙제는 캐릭터 표의 도전 시각을 그대로 씁니다. 이미 이 파일을 실행했다면 같은 파일을 다시 실행합니다.

030까지 이미 실행했다면 `sql/031_homework_members.sql` 만 실행합니다. 숙제 체크리스트에서 무릉도장·직접 추가한 숙제마다 표시할 캐릭터와 숨긴 숙제를 저장하는 표를 만들고, 처음 한 번은 지금처럼 모든 캐릭터가 보이도록 채웁니다. 이미 이 파일을 실행했다면 같은 파일을 다시 실행합니다.

031까지 이미 실행했다면 `sql/032_homework_dojo_points.sql` 만 실행합니다. 숙제 체크리스트 무릉도장 점수(캐릭터마다 오늘 점수·누적 점수)를 저장하는 표를 만듭니다. 이미 이 파일을 실행했다면 같은 파일을 다시 실행합니다.

032까지 이미 실행했다면 `sql/033_dojo_score_log.sql` 만 실행합니다. 무릉 통합 점수 기록(사용자가 적은 현재 통합 점수와 12,000점 초기화)을 쌓는 표를 만듭니다. 숙제 체크리스트는 이 기록으로 오늘 번 점수를 계산하고, 무릉 화면에서 날짜별 기록을 봅니다. 032의 표는 더 쓰지 않습니다. 이미 이 파일을 실행했다면 같은 파일을 다시 실행합니다.

033까지 이미 실행했다면 `sql/034_dojo_score_clear.sql` 만 실행합니다. 숙제 체크리스트 무릉 "오늘 초기화"(오늘 쌓은 점수만 0으로, 통합 점수는 그대로)를 기록할 수 있게 합니다. 이미 이 파일을 실행했다면 같은 파일을 다시 실행합니다.

034까지 이미 실행했다면 `sql/035_delete_my_account.sql` 만 실행합니다. 화면의 "내 계정 → 회원 탈퇴"가 부르는 함수(`delete_my_account`)를 만듭니다. 호출한 사용자 계정을 지우면 모든 표의 기록이 cascade 로 함께 지워집니다. 이미 이 파일을 실행했다면 같은 파일을 다시 실행합니다.

035까지 이미 실행했다면 `sql/036_account_deletion_grace.sql` 만 실행합니다(035를 안 했어도 이 파일만으로 됩니다). 회원 탈퇴를 7일 유예로 바꿉니다: "탈퇴 신청"은 `account_deletions` 에 한 줄만 남기고, 7일 안에 취소할 수 있으며, 7일이 지난 신청은 매일 03:00(UTC) pg_cron 작업이 계정을 지웁니다(기록은 cascade). 035의 즉시 삭제 함수는 화면에서 부르지 못하게 막습니다. 이미 이 파일을 실행했다면 같은 파일을 다시 실행합니다.

거래 저장·마지막 저장 취소를 사용하려면 `sql/037_trade_undo.sql`을 실행합니다. 기존 거래 표를 유지하고 원자적 저장·복원 함수를 추가합니다. 이미 실행했다면 같은 파일을 다시 실행해도 됩니다.

공용 몬스터·아이템 도감과 거래 옵션을 사용하려면 **`sql/038_shared_game_catalog.sql`을 운영자가 SQL Editor에서 전체 실행한 다음 앱을 배포**합니다. `catalog_monsters`·`catalog_items`는 모두 조회하고 운영자만 수정합니다. 기존 몬스터 원본은 보존·읽기 전용으로 두고, 이름별 수치 충돌은 비공개 `catalog_monster_reviews`에 남깁니다. 기존 거래는 기본값으로 유지하며 실제 옵션은 별도로 저장합니다. 상세 절차·검증·복구는 [공용 도감 운영 안내](docs/shared-catalog.md)를 따릅니다.

수집처 아이템·몬스터·드랍 확률 일괄 등록은 `sql/043_catalog_import.sql`과 생성된 데이터 SQL을 사용합니다. 전체 수집·재개·등록 순서는 [수집처 수집 안내](docs/collector-import.md)를 따릅니다. 기존 개인 기록은 삭제하지 않습니다.

이미 513개 아이템을 등록했다면 `sql/044_normalize_catalog_items.sql`을 SQL Editor에서 전체 실행합니다. 기존 아이템의 분류·레벨·성별·공격속도·판매가와 옵션/범위·착용조건·직업을 분리하며 UUID와 거래 참조는 유지합니다. 실행 중인 수집기는 그대로 두고 완료 후 수집 안내의 `--export-only` 명령으로 새 등록 SQL을 생성합니다.

개인 표는 본인 행만, 공용 도감은 `anon`·`authenticated` SELECT만 허용되고 모든 표의 RLS가 켜져 있어야 합니다.

## 운영자 몬스터 엑셀 등록

`sql/038_shared_game_catalog.sql` 적용 뒤 **`sql/039_monster_sheet_import.sql` 전체를 Supabase SQL Editor에서 실행**합니다. 이 파일만 실행하면 운영자 지정이 비어 있으므로 아무도 등록할 수 없습니다. 이후 SQL Editor에서 아래의 이메일 자리만 실제 운영자 이메일로 바꿔 실행합니다. 해당 계정은 먼저 소셜 로그인을 완료해 Auth에 있어야 하며 이메일이 인증되어 있어야 합니다. 개인정보를 채운 SQL은 공개 저장소에 저장하지 않습니다.

```sql
do $$
declare target uuid; matches integer;
begin
  select count(*), (array_agg(id))[1] into matches, target
  from auth.users where lower(email)=lower('운영자 이메일로 교체') and email_confirmed_at is not null;
  if matches<>1 then raise exception '인증된 운영자 계정을 하나만 찾을 수 있어야 합니다. 먼저 로그인과 이메일을 확인하세요.'; end if;
  insert into public.catalog_monster_import_admin(singleton,user_id,verified_email)
  select true,target,email from auth.users where id=target
  on conflict(singleton) do update set user_id=excluded.user_id,verified_email=excluded.verified_email;
end $$;
```

- 운영자는 한 계정만 지정됩니다. 이메일 문자열을 브라우저에서 비교하지 않고, 서버의 비공개 등록표에 Auth UUID와 지정 이메일을 연결하고 현재 인증 이메일도 대조합니다. 이메일이 바뀌면 권한이 차단됩니다. 사용자가 메타데이터를 바꿔도 권한을 얻지 못합니다. 운영자 계정을 삭제·재가입하면 새 UUID이므로 다시 지정해야 합니다. 해제는 SQL Editor에서 `delete from public.catalog_monster_import_admin;`로 처리합니다.
- 지정 후 그 계정으로 몬스터 도감을 다시 열면 **엑셀로 몬스터 등록** 버튼이 보입니다. 비로그인·일반 계정은 버튼이 없으며 서버 등록 요청도 차단합니다. 기존 공용 테이블의 브라우저 직접 쓰기는 계속 금지입니다. 이번 예외는 몬스터 일괄 추가 RPC에만 적용되며 아이템 도감 수정 권한은 열지 않습니다.
- `.xlsx`·UTF-8 `.csv`·`.tsv`의 첫 시트 또는 엑셀 복사/붙여넣기를 받습니다. 파일 2MB·최대500행입니다. 첫 줄은 `몹 이름 / 레벨 / HP / 경험치 / 명중률 / 1 경험치 당 HP / 드랍 템` 형태입니다. 비율 열은 생략해도 되고 입력값 대신 HP÷경험치로 계산합니다. 경험치0의 비율은 미정입니다. 나머지 입력 열의 수식은 값으로 변환한 뒤 올립니다.
- 미리보기에서 신규·빈 드랍 채우기·동일·충돌을 구분합니다. 040 적용 후에는 능력치가 같은 기존 몬스터의 빈 드랍도 채울 수 있으며 기존 값은 덮어쓰지 않습니다. 서버에서도 중복/숫자/범위/길이와 권한을 다시 검사하며 잘못된 행은 전체 요청을 롤백합니다. 서버에 추가 데이터가 생기면 미리보기와 실제 등록 개수가 다를 수 있으며 최종 결과를 표시합니다.
- 드랍 약어의 띄어쓰기는 별도 아이템 구분자이며 쉼표로 정규화해 저장합니다. X는 없음으로 처리합니다. 엑셀에서 필요 명중을 읽되 레벨별 추가 명중은 추측하지 않습니다. 기존 이름은 공백 제거 기준입니다. 서로 다른 뜻을 가진 같은 이름은 운영자 검토가 필요합니다.
- Excel 판독은 로컬에 포함한 SheetJS CE 0.20.3(`js/vendor/`, Apache-2.0)을 등록 시에만 불러옵니다. 파일 내용은 브라우저에서 읽고 검증된 행만 RPC에 전송합니다. 이미지 다운로드나 외부 사이트 수집은 포함하지 않습니다.
- 검증: `node js/monster-sheet.check.mjs`, `tools/monster-import-db.check.mjs`(PGLite), `tools/monster-import-ui.check.mjs`(Playwright/Chrome). 가짜 UI·임시 DB 결과는 실제 로그인 운영 검증을 대신하지 않습니다.

### 전체 몬스터 삭제 후 재등록 (2026-10-27 최종 요청)

**040·041은 이미 실행 완료(사용자 확인). 041은 다시 실행하지 않습니다.** 전체 초기화와 구 테이블 정리는 042만 실행합니다.

- **`sql/042_reset_monster_catalog.sql` 전체를 Supabase SQL Editor에서 실행**하면 공용 몬스터220개 전체를 비공개 백업 후 삭제합니다. 이름·능력치·드랍·이미지 연결 등 몬스터 행 전체가 비워집니다. 아이템 도감·거래·캐릭터·기존 개인 표는 삭제하지 않습니다. 확인 시 기존 개인 몬스터는0개였습니다.
- 초기화 대상은 현재 확인한 단일 등록분220개입니다. 개수나 등록 출처·시각이 달라지면 삭제하지 않고 중단합니다. 성공 후 같은 파일을 재실행해도 재등록한 몬스터를 지우지 않습니다.
- 041이 만든 `catalog_monster_drop_backups`의 원본 백업은 `catalog_monster_reset_rows`로 이관하고 값 일치를 검증한 뒤 구 테이블을 삭제합니다. 현재 드랍이 비어 있어도 최초 드랍 정보까지 보존됩니다. 원본은 비공개 `catalog_monster_reset_rows.row_data`에 보관하고 완료 표시는 `catalog_monster_reset_runs`에 남깁니다. 일반 사용자·익명 API는 백업을 읽거나 수정할 수 없습니다. `truncate cascade`는 사용하지 않습니다.
- 삭제 후 지정 운영자가 엑셀로 다시 등록합니다. 공백·쉼표마다 별도 드랍템으로 나누고 반복 아이템은 유지합니다. 이미 적용한040의 서버 정규화·빈 드랍 채우기 함수와039의 운영자 지정 표는 사용 중이므로 유지합니다.
- 2026-10-27 사용자040/041/042실행 후 운영 읽기로 원본백업440행 보존·구 백업테이블 제거·초기화 완료 기록과 신규 등록시각의 몬스터220개를 확인했습니다. 에이전트의 운영 DB 쓰기는 없으며, 화면 수정은 배포 진행 중입니다.

## 로그인 연결

1. `js/config.example.js` 를 복사해 `js/config.js` 를 만듭니다.
2. Supabase **Project Settings → API Keys** 에서 Project URL 과 Publishable key 만 붙여 넣습니다.
3. Secret key, service_role key 는 넣지 않습니다.
4. Authentication 에서 Email 로그인을 켜 둡니다. 개인용이면 Confirm email 을 끄면 가입 직후 바로 로그인됩니다.
5. Authentication → URL Configuration 의 Site URL 을 `http://127.0.0.1:5500` 으로 맞춥니다.

### Google·Discord 로그인과 로그인 없이 쓰기 (2026-10-19)

- 로그인하지 않아도 앱이 열립니다. 홈은 소개 화면이고, **레벨업 계산·메이커 계산·무릉도장(·강화 계산)** 은 로그인 없이 계산할 수 있습니다. 저장 버튼을 누르면 그때 로그인 화면으로 가고, 로그인하고 돌아오면 그 화면으로 돌아와 적던 값을 다시 채워 둡니다(저장은 다시 누름). 맡긴 값은 sessionStorage 에 30분 동안 둡니다(`js/session.js`).
- 캐릭터·숙제·사냥·퀘스트·거래·메모·링크는 내 기록 화면이라 로그인해야 열립니다(`js/routes.js` 의 `auth: true`).
- 로그인은 **Google·Discord만** 씁니다(2026-10-19 이메일·비밀번호 로그인 삭제 — 비밀번호를 보관하지 않음). 로그인 화면에는 "Google로 계속하기", "Discord로 계속하기"만 있습니다. 아래를 켜기 전에는 버튼을 누르면 무엇을 켜야 하는지 안내가 나옵니다.

0. **Sign In / Providers → User Signups → Allow new users to sign up** 을 켭니다. 꺼져 있으면 처음 오는 Google·Discord 계정이 "Signups not allowed for this instance"로 막힙니다. **Anonymous sign-ins 는 끕니다**(로그인 없이 둘러보기는 2026-10-19 삭제). **Email provider 도 끕니다**(이메일·비밀번호 로그인 삭제). 끄기 전에 Authentication → Users 에서 이메일로 가입한 기존 계정의 Identities 에 google 또는 discord 가 함께 있는지 확인합니다(없으면 그 계정으로 들어갈 수 없게 됨).
1. **URL Configuration**: Site URL 을 `https://yourmaple.kr` 로, Redirect URLs 에 `https://yourmaple.kr/**` 와 `http://127.0.0.1:5500/**` 를 넣습니다(로그인 뒤 돌아올 주소).
2. **Google**: Google Cloud Console → API 및 서비스 → 사용자 인증 정보 → OAuth 클라이언트 ID(웹 애플리케이션). 승인된 리디렉션 URI 에 `https://<프로젝트>.supabase.co/auth/v1/callback` 을 넣고, 받은 클라이언트 ID·보안 비밀을 Supabase 의 Google provider 에 넣습니다. OAuth 동의 화면도 만들어야 합니다.
3. **Discord**: Discord Developer Portal → New Application → OAuth2 → Redirects 에 같은 `.../auth/v1/callback` 을 넣고, Client ID·Client Secret 을 Supabase 의 Discord provider 에 넣습니다.

- 로그인은 PKCE 방식(`flowType: "pkce"`, `js/supabase-client.js`)이라 돌아올 때 주소에 `?code=` 가 붙고, 처리한 뒤 지웁니다(`#` 은 화면 주소로 씀).
- 회원 탈퇴는 헤더의 대표 캐릭터 메뉴 → "내 계정"(`js/account.js`)에서 합니다. 계정 이메일을 똑같이 적어야 신청되고, **7일 유예** 뒤 매일 예약 작업이 계정을 지웁니다(sql/036). 대기 중인 계정은 앱 대신 탈퇴 대기 화면만 보며(화면에서만 막음), 그 화면에서 탈퇴 취소나 로그아웃만 할 수 있습니다. 2026-10-19 즉시 삭제(sql/035)로 운영자 계정 기록을 잃은 뒤 바꿨습니다.
- 같은 이메일(예: 처음 가입한 이메일과 같은 Gmail)로 Google·Discord 로그인하면 Supabase 가 같은 계정에 자동으로 붙입니다(기존 이메일이 인증된 경우). 이메일이 다르면 계정이 따로 생깁니다.
- 클라이언트 보안 비밀은 Supabase 에만 넣고 이 저장소에는 넣지 않습니다.

몬스터 도감과 아이템 정보는 공용 데이터이므로 로그인하지 않아도 열립니다. 일반 사용자는 도감을 수정하지 못하며, 거래의 실제 옵션만 자신의 기록에서 수정합니다.

## 로컬에서 로그인 없이 확인하기 (?mock, 2026-10-20)

`127.0.0.1`·`localhost` 에서만 주소에 붙여 씁니다. 실제 Supabase 는 부르지 않고, 브라우저 안의 가짜 DB(`js/dev-mock.js`)로 엽니다. 운영 주소(yourmaple.kr)에서는 붙여도 무시합니다.

| 주소 | 상태 |
| --- | --- |
| `http://127.0.0.1:5500/?mock` | 샘플 캐릭터·숙제·무릉·메모가 있는 **로그인된 상태** |
| `http://127.0.0.1:5500/?mock=guest` | **로그인 전** 상태(계산기·저장 시 로그인 흐름 확인) |
| `http://127.0.0.1:5500/?mock=reset` | 샘플 데이터로 처음부터 |
| `http://127.0.0.1:5500/?mock=0` | 끄고 실제 Supabase 로 |

- 한 번 켜면 그 탭을 닫을 때까지 유지됩니다. 오른쪽 아래 **MOCK** 표시에서 로그인/로그아웃 상태 바꾸기, 샘플로 되돌리기, 끄기를 할 수 있습니다.
- 로그인 화면의 Google·Discord 버튼은 다른 사이트로 가지 않고 바로 "로그인된 상태"로 돌아옵니다(저장 → 로그인 → 입력값 복원 흐름 확인용).
- 적은 데이터는 이 브라우저 localStorage(`ym-mock-db`)에만 남습니다. 회원 탈퇴 같은 DB 함수는 실행하지 않고, 거래 저장 함수(`replace_my_trades`)만 단순하게 흉내 냅니다(다른 곳에서 바뀜 검사 없음).
- 화면·흐름 확인용입니다. RLS·실제 저장은 테스트용 Google 계정으로 실제 DB 에서 확인합니다.

## 키 구분

| 값 | 브라우저에 있어도 되나 | 저장소에 커밋하나 |
| --- | --- | --- |
| Project URL | 예 | 아니오. `js/config.js` 또는 GitHub Secret |
| Publishable key (`sb_publishable_...`, 예전 anon key) | 예. RLS가 켜져 있어야 함 | 아니오 |
| Secret key, service_role key | 절대 아니오 | 절대 아니오 |

공개용 키를 숨기는 것만으로는 데이터가 보호되지 않습니다.  
테이블마다 RLS를 켜고, `user_id`가 로그인한 사용자와 같을 때만 조회/수정/삭제가 되게 합니다.

## 로컬에서 화면 보기

`index.html`을 더블클릭하면 메뉴 스크립트가 막힐 수 있습니다. 아래처럼 주소로 엽니다.

```powershell
py -3 -m http.server 5500
```

`py` 가 없으면 `python -m http.server 5500` 을 사용합니다.  
브라우저에서 http://127.0.0.1:5500 을 엽니다. 터미널에 `Serving HTTP` 가 보이는 동안만 사이트가 열립니다.

## 인터넷 주소로 열기

GitHub 저장소는 공개이고, 데이터는 Supabase에 남습니다.  
`js/config.js` 는 저장소에 올리지 않습니다. 배포할 때 GitHub Secret 두 개로 만듭니다.

- `SUPABASE_URL`: `https://....supabase.co`
- `SUPABASE_PUBLISHABLE_KEY`: Publishable key

Secret key 는 Secret 에도 넣지 않습니다.

- 배포 주소는 `https://yourmaple.kr` 입니다. 예전 주소 `https://beatmejy.github.io/yourmaple/` 로 들어오면 GitHub 가 새 주소로 옮겨 줍니다.
- Supabase **Authentication → URL Configuration** 의 Site URL 은 `https://yourmaple.kr` 입니다.
- Redirect URLs 에는 `https://yourmaple.kr/**` 와 `http://127.0.0.1:5500` 을 함께 넣습니다.

### 도메인 (yourmaple.kr)

- 가비아에서 구입했고 DNS 도 가비아에서 관리합니다.
  - `@` A 레코드 4개: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` (GitHub Pages 서버)
  - `www` CNAME: `beatmejy.github.io`
  - TXT `_github-pages-challenge-beatmeJY`: GitHub 계정의 도메인 소유 인증용. 지우지 않습니다.
- 저장소 Settings → Pages 의 Custom domain 은 `yourmaple.kr`, Enforce HTTPS 는 켜 둡니다. Actions 배포라 `CNAME` 파일은 두지 않습니다.
- 주소가 바뀌면 로그인 상태와 다크 모드 같은 브라우저 저장값은 새로 시작합니다. 데이터는 Supabase 에 있어 그대로입니다.


## 공개 페이지와 Google Search Console

홈의 메타 설명·Open Graph·Twitter 카드는 `index.html`에서 관리합니다. 공유 카드는 기존 180×180 로고를 쓰는 `summary` 형식입니다. 로그인 없이 읽는 정책 문서는 `privacy.html`·`terms.html`, 전용 스타일은 `css/public.css`입니다. 정책 링크를 로그인 화면에 연결하는 작업은 별도로 진행합니다.

### 공개 전 정책 확인

- 정책 문서는 **공개 준비용 초안**입니다. 문의 이메일과 Supabase 서울 리전은 반영했지만, 시행일·수탁자 법인·국외 처리의 국가/항목/목적/시점/방법/보유기간/법적 근거/거부 절차와 로그·백업 보존기간을 실제 계약·설정 기준으로 확정해야 합니다. 서울 DB 리전만으로 인증·지원 등의 처리가 모두 국내라고 판단하지 않습니다.
- 현재 탈퇴 버튼이나 삭제 API는 없습니다. 정책은 운영자에게 요청하는 방식으로 안내합니다. 공개 전에 요청 접수 → 본인 확인 → Storage 이미지 삭제 → 사용자 데이터·Auth 계정 삭제 → 결과 안내 절차를 테스트하세요. `auth.users` 외래 키의 CASCADE만으로 Storage 파일까지 삭제되지는 않습니다. 관리자 키는 브라우저에 넣지 않습니다.
- 임시 계정 로그아웃과 소셜 앱 연결 해제는 탈퇴·서버 데이터 삭제가 아닙니다.
- 실제 삭제·로그/백업 보존·국외 처리 안내를 확정한 뒤, 두 페이지의 초안 안내를 제거하고 시행일을 표시하세요.
- 공식 근거: [개인정보 처리방침 규정](https://law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029332499), [Supabase 사용자 삭제](https://supabase.com/docs/guides/auth/managing-user-data), [Supabase 데이터 처리 계약](https://supabase.com/legal/customer-resources/data-processing-addendum).

### 가비아 DNS TXT로 도메인 소유권 확인

1. [Google Search Console](https://search.google.com/search-console/) → 속성 추가 → **도메인**에 `yourmaple.kr`을 입력합니다(`https://`나 경로는 넣지 않음).
2. Google이 발급한 TXT 값 `google-site-verification=…`을 복사합니다. 임의 예시 값으로 등록하면 인증되지 않습니다.
3. 가비아 My가비아 → DNS 관리 도구 → `yourmaple.kr` 설정 → 레코드 추가에서 **타입 TXT / 호스트 @ / 값은 Google이 준 전체 문자열**로 저장합니다. TTL은 기본값을 사용합니다. 화면 이름은 가비아 UI 변경에 따라 다를 수 있습니다.
4. 기존 A 4개, `www` CNAME, `_github-pages-challenge-beatmeJY` TXT는 수정·삭제하지 않습니다. 새 TXT 레코드를 추가하는 작업입니다.
5. DNS 반영 후 Search Console에서 확인합니다. 바로 확인되지 않으면 전파를 기다린 뒤 재시도합니다. 인증 후에도 TXT를 유지합니다. 필요하면 `dig TXT yourmaple.kr +short`로 값이 보이는지 확인합니다.
6. 이 변경을 **배포한 뒤**, 사이트맵 메뉴에서 `https://yourmaple.kr/sitemap.xml`을 제출합니다. 홈·`privacy.html`·`terms.html`의 URL 검사에서 실제 페이지 확인 후 필요한 URL의 색인을 요청합니다.

`robots.txt`는 크롤링을 허용하고 사이트맵 위치를 안내합니다. 접근 제어나 개인정보 보호 수단이 아닙니다. 사이트맵에는 공개된 정규 URL 세 개만 넣고 `#/homework` 같은 해시 화면, OAuth 콜백·코드·토큰 URL이나 개인 기록은 넣지 않습니다. 현재 해시 SPA의 개별 기능 검색 노출을 보장하지 않습니다. Search Console 등록·사이트맵 제출도 색인이나 검색 순위를 보장하지 않습니다.

배포 설정은 새 정적 파일도 `_site`에 복사합니다. 코드 작성과 Google 계정의 소유권 확인은 별개이며, 이번 변경만으로 Search Console에 자동 등록되지 않습니다.

공식 안내: [DNS TXT 소유권 확인](https://support.google.com/webmasters/answer/9008080), [사이트맵 작성](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap), [URL 구조와 해시](https://developers.google.com/search/docs/crawling-indexing/url-structure).


## 거래의 마지막 저장 취소

`sql/037_trade_undo.sql`을 Supabase SQL Editor에서 실행하세요(재실행 가능). 매수·매도·통합·목록 직접 수정 저장을 한 트랜잭션으로 처리하며, 같은 화면에서 마지막 성공 저장 1건을 취소할 수 있습니다. 합산 전 수량·평균가·등록/수정 시각도 복원합니다. 이후 다른 곳에서 수정된 거래는 덮어쓰지 않습니다. 새로고침·페이지 이동 시 취소 기록은 사라지고, 명시적인 삭제는 취소 대상이 아닙니다.

## 아이템 외부 자료 시험 수집

운영 DB를 건드리지 않는 아이템 시험 수집기(드랍 기반10개 또는 ID순 최대100개)와 검토용 JSON은 [아이템 시험 수집 안내](data/imports/SAMPLE-ITEMS.md)를 참고합니다. 이미지 URL만 수집하며, 메이플랜드 자료 검증과 DB 등록은 별도 단계입니다.

- `sql/045_clear_legacy_monster_drops.sql`: 기존 수동 드랍 문자열 폐기(복구 원문 비공개 보관), 몬스터·아이템·거래·새 수집 드랍 유지. SQL Editor에서 전체 실행합니다.

043~045 실행 후 수집 데이터 자동 등록은 `python3 -B tools/import_collector_db.py`로 실행합니다. 최초 `brew install libpq` 필요. [접속 정보 입력·재개 안내](docs/collector-import.md#권장-터미널에서-한-번에-자동-등록-2026-10-28)를 참고하세요.

- `sql/046_catalog_cleanup.sql`: 수동220행 비공개 보관 후 수집 원본으로 통일, 접미사 제거·외부ID 갱신·드랍 문자열 컬럼/빈 구 monsters 폐기. **새 몬스터 화면을 배포한 뒤 SQL Editor에서 실행**합니다. 전체 수집 데이터는 이미 운영 등록돼 재등록 불필요. 현재 기준은 [수집/정리 안내](docs/collector-import.md) 머리말과046 절입니다.
