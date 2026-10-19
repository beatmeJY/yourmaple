# Your Maple

개인용 메이플스토리 정보와 메모를 저장하는 웹앱입니다.  
데이터는 Supabase에 저장되고, 로그인한 본인만 자기 데이터를 볼 수 있습니다.

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

`anon` 행이 없고, 표마다 `rls_enabled` 가 true 이면 정상입니다.

## 로그인 연결

1. `js/config.example.js` 를 복사해 `js/config.js` 를 만듭니다.
2. Supabase **Project Settings → API Keys** 에서 Project URL 과 Publishable key 만 붙여 넣습니다.
3. Secret key, service_role key 는 넣지 않습니다.
4. Authentication 에서 Email 로그인을 켜 둡니다. 개인용이면 Confirm email 을 끄면 가입 직후 바로 로그인됩니다.
5. Authentication → URL Configuration 의 Site URL 을 `http://127.0.0.1:5500` 으로 맞춥니다.

### Google·Discord 로그인과 로그인 없이 쓰기 (2026-10-19)

- 로그인하지 않아도 앱이 열립니다. 홈은 소개 화면이고, **레벨업 계산·메이커 계산·무릉도장(·강화 계산)** 은 로그인 없이 계산할 수 있습니다. 저장 버튼을 누르면 그때 로그인 화면으로 가고, 로그인하고 돌아오면 그 화면으로 돌아와 적던 값을 다시 채워 둡니다(저장은 다시 누름). 맡긴 값은 sessionStorage 에 30분 동안 둡니다(`js/session.js`).
- 캐릭터·숙제·사냥·퀘스트·몬스터·거래·메모·링크는 내 기록 화면이라 로그인해야 열립니다(`js/routes.js` 의 `auth: true`).
- 로그인은 **Google·Discord만** 씁니다(2026-10-19 이메일·비밀번호 로그인 삭제 — 비밀번호를 보관하지 않음). 로그인 화면에는 "Google로 계속하기", "Discord로 계속하기"만 있습니다. 아래를 켜기 전에는 버튼을 누르면 무엇을 켜야 하는지 안내가 나옵니다.

0. **Sign In / Providers → User Signups → Allow new users to sign up** 을 켭니다. 꺼져 있으면 처음 오는 Google·Discord 계정이 "Signups not allowed for this instance"로 막힙니다. **Anonymous sign-ins 는 끕니다**(로그인 없이 둘러보기는 2026-10-19 삭제). **Email provider 도 끕니다**(이메일·비밀번호 로그인 삭제). 끄기 전에 Authentication → Users 에서 이메일로 가입한 기존 계정의 Identities 에 google 또는 discord 가 함께 있는지 확인합니다(없으면 그 계정으로 들어갈 수 없게 됨).
1. **URL Configuration**: Site URL 을 `https://yourmaple.kr` 로, Redirect URLs 에 `https://yourmaple.kr/**` 와 `http://127.0.0.1:5500/**` 를 넣습니다(로그인 뒤 돌아올 주소).
2. **Google**: Google Cloud Console → API 및 서비스 → 사용자 인증 정보 → OAuth 클라이언트 ID(웹 애플리케이션). 승인된 리디렉션 URI 에 `https://<프로젝트>.supabase.co/auth/v1/callback` 을 넣고, 받은 클라이언트 ID·보안 비밀을 Supabase 의 Google provider 에 넣습니다. OAuth 동의 화면도 만들어야 합니다.
3. **Discord**: Discord Developer Portal → New Application → OAuth2 → Redirects 에 같은 `.../auth/v1/callback` 을 넣고, Client ID·Client Secret 을 Supabase 의 Discord provider 에 넣습니다.

- 로그인은 PKCE 방식(`flowType: "pkce"`, `js/supabase-client.js`)이라 돌아올 때 주소에 `?code=` 가 붙고, 처리한 뒤 지웁니다(`#` 은 화면 주소로 씀).
- 회원 탈퇴는 헤더 이메일 → "내 계정"(`js/account.js`)에서 합니다. 계정 이메일을 똑같이 적어야 신청되고, **7일 유예** 뒤 매일 예약 작업이 계정을 지웁니다(sql/036). 대기 중에는 화면 아래 띠와 내 계정 창에서 취소할 수 있습니다. 2026-10-19 즉시 삭제(sql/035)로 운영자 계정 기록을 잃은 뒤 바꿨습니다.
- 같은 이메일(예: 처음 가입한 이메일과 같은 Gmail)로 Google·Discord 로그인하면 Supabase 가 같은 계정에 자동으로 붙입니다(기존 이메일이 인증된 경우). 이메일이 다르면 계정이 따로 생깁니다.
- 클라이언트 보안 비밀은 Supabase 에만 넣고 이 저장소에는 넣지 않습니다.

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
