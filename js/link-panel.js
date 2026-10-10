import { paletteHue } from "./effects.js";
import { escapeHtml } from "./format.js";
import { faviconSrc } from "./link-url.js";
import { getSupabase } from "./supabase-client.js";
import { translateDbError } from "./db-error.js";

let loadId = 0;

function initial(title) {
  const text = String(title ?? "").trim();
  return [...text][0] || "·";
}

// 링크 화면과 같은 분류 색 타일(첫 글자 + 사이트 아이콘)을 쓴다.
function itemHtml(row) {
  const icon = faviconSrc(row.url);
  const image = icon
    ? `<img class="lk-favicon" src="${escapeHtml(icon)}" alt="" width="16" height="16" data-favicon referrerpolicy="no-referrer" />`
    : "";
  return `
    <button type="button" class="link-panel-item" data-open-link="${escapeHtml(row.url)}" title="${escapeHtml(row.title)}">
      <span class="lk-tile" style="--hue:${paletteHue(String(row.category ?? "").trim())}" aria-hidden="true">${escapeHtml(initial(row.title))}${image}</span>
      <span class="link-panel-item-title">${escapeHtml(row.title)}</span>
    </button>
  `;
}

function panelBody() {
  return document.querySelector("[data-link-panel-body]");
}

export function isLinkPanelOpen() {
  return document.body.classList.contains("link-panel-open");
}

export function closeLinkPanel() {
  document.body.classList.remove("link-panel-open");
}

export async function openLinkPanel() {
  document.body.classList.add("link-panel-open");
  const body = panelBody();
  if (!body) return;
  const current = ++loadId;
  body.innerHTML = `<p class="empty">불러오는 중입니다.</p>`;
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("links").select("id, title, url, category").order("updated_at", { ascending: false });
  if (current !== loadId || !isLinkPanelOpen()) return;
  if (error) {
    body.innerHTML = `<p class="empty">${escapeHtml(translateDbError(error))}</p>`;
    return;
  }
  const rows = data ?? [];
  if (!rows.length) {
    body.innerHTML = `<p class="empty">저장한 링크가 없습니다. 링크 관리에서 먼저 추가해 주세요.</p>`;
    return;
  }
  body.innerHTML = `<div class="link-panel-grid">${rows.map(itemHtml).join("")}</div>`;
}
