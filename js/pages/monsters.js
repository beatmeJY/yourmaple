import { sfx } from "../effects.js";
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
import { loadMainCharacter, mainCharacterId } from "../profile.js";
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
        `<button class="element-toggle mo-el" type="button" data-element-toggle data-element-group="${group}" data-element="${escapeHtml(name)}" aria-pressed="false">${escapeHtml(name)}</button>`,
    )
    .join("");
}

// 카드·상세의 속성 꼬리표: 약점은 속성 색, 반감은 흐리게.
function elementTags(row) {
  const weak = readElementTokens(row.weak_elements).names;
  const resist = readElementTokens(row.resist_elements).names;
  return [
    ...elements.filter((name) => weak.includes(name)).map((name) => `<span class="element-chip mo-tag" data-element="${escapeHtml(name)}">${escapeHtml(name)} 약점</span>`),
    ...elements.filter((name) => resist.includes(name)).map((name) => `<span class="mo-tag is-resist">${escapeHtml(name)} 반감</span>`),
  ].join("");
}

function initial(name) {
  return [...String(name || "").trim()][0] || "?";
}

function firstElement(row) {
  return readElementTokens(row.weak_elements).names[0] || "";
}

const ACCURACY_KEY = "maple-note-accuracy";

function readAccuracy() {
  try {
    return localStorage.getItem(ACCURACY_KEY) || "";
  } catch {
    return "";
  }
}

