import { escapeHtml, formatCount, readBig } from "./format.js";
import { catalogImage } from "./catalog-image.js";
import { itemOptionFields } from "./item-options.js";

const text = value => escapeHtml(value == null || value === "" ? "미제공" : String(value));
const labels = Object.fromEntries(itemOptionFields.map(field => [field.key, field.label]));
const detailLabels = { hp_percent:"HP 증가율",mp_percent:"MP 증가율", defense: "물리 방어력", magic_defense: "마법 방어력", accuracy: "명중률", avoidability: "회피율" };
const types = {
  Hat: "모자", Top: "상의", Bottom: "하의", Overall: "한벌옷", Shoes: "신발", Glove: "장갑",
  Cape: "망토", Earrings: "귀고리", Shield: "방패", "Face Accessory": "얼굴장식",
  "Eye Accessory": "눈장식", Belt: "벨트", Pendant: "펜던트", Ring: "반지", Mount: "라이딩",
  Claw: "아대", Dagger: "단검", Bow: "활", Crossbow: "석궁", Staff: "스태프", Wand: "완드",
  Spear: "창", Polearm: "폴암", "Pole Arm": "폴암", Gun: "건", Knuckle: "너클",
  "One-Handed Sword": "한손검", "Two-Handed Sword": "두손검", "One-Handed Axe": "한손도끼",
  "Two-Handed Axe": "두손도끼", "One-Handed Blunt Weapon": "한손둔기",
  "Two-Handed Blunt": "두손둔기", "Two-Handed Blunt Weapon": "두손둔기",
};
export const equipmentTypeName = type => types[type] ?? type ?? "";
export const isEquipment = item => ["장비", "방어구", "무기", "Equip"].includes(item.category);

