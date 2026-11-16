// 몬스터 드랍 수정창(도감 관리자 전용, sql/072). 몬스터 수정창(catalog-monster-editor.js)과 같은 흐름:
// 불러오기 → 확률 고치기·빼기·아이템 검색해 넣기 → 저장하면 공개 도감에 바로 반영, 다른 화면에서 먼저 고쳤으면 저장을 막는다.
import { escapeHtml } from "./format.js";
import { reviewRpc, reviewError } from "./catalog-review.js";
import { catalogRpc, clearCatalogCache } from "./catalog-api.js";
import { catalogImage, mountCatalogImageFallback } from "./catalog-image.js";
import { dropSavePayload, dropsChanged, rateInput } from "./monster-drops-edit.js";

const esc = (value) => escapeHtml(String(value ?? ""));
let seq = 0;

function rowHtml(row) {
  const added = !row.id;
  return `<li class="mde-row${row.removed ? " is-removed" : ""}${added ? " is-new" : ""}" data-row="${row.key}">
    <span class="mde-art">${catalogImage(row.item.image_url, "mde-img", 32) || "<span aria-hidden=\"true\">?</span>"}</span>
    <span class="mde-name"><b>${esc(row.item.name)}</b>${added ? '<em class="mde-tag">새로</em>' : ""}${row.item.source_id ? `<small>#${esc(row.item.source_id)}</small>` : ""}</span>
    <label class="mde-rate"><span class="sr-only">${esc(row.item.name)} 드랍 확률</span><input data-rate inputmode="decimal" autocomplete="off" value="${esc(row.rate)}" placeholder="미상"${row.removed ? " disabled" : ""}><i aria-hidden="true">%</i></label>
    <button type="button" class="mo-ghost mde-toggle" data-toggle-row aria-label="${esc(row.item.name)} ${row.removed ? "되살리기" : "빼기"}">${row.removed ? "되살리기" : "빼기"}</button>
  </li>`;
}

export function mountMonsterDropsEditor(button, root, id, monsterName, onSaved) {
  button.setAttribute("aria-haspopup", "dialog");
  let dialog;
  button.addEventListener("click", async () => {
    if (dialog?.isConnected) return;
    dialog = document.createElement("dialog");
    dialog.className = "catalog-edit-dialog mde-dialog ym-glass";
    dialog.setAttribute("aria-labelledby", "drops-edit-title");
    dialog.innerHTML = `<header><h2 id="drops-edit-title">드랍 수정 <small>${esc(monsterName)}</small></h2><button type="button" class="mo-ghost" data-close-edit aria-label="드랍 수정창 닫기">닫기</button></header><div data-edit-body><p class="hint">드랍 목록을 불러오는 중입니다.</p></div>`;
    root.append(dialog);
    mountCatalogImageFallback(dialog);
    // 몬스터 화면의 검색·필터 처리기가 수정창 입력을 받지 않게 막는다.
    for (const type of ["click", "input", "change", "submit", "keydown"]) dialog.addEventListener(type, (event) => event.stopPropagation());
    dialog.showModal();
    const active = dialog;
    let saving = false, initial = [], rows = [];
    const dirty = () => dropsChanged(initial, rows);
    const close = () => {
      if (saving) return;
      if (dirty()) { const warning = active.querySelector("[data-close-warning]"); if (warning) { warning.hidden = false; warning.querySelector("button")?.focus(); return; } }
      active.close();
    };
    active.addEventListener("close", () => { active.remove(); if (button.isConnected) button.focus({ preventScroll: true }); }, { once: true });
    active.addEventListener("cancel", (event) => { event.preventDefault(); close(); });

    const result = await reviewRpc("catalog_monster_drops_edit_detail", { p_id: id });
    if (!active.isConnected || !active.open) return;
    const body = active.querySelector("[data-edit-body]");
    if (result.error || !Array.isArray(result.data?.drops)) {
      const missing = /Could not find the function|schema cache/i.test(result.error?.message || "");
      body.innerHTML = `<p class="hint" role="alert">${esc(missing ? "드랍 수정을 쓰려면 sql/072를 먼저 실행해 주세요." : result.error ? reviewError(result.error) : "몬스터를 찾을 수 없습니다.")}</p>`;
      return;
    }
    initial = result.data.drops.map((drop) => ({ id: drop.id, item_id: drop.item_id, rate_percent: drop.rate_percent }));
    rows = result.data.drops.map((drop) => ({ key: ++seq, id: drop.id, item: drop.item ?? { id: drop.item_id, name: "이름 없는 아이템" }, rate: rateInput(drop.rate_percent), removed: false }));
    body.innerHTML = `<form data-drops-edit-form novalidate>
      <section class="mde-add"><h3>아이템 넣기</h3>
        <div class="mde-search"><span class="ym-search-icon" aria-hidden="true"></span><input type="search" data-item-search autocomplete="off" placeholder="아이템 이름·번호로 찾기" aria-label="넣을 아이템 찾기" aria-controls="mde-results"></div>
        <ul class="mde-results" id="mde-results" data-results hidden></ul>
      </section>
      <section><h3>드랍 목록 <span class="mde-count" data-count></span></h3>
        <p class="hint">확률 빈칸은 "확률 미상", 0은 실제 0%입니다. 같은 아이템을 두 줄 넣을 수도 있어요.</p>
        <ul class="mde-list" data-list></ul>
      </section>
      <p class="hint">저장하면 공개 도감에 바로 반영되고, 바뀐 줄마다 변경 이력에 남습니다. 수집 자료를 다시 등록하면 수집 드랍은 원문 값으로 돌아가고, 새로 넣은 드랍은 남습니다.</p>
      <p data-edit-status role="status"></p>
      <div data-close-warning hidden><p>저장하지 않은 변경을 버리고 닫을까요?</p><button type="button" class="mo-ghost" data-discard-edit>변경을 버리고 닫기</button></div>
      <footer><button type="button" class="mo-ghost" data-close-edit>취소</button><button type="submit" class="primary-button" data-save-drops>드랍 저장 · 공개 반영</button></footer>
    </form>`;
    const list = body.querySelector("[data-list]");
    const status = body.querySelector("[data-edit-status]");
    const results = body.querySelector("[data-results]");
    const search = body.querySelector("[data-item-search]");
    const paintCount = () => {
      const live = rows.filter((row) => !row.removed).length, gone = rows.length - live;
      body.querySelector("[data-count]").textContent = `${live}개${gone ? ` · 뺄 것 ${gone}` : ""}`;
      body.querySelector("[data-save-drops]").disabled = saving || !dirty();
    };
    const paintList = () => {
      list.innerHTML = rows.length ? rows.map(rowHtml).join("") : '<li class="mde-empty">드랍이 없습니다. 위에서 아이템을 찾아 넣어 주세요.</li>';
      paintCount();
    };
    const hideWarning = () => { const warning = active.querySelector("[data-close-warning]"); if (warning) warning.hidden = true; };
    paintList();
    search.focus();

    // 아이템 검색(공개 도감 검색 그대로, 앞 8개만)
    let searchId = 0, timer = 0, found = [];
    const runSearch = async () => {
      const query = search.value.trim(), mine = ++searchId;
      if (!query) { results.hidden = true; results.innerHTML = ""; found = []; return; }
      results.hidden = false;
      results.innerHTML = '<li class="mde-muted">찾는 중…</li>';
      const response = await catalogRpc("catalog_search_items", { p_query: query, p_page: 0 });
      if (mine !== searchId || !active.isConnected) return;
      if (response.error) { results.innerHTML = `<li class="mde-muted">${esc(reviewError(response.error))}</li>`; return; }
      found = (response.data?.rows ?? []).slice(0, 8);
      results.innerHTML = found.length
        ? found.map((item, index) => `<li><button type="button" class="mde-pick" data-pick="${index}"><i class="mde-pick-art">${catalogImage(item.image_url, "mde-img", 28)}</i><span>${esc(item.name)}</span>${item.source_id ? `<small>#${esc(item.source_id)}</small>` : ""}<b aria-hidden="true">＋</b></button></li>`).join("")
        : '<li class="mde-muted">찾는 아이템이 없습니다.</li>';
    };
    search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(runSearch, 220); });
    search.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); clearTimeout(timer); void runSearch().then(() => results.querySelector("[data-pick]")?.focus()); }
      else if (event.key === "ArrowDown") { event.preventDefault(); results.querySelector("[data-pick]")?.focus(); }
    });

    active.addEventListener("click", (event) => {
      if (event.target.closest("[data-discard-edit]")) { rows = []; initial = []; active.close(); return; }
      if (event.target.closest("[data-close-edit]")) { close(); return; }
      const pick = event.target.closest("[data-pick]");
      if (pick) {
        const item = found[Number(pick.dataset.pick)];
        if (!item) return;
        const row = { key: ++seq, id: null, item, rate: "", removed: false };
        rows.unshift(row);
        paintList();
        hideWarning();
        const added = list.querySelector(`[data-row="${row.key}"]`);
        added?.classList.add("is-flash");
        added?.querySelector("[data-rate]")?.focus();
        status.textContent = `${item.name}을(를) 넣었어요. 확률을 적어 주세요.`;
        status.classList.remove("is-error");
        return;
      }
      const toggle = event.target.closest("[data-toggle-row]");
      if (toggle) {
        const row = rows.find((entry) => String(entry.key) === toggle.closest("[data-row]").dataset.row);
        if (!row) return;
        // 새로 넣은 줄은 바로 없앤다. 기존 줄은 "뺄 것"으로 두고 되살릴 수 있다.
        if (!row.id) rows = rows.filter((entry) => entry !== row);
        else row.removed = !row.removed;
        paintList();
        hideWarning();
        list.querySelector(`[data-row="${row.key}"] [data-toggle-row]`)?.focus();
      }
    });
    list.addEventListener("input", (event) => {
      const input = event.target.closest("[data-rate]");
      if (!input) return;
      const row = rows.find((entry) => String(entry.key) === input.closest("[data-row]").dataset.row);
      if (row) row.rate = input.value;
      input.closest("[data-row]").classList.remove("is-invalid");
      hideWarning();
      paintCount();
    });

    active.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (saving) return;
      let payload;
      try { payload = dropSavePayload(rows); }
      catch (error) {
        status.textContent = error.message;
        status.classList.add("is-error");
        // 확률이 틀린 첫 줄로 데려간다.
        const bad = rows.find((row) => !row.removed && (() => { try { dropSavePayload([row]); return false; } catch { return true; } })());
        const node = bad && list.querySelector(`[data-row="${bad.key}"]`);
        node?.classList.add("is-invalid");
        node?.querySelector("[data-rate]")?.focus();
        return;
      }
      saving = true;
      status.classList.remove("is-error");
      status.textContent = "공개 도감에 반영하고 있습니다.";
      const controls = active.querySelectorAll("button,input");
      controls.forEach((node) => (node.disabled = true));
      const saved = await reviewRpc("catalog_monster_drops_save", { p_id: id, p_version: result.data.version, p_drops: payload });
      saving = false;
      if (!active.isConnected) return;
      if (saved.error) {
        controls.forEach((node) => (node.disabled = false));
        rows.forEach((row) => { if (row.removed) list.querySelector(`[data-row="${row.key}"] [data-rate]`)?.setAttribute("disabled", ""); });
        paintCount();
        status.textContent = reviewError(saved.error);
        status.classList.add("is-error");
        return;
      }
      clearCatalogCache();
      const summary = { kept: payload.filter((drop) => drop.id).length, added: payload.filter((drop) => !drop.id).length, removed: rows.filter((row) => row.removed).length };
      initial = []; rows = [];
      active.close();
      if (root.isConnected) await onSaved(saved.data, summary);
    });
  });
}
