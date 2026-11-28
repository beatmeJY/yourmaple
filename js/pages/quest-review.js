// 퀘스트 검토함(도감 관리자 전용, sql/081, 2026-11-24 사용자 요청 "문제들을 내가 확인하고 반영할 수 있는 것").
// ① 경험치·메소가 게임 원본(v83)과 다른 퀘스트: 지금 값 / 원본 값 / 직접 적은 값 중 하나를 골라 반영하거나 건너뛴다.
// ② 수집 자료에 없는 원본 퀘스트: 한국어 이름을 적어 퀘스트로 추가하거나 "메이플랜드에 없음"으로 넘긴다.
// 추천 표시는 경험치가 더 작은 쪽(사용자가 알려 준 메이플랜드 값 6개 중 5개가 작은 쪽이었음, 추정). 정하는 건 늘 관리자.
import { reviewRpc, canReviewCatalog, reviewError } from "../catalog-review.js";
import { clearCatalogCache } from "../catalog-api.js";
import { catalogImage, mountCatalogImageFallback } from "../catalog-image.js";
import { escapeHtml, formatCount } from "../format.js";
import { notify } from "../toast.js";
import { sfx } from "../effects.js";

const API = "https://maplestory.io/api";
const PAGE = 30;
const esc = (value) => escapeHtml(String(value ?? ""));
const missingSql = (error) => /Could not find the function|schema cache|does not exist/i.test(error?.message || "");
const num = (value) => value == null ? "-" : formatCount(value);
const STATUS = { open: "안 본 것", applied: "반영함", skipped: "건너뜀", all: "전체" };
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function icon(kind, id, size = 30) {
  const sid = encodeURIComponent(String(id));
  const urls = ["gms/83", "kms/284"].map((v) => `${API}/${v}/${kind}/${sid}/icon`);
  return catalogImage(urls[0], "qr-icon", size).replace("<img data-catalog-image", `<img data-catalog-image data-alts="${urls[1]}"`);
}
// 아이템·몬스터 한 줄 칩: 그림 · 이름 · 개수(그중 하나·맞는 직업 표시)
function chips(list, empty = "없음") {
  if (!list?.length) return `<span class="qr-none">${esc(empty)}</span>`;
  return list.map((x) => {
    const mob = x.m != null;
    const name = x.n ?? `${mob ? "몬스터" : "아이템"} ${x.m ?? x.i}`;
    const flags = [x.r ? "그중 하나" : "", x.j ? "맞는 직업만" : ""].filter(Boolean).join(" · ");
    return `<span class="qr-chip${mob ? " is-mob" : ""}" title="${esc(name)}${flags ? ` (${esc(flags)})` : ""}">${icon(mob ? "mob" : "item", x.m ?? x.i, 26)}<b>${esc(name)}</b><small>×${esc(formatCount(x.c ?? 1))}</small>${flags ? `<i>${esc(flags)}</i>` : ""}</span>`;
  }).join("");
}
const levelBadge = (lv) => `<span class="ym-badge">${lv == null ? "레벨 제한 없음" : `Lv.${esc(formatCount(lv))}`}</span>`;
const statusBadge = (row) => row.status === "applied" ? `<span class="ym-badge is-gain">반영함</span>` : row.status === "skipped" ? `<span class="ym-badge">${row.kind === "missing" ? "메이플랜드에 없음" : "건너뜀"}</span>` : "";

function expOption(key, label, exp, meso, picked, recommended) {
  return `<button type="button" class="qr-option${picked ? " is-picked" : ""}" data-pick="${key}" aria-pressed="${picked}">
    <span class="qr-option-head">${esc(label)}${recommended ? `<span class="ym-badge is-gold">추천</span>` : ""}</span>
    <span class="qr-option-exp"><small>EXP</small>${esc(num(exp))}</span><span class="qr-option-meso"><small>메소</small>${esc(num(meso))}</span></button>`;
}

