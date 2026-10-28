import { catalogError } from "../catalog.js";
import { catalogRpc, clearCatalogCache, itemDropPage } from "../catalog-api.js";
import { catalogImage, catalogMonsterImage, mountCatalogImageFallback } from "../catalog-image.js";
import { escapeHtml, formatCount } from "../format.js";
import { itemOptionFields } from "../item-options.js";
import { mountEntityHistory } from "../catalog-history.js";

const labels = Object.fromEntries(itemOptionFields.map(f => [f.key, f.label]));
const text = v => escapeHtml(v == null || v === "" ? "미제공" : String(v));
export async function render(root) {
  mountCatalogImageFallback(root);
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const id = params.get("id");
  if (id) return renderDetail(root, id);
  root.innerHTML = `<section class="catalog-page"><header class="ym-page-head"><div><h1>아이템 도감</h1><p>장비 옵션과 착용 조건을 확인하고, 몬스터의 드랍과 연결해 보세요.</p></div><a class="catalog-history-link" href="#/catalog-updates">최근 변경 이력</a></header><div class="catalog-tools"><label class="field catalog-search"><span>아이템 검색</span><input data-catalog-search placeholder="이름·분류·아이템 번호" maxlength="100" /></label><button type="button" class="mo-ghost" data-catalog-refresh>새로 확인</button></div><p class="hint" data-catalog-count aria-live="polite"></p><div class="catalog-grid" data-catalog-list></div><nav class="catalog-pager" aria-label="아이템 페이지"><button type="button" data-prev>이전</button><span data-page></span><button type="button" data-next>다음</button></nav></section>`;
  let page = 0, loadId = 0, timer;
  async function load() {
    const request = ++loadId;
    const list = root.querySelector("[data-catalog-list]");
    list.innerHTML = `<p class="empty">아이템을 찾는 중입니다.</p>`;
    root.querySelectorAll(".catalog-pager button").forEach(b=>b.disabled=true);
    const result = await catalogRpc("catalog_search_items", {p_query: root.querySelector("input").value.trim(),p_page:page});
    if (!root.isConnected || request !== loadId) return;
    if (result.error) { list.innerHTML = `<p class="empty">${text(catalogError(result.error))}</p>`; return; }
    const rows = result.data?.rows ?? [], total = result.data?.total ?? 0;
    root.querySelector("[data-catalog-count]").textContent = `${total}개 중 ${rows.length}개`;
    root.querySelector("[data-page]").textContent = `${page+1} / ${Math.max(1,Math.ceil(total/24))}`;
    root.querySelector("[data-prev]").disabled = page === 0;
    root.querySelector("[data-next]").disabled = (page+1)*24 >= total;
    list.innerHTML = rows.length ? rows.map(item=>`<a class="catalog-item ym-glass" href="#/item-catalog?id=${encodeURIComponent(item.id)}"><div class="catalog-item-art">${catalogImage(item.image_url) || `<span aria-hidden="true">${text([...item.name][0])}</span>`}</div><div><small class="ym-chip">${text(item.subcategory || item.middle_category || item.category)}</small><h2>${text(item.name)}</h2><p>${item.required_level == null ? "착용 레벨 미제공" : `Lv.${text(item.required_level)}`}</p></div><span class="catalog-item-arrow" aria-hidden="true">↗</span></a>`).join("") : `<p class="empty">검색 결과가 없습니다.</p>`;
  }
  root.querySelector("input").addEventListener("input",()=>{clearTimeout(timer);++loadId;page=0;root.querySelectorAll(".catalog-pager button").forEach(b=>b.disabled=true);timer=setTimeout(()=>{if(root.isConnected)void load();},300);});
  root.addEventListener("click",e=>{if(e.target.closest("[data-prev]"))page=Math.max(0,page-1);else if(e.target.closest("[data-next]"))page++;else if(e.target.closest("[data-catalog-refresh]")){clearCatalogCache();page=0;}else return;clearTimeout(timer);void load();});
  await load();
}
async function renderDetail(root,id) {
  root.innerHTML = `<section class="catalog-page"><a class="catalog-history-link" href="#/item-catalog">← 아이템 목록</a><div data-item-detail><p class="empty">아이템 정보를 불러오는 중입니다.</p></div></section>`;
  const result = await catalogRpc("catalog_item_detail", {p_id:id});
  if (!root.isConnected) return;
  const slot = root.querySelector("[data-item-detail]");
  if (result.error || !result.data?.item) { slot.innerHTML = `<p class="empty">${result.error ? text(catalogError(result.error)) : "아이템을 찾을 수 없습니다."}</p>`; return; }
  const {item,stats=[],requirements=[],jobs=[],attributes=[]} = result.data;
  const req = [item.required_level == null ? "레벨 미제공" : `Lv.${item.required_level}`,...requirements.map(r=>`${labels[r.requirement_key] ?? r.requirement_key} ${r.required_value}`),jobs.join(" · "),item.gender_restriction].filter(Boolean);
  slot.innerHTML = `<header class="catalog-item-hero ym-glass"><div class="catalog-detail-art">${catalogImage(item.image_url,"",120) || `<span>${text([...item.name][0])}</span>`}</div><div><span class="ym-chip">${text([item.category,item.middle_category,item.subcategory].filter(Boolean).join(" · "))}</span><h1>${text(item.name)}</h1><p>${text(req.join(" · "))}</p><p class="hint">기본 옵션과 가능한 범위입니다. 실제 거래 옵션은 물건마다 다를 수 있어요.</p></div></header><div class="catalog-detail-layout"><section class="catalog-detail-panel ym-glass"><h2>기본 옵션</h2><div class="catalog-stat-grid">${stats.length ? stats.map(r=>`<div class="catalog-stat"><span>${text(labels[r.stat_key] ?? r.stat_key)}</span><strong>${text(r.base_value)}</strong>${r.minimum_value == null ? "" : `<small>${text(r.minimum_value)} ~ ${text(r.maximum_value)}</small>`}</div>`).join("") : `<p class="hint">제공된 수치 옵션이 없습니다.</p>`}</div></section><section class="catalog-detail-panel ym-glass"><h2>아이템 정보</h2><dl class="catalog-facts"><div><dt>공격속도</dt><dd>${text(item.attack_speed_label ?? item.attack_speed)}</dd></div><div><dt>상점 판매가</dt><dd>${item.shop_sell_price == null ? "미제공" : `${text(formatCount(item.shop_sell_price))} 메소`}</dd></div></dl>${item.description ? `<p>${text(item.description)}</p>` : ""}${item.effect_description && item.effect_description !== item.description ? `<p>${text(item.effect_description)}</p>` : ""}${attributes.length ? `<details><summary>출처에서 제공한 추가 정보</summary><dl class="catalog-facts">${attributes.map(a=>`<div><dt>${text(a.attribute_name)}</dt><dd>${text(a.value_text)}</dd></div>`).join("")}</dl></details>` : ""}${item.source_url?.startsWith("https://") ? `<a class="catalog-history-link" href="${text(item.source_url)}" target="_blank" rel="noopener noreferrer">출처 확인 ↗</a>` : ""}</section></div><section class="catalog-detail-panel ym-glass"><h2>이 아이템을 주는 몬스터</h2><p class="hint">같은 몬스터의 별개 드랍 항목은 각각 표시합니다. 확률을 합산하지 않습니다.</p><div data-item-drops></div></section><section class="catalog-detail-panel ym-glass"><h2>최근 변경</h2><button type="button" class="mo-ghost" data-item-refresh>새로 확인</button><p class="hint">기록 기능 도입 이후의 변경을 보여드립니다.</p><div data-item-history></div><a class="catalog-history-link" href="#/catalog-updates?entity=${encodeURIComponent(item.id)}">변경 이력 더 보기</a></section>`;
  slot.querySelector("[data-item-refresh]").addEventListener("click", () => { clearCatalogCache(); void renderDetail(root,id); });
  void mountEntityHistory(slot.querySelector("[data-item-history]"),item.id);
  void mountItemDrops(slot.querySelector("[data-item-drops]"),item.id);
}

