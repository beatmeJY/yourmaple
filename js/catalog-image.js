import { escapeHtml } from "./format.js";
// 원본 CDN/HTTP 캐시를 재사용합니다. 시각/무작위 쿼리를 붙이지 않습니다.
export function catalogImage(url, className = "", size = 64) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return "";
    return `<img data-catalog-image class="${className}" src="${escapeHtml(parsed.href)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`;
  } catch { return ""; }
}

const mounted = new WeakSet();
export function mountCatalogImageFallback(root) {
  if (mounted.has(root)) return;
  mounted.add(root);
  root.addEventListener("error", event => {
    const image = event.target;
    if (!image.matches?.("img[data-catalog-image]")) return;
    const fallback = document.createElement("span");
    fallback.className = "catalog-image-fallback";
    fallback.textContent = "?";
    fallback.title = "이미지를 불러오지 못했습니다.";
    image.replaceWith(fallback);
  }, true);
}
