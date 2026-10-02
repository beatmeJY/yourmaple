import { escapeHtml } from "./format.js";
import { faviconSrc } from "./link-url.js";
import { getSupabase } from "./supabase-client.js";
import { translateDbError } from "./db-error.js";

let loadId = 0;

function initial(title) {
  const text = String(title ?? "").trim();
  return [...text][0] || "·";
}

function itemHtml(row) {
  const icon = faviconSrc(row.url);
  const image = icon
    ? `<img class="link-favicon" src="${escapeHtml(icon)}" alt="" width="20" height="20" data-favicon referrerpolicy="no-referrer" />`
    : "";
  return `
    <button type="button" class="link-panel-item" data-open-link="${escapeHtml(row.url)}" title="${escapeHtml(row.title)}">
      <span class="link-mark">${image}<span class="link-mark-letter"${icon ? " hidden" : ""}>${escapeHtml(initial(row.title))}</span></span>
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
  const { data, error } = await supabase.from("links").select("id, title, url").order("updated_at", { ascending: false });
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
