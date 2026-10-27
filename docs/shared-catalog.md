# 공용 도감과 개인 거래

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
