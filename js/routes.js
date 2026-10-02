// 메뉴를 추가할 때는 이 목록에 한 줄 넣고, js/pages/ 에 화면 파일을 추가합니다.
export const routes = [
  { id: "dashboard", label: "홈" },
  { id: "characters", label: "캐릭터" },
  { id: "hunts", label: "사냥" },
  { id: "level-plan", label: "레벨업 계산" },
  { id: "dojo", label: "무릉" },
  { id: "maker", label: "메이커 계산" },
  { id: "enhance", label: "강화 계산" },
  { id: "monsters", label: "몬스터" },
  { id: "trades", label: "거래" },
  { id: "quests", label: "퀘스트" },
  { id: "notes", label: "메모" },
  { id: "links", label: "링크", pin: true, quick: true },
];
