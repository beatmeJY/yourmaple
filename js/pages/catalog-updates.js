import { getSupabase } from "../supabase-client.js";
import { escapeHtml } from "../format.js";
import { changeCards } from "../catalog-history.js";
import { clearCatalogCache } from "../catalog-api.js";

export async function render(root) {
  const entity = new URLSearchParams(location.hash.split("?")[1] || "").get("entity");
  root.innerHTML = `<section class="catalog-page"><header class="ym-page-head"><div><h1>도감 변경 이력</h1><p>아이템·몬스터·드랍 정보가 바뀐 내용을 확인하세요.</p></div><button type="button" class="mo-ghost" data-history-refresh>새로 확인</button></header><p class="hint">변경 기록 기능 도입 이후의 내용입니다. ${entity ? `<a href="#/catalog-updates">전체 이력 보기</a>` : ""}</p><div data-history-list aria-live="polite"></div><nav class="catalog-pager" aria-label="변경 이력 페이지"><button type="button" data-prev>이전</button><span data-page></span><button type="button" data-next>다음</button></nav></section>`;
  let page=0,loadId=0;
  async function load(){
    const request=++loadId;const list=root.querySelector("[data-history-list]");list.innerHTML=`<p class="empty">최근 변경을 불러오는 중입니다.</p>`;
    root.querySelectorAll(".catalog-pager button").forEach(b=>b.disabled=true);
    const client=await getSupabase();
    let query=client.from("catalog_changes").select("id,entity_name,operation,changes,release_label,changed_at");
    if(entity)query=query.eq("entity_id",entity);
    const result=await query.order("id",{ascending:false}).range(page*24,page*24+24);
    if(request!==loadId||!root.isConnected)return;
    if(result.error){list.innerHTML=`<p class="empty">변경 이력을 불러오지 못했습니다. 운영자가 SQL047 적용 여부를 확인해야 합니다.</p>`;return;}
    const rows=result.data??[];list.innerHTML=changeCards(rows.slice(0,24));
    root.querySelector("[data-page]").textContent=`${page+1} 페이지`;
    root.querySelector("[data-prev]").disabled=page===0;root.querySelector("[data-next]").disabled=rows.length<=24;
  }
  root.addEventListener("click",e=>{if(e.target.closest("[data-prev]"))page=Math.max(0,page-1);else if(e.target.closest("[data-next]"))page++;else if(e.target.closest("[data-history-refresh]")){page=0;clearCatalogCache();}else return;void load();});
  await load();
}