export function equipmentCard({ item, stats = [], requirements = [], jobs = [], attributes = [] }) {
  // 별도 컬럼으로 이미 표시한 조건과 옵션은 추가 정보에서 반복하지 않습니다.
  const repeatedAttributes = new Set(["level", "str", "dex", "int", "luk", "fame", "pop", "REQ JOB", "GENDER", "상점가", "공격속도", "업그레이드 가능 횟수"]);
  const extraAttributes = attributes.filter(attribute => !repeatedAttributes.has(attribute.attribute_name?.trim()));
  const required = Object.fromEntries(requirements.map(row => [row.requirement_key, row.required_value]));
  const conditions = [["레벨", item.required_level], ...["str", "dex", "int", "luk"].map(key => [key.toUpperCase(), required[key]]), ["인기도", required.fame ?? required.pop]];
  const jobNames = ["전사", "마법사", "궁수", "도적", "해적"];
  const allJobs = jobs.includes("공용");
  const price = readBig(item.shop_sell_price, "상점 판매가").value;
  const typeName = types[item.subcategory] || item.subcategory || "장비";
  const path = [item.category, item.middle_category, types[item.subcategory] || item.subcategory].filter(Boolean).join(" · ");
  // 가능 범위는 막대로, 기본값은 막대 위 점으로 보여 줍니다. 범위가 없으면 —만 둡니다.
  const rangeBar = (base, min, max, unit="") => {
    if (min == null && max == null) return `<small class="equipment-range is-unknown">—<span class="sr-only"> 범위 미제공</span></small>`;
    const low = Number(min), high = Number(max), value = Number(base);
    const pos = Number.isFinite(low) && Number.isFinite(high) && Number.isFinite(value) && base != null
      ? (high > low ? Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100)) : 50) : null;
    return `<span class="equipment-range-bar" aria-hidden="true"><i></i>${pos == null ? "" : `<b style="left:${pos.toFixed(1)}%"></b>`}</span><small class="equipment-range">${text(min)}${unit} ~ ${text(max)}${unit}</small>`;
  };
  const row = (label, value, range = `<small class="equipment-range is-unknown">—<span class="sr-only"> 범위 미제공</span></small>`, index = 0) => `<div class="catalog-stat equipment-stat" style="--i:${index}"><dt>${text(label)}</dt><dd><strong>${text(value)}</strong><span class="equipment-range-cell">${range}</span></dd></div>`;
  const order = itemOptionFields.map(field => field.key);
  const ordered = [...stats].sort((a, b) => {
    return (order.indexOf(a.stat_key) < 0 ? 999 : order.indexOf(a.stat_key)) - (order.indexOf(b.stat_key) < 0 ? 999 : order.indexOf(b.stat_key));
  });
  const hasSpeed = item.attack_speed_label != null || item.attack_speed != null;
  const statRows = ordered.map((stat, index) => row(
    stat.stat_key === "remaining_upgrades" ? "업그레이드 가능 횟수" : detailLabels[stat.stat_key] || labels[stat.stat_key] || stat.stat_key,
    stat.base_value == null ? null : `${Number(stat.base_value) > 0 && !stat.stat_key.includes("upgrades") ? "+" : ""}${stat.base_value}${stat.stat_key.endsWith("_percent")?"%":""}`,
    rangeBar(stat.base_value, stat.minimum_value, stat.maximum_value,stat.stat_key.endsWith("_percent")?"%":""),
    index + (hasSpeed ? 1 : 0),
  )).join("");
  return `<article class="equipment-card ym-glass catalog-item-hero"><span class="equipment-glow" aria-hidden="true"></span>
    <header class="equipment-head"><div class="equipment-art catalog-detail-art">${catalogImage(item.image_url, "", 120) || `<span class="equipment-initial">${text([...item.name][0])}</span>`}<span class="equipment-art-label">ITEM</span></div>
      <div class="equipment-title"><div class="equipment-chips"><span class="equipment-chip is-type">${text(typeName)}</span>${path ? `<span class="equipment-chip">${text(path)}</span>` : ""}${item.gender_restriction && item.gender_restriction !== "공용" ? `<span class="equipment-chip">${text(item.gender_restriction)}</span>` : ""}</div><h1>${text(item.name)}</h1>
      <div class="equipment-jobs" aria-label="착용 가능 직업">${jobNames.map(job => `<span class="equipment-job${allJobs || jobs.includes(job) ? " is-allowed" : ""}"><i aria-hidden="true"></i>${job}<span class="sr-only">${allJobs || jobs.includes(job) ? " 착용 가능" : jobs.length ? " 착용 불가" : " 정보 미제공"}</span></span>`).join("")}</div>${jobs.length ? "" : `<p class="hint">착용 직업 미제공</p>`}</div></header>
    <dl class="equipment-requirements" aria-label="착용 조건">${conditions.map(([label, value]) => `<div class="${value == null || value === "" ? "is-empty" : ""}"><dt>${text(label)}</dt><dd>${value == null || value === "" ? `—<span class="sr-only">미제공</span>` : text(value)}</dd></div>`).join("")}</dl>
    <section class="equipment-options"><div class="equipment-options-head"><h2>기본 옵션</h2><span>기본값</span><span>가능 범위</span></div>
    <dl class="equipment-stats">${hasSpeed ? row("공격속도", item.attack_speed_label ?? item.attack_speed) : ""}${item.level_up_count==null?"":row("레벨업 가능 횟수",`${item.level_up_count}회`)}${statRows || (hasSpeed || item.level_up_count!=null ? "" : `<p class="hint">제공된 수치 옵션이 없습니다.</p>`)}</dl><p class="equipment-options-note">범위는 얻을 때 붙을 수 있는 옵션이에요. —는 범위 미제공이고, 거래되는 물건마다 다를 수 있어요.</p></section>
    ${item.description?.trim() || item.effect_description?.trim() ? `<section class="equipment-description"><h2>아이템 설명</h2>${item.description?.trim()?`<p>${text(item.description)}</p>`:""}${item.effect_description?.trim()&&item.effect_description!==item.description?`<p>${text(item.effect_description)}</p>`:""}</section>`:""}
    <footer><span>상점 판매가</span><strong>${price == null ? "미제공" : `${text(formatCount(price))} 메소`}</strong></footer>
    ${extraAttributes.length ? `<details class="equipment-extra"><summary>추가 정보<span aria-hidden="true">›</span></summary><dl class="catalog-facts">${extraAttributes.map(attribute => `<div><dt>${text(attribute.attribute_name)}</dt><dd>${text(attribute.value_text)}</dd></div>`).join("")}</dl></details>` : ""}
  </article>`;
}
