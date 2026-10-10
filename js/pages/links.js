import { translateDbError } from "../db-error.js";
import { burstAt, paletteHue, sfx } from "../effects.js";
import { compareName, escapeHtml, formatCount } from "../format.js";
import { matchesText } from "../filters.js";
import { faviconSrc, linkHost, normalizeLinkUrl } from "../link-url.js";
import { getSupabase } from "../supabase-client.js";
import { notify } from "../toast.js";

const columns = "id, title, url, memo, category, created_at, updated_at";
const NONE = "__none__";
const ADD_COLORS = ["#c9a6ff", "#8ff0c4", "#ffffff"];

function initial(title) {
  const text = String(title ?? "").trim();
  return [...text][0] || "?";
}

function categoryOf(row) {
  return String(row.category ?? "").trim();
}

// 분류 색 타일(첫 글자) + 오른쪽 아래 사이트 아이콘. 아이콘을 못 불러오면 main.js가 숨긴다.
function linkTile(title, url, hue) {
  const icon = faviconSrc(url);
  const favicon = icon
    ? `<img class="lk-favicon" src="${escapeHtml(icon)}" alt="" width="16" height="16" data-favicon referrerpolicy="no-referrer" />`
    : "";
  return `<span class="lk-tile" style="--hue:${hue}" aria-hidden="true">${escapeHtml(initial(title))}${favicon}</span>`;
}

function linkCard(row, index, editingId, poppedId) {
  const hue = paletteHue(categoryOf(row));
  const memo = String(row.memo ?? "").trim();
  const classes = ["lk-card", row.id === editingId ? "is-editing" : "", row.id === poppedId ? "is-new" : ""].filter(Boolean).join(" ");
  return `
    <article class="${classes}" style="--hue:${hue};--i:${Math.min(index, 12)}">
      <a class="lk-card-open" href="${escapeHtml(row.url)}" target="_blank" rel="noopener noreferrer">
        ${linkTile(row.title, row.url, hue)}
        <span class="lk-card-copy">
          <strong>${escapeHtml(row.title)}</strong>
          <span class="lk-card-host">${escapeHtml(linkHost(row.url) || row.url)}</span>
          ${memo ? `<span class="lk-card-memo">${escapeHtml(memo)}</span>` : ""}
        </span>
        <span class="lk-card-go" aria-hidden="true">↗</span>
      </a>
      <span class="lk-card-actions">
        <button type="button" data-edit="${row.id}" aria-label="${escapeHtml(row.title)} 수정">수정</button>
        <button type="button" class="is-danger" data-delete="${row.id}" aria-label="${escapeHtml(row.title)} 삭제">삭제</button>
      </span>
    </article>
  `;
}