function writeAccuracy(value) {
  try {
    localStorage.setItem(ACCURACY_KEY, value);
  } catch {
    // 저장이 막혀도 이번 방문 동안은 계산한다.
  }
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
  let sortMode = "level";
  let selectedId = "";
  let shown = [];
  let allRows = [];
  let accLevel = "";
  let accMine = readAccuracy();

  function splitDrops(text) {
    return String(text || "")
      .split(/\n|,|·|\//)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  // 오른쪽 상세: 그림 자리·수치·속성·명중 계산·드랍템·수정/삭제.
  function paintDetail() {
    const box = root.querySelector("[data-mo-detail]");
    if (!box) return;
    const row = allRows.find((item) => item.id === selectedId);
    if (!row) {
      box.innerHTML = `<p class="mo-muted">${allRows.length ? "몬스터를 고르면 자세히 보여 줘요." : "몬스터를 추가하면 여기서 명중과 드랍템을 볼 수 있어요."}</p>`;
      return;
    }
    const ratio = hpPerExp(row.hp, row.exp);
    const tags = elementTags(row);
    const drops = splitDrops(row.drop_items);
    box.innerHTML = `
      <div class="mo-stage element-chip" data-element="${escapeHtml(firstElement(row))}"><b>${escapeHtml(initial(row.name))}</b><i aria-hidden="true"></i></div>
      <div class="mo-d-title"><strong>${escapeHtml(row.name)}</strong><span class="mo-badge">Lv.${row.level == null ? "-" : escapeHtml(formatCount(row.level))}</span></div>
      <div class="mo-d-stats">
        <div><span>HP</span><strong>${num(row.hp)}</strong></div>
        <div><span>EXP</span><strong>${num(row.exp)}</strong></div>
        <div><span>1 EXP당 HP</span><strong>${hpCell(ratio)}</strong></div>
      </div>
      <div class="mo-d-tags">${tags || `<span class="mo-tag is-resist">속성 없음</span>`}</div>
      <div class="mo-accbox" data-accbox>
        <div class="mo-acc-head"><span>명중 계산</span><span class="mo-acc-badge" data-acc-badge></span></div>
        <div class="mo-acc-inputs">
          <label class="mo-well"><span>내 레벨</span><input data-acc-level inputmode="numeric" value="${escapeHtml(accLevel)}" placeholder="레벨" /></label>
          <label class="mo-well"><span>내 명중률</span><input data-acc-mine inputmode="decimal" value="${escapeHtml(accMine)}" placeholder="명중" /></label>
        </div>
        <div class="mo-acc-out" data-acc-out></div>
        <p class="mo-muted">기본 필요 명중 ${num(row.required_accuracy)} · 레벨이 낮으면 1레벨마다 ${num(row.accuracy_per_level)}씩 더 필요해요.</p>
      </div>
      <div class="mo-drops">
        <span class="mo-d-label">드랍 아이템 <small>${drops.length}종</small></span>
        ${drops.length ? `<div class="mo-drop-grid">${drops.map((name, index) => `<span class="mo-drop" style="--i:${index}"><i aria-hidden="true">${escapeHtml(initial(name))}</i>${escapeHtml(name)}</span>`).join("")}</div>` : `<p class="mo-muted">적어 둔 드랍템이 없어요.</p>`}
      </div>
      <div class="mo-d-actions">
        <button class="mo-ghost" type="button" data-edit="${row.id}">수정</button>
        <button class="mo-ghost is-danger" type="button" data-delete="${row.id}">삭제</button>
      </div>`;
    paintAccuracy();
  }

  function paintAccuracy() {
    const box = root.querySelector("[data-accbox]");
    const row = allRows.find((item) => item.id === selectedId);
    if (!box || !row) return;
    const badge = box.querySelector("[data-acc-badge]");
    const out = box.querySelector("[data-acc-out]");
    const level = parseBound(accLevel);
    const mine = Number(String(accMine).replaceAll(",", ""));
    const need = level.error || level.value == null ? null : neededAccuracy(row, level.value);
    if (need == null) {
      badge.textContent = "";
      badge.className = "mo-acc-badge";
      out.innerHTML = `<span class="mo-muted">${row.required_accuracy == null ? "필요 명중률이 비어 있어요." : "내 레벨을 적으면 필요 명중을 계산해요."}</span>`;
      return;
    }
    const hasMine = String(accMine).trim() !== "" && Number.isFinite(mine);
    const ok = hasMine && mine >= need;
    badge.textContent = !hasMine ? "" : ok ? "100% 명중" : "빗나갈 수 있어요";
    badge.className = `mo-acc-badge${!hasMine ? "" : ok ? " is-ok" : " is-low"}`;
    const scale = Math.max(need, hasMine ? mine : 0) * 1.15 || 1;
    const diff = hasMine ? Math.round((mine - need) * 10) / 10 : null;
    out.innerHTML = `
      <span class="mo-acc-line"><span>필요 명중 <strong>${num(need)}</strong></span><span>${diff == null ? "내 명중률을 적어 주세요" : diff >= 0 ? `${formatCount(diff)} 여유` : `${formatCount(-diff)} 부족`}</span></span>
      <span class="mo-acc-bar${ok ? " is-ok" : ""}"><i style="width:${hasMine ? Math.min(100, (mine / scale) * 100) : 0}%"></i><b style="left:${(need / scale) * 100}%"></b></span>`;
  }

  return renderRecords(root, {
    title: "몬스터 도감",
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
    filterClass: "mo-filters",
    levelFilters: `
      <label class="field mo-drop"><span>드랍템</span><input data-drop-search placeholder="드랍템으로 찾기" /></label>
      <label class="field mo-my"><span>내 레벨 <small class="field-note">레범몬</small></span><input data-my-level inputmode="numeric" placeholder="예: 52" /></label>
      <div class="mo-els"><span>약점</span>${elementToggles("weak")}<i aria-hidden="true"></i><span>반감</span>${elementToggles("resist")}</div>
      <button class="mo-ghost" type="button" data-reset-search>초기화</button>
    `,
    layout: ({ formHtml, filtersHtml, extraHtml }) => `
      <div class="mo-page">
        <header class="ym-page-head mo-head">
          <div><h1>몬스터 도감</h1><p>레벨·약점으로 찾고, 1 EXP당 HP로 사냥 효율을 비교해요.</p></div>
          <div class="mo-head-actions">
            <button class="mo-ghost" type="button" data-toggle-paste aria-expanded="false" aria-controls="monster-paste">엑셀에서 한 번에 넣기</button>
            <button class="mo-add" type="button" data-add>+ 몬스터 추가</button>
          </div>
        </header>
        <div class="mo-layout">
          <div class="mo-main">
            <div class="mo-bar">
              ${filtersHtml}
              <div class="mo-sorts" role="group" aria-label="정렬">
                <button type="button" class="mo-sort is-on" data-sort-mode="level" aria-pressed="true">레벨순</button>
                <button type="button" class="mo-sort" data-sort-mode="eff" aria-pressed="false">효율순</button>
              </div>
            </div>
            ${extraHtml}
            <p class="mo-count" data-mo-count></p>
            <div data-list></div>
          </div>
          <aside class="mo-side">
            <section class="mo-panel mo-form-panel" data-form-panel>${formHtml}</section>
            <section class="mo-panel mo-detail" data-mo-detail><p class="mo-muted">몬스터를 고르면 자세히 보여 줘요.</p></section>
          </aside>
        </div>
      </div>`,
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
    sortRows(rows) {
      if (sortMode !== "eff") return rows;
      // 1 EXP당 HP가 낮을수록 효율이 좋다. 값이 없으면 뒤로.
      return [...rows].sort((left, right) => {
        const a = hpPerExp(left.hp, left.exp);
        const b = hpPerExp(right.hp, right.exp);
        if (a == null && b == null) return (left.level ?? 0) - (right.level ?? 0);
        if (a == null) return 1;
        if (b == null) return -1;
        return a - b || (left.level ?? 0) - (right.level ?? 0);
      });
    },
    renderList(rows, every) {
      allRows = every;
      const values = every.map((row) => hpPerExp(row.hp, row.exp)).filter((value) => value != null);
      const max = values.length ? Math.max(...values) : 0;
      const min = values.length ? Math.min(...values) : 0;
      if (!rows.some((row) => row.id === selectedId)) selectedId = rows[0]?.id || "";
      const cards = rows
        .map((row, index) => {
          const ratio = hpPerExp(row.hp, row.exp);
          const width = ratio == null ? 0 : max === min ? 100 : 18 + ((max - ratio) / (max - min)) * 82;
          const accuracy = neededAccuracy(row, myLevel);
          const el = firstElement(row);
          return `<button type="button" class="mo-card${row.id === selectedId ? " is-on" : ""}" data-pick-monster="${row.id}" aria-pressed="${row.id === selectedId}" style="--i:${Math.min(index, 16)}">
            <span class="mo-art element-chip" data-element="${escapeHtml(el)}"><b>${escapeHtml(initial(row.name))}</b><span class="mo-lv">Lv.${row.level == null ? "-" : escapeHtml(formatCount(row.level))}</span>${accuracy != null ? `<span class="mo-acc" title="내 레벨 기준 필요 명중">명중 ${num(accuracy)}</span>` : ""}</span>
            <span class="mo-name"><strong>${escapeHtml(row.name)}</strong>${row.drop_items ? `<span title="${escapeHtml(row.drop_items)}">${escapeHtml(row.drop_items)}</span>` : ""}</span>
            <span class="mo-stats"><span><small>HP</small><strong>${num(row.hp)}</strong></span><span><small>EXP</small><strong>${num(row.exp)}</strong></span></span>
            <span class="mo-eff">
              <span class="mo-eff-top"><span>1 EXP당 HP</span>${hpCell(ratio)}</span>
              <span class="mo-eff-bar"><i style="width:${width}%"></i></span>
            </span>
            <span class="mo-tags">${elementTags(row)}</span>
          </button>`;
        })
        .join("");
      return `<div class="mo-grid">${cards}</div>`;
    },
    afterPaint(rows) {
      shown = rows;
      const count = root.querySelector("[data-mo-count]");
      if (count) count.textContent = rows.length ? `${rows.length}마리${sortMode === "eff" ? " · 1 EXP당 HP가 낮을수록 사냥 효율이 좋아요" : ""}` : "";
      if (!rows.some((row) => row.id === selectedId)) selectedId = rows[0]?.id || "";
      paintDetail();
    },
    deleteMessage: (row) => `${row.name} 몬스터를 삭제할까요? 삭제한 내용은 되돌릴 수 없습니다.`,
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
    bind({ root: page, reload, showStatus, repaint }) {
      // 처음 내 레벨은 대표 캐릭터 레벨(명중 계산 칸). 필터의 "내 레벨"을 적으면 그 값을 따른다.
      loadMainCharacter().then((state) => {
        if (accLevel) return;
        const main = state.characters.find((item) => item.id === mainCharacterId());
        if (main?.level) {
          accLevel = String(main.level);
          const input = page.querySelector("[data-acc-level]");
          if (input && !input.value) input.value = accLevel;
          paintAccuracy();
        }
      });

      page.addEventListener("click", (event) => {
        const sortButton = event.target.closest("[data-sort-mode]");
        if (sortButton) {
          sortMode = sortButton.dataset.sortMode;
          sfx("tick");
          for (const button of page.querySelectorAll("[data-sort-mode]")) {
            const on = button === sortButton;
            button.classList.toggle("is-on", on);
            button.setAttribute("aria-pressed", String(on));
          }
          repaint();
          return;
        }
        const card = event.target.closest("[data-pick-monster]");
        if (card && card.dataset.pickMonster !== selectedId) {
          selectedId = card.dataset.pickMonster;
          sfx("tick");
          for (const item of page.querySelectorAll("[data-pick-monster]")) {
            const on = item.dataset.pickMonster === selectedId;
            item.classList.toggle("is-on", on);
            item.setAttribute("aria-pressed", String(on));
          }
          paintDetail();
          if (window.matchMedia("(max-width: 1100px)").matches) page.querySelector("[data-mo-detail]")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });

      page.addEventListener("input", (event) => {
        if (event.target.matches("[data-my-level]")) {
          const value = event.target.value.trim();
          if (value) {
            accLevel = value;
            const input = page.querySelector("[data-acc-level]");
            if (input) input.value = value;
            paintAccuracy();
          }
        }
        if (event.target.matches("[data-acc-level]")) {
          accLevel = event.target.value;
          paintAccuracy();
        }
        if (event.target.matches("[data-acc-mine]")) {
          accMine = event.target.value;
          writeAccuracy(accMine);
          paintAccuracy();
        }
      });

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
