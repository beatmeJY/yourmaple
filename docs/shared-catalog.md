# 공용 도감과 개인 거래

## 현재 기준 (2026-10-28, SQL046)

공용 원본은 catalog_monsters이며 구 개인 monsters는 0행 확인 후 폐기합니다. 수동220행은 비공개 백업 후 수집808행으로 대체, 이름 접미사 제거/외부ID별 갱신을 사용합니다. 드랍 문자열 컬럼은 제거하며 catalog_monster_drops의 아이템 FK를 조인해 이름·확률을 표시합니다. 이름은 식별자가 아니므로 같은 이름/다른 외부ID는 유지합니다. 새 화면 배포 후046을 실행해야 합니다. 이전 아래 설명은 이력이며 충돌 시 이 절이 우선합니다. [진술·실측]

2026-10-21 사용자 결정: 몬스터·아이템 기본 정보는 공용, 운영자는 SQL Editor에서 관리, 이름이 같고 값이 다른 몬스터는 검토 대기. [진술]

## 데이터 경계

- `catalog_monsters`: 공용 몬스터 기본 수치·속성·드롭·이미지·출처. user_id 없음, anon/authenticated SELECT만 허용.
- `catalog_items`: 공용 아이템 이름·분류·기본 옵션·착용 조건·이미지·출처. user_id 없음, anon/authenticated SELECT만 허용.
- `catalog_monster_reviews`: 이름별 충돌 원본과 검토 상태. RLS 활성, 브라우저 역할 권한/정책 없음. SQL Editor에서만 조회·처리.
- 기존 `monsters`: 원본 행·기존 소유권 RLS 보존. INSERT/UPDATE/DELETE 권한 회수, 새 앱은 조회하지 않음. user_id를 공용으로 공개하지 않음.
- `trades`: 계속 사용자별 RLS. item_id는 공용 아이템 참조, item_snapshot은 거래 당시 기본 정보 복사본, item_options는 실제 물건의 옵션. 가격·수량·옵션은 다른 사용자에게 공개하지 않음.

공용 아이템을 선택하면 기본 옵션을 입력칸에 채우지만 실제 값은 사용자가 바꿉니다. 옵션 미입력과 0은 다릅니다. 이름·도감 ID·스냅샷·실제 옵션이 다르면 거래를 합치지 않습니다. 아이템 정보가 없는 물건은 이름과 옵션을 직접 입력할 수 있습니다. 합산 상태·가격 계산 방식은 기존 규칙을 유지합니다. 도감 아이템은 거래에서 참조하면 삭제가 제한되며 이름·기본 정보 수정은 가능합니다.

## 적용 순서

1. 운영 SQL Editor에서 현재 monsters/trades를 CSV 또는 백업으로 보관합니다. 앱은 아직 배포하지 않습니다.
2. `sql/038_shared_game_catalog.sql` 전체를 한 번에 실행합니다. 파일 전체가 한 트랜잭션이며 실패하면 반영하지 않습니다. 001/002/006 같은 옛 파일을 다시 실행하지 않습니다.
3. 아래 검증 쿼리로 공용 개수·충돌을 확인합니다. SQL은 기존 monsters/trades 행을 삭제하지 않습니다. 기존 거래에는 item_id=null, snapshot/options={}가 붙습니다.
4. 운영 도감에 검증한 데이터를 추가합니다. 현재 외부 사이트 API는 보안 검사로 응답 구조를 확인하지 못했으므로 자동 수집은 포함하지 않습니다. 아이템 도감은 빈 상태여도 직접 입력 거래는 가능합니다.
5. 새 앱을 배포한 뒤 로그아웃 상태 도감 조회, 실제 로그인 거래 옵션 저장·재조회·취소와 계정 간 차단을 확인합니다. 운영 SQL 실행·실제 로그인 검증은 아직 별도 단계입니다.

```sql
select count(*) from public.catalog_monsters;
select name, reason, variants from public.catalog_monster_reviews where status='pending';
select count(*) from public.monsters; -- 원본 행 보존 확인
select count(*) from public.trades; -- 기존 거래 행 보존 확인
select tablename, policyname, roles, cmd from pg_policies
where schemaname='public' and tablename in ('catalog_monsters','catalog_items','catalog_monster_reviews','trades');
```

