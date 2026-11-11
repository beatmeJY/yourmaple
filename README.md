# Your Maple

메이플랜드의 캐릭터와 플레이 기록을 관리하고, 게임에 필요한 비용과 시간을 계산하는 웹앱입니다.

[서비스 열기](https://yourmaple.kr/) · [이용약관](https://yourmaple.kr/terms.html) · [개인정보 처리방침](https://yourmaple.kr/privacy.html)

## 주요 기능

- **플레이 기록** · 캐릭터별 숙제, 사냥, 거래 내역을 관리합니다.
- **계산기** · 무릉도장, 메이커 제작, 혼돈의 주문서, 레벨업과 몬스터파크를 계산합니다.
- **공용 도감과 시간표** · 몬스터의 드랍과 아이템의 옵션을 검색하고, 배와 엘리베이터 시간을 확인합니다.

공용 도감과 계산기는 로그인 없이 둘러볼 수 있습니다. 개인 기록을 저장하려면 Google 또는 Discord로 로그인합니다.

## 기술 구성

HTML·CSS·JavaScript로 만든 웹앱을 GitHub Pages에 배포합니다. Supabase에서 로그인과 데이터 저장을 처리하며, PostgreSQL의 행 수준 보안(RLS)으로 개인 기록에 대한 접근을 제어합니다.

- [화면 코드](js/pages/) · [계산 및 공통 모듈](js/)
- [데이터베이스 마이그레이션](sql/) · [배포 검증](.github/workflows/pages.yml)

## 로컬에서 로그인 없이 확인하기

Python 3으로 저장소 루트에서 실행합니다.

```bash
python3 -m http.server 5500 --bind 127.0.0.1
```

Windows에서는 `python3` 대신 `py -3`을 사용합니다. [샘플 데이터로 열기](http://127.0.0.1:5500/?mock) 또는 [로그인 전 화면 열기](http://127.0.0.1:5500/?mock=guest)로 확인할 수 있습니다. 샘플 데이터는 브라우저에 저장됩니다.

## 검증

```bash
node tools/run-checks.mjs
```

배포 전 GitHub Actions가 계산 로직과 데이터베이스 동작을 검사합니다.
