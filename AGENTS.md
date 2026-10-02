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
- 메이플 도움 사이트 분위기와 기존 디자인(색상 토큰, 카드, 버튼, 여백, 타이포그래피)에 맞춘다.
- 입력, 저장, 선택, 오류 상태를 명확하고 보기 좋게 표현한다.
- 모바일(폭 375px 전후)과 PC 모두 확인한다.

## 3. 기술 구성

- 빌드 도구 없는 순수 HTML/CSS/JavaScript(ES 모듈) SPA. GitHub Pages로 배포(`.github/workflows/pages.yml`).
- 데이터·로그인: Supabase(Postgres + RLS). 설정은 `js/config.js`(커밋 안 함, `config.example.js` 참고).
- 맥 로컬 실행: `python3 -m http.server 5500` → http://127.0.0.1:5500. Windows에서는 `py -3 -m http.server 5500`을 사용한다. `.claude/launch.json`은 현재 저장소에 없다(2026-10-02 Codex 확인 [실측]).
- 라우팅: 해시 기반(`#/characters`).
  - `js/routes.js`: 메뉴 목록. `pin: true`는 메뉴 아래쪽 고정, `quick: true`는 페이지 이동 대신 버튼으로 동작(예: 링크 패널).
  - `js/router.js`: `pages` 맵에 `id → import("./pages/xxx.js")` 등록. 각 페이지 모듈은 `export async function render(root)`를 가진다.
- 레이아웃과 다크 모드는 `js/ui.js`, 앱 시작과 전역 클릭 처리는 `js/main.js`.
- 스타일은 `css/styles.css` 한 파일. 색은 `:root` 토큰(`--bg`, `--bg-raised`, `--line`, `--text`, `--muted`, `--accent`, `--accent-soft`, `--gain`, `--danger`, `--shadow` 등)만 쓰고, 다크 모드 값도 토큰으로 정의한다.

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
- 브라우저 캐시 때문에 수정한 CSS/JS가 바로 안 보일 수 있다. 확인할 때는 강력 새로고침하거나 캐시를 끈다.

## 5. 데이터베이스(SQL) 규칙

- 변경은 `sql/NNN_설명.sql` 새 파일로 추가하고, 사용자가 Supabase SQL Editor에서 직접 실행한다. 새 파일을 만들면 사용자에게 실행해 달라고 꼭 알린다.
- **같은 파일을 다시 실행해도 안전하게** 작성한다: `create table if not exists`, `drop constraint/policy/trigger if exists` 후 다시 생성.
- 모든 표는 `user_id` + `assign_user_id` 트리거 + RLS(본인 행만 select/insert/update/delete)를 갖는다. `sql/016_dojo.sql`, `sql/027_maker.sql`을 본보기로 쓴다.
- 새 SQL 파일은 README의 "데이터베이스 만들기" 목록에도 한 줄 추가한다.

## 6. 기능별 도메인 메모

메이커 계산, 리버스 제작, 장비 옵션 부여, 링크 패널, 강화 계산, 캐릭터 규칙은 `docs/domain.md`에 있다. 해당 기능을 고치기 전에 그 파일의 관련 절을 읽고, 새 규칙도 그 파일에 적는다.

## 7. 현재 상태

- 2026-10-02 (Codex) 공통 원본 참조로 연결하고 프로젝트 고유 지침을 보존했다. `CLAUDE.md`는 전역 원본과 이 파일을 읽는 연결 파일로 정리했다. [실측] (대체됨: 2026-10-02, `CLAUDE.md`를 `@AGENTS.md` 한 줄로 되돌림. 전역 원본은 `~/.claude/CLAUDE.md`가 이미 불러와 중복이었다 — Claude)
- 2026-10-02 (Codex) 프로젝트 경로는 `/Users/youl/Projects/jiyoul/yourmaple`이다. [실측]
- 2026-10-02 (Codex) 같은 대화의 맥 초기 설정 작업에서 강화·메이커 계산 체크를 실행해 통과했다. 이번 문서 정리에서는 계산 테스트를 다시 실행하지 않았다. [실측]
- 2026-10-02 (Codex 기록, 사용자 확인) `sql/027_maker.sql`과 `sql/028_enhance_profiles.sql`은 Supabase 실행 완료. 출처: 사용자 인계 및 이 대화. DB에 직접 접속해 확인하지 않았다. [진술]
- 2026-10-02 (Codex 기록, 사용자 확인) 강화 프로필이 새로고침 후 불러와짐. 출처: 이 대화. 수정·삭제·사용자 간 접근 차단과 PC·모바일 화면은 별도 검증이 남아 있다. [진술]
- 2026-10-02 (Codex) `img/maker/opal-high.png` 파일 존재를 확인했다. [실측]
- 2026-10-02 (Claude) 6절 도메인 메모를 `docs/domain.md`로 옮겼다. 전역+프로젝트 지침이 Codex 한도 32KiB에 가까워졌기 때문이다(31,070B). 옮긴 뒤 내용 누락이 없음을 커밋본과 줄 단위로 대조했다. [실측]
- 2026-10-02 (Claude) "요청이 애매하면 추측해서 여러 번 다시 만들지 말고 먼저 확인받는다" 규칙은 전역 원본 2절로 옮겼다. [실측]