재실행 시 기존 도감 행은 덮어쓰지 않고 검토 처리 상태도 보존합니다. 같은 이름의 non-null 수치·드롭 문자열·속성 문자열이 다르면 보수적으로 충돌로 취급합니다. 단순 문자열 순서 차이도 검토할 수 있습니다. 없는 값만 서로 보완합니다. HP/EXP 비율은 복사하지 않고 DB 생성 칼럼으로 다시 계산합니다.

충돌 해결은 variants의 실제 출처를 확인한 뒤 운영자가 `catalog_monsters`에 명시적으로 INSERT/UPDATE하고 해당 reviews.status를 resolved로 바꿉니다. 이름만 보고 높은 HP나 최신 행을 정답으로 자동 선택하지 않습니다. 외부 도감의 별도 몬스터 ID는 source/source_id로 관리하며 동명 변형은 별도 명칭/식별 정책을 정한 뒤 추가합니다.

## 관리·출처

도감 쓰기용 비밀 키를 브라우저에 넣지 않습니다. 사이트 관리자 UI는 만들지 않았습니다. `source`·`source_id`·`source_url`로 원본을 추적하고 이미지·수치의 재사용 조건을 확인한 뒤 등록합니다. 드롭 아이템은 현재 텍스트를 유지하며, 외부 아이템 ID가 확보되기 전에 추측으로 공용 아이템과 연결하지 않습니다.

실제 거래 옵션은 정수 능력치(공격력/마력/STR/DEX/INT/LUK/HP/MP/방어/명중/회피/이동속도/점프/강화 횟수)입니다. DB와 화면 양쪽에서 타입·범위를 검증합니다. 자유 텍스트 JSON 편집은 제공하지 않습니다.

## 이전 버전과 복구

- 기존 RPC `replace_my_trades`는 새 필드 기본값을 인식하도록 갱신하고, 새 화면은 `replace_my_trades_v2`를 호출합니다. 038 미실행 상태에서 037 저장으로 우회해 옵션을 잃지 않게 합니다.
- 구버전 클라이언트가 새 옵션을 모르는 채 옵션 거래를 고치면 기대 상태 비교가 달라 거절합니다. metadata 없는 기존 거래는 기존 RPC로 계속 처리할 수 있습니다.
- 앱 롤백만으로 공용 도감 구조를 삭제하지 않습니다. 새 거래가 생긴 뒤 컬럼이나 함수를 예전 버전으로 덮어쓰면 옵션이 사라질 수 있습니다. 우선 앱을 유지보수 상태로 두고 백업과 원인을 확인합니다.
- 기존 몬스터 원본은 남아 있지만 공용 전환 이후 원본 쓰기는 막습니다. 복구 때도 모든 사용자에게 공용 도감 쓰기를 열지 않습니다.

## 검증 실행

```sh
node js/item-options.check.mjs
node js/catalog.check.mjs
# 임시 디렉터리에 @electric-sql/pglite 설치 후 모듈 경로를 지정합니다.
PGLITE_MODULE=/절대경로/node_modules/@electric-sql/pglite/dist/index.js node tools/shared-catalog-db.check.mjs
# Playwright와 Chrome 경로를 지정해 가짜 DB PC·모바일 화면을 검증합니다.
PLAYWRIGHT_MODULE=/절대경로/node_modules/playwright/index.mjs CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node tools/shared-catalog-ui.check.mjs
```

PostgreSQL 검증은 임시 DB에서 재실행·충돌 이전·원본 보존·공용 읽기/쓰기 차단·개인 RLS·옵션 저장/취소·스냅샷 독립·실패 롤백을 확인합니다. 가짜 DB 화면 검증은 실제 RLS 검증을 대체하지 않습니다.

## 변경 파일

