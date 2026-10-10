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

`anon` 행이 없고, 표마다 `rls_enabled` 가 true 이면 정상입니다.

## 로그인 연결

1. `js/config.example.js` 를 복사해 `js/config.js` 를 만듭니다.
2. Supabase **Project Settings → API Keys** 에서 Project URL 과 Publishable key 만 붙여 넣습니다.
3. Secret key, service_role key 는 넣지 않습니다.
4. Authentication 에서 Email 로그인을 켜 둡니다. 개인용이면 Confirm email 을 끄면 가입 직후 바로 로그인됩니다.
5. Authentication → URL Configuration 의 Site URL 을 `http://127.0.0.1:5500` 으로 맞춥니다.

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
