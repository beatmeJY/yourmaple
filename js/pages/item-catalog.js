import { mountItemEditor } from "../catalog-item-editor.js";
import { canReviewCatalog } from "../catalog-review.js";
import { catalogError } from "../catalog.js";
import { catalogRpc, clearCatalogCache, itemDropPage } from "../catalog-api.js";
import { catalogImage, catalogMonsterImage, mountCatalogImageFallback } from "../catalog-image.js";
import { escapeHtml, formatCount } from "../format.js";
import { itemOptionFields } from "../item-options.js";
import { equipmentCard, equipmentTypeName, isEquipment } from "../catalog-equipment.js";
import { mountHistoryDialog } from "../catalog-history.js";

const labels = Object.fromEntries(itemOptionFields.map(f => [f.key, f.label]));
const text = v => escapeHtml(v == null || v === "" ? "미제공" : String(v));
export async function render(root) {
  mountCatalogImageFallback(root);
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  if (id) return renderDetail(root, id);
  root.innerHTML = `<section class="catalog-page"><header class="ym-page-head"><div><h1>아이템 도감</h1><p>장비 옵션과 착용 조건을 확인하고, 몬스터의 드랍과 연결해 보세요.</p></div></header><div class="catalog-tools"><label class="field catalog-search"><span>아이템 검색</span><input data-catalog-search placeholder="이름 일부·별명도 돼요 (예: 혼주문, 혼줌)" maxlength="100" /></label><button type="button" class="mo-ghost" data-catalog-refresh>새로 확인</button></div><p class="hint" data-catalog-count aria-live="polite"></p><div class="catalog-grid" data-catalog-list></div><nav class="catalog-pager" aria-label="아이템 페이지"><button type="button" data-prev>이전</button><span data-page></span><button type="button" data-next>다음</button></nav></section>`;
  void canReviewCatalog().then(allowed => {
    if (allowed && root.isConnected) root.querySelector(".ym-page-head").insertAdjacentHTML("beforeend", `<a class="mo-ghost" href="/catalog-review/">비공개 검토 보관함</a>`);
  });
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
    list.innerHTML = rows.length ? rows.map((item,index)=>`<a class="catalog-item ym-glass" href="/items/?id=${encodeURIComponent(item.id)}" style="--i:${Math.min(index,16)}"><div class="catalog-item-art">${catalogImage(item.image_url) || `<span aria-hidden="true">${text([...item.name][0])}</span>`}</div><div class="catalog-item-copy"><h2 title="${text(item.name)}">${text(item.name)}</h2><p class="catalog-item-meta"><small class="ym-chip">${text(itemKind(item))}</small>${levelBadge(item)}</p></div></a>`).join("") : `<p class="empty">검색 결과가 없습니다.</p>`;
  }
  root.querySelector("input").addEventListener("input",()=>{clearTimeout(timer);++loadId;page=0;root.querySelectorAll(".catalog-pager button").forEach(b=>b.disabled=true);timer=setTimeout(()=>{if(root.isConnected)void load();},300);});
  root.addEventListener("click",e=>{if(e.target.closest("[data-prev]"))page=Math.max(0,page-1);else if(e.target.closest("[data-next]"))page++;else if(e.target.closest("[data-catalog-refresh]")){clearCatalogCache();page=0;}else return;clearTimeout(timer);void load();});
  await load();
}
// 목록 카드(2026-11-06 작게): 종류는 장비면 한글 이름(아대·신발 등), 아니면 큰 분류(소비·설치·기타). 레벨은 장비거나 0보다 클 때만 배지로.
const kindNames = { Etc: "기타", Cash: "캐시", Use: "소비", Setup: "설치" };
function itemKind(item) {
  if (isEquipment(item)) return equipmentTypeName(item.subcategory) || item.middle_category || item.category || "";
  return kindNames[item.category] ?? item.category ?? "";
}
function levelBadge(item) {
  const level = Number(item.required_level);
  if (item.required_level == null || !Number.isFinite(level)) return isEquipment(item) ? `<span class="catalog-item-lv is-unknown">Lv 미제공</span>` : "";
  if (level > 0) return `<span class="catalog-item-lv">Lv.${text(level)}</span>`;
  return isEquipment(item) ? `<span class="catalog-item-lv is-free">Lv 제한 없음</span>` : "";
}
async function renderDetail(root,id) {
  root.innerHTML = `<section class="catalog-page item-detail-page"><div class="catalog-detail-actions"><a class="catalog-back-link" href="/items/">← 아이템 목록</a><span class="catalog-detail-actions-gap"></span></div><div data-item-detail><p class="empty">아이템 정보를 불러오는 중입니다.</p></div></section>`;
  const result = await catalogRpc("catalog_item_detail", {p_id:id});
  if (!root.isConnected) return;
  const slot = root.querySelector("[data-item-detail]");
  if (result.error || !result.data?.item) { slot.innerHTML = `<p class="empty">${result.error ? text(catalogError(result.error)) : "아이템을 찾을 수 없습니다."}</p>`; return; }
  const {item,stats=[],requirements=[],jobs=[],attributes=[]} = result.data;
  const req = [item.required_level == null ? "레벨 미제공" : `Lv.${item.required_level}`,...requirements.map(r=>`${labels[r.requirement_key] ?? r.requirement_key} ${r.required_value}`),jobs.join(" · "),item.gender_restriction].filter(Boolean);
  const basicDetail = `<header class="catalog-item-hero ym-glass"><div class="catalog-detail-art">${catalogImage(item.image_url,"",120) || `<span>${text([...item.name][0])}</span>`}</div><div><span class="ym-chip">${text([item.category,item.middle_category,item.subcategory].filter(Boolean).join(" · "))}</span><h1>${text(item.name)}</h1><p>${text(req.join(" · "))}</p><p class="hint">기본 옵션과 가능한 범위입니다. 실제 거래 옵션은 물건마다 다를 수 있어요.</p></div></header><div class="catalog-detail-layout"><section class="catalog-detail-panel ym-glass"><h2>기본 옵션</h2><div class="catalog-stat-grid">${stats.length ? stats.map(r=>`<div class="catalog-stat"><span>${text(labels[r.stat_key] ?? r.stat_key)}</span><strong>${text(r.base_value)}</strong>${r.minimum_value == null ? "" : `<small>${text(r.minimum_value)} ~ ${text(r.maximum_value)}</small>`}</div>`).join("") : `<p class="hint">제공된 수치 옵션이 없습니다.</p>`}</div></section><section class="catalog-detail-panel ym-glass"><h2>아이템 정보</h2><dl class="catalog-facts"><div><dt>공격속도</dt><dd>${text(item.attack_speed_label ?? item.attack_speed)}</dd></div><div><dt>상점 판매가</dt><dd>${item.shop_sell_price == null ? "미제공" : `${text(formatCount(item.shop_sell_price))} 메소`}</dd></div></dl>${item.description ? `<p class="catalog-public-description">${text(item.description)}</p>` : ""}${item.effect_description && item.effect_description !== item.description ? `<p class="catalog-public-description">${text(item.effect_description)}</p>` : ""}${attributes.length ? `<details><summary>추가 정보</summary><dl class="catalog-facts">${attributes.map(a=>`<div><dt>${text(a.attribute_name)}</dt><dd>${text(a.value_text)}</dd></div>`).join("")}</dl></details>` : ""}</section></div>`;
  root.querySelector(".catalog-detail-actions").insertAdjacentHTML("beforeend", `<button type="button" class="catalog-pill-button" data-item-refresh>새로 확인</button>`);
  slot.innerHTML = `<div class="${isEquipment(item) ? "equipment-detail-columns" : "catalog-detail-main"}">${isEquipment(item) ? equipmentCard(result.data) : basicDetail}<section class="catalog-detail-panel equipment-droppers ym-glass"><div class="equipment-droppers-content"><h2 class="equipment-droppers-title">이 아이템을 주는 몬스터 <span class="equipment-monster-count" data-drop-species aria-live="polite" hidden></span></h2><p class="hint">같은 몬스터의 다른 드랍 항목은 따로 보여요. 확률은 합치지 않아요.</p><div data-item-drops></div></div></section></div>`;
  root.querySelector("[data-item-refresh]").addEventListener("click", () => { clearCatalogCache(); void renderDetail(root,id); });
  const actions=root.querySelector(".catalog-detail-actions");
  void canReviewCatalog().then(allowed=>{
    if(!allowed||!actions.isConnected)return;
    // 수정 이력은 관리자만 본다(2026-11-05, DB 는 sql/063 이 막는다).
    actions.insertAdjacentHTML("beforeend",'<button type="button" class="catalog-history-button" data-open-history>변경 이력</button><button type="button" class="catalog-pill-button" data-edit-item>아이템 수정</button>');
    mountHistoryDialog(actions.querySelector("[data-open-history]"), item.id, "item", item.name);
    mountItemEditor(actions.querySelector('[data-edit-item]'),root,item.id,()=>renderDetail(root,id));
  });
  void mountItemDrops(slot.querySelector("[data-item-drops]"),item.id);
}

