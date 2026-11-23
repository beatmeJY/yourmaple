// 맵 정보(2026-11-23 사용자 요청): 우리 도감 몬스터가 나오는 맵만 보여 준다(맵 자체는 수집한 맵 전부를 DB 에 둔다, sql/076).
// 이름은 수집한 한국어 이름, 틀리면 관리자가 "맵 수정"으로 고친다. 그림은 맵마다 정해진 버전(render.v·minimap.v)으로 공개 게임 데이터 서버에서 받는다.
import { canReviewCatalog } from "../catalog-review.js";
import { catalogError } from "../catalog.js";
import { catalogRpc, clearCatalogCache } from "../catalog-api.js";
import { catalogImage, catalogMonsterImage, chaosBadge, isChaosMonster, mountCatalogImageFallback } from "../catalog-image.js";
import { escapeHtml, formatCount } from "../format.js";
import { mountHistoryDialog } from "../catalog-history.js";
import { mapSlugFromPath } from "../route-url.js";
import { getSupabase } from "../supabase-client.js";
import { notify } from "../toast.js";
import { playSound, preloadSounds, sfx } from "../effects.js";

const text = v => escapeHtml(v == null || v === "" ? "미제공" : String(v));
const mapHref = map => `/maps/${encodeURIComponent(String(map.source_id))}/`;
const monsterHref = monster => monster.source_id ? `/monsters/${encodeURIComponent(monster.source_id)}/` : `/monsters/?q=${encodeURIComponent(monster.name)}`;
const levelRange = map => map.min_level == null ? "레벨 미제공" : map.min_level === map.max_level ? `Lv.${formatCount(map.min_level)}` : `Lv.${formatCount(map.min_level)}~${formatCount(map.max_level)}`;

// 그림 버전은 "gms/62" 같은 형태만 쓴다(sql/076 검사와 같음). 없으면 옛 버전(gms/83)·최신 한국판(kms/284) 순서로 시도.
const API = "https://maplestory.io/api";
const safeVersion = v => /^[a-z]{3}\/\d{1,4}$/.test(String(v ?? "")) ? v : "";
// 미니맵 그림(목록 카드·전체 그림이 없을 때).
export function mapImage(sourceId, size = 160, version = "") {
  const id = encodeURIComponent(String(sourceId));
  const urls = [...new Set([safeVersion(version), "gms/83", "kms/284"].filter(Boolean))].map(v => `${API}/${v}/map/${id}/minimap`);
  const html = catalogImage(urls[0], "catalog-map-image", size);
  return html.replace("<img data-catalog-image", `<img data-catalog-image data-alts="${urls.slice(1).join(" ")}"`);
}
// 맵 전체 그림(상세 무대).
function renderImage(sourceId, version) {
  const id = encodeURIComponent(String(sourceId));
  return catalogImage(`${API}/${version}/map/${id}/render/900`, "catalog-map-image map-render-image", 960);
}