async function mountItemDrops(slot, id) {
  let page = 0, loadId = 0;
  slot.innerHTML = `<div class="catalog-item-droppers" data-droppers aria-live="polite"></div><nav class="catalog-pager" aria-label="드랍 몬스터 페이지"><button type="button" data-drops-prev>이전</button><span data-drops-page></span><button type="button" data-drops-next>다음</button></nav>`;
  async function load() {
    const request = ++loadId;
    const list = slot.querySelector("[data-droppers]");
    list.innerHTML = `<p class="hint">드랍 몬스터를 찾는 중입니다.</p>`;
    slot.querySelectorAll("button").forEach(button => button.disabled = true);
    const result = await itemDropPage(id, page);
    if (!slot.isConnected || request !== loadId) return;
    if (result.error) {
      list.innerHTML = `<p class="empty">${text(catalogError(result.error))}</p><button type="button" class="mo-ghost" data-drops-retry>다시 확인</button>`;
      return;
    }
    const rows = result.data ?? [];
    slot.querySelector("[data-drops-page]").textContent = `${page + 1} 페이지`;
    slot.querySelector("[data-drops-prev]").disabled = page === 0;
    slot.querySelector("[data-drops-next]").disabled = !result.hasMore;
    list.innerHTML = rows.length ? rows.map(drop => {
      const monster = drop.monster;
      if (!monster) return `<div class="catalog-dropper ym-glass"><span>몬스터 정보 미제공</span><strong>${drop.rate_percent == null ? "확률 미상" : `${text(drop.rate_percent)}%`}</strong></div>`;
      const query = monster.source_id || monster.name;
      return `<a class="catalog-dropper ym-glass" href="#/monsters?q=${encodeURIComponent(query)}"><div class="catalog-dropper-art">${catalogMonsterImage(monster,48) || `<span aria-hidden="true">${text([...monster.name][0])}</span>`}</div><span><small>${monster.level == null ? "레벨 미제공" : `Lv.${text(monster.level)}`}</small><b>${text(monster.name)}</b></span><strong>${drop.rate_percent == null ? "확률 미상" : `${text(drop.rate_percent)}%`}</strong></a>`;
    }).join("") : `<p class="hint">등록된 드랍 몬스터가 없습니다. 원본 미제공이나 미수집일 수 있으므로 드랍하지 않는다는 뜻은 아닙니다.</p>`;
  }
  slot.addEventListener("click", event => {
    if (event.target.closest("[data-drops-prev]")) page = Math.max(0, page - 1);
    else if (event.target.closest("[data-drops-next]")) page++;
    else if (!event.target.closest("[data-drops-retry]")) return;
    void load();
  });
  await load();
}
