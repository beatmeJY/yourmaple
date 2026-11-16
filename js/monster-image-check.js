// 몬스터 그림 점검 창(도감 관리자 전용, sql/070, 2026-11-16 사용자 요청).
// 1) 전체 점검: 모든 몬스터 그림을 실제로 불러 보고, 안 뜨거나 주소가 없는 몬스터만 모아 보여 준다.
// 2) 한 몬스터 확인: 원본 그림 API를 바로 조회해 "원본에 없음 / 주소의 동작이 틀림 / 잠깐 실패"를 가린다.
//    원본 API에 그림이 있으면 그 주소로 고치는 것이 먼저, 없을 때만 다른 몬스터 그림을 대신 이어 둔다.
import { escapeHtml } from "./format.js";
import { reviewRpc, reviewError } from "./catalog-review.js";
import { clearCatalogCache } from "./catalog-api.js";
import { isBlankImage, monsterImageUrls } from "./catalog-image.js";
import { apiInfoUrl, apiParts, apiRenderUrl, diagnose, imageCandidates } from "./monster-image-audit.js";

const esc = (value) => escapeHtml(String(value ?? ""));
const missingSql = (error) => /Could not find the function|schema cache|does not exist/i.test(error?.message || "");

function safeUrl(url) {
  try { const parsed = new URL(url); return parsed.protocol === "https:" ? parsed.href : ""; } catch { return ""; }
}

// 미리보기도 도감 화면과 같이 원본 그림 API 동작 순서(move → fly → stand → die1)대로 시도한다.
function preview(url, label, chain = true) {
  const urls = chain ? monsterImageUrls(url) : [safeUrl(url)].filter(Boolean);
  if (!urls.length) return `<span class="mic-thumb is-empty" title="${esc(label)}">없음</span>`;
  return `<span class="mic-thumb"><img src="${esc(urls[0])}" data-alts="${esc(urls.slice(1).join(" "))}" alt="${esc(label)}" referrerpolicy="no-referrer" loading="lazy" data-mic-img></span>`;
}

// 동작 순서대로 하나라도 뜨면 성공
async function probeChain(url) {
  for (const href of monsterImageUrls(url)) if (await probe(href)) return true;
  return false;
}

// 그림 한 장을 실제로 불러 본다(10초 넘으면 실패).
function probe(url) {
  return new Promise((resolve) => {
    const href = safeUrl(url);
    if (!href) return resolve(false);
    const image = new Image();
    image.referrerPolicy = "no-referrer";
    const timer = setTimeout(() => { image.src = ""; resolve(false); }, 10_000);
    image.onload = () => { clearTimeout(timer); resolve(image.naturalWidth > 0 && !isBlankImage(image)); };
    image.onerror = () => { clearTimeout(timer); resolve(false); };
    image.src = href;
  });
}

async function fetchApi(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { signal: controller.signal, referrerPolicy: "no-referrer" });
    const info = response.ok ? await response.json().catch(() => null) : null;
    return { status: response.status, info };
  } catch { return { status: 0, info: null }; }
  finally { clearTimeout(timer); }
}

