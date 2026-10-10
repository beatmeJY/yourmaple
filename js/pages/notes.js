import { translateDbError } from "../db-error.js";
import { BURST_COLORS, burstAt, paletteHue as hueOf, sfx } from "../effects.js";
import { compareName, escapeHtml, formatCount } from "../format.js";
import { matchesText } from "../filters.js";
import { getSupabase } from "../supabase-client.js";
import { notify } from "../toast.js";

const columns = "id, title, content, category, tags, created_at, updated_at";
const NONE = "__none__";

function categoryOf(row) {
  return String(row.category ?? "").trim();
}

function tagsOf(row) {
  return String(row.tags ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function formatWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function noteCard(row, index, selectedId, poppedId) {
  const category = categoryOf(row);
  const content = String(row.content ?? "").trim();
  const when = formatWhen(row.updated_at);
  const tags = tagsOf(row).map((tag) => `<span class="memo-tag">#${escapeHtml(tag)}</span>`).join("");
  const classes = ["memo-card", row.id === selectedId ? "is-selected" : "", row.id === poppedId ? "is-new" : ""].filter(Boolean).join(" ");
  return `
    <button type="button" class="${classes}" data-pick="${row.id}" style="--hue:${hueOf(category)};--i:${Math.min(index, 12)}" aria-pressed="${row.id === selectedId}">
      <span class="memo-card-bar" aria-hidden="true"></span>
      <strong class="memo-card-title">${escapeHtml(row.title || "제목 없음")}</strong>
      <span class="memo-card-body">${content ? escapeHtml(content) : "내용 없음"}</span>
      ${tags ? `<span class="memo-card-tags">${tags}</span>` : ""}
      <span class="memo-card-foot">${category ? `<span class="memo-card-cat">${escapeHtml(category)}</span>` : ""}<span>${escapeHtml(when)}</span></span>
    </button>
  `;
}

export async function render(root) {
  root.innerHTML = `
    <div class="memo-page">
      <header class="ym-page-head"><h1>메모</h1><p>카드를 누르면 편집 칸에서 고칠 수 있습니다.</p></header>
      <div class="memo-layout">
        <div class="memo-main">
          <div class="ym-toolbar">
            <label class="ym-search"><span class="ym-search-icon" aria-hidden="true"></span><input data-search type="search" placeholder="제목, 내용, 태그로 찾기" aria-label="메모 검색" /></label>
            <span class="ym-count" data-count></span>
            <button class="ym-add" type="button" data-add>+ 새 메모</button>
          </div>
          <div class="ym-filters" data-categories role="group" aria-label="카테고리"></div>
          <div data-list></div>
        </div>
        <form class="memo-editor ym-glass" data-editor>
          <div class="memo-editor-head"><span class="memo-editor-dot" aria-hidden="true"></span><strong data-form-title>새 메모</strong><small>저장을 눌러야 반영됩니다</small></div>
          <input class="memo-editor-title" name="title" placeholder="제목" autocomplete="off" aria-label="제목" />
          <textarea class="memo-editor-body" name="content" rows="9" placeholder="내용을 적어 보세요" aria-label="내용"></textarea>
          <div class="memo-editor-meta">
            <label class="field"><span>카테고리</span><input name="category" autocomplete="off" placeholder="예: 보스" /></label>
            <label class="field"><span>태그</span><input name="tags" placeholder="쉼표로 구분" autocomplete="off" /></label>
          </div>
          <div class="memo-editor-actions">
            <button class="primary-button" type="submit">저장</button>
            <button class="secondary-button" type="button" data-new>새로 쓰기</button>
            <button class="danger-button" type="button" data-delete hidden>삭제</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const list = root.querySelector("[data-list]");
  const count = root.querySelector("[data-count]");
  const segments = root.querySelector("[data-categories]");
  const form = root.querySelector("[data-editor]");
  const title = root.querySelector("[data-form-title]");
  const search = root.querySelector("[data-search]");
  const deleteButton = root.querySelector("[data-delete]");
  let rows = [];
  let category = "";
  let selectedId = "";
  let poppedId = "";
  let dirty = false;
  let loadId = 0;

  function categories() {
    return [...new Set(rows.map(categoryOf).filter(Boolean))].sort(compareName);
  }

  function visibleRows() {
    return rows.filter((row) => {
      const name = categoryOf(row);
      if (category === NONE && name) return false;
      if (category && category !== NONE && name !== category) return false;
      return matchesText(row, search.value, ["title", "content", "category", "tags"]);
    });
  }

  function paintEditorColor() {
    form.style.setProperty("--hue", hueOf(form.elements.category.value.trim()));
  }

  function fillForm(row) {
    selectedId = row.id || "";
    title.textContent = row.id ? "메모 편집" : "새 메모";
    form.elements.title.value = row.title ?? "";
    form.elements.content.value = row.content ?? "";
    form.elements.category.value = row.category ?? "";
    form.elements.tags.value = row.tags ?? "";
    deleteButton.hidden = !row.id;
    dirty = false;
    paintEditorColor();
  }

  // 고치던 내용이 있으면 다른 메모로 옮기기 전에 확인한다.
  function canLeaveEditor() {
    return !dirty || window.confirm("저장하지 않은 내용이 있습니다. 버리고 다른 메모로 옮길까요?");
  }

  function paintCount() {
    count.textContent = `${formatCount(rows.length)}개`;
  }

  function paintSegments() {
    const names = categories();
    const hasBlank = rows.some((row) => !categoryOf(row));
    const items = [{ id: "", label: "전체", count: rows.length }];
    for (const name of names) items.push({ id: name, label: name, count: rows.filter((row) => categoryOf(row) === name).length, hue: hueOf(name) });
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

  function paintList() {
    const visible = visibleRows();
    if (!rows.length) {
      list.innerHTML = `<p class="ym-empty">작성한 메모가 없습니다. 새 메모로 첫 메모를 남겨 보세요.</p>`;
      return;
    }
    if (!visible.length) {
      list.innerHTML = `<p class="ym-empty">이 조건에 맞는 메모가 없습니다.</p>`;
      return;
    }
    list.innerHTML = `<div class="memo-grid">${visible.map((row, index) => noteCard(row, index, selectedId, poppedId)).join("")}</div>`;
    poppedId = "";
  }

  function paint() {
    paintCount();
    paintSegments();
    paintList();
  }

  async function loadRows() {
    const current = ++loadId;
    list.innerHTML = `<p class="ym-empty">불러오는 중입니다.</p>`;
    const supabase = await getSupabase();
    const { data, error } = await supabase.from("notes").select(columns).order("updated_at", { ascending: false });
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
    if (selectedId && !rows.some((row) => row.id === selectedId)) fillForm({ id: "" });
    paint();
  }

  root.addEventListener("input", (event) => {
    if (event.target === search) {
      paintList();
      return;
    }
    if (form.contains(event.target)) {
      dirty = true;
      if (event.target === form.elements.category) paintEditorColor();
    }
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

    if (event.target.closest("[data-add], [data-new]")) {
      if (!canLeaveEditor()) return;
      sfx("tick");
      fillForm({ id: "" });
      paintList();
      form.elements.title.focus({ preventScroll: true });
      form.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }

    const pick = event.target.closest("[data-pick]");
    if (pick) {
      if (pick.dataset.pick === selectedId) return;
      if (!canLeaveEditor()) return;
      const row = rows.find((item) => item.id === pick.dataset.pick);
      if (!row) return;
      sfx("tick");
      fillForm(row);
      for (const card of list.querySelectorAll("[data-pick]")) {
        const on = card.dataset.pick === selectedId;
        card.classList.toggle("is-selected", on);
        card.setAttribute("aria-pressed", String(on));
      }
      // 좁은 화면에서는 편집 칸이 목록 아래에 있으므로 그쪽으로 내려 준다.
      if (window.matchMedia("(max-width: 979px)").matches) form.scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }

    if (!event.target.closest("[data-delete]")) return;
    const row = rows.find((item) => item.id === selectedId);
    if (!row) return;
    if (!window.confirm(`${row.title} 메모를 삭제할까요? 삭제한 내용은 되돌릴 수 없습니다.`)) return;
    deleteButton.disabled = true;
    const supabase = await getSupabase();
    const { error } = await supabase.from("notes").delete().eq("id", row.id);
    deleteButton.disabled = false;
    if (error) {
      notify(translateDbError(error), "error");
      return;
    }
    sfx("fail");
    fillForm({ id: "" });
    notify("삭제했습니다.", "info");
    await loadRows();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      title: form.elements.title.value.trim(),
      content: form.elements.content.value.trim(),
      category: form.elements.category.value.trim() || null,
      tags: form.elements.tags.value.trim() || null,
    };
    if (!payload.title) {
      notify("제목 항목을 입력해 주세요.", "error");
      form.elements.title.focus();
      return;
    }
    const saveButton = form.querySelector("button[type='submit']");
    saveButton.disabled = true;
    const supabase = await getSupabase();
    const id = selectedId;
    const result = id
      ? await supabase.from("notes").update(payload).eq("id", id)
      : await supabase.from("notes").insert(payload).select("id").single();
    saveButton.disabled = false;
    if (result.error) {
      notify(translateDbError(result.error), "error");
      return;
    }
    sfx("check");
    burstAt(saveButton, BURST_COLORS.mid, 22, 1);
    dirty = false;
    // 새 메모는 저장 뒤 바로 선택해 이어서 고칠 수 있게 한다.
    if (!id && result.data?.id) {
      selectedId = result.data.id;
      poppedId = result.data.id;
      title.textContent = "메모 편집";
      deleteButton.hidden = false;
    }
    notify(id ? "수정했습니다." : "저장했습니다.", "info");
    await loadRows();
  });

  fillForm({ id: "" });
  await loadRows();
}
