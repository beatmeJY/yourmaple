# Your Maple — 프로젝트 에이전트 지침

## 1. 공통 원본 참조와 프로젝트 범위

- 작업 시작 시 `/Users/youl/Projects/jiyoul/agent-context/global/AGENTS.md`를 직접 읽고, 이어서 이 파일과 `CLAUDE.md`, `README.md`를 읽는다. 경로만 확인한 것을 원본을 읽은 것으로 보고하지 않는다.
- 사용자 배경·소통·작업 권한·검증 표기·리뷰·동시 수정 규칙은 전역 원본에서 관리하며 여기에는 복사하지 않는다. 원본을 읽을 수 없으면 그 사실을 알린다.
- 이 파일에는 Your Maple의 기술 구성·UI·코드·SQL·도메인 규칙과 현재 상태만 관리한다. 전역 규칙을 대체하는 프로젝트 예외는 현재 없다.
- 게임 계산에 쓰는 확률·비용·공식은 사용자가 준 값을 그대로 쓴다. 직접 만든 모델이 사용자 자료와 다르면 임의로 고르지 말고 차이를 보여주고 묻는다.
- 2026-10-02 (Codex) 사용자 요청에 따라 공통 규칙의 중복을 전역 원본 참조로 대체했다. 출처: 이 대화. [진술]

## 2. UI 개발 원칙

- **이 프로젝트에서 가장 중요한 것은 사용자 경험이다.** 게임을 하듯 재미있고 예쁜 화면, 부드러운 이펙트를 기본으로 한다.
- 새 기능을 기본 입력창이나 텍스트만 붙인 상태로 끝내지 않는다. 펼침·등장·클릭 피드백에 부드러운 전환(시간차 등장, 바운스 easing, 글로우, 확률 막대 차오름 등)을 넣는다.
- 밋밋한 표보다 카드·아이콘·배지·막대 같은 시각적 구성을 먼저 고려한다. 단, 숫자와 계산 결과의 가독성, 키보드 조작, 모바일 사용성은 유지한다.
- 애니메이션을 넣으면 `@media (prefers-reduced-motion: reduce)`에서 꺼지도록 함께 작성한다.
- 2026-10부터 다크 글래스 리디자인(`yourmaple_design/`, 로컬 전용) 기준이다. 진행 순서·결정·남은 일은 `docs/redesign.md`를 따르고, 새 화면은 `:root` 디자인 토큰과 공통 부품(`.ym-glass`, `.ym-chip`, `.ym-badge`, `.ym-gauge`, `ym-fade-up`)을 먼저 쓴다. 다크 전용이다.
- 입력, 저장, 선택, 오류 상태를 명확하고 보기 좋게 표현한다.
- 모바일(폭 375px 전후)과 PC 모두 확인한다.

## 3. 기술 구성

- 빌드 도구 없는 순수 HTML/CSS/JavaScript(ES 모듈) SPA. GitHub Pages로 배포(`.github/workflows/pages.yml`). 배포 때만 `tools/stamp_version.py`가 JS·CSS 주소와 상대 import에 커밋 번호(`?v=`)를 붙여 캐시를 깬다. 그래서 상대 import는 `./x.js`·`../x.js` 문자열 그대로 쓰고, 경로를 변수로 조립하지 않는다.
- 배포 주소는 `https://yourmaple.kr`(가비아 DNS → GitHub Pages 커스텀 도메인, Enforce HTTPS). 예전 `beatmejy.github.io/yourmaple/`은 새 주소로 이동한다. DNS 레코드와 설정 위치는 README "도메인" 절에 있다. 코드에 배포 경로를 고정하지 않는다(상대 경로 유지).
- 데이터·로그인: Supabase(Postgres + RLS). 설정은 `js/config.js`(커밋 안 함, `config.example.js` 참고).
- 맥 로컬 실행: `python3 -m http.server 5500` → http://127.0.0.1:5500. Windows에서는 `py -3 -m http.server 5500`을 사용한다. `.claude/launch.json`은 현재 저장소에 없다(2026-10-02 Codex 확인 [실측]).
- 라우팅: 해시 기반(`#/characters`).
  - `js/routes.js`: `homeRoute`와 7개 분류 `categories`(id·이름·아이콘 글자·hue·routes). 평평한 `routes`는 여기서 만든다. `quick: true`는 페이지 이동 대신 버튼으로 동작(예: 링크 패널).
  - 개발 중인 화면·탭 숨기기: `routes.js`의 route에 `dev: true`(메이커 탭은 `TABS`의 `dev: true`)를 붙이면 운영 주소에서는 메뉴·검색·홈 타일에서 빠지고 주소로 열어도 홈으로 간다. 주소에 `?dev`(또는 `#/화면?dev`)를 붙이면 그 탭을 닫을 때까지 보이고 `?dev=0`이면 끈다. 로컬(127.0.0.1·localhost)에서는 늘 보인다(`js/dev-mode.js`). 2026-10-11 강화 계산·리버스 제작을 숨김 [실측]
  - `js/router.js`: `pages` 맵에 `id → import("./pages/xxx.js")` 등록. 각 페이지 모듈은 `export async function render(root)`를 가진다.