export async function render(root) {
  mountCatalogImageFallback(root);
  const slug = mapSlugFromPath(location.pathname);
  if (slug) { preloadSounds(["portal"]); return renderDetail(root, slug); }
  const params = new URLSearchParams(location.search);
  let street = params.get("street") ?? "", page = 0, loadId = 0, timer, streets = null;
  root.innerHTML = `<section class="catalog-page map-page"><header class="ym-page-head"><div><h1>맵 정보</h1><p>몬스터가 나오는 맵을 찾고, 그 맵에 어떤 몬스터가 사는지 확인해 보세요.</p></div></header><div class="catalog-tools"><label class="field catalog-search"><span>맵 검색</span><input data-map-search placeholder="맵·지역·몬스터 이름 (예: 개미굴, 달팽이)" maxlength="100" value="${escapeHtml(params.get("q") ?? "")}" /></label><button type="button" class="mo-ghost" data-map-refresh>새로 확인</button></div><div class="catalog-filters" data-map-streets></div><p class="hint" data-map-count aria-live="polite"></p><div class="map-grid" data-map-list></div><nav class="catalog-pager" aria-label="맵 페이지"><button type="button" data-prev>이전</button><span data-page></span><button type="button" data-next>다음</button></nav></section>`;
  const search = root.querySelector("[data-map-search]");
  function syncAddress() {
    const next = new URLSearchParams(location.search);
    const q = search.value.trim();
    if (q) next.set("q", q); else next.delete("q");
    if (street) next.set("street", street); else next.delete("street");
    const query = next.toString();
    history.replaceState(history.state, "", location.pathname + (query ? `?${query}` : ""));
  }
  // 지역 칩: 맵이 많은 지역부터. 고른 지역은 개수가 0이어도 남긴다.
  function paintStreets() {
    const box = root.querySelector("[data-map-streets]");
    if (!streets) { box.innerHTML = ""; return; }
    const list = Object.entries(streets).filter(([name]) => name).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"));
    if (street && !streets[street]) list.unshift([street, 0]);
    const total = Object.values(streets).reduce((a, b) => a + Number(b), 0);
    const focused = box.contains(document.activeElement) ? document.activeElement.dataset.mapStreet ?? null : null;
    box.innerHTML = `<div class="catalog-filter-row" role="group" aria-label="지역"><button type="button" class="catalog-filter-chip${street ? "" : " is-on"}" data-map-street="" aria-pressed="${!street}">모든 지역<small>${formatCount(total)}</small></button>${list.map(([name, n]) => `<button type="button" class="catalog-filter-chip${street === name ? " is-on" : ""}" data-map-street="${escapeHtml(name)}" aria-pressed="${street === name}">${escapeHtml(name)}<small>${formatCount(n)}</small></button>`).join("")}</div>`;
    if (focused != null) box.querySelector(`[data-map-street="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    const row = box.querySelector(".catalog-filter-row"), on = row.querySelector(".is-on");
    if (on && row.scrollWidth > row.clientWidth && (on.offsetLeft < row.scrollLeft || on.offsetLeft + on.offsetWidth > row.scrollLeft + row.clientWidth)) row.scrollLeft = on.offsetLeft - 16;
  }
  async function load() {
    const request = ++loadId;
    const list = root.querySelector("[data-map-list]");
    list.innerHTML = `<p class="empty">맵을 찾는 중입니다.</p>`;
    root.querySelectorAll(".catalog-pager button").forEach(b => b.disabled = true);
    const result = await catalogRpc("catalog_search_maps", { p_query: search.value.trim(), p_street: street, p_page: page });
    if (!root.isConnected || request !== loadId) return;
    if (result.error) { list.innerHTML = `<p class="empty">${text(catalogError(result.error))}</p>`; return; }
    streets = result.data?.streets ?? null;
    paintStreets();
    const rows = result.data?.rows ?? [], total = result.data?.total ?? 0;
    root.querySelector("[data-map-count]").textContent = `${formatCount(total)}곳 중 ${rows.length}곳`;
    root.querySelector("[data-page]").textContent = `${page + 1} / ${Math.max(1, Math.ceil(total / 24))}`;
    root.querySelector("[data-prev]").disabled = page === 0;
    root.querySelector("[data-next]").disabled = (page + 1) * 24 >= total;
    list.innerHTML = rows.length ? rows.map((map, index) => {
      const more = Math.max(0, (map.monster_count ?? 0) - (map.monsters?.length ?? 0));
      return `<a class="map-card ym-glass" href="${mapHref(map)}" style="--i:${Math.min(index, 16)}"><div class="map-card-art">${mapImage(map.source_id, 160, map.image_v)}</div><div class="map-card-copy"><span class="map-card-street">${text(map.street_name)}</span><h2 title="${escapeHtml(map.name)}">${escapeHtml(map.name)}</h2><p class="map-card-meta"><span class="catalog-item-lv">${escapeHtml(levelRange(map))}</span><small>몬스터 ${formatCount(map.monster_count ?? 0)}종</small></p><span class="map-card-faces">${(map.monsters ?? []).map(m => `<span class="map-face" title="${escapeHtml(m.name)}">${catalogMonsterImage(m, 32) || `<b>${escapeHtml([...m.name][0] ?? "?")}</b>`}</span>`).join("")}${more ? `<span class="map-face is-more">+${formatCount(more)}</span>` : ""}</span></div></a>`;
    }).join("") : `<p class="empty">검색 결과가 없습니다.</p>`;
  }
  search.addEventListener("input", () => { clearTimeout(timer); ++loadId; page = 0; timer = setTimeout(() => { if (root.isConnected) { syncAddress(); void load(); } }, 300); });
  root.addEventListener("click", event => {
    const chip = event.target.closest("[data-map-street]");
    if (chip) { street = chip.dataset.mapStreet; page = 0; syncAddress(); paintStreets(); sfx("tick"); clearTimeout(timer); void load(); return; }
    if (event.target.closest("[data-prev]")) page = Math.max(0, page - 1);
    else if (event.target.closest("[data-next]")) page++;
    else if (event.target.closest("[data-map-refresh]")) { clearCatalogCache(); page = 0; }
    else return;
    clearTimeout(timer); void load();
  });
  await load();
}

// 맵 상세. 포탈로 넘어올 때는 미리 받은 결과(result)와 도착 포탈 이름(arrival)을 받아 깜빡임 없이 바꾼다.
async function renderDetail(root, slug, { result = null, arrival = "", push = false } = {}) {
  if (!result) root.innerHTML = `<section class="catalog-page map-detail-page"><div class="catalog-detail-actions"><a class="catalog-back-link" href="/maps/">← 맵 목록</a><span class="catalog-detail-actions-gap"></span></div><div data-map-detail><p class="empty">맵 정보를 불러오는 중입니다.</p></div></section>`;
  result ??= await catalogRpc("catalog_map_detail", /^\d+$/.test(slug) ? { p_source_id: Number(slug) } : { p_id: slug });
  if (!root.isConnected) return;
  if (!root.querySelector("[data-map-detail]")) root.innerHTML = `<section class="catalog-page map-detail-page"><div class="catalog-detail-actions"><a class="catalog-back-link" href="/maps/">← 맵 목록</a><span class="catalog-detail-actions-gap"></span></div><div data-map-detail></div></section>`;
  // 포탈로 넘어올 때 앞 맵의 처리기가 남지 않게 칸을 새것으로 바꾼다.
  const fresh = root.querySelector("[data-map-detail]").cloneNode(false);
  root.querySelector("[data-map-detail]").replaceWith(fresh);
  const slot = fresh;
  const actions = root.querySelector(".catalog-detail-actions");
  actions.querySelectorAll("button").forEach(b => b.remove());
  if (result.error || !result.data?.map) { slot.innerHTML = `<p class="empty">${result.error ? text(catalogError(result.error)) : `맵 번호 ${escapeHtml(slug)}을(를) 찾을 수 없습니다. 목록에서 다시 찾아 주세요.`}</p>`; return; }
  const { map, monsters = [], portals = [], spawns = [], minimap = null, render: art = null } = result.data;
  syncDetailAddress(root, map, push);
  const english = map.name_en && map.name_en !== map.name ? `${map.name_en}${map.street_name_en ? ` · ${map.street_name_en}` : ""}` : "";
  const sourceBadge = map.name_source === "gms" ? `<span class="ym-badge map-name-badge is-en" title="한국어 이름을 찾지 못해 영어 이름을 보여요">영어 이름</span>` : map.name_source === "operator" ? `<span class="ym-badge map-name-badge" title="관리자가 고친 이름">고친 이름</span>` : "";
  const levels = monsters.map(m => m.level).filter(v => v != null);
  const range = monsters.length ? levelRange({ min_level: levels.length ? Math.min(...levels) : null, max_level: levels.length ? Math.max(...levels) : null }) : "몬스터 없음";
  slot.innerHTML = `<header class="map-hero ym-glass${arrival ? " is-arriving" : ""}"><div class="map-hero-copy"><span class="map-card-street">${text(map.street_name)}</span><h1>${escapeHtml(map.name)} ${sourceBadge}</h1>${english ? `<p class="hint" lang="en">${escapeHtml(english)}</p>` : ""}<div class="map-hero-stats"><div><span>맵 번호</span><strong>${escapeHtml(String(map.source_id))}</strong></div><div><span>몬스터</span><strong>${formatCount(monsters.length)}종</strong></div><div><span>레벨</span><strong>${escapeHtml(range)}</strong></div><div><span>이동 포탈</span><strong>${formatCount(portals.length)}곳</strong></div></div></div>${mapStage(map, art, minimap, portals, spawns, monsters)}</header>${portalList(portals)}<section class="catalog-detail-panel ym-glass map-monsters"><h2>이 맵에 나오는 몬스터</h2>${monsters.length ? `<div class="map-monster-grid">${monsters.map((m, i) => `<a class="map-monster${isChaosMonster(m.name) ? " is-chaos" : ""}" href="${monsterHref(m)}" data-monster-card="${escapeHtml(m.id)}" style="--i:${Math.min(i, 16)}"><span class="map-monster-art">${catalogMonsterImage(m, 64) || `<b>${escapeHtml([...m.name][0] ?? "?")}</b>`}</span><span class="map-monster-copy"><span class="map-monster-name">${isChaosMonster(m.name) ? chaosBadge : ""}<b>${escapeHtml(m.name)}</b></span><small>${m.max_count ? `<em class="map-monster-count">최대 ${escapeHtml(formatCount(m.max_count))}마리</em>` : ""}${m.level == null ? "레벨 미제공" : `Lv.${escapeHtml(formatCount(m.level))}`} · HP ${m.hp == null ? "미제공" : escapeHtml(formatCount(m.hp))} · EXP ${m.exp == null ? "미제공" : escapeHtml(formatCount(m.exp))}</small></span></a>`).join("")}</div>` : `<p class="hint">이 맵에 나오는 도감 몬스터가 없습니다.</p>`}<p class="hint">맵·포탈·몬스터 위치는 공개 게임 데이터 기준이에요. 메이플랜드와 다를 수 있어요.</p></section>`;
  actions.insertAdjacentHTML("beforeend", `<button type="button" class="catalog-pill-button" data-map-refresh>새로 확인</button>`);
  actions.querySelector("[data-map-refresh]").addEventListener("click", () => { clearCatalogCache(); void renderDetail(root, String(map.source_id)); });
  mountStage(root, slot, portals, arrival);
  void canReviewCatalog().then(allowed => {
    if (!allowed || !actions.isConnected || !slot.isConnected) return; // 다른 맵으로 넘어갔으면 버리기
    // 변경 이력·수정은 관리자만(이력 읽기는 sql/069 정책이 막는다).
    actions.insertAdjacentHTML("beforeend", `<button type="button" class="catalog-history-button" data-open-history>변경 이력</button><button type="button" class="catalog-pill-button" data-edit-map>맵 수정</button>`);
    mountHistoryDialog(actions.querySelector("[data-open-history]"), map.id, "map", map.name);
    actions.querySelector("[data-edit-map]").addEventListener("click", () => openMapEditor(root, map, () => { clearCatalogCache(); void renderDetail(root, String(map.source_id)); }));
  });
}

// 그림 좌표 비율(sql/076): 전체 그림은 (게임 좌표 - 기준점) / 크기, 미니맵은 (게임 좌표 + 중심) / 크기.
const clamp = v => Math.min(100, Math.max(0, v * 100));
const frameOf = (art, minimap) => art?.w > 0 && art?.h > 0 ? { w: art.w, h: art.h, dx: -art.ox, dy: -art.oy }
  : minimap?.w > 0 && minimap?.h > 0 ? { w: minimap.w, h: minimap.h, dx: minimap.cx, dy: minimap.cy } : null;
const at = (frame, x, y) => ({ left: clamp((x + frame.dx) / frame.w), top: clamp((y + frame.dy) / frame.h) });
const portalLabel = p => `${p.to_name ?? `맵 ${p.to}`}${p.to_street ? ` · ${p.to_street}` : ""}`;
const isHiddenPortal = p => p.v === false || ![2, 7].includes(Number(p.t));

// 맵 그림 위에 포탈(누르면 이동)과 몬스터 그림(나오는 위치)을 올린다.
// 전체 그림 기준점이 있으면 전체 그림, 없으면 미니맵 기준, 둘 다 없으면 그림만(위치 표시 없음).
function mapStage(map, art, minimap, portals, spawns, monsters) {
  const byId = new Map(monsters.map(m => [m.id, m]));
  const full = art?.w > 0 && safeVersion(art.v);
  const frame = frameOf(full ? art : null, minimap);
  const picture = full ? renderImage(map.source_id, art.v) : mapImage(map.source_id, 320, minimap?.v || art?.v);
  if (!frame) return `<div class="map-stage-wrap"><div class="map-stage is-plain">${safeVersion(art?.v) ? renderImage(map.source_id, art.v) : picture}</div></div>`;
  const ratio = frame.w / frame.h;
  const mobs = spawns.map((s, i) => {
    const m = byId.get(s.monster_id);
    if (!m) return "";
    const pos = at(frame, Number(s.x), Number(s.y));
    return `<a class="map-spawn" href="${monsterHref(m)}" style="left:${pos.left}%;top:${pos.top}%;--i:${i % 24}" title="${escapeHtml(m.name)}" aria-label="${escapeHtml(m.name)} 나오는 자리" data-spawn-monster="${escapeHtml(m.id)}">${catalogMonsterImage(m, 40) || `<b>${escapeHtml([...m.name][0] ?? "?")}</b>`}</a>`;
  }).join("");
  const doors = portals.map((p, i) => {
    const pos = at(frame, Number(p.x), Number(p.y));
    const hidden = isHiddenPortal(p);
    return `<button type="button" class="map-portal${hidden ? " is-hidden" : ""}" style="left:${pos.left}%;top:${pos.top}%" data-portal="${i}" data-portal-name="${escapeHtml(p.n)}" aria-label="${escapeHtml(portalLabel(p))}(으)로 이동${hidden ? " (숨은 포탈)" : ""}"><i aria-hidden="true"></i><span class="map-portal-tip">${hidden ? "숨은 포탈 · " : ""}→ ${escapeHtml(portalLabel(p))}</span></button>`;
  }).join("");
  return `<div class="map-stage-wrap" data-stage-wrap><div class="map-stage${full ? " is-full" : ""}" data-stage style="--ratio:${ratio}">${picture}<div class="map-stage-layer">${mobs}${doors}</div></div></div>`;
}

function portalList(portals) {
  if (!portals.length) return "";
  // 같은 맵으로 가는 포탈은 한 칩으로.
  const seen = new Map();
  portals.forEach((p, i) => { if (!seen.has(p.to)) seen.set(p.to, { p, i }); });
  return `<nav class="map-exits ym-glass" aria-label="이동할 수 있는 맵"><h2>이동할 수 있는 맵</h2><div class="map-exit-chips">${[...seen.values()].map(({ p, i }, k) => `<button type="button" class="map-exit${isHiddenPortal(p) ? " is-hidden" : ""}" data-portal="${i}" style="--i:${k}"><i aria-hidden="true"></i><b>${escapeHtml(p.to_name ?? `맵 ${p.to}`)}</b>${p.to_street ? `<small>${escapeHtml(p.to_street)}</small>` : ""}</button>`).join("")}</div></nav>`;
}

// 무대 크기: 높이를 기준으로 가로 비율을 맞추고, 너무 좁으면 넓힌다. 넘치면 무대 안에서 스크롤.
function fitStage(slot) {
  const wrap = slot.querySelector("[data-stage-wrap]"), stage = slot.querySelector("[data-stage]");
  if (!wrap || !stage) return;
  const ratio = Number(stage.style.getPropertyValue("--ratio")) || 1;
  // 높이를 먼저 정하고(PC 360px, 휴대폰 240px), 가로가 무대보다 좁으면 무대 폭에 맞춰 키운다(대신 세로 스크롤).
  const full = stage.classList.contains("is-full"); // 전체 그림은 조금 더 크게
  const height = innerWidth < 720 ? (full ? 260 : 240) : (full ? 440 : 360);
  const width = Math.max(height * ratio, Math.min(wrap.clientWidth - 2, innerWidth < 720 ? 340 : 640));
  stage.style.width = `${Math.round(width)}px`;
  stage.style.height = `${Math.round(width / ratio)}px`;
}
function centerOn(slot, element, smooth) {
  const wrap = slot.querySelector("[data-stage-wrap]");
  if (!wrap || !element) return;
  const box = wrap.getBoundingClientRect(), r = element.getBoundingClientRect();
  wrap.scrollTo({ left: wrap.scrollLeft + r.left - box.left - box.width / 2 + r.width / 2, top: wrap.scrollTop + r.top - box.top - box.height / 2, behavior: smooth ? "smooth" : "auto" });
}

function mountStage(root, slot, portals, arrival) {
  fitStage(slot);
  const onResize = () => { if (!slot.isConnected) return removeEventListener("resize", onResize); fitStage(slot); };
  addEventListener("resize", onResize);
  // 포탈로 넘어왔으면 도착 포탈(이름이 같은 것, 없으면 가운데)에서 빛이 퍼진다.
  const door = arrival ? slot.querySelector(`.map-stage [data-portal-name="${CSS.escape(arrival)}"]`) : null;
  if (door) { door.classList.add("is-arrival"); centerOn(slot, door, false); }
  else if (arrival) slot.querySelector(".map-stage")?.classList.add("is-arrival-center");
  slot.addEventListener("click", event => {
    const button = event.target.closest("[data-portal]");
    if (!button || !slot.contains(button)) return;
    const portal = portals[Number(button.dataset.portal)];
    if (portal) void travel(root, slot, portal, button);
  });
  // 미리 받아 두면 누를 때 바로 넘어간다.
  slot.addEventListener("pointerover", event => {
    const button = event.target.closest("[data-portal]");
    const portal = button && portals[Number(button.dataset.portal)];
    if (portal) void catalogRpc("catalog_map_detail", { p_source_id: Number(portal.to) });
  });
}

let traveling = false;
async function travel(root, slot, portal, button) {
  if (traveling) return;
  traveling = true;
  try {
    playSound("portal", "portalWarp");
    const stage = slot.querySelector(".map-stage") ?? slot.querySelector(".map-hero");
    // 누른 포탈 쪽으로 빨려 들어가며 사라진다.
    const door = stage?.querySelector(`[data-portal="${button.dataset.portal}"]`) ?? null;
    if (door) { door.classList.add("is-entering"); stage.style.setProperty("--ox", door.style.left); stage.style.setProperty("--oy", door.style.top); }
    slot.classList.add("is-warping");
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const [result] = await Promise.all([catalogRpc("catalog_map_detail", { p_source_id: Number(portal.to) }), new Promise(r => setTimeout(r, reduce ? 0 : 420))]);
    if (!root.isConnected) return;
    slot.classList.remove("is-warping");
    if (result.error || !result.data?.map) { notify(result.error ? catalogError(result.error) : "그 맵 정보가 아직 없어요.", "error"); door?.classList.remove("is-entering"); return; }
    await renderDetail(root, String(portal.to), { result, arrival: portal.tp || "", push: true });
    root.querySelector(".map-detail-page")?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  } finally {
    traveling = false;
  }
}

function syncDetailAddress(root, map, push = false) {
  const path = mapHref(map);
  // 포탈로 넘어가면 기록을 남겨 뒤로가기로 앞 맵에 돌아간다.
  if (push && location.pathname !== path) history.pushState(history.state, "", path);
  else if (location.pathname !== path) history.replaceState(history.state, "", path + location.search);
  const title = `메랜 ${map.name} — 나오는 몬스터 | Your Maple`;
  root.dataset.docTitle = title;
  document.title = title;
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.href = `https://yourmaple.kr${path}`;
}

// 관리자 맵 수정: 이름·지역만. 저장하면 이름 출처가 "관리자"가 되어 다시 수집해도 그대로 남는다.
function openMapEditor(root, map, onSaved) {
  const dialog = document.createElement("dialog");
  dialog.className = "catalog-history-dialog map-edit-dialog";
  dialog.setAttribute("aria-labelledby", "map-edit-title");
  dialog.innerHTML = `<form method="dialog" data-map-edit><header class="catalog-history-dialog-head"><div><span class="ym-chip">맵 수정</span><h2 id="map-edit-title">${escapeHtml(map.name)}</h2></div><button type="button" class="mo-ghost" data-close aria-label="맵 수정 닫기">닫기 ×</button></header>${map.name_en ? `<p class="hint" lang="en">원래 영어 이름: ${escapeHtml(map.name_en)}${map.street_name_en ? ` · ${escapeHtml(map.street_name_en)}` : ""}</p>` : ""}<label class="field"><span>맵 이름</span><input name="name" required maxlength="200" value="${escapeHtml(map.name)}" /></label><label class="field"><span>지역</span><input name="street" maxlength="200" value="${escapeHtml(map.street_name ?? "")}" placeholder="비우면 지역 없음" /></label><p class="hint" data-map-edit-status role="status"></p><div class="map-edit-actions"><button type="button" class="mo-ghost" data-close>취소</button><button type="submit" class="catalog-pill-button" data-save>저장</button></div></form>`;
  root.append(dialog);
  const form = dialog.querySelector("form");
  const status = dialog.querySelector("[data-map-edit-status]");
  const dirty = () => form.name.value.trim() !== map.name || form.street.value.trim() !== (map.street_name ?? "");
  const close = () => { if (dirty() && !window.confirm("고친 내용을 저장하지 않고 닫을까요?")) return; dialog.close(); };
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  dialog.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", close));
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const name = form.name.value.trim();
    if (!name) { status.textContent = "맵 이름을 적어 주세요."; form.name.focus(); return; }
    if (!dirty()) { dialog.close(); return; }
    const save = dialog.querySelector("[data-save]");
    save.disabled = true;
    status.textContent = "저장하는 중입니다.";
    const client = await getSupabase();
    const result = await client.rpc("catalog_map_edit_save", { p_id: map.id, p_version: map.version, p_name: name, p_street_name: form.street.value.trim() });
    if (!dialog.isConnected) return;
    save.disabled = false;
    if (result.error) {
      status.textContent = result.error.code === "40001" ? "다른 곳에서 먼저 고쳤어요. 닫고 새로 확인한 뒤 다시 고쳐 주세요." : result.error.code === "42501" ? "맵을 고칠 권한이 없습니다." : catalogError(result.error);
      return;
    }
    dialog.close();
    sfx("check");
    notify(`${name} 맵 정보를 고쳐 공개했어요.`, "success");
    onSaved();
  });
  dialog.showModal();
  form.name.focus();
  form.name.select();
}
