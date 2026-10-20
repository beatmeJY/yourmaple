import { catalogError, loadCatalog } from "../catalog.js";
import { escapeHtml } from "../format.js";
import { matchesText } from "../filters.js";
import { optionSummary } from "../item-options.js";

export async function render(root) {
  root.innerHTML = `<section class="catalog-page"><header class="ym-page-head"><div><h1>아이템 정보</h1><p>기본 정보는 공용 도감에서, 실제 옵션은 내 거래에서 관리해요.</p></div><span class="ym-badge">공용 도감</span></header>
    <label class="field catalog-search"><span>아이템 검색</span><input data-catalog-search placeholder="이름·분류로 찾기" /></label><p class="hint" data-catalog-count></p><div class="catalog-grid" data-catalog-list><p class="empty">아이템을 불러오는 중입니다.</p></div></section>`;
  const list = root.querySelector("[data-catalog-list]");
  const result = await loadCatalog("catalog_items");
  if (!root.isConnected) return;
  if (result.error) { list.innerHTML = `<p class="empty">${escapeHtml(catalogError(result.error))}</p>`; return; }
  const rows = result.data;
  function paint() {
    const shown = rows.filter((row) => matchesText(row, root.querySelector("[data-catalog-search]").value, ["name", "category"]));
    root.querySelector("[data-catalog-count]").textContent = `${shown.length}개 아이템`;
    list.innerHTML = shown.length ? shown.map((item) => `<article class="catalog-item ym-glass"><div class="catalog-item-art">${item.image_url?.startsWith("https://") ? `<img src="${escapeHtml(item.image_url)}" alt="" loading="lazy" />` : `<span aria-hidden="true">${escapeHtml([...item.name][0] || "?")}</span>`}</div><div><small class="ym-chip">${escapeHtml(item.category)}</small><h2>${escapeHtml(item.name)}</h2><p>${escapeHtml(optionSummary(item.base_options) || "기본 옵션 정보 없음")}</p><p class="hint">${escapeHtml(Object.entries(item.requirements ?? {}).map(([k,v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · "))}</p></div></article>`).join("") : `<p class="empty">${rows.length ? "검색 결과가 없습니다." : "공용 아이템 정보를 준비 중입니다."}</p>`;
  }
  root.querySelector("[data-catalog-search]").addEventListener("input", paint);
  paint();
}
