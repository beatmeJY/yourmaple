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

// 숙제 화면에서도 사용하는 보스 계열 그림입니다. 원본 수치/이미지 URL을 DB에 덮어쓰지 않습니다.
// 출처의 특수 ID와 이름을 함께 확인해 다른 몬스터에 잘못 붙지 않도록 합니다.
const bossArt = {
  "8810018": { name: "혼테일", src: "img/horntail.png" },
  "8810118": { name: "카오스 혼테일", src: "img/horntail.png" },
  "8888888": { name: "자쿰", src: "img/zakum.png" },
  "8888889": { name: "카오스 자쿰", src: "img/zakum.png" },
};
export function catalogMonsterImage(row, size = 96) {
  const remote = catalogImage(row.image_url, "catalog-monster-image", size);
  if (remote) return remote;
  const art = Object.hasOwn(bossArt, row.source_id) ? bossArt[row.source_id] : null;
  if (!art || art.name !== row.name) return "";
  return `<img data-catalog-image class="catalog-monster-image" src="${art.src}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async" />`;
}
