import { getSupabase } from "./supabase-client.js";
import { escapeHtml } from "./format.js";
import { itemOptionFields } from "./item-options.js";

const labels = Object.fromEntries(itemOptionFields.map(f => [f.key, f.label]));
Object.assign(labels, {name:"이름",category:"분류",middle_category:"중분류",subcategory:"상세 분류",required_level:"착용 레벨",level:"레벨",exp:"경험치",rate_percent:"드랍 확률(%)",rate_text:"확률 표기",item_id:"드랍 아이템",source_entry:"드랍 항목",base_options:"기본 옵션",requirements:"착용 조건",option_ranges:"옵션 범위",extra_effects:"추가 효과",shop_sell_price:"상점 판매가",attack_speed_label:"공격속도",image_url:"이미지",description:"설명",effect_description:"효과",required_accuracy:"필요 명중",accuracy_per_level:"레벨별 필요 명중",weak_elements:"약점",resist_elements:"반감",gender_restriction:"성별",stat_key:"능력치",base_value:"기본값",minimum_value:"최솟값",maximum_value:"최댓값",requirement_key:"착용 조건",required_value:"필요 수치",job_name:"직업",attribute_name:"항목",value_text:"내용"});
function value(v, field) {
  if (Array.isArray(v)) return v.join(" · ");
  if (["stat_key","requirement_key"].includes(field) && labels[v]) return labels[v];
  if (v == null) return "미제공";
  if (typeof v === "object") return Object.entries(v).map(([k,n])=>`${labels[k] ?? k} ${typeof n === "object" ? JSON.stringify(n) : n}`).join(" · ");
  if (typeof v === "string" && /^https:\/\//.test(v)) return "이미지 주소";
  return String(v);
}
// 수집 경로는 화면에 보여주지 않습니다.
Object.assign(labels, { mp:"MP",physical_attack:"물리 공격력",magic_attack:"마법 공격력",physical_defense:"물리 방어력",magic_defense:"마법 방어력",movement_speed:"이동속도",knockback_damage:"넉백 기준 피해량",meso_value:"메소",accuracy_reference_level:"명중 기준 레벨" });
const hiddenFields = new Set(["source_url","source","source_hash","response_sha256"]);
function fields(changes) {
  const result = [];
  for (const [key,v] of Object.entries(changes ?? {})) {
    if (hiddenFields.has(key)) continue;
    if (["base_options","requirements","option_ranges"].includes(key) && v.before && v.after) {
      for (const sub of new Set([...Object.keys(v.before),...Object.keys(v.after)])) {
        if (JSON.stringify(v.before[sub]) !== JSON.stringify(v.after[sub])) result.push([sub,{before:v.before[sub],after:v.after[sub]}]);
      }
    } else result.push([key,v]);
  }
  return result;
}
export function changeCards(rows) {
  // 숨긴 항목만 바뀐 기록은 빈 카드가 되므로 뺍니다.
  rows = rows.filter(r => r.operation !== "UPDATE" || fields(r.changes).length);
  return rows.length ? rows.map(r=>`<article class="catalog-change ym-glass"><div class="catalog-change-head"><strong>${escapeHtml(r.entity_name)}</strong><span class="ym-chip">${({INSERT:"추가",UPDATE:"수정",DELETE:"삭제"})[r.operation] ?? "변경"}</span><time>${escapeHtml(new Date(r.changed_at).toLocaleString("ko-KR"))}</time></div>${r.release_label ? `<p class="hint">${escapeHtml(r.release_label)}</p>` : ""}<dl>${fields(r.changes).map(([k,v])=>`<div><dt>${escapeHtml(labels[k] ?? k)}</dt><dd><del>${escapeHtml(value(v.before,k))}</del><span aria-hidden="true"> → </span><strong>${escapeHtml(value(v.after,k))}</strong></dd></div>`).join("")}</dl></article>`).join("") : `<p class="empty">이력 기록을 시작한 뒤 변경된 정보가 아직 없습니다.</p>`;
}
export async function mountEntityHistory(slot, id, entityType) {
  if (!["item", "monster"].includes(entityType)) throw new Error("도감 이력 종류를 지정해주세요.");
  let page = 0, loadId = 0;
  slot.innerHTML = `<div data-history-list aria-live="polite"></div><nav class="catalog-pager" data-history-nav aria-label="이 개체의 변경 이력 페이지"><button type="button" data-history-prev>이전</button><span data-history-page></span><button type="button" data-history-next>다음</button></nav>`;
  async function load() {
    const request = ++loadId;
    const list = slot.querySelector("[data-history-list]");
    list.innerHTML = `<p class="hint">변경 이력을 확인하고 있어요.</p>`;
    slot.querySelectorAll("button").forEach(button => button.disabled = true);
    try {
      const client = await getSupabase();
      if (!slot.isConnected || request !== loadId) return;
      // 선택한 종류와 UUID에 해당하는 이력만 읽습니다. 다음 페이지 확인용 한 행을 더 조회합니다.
      const result = await client.from("catalog_changes").select("id,entity_name,operation,changes,release_label,changed_at")
        .eq("entity_type", entityType).eq("entity_id", id).order("id", {ascending:false}).range(page * 5, page * 5 + 5);
      if (!slot.isConnected || request !== loadId) return;
      if (result.error) throw result.error;
      const rows = result.data ?? [];
      list.innerHTML = changeCards(rows.slice(0, 5));
      slot.querySelector("[data-history-nav]").hidden = page === 0 && rows.length === 0;
      slot.querySelector("[data-history-page]").textContent = `${page + 1} 페이지`;
      slot.querySelector("[data-history-prev]").disabled = page === 0;
      slot.querySelector("[data-history-next]").disabled = rows.length <= 5;
    } catch {
      if (!slot.isConnected || request !== loadId) return;
      slot.querySelector("[data-history-nav]").hidden = true;
      list.innerHTML = `<p class="hint">변경 이력을 불러오지 못했습니다.</p><button type="button" class="mo-ghost" data-history-retry>다시 확인</button>`;
    }
  }
  slot.addEventListener("click", event => {
    if (event.target.closest("[data-history-prev]")) page = Math.max(0, page - 1);
    else if (event.target.closest("[data-history-next]")) page++;
    else if (!event.target.closest("[data-history-retry]")) return;
    void load();
  });
  await load();
}

let historyDialogId = 0;
export function mountHistoryDialog(button, id, entityType, name) {
  button.setAttribute("aria-haspopup", "dialog");
  let dialog;
  button.addEventListener("click", () => {
    if (dialog?.isConnected) return;
    const titleId = `catalog-history-title-${++historyDialogId}`;
    dialog = document.createElement("dialog");
    dialog.className = "catalog-history-dialog";
    dialog.setAttribute("aria-labelledby", titleId);
    dialog.innerHTML = `<header class="catalog-history-dialog-head"><div><span class="ym-chip">변경 이력</span><h2 id="${titleId}">${escapeHtml(name)}</h2></div><button type="button" class="mo-ghost" data-history-close aria-label="변경 이력 닫기" autofocus>닫기 ×</button></header><p class="hint">이력 기록을 시작한 뒤 변경된 정보입니다.</p><div data-${entityType === "monster" ? "monster" : "item"}-history></div>`;
    button.parentElement.append(dialog);
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (button.isConnected) button.focus({ preventScroll: true });
    }, { once: true });
    dialog.querySelector("[data-history-close]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
    dialog.showModal();
    void mountEntityHistory(dialog.querySelector("[data-item-history], [data-monster-history]"), id, entityType);
  });
}
