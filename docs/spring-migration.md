# 스프링 서버 이전 목록

2026-11-01 (Claude) 사용자 요청으로 만들었다 [진술]. Your Maple은 지금 브라우저 + Supabase(Postgres·인증·저장소)만으로 돌아가서, 서버에서 해야 할 일이 DB 함수·트리거·예약 작업·Edge Function에 흩어져 있다. 나중에 스프링 서버로 옮길 때 빠뜨리지 않도록 **어디에 무엇이 있는지**를 한곳에 적는다.

- 원칙: 화면 규칙·계산은 지금처럼 `js/*-calc.js`에 두고, **여러 행을 한 번에 바꾸는 작업·관리자 권한이 필요한 작업·예약 작업**을 스프링으로 옮긴다. 데이터 무결성 제약(본인 행만, 계정과 캐릭터 연결 확인)은 DB에 남겨도 된다.
- 새 서버 작업을 DB 함수·트리거·Edge Function으로 만들면 **이 문서에 한 줄 추가**한다. 옮긴 항목은 지우지 말고 "이전 완료"와 날짜를 적는다.
- 위치 표기: `sql/NNN`은 그 함수를 마지막으로 정의한 파일까지 함께 적는다. 운영 DB 기준은 가장 마지막 파일이다.

## 1. 먼저 옮길 것 (서버 작업·비즈니스 로직)

| # | 기능 | 지금 위치 | 하는 일 | 호출하는 곳 | 옮길 때 메모 |
| --- | --- | --- | --- | --- | --- |
| 1 | 탈퇴 계정 삭제 | Edge Function `supabase/functions/purge-account-deletions`(`purge.js`), 예약 `sql/056`(pg_cron→pg_net, Vault `project_url`·`cron_secret`, 함수 비밀 `CRON_SECRET`, Verify JWT 끔) | 7일 유예가 지난 계정: 얼굴 이미지 파일을 Storage API로 삭제 → 인증 계정 삭제(기록 cascade) → 고아 이미지 폴더 정리 | 매일 03:00 UTC(한국 정오) pg_cron | 스프링 `@Scheduled` + Supabase Admin API(deleteUser)·Storage API. 검사 `purge.check.mjs`의 경우를 그대로 옮긴다. 옮긴 뒤 cron 작업 `yourmaple-purge-account-deletions`·Edge Function·Vault 비밀·함수 비밀 `CRON_SECRET` 정리 |
| 2 | 탈퇴 신청·취소 | 표 `account_deletions` + 트리거 `account_deletions_fix_times`(`sql/036`) | 신청 시각·삭제 예정 시각(7일 뒤)을 서버가 정함 | `js/account.js`(insert/delete) | 스프링 API로 신청·취소, 삭제 예정 시각은 서버가 계산. 예전 `purge_account_deletions()`(`sql/036`, 이미지 파일을 남기는 SQL 삭제)는 `sql/056`에서 실행 권한을 막아 둠 → 이전 때 함수 삭제. `delete_my_account()`(`sql/035`, 즉시 삭제)도 권한 회수 상태 → 삭제 |
| 3 | 거래 저장·마지막 저장 취소 | `replace_my_trades_v2`(`sql/038`), `replace_my_trades`(`sql/037`) | 매수·매도·합산을 한 트랜잭션으로 바꾸고, 바로 앞 저장을 되돌림(충돌 확인 포함) | `js/pages/trades.js` | 스프링 트랜잭션 서비스. 충돌(그 사이 다른 곳에서 바뀜) 처리와 실제 옵션 분리 규칙 유지(`docs/shared-catalog.md`) |
| 4 | 운영자 몬스터 엑셀 등록 | `can_import_catalog_monsters`·`import_catalog_monsters`(`sql/039`·`040`·`046`), 비공개 운영자 표 | 지정 운영자만 몬스터 신규 추가, 동일·충돌은 보존 | `js/monster-import.js` | 스프링 관리자 API + 운영자 권한. 운영자 계정 식별 정보는 공개 저장소에 두지 않는다 |
| 5 | 도감 일괄 등록·변경 확인 | `import_catalog_batch`·`assert_catalog_release`(`sql/043`→`046`→`047`→`049`), 비공개 도구 `agent-context/projects/yourmaple/catalog-tools/` | 수집 자료를 외부 ID 기준으로 추가·갱신, 바뀐 내용만 반영, 반영 전 운영 DB가 기준과 같은지 확인 | 운영자 SQL·비공개 도구 | 스프링 배치. 수집처 이름·주소를 공개 저장소에 쓰지 않는 규칙 유지(AGENTS 6절). `scrub_json`(`sql/049`·`050`, 외부 링크·페이지 버튼 글자 정리)을 같은 규칙으로 옮긴다 |
| 6 | 도감 정규화 | 트리거 `catalog_item_columns`·`catalog_item_relations`(`sql/044`→`049`·`050`), `catalog_monster_columns`(`sql/052`), `catalog_import_private.monster_stat` | 원문(source_data)에서 분류·착용 조건·옵션 범위·직업·몬스터 전투 수치를 정식 컬럼·관계표로 풀기 | 도감 표 쓰기 때 자동 | 5번 배치 안에서 저장 전에 계산하도록 옮기면 트리거를 없앨 수 있다 |
| 7 | 도감 변경 이력 | 트리거 `record_catalog_change`(`sql/047`→`049`→`052`), 표 `catalog_changes`, 비공개 `change_backups` | 도감이 바뀔 때 공개 이력·비공개 원문 저장, 리비전 올리기 | 도감 표 쓰기 때 자동 | 5번 배치가 이력을 직접 남기도록. 공개 이력에서 숨기는 항목(source_url 등) 유지 |