function expCard(row, index, pick) {
  const d = row.data, q = row.quest;
  const ours = { exp: q?.reward_exp ?? d.ours?.exp ?? null, meso: q?.reward_meso ?? d.ours?.meso ?? null };
  const open = row.status === "open";
  const blocked = !q ? "이 퀘스트가 아직 등록되지 않았어요(quests.sql 먼저)." : q.deleted ? "삭제한 퀘스트예요." : "";
  const chosen = pick ?? (d.recommend === "v83" ? "v83" : "ours");
  const same = q && ours.exp === d.v83?.exp && ours.meso === d.v83?.meso;
  const done = row.decided ? `<p class="qr-decided">반영한 값 · EXP ${esc(num(row.decided.exp))} · 메소 ${esc(num(row.decided.meso))}</p>` : "";
  return `<article class="qr-card ym-glass${open ? "" : " is-done"}" style="--i:${Math.min(index, 14)}" data-review="${esc(row.id)}">
    <header class="qr-card-head"><div class="qr-title"><strong>${esc(q?.name ?? d.name)}</strong>${levelBadge(q?.min_level ?? d.min_level)}${statusBadge(row)}</div>
      <p class="qr-meta">퀘스트 번호 ${esc(row.source_id)} · ${esc(q?.region ?? d.region ?? "지역 없음")}${d.start_npc ? ` · ${esc(d.start_npc)}` : ""}${q ? ` · <a href="/quests/${encodeURIComponent(row.source_id)}/">퀘스트 보기</a>` : ""}</p></header>
    ${open && !blocked ? `<div class="qr-options" role="group" aria-label="반영할 값">
      ${expOption("ours", "지금 자료", ours.exp, ours.meso, chosen === "ours", d.recommend === "ours")}
      ${expOption("v83", "게임 원본 v83", d.v83?.exp, d.v83?.meso, chosen === "v83", d.recommend === "v83")}
      <div class="qr-option is-custom${chosen === "custom" ? " is-picked" : ""}" data-custom>
        <button type="button" class="qr-option-head" data-pick="custom" aria-pressed="${chosen === "custom"}">직접 입력</button>
        <label><small>EXP</small><input inputmode="numeric" data-custom-exp value="${esc(ours.exp ?? "")}" aria-label="경험치 직접 입력" /></label>
        <label><small>메소</small><input inputmode="numeric" data-custom-meso value="${esc(ours.meso ?? "")}" aria-label="메소 직접 입력" /></label>
      </div></div>` : blocked ? `<p class="qr-blocked">${esc(blocked)}</p>` : done}
    ${same && open ? `<p class="qr-hint">지금 값이 이미 원본과 같아요. 건너뛰어도 돼요.</p>` : ""}
    <details class="qr-more"><summary>보상 아이템 비교</summary>
      <dl><dt>지금 자료</dt><dd>${chips(d.ours_items)}</dd><dt>원본 v83</dt><dd>${chips(d.v83_items, "원본에 완료 보상 아이템 없음")}</dd>
      ${d.v83_start_items?.length ? `<dt>원본이 시작할 때 주는 것</dt><dd>${chips(d.v83_start_items)}</dd>` : ""}</dl>
      <p class="qr-hint">아이템은 이 화면에서 바꾸지 않아요. 다르면 퀘스트 상세의 "조건·보상 수정"으로 고쳐 주세요.</p></details>
    <footer class="qr-actions">${open ? (blocked ? `<button type="button" class="mo-ghost" data-decide="skipped">건너뛰기</button>`
      : `<button type="button" class="mo-ghost" data-decide="skipped">건너뛰기</button><button type="button" class="primary-button" data-decide="applied">이 값으로 반영</button>`)
      : row.status === "skipped" ? `<button type="button" class="mo-ghost" data-decide="open">다시 검토</button>` : ""}</footer>
  </article>`;
}

