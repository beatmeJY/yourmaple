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
    // 원본 그림 API의 다음 동작(move → fly → stand → die1)을 차례로 불러 본다.
    const alts = (image.dataset.alts || "").split(" ").filter(Boolean);
    if (alts.length) {
      image.dataset.alts = alts.slice(1).join(" ");
      image.src = alts[0];
      return;
    }
    // 그래도 안 뜨면 관리자가 이어 둔 다른 몬스터 그림으로 한 번만 바꾼다(sql/070).
    const fallbackUrl = image.dataset.fallback;
    if (fallbackUrl) {
      delete image.dataset.fallback;
      image.classList.add("is-fallback");
      image.src = fallbackUrl;
      return;
    }
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
// 원본 그림 API 몬스터 그림은 동작 순서대로 시도한다(2026-11-16 사용자 요청): move → fly → stand → die1.
// 저장된 주소가 원본 그림 API 주소가 아니면 그 주소 하나만 쓴다.
export const MONSTER_ACTIONS = ["move", "fly", "stand", "die1"];
export function monsterImageUrls(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return []; }
  if (parsed.protocol !== "https:") return [];
  const match = /^(https:\/\/maplestory\.io\/api\/[^/]+\/[^/]+\/mob\/\d+\/render\/)[^/?#]+(.*)$/.exec(parsed.href);
  if (!match) return [parsed.href];
  return MONSTER_ACTIONS.map((action) => `${match[1]}${action}${match[2] || "?bgColor="}`);
}

export function catalogMonsterImage(row, size = 96) {
  // 우선순위: 원본 그림(동작 순서대로) → (모두 안 뜨거나 없으면) 관리자가 이어 둔 몬스터 그림
  const fallback = catalogImage(row.image_fallback_url, "catalog-monster-image is-fallback", size);
  const urls = monsterImageUrls(row.image_url);
  const remote = catalogImage(urls[0], "catalog-monster-image", size);
  if (remote) {
    const extra = [];
    if (urls.length > 1) extra.push(`data-alts="${escapeHtml(urls.slice(1).join(" "))}"`);
    if (fallback) extra.push(`data-fallback="${escapeHtml(new URL(row.image_fallback_url).href)}"`);
    return extra.length ? remote.replace("<img data-catalog-image", `<img data-catalog-image ${extra.join(" ")}`) : remote;
  }
  if (fallback) return fallback;
  const art = Object.hasOwn(bossArt, row.source_id) ? bossArt[row.source_id] : null;
  if (!art || art.name !== row.name) return "";
  return `<img data-catalog-image class="catalog-monster-image" src="${art.src}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async" />`;
}