async function mountItemDrops(slot, id) {
  let page = 0, loadId = 0, loading = false, hasMore = true, failed = false, count = 0;
  const species = new Set();
  let unidentified = false;
  const badge = slot.closest(".equipment-droppers").querySelector("[data-drop-species]");
  slot.innerHTML = `<div class="catalog-item-droppers" data-droppers tabindex="0" aria-label="드랍 몬스터 목록"><div class="catalog-drop-rows" data-drop-rows></div><p class="hint" data-drop-status aria-live="polite"></p><button type="button" class="mo-ghost" data-drops-retry hidden>더 불러오기</button></div>`;
  const list = slot.querySelector("[data-droppers]");
  const rowsSlot = slot.querySelector("[data-drop-rows]");
  const status = slot.querySelector("[data-drop-status]");
  const more = slot.querySelector("[data-drops-retry]");
  async function load() {
    if (loading || !hasMore || !slot.isConnected) return;
    loading = true;
    failed = false;
    const request = ++loadId;
    more.hidden = true;
    list.setAttribute("aria-busy", "true");
    status.hidden = false;
    status.textContent = count ? "드랍 몬스터를 더 불러오는 중입니다." : "드랍 몬스터를 찾는 중입니다.";
    const result = await itemDropPage(id, page);
    if (!slot.isConnected || request !== loadId) return;
    loading = false;
    list.setAttribute("aria-busy", "false");
    if (result.error) {
      failed = true;
      status.textContent = catalogError(result.error);
      more.textContent = "다시 확인";
      more.hidden = false;
      return;
    }
    const rows = result.data ?? [];
    for (const drop of rows) {
      if (drop.monster?.id) species.add(drop.monster.id);
      else unidentified = true;
    }
    rowsSlot.insertAdjacentHTML("beforeend", rows.map(drop => {
      const monster = drop.monster;
      const rate = drop.rate_percent == null ? null : Number(drop.rate_percent);
      const rateText = drop.rate_percent == null ? "확률 미상" : `${text(drop.rate_percent)}%`;
      const bar = `<span class="catalog-dropper-bar" aria-hidden="true"><i data-drop-rate="${Number.isFinite(rate) ? rate : ""}"></i></span>`;
      const unknown = drop.rate_percent == null ? " is-unknown" : "";
      if (!monster) return `<div class="catalog-dropper${unknown}"><div class="catalog-dropper-art"><span aria-hidden="true">?</span></div><span><span class="catalog-dropper-name"><b>몬스터 정보 미제공</b></span>${bar}</span><strong>${rateText}</strong></div>`;
      const query = monster.source_id || monster.name;
      return `<a class="catalog-dropper${unknown}" href="/monsters/?q=${encodeURIComponent(query)}"><div class="catalog-dropper-art">${catalogMonsterImage(monster,48) || `<span aria-hidden="true">${text([...monster.name][0])}</span>`}</div><span><span class="catalog-dropper-name"><b>${text(monster.name)}</b><small>${monster.level == null ? "레벨 미제공" : `Lv.${text(monster.level)}`}</small></span>${bar}</span><strong>${rateText}</strong></a>`;
    }).join(""));
    paintRateBars(rowsSlot);
    count += rows.length;
    page++;
    hasMore = Boolean(result.hasMore);
    badge.hidden = false;
    badge.textContent = `${hasMore || unidentified ? "확인 " : ""}${species.size}종`;
    badge.setAttribute("aria-label", `${hasMore || unidentified ? "현재 확인된 " : ""}몬스터 ${species.size}종`);
    status.textContent = !count ? "등록된 드랍 몬스터가 없습니다. 정보 미제공일 수 있으므로 드랍하지 않는다는 뜻은 아닙니다." : hasMore ? "아래로 스크롤하면 더 불러옵니다." : "";
    status.hidden = count > 0 && !hasMore;
    more.textContent = "더 불러오기";
    more.hidden = !hasMore;
    // 카드가 큰 경우에도 목록을 채우고, 실패한 요청은 사용자가 재시도합니다.
    requestAnimationFrame(() => {
      if (slot.isConnected && hasMore && !failed && list.clientHeight > 0 && list.scrollHeight <= list.clientHeight) void load();
    });
  }
  list.addEventListener("scroll", () => {
    if (!failed && list.scrollHeight - list.scrollTop - list.clientHeight < 100) void load();
  }, { passive: true });
  more.addEventListener("click", () => void load());
  await load();
}

// 막대는 지금까지 불러온 드랍 중 가장 높은 확률을 100%로 잡습니다(최소 8%로 보이게).
function paintRateBars(rowsSlot) {
  const bars = [...rowsSlot.querySelectorAll("[data-drop-rate]")];
  const max = Math.max(0, ...bars.map(bar => Number(bar.dataset.dropRate) || 0));
  for (const bar of bars) {
    const rate = bar.dataset.dropRate === "" ? null : Number(bar.dataset.dropRate);
    bar.style.width = rate == null || !max || rate <= 0 ? "0%" : `${Math.max(8, (rate / max) * 100)}%`;
  }
}
