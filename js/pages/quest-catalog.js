// 퀘스트 정보(2026-11-23 사용자 요청, sql/077): 수집한 퀘스트 목록·상세. 완료 조건·보상의 아이템·몬스터는 우리 도감과,
// 시작·완료 맵은 맵 정보와, 선행·다음 퀘스트는 서로 잇는다. 이름·레벨·보상 수치가 틀리면 관리자가 "퀘스트 수정"으로 고친다.
// 예전 개인 퀘스트 기록 화면(js/pages/quests.js)은 "my-quests"(숨김)로 남겨 두었다.
import { canReviewCatalog } from "../catalog-review.js";
import { catalogError } from "../catalog.js";
import { catalogRpc, clearCatalogCache } from "../catalog-api.js";
import { catalogImage, catalogMonsterImage, mountCatalogImageFallback } from "../catalog-image.js";
import { escapeHtml, formatCount } from "../format.js";
import { mountHistoryDialog } from "../catalog-history.js";
import { questSlugFromPath } from "../route-url.js";
import { questJobGroups, questJobText } from "../quest-jobs.js";
import { getSupabase } from "../supabase-client.js";
import { notify } from "../toast.js";
import { sfx } from "../effects.js";

const API = "https://maplestory.io/api";
const safeVersion = v => /^[a-z]{3}\/\d{1,4}$/.test(String(v ?? "").toLowerCase()) ? String(v).toLowerCase() : "";
const questHref = q => `/quests/${encodeURIComponent(String(q.source_id))}/`;
const levelText = q => q.min_level == null && q.max_level == null ? "레벨 제한 없음"
  : q.max_level == null ? `Lv.${formatCount(q.min_level)}~` : q.min_level == null ? `~Lv.${formatCount(q.max_level)}`
  : q.min_level === q.max_level ? `Lv.${formatCount(q.min_level)}` : `Lv.${formatCount(q.min_level)}~${formatCount(q.max_level)}`;
const METHOD = { fixed: ["모두 받아요", "보상 아이템을 모두 받아요."], random: ["하나를 무작위로", "아래 중 하나를 무작위로 받아요."], select: ["하나를 골라요", "아래 중 하나를 골라서 받아요."] };

// 그림: 정해진 버전 → 옛 버전(gms/83) → 최신 한국판(kms/284) 순서로 시도한다(맵 정보와 같은 방식).
function apiImage(kind, id, version, className, size) {
  const sid = encodeURIComponent(String(id));
  const urls = [...new Set([safeVersion(version), "gms/83", "kms/284"].filter(Boolean))].map(v => `${API}/${v}/${kind}/${sid}/icon`);
  return catalogImage(urls[0], className, size).replace("<img data-catalog-image", `<img data-catalog-image data-alts="${urls.slice(1).join(" ")}"`);
}
const npcImage = (npc, size = 56) => npc?.id ? apiImage("npc", npc.id, npc.v, "qc-npc-image", size) : "";
const initial = name => `<b class="qc-initial">${escapeHtml([...(name ?? "?")][0] ?? "?")}</b>`;

// 조건·보상 한 줄: 우리 도감에 있으면 도감 이름·그림·링크, 없으면 수집 이름과 공개 그림.
function entryParts(x, size) {
  if (x.item) return { name: x.item.name, href: x.item.source_id ? `/items/${encodeURIComponent(x.item.source_id)}/` : "", art: catalogImage(x.item.image_url, "qc-entry-image", size) || apiImage("item", x.i, x.v, "qc-entry-image", size), kind: "item" };
  if (x.monster) return { name: x.monster.name, href: x.monster.source_id ? `/monsters/${encodeURIComponent(x.monster.source_id)}/` : "", art: catalogMonsterImage(x.monster, size), kind: "monster", level: x.monster.level };
  if (x.m) return { name: x.n ?? `몬스터 ${x.m}`, href: "", art: catalogMonsterImage({ source_id: x.m, name: x.n ?? "", image_url: `${API}/${safeVersion(x.v) || "gms/83"}/mob/${encodeURIComponent(x.m)}/render/stand` }, size), kind: "monster" };
  return { name: x.n ?? `아이템 ${x.i}`, href: "", art: apiImage("item", x.i, x.v, "qc-entry-image", size), kind: "item" };
}

