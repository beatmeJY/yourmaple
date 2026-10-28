import { escapeHtml, formatCount, readBig } from "./format.js";
import { catalogImage } from "./catalog-image.js";
import { itemOptionFields } from "./item-options.js";

const text = value => escapeHtml(value == null || value === "" ? "미제공" : String(value));
const labels = Object.fromEntries(itemOptionFields.map(field => [field.key, field.label]));
const detailLabels = { defense: "물리 방어력", magic_defense: "마법 방어력", accuracy: "명중률", avoidability: "회피율" };
const types = { Hat: "모자", Claw: "아대", "Two-Handed Sword": "두손검" };
export const isEquipment = item => ["장비", "방어구", "무기"].includes(item.category);

export function equipmentCard({ item, stats = [], requirements = [], jobs = [], attributes = [] }) {
  const required = Object.fromEntries(requirements.map(row => [row.requirement_key, row.required_value]));
  const conditions = [["착용 레벨", item.required_level], ...["str", "dex", "int", "luk"].map(key => [key.toUpperCase(), required[key]]), ["인기도", required.fame ?? required.pop]];
  const jobNames = ["전사", "마법사", "궁수", "도적", "해적"];
  const allJobs = jobs.includes("공용");
  const price = readBig(item.shop_sell_price, "상점 판매가").value;
  const row = (label, value, range = "") => `<div class="catalog-stat equipment-stat"><dt>${text(label)}</dt><dd><strong>${text(value)}</strong>${range}</dd></div>`;
  const ordered = [...stats].sort((a, b) => {
    const order = itemOptionFields.map(field => field.key);
    return (order.indexOf(a.stat_key) < 0 ? 999 : order.indexOf(a.stat_key)) - (order.indexOf(b.stat_key) < 0 ? 999 : order.indexOf(b.stat_key));
  });
  return `<article class="equipment-card ym-glass catalog-item-hero"><header><span class="ym-chip">장비 정보</span><h1>${text(item.name)}</h1></header>
    <div class="equipment-overview"><div class="equipment-art catalog-detail-art">${catalogImage(item.image_url, "", 120) || `<span>${text([...item.name][0])}</span>`}</div><dl class="equipment-requirements">${conditions.map(([label, value]) => `<div><dt>${text(label)}</dt><dd>${text(value)}</dd></div>`).join("")}</dl></div>
    <div class="equipment-jobs" aria-label="착용 가능 직업">${jobNames.map(job => `<span class="equipment-job${allJobs || jobs.includes(job) ? " is-allowed" : ""}">${job}<span class="sr-only">${allJobs || jobs.includes(job) ? " 착용 가능" : jobs.length ? " 착용 불가" : " 정보 미제공"}</span></span>`).join("")}</div>${jobs.length ? "" : `<p class="hint">착용 직업 미제공</p>`}
    <p class="equipment-type">장비 분류 · ${text(types[item.subcategory] || item.subcategory || item.middle_category || item.category)}</p>
    <dl class="equipment-stats">${item.attack_speed_label != null || item.attack_speed != null ? row("공격속도", item.attack_speed_label ?? item.attack_speed) : ""}${ordered.map(stat => row(stat.stat_key === "remaining_upgrades" ? "업그레이드 가능 횟수" : detailLabels[stat.stat_key] || labels[stat.stat_key] || stat.stat_key, stat.base_value == null ? null : `${Number(stat.base_value) > 0 && !stat.stat_key.includes("upgrades") ? "+" : ""}${stat.base_value}`, stat.minimum_value == null && stat.maximum_value == null ? "" : `<small>(${text(stat.minimum_value)} ~ ${text(stat.maximum_value)})</small>`)).join("") || `<p class="hint">제공된 수치 옵션이 없습니다.</p>`}</dl>
    <footer><span>상점 판매가</span><strong>${price == null ? "미제공" : `${text(formatCount(price))} 메소`}</strong></footer>
    ${attributes.length ? `<details><summary>추가 정보</summary><dl class="catalog-facts">${attributes.map(attribute => `<div><dt>${text(attribute.attribute_name)}</dt><dd>${text(attribute.value_text)}</dd></div>`).join("")}</dl></details>` : ""}
  </article>`;
}