- 스키마: `sql/038_shared_game_catalog.sql`
- 도감 조회: `js/catalog.js`, `js/pages/monsters.js`, `js/pages/item-catalog.js`, `js/record-page.js`
- 개인 거래 옵션·합산: `js/item-options.js`, `js/trade-merge.js`, `js/pages/trades.js`
- 라우팅·스타일·로컬 데이터: `js/routes.js`, `js/router.js`, `css/styles.css`, `js/dev-mock.js`
- 검증: `js/catalog.check.mjs`, `js/item-options.check.mjs`, `tools/shared-catalog-db.check.mjs`, `tools/shared-catalog-ui.check.mjs`
- 문서: `AGENTS.md`, `README.md`, `docs/domain.md`, `docs/shared-catalog.md`

## 운영자 엑셀 등록 예외 (2026-10-27)

사용자가 지정한 단일 계정에만 몬스터 일괄 추가를 허용합니다. 기존 SQL Editor 전용 원칙의 예외는 `sql/039_monster_sheet_import.sql`의 `import_catalog_monsters` RPC뿐입니다. 운영자 Auth UUID는 비공개 단일행 표에서 SQL Editor로만 관리하며, 서버가 로그인 UID와 인증된 계정인지 확인합니다. 브라우저 직접 INSERT/UPDATE/DELETE 및 아이템 도감 쓰기는 열지 않습니다. 이메일·UUID를 공개 파일에 넣지 않습니다. 운영 적용은 README의 039 실행·계정 지정 후 실제 운영자/일반 계정 검증 순서입니다. [진술·문서]

엑셀 입력은 `js/monster-sheet.js`, UI는 `js/monster-import.js`입니다. 새 이름만 추가하고 기존과 같은 값은 건너뛰며 다른 값은 보류합니다. 파일 안 중복 이름과 잘못된 숫자는 거절하고, 서버에서도 동일 검증과 전체 요청 롤백을 보장합니다. HP/EXP는 DB 생성 열로 유지하고, 입력 표의 반올림 비율과 레벨별 명중 증가값은 저장/추정하지 않습니다. [문서]

## 드랍 공백 구분·재등록·한정 초기화 (2026-10-27)

사용자 정정으로 드랍 칸의 공백은 개별 아이템 구분자입니다(위 설명 문자열 보존은 대체됨). 공통 `monster-drops.js`를 등록·미리보기·도감 표시·동일값 비교에 적용합니다. SQL040은 서버 정규화와 능력치가 같은 빈 드랍 채우기를 추가하며, 권한과 기존 비어 있지 않은 값 보존 원칙을 유지합니다. SQL041은 운영 조회로 확인한 단일 등록시각의220개만 비공개 백업 후 드랍만 초기화하는 일회성 SQL입니다. 같은 파일을 다시 실행해도 채운 드랍을 다시 지우지 않으며, 수정된 대상은 검사에서 중단합니다. 운영 DB는 읽기만 했고 두 파일은 사용자 실행 필요입니다. [실측·진술]

- 2026-10-27 사용자 최종 요청 [진술]: 드랍만 초기화하는 SQL041 계획을 취소하고 공용 몬스터 전체를 삭제 후 재등록한다. 운영 조회상 catalog_monsters220개·개인monsters0개·아이템0개·공용 몬스터 참조 FK 없음. SQL042로 전체 원본 비공개 백업·한 번만 삭제·재실행 시 새 등록 보존, 다른 도감/개인 데이터 미변경을 검증했다. 041은 실행하지 않으며 파일은 이력으로 보존한다. 운영 DB 쓰기 없음, 042는 사용자 직접 실행 필요. [실측]

- 2026-10-27 사용자 확인 [진술]: 040/041 실행 완료. 운영 읽기로 몬스터220개/드랍0개와 구 백업 존재 확인. SQL042를 보강해 041 원본 백업을 신규 비공개 백업에 이관·값 대조한 뒤 `catalog_monster_drop_backups`를 제거한다. 도감→구 백업 순서 잠금과 전체 트랜잭션으로 실패 시 이관/삭제를 함께 롤백한다. 임시DB 원본 드랍 보존·구 테이블 제거·재등록/재실행 검증 통과. 040 함수·039 운영자 표는 유지한다. 042는 운영 미실행. [실측]

