// 아이템 도감 분류(2026-11-23 사용자 요청): 종류 → 장비면 직업 5개 → 부위.
// 착용 직업은 아이템에 5종(전사·마법사·궁수·도적·해적)과 공용으로만 적혀 있어, 듀얼블레이드는 도적, 배틀메이지는 마법사 장비를 쓴다.
// 부위 이름 묶기(Pole Arm=Polearm 등)는 sql/075 의 public.catalog_item_part 와 같아야 한다(한쪽을 고치면 다른 쪽도).

export const itemKinds = [
  { key: "", label: "전체" },
  { key: "equip", label: "장비" },
  { key: "use", label: "소비" },
  { key: "etc", label: "기타" },
  { key: "setup", label: "설치" },
  { key: "cash", label: "캐시" },
];

// 색은 직업 계열 다크 색(sql/008, 거래 옵션 칩과 같음).
export const equipmentJobs = [
  { key: "전사", color: "#f87171" },
  { key: "마법사", color: "#38bdf8" },
  { key: "궁수", color: "#4ade80" },
  { key: "도적", color: "#d8b4fe" },
  { key: "해적", color: "#c4a484" },
];

// 화면에 보일 순서: 방어구 → 장신구 → 무기.
export const equipmentParts = [
  ["Hat", "모자", "armor"], ["Top", "상의", "armor"], ["Bottom", "하의", "armor"], ["Overall", "한벌옷", "armor"],
  ["Shoes", "신발", "armor"], ["Glove", "장갑", "armor"], ["Cape", "망토", "armor"], ["Shield", "방패", "armor"],
  ["Earrings", "귀고리", "accessory"], ["Face Accessory", "얼굴장식", "accessory"], ["Eye Accessory", "눈장식", "accessory"],
  ["Pendant", "펜던트", "accessory"], ["Belt", "벨트", "accessory"], ["Ring", "반지", "accessory"],
  ["Shoulder Accessory", "어깨장식", "accessory"], ["Medal", "훈장", "accessory"], ["Mount", "라이딩", "accessory"],
  ["One-Handed Sword", "한손검", "weapon"], ["Two-Handed Sword", "두손검", "weapon"], ["One-Handed Axe", "한손도끼", "weapon"],
  ["Two-Handed Axe", "두손도끼", "weapon"], ["One-Handed Blunt Weapon", "한손둔기", "weapon"], ["Two-Handed Blunt", "두손둔기", "weapon"],
  ["Spear", "창", "weapon"], ["Polearm", "폴암", "weapon"], ["Wand", "완드", "weapon"], ["Staff", "스태프", "weapon"],
  ["Bow", "활", "weapon"], ["Crossbow", "석궁", "weapon"], ["Claw", "아대", "weapon"], ["Dagger", "단검", "weapon"],
  ["Katara", "블레이드", "weapon"], ["Knuckle", "너클", "weapon"], ["Gun", "건", "weapon"],
].map(([key, label, group]) => ({ key, label, group }));

export const partGroups = { armor: "방어구", accessory: "장신구", weapon: "무기" };

const partAliases = { "Pole Arm": "Polearm", "Two-Handed Blunt Weapon": "Two-Handed Blunt" };
export const itemPart = (subcategory) => (subcategory ? partAliases[subcategory] ?? subcategory : null);

export function itemKindKey(category) {
  if (["장비", "방어구", "무기", "Equip"].includes(category)) return "equip";
  if (["소비", "Use"].includes(category)) return "use";
  if (["설치", "Setup"].includes(category)) return "setup";
  if (["기타", "Etc"].includes(category)) return "etc";
  if (category === "Cash") return "cash";
  return "other";
}

// 직업·부위를 고르면 장비만 본다. 공용 장비는 common 이 켜져 있으면 그 직업 목록에도 함께 보인다.
export function itemFilterMatch(item, jobs = [], { kind = "", job = "", part = "", common = true } = {}) {
  const wantKind = kind || (job || part ? "equip" : "");
  if (wantKind && itemKindKey(item.category) !== wantKind) return false;
  if (job && !(jobs.includes(job) || (common && jobs.includes("공용")))) return false;
  if (part && itemPart(item.subcategory) !== part) return false;
  return true;
}
