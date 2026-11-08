"""기능별 소개 페이지(무릉·메이커·혼돈의 주문서·레벨업)를 한 틀로 만든다. 사용: python3 tools/build_feature_pages.py .

빌드 도구 없이 정적 HTML을 저장소에 그대로 둔다. 문구·기준을 바꾸면 이 파일을 고친 뒤 다시 실행한다.
게임 기준값은 docs/domain.md 와 계산 모듈(js/*-calc.js)을 따른다.
"""
import datetime, html, json, pathlib, sys

root = pathlib.Path(sys.argv[1])
SITE = "https://yourmaple.kr"
e = html.escape

PAGES = [
  {
    "slug": "dojo", "app": "/#/dojo", "eyebrow": "MAPLELAND · 무릉도장",
    "title": "메이플랜드 무릉도장 계산기 — 검은 허리띠까지 루트·시간 | Your Maple",
    "h1": "무릉도장 루트 계산기",
    "desc": "메이플랜드 무릉도장 층별 구간 기록으로 쉬는 층 조합별 시간을 비교하고, 검은 허리띠까지 총 플레이 시간과 남은 시간, 허리띠 시세 기준 시간당 메소를 계산합니다.",
    "lead": "층별 구간 기록만 적으면 어느 층에서 쉬어 가는 루트가 가장 빠른지, 검은 허리띠까지 0점부터 걸리는 총 시간과 현재 점수에서 남은 시간을 보여 줘요.",
    "art": [("/img/dojo-icon.png", 72, 72, "무릉도장 아이콘")],
    "cards": [
      ("구간 기록", "1~32층을 구간마다 재서 적어요. 층 이름에 마우스를 올리면 그 층 보스와 주의할 점이 보여요."),
      ("루트 순위표", "쉬는 층(6·12·18·24·30층)을 어디서 들를지 조합마다 참고 시간을 계산해 빠른 순서로 보여 줘요. 실제로 잰 시간이 있으면 그 기록이 먼저예요."),
      ("검은 허리띠까지", "0점부터 12,000점까지 걸리는 총 시간과 현재 점수에서 남은 시간을 실제·참고 기록 기준으로 비교해요."),
      ("허리띠 시세", "허리띠 시세를 기록해 두면 한 판에 얻는 점수로 시간당 수익을 비교할 수 있어요."),
    ],
    "rules_title": "계산 기준",
    "rules": [
      "허리띠 점수: 흰색 140 · 노란색 1,300 · 파란색 2,800 · 빨간색 6,400 · 검은색 12,000점",
      "하루에 얻을 수 있는 점수는 최대 3,500점으로 계산해요.",
      "참고 시간에는 쉼터를 들러 저장하면 1번에 10초, 저장 없이 지나가면 1번에 2초를 더해요.",
      "실제로 잰 기록에는 쉼터 시간을 따로 더하지 않아요.",
    ],
    "steps": ["무릉도장 화면을 열고 층별 구간 시간을 적어요.", "순위표에서 가장 빠른 루트를 골라 실제 시간을 재요.", "로그인하면 캐릭터별로 기록을 저장해 두고 다시 볼 수 있어요."],
    "faq": [
      ("로그인해야 쓸 수 있나요?", "아니요. 계산은 로그인 없이 바로 할 수 있고, 기록을 저장할 때만 Google 또는 Discord로 로그인해요."),
      ("어떤 층까지 계산하나요?", "1층부터 32층(크림슨 발록)까지예요. 쉬는 층 6·12·18·24·30층은 들를지 말지를 골라 루트를 비교해요."),
    ],
  },
  {
    "slug": "maker", "app": "/#/maker", "eyebrow": "MAPLELAND · 메이커",
    "title": "메이플랜드 메이커 계산기 — 보석·크리스탈 제련 적정가, 리버스 제작 | Your Maple",
    "h1": "메이커 보석 제작·리버스 제작 계산기",
    "desc": "메이플랜드 메이커 보석 8종·크리스탈 4종의 하급·중급·상급 적정가와 상급을 얻는 가장 싼 방법, 리버스 무기 제작의 공격력별 적정 판매가와 기대 손익을 계산합니다.",
    "lead": "원석·보석 시세만 넣으면 하급·중급·상급의 적정가, 사서 가공하는 게 이득인 기준선, 리버스 제작 한 번의 기대 손익까지 계산해요.",
    "art": [("/img/maker/diamond-high.png", 60, 64, "상급 다이아몬드"), ("/img/maker/str_crystal-high.png", 60, 64, "상급 힘의 크리스탈")],
    "cards": [
      ("보석 제작", "다이아몬드·가넷·자수정·아쿠아마린·오팔·사파이어·토파즈·에메랄드와 힘·민첩성·행운·지혜 크리스탈의 등급별 적정가를 계산해요."),
      ("상급 얻는 가장 싼 방법", "원석부터 제련 / 중급 사서 가공 / 상급 바로 구매 세 가지를 비교해 가장 싼 쪽에 '최저' 배지를 붙여요."),
      ("리버스 제작", "재료 시세와 정옵 공격력을 넣으면 정옵~+5 공격력별 적정 판매가와 실거래가 기준 기대 손익을 보여 줘요."),
      ("장비 옵션 부여", "보석·크리스탈을 1~3개 고르면 기본 비용 275만 메소와 등급별 추가 비용, 보석 시세를 더한 총 제작비를 계산해요."),
    ],
    "rules_title": "계산 기준",
    "rules": [
      "고정 제련비: 일반→하급 11만, 하급 10개→중급 33만, 중급 10개→상급 55만 메소",
      "일반 제련 결과(대략값): 보석 하급 75% · 중급 22% · 상급 3%, 크리스탈 하급 75% · 중급 24% · 상급 1%",
      "하급 10개→중급 성공 50%, 중급 10개→상급 성공 25%. 실패하면 재료 1개만 사라져요.",
      "리버스 제작은 촉진제를 쓰면 정옵 54.09% · +1 15.84% · +2 10.89% · +3 5.76% · +4 2.43% · +5 0.99% · 파괴 10%로 계산해요.",
    ],
    "steps": ["메이커 화면에서 원석과 보석 시세를 적어요.", "카드의 하급·중급·상급을 누르면 계산 과정과 확률이 펼쳐져요.", "로그인하면 시세 기록이 쌓여 이전 값과 비교할 수 있어요."],
    "links": [("/#/maker", "보석 제작 열기"), ("/#/maker-craft", "리버스 제작 열기"), ("/#/maker-enchant", "장비 옵션 부여 열기")],
    "faq": [
      ("확률은 정확한 값인가요?", "일반 제련 결과 확률은 알려진 대략값이에요. 실제 결과는 운에 따라 달라지고, 계산 결과는 참고용이에요."),
      ("로그인해야 쓸 수 있나요?", "아니요. 계산은 로그인 없이 할 수 있고, 시세를 저장할 때만 로그인해요."),
    ],
  },
  {
    "slug": "chaos-scroll", "app": "/#/chaos-scroll", "eyebrow": "MAPLELAND · 강화",
    "title": "메이플랜드 혼돈의 주문서 시뮬레이터 — 혼줌 한 장씩 바르기 | Your Maple",
    "h1": "혼돈의 주문서 시뮬레이터",
    "desc": "메이플랜드 혼돈의 주문서(혼줌)를 도감 장비에 한 장씩 발라 보는 시뮬레이터. 성공 60%, 능력치 변화 확률을 바꿔 보며 검은색 허리띠·혼테일의 목걸이 등 장비 결과를 미리 확인하세요.",
    "lead": "도감에서 장비를 고르고 혼돈의 주문서를 한 장씩, 또는 남은 횟수만큼 한 번에 발라 보세요. 되돌리기도 돼요.",
    "art": [("/img/chaos-scroll.png", 60, 60, "혼돈의 주문서")],
    "cards": [
      ("도감 장비 고르기", "검은색 허리띠·부보안관 은뱃지·혼테일의 목걸이·얼음결정 페이스페인팅은 아이콘으로 바로, 나머지는 이름으로 찾아요. 기본 옵션과 남은 강화 횟수가 채워져요."),
      ("한 장씩 · 모두 바르기", "한 장씩 바르거나 남은 횟수를 모두 발라 보고, 바른 기록을 보며 한 장 되돌리거나 처음 상태로 돌아가요."),
      ("확률 설정", "성공 확률과 능력치 변화량별 확률을 직접 바꿔 계산할 수 있어요."),
      ("쓸 수 있는 장비", "혼돈의 주문서는 펜던트·벨트·반지·얼굴장식·눈장식·어깨장식에만 쓸 수 있어요."),
    ],
    "rules_title": "기본 규칙",
    "rules": [
      "성공 60%. 실패하면 업그레이드 가능 횟수만 1 줄고 아이템은 깨지지 않아요.",
      "성공하면 붙어 있는 능력치마다 따로 변화량을 굴려요. 최대 HP·MP는 변화량이 10배예요.",
      "기본 확률은 알려진 값으로 정했고, 화면의 확률 설정에서 바꿀 수 있어요.",
    ],
    "steps": ["혼돈의 주문서 화면에서 장비를 골라요.", "한 장씩 바르거나 모두 바르기로 결과를 봐요.", "마음에 안 들면 되돌리기나 처음 상태로 다시 시작해요."],
    "faq": [
      ("실제 게임 결과와 같나요?", "아니요. 확률에 따라 무작위로 굴려 보는 연습용 시뮬레이터예요. 실제 강화 결과를 보장하지 않아요."),
      ("로그인해야 쓸 수 있나요?", "아니요. 로그인 없이 바로 쓸 수 있어요."),
    ],
  },
  {
    "slug": "level-up", "app": "/#/level-plan", "eyebrow": "MAPLELAND · 경험치",
    "title": "메이플랜드 레벨업 계산기 — 목표 레벨까지 경험치·시간·경험치 쿠폰 | Your Maple",
    "h1": "레벨업 계산기",
    "desc": "메이플랜드 목표 레벨까지 필요한 경험치와 사냥 효율(분당 경험치)로 걸리는 시간·일수를 계산합니다. 2배·3배 경험치 쿠폰과 하루 사냥 시간도 반영해요.",
    "lead": "지금 레벨과 경험치, 목표 레벨, 사냥 효율만 넣으면 남은 경험치와 걸리는 시간을 계산해 줘요.",
    "art": [("/img/exp-coupon-3x.png", 130, 128, "3배 경험치 쿠폰")],
    "cards": [
      ("레벨별 필요 경험치", "지금 레벨부터 목표 레벨까지 레벨마다 필요한 경험치를 보여 줘요. 첫 레벨은 남은 양만 계산해요."),
      ("예상 소요 시간", "분당 경험치를 적거나 저장한 사냥 기록을 고르면 1시간 경험치와 목표까지 걸리는 시간을 계산해요."),
      ("경험치 쿠폰", "15분 2배·3배 쿠폰 장수를 넣으면 3배를 먼저 쓰는 기준으로 시간을 줄여서 계산해요."),
      ("하루 사냥 시간", "하루에 사냥하는 시간을 적으면 며칠 걸리는지 알려 줘요. 쩔비·물약 값으로 시간당 메소도 함께 봐요."),
    ],
    "rules_title": "이렇게 계산해요",
    "rules": [
      "남은 경험치 = 목표 레벨까지 레벨별 필요 경험치 합 − 지금 경험치",
      "걸리는 시간 = 남은 경험치 ÷ 분당 경험치 (경험치 쿠폰을 쓰는 동안은 2배·3배)",
      "사냥 기록 화면에서 잰 기록은 직업별로 골라 효율로 쓸 수 있어요.",
    ],
    "steps": ["레벨업 계산 화면에서 지금 레벨·경험치와 목표 레벨을 적어요.", "분당 경험치를 직접 적거나 사냥 기록을 골라요.", "로그인하면 캐릭터를 골라 레벨·경험치를 바로 채울 수 있어요."],
    "faq": [
      ("로그인해야 쓸 수 있나요?", "아니요. 효율을 직접 적으면 로그인 없이 계산돼요. 캐릭터·사냥 기록을 불러올 때만 로그인이 필요해요."),
      ("사냥 효율은 어떻게 재나요?", "로그인 뒤 사냥 기록 화면의 타이머로 시작·끝 경험치를 적으면 시간당 경험치로 환산해 저장해요."),
    ],
  },
  {
    "slug": "monster-park", "app": "/#/monster-park", "eyebrow": "MAPLELAND · 몬스터파크 이벤트",
    "until": "2026-11-30", "smooth": True,
    "title": "메이플랜드 몬스터파크 계산기 — 11월 이벤트 마감까지 레벨·남은 판수 | Your Maple",
    "h1": "몬스터파크 계산기",
    "desc": "메이플랜드 몬스터파크 이벤트(2026년 11월 30일까지)에서 하루 2판씩 돌면 마감 날 몇 레벨이 되는지, 130레벨까지 몇 판·며칠 남았는지 구역별 한 판 경험치로 계산합니다.",
    "lead": "지금 레벨과 경험치만 넣으면 이벤트 마감 날 몇 레벨이 되는지, 날짜별로 언제 레벨이 오르는지 보여 줘요.",
    "art": [("/img/feature/monster-park.png", 280, 280, "몬스터파크")],
    "cards": [
      ("마감 날 레벨", "오늘 남은 입장(0·1·2회)과 하루 2판 기준으로 11월 30일 마감 날 도달하는 레벨을 계산해요."),
      ("130까지 남은 판수", "130레벨(시그너스 기사단은 120)까지 몇 판, 며칠이 남았는지 알려 줘요."),
      ("날짜별 진행", "날마다 몇 레벨 몇 %가 되는지 표로 보여 줘요. 구역이 바뀌는 날도 표시해요."),
      ("놓치는 판 경고", "한 판에 1레벨만 오르는 제한이나 구역이 바뀌어 그날 남은 입장을 못 쓰는 경우를 미리 알려 줘요."),
    ],
    "rules_title": "계산 기준",
    "rules": [
      "구역별 한 판 경험치: 50~70레벨 418,840 · 71~100레벨 2,898,000 · 101~129레벨 6,289,333 (화면에서 고쳐 적을 수 있어요)",
      "하루 2회 입장, 마지막 입장일은 2026년 11월 30일로 계산해요.",
      "한 판에 1레벨만 올라요. 넘친 경험치는 다음 레벨 99.99%까지만 남아요.",
      "몬스터파크 경험치만 계산해요(사냥 경험치는 넣지 않아요).",
    ],
    "steps": ["몬스터파크 계산 화면에서 레벨·경험치와 오늘 남은 입장을 적어요.", "마감 날 레벨과 날짜별 진행을 확인해요.", "로그인하면 캐릭터를 골라 '한 판 끝!'으로 경험치를 바로 저장하고, 숙제표 몬파 칸과도 이어져요."],
    "faq": [
      ("로그인해야 쓸 수 있나요?", "아니요. 레벨과 경험치를 직접 적으면 로그인 없이 계산돼요. 캐릭터에 저장할 때만 로그인해요."),
      ("이벤트가 끝나면 어떻게 되나요?", "2026년 11월 30일이 마지막 입장일이에요. 그 뒤에는 계산 화면이 메뉴에서 사라지고 이 페이지에 종료 안내가 보여요."),
    ],
    "ended": {
      "title": "메이플랜드 몬스터파크 계산기 — 종료된 이벤트 | Your Maple",
      "lead": "2026년 11월 30일에 끝난 몬스터파크 이벤트의 계산기였어요. 다음 이벤트가 열리면 다시 안내할게요.",
    },
  },
  {
    "slug": "monsters", "app": "/#/monsters", "eyebrow": "MAPLELAND · 몬스터 도감", "smooth": True, "note": "로그인 없이 누구나 볼 수 있어요", "what": "이런 걸 볼 수 있어요",
    "title": "메이플랜드 몬스터 도감 — 몬스터 드랍 아이템·확률·경험치·HP | Your Maple",
    "h1": "몬스터 도감",
    "desc": "메이플랜드 몬스터 800여 종의 레벨·HP·경험치·1 HP당 경험치·필요 명중과 드랍 아이템·드랍 확률을 검색해 보세요. 로그인 없이 볼 수 있어요.",
    "lead": "몬스터 이름으로 찾으면 레벨·HP·경험치 같은 기본 정보와 전투 수치, 드랍하는 아이템과 확률을 한 카드에서 보여 줘요.",
    "art": [("/img/feature/monster-icon.png", 280, 280, "몬스터 도감"), ("/img/horntail.png", 300, 300, "혼테일")],
    "cards": [
      ("기본 정보", "레벨·HP·MP·경험치와 사냥 효율을 비교하기 좋은 '1 HP당 경험치'를 보여 줘요. 레벨순·효율순으로 정렬할 수 있어요."),
      ("전투 수치", "기준 명중, 물리·마법 공격과 방어, 이동 속도 같은 전투 수치를 확인해요."),
      ("드랍 아이템·확률", "드랍 아이템을 확률 높은 순으로, 확률 크기에 따라 색으로 구분해 보여 줘요. 아이템을 누르면 아이템 정보로 이어져요."),
      ("바로 검색", "이름 일부만 적어도 찾고, 로그인 없이 누구나 볼 수 있어요."),
    ],
    "rules_title": "이용 안내",
    "rules": [
      "도감 수치는 공개된 자료와 운영자 확인을 바탕으로 정리한 참고 정보예요. 실제 게임과 다를 수 있어요.",
      "자료가 없는 값은 '미제공'으로 따로 표시하고, 0과 구분해요.",
      "몬스터마다 변경 이력을 볼 수 있어요.",
    ],
    "steps": ["몬스터 도감을 열고 이름으로 검색해요.", "카드를 누르면 상세 정보와 드랍 아이템이 펼쳐져요.", "드랍 아이템을 누르면 그 아이템의 옵션과 다른 드랍 몬스터를 볼 수 있어요."],
    "faq": [
      ("틀린 정보는 어떻게 알리나요?", "yourmaplekr@gmail.com으로 몬스터 이름과 틀린 내용을 보내 주세요. 확인해서 고쳐요."),
      ("로그인해야 볼 수 있나요?", "아니요. 몬스터 도감은 로그인 없이 볼 수 있어요."),
    ],
  },
  {
    "slug": "items", "app": "/#/item-catalog", "eyebrow": "MAPLELAND · 아이템 도감", "smooth": True, "note": "로그인 없이 누구나 볼 수 있어요", "what": "이런 걸 볼 수 있어요",
    "title": "메이플랜드 아이템 도감 — 장비 옵션 범위·착용 조건·드랍 몬스터 | Your Maple",
    "h1": "아이템 도감",
    "desc": "메이플랜드 아이템 3,500여 종의 장비 기본 옵션과 옵션 범위, 착용 레벨·직업, 공격속도, 업그레이드 가능 횟수, 드랍 몬스터를 검색해 보세요. 혼줌처럼 줄임말로도 찾아요.",
    "lead": "장비는 기본 옵션과 나올 수 있는 범위를 막대로, 착용 조건과 직업을 한눈에 보여 주고, 어떤 몬스터가 드랍하는지까지 이어 줘요.",
    "art": [("/img/pianus-scale.png", 300, 292, "피아누스의 비늘"), ("/img/chaos-scroll.png", 60, 60, "혼돈의 주문서")],
    "cards": [
      ("장비 옵션 범위", "공격력·주스탯 등 기본 옵션과 나올 수 있는 최소~최대 범위를 막대 위에 함께 보여 줘요."),
      ("착용 조건", "착용 레벨·STR·DEX·INT·LUK·인기도와 착용 가능 직업, 공격속도, 업그레이드 가능 횟수를 확인해요."),
      ("드랍 몬스터", "그 아이템을 드랍하는 몬스터와 레벨, 몬스터별 드랍 확률을 보여 줘요."),
      ("편한 검색", "띄어쓰기를 무시하고 글자 순서로 찾아요. '혼줌'·'혼주문'으로도 혼돈의 주문서가 나와요."),
    ],
    "rules_title": "이용 안내",
    "rules": [
      "도감 수치는 공개된 자료와 운영자 확인을 바탕으로 정리한 참고 정보예요. 실제 게임과 다를 수 있어요.",
      "자료가 없는 값은 '미제공'으로 따로 표시하고, 0과 구분해요.",
      "장비에 레벨업 가능 횟수가 등록되어 있으면 상세에서 확인할 수 있어요.",
      "혼돈의 주문서 시뮬레이터와 거래 장부에서도 같은 도감 아이템을 골라 쓸 수 있어요.",
    ],
    "steps": ["아이템 도감을 열고 이름(줄임말도 돼요)으로 검색해요.", "아이템을 누르면 옵션 범위·착용 조건·드랍 몬스터가 나와요.", "드랍 몬스터를 누르면 몬스터 도감으로 이어져요."],
    "faq": [
      ("틀린 정보는 어떻게 알리나요?", "yourmaplekr@gmail.com으로 아이템 이름과 틀린 내용을 보내 주세요. 확인해서 고쳐요."),
      ("로그인해야 볼 수 있나요?", "아니요. 아이템 도감은 로그인 없이 볼 수 있어요."),
    ],
  },
  {
    "slug": "transport", "app": "/#/dashboard", "eyebrow": "MAPLELAND · 교통",
    "title": "메이플랜드 배 시간표·헬리오스탑 엘리베이터 | Your Maple",
    "h1": "메이플랜드 배 시간표와 헬리오스탑",
    "desc": "메랜 배 탑승 시작·마감·출발 시간과 헬리오스탑 엘리베이터 상행·하행 주기를 확인하세요. 실시간 남은 시간은 Your Maple 상단 교통 위젯에서 볼 수 있어요.",
    "lead": "메랜 배는 10분 간격으로 출발해요. 출발 5분 전부터 탈 수 있고, 1분 전에는 탑승이 마감돼요.",
    "art": [("/img/ship-icon.png", 120, 120, "배"), ("/img/helios-icon.png", 72, 72, "헬리오스탑 엘리베이터")],
    "what": "탑승과 출발 시간",
    "cta": "실시간 시간표 열기",
    "note": "로그인 없이 확인할 수 있어요",
    "cards": [
      ("배 탑승 시작", "매시 05·15·25·35·45·55분부터 탑승할 수 있어요."),
      ("배 탑승 마감", "매시 09·19·29·39·49·59분에 닫혀요. 예를 들어 10:20 배는 10:19에 탑승이 마감돼요."),
      ("배 출발", "매시 00·10·20·30·40·50분에 출발해요."),
      ("헬리오스탑 엘리베이터", "4분마다 반복돼요. 예를 들어 10:01 상행 탑승 대기 → 10:02 상행 출발 → 10:03 하행 탑승 대기 → 10:04 하행 출발이에요."),
    ],
    "rules_title": "시간표 기준",
    "rules": [
      "한국 시각 기준이에요. 실시간 위젯은 사이트 서버 시각에 맞추고, 동기화에 실패하면 기기 시각 기준으로 표시해요.",
      "앱에서 계산한 시간표이므로 게임 내 실제 탑승 상태도 확인해 주세요.",
    ],
    "steps": ["아래 버튼으로 Your Maple을 열어요.", "화면 상단에서 배와 엘리베이터의 상태, 다음 전환까지 남은 시간을 봐요.", "교통 위젯을 누르면 다음 출발과 탑승 마감 시각이 보여요."],
    "faq": [
      ("10시 20분 배는 언제부터 탈 수 있나요?", "10시 15분부터 10시 19분 직전까지 탈 수 있어요."),
      ("엘리베이터는 몇 분마다 출발하나요?", "상행과 하행은 각각 4분 간격으로 출발하고, 두 방향의 출발은 2분씩 번갈아 와요."),
    ],
  },
]

