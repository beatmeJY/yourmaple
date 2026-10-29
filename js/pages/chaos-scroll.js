import { CHAOS_STATS, DEFAULT_CHAOS, applyChaos, checkChaosTable, statDiff } from "../chaos-calc.js";
import { escapeHtml, formatCount } from "../format.js";
import { burstAt, sfx } from "../effects.js";
import { notify } from "../toast.js";
import { catalogRpc } from "../catalog-api.js";
import { catalogError } from "../catalog.js";
import { catalogImage, mountCatalogImageFallback } from "../catalog-image.js";
import { getSupabase } from "../supabase-client.js";
import { nameMatchRank } from "../search-match.js";

// 혼돈의 주문서 한 장씩 바르기(연습). 공용 도감 장비를 고르면 기본 옵션·업그레이드 횟수로 채우고, 직접 고칠 수도 있다.
// 저장은 이 기기에만(편의용).
const STORE_KEY = "maple-note-chaos-scroll";
// 혼돈의 주문서 60%를 쓸 수 있는 장비(아이템 설명 기준, 2026-10-30 사용자 지정). 도감 소분류 이름 → 화면 이름.
const CHAOS_TYPES = {
  Pendant: "펜던트",
  Belt: "벨트",
  Ring: "반지",
  "Face Accessory": "얼굴장식",
  "Eye Accessory": "눈장식",
  "Shoulder Accessory": "어깨장식",
  Shoulder: "어깨장식",
};
const MAX_SLOTS = 99;

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function saveStore(value) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(value));
  } catch {
    // 저장이 막혀도 화면은 그대로 쓴다.
  }
}

function signed(value) {
  return value > 0 ? `+${formatCount(value)}` : value < 0 ? `−${formatCount(-value)}` : "±0";
}

function cloneTable(table) {
  return { successRate: table.successRate, deltas: table.deltas.map((delta) => ({ ...delta })) };
}

