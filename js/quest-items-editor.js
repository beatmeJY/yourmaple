// 퀘스트 조건·보상 수정창(도감 관리자 전용, sql/079). 드랍 수정창(monster-drops-editor.js)과 같은 흐름:
// 아이템·몬스터를 찾아 넣기 → 개수 고치기·빼기, 보상은 "그중 하나"·"맞는 직업만" 표시 → 저장하면 공개 퀘스트 정보에 바로 반영.
import { escapeHtml } from "./format.js";
import { reviewRpc, reviewError } from "./catalog-review.js";
import { catalogRpc, clearCatalogCache } from "./catalog-api.js";
import { catalogImage, catalogMonsterImage, mountCatalogImageFallback } from "./catalog-image.js";
import { questEditRows, questItemsPayload, questItemsChanged, questRewardMethod } from "./quest-items-edit.js";

const esc = (value) => escapeHtml(String(value ?? ""));
const API = "https://maplestory.io/api";
const safeVersion = (v) => /^[a-z]{3}\/\d{1,4}$/.test(String(v ?? "").toLowerCase()) ? String(v).toLowerCase() : "gms/83";
const missingSql = (error) => /Could not find the function|schema cache|does not exist/i.test(error?.message || "");
let seq = 0;

function art(row) {
  if (row.m) return catalogMonsterImage({ source_id: row.m, name: row.n ?? "", image_url: row.image_url || `${API}/${safeVersion(row.v)}/mob/${encodeURIComponent(row.m)}/render/stand` }, 32);
  return catalogImage(row.image_url || `${API}/${safeVersion(row.v)}/item/${encodeURIComponent(row.i)}/icon`, "mde-img", 32);
}

function rowHtml(row) {
  const name = row.n ?? (row.m ? `몬스터 ${row.m}` : `아이템 ${row.i}`);
  const kind = row.m ? "몬스터" : "아이템";
  return `<li class="mde-row qie-row${row.fresh ? " is-new" : ""}" data-row="${row.key}">
    <span class="mde-art">${art(row) || "<span aria-hidden=\"true\">?</span>"}</span>
    <span class="mde-name qie-name"><b>${esc(name)}</b><small>${kind} #${esc(row.m ?? row.i)}</small>${row.fresh ? '<em class="mde-tag">새로</em>' : ""}
      ${row.kind === "r" ? `<span class="qie-flags"><label class="qie-flag"><input type="checkbox" data-flag="r"${row.r ? " checked" : ""}><span>그중 하나</span></label><label class="qie-flag"><input type="checkbox" data-flag="j"${row.j ? " checked" : ""}><span>맞는 직업만</span></label></span>` : ""}</span>
    <label class="mde-rate qie-count"><i aria-hidden="true">×</i><span class="sr-only">${esc(name)} ${row.kind === "c" && row.m ? "마릿수" : "개수"}</span><input data-qty inputmode="numeric" autocomplete="off" value="${esc(row.count)}"></label>
    <button type="button" class="mo-ghost mde-toggle" data-remove-row aria-label="${esc(name)} 빼기">빼기</button>
  </li>`;
}