NAV = [("dojo", "무릉도장"), ("maker", "메이커"), ("chaos-scroll", "혼돈의 주문서"), ("level-up", "레벨업"), ("monster-park", "몬스터파크"), ("monsters", "몬스터 도감"), ("items", "아이템 도감"), ("transport", "배 시간표·헬리오스탑")]


def page(p):
    url = f"{SITE}/{p['slug']}/"
    # 기간이 끝난 이벤트는 만들 때 종료 안내로 바꾼다. 다시 만들기 전에도 브라우저에서 날짜를 보고 바꾼다(아래 스크립트).
    ended = bool(p.get("until")) and datetime.date.today().isoformat() > p["until"]
    if ended:
        p = {**p, "title": p["ended"]["title"], "lead": p["ended"]["lead"]}
    art = "".join(f'<img src="{src}" width="{w}" height="{h}" alt="{e(alt)}" loading="eager" />' for src, w, h, alt in p["art"])
    until = p.get("until")
    ended_html = ""
    if until:
        ended_html = (f'<div class="ended-notice" data-ended-notice{"" if ended else " hidden"}><strong>종료된 이벤트예요</strong><p>{e(p["ended"]["lead"])}</p>'
                      '<a class="ghost-cta" href="/">다른 기능 보기</a></div>')
    ended_script = ""
    if until and not ended:
        ended_script = ("  <script>(function(){var d=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date());"
                        f"if(d>'{until}'){{document.documentElement.classList.add('is-ended');var n=document.querySelector('[data-ended-notice]');if(n)n.hidden=false;}}}})();</script>\n")
    cards = "".join(f'<li class="feature-card" style="--i:{i}"><h3>{e(t)}</h3><p>{e(d)}</p></li>' for i, (t, d) in enumerate(p["cards"]))
    rules = "".join(f"<li>{e(r)}</li>" for r in p["rules"])
    steps = "".join(f"<li>{e(s)}</li>" for s in p["steps"])
    faq = "".join(f"<details><summary>{e(q)}</summary><p>{e(a)}</p></details>" for q, a in p["faq"])
    extra = "".join(f'<a class="ghost-cta" href="{href}">{e(label)}</a>' for href, label in p.get("links", []))
    others = "".join(f'<a href="/{slug}/"{" aria-current=\"page\"" if slug == p["slug"] else ""}>{e(label)}</a>' for slug, label in NAV)
    ld = {
        "@context": "https://schema.org", "@type": "WebApplication", "name": p["h1"], "url": url,
        "applicationCategory": "GameApplication", "operatingSystem": "Web", "inLanguage": "ko",
        "description": p["desc"], "isAccessibleForFree": True,
        "offers": {"@type": "Offer", "price": "0", "priceCurrency": "KRW"},
        "publisher": {"@type": "Organization", "name": "Your Maple", "url": SITE + "/"},
    }
    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{e(p['title'])}</title>
  <meta name="description" content="{e(p['desc'])}" />
  <link rel="canonical" href="{url}" />
  <meta property="og:type" content="website" />
  <meta property="og:locale" content="ko_KR" />
  <meta property="og:site_name" content="Your Maple" />
  <meta property="og:title" content="{e(p['title'])}" />
  <meta property="og:description" content="{e(p['desc'])}" />
  <meta property="og:url" content="{url}" />
  <meta property="og:image" content="{SITE}/apple-touch-icon.png" />
  <meta name="twitter:card" content="summary" />
  <link rel="icon" href="/favicon.ico" sizes="any" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="stylesheet" href="/css/public.css" />
  <link rel="stylesheet" href="/css/feature.css" />
  <script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>
