import { translateDbError } from "./db-error.js";
import { escapeHtml, readCount, readDecimal } from "./format.js";
import { filterRows, readLevelFilter } from "./filters.js";
import { getSupabase } from "./supabase-client.js";
import { notify } from "./toast.js";

function fieldHtml(field) {
  if (field.kind === "checks") {
    const boxes = field.options
      .map(
        (option) => {
          const tone = option.tone ? ` data-element="${escapeHtml(option.tone)}"` : "";
          const toneClass = option.tone ? " element-pick" : "";
          return `<label class="check-line${toneClass}"${tone}><input type="checkbox" name="${escapeHtml(field.name)}" value="${escapeHtml(option.value)}" /><span>${escapeHtml(option.label)}</span></label>`;
        },
      )
      .join("");
    const hint = field.hint ? `<p class="hint">${escapeHtml(field.hint)}</p>` : "";
    return `<fieldset class="field span-all"><legend>${escapeHtml(field.label)}</legend><div class="element-picks">${boxes}</div>${hint}</fieldset>`;
  }
  if (field.kind === "textarea") {
    return `<label class="field"><span>${field.label}</span><textarea name="${field.name}"></textarea></label>`;
  }
  if (field.kind === "select") {
    const options = field.options
      .map((option) => `<option value="${option.value}">${option.label}</option>`)
      .join("");
    return `<label class="field"><span>${field.label}</span><select name="${field.name}">${options}</select></label>`;
  }
  const mode = field.kind === "decimal" ? ` inputmode="decimal"` : field.kind === "number" ? ` inputmode="numeric"` : "";
  const type = field.kind === "date" ? "date" : "text";
  const required = field.required ? " required" : "";
  const placeholder = field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : "";
  return `<label class="field"><span>${field.label}</span><input name="${field.name}" type="${type}"${mode}${required}${placeholder} /></label>`;
}