- 2026-10-27 운영 읽기: 040함수 본문 일치·042백업440행/구표제거/완료기록·새등록220개 관측, 기존 데이터 보존. 에이전트 운영 쓰기 없음. [실측]

## 아이템 시험 수집 (2026-10-28)

- 사용자 요청으로 몬스터 드랍 샘플에서 중복/ID불일치를 제외한 아이템10개 상세를 공개 수집처 API에서 새로 조회했다. `tools/extract_sample_items.py`·선택파일·수집JSON·HEAD이미지조회결과, 설명은 `data/imports/SAMPLE-ITEMS.md`. 장비 필드만 명시적으로 매핑, 주문서 효과는 미제공으로 검토. 이미지URL10개 HTTP200/image/png, 파일별도저장 없음. 가짜DB 도감PC/모바일 검증, 운영DB/주요드랍 변경 없음. 공용 도감 mock insert 차단은 유지하고 검증fixture 준비 방식을 로컬저장소로 수정. 메이플랜드검증·SQL등록·커밋·배포 미진행 [실측·진술].

- 2026-10-28 사용자 설명 [진술]: 기존 직접입력 드랍은 수익성 있는 주요드랍만 기록한 것으로 전체목록이 아니다. 외부 전체드랍과 일치하지 않는다고 사용자값을 덮어쓰지 않는다. 향후 주요드랍과 아이템ID 기반 전체드랍을 별도로 연결한다.

- 2026-10-28 (Codex) 아이템 ID순100개 수집 완료(전체목록15599·4페이지): 중복0·실패0·옵션미제공2개검토, cash=1 92개 포함. 목록/상세재개·오류기록·요약 지원 수집기와 검사14개, 직접실행은 data/imports/SAMPLE-ITEMS.md. 이미지URL만저장(100개HTTP검사는미수행), 운영DB/기존드랍변경없음. 이100개는 대표성있는 메이플랜드목록이 아니며 등록전필터/검증필요 [실측].

## 수집처 전체 수집 (2026-10-28)

사용자 결정으로 수집처 클래식을 도감 기준 수집원으로 선택했습니다. 아이템 기본값/범위·몬스터 원문·개별 드랍 확률을 수집하며, 외부 ID는 source_id, UUID 참조는 유지합니다. sql/043과 tools/collector_catalog.py, 실행/충돌/정밀도/기존자료 보존 정책은 [수집 안내](collector-import.md)를 따릅니다. 기존 표본 수집처 파일은 비교 자료이며 이번 등록에 섞지 않습니다. [진술·실측]

- 2026-10-28 (Codex) 사용자 요청으로 sql/044 추가: 아이템 고정 속성 컬럼·옵션/범위/요구스탯/직업/원문속성 관계표. 043 입력 호환 트리거로 기존513개 이전 및 새 등록 자동 반영, JSON은 현재 화면 호환·원본 대조로 유지. 수집기는 변경/재시작하지 않으며 완료 후 export-only로043+044 포함 SQL 생성. 임시DB 검증 통과, 운영 적용은 사용자 실행 필요. [실측·진술]

- 2026-10-28 (Codex) 기존 수동 드랍 보존 설명은 사용자 지시 오반영으로 대체합니다. sql/045는 수집처 이외 출처의 drop_items만 비우고 비공개 복구본을 보관합니다. 몬스터 행·능력치·아이템·거래·신규 드랍 관계는 유지합니다. 재실행 안전/권한/정합성 임시DB 검증 통과. 운영 적용은 사용자 SQL Editor 실행 필요. [진술·실측]

## SQL047 이후 조회·갱신 (2026-10-29)

24개 서버 검색/선택 몬스터 드랍만 조회, 아이템 상세와 공개 변경 이력, 실제 변경만 기록하는 트리거·비공개 원문, 비교→사전백업→단일트랜잭션 적용 도구를 추가합니다. 절차와 제한은 [운영 안내](catalog-operations.md), 누락16종/27연결·몬스터2종은 [누락 목록](catalog-missing.md)을 따릅니다. SQL047/새 화면은 아직 운영 미적용입니다. [문서]
