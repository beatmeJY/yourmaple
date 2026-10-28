import { formatExpPerHp, sortMonsterRows } from "../monster-view.js";
import { loadMonsterCatalog } from "../monster-catalog.js";
import { sfx } from "../effects.js";
import { escapeHtml, formatCount } from "../format.js";
import { matchesText, parseBound } from "../filters.js";
import { elements, hpPerExp, readElementTokens } from "../monster-merge.js";
import { catalogError } from "../catalog.js";
import { loadMainCharacter, mainCharacterId } from "../profile.js";
import { renderRecords } from "../record-page.js";

const columns =
  "id, name, level, hp, exp, required_accuracy, hp_per_exp, accuracy_per_level, weak_elements, resist_elements, updated_at, image_url";

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
  let myLevel = null;
  let sortMode = "level";
  let selectedId = "";
  let allRows = [];
  let accLevel = "";
  let accMine = readAccuracy();


  // 오른쪽 상세: 공용 그림·수치·속성·명중 계산·드랍템(읽기 전용).
  function paintDetail() {
    const box = root.querySelector("[data-mo-detail]");
    if (!box) return;
    const row = allRows.find((item) => item.id === selectedId);
    if (!row) {
      box.innerHTML = `<p class="mo-muted">${allRows.length ? "몬스터를 고르면 자세히 보여 줘요." : "공용 도감이 준비되면 명중과 드랍템을 볼 수 있어요."}</p>`;
      return;
    }
    const ratio = hpPerExp(row.hp, row.exp);
    const tags = elementTags(row);
    const drops = row.drops ?? [];
    box.innerHTML = `
      <div class="mo-stage element-chip" data-element="${escapeHtml(firstElement(row))}">${row.image_url?.startsWith("https://") ? `<img class="catalog-monster-image" src="${escapeHtml(row.image_url)}" alt="" loading="lazy" />` : `<b>${escapeHtml(initial(row.name))}</b>`}<i aria-hidden="true"></i></div>
      <div class="mo-d-title"><strong>${escapeHtml(row.name)}</strong><span class="mo-badge">Lv.${row.level == null ? "-" : escapeHtml(formatCount(row.level))}</span></div>
      <div class="mo-d-stats">
        <div><span>HP</span><strong>${num(row.hp)}</strong></div>
        <div><span>EXP</span><strong>${num(row.exp)}</strong></div>
        <div><span>1 EXP당 HP</span><strong>${hpCell(ratio)}</strong></div>
        <div><span>1 HP당 EXP</span><strong>${escapeHtml(formatExpPerHp(row.hp,row.exp))}</strong></div>
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
        <span class="mo-d-label">드랍 아이템 <small>${drops.length}개 항목</small></span>
        ${drops.length ? `<div class="mo-drop-grid">${drops.map((drop, index) => `<span class="mo-drop" style="--i:${Math.min(index, 12)}"><i aria-hidden="true">${escapeHtml(initial(drop.item?.name))}</i><span>${escapeHtml(drop.item?.name ?? "아이템 정보 없음")}</span><small>${drop.rate_percent == null ? "확률 미상" : `${escapeHtml(drop.rate_percent)}%`}</small></span>`).join("")}</div>` : `<p class="mo-muted">등록된 드랍 정보가 없어요.</p>`}
      </div>
`;
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
    table: "catalog_monsters",
    readOnly: true,
    load: (supabase) => loadMonsterCatalog(supabase),
    errorMessage: catalogError,
    columns,
    order: "level",
    ascending: true,
    emptyText: "아직 공용 몬스터 정보가 없습니다. 운영자가 도감 데이터를 준비하고 있습니다.",
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
          <div><span class="ym-badge">모두가 함께 보는 공용 도감</span></div>
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

            <section class="mo-panel mo-detail" data-mo-detail><p class="mo-muted">몬스터를 고르면 자세히 보여 줘요.</p></section>
          </aside>
        </div>
      </div>`,
    emptyFilterText: "검색 결과가 없습니다. 이름, 드랍템, 약점, 반감, 레벨을 바꿔 보세요.",
    match(row, page) {
      if (!matchesText(row, page.querySelector("[data-drop-search]").value, ["drop_search"])) return false;
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
      return sortMonsterRows(rows, sortMode);
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
            <span class="mo-art element-chip" data-element="${escapeHtml(el)}">${row.image_url?.startsWith("https://") ? `<img class="catalog-monster-image" src="${escapeHtml(row.image_url)}" alt="" loading="lazy" />` : `<b>${escapeHtml(initial(row.name))}</b>`}<span class="mo-lv">Lv.${row.level == null ? "-" : escapeHtml(formatCount(row.level))}</span>${accuracy != null ? `<span class="mo-acc" title="내 레벨 기준 필요 명중">명중 ${num(accuracy)}</span>` : ""}</span>
            <span class="mo-name"><strong>${escapeHtml(row.name)}</strong>${row.drop_search ? `<span title="${escapeHtml(row.drop_search)}">${escapeHtml(row.drop_search)}</span>` : ""}</span>
            <span class="mo-stats"><span><small>HP</small><strong>${num(row.hp)}</strong></span><span><small>EXP</small><strong>${num(row.exp)}</strong></span></span>
            <span class="mo-eff">
              <span class="mo-eff-top"><span>1 EXP당 HP</span>${hpCell(ratio)}</span>
              <span class="mo-eff-bar"><i style="width:${width}%"></i></span>
              <span class="mo-eff-top"><span>1 HP당 EXP</span><span>${escapeHtml(formatExpPerHp(row.hp,row.exp))}</span></span>
            </span>
            <span class="mo-tags">${elementTags(row)}</span>
          </button>`;
        })
        .join("");
      return `<div class="mo-grid">${cards}</div>`;
    },
    afterPaint(rows) {
      const count = root.querySelector("[data-mo-count]");
      if (count) count.textContent = rows.length ? `${rows.length}마리${sortMode === "eff" ? " · 1 EXP당 HP가 낮을수록 사냥 효율이 좋아요" : ""}` : "";
      if (!rows.some((row) => row.id === selectedId)) selectedId = rows[0]?.id || "";
      paintDetail();
    },
    extraHtml: `<p class="hint" data-level-range hidden></p>`,
    fields: [],
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

    },
  });
}