</head>
<body class="feature-page">
  <!-- 기능 소개(검색 색인용, 2026-11-04). tools/build_feature_pages.py 로 만든다. 문구를 고치면 그 파일을 고치고 다시 실행한다. -->
  <a class="skip-link" href="#content">본문으로 건너뛰기</a>
  <header class="site-header"><a class="brand" href="/"><img src="/apple-touch-icon.png" width="36" height="36" alt="" />Your Maple</a><a class="back-link" href="{p['app']}">바로 쓰기 <span aria-hidden="true">↗</span></a></header>
  <main id="content" tabindex="-1">
    <div class="feature-hero">
      <div class="hero"><p class="eyebrow">{e(p['eyebrow'])}</p><h1>{e(p['h1'])}</h1><p class="lead">{e(p['lead'])}</p>
        {ended_html}<div class="cta-row"{' hidden' if ended else ''}><a class="cta" href="{p['app']}">{e(p.get("cta", "도감 바로 보기" if p.get("what") else "무료로 바로 쓰기"))}</a>{extra}</div>
        <p class="version">{e(p.get("note", "로그인 없이 계산할 수 있어요 · 저장할 때만 Google·Discord 로그인"))}</p></div>
      <div class="feature-art{' is-smooth' if p.get('smooth') else ''}">{art}</div>
    </div>
    <section aria-labelledby="t-what"><p class="section-number">01</p><h2 id="t-what">{e(p.get("what", "이런 걸 계산해요"))}</h2><ul class="feature-cards">{cards}</ul></section>
    <section aria-labelledby="t-rules"><p class="section-number">02</p><h2 id="t-rules">{e(p['rules_title'])}</h2><ul>{rules}</ul>{'' if p.get('what') else '<p class="hint">계산 결과는 입력한 값과 위 기준으로 낸 참고값이에요. 실제 게임 결과를 보장하지 않아요.</p>'}</section>
    <section aria-labelledby="t-how"><p class="section-number">03</p><h2 id="t-how">이렇게 써요</h2><ol class="steps">{steps}</ol><a class="cta" href="{p['app']}">{e(p['h1'])} 열기</a></section>
    <section aria-labelledby="t-faq"><p class="section-number">04</p><h2 id="t-faq">자주 묻는 질문</h2><div class="faq">{faq}</div></section>
    <nav class="feature-nav" aria-label="다른 기능">{others}</nav>
  </main>
{ended_script}  <footer><a class="footer-brand" href="/">Your Maple</a><nav aria-label="정책"><a href="/privacy.html">개인정보 처리방침</a><a href="/terms.html">이용약관</a><a href="mailto:yourmaplekr@gmail.com">문의</a></nav><p>Nexon·메이플스토리의 공식 서비스가 아닌 이용자 도구입니다.</p></footer>
</body>
</html>
"""


for p in PAGES:
    out = root / p["slug"] / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page(p), encoding="utf-8")
    print("wrote", out.relative_to(root))