function missingCard(row, index) {
  const d = row.data, quest = d.quest ?? {};
  const open = row.status === "open";
  const npc = quest.start_npc;
  const done = row.decided ? `<p class="qr-decided">“${esc(row.decided.name)}”(으)로 추가함 · <a href="/quests/${encodeURIComponent(row.source_id)}/">퀘스트 보기</a></p>` : "";
  return `<article class="qr-card ym-glass${open ? "" : " is-done"}" style="--i:${Math.min(index, 14)}" data-review="${esc(row.id)}">
    <header class="qr-card-head qr-missing-head"><span class="qr-npc">${npc?.id ? icon("npc", npc.id, 52) : `<b>?</b>`}</span>
      <div><div class="qr-title"><strong>${esc(d.name_ko || d.name_en || `퀘스트 ${row.source_id}`)}</strong>${levelBadge(d.min_level)}${statusBadge(row)}</div>
      <p class="qr-meta">퀘스트 번호 ${esc(row.source_id)}${d.name_en ? ` · 원본 이름 ${esc(d.name_en)}` : ""}</p>
      <p class="qr-meta">${esc(d.region ?? "지역 모름")}${npc?.n ? ` · 시작 ${esc(npc.n)}` : npc?.id ? ` · 시작 NPC ${esc(npc.id)}` : ""}${quest.end_npc?.n && quest.end_npc.id !== npc?.id ? ` · 완료 ${esc(quest.end_npc.n)}` : ""}${quest.prerequisites?.length ? ` · 선행 ${quest.prerequisites.map((p) => `<a href="/quests/${encodeURIComponent(p)}/">${esc(p)}</a>`).join(", ")}` : ""}</p></div></header>
    <dl class="qr-facts"><dt>완료 조건</dt><dd>${chips(quest.conditions, "원본에 조건 없음(대화)")}</dd>
      <dt>보상</dt><dd><span class="qr-chip is-stat"><b>EXP</b>${esc(num(d.exp))}</span>${d.meso != null ? `<span class="qr-chip is-stat"><b>메소</b>${esc(num(d.meso))}</span>` : ""}${chips(quest.reward_items, "")}</dd>
      ${d.start_items?.length ? `<dt>시작할 때 받음</dt><dd>${chips(d.start_items)}</dd>` : ""}</dl>
    ${open ? `<div class="qr-add">
      <label class="field qr-name"><span>한국어 이름${d.name_ko ? ` <small>(한국판 원본 이름)</small>` : ""}</span><input data-add-name maxlength="200" value="${esc(d.name_ko ?? "")}" placeholder="메이플랜드에서 보이는 이름" /></label>
      <label class="field"><span>EXP</span><input inputmode="numeric" data-add-exp value="${esc(d.exp ?? "")}" /></label>
      <label class="field"><span>메소</span><input inputmode="numeric" data-add-meso value="${esc(d.meso ?? "")}" /></label></div>` : done}
    <footer class="qr-actions">${open ? `<button type="button" class="mo-ghost" data-decide="skipped">메이플랜드에 없음</button><button type="button" class="primary-button" data-decide="applied">퀘스트로 추가</button>`
      : row.status === "skipped" ? `<button type="button" class="mo-ghost" data-decide="open">다시 검토</button>` : ""}</footer>
  </article>`;
}