- 레이아웃·다크 고정·배경(`mountAmbient`)은 `js/ui.js`, 앱 시작과 전역 클릭 처리는 `js/main.js`. 파티클·성공 연출·효과음은 `js/effects.js`(`burst`, `burstAt`, `celebrate`, `sfx`)를 쓴다.
- 스타일은 `css/styles.css` 한 파일. 색은 `:root` 토큰(`--bg`, `--bg-raised`, `--line`, `--text`, `--muted`, `--accent`, `--gain`, `--danger`, `--shadow`, 디자인 전용 `--gold`, `--glass`, `--cta`, `--spring` 등)만 쓴다. 파일 끝 "리디자인 1단계 공통 기반" 블록이 기존 공통 부품을 덮는다.

## 4. 코드 규칙

- 메소 금액은 **BigInt**로 계산한다. 입력은 `readBig`, 표시는 `formatCount`(`js/format.js`)를 쓴다.
- HTML 문자열에 넣는 값은 모두 `escapeHtml`로 감싼다.
- 알림은 `notify()`(`js/toast.js`), DB 오류 문구는 `translateDbError()`(`js/db-error.js`)를 쓴다.
- 비동기 로딩은 `loadId` 증가 + `root.isConnected` 확인 패턴으로 늦게 도착한 응답을 버린다.
- 시세처럼 기록이 쌓이는 값은 무릉 허리띠 시세 패턴을 따른다. 요약 칸을 클릭하면 `<dialog class="belt-history-dialog">`가 열리고, 전체 기록·이전과 차이·삭제·새 기록을 한곳에서 처리한다(`js/pages/dojo.js`, `js/pages/maker.js` 참고).
- 계산 로직은 페이지 파일과 분리한다(`js/dojo-calc.js`, `js/hunt-calc.js`, `js/maker-calc.js` 등). 테스트는 옆에 `*.check.mjs`로 두고 `node js/xxx.check.mjs`로 실행한다.
- 주변 코드의 이름·주석 밀도·말투(주석은 한국어)를 따른다.

### 알려진 함정