export function render(root) {
  mountCatalogImageFallback(root);
  const stored = loadStore();
  let picked = stored.picked ?? null; // 도감에서 고른 장비 { id, name, image_url, label }
  let searchId = 0;
  let searchTimer = 0;
  let table = stored.table && checkChaosTable(stored.table).ok ? cloneTable(stored.table) : cloneTable(DEFAULT_CHAOS);
  let start = null; // { name, slots, stats }
  let current = null;
  let history = []; // [{ n, success, changes, before }]
  let lastChanges = new Map();
  let autoTimer = 0;

  const statInputs = CHAOS_STATS.map(({ key, label, scale }) => `<label class="cs-stat-input"><span>${escapeHtml(label)}${scale ? ` <small>×${scale}</small>` : ""}<em data-range="${key}"></em></span><input data-stat="${key}" inputmode="numeric" autocomplete="off" placeholder="-" value="${escapeHtml(stored.stats?.[key] ?? "")}" /></label>`).join("");

  root.innerHTML = `
    <div class="cs-page">
      <header class="page-header cs-head">
        <img class="cs-head-icon" src="img/chaos-scroll.png" alt="" width="60" height="60" />
        <div>
          <p class="trade-kicker">강화</p>
          <h1>혼돈의 주문서</h1>
          <p>내 아이템 능력치를 적고 한 장씩 발라 봐요. 실제 강화가 아닌 연습이에요.</p>
        </div>
      </header>
      <div class="cs-layout">
        <section class="cs-panel cs-setup ym-glass" aria-labelledby="cs-setup-title">
          <h2 id="cs-setup-title">내 아이템</h2>
          <div class="cs-pick">
            <label class="cs-field"><span>도감에서 장비 고르기</span><input data-item-search type="search" autocomplete="off" placeholder="이름 일부로 좁히기 (예: 혼목)" /></label>
            <p class="cs-hint">혼돈의 주문서는 펜던트·벨트·반지·얼굴장식·눈장식·어깨장식에만 쓸 수 있어서, 이 중 업그레이드 가능 횟수가 있는 장비만 보여요.</p>
            <div class="cs-pick-results" data-item-results role="listbox" aria-label="장비 검색 결과"></div>
            <div class="cs-picked" data-item-picked></div>
          </div>
          <label class="cs-field"><span>아이템 이름 <small>선택</small></span><input data-item-name maxlength="40" autocomplete="off" placeholder="예: 노가다 목장갑" value="${escapeHtml(stored.name ?? "")}" /></label>
          <label class="cs-field"><span>업그레이드 가능 횟수</span><input data-item-slots inputmode="numeric" autocomplete="off" placeholder="0" value="${escapeHtml(stored.slots ?? "")}" /></label>
          <p class="cs-hint">장비를 고르면 도감의 기본 옵션이 채워져요. 내 아이템과 다르면 고쳐 주세요(칸 옆 숫자는 가능 범위). 비우거나 0인 능력치는 혼돈의 주문서로 바뀌지 않아요.</p>
          <div class="cs-stat-grid">${statInputs}</div>
          <button type="button" class="cs-start" data-start>이 상태로 시작</button>
        </section>

        <section class="cs-panel cs-stage ym-glass" aria-labelledby="cs-stage-title" data-stage>
          <h2 id="cs-stage-title" class="sr-only">바르기</h2>
          <div class="cs-tooltip" data-tooltip></div>
          <div class="cs-result" data-result aria-live="polite"></div>
          <button type="button" class="cs-scroll" data-roll disabled>
            <span class="cs-scroll-orb" aria-hidden="true"><i></i><img src="img/chaos-scroll.png" alt="" width="60" height="60" /></span>
            <span class="cs-scroll-copy"><strong>혼돈의 주문서 바르기</strong><small data-roll-rate>성공 ${escapeHtml(table.successRate)}%</small></span>
          </button>
          <div class="cs-stage-actions">
            <button type="button" class="cs-ghost" data-auto disabled>남은 횟수 모두 바르기</button>
            <button type="button" class="cs-ghost" data-undo disabled>한 장 되돌리기</button>
            <button type="button" class="cs-ghost" data-reset disabled>처음 상태로</button>
          </div>
        </section>

        <section class="cs-panel cs-log ym-glass" aria-labelledby="cs-log-title">
          <div class="cs-log-head"><h2 id="cs-log-title">바른 기록</h2><span data-log-count></span></div>
          <div class="cs-diff" data-diff></div>
          <ol class="cs-log-list" data-log></ol>
        </section>
      </div>

      <details class="cs-odds ym-glass" data-odds>
        <summary><span>확률 설정</span><small>본섭 공개 확률 가정</small></summary>
        <p class="cs-hint">메이플랜드 공식 확률은 확인하지 못했어요. 메이플스토리(본섭)에 공개된 것으로 알려진 표를 기본값으로 썼어요. 실패하면 업그레이드 가능 횟수만 1 줄고, 성공하면 붙어 있는 능력치마다 따로 굴려요(HP·MP는 10배, 0 이하가 되면 사라짐).</p>
        <label class="cs-field cs-rate"><span>성공률</span><input data-success inputmode="decimal" autocomplete="off" /><small>%</small></label>
        <div class="cs-delta-grid" data-delta-grid></div>
        <div class="cs-odds-foot"><span data-delta-sum></span><button type="button" class="cs-ghost" data-odds-reset>기본값으로</button></div>
      </details>
    </div>
  `;

  const tooltip = root.querySelector("[data-tooltip]");
  const result = root.querySelector("[data-result]");
  const rollButton = root.querySelector("[data-roll]");
  const autoButton = root.querySelector("[data-auto]");
  const undoButton = root.querySelector("[data-undo]");
  const resetButton = root.querySelector("[data-reset]");
  const log = root.querySelector("[data-log]");
  const diffBox = root.querySelector("[data-diff]");

  function readSetup() {
    const name = root.querySelector("[data-item-name]").value.trim();
    const slotsRaw = root.querySelector("[data-item-slots]").value.trim();
    const slots = Number(slotsRaw.replaceAll(",", ""));
    if (!slotsRaw || !Number.isInteger(slots) || slots < 1 || slots > MAX_SLOTS) return { error: `업그레이드 가능 횟수를 1~${MAX_SLOTS} 사이로 적어 주세요.` };
    const stats = {};
    const raw = {};
    for (const input of root.querySelectorAll("[data-stat]")) {
      const text = input.value.trim().replaceAll(",", "");
      if (!text) continue;
      const value = Number(text);
      const label = CHAOS_STATS.find((stat) => stat.key === input.dataset.stat).label;
      if (!Number.isInteger(value) || value < 0 || value > 99999) return { error: `${label}는 0 이상의 정수로 적어 주세요.` };
      raw[input.dataset.stat] = text;
      if (value > 0) stats[input.dataset.stat] = value;
    }
    if (!Object.keys(stats).length) return { error: "능력치를 하나 이상 적어 주세요. 혼돈의 주문서는 붙어 있는 능력치만 바꿔요." };
    return { value: { name, slots, stats }, raw };
  }

  function persist(extra = {}) {
    saveStore({ ...loadStore(), ...extra });
  }

  function statLine({ key, label }) {
    const now = current?.stats[key];
    const was = start?.stats[key];
    if (!(was > 0) && !(now > 0)) return "";
    const change = lastChanges.get(key);
    const badge = change ? `<em class="cs-delta ${change.delta > 0 ? "is-up" : change.delta < 0 ? "is-down" : "is-same"}">${escapeHtml(signed(change.delta))}</em>` : "";
    if (!(now > 0)) return `<li class="is-gone"><span>${escapeHtml(label)}</span><b>사라짐</b>${badge}</li>`;
    return `<li${change ? ' class="is-changed"' : ""}><span>${escapeHtml(label)}</span><b>+${escapeHtml(formatCount(now))}</b>${badge}</li>`;
  }

  function paintTooltip() {
    if (!current) {
      tooltip.innerHTML = `<p class="cs-empty">왼쪽에 아이템 능력치와 업그레이드 가능 횟수를 적고 <b>이 상태로 시작</b>을 눌러 주세요.</p>`;
      return;
    }
    const used = start.slots - current.slots;
    tooltip.innerHTML = `
      ${start.image ? `<div class="cs-tip-art">${start.image}</div>` : ""}
      <div class="cs-tip-name">${escapeHtml(start.name || "내 아이템")}${history.filter((item) => item.success).length ? ` <small>(+${history.filter((item) => item.success).length})</small>` : ""}</div>
      <ul class="cs-tip-stats">${CHAOS_STATS.map(statLine).join("")}</ul>
      <div class="cs-tip-slots"><span>업그레이드 가능 횟수</span><b>${escapeHtml(formatCount(current.slots))}</b><small>${used ? `${formatCount(used)}장 바름` : ""}</small></div>`;
  }

  function paintLog() {
    root.querySelector("[data-log-count]").textContent = history.length
      ? `${formatCount(history.length)}장 · 성공 ${formatCount(history.filter((item) => item.success).length)} · 실패 ${formatCount(history.filter((item) => !item.success).length)}`
      : "";
    log.innerHTML = history.length
      ? history.slice().reverse().map((item) => `<li class="${item.success ? "is-success" : "is-fail"}"><span class="cs-log-n">#${item.n}</span><b>${item.success ? "성공" : "실패"}</b><span class="cs-log-text">${item.success ? item.changes.map((change) => `${escapeHtml(CHAOS_STATS.find((stat) => stat.key === change.key).label)} ${escapeHtml(change.gone ? "사라짐" : signed(change.delta))}`).join(" · ") || "바뀐 능력치 없음" : "업그레이드 가능 횟수만 줄었어요"}</span></li>`).join("")
      : `<li class="cs-log-empty">아직 바른 주문서가 없어요.</li>`;
    diffBox.innerHTML = current && history.length
      ? statDiff(start, current).map((row) => `<span class="cs-chip ${row.diff > 0 ? "is-up" : row.diff < 0 ? "is-down" : ""}"><small>${escapeHtml(row.label)}</small><b>${escapeHtml(formatCount(row.start))} → ${row.now ? escapeHtml(formatCount(row.now)) : "사라짐"}</b><em>${escapeHtml(signed(row.diff))}</em></span>`).join("")
      : "";
  }

  function paintButtons() {
    const can = Boolean(current) && current.slots > 0 && checkChaosTable(table).ok;
    rollButton.disabled = !can;
    autoButton.disabled = !can;
    autoButton.textContent = autoTimer ? "멈추기" : "남은 횟수 모두 바르기";
    if (autoTimer) autoButton.disabled = false;
    undoButton.disabled = !history.length || Boolean(autoTimer);
    resetButton.disabled = !history.length || Boolean(autoTimer);
    rollButton.classList.toggle("is-empty", Boolean(current) && current.slots === 0);
  }

  // 쓸 수 있는 장비만 한 번 불러와(수십 개) 이름으로 화면에서 거른다. 늦게 온 응답은 버린다.
  const results = root.querySelector("[data-item-results]");
  let allowedItems = null;
  const typeName = (item) => CHAOS_TYPES[item.subcategory] ?? item.subcategory ?? "";
  // 이름이 같은 장비(예: 옵션만 다른 루돌프의 빨간코)를 구분하게 붙어 있는 옵션을 짧게 적는다.
  const optionText = (item) => CHAOS_STATS.filter(({ key }) => item.base_options?.[key] > 0).slice(0, 3).map(({ key, label }) => `${label} ${formatCount(item.base_options[key])}`).join(" ");
  async function loadAllowed() {
    if (allowedItems) return allowedItems;
    const supabase = await getSupabase();
    const out = await supabase.from("catalog_items")
      .select("id,name,category,subcategory,required_level,image_url,base_options")
      .in("subcategory", Object.keys(CHAOS_TYPES))
      // 같은 소분류를 쓰는 주문서(소비)는 빼고 장비만
      .in("category", ["장비", "방어구", "무기", "Equip"])
      .order("required_level", { ascending: true })
      .order("name", { ascending: true });
    if (out.error) return out;
    // 업그레이드 가능 횟수가 남아 있는 장비만(0이거나 없으면 주문서를 바를 수 없다)
    allowedItems = (out.data ?? []).filter((row) => Number(row.base_options?.remaining_upgrades) > 0);
    return allowedItems;
  }
  async function searchItems(query) {
    const request = ++searchId;
    if (!allowedItems) results.innerHTML = `<p class="cs-hint">장비를 불러오는 중…</p>`;
    const out = await loadAllowed();
    if (request !== searchId || !root.isConnected) return;
    if (out.error) {
      results.innerHTML = `<p class="cs-hint">${escapeHtml(catalogError(out.error))}</p>`;
      return;
    }
    // 아이템 검색과 같은 규칙(글자 순서·별명). 분류 이름(예: 벨트)으로도 좁힌다.
    const rows = out
      .map((row) => ({ row, rank: !query ? 0 : nameMatchRank(row.name, query) ?? (typeName(row).includes(query) ? 2 : null) }))
      .filter((item) => item.rank != null)
      .sort((left, right) => left.rank - right.rank)
      .map((item) => item.row);
    results.innerHTML = rows.length
      ? rows.map((row, index) => `<button type="button" class="cs-pick-row${row.id === picked?.id ? " is-on" : ""}" data-pick-item="${escapeHtml(row.id)}" role="option" aria-selected="${row.id === picked?.id}" style="--i:${Math.min(index, 12)}">
          <span class="cs-pick-art">${catalogImage(row.image_url, "cs-pick-image", 32) || `<i aria-hidden="true">${escapeHtml([...row.name][0] ?? "?")}</i>`}</span>
          <span class="cs-pick-copy"><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml([typeName(row), row.required_level == null ? "" : `Lv.${row.required_level}`, optionText(row)].filter(Boolean).join(" · "))}</small></span>
        </button>`).join("")
      : `<p class="cs-hint">${query ? "이름이 맞는 장비가 없어요." : "도감에 쓸 수 있는 장비가 아직 없어요."}</p>`;
  }

  function paintPicked() {
    const box = root.querySelector("[data-item-picked]");
    box.innerHTML = picked
      ? `<span class="cs-pick-art">${catalogImage(picked.image_url, "cs-pick-image", 32) || `<i aria-hidden="true">${escapeHtml([...picked.name][0] ?? "?")}</i>`}</span><span class="cs-pick-copy"><strong>${escapeHtml(picked.name)}</strong><small>${escapeHtml(picked.label || "도감 기본 옵션")}</small></span><button type="button" class="cs-ghost" data-unpick>지우기</button>`
      : "";
    box.hidden = !picked;
  }

  function paintRanges(ranges = picked?.ranges ?? {}) {
    for (const node of root.querySelectorAll("[data-range]")) {
      const range = ranges[node.dataset.range];
      node.textContent = range ? `${formatCount(range[0])}~${formatCount(range[1])}` : "";
    }
  }

  async function pickItem(id) {
    const request = ++searchId;
    const out = await catalogRpc("catalog_item_detail", { p_id: id });
    if (request !== searchId || !root.isConnected) return;
    if (out.error || !out.data?.item) {
      notify(out.error ? catalogError(out.error) : "아이템 정보를 찾지 못했어요.", "error");
      return;
    }
    const { item, stats = [] } = out.data;
    const byKey = new Map(stats.map((stat) => [stat.stat_key, stat]));
    // 칸을 채우기 전에 확인한다(막힌 장비를 골라도 적어 둔 값이 지워지지 않게).
    if (!CHAOS_TYPES[item.subcategory]) {
      notify("혼돈의 주문서를 쓸 수 없는 장비예요.", "error");
      return;
    }
    if (!(Number(byKey.get("remaining_upgrades")?.base_value) > 0)) {
      notify("업그레이드 가능 횟수가 없는 장비라 혼돈의 주문서를 바를 수 없어요.", "error");
      return;
    }
    root.querySelector("[data-item-name]").value = item.name;
    const slots = byKey.get("remaining_upgrades")?.base_value;
    root.querySelector("[data-item-slots]").value = slots == null ? "" : String(slots);
    const ranges = {};
    for (const input of root.querySelectorAll("[data-stat]")) {
      const stat = byKey.get(input.dataset.stat);
      input.value = stat?.base_value ? String(stat.base_value) : "";
      if (stat?.minimum_value != null && stat.maximum_value != null && stat.minimum_value !== stat.maximum_value) ranges[input.dataset.stat] = [stat.minimum_value, stat.maximum_value];
    }
    picked = { id: item.id, name: item.name, image_url: item.image_url ?? null, label: [typeName(item), item.required_level == null ? "" : `Lv.${item.required_level}`].filter(Boolean).join(" · "), ranges };
    root.querySelector("[data-item-search]").value = "";
    void searchItems("");
    paintPicked();
    paintRanges();
    persist({ picked });
    sfx("tick");
    if (!stats.some((stat) => stat.stat_key !== "remaining_upgrades" && stat.base_value > 0)) notify("도감에 붙어 있는 능력치가 없어요. 내 아이템 능력치를 직접 적어 주세요.", "info");
  }

  function paint() {
    paintTooltip();
    paintLog();
    paintButtons();
  }

  function showResult(success, changes) {
    const ups = changes.filter((change) => change.delta > 0).length;
    const downs = changes.filter((change) => change.delta < 0 || change.gone).length;
    result.className = `cs-result ${success ? "is-success" : "is-fail"}`;
    result.innerHTML = success
      ? `<strong>성공!</strong><span>${changes.length ? `오른 능력치 ${ups}개 · 내린 능력치 ${downs}개` : "바뀐 능력치가 없어요"}</span>`
      : `<strong>실패</strong><span>업그레이드 가능 횟수만 1 줄었어요</span>`;
    // 같은 결과가 연달아 나와도 연출이 다시 돌게 한 프레임 비운다.
    result.style.animation = "none";
    void result.offsetWidth;
    result.style.animation = "";
  }

  function rollOnce() {
    const check = checkChaosTable(table);
    if (check.error) {
      notify(check.error, "error");
      return false;
    }
    const out = applyChaos(current, table);
    if (out.error) {
      notify(out.error, "info");
      return false;
    }
    history.push({ n: history.length + 1, success: out.success, changes: out.changes, before: current });
    current = out.item;
    lastChanges = new Map(out.changes.map((change) => [change.key, change]));
    paint();
    showResult(out.success, out.changes);
    const stage = root.querySelector("[data-stage]");
    stage.classList.remove("is-success", "is-fail");
    void stage.offsetWidth;
    stage.classList.add(out.success ? "is-success" : "is-fail");
    if (out.success) {
      sfx(out.changes.some((change) => change.delta > 0) ? "mid" : "low");
      burstAt(rollButton.querySelector(".cs-scroll-orb"), ["#c9a6ff", "#ffe28a", "#8ff0c4", "#ffffff"], 20, 0.9);
    } else sfx("fail");
    return true;
  }

  function stopAuto() {
    window.clearTimeout(autoTimer);
    autoTimer = 0;
    paintButtons();
  }

  function startItem() {
    const read = readSetup();
    if (read.error) {
      notify(read.error, "error");
      return;
    }
    stopAuto();
    start = { ...read.value, image: picked?.image_url && picked.name === read.value.name ? catalogImage(picked.image_url, "cs-tip-image", 64) : "" };
    current = { slots: start.slots, stats: { ...start.stats } };
    history = [];
    lastChanges = new Map();
    result.className = "cs-result";
    result.innerHTML = "";
    persist({ name: start.name, slots: String(start.slots), stats: read.raw });
    sfx("tick");
    paint();
  }

  // 확률 설정
  const successInput = root.querySelector("[data-success]");
  const deltaGrid = root.querySelector("[data-delta-grid]");
  function paintOdds() {
    successInput.value = String(table.successRate);
    const max = Math.max(...table.deltas.map((delta) => Number(delta.percent) || 0), 1);
    deltaGrid.innerHTML = table.deltas.map((delta, index) => `<label class="cs-delta-cell ${delta.value > 0 ? "is-up" : delta.value < 0 ? "is-down" : ""}"><span class="cs-delta-bar"><i style="--h:${((Number(delta.percent) || 0) / max) * 100}%"></i></span><b>${escapeHtml(signed(delta.value))}</b><input data-delta="${index}" inputmode="decimal" autocomplete="off" value="${escapeHtml(delta.percent)}" aria-label="변화량 ${escapeHtml(signed(delta.value))} 확률(%)" /></label>`).join("");
    paintOddsSum();
  }
  function paintOddsSum() {
    const check = checkChaosTable(table);
    const sum = table.deltas.reduce((total, delta) => total + (Number(delta.percent) || 0), 0);
    const node = root.querySelector("[data-delta-sum]");
    node.textContent = check.error ? check.error : `합 ${Math.round(sum * 100) / 100}% · 성공 ${table.successRate}%`;
    node.className = check.error ? "is-error" : "";
    root.querySelector("[data-roll-rate]").textContent = `성공 ${table.successRate}%`;
    paintButtons();
  }

  root.addEventListener("click", (event) => {
    const pickButton = event.target.closest("[data-pick-item]");
    if (pickButton) {
      pickItem(pickButton.dataset.pickItem);
      return;
    }
    if (event.target.closest("[data-unpick]")) {
      picked = null;
      persist({ picked: null });
      paintPicked();
      paintRanges({});
      return;
    }
    if (event.target.closest("[data-start]")) {
      startItem();
      return;
    }
    if (event.target.closest("[data-roll]") && !rollButton.disabled) {
      rollOnce();
      return;
    }
    if (event.target.closest("[data-auto]")) {
      if (autoTimer) {
        stopAuto();
        return;
      }
      const step = () => {
        autoTimer = 0;
        if (!root.isConnected || !current || current.slots < 1 || !rollOnce()) {
          paintButtons();
          return;
        }
        if (current.slots > 0) autoTimer = window.setTimeout(step, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 60 : 420);
        paintButtons();
      };
      step();
      return;
    }
    if (event.target.closest("[data-undo]") && history.length) {
      const last = history.pop();
      current = last.before;
      lastChanges = new Map();
      result.className = "cs-result";
      result.innerHTML = `<strong>되돌림</strong><span>#${last.n} 이전 상태로 돌아왔어요</span>`;
      sfx("uncheck");
      paint();
      return;
    }
    if (event.target.closest("[data-reset]") && start) {
      current = { slots: start.slots, stats: { ...start.stats } };
      history = [];
      lastChanges = new Map();
      result.className = "cs-result";
      result.innerHTML = "";
      sfx("uncheck");
      paint();
      return;
    }
    if (event.target.closest("[data-odds-reset]")) {
      table = cloneTable(DEFAULT_CHAOS);
      persist({ table: null });
      paintOdds();
      sfx("tick");
    }
  });

  root.addEventListener("input", (event) => {
    if (event.target.matches("[data-item-search]")) {
      window.clearTimeout(searchTimer);
      const query = event.target.value.trim();
      searchTimer = window.setTimeout(() => searchItems(query), 250);
      return;
    }
    if (event.target.matches("[data-success]")) {
      table.successRate = Number(event.target.value.replace(",", "."));
    } else if (event.target.matches("[data-delta]")) {
      table.deltas[Number(event.target.dataset.delta)].percent = Number(event.target.value.replace(",", "."));
    } else return;
    paintOddsSum();
    if (checkChaosTable(table).ok) persist({ table: cloneTable(table) });
  });
  root.addEventListener("change", (event) => {
    if (event.target.matches("[data-delta]")) paintOdds();
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing && event.target.matches("[data-item-search]")) {
      event.preventDefault();
      root.querySelector("[data-pick-item]")?.click();
      return;
    }
    if (event.key === "Enter" && !event.isComposing && event.target.closest(".cs-setup input")) {
      event.preventDefault();
      startItem();
    }
  });

  paintOdds();
  paintPicked();
  paintRanges();
  paint();
  void searchItems("");
}