export function openMonsterImageCheck(root, { focusId = "", onChanged = () => {} } = {}) {
  const dialog = document.createElement("dialog");
  dialog.className = "catalog-edit-dialog mic-dialog ym-glass";
  dialog.setAttribute("aria-labelledby", "mic-title");
  dialog.innerHTML = `<header><h2 id="mic-title">몬스터 그림 점검</h2><button type="button" class="mo-ghost" data-mic-close aria-label="그림 점검 닫기">닫기</button></header>
    <div class="mic-body" data-mic-body><p class="hint">몬스터 목록을 불러오는 중입니다.</p></div>`;
  root.append(dialog);
  // 몬스터 화면의 검색·필터 처리기가 이 창의 입력을 받지 않게 막는다.
  for (const type of ["click", "input", "change", "submit", "keydown"]) dialog.addEventListener(type, (event) => event.stopPropagation());
  const opener = document.activeElement;
  dialog.showModal();
  let closed = false;
  dialog.addEventListener("close", () => { closed = true; dialog.remove(); if (opener?.isConnected) opener.focus({ preventScroll: true }); }, { once: true });

  const body = dialog.querySelector("[data-mic-body]");
  let rows = [];
  const loaded = new Map(); // 그림 주소 → 불러오기 성공 여부
  let scan = null; // { done, total }
  let current = ""; // 지금 보고 있는 몬스터 id
  let apiResult = null; // 지금 몬스터의 원본 API 조회 결과
  let busy = false;

  const rowOf = (id) => rows.find((row) => row.id === id);
  const working = () => new Set(rows.filter((row) => row.image_url && loaded.get(row.image_url) !== false).map((row) => row.id));
  const problem = (row) => !row.image_url || loaded.get(row.image_url) === false;

  function paintList() {
    if (!scan) {
      body.innerHTML = `<p class="hint">모든 몬스터 그림을 실제로 불러 보고, 안 뜨는 몬스터만 모아 보여 줘요.</p>
        <button type="button" class="primary-button" data-mic-scan>전체 점검 시작 (${rows.length}마리)</button>`;
      return;
    }
    const bad = rows.filter(problem);
    const none = bad.filter((row) => !row.image_url).length;
    const linked = bad.filter((row) => row.image_link_monster_id).length;
    const progress = scan.done < scan.total ? `<div class="mic-progress"><span>그림 불러 보는 중 ${scan.done}/${scan.total}</span><i style="--w:${Math.round((scan.done / Math.max(1, scan.total)) * 100)}%"></i></div>` : "";
    const list = bad.map((row) => `<button type="button" class="mic-row" data-mic-open="${esc(row.id)}">
        ${preview(row.image_fallback_url || row.image_url, row.image_fallback_url ? "대체 그림" : "원본 그림")}
        <span class="mic-row-copy"><strong>${esc(row.name)}</strong><small>Lv.${esc(row.level ?? "-")} · 번호 ${esc(row.source_id ?? "-")}</small></span>
        <span class="mic-tags">${row.image_url ? '<span class="mic-tag is-bad">원본 안 뜸</span>' : '<span class="mic-tag is-bad">주소 없음</span>'}${row.image_link_monster_id ? `<span class="mic-tag is-link">대체: ${esc(row.image_link_name)}</span>` : ""}</span>
      </button>`).join("");
    body.innerHTML = `${progress}
      <p class="mic-summary">전체 ${rows.length}마리 · 그림 안 뜸 <b>${bad.length - none}</b> · 주소 없음 <b>${none}</b> · 대체 그림 연결 <b>${linked}</b></p>
      ${bad.length ? `<div class="mic-list">${list}</div>` : scan.done < scan.total ? "" : '<p class="hint">모든 몬스터 그림이 잘 떠요.</p>'}
      ${scan.done < scan.total ? "" : '<button type="button" class="mo-ghost" data-mic-scan>다시 점검</button>'}`;
  }

  async function runScan() {
    const urls = [...new Set(rows.map((row) => row.image_url).filter(Boolean))];
    scan = { done: 0, total: urls.length };
    paintList();
    let next = 0;
    const worker = async () => {
      while (next < urls.length && !closed) {
        const url = urls[next++];
        loaded.set(url, await probeChain(url));
        scan.done++;
        if (!current && (scan.done % 12 === 0 || scan.done === scan.total)) paintList();
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    if (!closed && !current) paintList();
  }

  function apiHtml(row) {
    if (!apiResult || apiResult.id !== row.id) return '<p class="hint">원본 그림 API를 조회해 그림이 정말 없는지, 저장된 주소가 틀렸는지 확인해요.</p>';
    if (apiResult.pending) return '<p class="hint">원본 API를 조회하고 있습니다.</p>';
    const { parts, result } = apiResult;
    const actions = (result.actions ?? []).map((name) => `<button type="button" class="mic-action${name === apiResult.pick ? " is-on" : ""}" data-mic-action="${esc(name)}" aria-pressed="${name === apiResult.pick}">${esc(name)}</button>`).join("");
    const pickUrl = apiResult.pick ? apiRenderUrl(parts, apiResult.pick) : "";
    const same = pickUrl && pickUrl === row.image_url;
    return `<p class="mic-verdict is-${esc(result.kind)}" role="status">${esc(result.text)}</p>
      ${actions ? `<div class="mic-actions" role="group" aria-label="원본 그림 동작">${actions}</div>` : ""}
      ${pickUrl ? `<div class="mic-pick">${preview(pickUrl, "원본 API 그림", false)}<div><code>${esc(pickUrl)}</code>
        ${same ? '<p class="hint">이미 이 주소를 쓰고 있어요.</p>' : '<button type="button" class="primary-button" data-mic-fix>이 주소로 고치기</button>'}</div></div>` : ""}`;
  }

  function linkHtml(row) {
    const pool = imageCandidates(row, rows, working(), 6);
    const query = dialog.querySelector("[data-mic-search]")?.value.trim() ?? "";
    const found = query ? rows.filter((other) => other.id !== row.id && other.image_url && other.name.includes(query)).slice(0, 8) : [];
    const card = (other) => `<div class="mic-cand">${preview(other.image_url, other.name)}<span><strong>${esc(other.name)}</strong><small>Lv.${esc(other.level ?? "-")}</small></span>
      ${other.id === row.image_link_monster_id ? '<span class="mic-tag is-link">연결됨</span>' : `<button type="button" class="mo-ghost" data-mic-link="${esc(other.id)}">대신 쓰기</button>`}</div>`;
    return `${row.image_link_monster_id ? `<div class="mic-cand is-current">${preview(row.image_fallback_url, row.image_link_name)}<span><strong>지금: ${esc(row.image_link_name)}</strong><small>원본이 안 뜰 때 이 그림을 보여 줘요</small></span><button type="button" class="mo-ghost" data-mic-unlink>연결 해제</button></div>` : ""}
      ${pool.length ? `<p class="mic-sub">이름이 비슷한 몬스터</p><div class="mic-cands">${pool.map(card).join("")}</div>` : '<p class="hint">이름이 비슷한 몬스터 중 그림이 뜨는 몬스터가 없어요. 아래에서 찾아 주세요.</p>'}
      <label class="mic-search"><span>다른 몬스터 찾기</span><input data-mic-search value="${esc(query)}" placeholder="몬스터 이름" autocomplete="off"></label>
      <div class="mic-cands" data-mic-found>${found.map(card).join("")}</div>`;
  }

  function paintPanel() {
    const row = rowOf(current);
    if (!row) { current = ""; paintList(); return; }
    const state = !row.image_url ? "그림 주소가 없어요" : loaded.get(row.image_url) === false ? "원본 그림이 안 떠요" : loaded.get(row.image_url) ? "원본 그림이 떠요" : "원본 그림";
    body.innerHTML = `<button type="button" class="mo-ghost mic-back" data-mic-back>← 점검 목록</button>
      <div class="mic-head">${preview(row.image_url, "원본 그림")}<div><strong>${esc(row.name)}</strong><small>Lv.${esc(row.level ?? "-")} · 번호 ${esc(row.source_id ?? "-")} · ${esc(state)}</small>
        ${row.image_url ? `<code>${esc(row.image_url)}</code>` : ""}</div></div>
      <section class="mic-sec"><h3>1. 원본 API로 확인 <small>먼저</small></h3>
        <button type="button" class="primary-button" data-mic-api>원본 API로 확인</button><div data-mic-api-out>${apiHtml(row)}</div></section>
      <section class="mic-sec"><h3>2. 다른 몬스터 그림 이어 두기 <small>원본에 없을 때</small></h3><div data-mic-link-box>${linkHtml(row)}</div></section>
      <p data-mic-status role="status" class="hint"></p>`;
    // 원본 그림이 뜨는지 모르면 한 번 불러 본다.
    if (row.image_url && !loaded.has(row.image_url)) void probeChain(row.image_url).then((ok) => { loaded.set(row.image_url, ok); if (!closed && current === row.id && !busy) paintPanel(); });
  }

  async function checkApi(row) {
    const parts = apiParts(row.image_url, row.source_id);
    if (!parts.id) { apiResult = { id: row.id, parts, result: { kind: "error", text: "몬스터 번호가 없어 원본 API를 조회할 수 없어요." } }; return paintPanel(); }
    apiResult = { id: row.id, pending: true };
    paintPanel();
    const { status, info } = await fetchApi(apiInfoUrl(parts));
    if (closed || current !== row.id) return;
    const result = diagnose(parts, status, info);
    apiResult = { id: row.id, parts, result, pick: result.action ?? null };
    paintPanel();
  }

  function setStatus(text, error = false) {
    const status = dialog.querySelector("[data-mic-status]");
    if (!status) return;
    status.textContent = text;
    status.classList.toggle("is-error", error);
  }

  async function save(rpc, args, apply, done) {
    if (busy) return;
    busy = true;
    dialog.querySelectorAll("[data-mic-body] button").forEach((node) => (node.disabled = true));
    setStatus("공개 도감에 반영하고 있습니다.");
    const result = await reviewRpc(rpc, args);
    busy = false;
    if (closed) return;
    if (result.error) {
      paintPanel();
      setStatus(missingSql(result.error) ? "그림 점검을 쓰려면 sql/070을 먼저 실행해 주세요." : reviewError(result.error), true);
      return;
    }
    apply(result.data ?? {});
    clearCatalogCache();
    paintPanel();
    setStatus(done);
    onChanged();
  }

  dialog.addEventListener("click", (event) => {
    const target = event.target;
    if (target.closest("[data-mic-close]")) return dialog.close();
    if (target.closest("[data-mic-scan]")) return void runScan();
    if (target.closest("[data-mic-back]")) { current = ""; apiResult = null; return paintList(); }
    const open = target.closest("[data-mic-open]");
    if (open) { current = open.dataset.micOpen; apiResult = null; paintPanel(); return void checkApi(rowOf(current)); }
    const row = rowOf(current);
    if (!row) return;
    if (target.closest("[data-mic-api]")) return void checkApi(row);
    const action = target.closest("[data-mic-action]");
    if (action && apiResult?.parts) { apiResult.pick = action.dataset.micAction; return paintPanel(); }
    if (target.closest("[data-mic-fix]") && apiResult?.pick) {
      const url = apiRenderUrl(apiResult.parts, apiResult.pick);
      return void save("catalog_monster_set_image", { p_id: row.id, p_expected: row.image_url ?? null, p_image_url: url }, () => {
        const old = row.image_url;
        row.image_url = url;
        loaded.set(url, true);
        for (const other of rows) if (other.image_link_monster_id === row.id) other.image_fallback_url = url;
        if (old && !rows.some((other) => other.image_url === old)) loaded.delete(old);
      }, "원본 API 주소로 고쳤어요. 공개 도감에 바로 반영됩니다.");
    }
    const link = target.closest("[data-mic-link]");
    if (link) {
      const other = rowOf(link.dataset.micLink);
      return void save("catalog_monster_set_image_link", { p_id: row.id, p_expected: row.image_link_monster_id ?? null, p_link: other.id }, () => {
        Object.assign(row, { image_link_monster_id: other.id, image_link_name: other.name, image_fallback_url: other.image_url });
      }, `${other.name} 그림을 이어 뒀어요. 원본 그림이 안 뜰 때 이 그림을 보여 줍니다.`);
    }
    if (target.closest("[data-mic-unlink]")) {
      return void save("catalog_monster_set_image_link", { p_id: row.id, p_expected: row.image_link_monster_id ?? null, p_link: null }, () => {
        Object.assign(row, { image_link_monster_id: null, image_link_name: null, image_fallback_url: null });
      }, "대체 그림 연결을 해제했어요.");
    }
  });
  dialog.addEventListener("input", (event) => {
    if (!event.target.matches("[data-mic-search]")) return;
    const row = rowOf(current);
    const box = dialog.querySelector("[data-mic-link-box]");
    if (!row || !box) return;
    const caret = event.target.selectionStart;
    box.innerHTML = linkHtml(row);
    const input = box.querySelector("[data-mic-search]");
    input.focus();
    input.setSelectionRange(caret, caret);
  });
  // 미리보기 그림이 안 뜨면 깨진 그림 대신 "안 뜸"으로 보여 준다.
  dialog.addEventListener("load", (event) => {
    if (event.target.matches?.("img[data-mic-img]") && isBlankImage(event.target)) event.target.dispatchEvent(new Event("error"));
  }, true);
  dialog.addEventListener("error", (event) => {
    if (!event.target.matches?.("img[data-mic-img]")) return;
    const alts = (event.target.dataset.alts || "").split(" ").filter(Boolean);
    if (alts.length) { event.target.dataset.alts = alts.slice(1).join(" "); event.target.src = alts[0]; return; }
    const box = event.target.parentElement;
    box.classList.add("is-broken");
    box.textContent = "안 뜸";
  }, true);

  void reviewRpc("catalog_monster_image_audit").then((result) => {
    if (closed) return;
    if (result.error || !Array.isArray(result.data)) {
      body.innerHTML = `<p class="hint" role="alert">${esc(missingSql(result.error) ? "그림 점검을 쓰려면 sql/070을 먼저 실행해 주세요." : result.error ? reviewError(result.error) : "몬스터 목록을 불러오지 못했습니다.")}</p>`;
      return;
    }
    rows = result.data;
    if (focusId && rowOf(focusId)) {
      current = focusId;
      paintPanel();
      void checkApi(rowOf(focusId));
    } else paintList();
  });
}