- 2026-11-01 (Codex) 비공개 도감 검토 추가: `sql/057`의 `can_review_catalog`, `catalog_review_list/detail/save`, `catalog_review_private.reviewer/items/edits` → Spring 운영자 권한·검토 API와 트랜잭션으로 이전. 검증된 Google identity 연결·729개 비공개 범위·revision 충돌·비공개 수정 이력을 유지하고 공개 도감 반영은 별도 승인으로 둡니다. 호출은 `js/catalog-review.js`, `js/pages/catalog-review.js`입니다. [실측]

## 2. 조회 API (옮기면 좋은 것)

| 기능 | 지금 위치 | 메모 |
| --- | --- | --- |
| 아이템 검색 | `catalog_search_items`(`sql/047`→`054`) | 띄어쓰기 무시·글자 순서·별명(`catalog_search_aliases`) 규칙. 화면 쪽 같은 규칙 `js/search-match.js`(+ check)와 반드시 맞춘다 |
| 몬스터 검색 | `catalog_search_monsters`(`sql/047`→`048`) | 드랍 아이템으로 찾기 포함 |
| 아이템·몬스터 상세 | `catalog_item_detail`(`sql/047`→`049`), `catalog_monster_detail`(`sql/052`) | 공개 응답에 수집 주소를 넣지 않는다 |

호출: `js/catalog-api.js`(`catalogRpc`, 30초 캐시·리비전 확인). 스프링으로 옮기면 캐시를 서버에서 처리할 수 있다.

## 3. DB에 남겨도 되는 것 (무결성·보안)

옮기더라도 DB 제약으로 같이 두면 안전하다. 스프링이 **서비스 키로** DB에 붙으면 RLS를 건너뛰므로 "본인 데이터만" 규칙을 스프링에서도 반드시 검사한다.

- RLS 정책 전체와 도우미 `owns_account`·`owns_character`·`owns_quest`(`sql/002`)
- `assign_user_id`·`touch_updated_at`(`sql/001`, 각 표의 `*_assign_user_id`·`*_touch_updated_at` 트리거)
- `handle_new_user`(`sql/001`, 가입 시 프로필 행 생성) — 가입 처리를 스프링으로 옮기면 함께 옮김
- `enforce_character_account`(`sql/001`·`004`), `check_character_main_hunt`·`check_profile_main_character`(`sql/029`), `check_homework_character`(`sql/030`, 숙제·무릉 기록 표들의 `*_check_character`)
- `valid_item_options`(`sql/038`, 옵션 키·범위 확인)

## 4. 옮길 때 같이 챙길 것

- 비밀: 서비스 키는 스프링 환경 변수로만. 저장소·브라우저·대화에 남기지 않는다.
- 검사: `supabase/functions/purge-account-deletions/purge.check.mjs`, `js/search-match.check.mjs`, 비공개 `catalog-tools/tools/source-scrub-db.check.mjs`(049~055 실데이터 검증)를 스프링 테스트로 옮긴다.
- 정책 문서: 처리 위탁·국외 이전 표에 스프링 서버 호스팅 업체를 추가하고(`privacy.html` 03절), 삭제 주체가 바뀌면 05절 문구를 맞춘다.
- 화면 호출 주소: `rpc(...)`·`from(...)` 직접 호출을 스프링 API로 바꾸는 곳은 `js/account.js`, `js/pages/trades.js`, `js/monster-import.js`, `js/catalog-api.js`.

- 2026-11-01 (Codex) 검토 완료 즉시 공개: `catalog_review_save` 최신 정의 `sql/058` → Spring 관리자 발행 API에서 검토 revision 확인·공용 아이템 upsert·정규화/공개 이력·비공개 감사 이력을 한 트랜잭션으로 이전합니다. `p_publish=false` 초안/구 화면 호환·권한·재시도 멱등성·실패 전체 롤백을 유지합니다. 위 057의 별도 공개 승인 설명은 이 사용자 결정으로 대체합니다. [진술·실측]

- 2026-11-01 (Codex) 검토 목록 삭제/복구: `catalog_review_set_deleted`(`sql/058`) → 관리자 API에서 소프트 삭제·revision·비공개 감사 이력으로 이전, 공개 도감은 삭제하지 않습니다. [실측]

- 2026-11-04 (Codex) 아이템 상세 수정 `catalog_item_edit_detail/save`(`sql/059`) → Spring 관리자 조회/수정 API. Google 운영자 검증·행 버전 충돌(409)·공개 도감/정규화/이력/검토 버전 무효화 한 트랜잭션·UUID/관계 보존·비공개 검토 초안 보존을 유지합니다. 호출 `js/catalog-item-editor.js`, 공개 설명 렌더 `js/catalog-equipment.js`. [실측]
