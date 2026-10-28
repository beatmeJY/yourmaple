import { getSupabase } from "./supabase-client.js";
import { escapeHtml } from "./format.js";
import { itemOptionFields } from "./item-options.js";

const labels = Object.fromEntries(itemOptionFields.map(f => [f.key, f.label]));
Object.assign(labels, {name:"이름",category:"분류",middle_category:"중분류",subcategory:"상세 분류",required_level:"착용 레벨",level:"레벨",exp:"경험치",rate_percent:"드랍 확률(%)",rate_text:"확률 표기",item_id:"드랍 아이템",source_entry:"드랍 항목",base_options:"기본 옵션",requirements:"착용 조건",option_ranges:"옵션 범위",extra_effects:"추가 효과",shop_sell_price:"상점 판매가",attack_speed_label:"공격속도",image_url:"이미지",source_url:"출처",description:"설명",effect_description:"효과",required_accuracy:"필요 명중",accuracy_per_level:"레벨별 필요 명중",weak_elements:"약점",resist_elements:"반감",gender_restriction:"성별",stat_key:"능력치",base_value:"기본값",minimum_value:"최솟값",maximum_value:"최댓값",requirement_key:"착용 조건",required_value:"필요 수치",job_name:"직업",attribute_name:"항목",value_text:"내용"});
function value(v, field) {
  if (Array.isArray(v)) return v.join(" · ");
  if (["stat_key","requirement_key"].includes(field) && labels[v]) return labels[v];
  if (v == null) return "미제공";
  if (typeof v === "object") return Object.entries(v).map(([k,n])=>`${labels[k] ?? k} ${typeof n === "object" ? JSON.stringify(n) : n}`).join(" · ");
  if (typeof v === "string" && /^https:\/\//.test(v)) return field === "source_url" ? "출처 주소" : "이미지 주소";
  return String(v);
}
function fields(changes) {
  const result = [];
  for (const [key,v] of Object.entries(changes ?? {})) {
    if (["base_options","requirements","option_ranges"].includes(key) && v.before && v.after) {
      for (const sub of new Set([...Object.keys(v.before),...Object.keys(v.after)])) {
        if (JSON.stringify(v.before[sub]) !== JSON.stringify(v.after[sub])) result.push([sub,{before:v.before[sub],after:v.after[sub]}]);
      }
    } else result.push([key,v]);
  }
  return result;
}
export function changeCards(rows) {
  return rows.length ? rows.map(r=>`<article class="catalog-change ym-glass"><div class="catalog-change-head"><strong>${escapeHtml(r.entity_name)}</strong><span class="ym-chip">${({INSERT:"추가",UPDATE:"수정",DELETE:"삭제"})[r.operation] ?? "변경"}</span><time>${escapeHtml(new Date(r.changed_at).toLocaleString("ko-KR"))}</time></div>${r.release_label ? `<p class="hint">${escapeHtml(r.release_label)}</p>` : ""}<dl>${fields(r.changes).map(([k,v])=>`<div><dt>${escapeHtml(labels[k] ?? k)}</dt><dd><del>${escapeHtml(value(v.before,k))}</del><span aria-hidden="true"> → </span><strong>${escapeHtml(value(v.after,k))}</strong></dd></div>`).join("")}</dl></article>`).join("") : `<p class="empty">이력 기록을 시작한 뒤 변경된 정보가 아직 없습니다.</p>`;
}
export async function mountEntityHistory(slot, id) {
  slot.innerHTML = `<p class="hint">최근 변경을 확인하고 있어요.</p>`;
  const client = await getSupabase();
  const result = await client.from("catalog_changes").select("id,entity_name,operation,changes,release_label,changed_at")
    .eq("entity_id", id).order("id", {ascending:false}).limit(5);
  if (!slot.isConnected) return;
  slot.innerHTML = result.error ? `<p class="hint">변경 이력을 불러오지 못했습니다.</p>` : changeCards(result.data ?? []);
}