export function openQuestItemsEditor(root, quest, conditions, rewards, onSaved) {
  const dialog = document.createElement("dialog");
  dialog.className = "catalog-edit-dialog mde-dialog qie-dialog ym-glass";
  dialog.setAttribute("aria-labelledby", "qie-title");
  let rows = questEditRows(conditions, rewards, quest.reward_method).map((row) => ({ ...row, key: ++seq }));
  const initial = questItemsPayload(rows);
  const initialPick = quest.reward_method === "select" ? "select" : "random";
  let pick = initialPick, saving = false;
  const search = { c: { kind: "item", id: 0, timer: 0, found: [] }, r: { kind: "item", id: 0, timer: 0, found: [] } };
  const section = (kind, title, hint) => `<section class="qie-section" data-section="${kind}">
      <h3>${title} <span class="mde-count" data-count="${kind}"></span></h3>
      <div class="qie-find">${kind === "c" ? `<div class="qie-kind" role="group" aria-label="찾을 종류"><button type="button" class="catalog-filter-chip is-on" data-find-kind="item" aria-pressed="true">아이템 모으기</button><button type="button" class="catalog-filter-chip" data-find-kind="monster" aria-pressed="false">몬스터 물리치기</button></div>` : ""}
        <div class="mde-search"><span class="ym-search-icon" aria-hidden="true"></span><input type="search" data-search="${kind}" autocomplete="off" placeholder="${kind === "c" ? "아이템 이름·번호로 찾기" : "보상 아이템 이름·번호로 찾기"}" aria-label="${title}에 넣을 것 찾기"></div>
        <ul class="mde-results" data-results="${kind}" hidden></ul></div>
      <p class="hint">${hint}</p>
      <ul class="mde-list" data-list="${kind}"></ul>
    </section>`;
  dialog.innerHTML = `<header><h2 id="qie-title">조건·보상 수정 <small>${esc(quest.name)}</small></h2><button type="button" class="mo-ghost" data-close-edit aria-label="조건·보상 수정창 닫기">닫기</button></header>
    <form data-qie-form novalidate>
      ${section("c", "완료 조건", "모아야 할 아이템, 물리쳐야 할 몬스터와 개수예요.")}
      ${section("r", "보상 아이템", "\"그중 하나\"를 표시한 보상은 그중 하나만 받아요. 표시하지 않은 보상은 늘 받아요.")}
      <fieldset class="qie-pick" data-pick-box><legend>그중 하나는 어떻게 받나요?</legend>
        <label><input type="radio" name="pick" value="random"${pick === "random" ? " checked" : ""}> 무작위로 하나</label>
        <label><input type="radio" name="pick" value="select"${pick === "select" ? " checked" : ""}> 골라서 하나</label></fieldset>
      <p class="hint">저장하면 공개 퀘스트 정보에 바로 반영되고 변경 이력에 남아요. 고친 퀘스트는 수집 자료를 다시 등록해도 조건·보상이 그대로 남아요.</p>
      <p data-edit-status role="status"></p>
      <div data-close-warning hidden><p>저장하지 않은 변경을 버리고 닫을까요?</p><button type="button" class="mo-ghost" data-discard-edit>변경을 버리고 닫기</button></div>
      <footer><button type="button" class="mo-ghost" data-close-edit>취소</button><button type="submit" class="primary-button" data-save-items>저장 · 공개 반영</button></footer>
    </form>`;
  root.append(dialog);
  mountCatalogImageFallback(dialog);
  for (const type of ["click", "input", "change", "submit", "keydown"]) dialog.addEventListener(type, (event) => event.stopPropagation());
  const status = dialog.querySelector("[data-edit-status]");
  const opener = document.activeElement;
  const dirty = () => questItemsChanged(initial, rows, initialPick, pick);
  const hideWarning = () => { dialog.querySelector("[data-close-warning]").hidden = true; };
  const close = () => {
    if (saving) return;
    if (dirty()) { const warning = dialog.querySelector("[data-close-warning]"); warning.hidden = false; warning.querySelector("button").focus(); return; }
    dialog.close();
  };
  dialog.addEventListener("close", () => { dialog.remove(); if (opener?.isConnected) opener.focus({ preventScroll: true }); }, { once: true });
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });

  const paintState = () => {
    for (const kind of ["c", "r"]) dialog.querySelector(`[data-count="${kind}"]`).textContent = `${rows.filter((row) => row.kind === kind).length}개`;
    dialog.querySelector("[data-pick-box]").hidden = !rows.some((row) => row.kind === "r" && row.r);
    dialog.querySelector("[data-save-items]").disabled = saving || !dirty();
  };
  const paint = (kind) => {
    const list = dialog.querySelector(`[data-list="${kind}"]`), mine = rows.filter((row) => row.kind === kind);
    list.innerHTML = mine.length ? mine.map(rowHtml).join("") : `<li class="mde-empty">${kind === "c" ? "완료 조건이 없어요(NPC와 대화만 하면 끝나는 퀘스트)." : "보상 아이템이 없어요."}</li>`;
    paintState();
  };
  paint("c");
  paint("r");
  const rowOf = (node) => rows.find((row) => String(row.key) === node.closest("[data-row]")?.dataset.row);

  async function runSearch(kind) {
    const box = search[kind], input = dialog.querySelector(`[data-search="${kind}"]`), results = dialog.querySelector(`[data-results="${kind}"]`);
    const query = input.value.trim(), mine = ++box.id;
    if (!query) { results.hidden = true; results.innerHTML = ""; box.found = []; return; }
    results.hidden = false;
    results.innerHTML = '<li class="mde-muted">찾는 중…</li>';
    const monster = kind === "c" && box.kind === "monster";
    const response = monster ? await catalogRpc("catalog_search_monsters", { p_query: query, p_page: 0 }) : await catalogRpc("catalog_search_items", { p_query: query, p_page: 0 });
    if (mine !== box.id || !dialog.isConnected) return;
    if (response.error) { results.innerHTML = `<li class="mde-muted">${esc(reviewError(response.error))}</li>`; return; }
    // 퀘스트는 게임 번호로 잇기 때문에 번호가 있는 것만 넣을 수 있다.
    const all = response.data?.rows ?? [];
    box.found = all.filter((x) => /^\d+$/.test(String(x.source_id ?? ""))).slice(0, 8).map((x) => ({ ...x, monster }));
    results.innerHTML = box.found.length
      ? box.found.map((x, index) => `<li><button type="button" class="mde-pick" data-pick="${kind}:${index}"><i class="mde-pick-art">${monster ? catalogMonsterImage(x, 28) : catalogImage(x.image_url, "mde-img", 28)}</i><span>${esc(x.name)}${monster && x.level != null ? ` · Lv.${esc(x.level)}` : ""}</span><small>#${esc(x.source_id)}</small><b aria-hidden="true">＋</b></button></li>`).join("")
      : `<li class="mde-muted">${all.length ? "찾은 것에 게임 번호가 없어 넣을 수 없어요." : "찾는 것이 없습니다."}</li>`;
  }

  dialog.addEventListener("input", (event) => {
    const input = event.target.closest("[data-search]");
    if (input) { const box = search[input.dataset.search]; clearTimeout(box.timer); box.timer = setTimeout(() => runSearch(input.dataset.search), 220); return; }
    const count = event.target.closest("[data-qty]");
    if (count) { const row = rowOf(count); if (row) row.count = count.value; count.closest("[data-row]").classList.remove("is-invalid"); hideWarning(); paintState(); }
  });
  dialog.addEventListener("change", (event) => {
    const flag = event.target.closest("[data-flag]");
    if (flag) { const row = rowOf(flag); if (row) row[flag.dataset.flag] = flag.checked; hideWarning(); paintState(); return; }
    if (event.target.name === "pick") { pick = event.target.value; hideWarning(); paintState(); }
  });
  dialog.addEventListener("keydown", (event) => {
    const input = event.target.closest("[data-search]");
    if (!input) return;
    const kind = input.dataset.search, results = dialog.querySelector(`[data-results="${kind}"]`);
    if (event.key === "Enter") { event.preventDefault(); clearTimeout(search[kind].timer); void runSearch(kind).then(() => results.querySelector("[data-pick]")?.focus()); }
    else if (event.key === "ArrowDown") { event.preventDefault(); results.querySelector("[data-pick]")?.focus(); }
  });
  dialog.addEventListener("click", (event) => {
    if (event.target.closest("[data-discard-edit]")) { rows = []; dialog.close(); return; }
    if (event.target.closest("[data-close-edit]")) { close(); return; }
    const kindButton = event.target.closest("[data-find-kind]");
    if (kindButton) {
      search.c.kind = kindButton.dataset.findKind;
      dialog.querySelectorAll("[data-find-kind]").forEach((b) => { const on = b === kindButton; b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", String(on)); });
      const input = dialog.querySelector('[data-search="c"]');
      input.placeholder = search.c.kind === "monster" ? "몬스터 이름·번호로 찾기" : "아이템 이름·번호로 찾기";
      void runSearch("c");
      input.focus();
      return;
    }
    const pickButton = event.target.closest("[data-pick]");
    if (pickButton) {
      const [kind, index] = pickButton.dataset.pick.split(":");
      const x = search[kind].found[Number(index)];
      if (!x) return;
      const key = x.monster ? `m${x.source_id}` : `i${x.source_id}`;
      const existing = rows.find((row) => row.kind === kind && (row.m ? `m${row.m}` : `i${row.i}`) === key);
      if (existing) {
        status.textContent = `${x.name}은(는) 이미 들어 있어요. 개수를 고쳐 주세요.`;
        dialog.querySelector(`[data-row="${existing.key}"] [data-qty]`)?.focus();
        return;
      }
      const row = { key: ++seq, kind, i: x.monster ? null : String(x.source_id), m: x.monster ? String(x.source_id) : null, count: "1", n: x.name, v: null,
        r: false, j: false, image_url: x.image_url ?? null, linked: true, fresh: true };
      rows.push(row);
      paint(kind);
      hideWarning();
      const added = dialog.querySelector(`[data-row="${row.key}"]`);
      added?.classList.add("is-flash");
      added?.querySelector("[data-qty]")?.focus();
      added?.querySelector("[data-qty]")?.select();
      status.classList.remove("is-error");
      status.textContent = `${x.name}을(를) ${kind === "c" ? "완료 조건" : "보상"}에 넣었어요.`;
      return;
    }
    const remove = event.target.closest("[data-remove-row]");
    if (remove) {
      const row = rowOf(remove);
      if (!row) return;
      rows = rows.filter((entry) => entry !== row);
      paint(row.kind);
      hideWarning();
      status.classList.remove("is-error");
      status.textContent = `${row.n ?? "항목"}을(를) 뺐어요.`;
      dialog.querySelector(`[data-search="${row.kind}"]`).focus();
    }
  });

  dialog.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving) return;
    let payload;
    try { payload = questItemsPayload(rows); }
    catch (error) {
      status.textContent = error.message;
      status.classList.add("is-error");
      const bad = rows.find((row) => { try { questItemsPayload([row]); return false; } catch { return true; } });
      const node = bad && dialog.querySelector(`[data-row="${bad.key}"]`);
      node?.classList.add("is-invalid");
      node?.querySelector("[data-qty]")?.focus();
      return;
    }
    if (!dirty()) { dialog.close(); return; }
    saving = true;
    status.classList.remove("is-error");
    status.textContent = "공개 퀘스트 정보에 반영하고 있습니다.";
    const controls = dialog.querySelectorAll("button,input");
    controls.forEach((node) => (node.disabled = true));
    const saved = await reviewRpc("catalog_quest_items_save", { p_id: quest.id, p_version: quest.version, p_conditions: payload.conditions, p_rewards: payload.rewards, p_pick: pick });
    saving = false;
    if (!dialog.isConnected) return;
    if (saved.error) {
      controls.forEach((node) => (node.disabled = false));
      paintState();
      status.textContent = missingSql(saved.error) ? "조건·보상 수정을 쓰려면 sql/079를 먼저 실행해 주세요."
        : saved.error.code === "40001" ? "다른 곳에서 먼저 고쳤어요. 닫고 새로 확인한 뒤 다시 고쳐 주세요." : reviewError(saved.error);
      status.classList.add("is-error");
      return;
    }
    clearCatalogCache();
    const method = questRewardMethod(payload.rewards, pick);
    rows = [];
    dialog.close();
    if (root.isConnected) onSaved({ conditions: payload.conditions.length, rewards: payload.rewards.length, method });
  });
  dialog.showModal();
  dialog.querySelector('[data-search="c"]').focus();
}
