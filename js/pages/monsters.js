import { escapeHtml, formatCount } from "../format.js";
import { matchesText, parseBound } from "../filters.js";
import { parseMonsterPaste } from "../monster-paste.js";
import {
  absorbMonster,
  elements,
  formatElements,
  hpPerExp,
  monsterFields,
  normalizeMonsterName,
  readElementTokens,
  storedFieldsDiffer,
} from "../monster-merge.js";
import { translateDbError } from "../db-error.js";
import { renderRecords } from "../record-page.js";
import { getSupabase } from "../supabase-client.js";

const columns =
  "id, name, level, hp, exp, required_accuracy, hp_per_exp, drop_items, accuracy_per_level, weak_elements, resist_elements, updated_at";

function elementOptions() {
  return elements.map((name) => ({ value: name, label: name, tone: name }));
}

function elementToggles(group) {
  return elements
    .map(
      (name) =>
        `<button class="element-toggle" type="button" data-element-toggle data-element-group="${group}" data-element="${escapeHtml(name)}" aria-pressed="false">${escapeHtml(name)}</button>`,
    )
    .join("");
}

function selectedElements(page, group) {
  return [...page.querySelectorAll(`[data-element-group="${group}"][aria-pressed="true"]`)].map((button) => button.dataset.element);
}

function elementText(value) {
  const picked = new Set(readElementTokens(value).names);
  const names = elements.filter((name) => picked.has(name));
  if (!names.length) return "-";
  return names
    .map((name) => `<span class="element-chip" data-element="${escapeHtml(name)}">${escapeHtml(name)}</span>`)
    .join("");
}

function num(value) {
  return escapeHtml(formatCount(value));
}

function monsterRange(level) {
  if (level >= 80) return { min: 70, max: null };
  const min = Math.max(0, level - 10);
  const max = level >= 70 ? level : level + 10;
  return { min, max };
}

function rangeLabel(range) {
  if (range.max == null) return `${range.min}레벨 이상`;
  return `${range.min}~${range.max}레벨`;
}

function neededAccuracy(row, myLevel) {
  if (myLevel == null) return null;
  if (row.required_accuracy == null && row.accuracy_per_level == null) return null;
  const gap = Math.max(0, (row.level ?? myLevel) - myLevel);
  const raw = Number(row.required_accuracy || 0) + gap * Number(row.accuracy_per_level || 0);
  return Math.ceil(Math.round(raw * 1e6) / 1e6);
}