- **`<td>`에 `display: flex`를 직접 걸지 않는다.** 표 레이아웃이 깨져 줄이 섞여 보인다. 안쪽 `<span>`에 flex를 걸거나, 내용이 복잡하면 표 대신 카드 그리드를 쓴다.
- 화면에 떠 있어야 하는 `position: fixed` 요소(예: 링크 패널)를 길이가 늘어나는 `.content` 안에 넣지 않는다. `.layout` 바로 아래 형제로 두고, PC에서는 `left: var(--sidebar)` / `body.nav-collapsed`일 때 `left: 0`으로 사이드바를 피한다.
- 화면 모듈은 `render(root)`의 root(=#main)에 처리기를 단다. 라우터가 화면마다 `#main`을 빈 복제본으로 바꿔 예전 처리기를 버리므로, 화면 밖에서 `#main` 요소를 붙잡아 두지 말고 필요하면 `document.querySelector("#main")`로 다시 찾는다(2026-10-10).
- 브라우저 캐시 때문에 수정한 CSS/JS가 바로 안 보일 수 있다. 확인할 때는 강력 새로고침하거나 캐시를 끈다.

## 5. 데이터베이스(SQL) 규칙

- 변경은 `sql/NNN_설명.sql` 새 파일로 추가하고, 사용자가 Supabase SQL Editor에서 직접 실행한다. 새 파일을 만들면 사용자에게 실행해 달라고 꼭 알린다.
- **같은 파일을 다시 실행해도 안전하게** 작성한다: `create table if not exists`, `drop constraint/policy/trigger if exists` 후 다시 생성.
- 모든 표는 `user_id` + `assign_user_id` 트리거 + RLS(본인 행만 select/insert/update/delete)를 갖는다. `sql/016_dojo.sql`, `sql/027_maker.sql`을 본보기로 쓴다.
- 새 SQL 파일은 README의 "데이터베이스 만들기" 목록에도 한 줄 추가한다.

## 6. 기능별 도메인 메모

메이커 계산, 리버스 제작, 장비 옵션 부여, 링크 패널, 강화 계산, 캐릭터 규칙은 `docs/domain.md`에 있다. 해당 기능을 고치기 전에 그 파일의 관련 절을 읽고, 새 규칙도 그 파일에 적는다.

## 7. 현재 상태 (2026-10-09 요약, 상세 이력은 git, 결정은 `docs/domain.md`)

- 도메인: 2026-10-09 `https://yourmaple.kr`로 옮겼다(가비아 DNS, Custom domain, Enforce HTTPS, Supabase Site URL — 설정은 사용자 [진술]). HTTPS 접속·www 이동·인증서·`https_enforced: true` 확인. `http://` 주소와 예전 `github.io` 주소의 https 이동은 캐시 만료 전이라 재확인 필요 [실측]
- 리디자인: 2026-10-10 1~4단계 모든 기존 화면 완료(공통 기반·메뉴·연출, 메모·링크·캐릭터·홈, 사냥·레벨업·퀘스트·몬스터·메이커·강화 공통 맞춤, 무릉 전용 테마, 거래 장부, 로그인) + 헤더 기능 검색·대표 캐릭터 프로필, 캐릭터 경험치·즉시 저장, 홈 EXP 막대. 2026-10-10 전부 커밋·배포(2332ed7, Pages 성공·공개 사이트 새 버전 확인) [실측]. `sql/029` 사용자 실행 완료 [진술]. 가짜 Supabase로 12개 화면 PC 1280·모바일 375 렌더·오류·가로 넘침 확인 [실측]. 남은 것: 5단계(숙제·직업 가이드·사냥터 추천), 6단계(모바일 성능·접근성), 화면 재방문 시 클릭 처리 중복은 2026-10-10 수정(`router.js`가 화면마다 `#main`을 새 요소로 교체) [실측]. 진행표 `docs/redesign.md`
- 리디자인 2차: 2026-10-10 (Claude) 사냥 기록·레벨업·퀘스트·몬스터·메이커(보석 제작 탭)를 시안 구조로 다시 만듦, 무릉 순위표 클릭 수정. 강화·메이커 시뮬레이터 추가(`js/sim.js`, `js/enhance-sim.js`). 2026-10-11 숙제와 함께 커밋 4689ad1·배포(Pages 성공, 공개 사이트 v=4689ad1 확인) [실측]. 가짜 Supabase로 PC·모바일 확인 [실측]
- 숙제: 2026-10-11 (Claude) 숙제 체크리스트 화면 추가(`js/pages/homework.js`, `js/homework-calc.js`, `sql/030_homework.sql`). sql/030은 사용자 실행 필요(실행 전에는 보스 숙제만 동작) [실측, 가짜 Supabase]. 2026-10-11 숙제마다 카드(할 수 있는 캐릭터만·얼굴), 캐릭터 관리의 보스 숙제 기능을 숙제 체크리스트로 옮김(미커밋) [실측, 가짜 Supabase]. sql/030 사용자 실행 완료 [진술]. 숙제별 + 캐릭터 고르기·무릉 숨기기(`sql/031_homework_members.sql`), 숙제표 한 줄에 하나·가능 시각·오늘·곧·무릉 통합 점수 기록(`sql/033_dojo_score_log.sql`, 사용자 실행 필요 — 032는 실행했으나 더 쓰지 않음)·무릉 화면 기록 창(수련 점수 아래 버튼)·숙제 무릉 "오늘 초기화"(오늘 쌓은 점수만 0, `sql/034_dojo_score_clear.sql` 사용자 실행 필요) [실측, 가짜 Supabase]
- 배포: GitHub Pages. 마지막 배포는 무릉 허리띠 변경(2026-10-08, Pages 실행 성공·공개 사이트 반영 확인). 그 뒤의 강화 계산 개편(보유 메소 vs 바로 구매, 노작 섞기 `bestAttemptMix`, 강화 지도, 같은 상태 비교)과 메이커·거래 UI 변경은 미배포다. 커밋 여부는 git으로 확인한다 [실측]
- 검증: `node js/*.check.mjs` 11개(homework-calc 무릉 점수 포함), 구문·`git diff --check`. 화면은 가짜 Supabase 검증 페이지로 PC 1024·1280·1440px, 모바일 375px, 다크 모드를 확인한다 [실측]
- 미검증: 실제 로그인 DB 저장(강화 프로필 schemaVersion 2, 거래 저장, 무릉 점수), 사용자 간 접근 차단 [실측]
- DB: `sql/027_maker.sql`, `sql/028_enhance_profiles.sql`은 사용자가 Supabase에서 실행 완료 [진술]
- 강화 계산 규칙은 2026-10-04~09 사이 여러 번 바뀌었다. 현재 기준만 `docs/domain.md` 강화 절 "현재 기준"을 따른다 [문서]

## 8. 알려진 함정

- 로컬 Python 인증서 저장소 오류로 공개 사이트 조회가 실패할 수 있다. 인증서 검증을 유지하는 `curl`로 확인한다.
- 실제 Supabase 로그인 없이 확인한 화면은 가짜 응답 기준이다. DB 저장까지 확인했다고 보고하지 않는다.
