// 삭제한 몬스터(도감 관리자 전용, sql/071, 2026-11-16 사용자 요청).
// 논리 삭제한 몬스터만 모아 보고, 복구하면 공개 도감·검색·드랍 몬스터에 다시 나온다.
import { reviewRpc, canReviewCatalog, reviewError } from "../catalog-review.js";
import { catalogMonsterImage, mountCatalogImageFallback } from "../catalog-image.js";
import { clearCatalogCache } from "../catalog-api.js";
import { escapeHtml, formatCount } from "../format.js";
import { notify } from "../toast.js";
import { sfx } from "../effects.js";

const esc = (value) => escapeHtml(String(value ?? ""));
const missingSql = (error) => /Could not find the function|schema cache|does not exist/i.test(error?.message || "");
const when = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(date);
};

function card(row, index) {
  return `<article class="mt-card ym-glass" style="--i:${Math.min(index, 16)}" data-trash-row="${esc(row.id)}">
    <div class="mt-art">${catalogMonsterImage(row, 72) || `<b>${esc([...String(row.name || "?")][0])}</b>`}</div>
    <div class="mt-copy">
      <div class="mt-title"><strong>${esc(row.name)}</strong><span class="ym-badge">Lv.${row.level == null ? "-" : esc(formatCount(row.level))}</span></div>
      <p class="mt-meta">번호 ${esc(row.source_id ?? "-")} · HP ${esc(formatCount(row.hp))} · EXP ${esc(formatCount(row.exp))} · 드랍 ${esc(row.drop_count ?? 0)}개</p>
      <p class="mt-meta">삭제 ${esc(when(row.deleted_at))}</p>
      <p class="mt-reason">${row.deleted_reason ? esc(row.deleted_reason) : '<span class="mt-muted">삭제 이유 없음</span>'}</p>
    </div>
    <button type="button" class="primary-button mt-restore" data-restore="${esc(row.id)}">복구</button>
  </article>`;
}

export async function render(root) {
  mountCatalogImageFallback(root);
  root.innerHTML = `<section class="mt-page"><p class="hint">권한을 확인하는 중입니다.</p></section>`;
  if (!await canReviewCatalog()) {
    if (!root.isConnected) return;
    root.innerHTML = `<section class="mt-page"><header class="ym-page-head"><div><h1>삭제한 몬스터</h1><p>도감 관리자만 볼 수 있어요.</p></div></header>
      <a class="mo-ghost" href="/monsters/">몬스터 도감으로</a></section>`;
    return;
  }
  let rows = [];
  let query = "";
  let loadId = 0;

  function paint() {
    const list = root.querySelector("[data-trash-list]");
    if (!list) return;
    const shown = query ? rows.filter((row) => String(row.name).includes(query) || row.source_id === query) : rows;
    root.querySelector("[data-trash-count]").textContent = `삭제한 몬스터 ${rows.length}마리${query ? ` · 찾은 ${shown.length}마리` : ""}`;
    list.innerHTML = shown.length ? shown.map(card).join("")
      : `<p class="mt-empty">${rows.length ? "찾는 몬스터가 없어요." : "삭제한 몬스터가 없어요. 몬스터 상세의 \"몬스터 삭제\"로 숨길 수 있어요."}</p>`;
  }

  async function load() {
    const request = ++loadId;
    const result = await reviewRpc("catalog_monster_deleted_list");
    if (request !== loadId || !root.isConnected) return;
    const list = root.querySelector("[data-trash-list]");
    if (result.error || !Array.isArray(result.data)) {
      list.innerHTML = `<p class="mt-empty" role="alert">${esc(missingSql(result.error) ? "삭제한 몬스터를 보려면 sql/071을 먼저 실행해 주세요." : result.error ? reviewError(result.error) : "목록을 불러오지 못했습니다.")}</p>`;
      return;
    }
    rows = result.data;
    paint();
  }

  root.innerHTML = `<section class="mt-page">
    <header class="ym-page-head"><div><h1>삭제한 몬스터</h1><p>공개 도감·검색·아이템의 드랍 몬스터에서 숨긴 몬스터예요. 복구하면 바로 다시 보여요.</p></div>
      <div><span class="ym-badge">관리자 전용</span><a class="mo-ghost" href="/monsters/">몬스터 도감으로</a></div></header>
    <div class="mt-bar"><label class="field"><span>찾기</span><input data-trash-search placeholder="이름·몬스터 번호" autocomplete="off" /></label><p class="mt-count" data-trash-count></p></div>
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
    button.textContent = "복구하는 중";
    const result = await reviewRpc("catalog_monster_set_deleted", { p_id: row.id, p_deleted: false, p_reason: null });
    if (!root.isConnected) return;
    if (result.error) {
      button.disabled = false;
      button.textContent = "복구";
      notify(missingSql(result.error) ? "sql/071을 먼저 실행해 주세요." : reviewError(result.error), "error");
      return;
    }
    clearCatalogCache();
    sfx("check");
    const article = button.closest("[data-trash-row]");
    article?.classList.add("is-leaving");
    setTimeout(() => { rows = rows.filter((item) => item.id !== row.id); paint(); }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 260);
    notify(`${row.name}을(를) 복구했어요. 공개 도감에 다시 보여요.`, "success", { label: "도감에서 보기", onClick: () => { location.href = `/monsters/?q=${encodeURIComponent(row.name)}`; } });
  });
  void load();
}