export async function renderRecords(root, options) {
  const levelFilters =
    options.levelFilters ??
    (options.levelMode
      ? `
      <label class="field"><span>레벨 최소</span><input data-level-min inputmode="numeric" /></label>
      <label class="field"><span>레벨 최대</span><input data-level-max inputmode="numeric" /></label>
    `
      : "");
  const filterClass = options.filterClass ? ` ${options.filterClass}` : options.levelMode || options.levelFilters ? "" : " filters-search-only";
  const formHtml = `
    <form class="editor" hidden>
      <h2 data-form-title>${options.addLabel}</h2>
      ${options.fields.map(fieldHtml).join("")}
      <div class="button-row">
        <button class="primary-button" type="submit">저장</button>
        <button class="secondary-button" type="button" data-cancel>취소</button>
      </div>
    </form>`;
  const filtersInner = `
      <label class="field"><span>${options.searchLabel}</span><input data-search placeholder="${options.searchPlaceholder}" /></label>
      ${levelFilters}`;
  const filtersHtml =
    options.filterClass === "filters-my-level"
      ? `<div class="filter-shell"><div class="filters${filterClass}">${filtersInner}</div></div>`
      : `<div class="filters${filterClass}">${filtersInner}</div>`;
  const listHtml = `${formHtml}${filtersHtml}${options.extraHtml || ""}<div data-list></div>`;
  // layout: 화면이 배치를 직접 정할 때(시안 배치). 조각을 받아 data-list 를 포함한 전체 HTML을 돌려준다.
  root.innerHTML = options.layout
    ? options.layout({ formHtml, filtersHtml, extraHtml: options.extraHtml || "" })
    : options.shell
    ? `
    <div class="studio-page">
      <header class="page-header">
        <p class="studio-kicker">${options.kicker || ""}</p>
        <div class="studio-hero-row">
          <h1>${options.title}</h1>
          <div class="button-row">
            ${options.toolbarHtml || ""}
            <button class="primary-button" type="button" data-add>${options.addLabel}</button>
          </div>
        </div>
      </header>
      <section class="studio-board">${listHtml}</section>
    </div>`
    : `
    <header class="page-header">
      <h1>${options.title}</h1>
    </header>
    <div class="page-toolbar">
      <button class="primary-button" type="button" data-add>${options.addLabel}</button>
      ${options.toolbarHtml || ""}
    </div>
    ${listHtml}`;

  const list = root.querySelector("[data-list]");
  const form = root.querySelector("form");
  const title = root.querySelector("[data-form-title]");
  let rows = [];
  let loadId = 0;

  function showStatus(text, kind) {
    notify(text, kind);
  }

  function fillForm(row) {
    form.hidden = false;
    form.dataset.editingId = row.id || "";
    title.textContent = row.id ? "수정" : options.addLabel;
    for (const field of options.fields) {
      if (field.kind === "checks") {
        const picked = new Set(
          String(row[field.name] ?? "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        );
        for (const input of form.querySelectorAll(`input[name="${field.name}"]`)) {
          input.checked = picked.has(input.value);
        }
        continue;
      }
      const input = form.elements.namedItem(field.name);
      if (input) input.value = row[field.name] ?? "";
    }
    form.elements[options.fields[0].name].focus();
    form.scrollIntoView({ block: "nearest" });
  }

  function closeForm() {
    form.hidden = true;
    form.dataset.editingId = "";
    form.reset();
  }

  function paintList() {
    const bounds = options.readBounds
      ? options.readBounds(root)
      : options.levelMode
        ? readLevelFilter(root.querySelector("[data-level-min]").value, root.querySelector("[data-level-max]").value)
        : null;
    if (!rows.length) {
      list.innerHTML = `<p class="empty">${options.emptyText}</p>`;
      options.afterPaint?.([]);
      return;
    }
    const filtered = filterRows(rows, {
      query: root.querySelector("[data-search]").value,
      fields: options.searchFields,
      levelMode: options.levelMode,
      levelField: options.levelField,
      levelMinField: options.levelMinField,
      levelMaxField: options.levelMaxField,
      filter: bounds,
    });
    if (filtered.error) {
      list.innerHTML = `<p class="empty">${filtered.error}</p>`;
      return;
    }
    if (options.match) filtered.rows = filtered.rows.filter((row) => options.match(row, root));
    if (!filtered.rows.length) {
      list.innerHTML = `<p class="empty">${options.emptyFilterText || "검색 결과가 없습니다. 검색어나 레벨 범위를 바꿔 보세요."}</p>`;
      options.afterPaint?.([]);
      return;
    }
    if (options.sortRows) filtered.rows = options.sortRows(filtered.rows, root);
    if (options.renderList) {
      // renderList: 카드 목록 대신 화면이 목록 전체를 그린다. afterPaint 로 상세 칸 같은 곁 요소를 맞춘다.
      list.innerHTML = options.renderList(filtered.rows, rows);
      options.afterPaint?.(filtered.rows);
      return;
    }
    if (options.sheet) {
      const head = options.sheet
        .map((column) => `<th class="${column.className || ""}">${column.label}</th>`)
        .join("");
      const body = filtered.rows
        .map((row) => {
          const cells = options.sheet
            .map((column) => `<td class="${column.className || ""}">${column.cell(row)}</td>`)
            .join("");
          return `<tr>${cells}<td><div class="row-actions"><button class="text-button" type="button" data-edit="${row.id}">수정</button><button class="text-button is-danger" type="button" data-delete="${row.id}">삭제</button></div></td></tr>`;
        })
        .join("");
      list.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr>${head}<th>작업</th></tr></thead><tbody>${body}</tbody></table></div>`;
      return;
    }
    list.innerHTML = `<div class="card-list">${options.listHead || ""}${filtered.rows.map((row) => options.card(row)).join("")}</div>`;
  }

  function readForm() {
    const payload = {};
    for (const field of options.fields) {
      if (field.kind === "checks") {
        const picked = new Set(
          [...form.querySelectorAll(`input[name="${field.name}"]:checked`)].map((input) => input.value),
        );
        const ordered = field.options.filter((option) => picked.has(option.value)).map((option) => option.value);
        payload[field.name] = ordered.length ? ordered.join(", ") : null;
        continue;
      }
      const raw = form.elements[field.name].value;
      if (field.kind === "number" || field.kind === "decimal") {
        const parsed = (field.kind === "decimal" ? readDecimal : readCount)(
          raw,
          field.label,
          field.minimum ?? 0,
        );
        if (parsed.error) return parsed;
        payload[field.name] = parsed.value;
        continue;
      }
      const text = raw.trim();
      if (field.required && !text) return { error: `${field.label} 항목을 입력해 주세요.` };
      payload[field.name] = text || (field.keepEmpty ? "" : null);
    }
    if (options.validate) {
      const extra = options.validate(payload);
      if (extra?.error) return extra;
    }
    return { value: payload };
  }

  async function loadRows() {
    const current = ++loadId;
    list.innerHTML = `<p class="empty">불러오는 중입니다.</p>`;
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from(options.table)
      .select(options.columns)
      .order(options.order, { ascending: options.ascending ?? false });
    if (current !== loadId || !list.isConnected) return;
    if (error) {
      rows = [];
      list.innerHTML = "";
      showStatus(translateDbError(error), "error");
      return;
    }
    rows = data ?? [];
    if (options.settle) {
      const settled = await options.settle(rows, supabase);
      if (current !== loadId || !list.isConnected) return;
      if (settled?.error) {
        rows = [];
        list.innerHTML = "";
        showStatus(translateDbError(settled.error), "error");
        return;
      }
      if (settled?.rows) rows = settled.rows;
      if (settled?.message) showStatus(settled.message, "info");
    }
    paintList();
  }

  root.addEventListener("input", (event) => {
    if (event.target.closest(".filters input, .filters select")) paintList();
  });

  root.addEventListener("click", async (event) => {
    if (event.target.closest("[data-reset-search]")) {
      for (const input of root.querySelectorAll(".filters input, .filters select")) input.value = "";
      for (const button of root.querySelectorAll(".filters [data-element-toggle]")) {
        button.setAttribute("aria-pressed", "false");
        button.classList.remove("is-on");
      }
      paintList();
      return;
    }
    const elementToggle = event.target.closest("[data-element-toggle]");
    if (elementToggle) {
      const on = elementToggle.getAttribute("aria-pressed") !== "true";
      elementToggle.setAttribute("aria-pressed", on ? "true" : "false");
      elementToggle.classList.toggle("is-on", on);
      paintList();
      return;
    }
    if (event.target.closest("[data-add]")) {
      showStatus("", "info");
      fillForm({ id: "" });
    }
    if (event.target.closest("[data-cancel]")) closeForm();

    const editButton = event.target.closest("[data-edit]");
    if (editButton) {
      const row = rows.find((item) => item.id === editButton.dataset.edit);
      if (row) fillForm(row);
    }

    const deleteButton = event.target.closest("[data-delete]");
    if (!deleteButton) return;
    const row = rows.find((item) => item.id === deleteButton.dataset.delete);
    if (!row) return;
    if (!window.confirm(options.deleteMessage(row))) return;
    deleteButton.disabled = true;
    const supabase = await getSupabase();
    const { error } = await supabase.from(options.table).delete().eq("id", row.id);
    if (error) {
      deleteButton.disabled = false;
      showStatus(translateDbError(error), "error");
      return;
    }
    if (form.dataset.editingId === row.id) closeForm();
    showStatus("삭제했습니다.", "info");
    await loadRows();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const parsed = readForm();
    if (parsed.error) {
      showStatus(parsed.error, "error");
      return;
    }
    const saveButton = form.querySelector("button[type='submit']");
    saveButton.disabled = true;
    showStatus("저장하는 중입니다.", "info");
    const supabase = await getSupabase();
    const id = form.dataset.editingId;
    const result = options.commit
      ? await options.commit({ payload: parsed.value, id, rows, supabase })
      : await (id
          ? supabase.from(options.table).update(parsed.value).eq("id", id)
          : supabase.from(options.table).insert(parsed.value));
    const error = result?.error;
    saveButton.disabled = false;
    if (error) {
      showStatus(translateDbError(error), "error");
      return;
    }
    closeForm();
    showStatus(result?.message || (id ? "수정했습니다." : "저장했습니다."), "info");
    await loadRows();
  });

  if (options.bind) options.bind({ root, reload: loadRows, showStatus, repaint: paintList, rows: () => rows, fillForm });
  await loadRows();
}