function hpBand(value) {
  if (value == null || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  if (amount < 15) return 0;
  return Math.min(7, Math.floor((amount - 15) / 5) + 1);
}

function hpCell(value) {
  const band = hpBand(value);
  if (band == null) return num(value);
  return `<span class="hp-band is-${band}">${num(value)}</span>`;
}

export function render(root) {
  let pending = [];
  let myLevel = null;

  return renderRecords(root, {
    title: "몬스터 도감",
    kicker: "도감",
    shell: true,
    addLabel: "몬스터 추가",
    table: "monsters",
    columns,
    order: "level",
    ascending: true,
    emptyText: "등록한 몬스터가 없습니다. 직접 추가하거나 엑셀에서 붙여 넣을 수 있습니다.",
    searchLabel: "몬스터명",
    searchPlaceholder: "이름으로 찾기",
    searchFields: ["name"],
    levelMode: "point",
    levelField: "level",
    filterClass: "filters-my-level",
    levelFilters: `
      <label class="field"><span>드랍템</span><input data-drop-search placeholder="드랍템으로 찾기" /></label>
      <label class="field"><span>내 레벨 <small class="field-note">레범몬 찾기</small></span><input data-my-level inputmode="numeric" placeholder="예: 52" /></label>
      <div class="field element-filter"><span>약점</span><div class="element-toggles">${elementToggles("weak")}</div></div>
      <div class="field element-filter"><span>반감</span><div class="element-toggles">${elementToggles("resist")}</div></div>
      <button class="secondary-button filter-reset" type="button" data-reset-search>초기화</button>
    `,
    emptyFilterText: "검색 결과가 없습니다. 이름, 드랍템, 약점, 반감, 레벨을 바꿔 보세요.",
    match(row, page) {
      if (!matchesText(row, page.querySelector("[data-drop-search]").value, ["drop_items"])) return false;
      const weakNames = new Set(readElementTokens(row.weak_elements).names);
      const resistNames = new Set(readElementTokens(row.resist_elements).names);
      if (!selectedElements(page, "weak").every((name) => weakNames.has(name))) return false;
      if (!selectedElements(page, "resist").every((name) => resistNames.has(name))) return false;
      return true;
    },
    readBounds(page) {
      const note = page.querySelector("[data-level-range]");
      const parsed = parseBound(page.querySelector("[data-my-level]").value);
      if (parsed.error) {
        myLevel = null;
        if (note) {
          note.hidden = false;
          note.textContent = parsed.error;
        }
        return parsed;
      }
      myLevel = parsed.value;
      if (myLevel == null) {
        if (note) {
          note.hidden = true;
          note.textContent = "";
        }
        return { min: null, max: null };
      }
      const range = monsterRange(myLevel);
      if (note) {
        note.hidden = false;
        note.textContent = `${rangeLabel(range)} 몬스터입니다. 명중률은 이 레벨 기준이고, 소수점은 올립니다.`;
      }
      return range;
    },
    deleteMessage: (row) => `${row.name} 몬스터를 삭제할까요? 삭제한 내용은 되돌릴 수 없습니다.`,
    toolbarHtml: `<button class="secondary-button" type="button" data-toggle-paste aria-expanded="false" aria-controls="monster-paste">엑셀에서 한 번에 넣기</button>`,
    extraHtml: `
      <p class="hint" data-level-range hidden></p>
      <section class="paste-panel" id="monster-paste" hidden>
        <h2>엑셀에서 한 번에 넣기</h2>
        <p class="hint">엑셀 칸을 통째로 복사합니다. 제목 줄도 함께 붙여 넣습니다. 이름은 띄어쓰기 없이 저장하고, 같은 몬스터는 정보를 합칩니다. 이미 있는 수치는 두고, 비어 있는 값과 속성을 더합니다. 체경비는 체력÷경험치로 계산합니다. 명중률 표는 몬스터명, 레벨, 회피율, 필요명중률, 1레벨 당 패널티입니다. 회피율은 저장하지 않습니다. 체력 표는 레벨, 이름, HP, EXP입니다. 속성 표는 몬스터, 속성 약점, 속성 반감입니다. 속성이 여러 개면 칸 안에서 줄을 나눠도 됩니다. 얼음은 냉기로 넣습니다.</p>
        <textarea data-paste placeholder="엑셀에서 복사한 표를 여기에 붙여 넣기"></textarea>
        <div class="button-row">
          <button class="secondary-button" type="button" data-preview-paste>미리보기</button>
          <button class="primary-button" type="button" data-import-paste hidden>이 목록 등록</button>
        </div>
        <div data-paste-preview></div>
      </section>
    `,
    fields: [
      { name: "name", label: "몬스터명", kind: "text", required: true },
      { name: "level", label: "몬스터 레벨", kind: "number", minimum: 1 },
      { name: "hp", label: "체력", kind: "number", minimum: 0 },
      { name: "exp", label: "경험치", kind: "number", minimum: 0 },
      { name: "required_accuracy", label: "필요 명중률", kind: "decimal", minimum: 0 },
      { name: "drop_items", label: "드랍템 종류", kind: "text" },
      { name: "accuracy_per_level", label: "1레벨당 추가 필요 명중률", kind: "decimal", minimum: 0 },
      {
        name: "weak_elements",
        label: "속성 약점",
        kind: "checks",
        options: elementOptions(),
        hint: "같은 속성은 약점과 반감 중 하나만 고릅니다.",
      },
      { name: "resist_elements", label: "속성 반감", kind: "checks", options: elementOptions() },
    ],
    listHead: `<div class="catalog-row is-head"><span>몬스터</span><span>레벨</span><span>HP</span><span>경험치</span><span>체경비</span><span>필요 명중</span><span>기존 명중</span><span>1레벨당</span><span>드랍</span><span>약점</span><span>반감</span><span></span></div>`,
    card(row) {
      const accuracy = neededAccuracy(row, myLevel);
      return `<article class="catalog-row">
        <h3 title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</h3>
        <span class="trade-badge">${row.level == null ? "-" : escapeHtml(formatCount(row.level))}</span>
        <strong>${num(row.hp)}</strong>
        <strong>${num(row.exp)}</strong>
        <span class="catalog-band">${hpCell(hpPerExp(row.hp, row.exp))}</span>
        <strong class="is-focus">${num(accuracy)}</strong>
        <strong>${num(row.required_accuracy)}</strong>
        <strong>${num(row.accuracy_per_level)}</strong>
        <p class="catalog-clip" title="${escapeHtml(row.drop_items || "")}">${escapeHtml(row.drop_items || "—")}</p>
        <p class="catalog-clip">${elementText(row.weak_elements)}</p>
        <p class="catalog-clip">${elementText(row.resist_elements)}</p>
        <div class="row-actions">
          <button class="text-button" type="button" data-edit="${row.id}">수정</button>
          <button class="text-button is-danger" type="button" data-delete="${row.id}">삭제</button>
        </div>
      </article>`;
    },
    validate(payload) {
      payload.name = normalizeMonsterName(payload.name);
      if (!payload.name) return { error: "몬스터명 항목을 입력해 주세요." };
      const weak = new Set(readElementTokens(payload.weak_elements).names);
      const resist = readElementTokens(payload.resist_elements).names.filter((name) => !weak.has(name));
      payload.weak_elements = formatElements(weak);
      payload.resist_elements = formatElements(resist);
      payload.hp_per_exp = hpPerExp(payload.hp, payload.exp);
      return null;
    },
    async commit({ payload, id, rows, supabase }) {
      const name = normalizeMonsterName(payload.name);
      payload.name = name;
      payload.hp_per_exp = hpPerExp(payload.hp, payload.exp);
      const keeper = rows.find((row) => normalizeMonsterName(row.name) === name && row.id !== id);
      if (!keeper) {
        const query = id
          ? supabase.from("monsters").update(payload).eq("id", id)
          : supabase.from("monsters").insert(payload);
        const { error } = await query;
        return { error };
      }
      const merged = monsterFields(absorbMonster(keeper, payload));
      const { error } = await supabase.from("monsters").update(merged).eq("id", keeper.id);
      if (error) return { error };
      if (id) {
        const removed = await supabase.from("monsters").delete().eq("id", id);
        if (removed.error) return { error: removed.error };
      }
      return { message: `${name} 몬스터에 정보를 합쳤습니다.` };
    },
    async settle(list, supabase) {
      const groups = new Map();
      const kept = [];
      for (const row of list) {
        const key = normalizeMonsterName(row.name);
        if (!key) {
          kept.push(row);
          continue;
        }
        const bucket = groups.get(key) ?? [];
        bucket.push(row);
        groups.set(key, bucket);
      }
      const removeIds = [];
      let renamed = 0;
      for (const [key, bucket] of groups) {
        let merged = { name: key };
        for (const row of bucket) merged = absorbMonster(merged, row);
        const keeper = bucket.find((row) => row.name === key) || bucket[0];
        const fields = monsterFields(merged);
        if (storedFieldsDiffer(keeper, fields)) {
          const { error } = await supabase.from("monsters").update(fields).eq("id", keeper.id);
          if (error) return { error };
          if (keeper.name !== key) renamed += 1;
        }
        kept.push({ ...keeper, ...fields, id: keeper.id });
        for (const row of bucket) {
          if (row.id !== keeper.id) removeIds.push(row.id);
        }
      }
      if (removeIds.length) {
        const { error } = await supabase.from("monsters").delete().in("id", removeIds);
        if (error) return { error };
      }
      const notes = [];
      if (removeIds.length) notes.push(`${removeIds.length}마리의 겹친 몬스터 정보를 합쳤습니다`);
      if (renamed) notes.push("이름에서 띄어쓰기를 뺐습니다");
      return { rows: kept, message: notes.length ? `${notes.join(". ")}.` : "" };
    },
    bind({ root: page, reload, showStatus }) {
      const preview = page.querySelector("[data-paste-preview]");
      const importButton = page.querySelector("[data-import-paste]");
      const paste = page.querySelector("[data-paste]");
      const panel = page.querySelector("#monster-paste");
      const toggle = page.querySelector("[data-toggle-paste]");
      const editor = page.querySelector("form");

      function setPasteOpen(open) {
        panel.hidden = !open;
        toggle.setAttribute("aria-expanded", String(open));
        toggle.textContent = open ? "엑셀 입력 닫기" : "엑셀에서 한 번에 넣기";
        if (open) paste.focus();
      }

      toggle.addEventListener("click", () => {
        setPasteOpen(panel.hidden);
      });

      editor.addEventListener("change", (event) => {
        const input = event.target;
        if (input.type !== "checkbox" || !input.checked) return;
        const other = input.name === "weak_elements" ? "resist_elements" : input.name === "resist_elements" ? "weak_elements" : "";
        if (!other) return;
        const match = editor.querySelector(`input[name="${other}"][value="${CSS.escape(input.value)}"]`);
        if (match) match.checked = false;
      });

      function clearPending() {
        pending = [];
        importButton.hidden = true;
      }

      function previewTable(parsed, known) {
        const plan = planPaste(parsed.rows, known.rows);
        const actionCell = (index) => plan.actions[index];
        if (parsed.mode === "elements") {
          const body = parsed.rows
            .map(
              (row, index) =>
                `<tr><td>${escapeHtml(row.name)}</td><td>${elementText(row.weak_elements)}</td><td>${elementText(row.resist_elements)}</td><td>${actionCell(index)}</td></tr>`,
            )
            .join("");
          return `<div class="table-wrap"><table class="data-table"><thead><tr><th>몬스터</th><th>속성 약점</th><th>속성 반감</th><th>처리</th></tr></thead><tbody>${body}</tbody></table></div>`;
        }
        if (parsed.mode === "stats") {
          const body = parsed.rows
            .map(
              (row, index) =>
                `<tr><td class="num">${num(row.level)}</td><td>${escapeHtml(row.name)}</td><td class="num">${num(row.hp)}</td><td class="num">${num(row.exp)}</td><td>${actionCell(index)}</td></tr>`,
            )
            .join("");
          return `<div class="table-wrap"><table class="data-table"><thead><tr><th class="num">레벨</th><th>이름</th><th class="num">HP</th><th class="num">EXP</th><th>처리</th></tr></thead><tbody>${body}</tbody></table></div>`;
        }
        if (parsed.mode === "accuracy") {
          const body = parsed.rows
            .map(
              (row, index) =>
                `<tr><td>${escapeHtml(row.name)}</td><td class="num">${num(row.level)}</td><td class="num">${num(row.required_accuracy)}</td><td class="num">${num(row.accuracy_per_level)}</td><td>${actionCell(index)}</td></tr>`,
            )
            .join("");
          return `<div class="table-wrap"><table class="data-table"><thead><tr><th>몬스터명</th><th class="num">레벨</th><th class="num">필요 명중률</th><th class="num">1레벨당 패널티</th><th>처리</th></tr></thead><tbody>${body}</tbody></table></div>`;
        }
        const body = parsed.rows
          .map(
            (row, index) =>
              `<tr><td>${escapeHtml(row.name)}</td><td class="num">${num(row.level)}</td><td class="num">${num(row.hp)}</td><td class="num">${num(row.exp)}</td><td class="num">${num(row.required_accuracy)}</td><td class="num">${hpCell(hpPerExp(row.hp, row.exp))}</td><td>${escapeHtml(row.drop_items || "-")}</td><td>${actionCell(index)}</td></tr>`,
          )
          .join("");
        return `<div class="table-wrap"><table class="data-table"><thead><tr><th>몹 이름</th><th class="num">레벨</th><th class="num">HP</th><th class="num">경험치</th><th class="num">명중률</th><th class="num">체경비</th><th>드랍템</th><th>처리</th></tr></thead><tbody>${body}</tbody></table></div>`;
      }

      function planPaste(pasteRows, existing) {
        const byName = new Map();
        for (const row of existing ?? []) {
          const key = normalizeMonsterName(row.name);
          if (!key) continue;
          const records = byName.get(key) ?? [];
          records.push({ ...row, name: key });
          byName.set(key, records);
        }
        const inserts = new Map();
        const updates = new Map();
        const actions = [];
        for (const row of pasteRows) {
          const key = normalizeMonsterName(row.name);
          const incoming = { ...row, name: key };
          const records = byName.get(key);
          if (!records) {
            const before = inserts.get(key);
            const created = absorbMonster(before || { name: key }, incoming);
            inserts.set(key, monsterFields(created));
            actions.push(before ? (storedFieldsDiffer(before, created) ? "정보 합치기" : "이 목록에 있음") : "새로 추가");
            continue;
          }
          let changed = false;
          for (const record of records) {
            const after = absorbMonster(record, incoming);
            if (storedFieldsDiffer(record, after)) {
              changed = true;
              Object.assign(record, after);
              if (record.id) updates.set(record.id, monsterFields(after));
            }
          }
          actions.push(changed ? "정보 합치기" : "그대로 둠");
        }
        return { inserts, updates, actions };
      }

      async function loadMonstersForPaste() {
        const supabase = await getSupabase();
        const { data, error } = await supabase.from("monsters").select(columns);
        if (error) return { error };
        return { rows: data ?? [] };
      }

      async function savePasteRows(pasteRows) {
        const known = await loadMonstersForPaste();
        if (known.error) return { error: known.error };
        const plan = planPaste(pasteRows, known.rows);
        const supabase = await getSupabase();
        for (const [id, fields] of plan.updates) {
          const { error: updateError } = await supabase.from("monsters").update(fields).eq("id", id);
          if (updateError) return { error: updateError };
        }
        if (plan.inserts.size) {
          const { error: insertError } = await supabase.from("monsters").insert([...plan.inserts.values()]);
          if (insertError) return { error: insertError };
        }
        const added = plan.actions.filter((action) => action === "새로 추가").length;
        const merged = plan.actions.filter((action) => action === "정보 합치기").length;
        const kept = plan.actions.filter((action) => action === "그대로 둠").length;
        return { added, merged, kept };
      }

      paste.addEventListener("input", () => {
        clearPending();
        preview.innerHTML = "";
      });

      page.querySelector("[data-preview-paste]").addEventListener("click", async () => {
        const parsed = parseMonsterPaste(paste.value);
        if (parsed.error) {
          clearPending();
          preview.innerHTML = "";
          showStatus(parsed.error, "error");
          return;
        }
        const known = await loadMonstersForPaste();
        if (known.error) {
          showStatus(translateDbError(known.error), "error");
          return;
        }
        pending = parsed.rows;
        importButton.hidden = false;
        preview.innerHTML = previewTable(parsed, known);
        showStatus(`${parsed.rows.length}마리를 확인했습니다. 맞으면 이 목록 등록을 누르세요.`, "info");
      });

      importButton.addEventListener("click", async () => {
        if (!pending.length) return;
        importButton.disabled = true;
        showStatus("등록하는 중입니다.", "info");
        const result = await savePasteRows(pending);
        importButton.disabled = false;
        if (result.error) {
          showStatus(translateDbError(result.error), "error");
          return;
        }
        const statsParts = [];
        if (result.added) statsParts.push(`${result.added}마리를 추가했습니다`);
        if (result.merged) statsParts.push(`${result.merged}마리의 정보를 합쳤습니다`);
        if (result.kept) statsParts.push(`${result.kept}마리는 그대로 두었습니다`);
        if (!statsParts.length) statsParts.push("바꿀 몬스터가 없습니다");
        const message = `${statsParts.join(". ")}.`;
        paste.value = "";
        preview.innerHTML = "";
        clearPending();
        setPasteOpen(false);
        showStatus(message, "info");
        await reload();
      });
    },
  });
}
