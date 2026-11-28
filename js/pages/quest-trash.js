// 삭제한 퀘스트(도감 관리자 전용, sql/079, 2026-11-23 사용자 요청). 삭제한 몬스터 화면(monster-trash.js)과 같은 흐름:
// 논리 삭제한 퀘스트만 모아 보고, 되살리면 공개 퀘스트 목록·상세·연속 퀘스트에 다시 나온다.
import { reviewRpc, canReviewCatalog, reviewError } from "../catalog-review.js";
import { clearCatalogCache } from "../catalog-api.js";
import { escapeHtml, formatCount } from "../format.js";
import { catalogImage, mountCatalogImageFallback } from "../catalog-image.js";
import { notify } from "../toast.js";
import { sfx } from "../effects.js";

const esc = (value) => escapeHtml(String(value ?? ""));
const missingSql = (error) => /Could not find the function|schema cache|does not exist/i.test(error?.message || "");
const when = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(date);
};
// 시작 NPC 그림(퀘스트 정보와 같은 공개 게임 데이터). 없으면 이름 첫 글자.
const npcArt = (npc) => {
  if (!npc?.id) return "";
  const version = /^[a-z]{3}\/\d{1,4}$/.test(String(npc.v ?? "")) ? npc.v : "gms/83";
  return catalogImage(`https://maplestory.io/api/${version}/npc/${encodeURIComponent(npc.id)}/icon`, "mt-npc-image", 64);
};
const level = (q) => q.min_level == null ? "레벨 제한 없음" : `Lv.${formatCount(q.min_level)}${q.max_level != null && q.max_level !== q.min_level ? `~${formatCount(q.max_level)}` : ""}`;

function card(row, index) {
  return `<article class="mt-card ym-glass" style="--i:${Math.min(index, 16)}" data-trash-row="${esc(row.id)}">
    <div class="mt-art">${npcArt(row.start_npc) || `<b>${esc([...String(row.name || "?")][0])}</b>`}</div>
    <div class="mt-copy">
      <div class="mt-title"><strong>${esc(row.name)}</strong><span class="ym-badge">${esc(level(row))}</span></div>
      <p class="mt-meta">퀘스트 번호 ${esc(row.source_id)} · ${esc(row.region ?? "지역 없음")}${row.start_npc?.n ? ` · ${esc(row.start_npc.n)}` : ""} · 조건 ${esc(row.condition_count ?? 0)} · 보상 ${esc(row.reward_count ?? 0)}</p>
      <p class="mt-meta">삭제 ${esc(when(row.deleted_at))}</p>
      <p class="mt-reason">${row.deleted_reason ? esc(row.deleted_reason) : '<span class="mt-muted">삭제 이유 없음</span>'}</p>
    </div>
    <button type="button" class="primary-button mt-restore" data-restore="${esc(row.id)}">되살리기</button>
  </article>`;
}

export async function render(root) {
  mountCatalogImageFallback(root);
  root.innerHTML = `<section class="mt-page"><p class="hint">권한을 확인하는 중입니다.</p></section>`;
  if (!await canReviewCatalog()) {
    if (!root.isConnected) return;
    root.innerHTML = `<section class="mt-page"><header class="ym-page-head"><div><h1>삭제한 퀘스트</h1><p>도감 관리자만 볼 수 있어요.</p></div></header>
      <a class="mo-ghost" href="/quests/">퀘스트 정보로</a></section>`;
    return;
  }
  let rows = [], query = "", loadId = 0;

  function paint() {
    const list = root.querySelector("[data-trash-list]");
    if (!list) return;
    const shown = query ? rows.filter((row) => String(row.name).includes(query) || String(row.source_id) === query) : rows;
    root.querySelector("[data-trash-count]").textContent = `삭제한 퀘스트 ${rows.length}개${query ? ` · 찾은 ${shown.length}개` : ""}`;
    list.innerHTML = shown.length ? shown.map(card).join("")
      : `<p class="mt-empty">${rows.length ? "찾는 퀘스트가 없어요." : "삭제한 퀘스트가 없어요. 퀘스트 상세의 \"퀘스트 삭제\"로 숨길 수 있어요."}</p>`;
  }

  async function load() {
    const request = ++loadId;
    const result = await reviewRpc("catalog_quest_deleted_list");
    if (request !== loadId || !root.isConnected) return;
    const list = root.querySelector("[data-trash-list]");
    if (result.error || !Array.isArray(result.data)) {
      list.innerHTML = `<p class="mt-empty" role="alert">${esc(missingSql(result.error) ? "삭제한 퀘스트를 보려면 sql/079를 먼저 실행해 주세요." : result.error ? reviewError(result.error) : "목록을 불러오지 못했습니다.")}</p>`;
      return;
    }
    rows = result.data;
    paint();
  }

  root.innerHTML = `<section class="mt-page">
    <header class="ym-page-head"><div><h1>삭제한 퀘스트</h1><p>퀘스트 목록·검색·연속 퀘스트에서 숨긴 퀘스트예요. 되살리면 바로 다시 보여요.</p></div>
      <div><span class="ym-badge">관리자 전용</span><a class="mo-ghost" href="/quest-review/">퀘스트 검토함</a><a class="mo-ghost" href="/quests/">퀘스트 정보로</a></div></header>
    <div class="mt-bar"><label class="field"><span>찾기</span><input data-trash-search placeholder="이름·퀘스트 번호" autocomplete="off" /></label><p class="mt-count" data-trash-count></p></div>
    <div class="mt-list" data-trash-list aria-live="polite"><p class="hint">불러오는 중입니다.</p></div>
  </section>`;

  root.addEventListener("input", (event) => {
    if (!event.target.matches("[data-trash-search]")) return;
    query = event.target.value.trim();
    paint();
  });
  root.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-restore]");
    if (!button || button.disabled) return;
    const row = rows.find((item) => item.id === button.dataset.restore);
    if (!row) return;
    button.disabled = true;
    button.textContent = "되살리는 중";
    const result = await reviewRpc("catalog_quest_set_deleted", { p_id: row.id, p_deleted: false, p_reason: null });
    if (!root.isConnected) return;
    if (result.error) {
      button.disabled = false;
      button.textContent = "되살리기";
      notify(missingSql(result.error) ? "sql/079를 먼저 실행해 주세요." : reviewError(result.error), "error");
      return;
    }
    clearCatalogCache();
    sfx("check");
    button.closest("[data-trash-row]")?.classList.add("is-leaving");
    setTimeout(() => { rows = rows.filter((item) => item.id !== row.id); paint(); }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 260);
    notify(`${row.name}을(를) 되살렸어요. 퀘스트 정보에 다시 보여요.`, "success", { label: "퀘스트 보기", onClick: () => { location.href = `/quests/${encodeURIComponent(row.source_id)}/`; } });
  });
  void load();
}
