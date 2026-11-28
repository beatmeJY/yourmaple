// 물약 효율 화면에 쓰는 상점 물약 자료(2026-11-28 정리).
// hp·mp: 한 개로 회복하는 양. hpPct·mpPct: 최대 HP·MP의 %로 회복(cap = 최대치가 1만을 넘을 때 회복하는 고정량).
// price·npc·map: 일반 상점 중 가장 싼 곳. myo: 묘묘 상점(루디브리엄 고양이 상점) 가격, 안 팔면 없음.
// 가격은 공개 상점 자료와 사용자 캡처(묘묘·캄퐁 마을, 2026-11-28)를 그대로 옮겼다.
// 회복량은 공용 도감 효과 문구 기준. unsure = 도감에 없어 해외판 게임 자료 값을 쓴 것(메이플랜드 확인 필요).
// 회복이 아니라 능력치만 올리는 음식(나시 르막·로티 프라타·꾸이·사이다·명사수의 물약)은 넣지 않는다.

const MALAYSIA = { npc: "캄퐁 마을 상점", map: "말레이시아", malaysia: true };

export const POTIONS = [
  // HP만
  { id: 2010000, name: "사과", hp: 30, price: 28, npc: "페퍼", map: "지구방위본부", myo: 28 },
  { id: 2010002, name: "달걀", hp: 50, price: 47, npc: "사탕기계", map: "에오스탑 61층~70층", myo: 47 },
  { id: 2000000, name: "빨간 포션", hp: 50, price: 47, npc: "미스키", map: "루디브리엄", myo: 47 },
  { id: 2000007, name: "빨간 포션 알약", hp: 50, price: 50, npc: "미스키", map: "루디브리엄" },
  { id: 2010001, name: "짐승의 고기", hp: 100, price: 100, npc: "페퍼", map: "지구방위본부", myo: 106 },
  { id: 2000001, name: "주황 포션", hp: 150, price: 152, npc: "미스키", map: "루디브리엄", myo: 152 },
  { id: 2000008, name: "주황 포션 알약", hp: 150, price: 160, npc: "미스키", map: "루디브리엄" },
  { id: 2020001, name: "통닭", hp: 200, price: 209, npc: "미스키", map: "루디브리엄" },
  { id: 2000002, name: "하얀 포션", hp: 300, price: 304, npc: "미스키", map: "루디브리엄", myo: 304 },
  { id: 2000009, name: "하얀 포션 알약", hp: 300, price: 320, npc: "미스키", map: "루디브리엄" },
  { id: 2020005, name: "길쭉이 핫도그", hp: 300, price: 304, npc: "미스키", map: "루디브리엄" },
  { id: 2020003, name: "피자", hp: 400, price: 427, npc: "미스키", map: "루디브리엄" },
  { id: 2020004, name: "햄버거", hp: 400, price: 427, npc: "미스키", map: "루디브리엄" },
  { id: 2020006, name: "뚱뚱이 핫도그", hp: 500, price: 503, npc: "미스키", map: "루디브리엄" },
  { id: 2022020, name: "키노코라면(소금)", hp: 500, price: 550, npc: "로보", map: "버섯신사", myo: 523 },
  { id: 2022019, name: "키노코라면(돼지사골)", hp: 800, price: 850, npc: "로보", map: "버섯신사", myo: 808 },
  { id: 2022003, name: "장어 구이", hp: 1000, price: 1045, npc: "페퍼", map: "지구방위본부", myo: 1045 },
  { id: 2022017, name: "라면", hp: 1000, price: 1100, npc: "로보", map: "버섯신사", myo: 1045 },
  { id: 2002025, name: "광전사의 엘릭서", hp: 1500, price: 1600, npc: "미키", map: "뉴리프시티" },
  { id: 2022018, name: "키노코라면(구운돼지)", hp: 1500, price: 1600, npc: "로보", map: "버섯신사", myo: 1520 },
  { id: 2001001, name: "쭈쭈바", hp: 2000, price: 2185, npc: "미스키", map: "루디브리엄", myo: 2185 },
  { id: 2020012, name: "살살녹는 치즈", hp: 4000, price: 4500, npc: "톨이", map: "시간의 통로", myo: 4270 },
  { id: 2020013, name: "순록의 우유", hp: 5000, price: 5600, npc: "페퍼", map: "지구방위본부", myo: 5320 },
  { id: 2022203, name: "락사", hp: 800, price: 850, ...MALAYSIA, myo: 808 },
  { id: 2022204, name: "호키엔 미", hp: 1200, price: 1280, ...MALAYSIA, myo: 1220 },
  { id: 2022205, name: "당근 케이크", hp: 1800, price: 1920, ...MALAYSIA, myo: 1820 },
  { id: 2022206, name: "치킨 라이스", hp: 2200, price: 2340, ...MALAYSIA, myo: 2220 },
  { id: 2022207, name: "사테", hp: 2600, price: 2770, ...MALAYSIA, myo: 2630 },
  { id: 2022476, name: "치킨 카피탄", hp: 4000, price: 4260, ...MALAYSIA, myo: 4070, unsure: true, icon: "GMS/255" },
  { id: 2002021, name: "혼스터", hpPct: 60, hpCap: 6000, price: 6700, npc: "미키", map: "뉴리프시티" },

  // MP만
  { id: 2010009, name: "초록 사과", mp: 30, price: 40, npc: "도란", map: "쇼와 마을" },
  { id: 2010003, name: "오렌지", mp: 50, price: 95, npc: "페퍼", map: "지구방위본부", myo: 95 },
  { id: 2000003, name: "파란 포션", mp: 100, price: 190, npc: "미스키", map: "루디브리엄", myo: 190 },
  { id: 2000010, name: "파란 포션 알약", mp: 100, price: 200, npc: "미스키", map: "루디브리엄" },
  { id: 2010004, name: "레몬", mp: 150, price: 294, npc: "페퍼", map: "지구방위본부", myo: 294 },
  { id: 2020000, name: "샐러드", mp: 200, price: 420, npc: "24시간 포장마차", map: "개미굴광장" },
  { id: 2022021, name: "어묵(꼬치)", mp: 250, price: 550, npc: "쟈켄", map: "버섯신사" },
  { id: 2000006, name: "마나 엘릭서", mp: 300, price: 589, npc: "미스키", map: "루디브리엄", myo: 589 },
  { id: 2000011, name: "마나 엘릭서 알약", mp: 300, price: 620, npc: "미스키", map: "루디브리엄" },
  { id: 2022022, name: "어묵(접시)", mp: 500, price: 1300, npc: "쟈켄", map: "버섯신사" },
  { id: 2022000, name: "맑은 물", mp: 800, price: 1567, npc: "페퍼", map: "지구방위본부", myo: 1567 },
  { id: 2002024, name: "대마법사의 엘릭서", mp: 1500, price: 3700, npc: "미키", map: "뉴리프시티" },
  { id: 2001002, name: "팥빙수", mp: 2000, price: 3800, npc: "미스키", map: "루디브리엄", myo: 3800 },
  { id: 2020014, name: "새벽의 이슬", mp: 4000, price: 7695, npc: "페퍼", map: "지구방위본부", myo: 7695 },
  { id: 2020015, name: "황혼의 이슬", mp: 5000, price: 9690, npc: "페퍼", map: "지구방위본부", myo: 9690 },
  { id: 2022208, name: "구아바", mp: 500, price: 1020, ...MALAYSIA, myo: 970 },
  { id: 2022209, name: "람부탄", mp: 800, price: 1630, ...MALAYSIA, myo: 1567 },
  { id: 2022210, name: "용과", mp: 1600, price: 3360, ...MALAYSIA, myo: 3240 },
  { id: 2022211, name: "두리안", mp: 3200, price: 6530, ...MALAYSIA, myo: 6160 },
  { id: 2022477, name: "미 시암", mp: 4000, price: 8160, ...MALAYSIA, myo: 7695, unsure: true, icon: "GMS/255" },
  { id: 2002020, name: "마나불", mpPct: 60, mpCap: 6000, price: 12200, npc: "미키", map: "뉴리프시티" },

  // HP·MP 둘 다
  { id: 2020002, name: "케이크", hp: 100, mp: 100, price: 304, npc: "미스키", map: "루디브리엄" },
  { id: 2022014, name: "당고", hp: 200, mp: 200, price: 650, npc: "타루", map: "버섯신사" },
  { id: 2022023, name: "삼색 당고", hp: 400, mp: 400, price: 1350, npc: "타루", map: "버섯신사" },
  { id: 2022041, name: "새우튀김", hp: 500, mp: 500, price: 1600, npc: "오안네스", map: "아쿠아리움" },
  { id: 2020028, name: "초콜릿", hp: 1000, mp: 1000, price: 2850, npc: "미스키", map: "루디브리엄" },
  { id: 2001000, name: "수박", hp: 1000, mp: 1000, price: 3040, npc: "페퍼", map: "지구방위본부", myo: 3040 },
  { id: 2002022, name: "인삼 원액", hpPct: 40, hpCap: 4000, mpPct: 40, mpCap: 4000, price: 10000, npc: "미키", map: "뉴리프시티" },
  { id: 2002023, name: "진저 에일", hpPct: 75, hpCap: 7500, mpPct: 75, mpCap: 7500, price: 18750, npc: "미키", map: "뉴리프시티" },
  { id: 2022195, name: "메이플에이드", hpPct: 90, hpCap: 9000, mpPct: 80, mpCap: 8000, price: 20000, npc: "미키", map: "뉴리프시티", extra: "30분간 공격력 +1" },
];

export function potionIcon(potion) {
  return `https://maplestory.io/api/${potion.icon ?? "GMS/83"}/item/${potion.id}/icon`;
}
