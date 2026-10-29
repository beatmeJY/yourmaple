import { monsterCombatFacts, neededMonsterAccuracy } from "../monster-details.js";
import { formatExpPerHp, sortMonsterRows } from "../monster-view.js";
import { catalogRpc, monsterDrops, clearCatalogCache } from "../catalog-api.js";
import { catalogImage, catalogMonsterImage, mountCatalogImageFallback } from "../catalog-image.js";
import { sfx } from "../effects.js";
import { escapeHtml, formatCount } from "../format.js";
import { matchesText, parseBound } from "../filters.js";
import { elements, hpPerExp, readElementTokens } from "../monster-merge.js";
import { catalogError } from "../catalog.js";
import { mountHistoryDialog } from "../catalog-history.js";
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

const neededAccuracy = neededMonsterAccuracy;

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
  mountCatalogImageFallback(root);
  let myLevel = null;
  let sortMode = "level";
  let selectedId = "";
  let allRows = [];
  let accLevel = "";
  let accMine = readAccuracy();
  let detailLoadId = 0;
  const dropsCache = new Map();


  // 드랍 칸: 확률이 높은 순, 막대는 0.01%~100%를 로그 눈금으로(희귀 드랍도 보이게). 확률은 합산하지 않는다.
  function dropTier(rate) {
    if (rate == null) return "is-unknown";
    return rate >= 10 ? "is-common" : rate >= 1 ? "is-uncommon" : rate >= 0.1 ? "is-rare" : "is-epic";
  }
  function dropsHtml(drops) {
    if (!drops.length) return `<div class="mo-drops-head"><h3>드랍 아이템</h3><span class="mo-drops-count">0개</span></div><p class="mo-muted">등록된 드랍 정보가 없어요.</p>`;
    const rate = (drop) => (drop.rate_percent == null ? null : Number(drop.rate_percent));
    const sorted = drops.map((drop, index) => ({ drop, index })).sort((left, right) => (rate(right.drop) ?? -1) - (rate(left.drop) ?? -1) || left.index - right.index);
    const rows = sorted.map(({ drop }, index) => {
      const value = rate(drop);
      const width = value == null ? 0 : Math.max(4, Math.min(100, ((Math.log10(Math.max(value, 0.0001)) + 2) / 4) * 100));
      const label = value == null ? "확률 미상" : `${escapeHtml(drop.rate_percent)}%`;
      const name = drop.item?.name ?? "아이템 정보 없음";
      return `<a class="mo-drop-row ${dropTier(value)}" href="#/item-catalog?id=${encodeURIComponent(drop.item_id)}" style="--i:${Math.min(index, 14)}" title="${escapeHtml(name)} · ${label}">
        <span class="mo-drop-icon">${catalogImage(drop.item?.image_url, "catalog-drop-image", 36) || `<i aria-hidden="true">${escapeHtml(initial(drop.item?.name))}</i>`}</span>
        <span class="mo-drop-copy"><strong>${escapeHtml(name)}</strong><span class="mo-drop-bar" aria-hidden="true"><i style="--w:${width}%"></i></span></span>
        <b class="mo-drop-rate">${label}</b>
      </a>`;
    }).join("");
    return `<div class="mo-drops-head"><h3>드랍 아이템</h3><span class="mo-drops-count">${drops.length}개</span></div>
      <p class="mo-drops-hint">확률 높은 순 · 누르면 아이템 정보로 가요</p>
      <div class="mo-drop-list">${rows}</div>`;
  }

  // 오른쪽 상세: 공용 그림·수치·속성·명중 계산. 드랍템은 그 옆 칸(넓은 화면) 또는 아래 칸.
  function paintDetail() {
    const box = root.querySelector("[data-mo-detail]");
    const dropsBox = root.querySelector("[data-mo-drops]");
    if (!box) return;
    const request = ++detailLoadId;
    const row = allRows.find((item) => item.id === selectedId);
    if (!row) {
      box.innerHTML = `<p class="mo-muted">${allRows.length ? "몬스터를 고르면 자세히 보여 줘요." : "공용 도감이 준비되면 명중과 드랍템을 볼 수 있어요."}</p>`;
      if (dropsBox) dropsBox.innerHTML = `<p class="mo-muted">몬스터를 고르면 드랍 아이템을 보여 줘요.</p>`;
      return;
    }
    const ratio = hpPerExp(row.hp, row.exp);
    const tags = elementTags(row);

    box.innerHTML = `
      <div class="catalog-detail-actions"><button type="button" class="catalog-history-button" data-open-history>변경 이력</button></div>
      <div class="mo-stage element-chip" data-element="${escapeHtml(firstElement(row))}">${catalogMonsterImage(row) || `<b>${escapeHtml(initial(row.name))}</b>`}<i aria-hidden="true"></i></div>
      <div class="mo-d-title"><strong>${escapeHtml(row.name)}</strong><span class="mo-badge">Lv.${row.level == null ? "-" : escapeHtml(formatCount(row.level))}</span></div>
      <div class="mo-d-stats">
        <div><span>HP</span><strong>${num(row.hp)}</strong></div>
        <div><span>EXP</span><strong>${num(row.exp)}</strong></div>
        <div><span>1 EXP당 HP</span><strong>${hpCell(ratio)}</strong></div>
        <div><span>1 HP당 EXP</span><strong>${escapeHtml(formatExpPerHp(row.hp,row.exp))}</strong></div>
      </div>
      <section class="mo-combat"><h3>전투 정보</h3><div data-monster-combat><p class="mo-muted">상세 수치를 불러오는 중입니다.</p></div></section>
      <div class="mo-d-tags">${tags || `<span class="mo-tag is-resist">속성 없음</span>`}</div>
      <div class="mo-accbox" data-accbox>
        <div class="mo-acc-head"><span>명중 계산</span><span class="mo-acc-badge" data-acc-badge></span></div>
        <div class="mo-acc-inputs">
          <label class="mo-well"><span>내 레벨</span><input data-acc-level inputmode="numeric" value="${escapeHtml(accLevel)}" placeholder="레벨" /></label>
          <label class="mo-well"><span>내 명중률</span><input data-acc-mine inputmode="decimal" value="${escapeHtml(accMine)}" placeholder="명중" /></label>
        </div>
        <div class="mo-acc-out" data-acc-out></div>
        <p class="mo-muted" data-acc-note></p>
      </div>
`;
    if (dropsBox) dropsBox.innerHTML = `<div class="mo-drops-head"><h3>드랍 아이템</h3></div><p class="mo-muted">${escapeHtml(row.name)} 드랍 정보를 불러오는 중입니다.</p>`;
    paintAccuracy();
    void catalogRpc("catalog_monster_detail", { p_id: row.id }).then(result => {
      if (request !== detailLoadId || !root.isConnected || selectedId !== row.id) return;
      const facts = box.querySelector("[data-monster-combat]");
      if (result.error || !result.data?.monster) {
        facts.textContent = result.error ? catalogError(result.error) : "상세 전투 정보가 없습니다.";
        return;
      }
      Object.assign(row, result.data.monster);
      facts.innerHTML = monsterCombatFacts(row);
      paintAccuracy();
    });
    mountHistoryDialog(box.querySelector("[data-open-history]"), row.id, "monster", row.name);
    const cached = dropsCache.get(row.id);
    const pending = cached && Date.now() - cached.time < 30_000 ? Promise.resolve(cached.result) : monsterDrops(row.id);
    void pending.then(result => {
      if (request !== detailLoadId || !root.isConnected || selectedId !== row.id) return;
      if (!dropsBox) return;
      if (result.error) { dropsBox.innerHTML = `<div class="mo-drops-head"><h3>드랍 아이템</h3></div><p class="mo-muted">${escapeHtml(catalogError(result.error))}</p>`; return; }
      dropsCache.set(row.id, { time: Date.now(), result });
      while (dropsCache.size > 24) dropsCache.delete(dropsCache.keys().next().value);
      dropsBox.innerHTML = dropsHtml(result.data ?? []);
    }).catch(() => {
      if (request === detailLoadId && root.isConnected && dropsBox) dropsBox.innerHTML = `<div class="mo-drops-head"><h3>드랍 아이템</h3></div><p class="mo-muted">드랍 조회에 실패했습니다. 몬스터를 다시 선택해주세요.</p>`;
    });
  }

  function paintAccuracy() {
    const box = root.querySelector("[data-accbox]");
    const row = allRows.find((item) => item.id === selectedId);
    if (!box || !row) return;
    const badge = box.querySelector("[data-acc-badge]");
    const out = box.querySelector("[data-acc-out]");
    const level = parseBound(accLevel);
    const mine = Number(String(accMine).replaceAll(",", ""));
    const note = box.querySelector("[data-acc-note]");
    note.textContent = `기준 필요 명중 ${row.required_accuracy == null ? "미제공" : formatCount(row.required_accuracy)} · ${row.accuracy_per_level == null ? "낮은 레벨의 증가량은 미제공입니다." : `레벨이 낮으면 1레벨마다 ${formatCount(row.accuracy_per_level)}씩 더 필요합니다.`}`;
    const need = level.error || level.value == null ? null : neededAccuracy(row, level.value);
    if (need == null) {
      badge.textContent = "";
      badge.className = "mo-acc-badge";
      out.innerHTML = `<span class="mo-muted">${row.required_accuracy == null ? "필요 명중 자료가 없습니다." : level.value == null ? "내 레벨을 적으면 필요 명중을 계산해요." : "현재 레벨의 필요 명중을 계산할 자료가 없습니다."}</span>`;
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
    paginated: true,
    load: async (supabase, context) => {
      const response = await catalogRpc("catalog_search_monsters", {
        p_query: context.root.querySelector("[data-search]").value.trim(),
        p_drop: context.root.querySelector("[data-drop-search]").value.trim(),
        p_min: context.bounds?.min ?? null, p_max: context.bounds?.max ?? null,
        p_weak: selectedElements(context.root, "weak"), p_resist: selectedElements(context.root, "resist"),
        p_sort: sortMode, p_page: context.page,
      }, supabase);
      return { data: response.data?.rows, total: response.data?.total, error: response.error };
    },
    errorMessage: catalogError,
    columns,
    order: "level",
    ascending: true,
    emptyText: "아직 공용 몬스터 정보가 없습니다. 운영자가 도감 데이터를 준비하고 있습니다.",
    initialQuery: (new URLSearchParams(location.hash.split("?")[1] || "").get("q") || "").slice(0,100),
    searchLabel: "몬스터명",
    searchPlaceholder: "이름·몬스터 번호",
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
          <div><span class="ym-badge">모두가 함께 보는 공용 도감</span><button type="button" class="mo-ghost" data-catalog-reload>새로 확인</button></div>
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

            <section class="mo-panel mo-combo">
              <div class="mo-detail" data-mo-detail><p class="mo-muted">몬스터를 고르면 자세히 보여 줘요.</p></div>
              <span class="mo-combo-rule" aria-hidden="true"></span>
              <div class="mo-drops-panel" data-mo-drops aria-live="polite"><p class="mo-muted">몬스터를 고르면 드랍 아이템을 보여 줘요.</p></div>
            </section>
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
            <span class="mo-art element-chip" data-element="${escapeHtml(el)}">${catalogMonsterImage(row) || `<b>${escapeHtml(initial(row.name))}</b>`}<span class="mo-lv">Lv.${row.level == null ? "-" : escapeHtml(formatCount(row.level))}</span>${accuracy != null ? `<span class="mo-acc" title="내 레벨 기준 필요 명중">명중 ${num(accuracy)}</span>` : ""}</span>
            <span class="mo-name"><strong>${escapeHtml(row.name)}</strong></span>
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
    afterPaint(rows, context = {}) {
      const count = root.querySelector("[data-mo-count]");
      if (count) count.textContent = rows.length ? `전체 ${context.total ?? rows.length}마리 · 현재 ${rows.length}마리${sortMode === "eff" ? " · 1 EXP당 HP가 낮을수록 사냥 효율이 좋아요" : ""}` : "";
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
        if (event.target.closest("[data-catalog-reload]")) { clearCatalogCache(); dropsCache.clear(); repaint(); return; }
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