export async function render(root) {
  mountCatalogImageFallback(root);
  root.innerHTML = `<section class="qr-page"><p class="hint">권한을 확인하는 중입니다.</p></section>`;
  if (!await canReviewCatalog()) {
    if (!root.isConnected) return;
    root.innerHTML = `<section class="qr-page"><header class="ym-page-head"><div><h1>퀘스트 검토함</h1><p>도감 관리자만 볼 수 있어요.</p></div></header>
      <a class="mo-ghost" href="/quests/">퀘스트 정보로</a></section>`;
    return;
  }
  const params = new URLSearchParams(location.search);
  let kind = params.get("kind") === "missing" ? "missing" : "exp";
  let status = STATUS[params.get("status")] ? params.get("status") : "open";
  let query = "", shown = PAGE, loadId = 0;
  const data = { exp: null, missing: null };
  const picks = new Map();

  root.innerHTML = `<section class="qr-page">
    <header class="ym-page-head"><div><h1>퀘스트 검토함</h1><p>게임 원본(v83)과 다른 값, 수집 자료에 없는 퀘스트를 하나씩 확인하고 반영해요. 메이플랜드에서 본 값과 맞는 쪽을 골라 주세요.</p></div>
      <div><span class="ym-badge">관리자 전용</span><a class="mo-ghost" href="/quests/">퀘스트 정보로</a></div></header>
    <div class="qr-tabs" role="tablist">
      <button type="button" role="tab" class="qr-tab" data-kind="exp"><b>경험치·메소</b><small data-tab-count="exp">-</small></button>
      <button type="button" role="tab" class="qr-tab" data-kind="missing"><b>빠진 퀘스트</b><small data-tab-count="missing">-</small></button>
    </div>
    <div class="qr-progress" data-progress></div>
    <div class="qr-bar">
      <div class="qr-status" role="group" aria-label="보기">${Object.entries(STATUS).map(([key, label]) => `<button type="button" class="ym-chip" data-status="${key}">${label}</button>`).join("")}</div>
      <label class="field"><span>찾기</span><input data-search placeholder="이름·퀘스트 번호·지역" autocomplete="off" /></label>
    </div>
    <p class="qr-tip" data-tip></p>
    <div class="qr-list" data-list aria-live="polite"><p class="hint">불러오는 중입니다.</p></div>
  </section>`;

  const syncUrl = () => {
    const next = new URLSearchParams(location.search);
    next.set("kind", kind);
    status === "open" ? next.delete("status") : next.set("status", status);
    history.replaceState(history.state, "", `${location.pathname}?${next}`);
  };
  const matches = (row) => {
    if (status !== "all" && row.status !== status) return false;
    if (!query) return true;
    const d = row.data;
    return [row.source_id, row.quest?.name, d.name, d.name_ko, d.name_en, d.region, row.quest?.region].some((v) => v != null && String(v).toLowerCase().includes(query));
  };

  function paint() {
    const list = root.querySelector("[data-list]");
    for (const tab of root.querySelectorAll("[data-kind]")) {
      const on = tab.dataset.kind === kind;
      tab.classList.toggle("is-on", on);
      tab.setAttribute("aria-selected", String(on));
    }
    for (const chip of root.querySelectorAll("[data-status]")) chip.setAttribute("aria-pressed", String(chip.dataset.status === status));
    for (const key of ["exp", "missing"]) {
      const rows = data[key];
      root.querySelector(`[data-tab-count="${key}"]`).textContent = rows ? `안 본 것 ${formatCount(rows.filter((r) => r.status === "open").length)} / ${formatCount(rows.length)}` : "-";
    }
    root.querySelector("[data-tip]").textContent = kind === "exp"
      ? "추천은 경험치가 더 작은 쪽이에요(메이플랜드 값 6개 중 5개가 작은 쪽). 반영하면 그 퀘스트는 관리자가 고친 퀘스트가 되어 수집 자료를 다시 넣어도 바뀌지 않아요."
      : "시작 NPC가 메이플랜드 맵에 있는 원본 퀘스트만 모았어요. 한국어 이름·안내 글은 원본에 없어서 이름을 적어야 추가할 수 있어요.";
    const rows = data[kind];
    if (!rows) return;
    const done = rows.filter((r) => r.status !== "open").length;
    root.querySelector("[data-progress]").innerHTML = rows.length ? `<div class="ym-gauge"><i style="width:${(done / rows.length * 100).toFixed(1)}%"></i></div><small>${formatCount(done)} / ${formatCount(rows.length)} 확인</small>` : "";
    const filtered = rows.filter(matches);
    list.innerHTML = filtered.length
      ? filtered.slice(0, shown).map((row, i) => kind === "exp" ? expCard(row, i, picks.get(row.id)) : missingCard(row, i)).join("")
        + (filtered.length > shown ? `<button type="button" class="mo-ghost qr-more-button" data-more>더 보기 (${formatCount(filtered.length - shown)}개 남음)</button>` : "")
      : `<p class="qr-empty">${rows.length ? (status === "open" && !query ? "모두 확인했어요! 🎉" : "찾는 항목이 없어요.") : "검토할 항목이 없어요. 비공개 도구가 만든 quest-reviews.sql 을 실행했는지 확인해 주세요."}</p>`;
  }

  async function load(which = kind) {
    const request = ++loadId;
    const result = await reviewRpc("catalog_quest_review_list", { p_kind: which });
    if (!root.isConnected) return;
    if (result.error || !Array.isArray(result.data)) {
      if (request !== loadId) return;
      root.querySelector("[data-list]").innerHTML = `<p class="qr-empty" role="alert">${esc(missingSql(result.error) ? "퀘스트 검토함을 쓰려면 sql/081을 먼저 실행해 주세요." : result.error ? reviewError(result.error) : "목록을 불러오지 못했습니다.")}</p>`;
      return;
    }
    data[which] = result.data;
    paint();
  }

  // 빈칸 = 모름(null). 메소는 가져가는 퀘스트가 있어 음수도 받는다. 1,000억까지.
  function readValue(card, selector, label) {
    const input = card.querySelector(selector);
    const text = String(input?.value ?? "").replaceAll(",", "").replaceAll(" ", "");
    const ok = text === "" || (label === "메소" ? /^-?\d{1,12}$/ : /^\d{1,12}$/).test(text);
    const value = text === "" ? null : Number(text);
    if (!ok || (value != null && Math.abs(value) > 100000000000)) {
      input?.focus(); input?.classList.add("is-error");
      notify(`${label}은(는) ${label === "메소" ? "" : "0 이상 "}정수로 적어 주세요(비우면 모름).`, "error");
      return { error: true };
    }
    input?.classList.remove("is-error");
    return { value };
  }

  function setPick(card, row, value) {
    picks.set(row.id, value);
    for (const option of card.querySelectorAll(".qr-option")) {
      const key = option.matches("[data-custom]") ? "custom" : option.dataset.pick;
      option.classList.toggle("is-picked", key === value);
      (option.matches("[data-pick]") ? option : option.querySelector("[data-pick]"))?.setAttribute("aria-pressed", String(key === value));
    }
  }

  async function decide(card, row, next, button) {
    const args = { p_review: row.id, p_status: next };
    if (next === "applied") {
      if (row.kind === "exp") {
        const pick = picks.get(row.id) ?? (row.data.recommend === "v83" ? "v83" : "ours");
        if (pick === "custom") {
          const exp = readValue(card, "[data-custom-exp]", "경험치"), meso = readValue(card, "[data-custom-meso]", "메소");
          if (exp.error || meso.error) return;
          Object.assign(args, { p_exp: exp.value, p_meso: meso.value });
        } else {
          const src = pick === "v83" ? row.data.v83 : { exp: row.quest.reward_exp, meso: row.quest.reward_meso };
          Object.assign(args, { p_exp: src?.exp ?? null, p_meso: src?.meso ?? null });
        }
        args.p_version = row.quest?.version;
      } else {
        const nameInput = card.querySelector("[data-add-name]");
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); nameInput.classList.add("is-error"); notify("퀘스트 이름을 적어 주세요.", "error"); return; }
        const exp = readValue(card, "[data-add-exp]", "경험치"), meso = readValue(card, "[data-add-meso]", "메소");
        if (exp.error || meso.error) return;
        Object.assign(args, { p_name: name, p_exp: exp.value, p_meso: meso.value });
      }
    }
    for (const b of card.querySelectorAll("[data-decide]")) b.disabled = true;
    const label = button.textContent;
    button.textContent = "저장하는 중";
    const result = await reviewRpc("catalog_quest_review_decide", args);
    if (!root.isConnected) return;
    if (result.error) {
      for (const b of card.querySelectorAll("[data-decide]")) b.disabled = false;
      button.textContent = label;
      notify(missingSql(result.error) ? "sql/081을 먼저 실행해 주세요." : reviewError(result.error), "error");
      if (result.error?.code === "40001") void load(row.kind);
      return;
    }
    if (next === "applied") { clearCatalogCache(); sfx("check"); }
    const finish = () => { void load(row.kind); };
    if (status === "open" && next !== "open" && !reduced()) { card.classList.add("is-leaving"); setTimeout(finish, 260); } else finish();
    if (next === "applied") notify(row.kind === "exp" ? `${row.quest?.name ?? row.data.name} 보상을 바꿨어요.` : `${args.p_name}을(를) 퀘스트 정보에 추가했어요.`, "success",
      { label: "퀘스트 보기", onClick: () => { location.href = `/quests/${encodeURIComponent(row.source_id)}/`; } });
  }

  root.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-kind]");
    if (tab && tab.dataset.kind !== kind) { kind = tab.dataset.kind; shown = PAGE; syncUrl(); paint(); if (!data[kind]) void load(kind); return; }
    const chip = event.target.closest("[data-status]");
    if (chip) { status = chip.dataset.status; shown = PAGE; syncUrl(); paint(); return; }
    if (event.target.closest("[data-more]")) { shown += PAGE; paint(); return; }
    const card = event.target.closest("[data-review]");
    if (!card) return;
    const row = data[kind]?.find((r) => r.id === card.dataset.review);
    if (!row) return;
    const pick = event.target.closest("[data-pick]");
    if (pick) {
      setPick(card, row, pick.dataset.pick);
      if (pick.dataset.pick === "custom") card.querySelector("[data-custom-exp]")?.focus();
      return;
    }
    const button = event.target.closest("[data-decide]");
    if (button && !button.disabled) void decide(card, row, button.dataset.decide, button);
  });
  // 직접 입력 칸을 누르면 직접 입력을 고른 것으로
  root.addEventListener("focusin", (event) => {
    const input = event.target.closest("[data-custom] input");
    const card = input?.closest("[data-review]");
    const row = card && data[kind]?.find((r) => r.id === card.dataset.review);
    if (row) setPick(card, row, "custom");
  });
  root.addEventListener("input", (event) => {
    if (event.target.matches("[data-search]")) { query = event.target.value.trim().toLowerCase(); shown = PAGE; paint(); }
    event.target.classList?.remove("is-error");
  });
  paint();
  void load(kind);
}