export async function render(root) {
  mountCatalogImageFallback(root);
  const slug = questSlugFromPath(location.pathname);
  if (slug) return renderDetail(root, slug);
  const params = new URLSearchParams(location.search);
  let region = params.get("region") ?? "", page = 0, loadId = 0, timer, regions = null;
  root.innerHTML = `<section class="catalog-page qc-page"><header class="ym-page-head"><div><h1>퀘스트 정보</h1><p>받을 수 있는 퀘스트를 찾고, 모아야 할 것과 보상·연속 퀘스트를 한눈에 확인해 보세요.</p></div></header>
    <div class="catalog-tools qc-tools"><label class="field catalog-search"><span>퀘스트 검색</span><input data-quest-search placeholder="퀘스트·NPC·아이템·몬스터 이름 (예: 달팽이, 헬레나)" maxlength="100" value="${escapeHtml(params.get("q") ?? "")}" /></label>
    <label class="field qc-level"><span>내 레벨</span><input data-quest-level type="number" inputmode="numeric" min="1" max="300" placeholder="모든 레벨" value="${escapeHtml(/^\d{1,3}$/.test(params.get("lv") ?? "") ? params.get("lv") : "")}" /></label>
    <button type="button" class="mo-ghost" data-quest-refresh>새로 확인</button></div>
    <div class="catalog-filters" data-quest-regions></div><p class="hint" data-quest-count aria-live="polite"></p><div class="qc-grid" data-quest-list></div>
    <nav class="catalog-pager" aria-label="퀘스트 페이지"><button type="button" data-prev>이전</button><span data-page></span><button type="button" data-next>다음</button></nav></section>`;
  const search = root.querySelector("[data-quest-search]");
  const levelInput = root.querySelector("[data-quest-level]");
  const level = () => { const n = Number(levelInput.value); return Number.isInteger(n) && n >= 1 && n <= 300 ? n : null; };
  function syncAddress() {
    const next = new URLSearchParams(location.search);
    const q = search.value.trim(), lv = level();
    if (q) next.set("q", q); else next.delete("q");
    if (lv) next.set("lv", String(lv)); else next.delete("lv");
    if (region) next.set("region", region); else next.delete("region");
    const query = next.toString();
    history.replaceState(history.state, "", location.pathname + (query ? `?${query}` : ""));
  }
  // 지역 칩: 퀘스트가 많은 지역부터, 지역 없음("-")은 끝에. 고른 지역은 개수가 0이어도 남긴다.
  function paintRegions() {
    const box = root.querySelector("[data-quest-regions]");
    if (!regions) { box.innerHTML = ""; return; }
    const list = Object.entries(regions).filter(([name]) => name).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"));
    if (regions[""]) list.push(["-", regions[""]]);
    if (region && !list.some(([name]) => name === region)) list.unshift([region, 0]);
    const total = Object.values(regions).reduce((a, b) => a + Number(b), 0);
    const focused = box.contains(document.activeElement) ? document.activeElement.dataset.questRegion ?? null : null;
    box.innerHTML = `<div class="catalog-filter-row" role="group" aria-label="지역"><button type="button" class="catalog-filter-chip${region ? "" : " is-on"}" data-quest-region="" aria-pressed="${!region}">모든 지역<small>${formatCount(total)}</small></button>${list.map(([name, n]) => `<button type="button" class="catalog-filter-chip${region === name ? " is-on" : ""}" data-quest-region="${escapeHtml(name)}" aria-pressed="${region === name}">${name === "-" ? "지역 없음" : escapeHtml(name)}<small>${formatCount(n)}</small></button>`).join("")}</div>`;
    if (focused != null) box.querySelector(`[data-quest-region="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    const row = box.querySelector(".catalog-filter-row"), on = row.querySelector(".is-on");
    if (on && row.scrollWidth > row.clientWidth && (on.offsetLeft < row.scrollLeft || on.offsetLeft + on.offsetWidth > row.scrollLeft + row.clientWidth)) row.scrollLeft = on.offsetLeft - 16;
  }
  async function load() {
    const request = ++loadId;
    const list = root.querySelector("[data-quest-list]");
    list.innerHTML = `<p class="empty">퀘스트를 찾는 중입니다.</p>`;
    root.querySelectorAll(".catalog-pager button").forEach(b => b.disabled = true);
    const result = await catalogRpc("catalog_search_quests", { p_query: search.value.trim(), p_region: region, p_level: level(), p_page: page });
    if (!root.isConnected || request !== loadId) return;
    if (result.error) { list.innerHTML = `<p class="empty">${escapeHtml(catalogError(result.error))}</p>`; return; }
    regions = result.data?.regions ?? null;
    paintRegions();
    const rows = result.data?.rows ?? [], total = result.data?.total ?? 0;
    root.querySelector("[data-quest-count]").textContent = `${level() ? `Lv.${level()}에 받을 수 있는 ` : ""}퀘스트 ${formatCount(total)}개 중 ${rows.length}개`;
    root.querySelector("[data-page]").textContent = `${page + 1} / ${Math.max(1, Math.ceil(total / 24))}`;
    root.querySelector("[data-prev]").disabled = page === 0;
    root.querySelector("[data-next]").disabled = (page + 1) * 24 >= total;
    list.innerHTML = rows.length ? rows.map((q, index) => questCard(q, index)).join("") : `<p class="empty">${level() ? "이 레벨에 받을 수 있는 퀘스트가 없어요. 레벨을 비우거나 바꿔 보세요." : "검색 결과가 없습니다."}</p>`;
  }
  const reload = () => { clearTimeout(timer); ++loadId; page = 0; timer = setTimeout(() => { if (root.isConnected) { syncAddress(); void load(); } }, 300); };
  search.addEventListener("input", reload);
  levelInput.addEventListener("input", reload);
  root.addEventListener("click", event => {
    const chip = event.target.closest("[data-quest-region]");
    if (chip) { region = chip.dataset.questRegion; page = 0; syncAddress(); paintRegions(); sfx("tick"); clearTimeout(timer); void load(); return; }
    if (event.target.closest("[data-prev]")) page = Math.max(0, page - 1);
    else if (event.target.closest("[data-next]")) page++;
    else if (event.target.closest("[data-quest-refresh]")) { clearCatalogCache(); page = 0; }
    else return;
    clearTimeout(timer); void load();
  });
  await load();
}

function questCard(q, index) {
  const jobs = questJobText(q.jobs, 3);
  const more = Math.max(0, (q.reward_count ?? 0) - (q.rewards?.length ?? 0));
  const pills = [q.reward_exp ? `<span class="qc-pill is-exp">EXP ${escapeHtml(formatCount(q.reward_exp))}</span>` : "", q.reward_meso ? `<span class="qc-pill is-meso">${escapeHtml(formatCount(q.reward_meso))} 메소</span>` : ""].join("");
  const items = (q.rewards ?? []).map(x => `<span class="qc-face" title="${escapeHtml(x.n ?? "")}${x.c > 1 ? ` ×${x.c}` : ""}">${apiImage("item", x.i, x.v, "qc-entry-image", 28) || initial(x.n)}</span>`).join("");
  return `<a class="qc-card ym-glass" href="${questHref(q)}" style="--i:${Math.min(index, 16)}">
    <span class="qc-card-top"><span class="qc-lv">${escapeHtml(levelText(q))}</span><span class="qc-region">${escapeHtml(q.region ?? "지역 없음")}</span>${q.chain ? `<span class="qc-chain-mark" title="이어지는 퀘스트가 있어요" aria-label="연속 퀘스트">연속</span>` : ""}</span>
    <h2 title="${escapeHtml(q.name)}">${escapeHtml(q.name)}</h2>
    <span class="qc-card-npc">${q.start_npc ? `<span class="qc-npc-face">${npcImage(q.start_npc, 32) || initial(q.start_npc.n)}</span><span>${escapeHtml(q.start_npc.n ?? "NPC")}</span>` : `<span class="hint">시작 NPC 미제공</span>`}</span>
    ${jobs ? `<span class="qc-card-jobs">${escapeHtml(jobs)} 전용</span>` : ""}
    <span class="qc-card-foot"><span class="qc-card-pills">${pills || `<span class="qc-pill">보상 수치 미제공</span>`}</span>${items || more ? `<span class="qc-card-faces">${items}${more ? `<span class="qc-face is-more">+${formatCount(more)}</span>` : ""}</span>` : ""}</span>
    ${q.condition_count ? `<span class="qc-card-goal">모을 것·잡을 것 ${formatCount(q.condition_count)}가지</span>` : ""}
  </a>`;
}

// 퀘스트 상세.
async function renderDetail(root, slug, { push = false } = {}) {
  root.innerHTML = `<section class="catalog-page qc-detail-page"><div class="catalog-detail-actions"><a class="catalog-back-link" href="/quests/">← 퀘스트 목록</a><span class="catalog-detail-actions-gap"></span></div><div data-quest-detail><p class="empty">퀘스트 정보를 불러오는 중입니다.</p></div></section>`;
  const result = await catalogRpc("catalog_quest_detail", /^\d+$/.test(slug) ? { p_source_id: Number(slug) } : { p_id: slug });
  if (!root.isConnected) return;
  const slot = root.querySelector("[data-quest-detail]");
  const actions = root.querySelector(".catalog-detail-actions");
  if (result.error || !result.data?.quest) { slot.innerHTML = `<p class="empty">${result.error ? escapeHtml(catalogError(result.error)) : `퀘스트 번호 ${escapeHtml(slug)}을(를) 찾을 수 없습니다. 목록에서 다시 찾아 주세요.`}</p>`; return; }
  const { quest: q, conditions = [], rewards = [], prerequisites = [], next_quests: next = [], start_map: startMap = null, end_map: endMap = null } = result.data;
  syncDetailAddress(root, q, push);
  const jobs = questJobGroups(q.jobs);
  const region = [q.region_group, q.region].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" › ");
  slot.innerHTML = `<header class="qc-hero ym-glass">
      <div class="qc-hero-copy"><span class="qc-hero-region">${escapeHtml(region || "지역 미제공")}</span>
        <h1>${escapeHtml(q.name)}${q.source === "operator" ? ` <span class="ym-badge is-gold qc-edited" title="관리자가 고친 정보가 있어요">고친 정보</span>` : ""}</h1>
        <div class="qc-hero-tags"><span class="qc-lv is-big">${escapeHtml(levelText(q))}</span>${jobs.length ? jobs.map(name => `<span class="ym-badge qc-job">${escapeHtml(name)}</span>`).join("") : `<span class="ym-badge is-gain qc-job">모든 직업</span>`}<span class="qc-number">퀘스트 번호 ${escapeHtml(String(q.source_id))}</span></div>
      </div>
      <div class="qc-npc-flow">${npcCard(q.start_npc, "시작", startMap, q.start_map)}<span class="qc-flow-arrow" aria-hidden="true"></span>${npcCard(q.end_npc ?? q.start_npc, "완료", endMap ?? (q.end_map ? null : startMap), q.end_map ?? q.start_map, !q.end_npc && !!q.start_npc)}</div>
    </header>
    <div class="qc-body">
      <section class="qc-panel ym-glass qc-goal"><h2><span class="qc-panel-icon" aria-hidden="true">!</span>완료 조건</h2>${conditions.length ? `<ul class="qc-entries">${conditions.map((x, i) => entryRow(x, i, true)).join("")}</ul>` : `<p class="qc-empty-note">모을 아이템이나 잡을 몬스터가 없어요. NPC에게 말을 걸거나 정해진 일을 하면 끝나요.</p>`}</section>
      <section class="qc-panel ym-glass qc-reward"><h2><span class="qc-panel-icon is-gold" aria-hidden="true">★</span>보상</h2>
        <div class="qc-reward-stats">${rewardStat("경험치", q.reward_exp, "is-exp")}${rewardStat("메소", q.reward_meso, "is-meso")}${rewardStat("인기도", q.reward_fame, "is-fame")}</div>
        ${rewards.length ? `<p class="qc-method"><span class="ym-badge is-gold">${escapeHtml(METHOD[q.reward_method]?.[0] ?? "보상 아이템")}</span> ${escapeHtml(METHOD[q.reward_method]?.[1] ?? "")}</p><ul class="qc-entries is-reward${q.reward_method === "fixed" ? "" : " is-choice"}">${rewards.map((x, i) => entryRow(x, i, false)).join("")}</ul>` : `<p class="qc-empty-note">보상 아이템은 없어요.</p>`}
      </section>
    </div>
    ${storyPanel(q)}
    ${chainPanel(q, prerequisites, next)}
    <p class="hint qc-foot-hint">퀘스트 정보는 공개된 게임 자료를 바탕으로 정리한 참고값이에요. 메이플랜드와 다를 수 있어요.</p>`;
  actions.insertAdjacentHTML("beforeend", `<button type="button" class="catalog-pill-button" data-quest-refresh>새로 확인</button>`);
  actions.querySelector("[data-quest-refresh]").addEventListener("click", () => { clearCatalogCache(); void renderDetail(root, String(q.source_id)); });
  void canReviewCatalog().then(allowed => {
    if (!allowed || !actions.isConnected || !slot.isConnected) return;
    actions.insertAdjacentHTML("beforeend", `<button type="button" class="catalog-history-button" data-open-history>변경 이력</button><button type="button" class="catalog-pill-button" data-edit-quest>퀘스트 수정</button>`);
    mountHistoryDialog(actions.querySelector("[data-open-history]"), q.id, "quest", q.name);
    actions.querySelector("[data-edit-quest]").addEventListener("click", () => openQuestEditor(root, q, () => { clearCatalogCache(); void renderDetail(root, String(q.source_id)); }));
  });
}

function npcCard(npc, role, map, mapNumber, same = false) {
  const place = map ? `<a class="qc-npc-map" href="/maps/${encodeURIComponent(String(map.source_id))}/">${escapeHtml(map.name)}${map.street_name && map.street_name !== map.name ? `<small>${escapeHtml(map.street_name)}</small>` : ""}</a>` : mapNumber ? `<span class="qc-npc-map is-plain">맵 ${escapeHtml(String(mapNumber))}</span>` : "";
  return `<div class="qc-npc-card${role === "완료" ? " is-end" : ""}"><span class="qc-npc-role">${role}</span><span class="qc-npc-portrait">${npc ? npcImage(npc, 64) || initial(npc.n) : initial("?")}</span><strong>${escapeHtml(npc?.n ?? "미제공")}</strong>${same ? `<small class="hint">시작과 같음</small>` : ""}${place}</div>`;
}

function rewardStat(label, value, tone) {
  if (value == null || Number(value) === 0) return "";
  return `<div class="qc-stat ${tone}"><span>${label}</span><strong>${Number(value) > 0 && tone === "is-fame" ? "+" : ""}${escapeHtml(formatCount(value))}</strong></div>`;
}

function entryRow(x, index, goal) {
  const part = entryParts(x, 44);
  const name = part.href ? `<a href="${part.href}">${escapeHtml(part.name)}</a>` : `<span>${escapeHtml(part.name)}</span>`;
  const verb = goal ? (part.kind === "monster" ? "물리치기" : "모으기") : "";
  return `<li class="qc-entry is-${part.kind}" style="--i:${Math.min(index, 16)}"><span class="qc-entry-art">${part.art || initial(part.name)}</span><span class="qc-entry-copy"><b>${name}</b><small>${goal ? `${part.kind === "monster" ? "몬스터" : "아이템"} ${verb}` : part.kind === "monster" ? "몬스터" : "아이템"}${part.level != null ? ` · Lv.${escapeHtml(formatCount(part.level))}` : ""}${part.href ? "" : " · 도감 미등록"}</small></span><span class="qc-entry-count" aria-label="${formatCount(x.c ?? 1)}${part.kind === "monster" ? "마리" : "개"}">×${escapeHtml(formatCount(x.c ?? 1))}</span></li>`;
}

function storyPanel(q) {
  const parts = [["받기 전", q.start_text], ["진행 중", q.progress_text], ["완료하면", q.complete_text]].filter(([, text]) => text);
  if (!parts.length) return "";
  return `<section class="qc-panel ym-glass qc-story"><h2><span class="qc-panel-icon" aria-hidden="true">✎</span>퀘스트 안내</h2><ol class="qc-story-steps">${parts.map(([label, text], i) => `<li style="--i:${i}"><span class="qc-story-label">${label}</span><p>${escapeHtml(text)}</p></li>`).join("")}</ol></section>`;
}

function chainPanel(q, prerequisites, next) {
  if (!prerequisites.length && !next.length) return "";
  const link = r => `<a class="qc-chain-link" href="${questHref(r)}"><b>${escapeHtml(r.name)}</b><small>${r.min_level != null ? `Lv.${escapeHtml(formatCount(r.min_level))}` : "레벨 제한 없음"}</small></a>`;
  return `<section class="qc-panel ym-glass qc-chain"><h2><span class="qc-panel-icon" aria-hidden="true">⇢</span>연속 퀘스트</h2><div class="qc-chain-flow">
    <div class="qc-chain-col"><span class="qc-chain-label">먼저 끝낼 퀘스트</span>${prerequisites.length ? prerequisites.map(link).join("") : `<span class="qc-chain-none">없음</span>`}</div>
    <span class="qc-flow-arrow" aria-hidden="true"></span>
    <div class="qc-chain-col is-current"><span class="qc-chain-label">지금 퀘스트</span><span class="qc-chain-link is-current"><b>${escapeHtml(q.name)}</b><small>${escapeHtml(levelText(q))}</small></span></div>
    <span class="qc-flow-arrow" aria-hidden="true"></span>
    <div class="qc-chain-col"><span class="qc-chain-label">다음 퀘스트</span>${next.length ? next.map(link).join("") : `<span class="qc-chain-none">없음</span>`}</div>
  </div></section>`;
}

function syncDetailAddress(root, q, push = false) {
  const path = questHref(q);
  if (push && location.pathname !== path) history.pushState(history.state, "", path);
  else if (location.pathname !== path) history.replaceState(history.state, "", path + location.search);
  const title = `메랜 ${q.name} 퀘스트 — 조건·보상 | Your Maple`;
  root.dataset.docTitle = title;
  document.title = title;
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.href = `https://yourmaple.kr${path}`;
}

// 관리자 퀘스트 수정: 이름·레벨·보상 수치. 저장하면 이 퀘스트는 "관리자"가 되어 다시 등록해도 고친 칸이 그대로 남는다.
function openQuestEditor(root, q, onSaved) {
  const dialog = document.createElement("dialog");
  dialog.className = "catalog-history-dialog map-edit-dialog qc-edit-dialog";
  dialog.setAttribute("aria-labelledby", "quest-edit-title");
  const num = (name, label, value, extra = "") => `<label class="field"><span>${label}</span><input name="${name}" type="number" inputmode="numeric" value="${value ?? ""}" placeholder="비우면 미제공" ${extra} /></label>`;
  dialog.innerHTML = `<form method="dialog"><header class="catalog-history-dialog-head"><div><span class="ym-chip">퀘스트 수정</span><h2 id="quest-edit-title">${escapeHtml(q.name)}</h2></div><button type="button" class="mo-ghost" data-close aria-label="퀘스트 수정 닫기">닫기 ×</button></header>
    <label class="field"><span>퀘스트 이름</span><input name="name" required maxlength="200" value="${escapeHtml(q.name)}" /></label>
    <div class="qc-edit-grid">${num("min", "최소 레벨", q.min_level, 'min="1" max="300"')}${num("max", "최대 레벨", q.max_level, 'min="1" max="300"')}${num("exp", "보상 경험치", q.reward_exp, 'min="0"')}${num("meso", "보상 메소", q.reward_meso)}${num("fame", "보상 인기도", q.reward_fame, 'min="-10000" max="10000"')}</div>
    <p class="hint" data-status role="status"></p><div class="map-edit-actions"><button type="button" class="mo-ghost" data-close>취소</button><button type="submit" class="catalog-pill-button" data-save>저장</button></div></form>`;
  root.append(dialog);
  const form = dialog.querySelector("form"), status = dialog.querySelector("[data-status]");
  const read = name => { const v = form[name].value.trim(); return v === "" ? null : Number(v); };
  const values = () => ({ name: form.name.value.trim(), min: read("min"), max: read("max"), exp: read("exp"), meso: read("meso"), fame: read("fame") });
  const original = JSON.stringify(values());
  const dirty = () => JSON.stringify(values()) !== original;
  const close = () => { if (dirty() && !window.confirm("고친 내용을 저장하지 않고 닫을까요?")) return; dialog.close(); };
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  dialog.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", close));
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const v = values();
    const bad = (field, message) => { status.textContent = message; form[field].focus(); };
    if (!v.name) return bad("name", "퀘스트 이름을 적어 주세요.");
    for (const key of ["min", "max", "exp", "meso", "fame"]) if (v[key] != null && !Number.isInteger(v[key])) return bad(key, "숫자는 정수로 적어 주세요.");
    if ((v.min != null && (v.min < 1 || v.min > 300)) || (v.max != null && (v.max < 1 || v.max > 300))) return bad(v.min != null && (v.min < 1 || v.min > 300) ? "min" : "max", "레벨은 1~300 사이로 적어 주세요.");
    if (v.min != null && v.max != null && v.min > v.max) return bad("max", "최대 레벨이 최소 레벨보다 작아요.");
    if (v.exp != null && v.exp < 0) return bad("exp", "경험치는 0 이상으로 적어 주세요.");
    if (!dirty()) { dialog.close(); return; }
    const save = dialog.querySelector("[data-save]");
    save.disabled = true;
    status.textContent = "저장하는 중입니다.";
    const client = await getSupabase();
    const result = await client.rpc("catalog_quest_edit_save", { p_id: q.id, p_version: q.version, p_name: v.name, p_min_level: v.min, p_max_level: v.max, p_reward_exp: v.exp, p_reward_meso: v.meso, p_reward_fame: v.fame });
    if (!dialog.isConnected) return;
    save.disabled = false;
    if (result.error) {
      status.textContent = result.error.code === "40001" ? "다른 곳에서 먼저 고쳤어요. 닫고 새로 확인한 뒤 다시 고쳐 주세요." : result.error.code === "42501" ? "퀘스트를 고칠 권한이 없습니다." : catalogError(result.error);
      return;
    }
    dialog.close();
    sfx("check");
    notify(`${v.name} 퀘스트 정보를 고쳐 공개했어요.`, "success");
    onSaved();
  });
  dialog.showModal();
  form.name.focus();
  form.name.select();
}
