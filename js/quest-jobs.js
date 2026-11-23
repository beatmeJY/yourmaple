// 퀘스트 직업 제한(게임 직업 번호 배열)을 사람이 읽는 직업 이름으로 바꾼다(sql/077 catalog_quests.jobs).
// 같은 계열의 전직 번호(예: 110·111·112)는 한 이름으로 묶고, 모험가 다섯 계열이 모두 있으면 "모험가", 시그너스 다섯이 모두 있으면 "시그너스 기사단"으로 줄인다.
const EXACT = {
  0: "초보자", 1000: "노블레스", 2000: "아란", 2001: "에반", 2002: "메르세데스", 2003: "팬텀", 2004: "루미너스", 2005: "은월",
  3000: "시티즌", 3001: "데몬", 3002: "제논", 5000: "미하일", 6000: "카이저", 6001: "엔젤릭버스터", 10000: "제로", 13000: "핑크빈", 14000: "키네시스", 15000: "일리움",
};
// 전직 번호의 백의 자리 묶음(예: 1100번대 = 소울마스터).
const FAMILY = {
  1: "전사", 2: "마법사", 3: "궁수", 4: "도적", 5: "해적",
  11: "소울마스터", 12: "플레임위자드", 13: "윈드브레이커", 14: "나이트워커", 15: "스트라이커",
  21: "아란", 22: "에반", 23: "메르세데스", 24: "팬텀", 25: "은월", 27: "루미너스",
  31: "데몬", 32: "배틀메이지", 33: "와일드헌터", 35: "메카닉", 36: "제논", 37: "블래스터",
  51: "미하일", 61: "카이저", 64: "카데나", 65: "엔젤릭버스터", 101: "제로", 131: "핑크빈", 142: "키네시스", 152: "일리움", 155: "아크",
};
const EXPLORERS = ["전사", "마법사", "궁수", "도적", "해적"];
const CYGNUS = ["소울마스터", "플레임위자드", "윈드브레이커", "나이트워커", "스트라이커"];

export function questJobName(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 0) return "";
  if (Object.hasOwn(EXACT, n)) return EXACT[n];
  if (n >= 430 && n <= 435) return "듀얼블레이드";
  if (n === 501 || (n >= 530 && n <= 533)) return "캐논슈터";
  return FAMILY[Math.floor(n / 100)] ?? `직업 ${n}`;
}

// 빈 배열·없음이면 [](제한 없음).
export function questJobGroups(jobs) {
  const names = [...new Set((Array.isArray(jobs) ? jobs : []).map(questJobName).filter(Boolean))];
  const squash = (group, label) => {
    if (!group.every(name => names.includes(name))) return;
    const at = names.indexOf(group[0]);
    group.forEach(name => names.splice(names.indexOf(name), 1));
    names.splice(Math.min(at, names.length), 0, label);
  };
  squash(EXPLORERS, "모험가");
  squash(CYGNUS, "시그너스 기사단");
  return names;
}

// 카드·상세에 쓰는 짧은 글: 너무 많으면 앞 max개 + "외 n".
export function questJobText(jobs, max = 4) {
  const names = questJobGroups(jobs);
  if (!names.length) return "";
  return names.length > max ? `${names.slice(0, max).join("·")} 외 ${names.length - max}` : names.join("·");
}