export async function render(root) {
  root.innerHTML = `
    <div class="lk-page">
      <header class="ym-page-head"><h1>링크</h1><p>자주 여는 주소를 분류별로 모아 둡니다. 메뉴의 링크를 누르면 어느 화면에서든 바로 열 수 있습니다.</p></header>
      <div class="lk-layout">
        <div class="lk-main">
          <div class="ym-toolbar">
            <label class="ym-search"><span class="ym-search-icon" aria-hidden="true"></span><input data-search type="search" placeholder="이름, 주소, 메모, 분류로 찾기" aria-label="링크 검색" /></label>
            <span class="ym-count" data-count></span>
            <button class="ym-add" type="button" data-add>+ 새 링크</button>
          </div>
          <div class="ym-filters" data-categories role="group" aria-label="분류"></div>
          <div class="lk-groups" data-list></div>
        </div>
        <form class="lk-editor ym-glass" data-editor novalidate>
          <div class="lk-editor-head"><h2 data-form-title>링크 추가</h2><button class="lk-cancel" type="button" data-cancel hidden>취소</button></div>
          <div class="lk-preview" data-preview></div>
          <label class="field"><span>이름</span><input name="title" autocomplete="off" placeholder="예: 길드 공지" /></label>
          <label class="field"><span>주소</span><input name="url" autocomplete="off" inputmode="url" placeholder="https://" /></label>
          <label class="field"><span>분류</span><input name="category" autocomplete="off" placeholder="예: 공식" /></label>
          <div class="lk-category-picks" data-category-picks></div>
          <label class="field"><span>메모</span><textarea name="memo" rows="2" placeholder="선택"></textarea></label>
          <button class="lk-submit" type="submit" data-submit>추가하기</button>
        </form>
      </div>
    </div>
  `;

  const list = root.querySelector("[data-list]");
  const count = root.querySelector("[data-count]");
  const segments = root.querySelector("[data-categories]");
  const form = root.querySelector("[data-editor]");
  const title = root.querySelector("[data-form-title]");
  const preview = root.querySelector("[data-preview]");
  const picks = root.querySelector("[data-category-picks]");
  const cancelButton = root.querySelector("[data-cancel]");
  const submitButton = root.querySelector("[data-submit]");
  const search = root.querySelector("[data-search]");
  let rows = [];
  let category = "";
  let editingId = "";
  let poppedId = "";
  let loadId = 0;

  function categories() {
    return [...new Set(rows.map(categoryOf).filter(Boolean))].sort(compareName);
  }

  function visibleRows() {
    return rows.filter((row) => {
      const name = categoryOf(row);
      if (category === NONE && name) return false;
      if (category && category !== NONE && name !== category) return false;
      return matchesText(row, search.value, ["title", "url", "memo", "category"]);
    });
  }

  // 입력하는 대로 카드 미리보기와 버튼 상태를 바꾼다.
  function paintPreview() {
    const name = form.elements.title.value.trim();
    const parsed = normalizeLinkUrl(form.elements.url.value);
    const url = parsed.value ?? "";
    const hue = paletteHue(form.elements.category.value.trim());
    form.style.setProperty("--hue", hue);
    preview.innerHTML = `
      ${linkTile(name, url, hue)}
      <span class="lk-card-copy">
        <strong>${escapeHtml(name || "링크 이름")}</strong>
        <span class="lk-card-host">${escapeHtml(url ? linkHost(url) : "주소를 입력하세요")}</span>
      </span>
    `;
    submitButton.classList.toggle("is-ready", Boolean(name && url));
    const current = form.elements.category.value.trim();
    for (const button of picks.querySelectorAll("[data-pick-category]")) {
      button.setAttribute("aria-pressed", String(button.dataset.pickCategory === current));
    }
  }

  function paintPicks() {
    const names = categories();
    picks.hidden = !names.length;
    picks.innerHTML = names
      .map((name) => `<button type="button" class="ym-chip" data-pick-category="${escapeHtml(name)}" style="--hue:${paletteHue(name)}" aria-pressed="false"><i class="ym-chip-dot" aria-hidden="true"></i>${escapeHtml(name)}</button>`)
      .join("");
  }

  function fillForm(row) {
    editingId = row.id || "";
    title.textContent = row.id ? "링크 수정" : "링크 추가";
    submitButton.textContent = row.id ? "수정하기" : "추가하기";
    cancelButton.hidden = !row.id;
    form.elements.title.value = row.title ?? "";
    form.elements.url.value = row.url ?? "";
    form.elements.category.value = row.category ?? "";
    form.elements.memo.value = row.memo ?? "";
    paintPreview();
    for (const card of list.querySelectorAll(".lk-card")) {
      card.classList.toggle("is-editing", Boolean(editingId) && card.querySelector(`[data-edit="${CSS.escape(editingId)}"]`) !== null);
    }
  }

  function paintCount() {
    count.textContent = `${formatCount(rows.length)}개`;
  }

  function paintSegments() {
    const names = categories();
    const hasBlank = rows.some((row) => !categoryOf(row));
    const items = [{ id: "", label: "전체", count: rows.length }];
    for (const name of names) items.push({ id: name, label: name, count: rows.filter((row) => categoryOf(row) === name).length, hue: paletteHue(name) });
    if (hasBlank && names.length) items.push({ id: NONE, label: "미분류", count: rows.filter((row) => !categoryOf(row)).length });
    if (!items.some((item) => item.id === category)) category = "";
    segments.hidden = items.length < 2;
    segments.innerHTML = items
      .map((item) => {
        const on = item.id === category;
        return `<button type="button" class="ym-chip" data-category="${escapeHtml(item.id)}" aria-pressed="${on}"${item.hue ? ` style="--hue:${item.hue}"` : ""}>${item.hue ? `<i class="ym-chip-dot" aria-hidden="true"></i>` : ""}${escapeHtml(item.label)}<span class="ym-chip-count">${formatCount(item.count)}</span></button>`;
      })
      .join("");
  }

  // 시안처럼 분류마다 유리 카드 한 장에 묶는다. 분류 없는 링크는 맨 뒤 "미분류" 묶음.
  function paintList() {
    const visible = visibleRows();
    if (!rows.length) {
      list.innerHTML = `<p class="ym-empty">저장한 링크가 없습니다. 오른쪽 칸에서 다시 열고 싶은 주소를 추가해 보세요.</p>`;
      return;
    }
    if (!visible.length) {
      list.innerHTML = `<p class="ym-empty">이 조건에 맞는 링크가 없습니다.</p>`;
      return;
    }
    const groups = new Map();
    for (const row of visible) {
      const name = categoryOf(row);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(row);
    }
    const names = [...groups.keys()].sort((a, b) => (!a ? 1 : !b ? -1 : compareName(a, b)));
    let index = 0;
    list.innerHTML = names
      .map((name, groupIndex) => {
        const items = groups.get(name);
        const cards = items.map((row) => linkCard(row, index++, editingId, poppedId)).join("");
        return `
          <section class="lk-group ym-glass" style="--hue:${paletteHue(name)};--g:${Math.min(groupIndex, 6)}">
            <header class="lk-group-head"><i class="ym-chip-dot" aria-hidden="true"></i><h2>${escapeHtml(name || "미분류")}</h2><span>${formatCount(items.length)}개</span></header>
            <div class="lk-cards">${cards}</div>
          </section>
        `;
      })
      .join("");
    poppedId = "";
  }

  function paint() {
    paintCount();
    paintSegments();
    paintPicks();
    paintList();
    paintPreview();
  }

  async function loadRows() {
    const current = ++loadId;
    list.innerHTML = `<p class="ym-empty">불러오는 중입니다.</p>`;
    const supabase = await getSupabase();
    const { data, error } = await supabase.from("links").select(columns).order("updated_at", { ascending: false });
    if (current !== loadId || !list.isConnected) return;
    if (error) {
      rows = [];
      list.innerHTML = "";
      notify(translateDbError(error), "error");
      paintCount();
      segments.innerHTML = "";
      return;
    }
    rows = data ?? [];
    if (editingId && !rows.some((row) => row.id === editingId)) fillForm({ id: "" });
    paint();
  }

  root.addEventListener("input", (event) => {
    if (event.target === search) {
      paintList();
      return;
    }
    if (form.contains(event.target)) paintPreview();
  });

  root.addEventListener("click", async (event) => {
    const categoryButton = event.target.closest("[data-category]");
    if (categoryButton && segments.contains(categoryButton)) {
      sfx("tick");
      category = categoryButton.dataset.category ?? "";
      paintSegments();
      paintList();
      return;
    }

    const pickButton = event.target.closest("[data-pick-category]");
    if (pickButton) {
      sfx("tick");
      form.elements.category.value = pickButton.dataset.pickCategory;
      paintPreview();
      return;
    }

    if (event.target.closest("[data-add], [data-cancel]")) {
      sfx("tick");
      fillForm({ id: "" });
      if (event.target.closest("[data-add]")) {
        form.elements.title.focus({ preventScroll: true });
        form.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
      return;
    }

    const editButton = event.target.closest("[data-edit]");
    if (editButton) {
      const row = rows.find((item) => item.id === editButton.dataset.edit);
      if (!row) return;
      sfx("tick");
      fillForm(row);
      // 좁은 화면에서는 편집 칸이 목록 아래에 있으므로 그쪽으로 내려 준다.
      if (window.matchMedia("(max-width: 979px)").matches) form.scrollIntoView({ block: "start", behavior: "smooth" });
      form.elements.title.focus({ preventScroll: true });
      return;
    }

    const deleteButton = event.target.closest("[data-delete]");
    if (!deleteButton) return;
    const row = rows.find((item) => item.id === deleteButton.dataset.delete);
    if (!row) return;
    if (!window.confirm(`${row.title} 링크를 삭제할까요? 삭제한 내용은 되돌릴 수 없습니다.`)) return;
    deleteButton.disabled = true;
    const supabase = await getSupabase();
    const { error } = await supabase.from("links").delete().eq("id", row.id);
    if (error) {
      deleteButton.disabled = false;
      notify(translateDbError(error), "error");
      return;
    }
    sfx("fail");
    if (editingId === row.id) fillForm({ id: "" });
    notify("삭제했습니다.", "info");
    await loadRows();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      title: form.elements.title.value.trim(),
      url: form.elements.url.value,
      memo: form.elements.memo.value.trim(),
      category: form.elements.category.value.trim() || null,
    };
    if (!payload.title) {
      sfx("fail");
      notify("이름 항목을 입력해 주세요.", "error");
      form.elements.title.focus();
      return;
    }
    const parsed = normalizeLinkUrl(payload.url);
    if (parsed.error) {
      sfx("fail");
      notify(parsed.error, "error");
      form.elements.url.focus();
      return;
    }
    payload.url = parsed.value;
    submitButton.disabled = true;
    const supabase = await getSupabase();
    const id = editingId;
    const result = id
      ? await supabase.from("links").update(payload).eq("id", id)
      : await supabase.from("links").insert(payload).select("id").single();
    submitButton.disabled = false;
    if (result.error) {
      notify(translateDbError(result.error), "error");
      return;
    }
    sfx("check");
    burstAt(submitButton, ADD_COLORS, 26, 1);
    if (!id && result.data?.id) poppedId = result.data.id;
    // 같은 분류를 이어서 추가하기 쉽게 새로 추가한 뒤에는 분류를 남긴다.
    fillForm({ id: "", category: id ? "" : payload.category });
    notify(id ? "수정했습니다." : "추가했습니다.", "info");
    await loadRows();
  });

  fillForm({ id: "" });
  await loadRows();
}
