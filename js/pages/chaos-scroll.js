import { CHAOS_STATS, DEFAULT_CHAOS, HORNTAIL_EGG_BONUS, applyChaos, chaosGrade, chaosScoreTenths, checkChaosTable, scoreText, statDiff } from "../chaos-calc.js";
import { escapeHtml, formatCount, readBig } from "../format.js";
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
// 자주 바르는 장비는 아이콘으로 바로 고른다(2026-11-01 사용자 지정). 나머지는 이름으로 찾는다.
// 도감 이름과 띄어쓰기만 달라도 맞도록 띄어쓰기를 빼고 비교한다.
const HORNTAIL_NECKLACE = "혼테일의 목걸이";
const FAVORITE_ITEMS = ["검은색 허리띠", "부보안관 은뱃지", HORNTAIL_NECKLACE, "얼음결정 페이스페인팅"];
const squash = (text) => String(text ?? "").replace(/\s+/g, "");
const isHorntailNecklace = (item) => item.subcategory === "Pendant" && squash(item.name) === squash(HORNTAIL_NECKLACE);
const eggImage = '<img src="img/horntail-egg.png" alt="" width="40" height="40" class="cs-fav-image" />';


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
  let replacedItems = 0;
  let previousScrolls = 0;
  let history = []; // [{ n, success, changes, before }]
  let lastChanges = new Map();
  let autoTimer = 0;
  let lastGrade = ""; // 등급이 바뀌는 순간에만 테두리 빛을 한 번 퍼뜨린다.
  let flashTimer = 0;

  const statInputs = CHAOS_STATS.map(({ key, label, scale }) => `<label class="cs-stat-input"><span>${escapeHtml(label)}${scale ? ` <small>×${scale}</small>` : ""}</span><em data-range="${key}"></em><input data-stat="${key}" inputmode="numeric" autocomplete="off" placeholder="-" value="${escapeHtml(stored.stats?.[key] ?? "")}" /></label>`).join("");

  root.innerHTML = `
    <div class="cs-page cs2">
      <header class="cs-head">
        <img class="cs-head-icon" src="img/chaos-scroll.png" alt="" width="56" height="56" />
        <div class="cs-head-copy">
          <p class="cs-kicker">강화</p>
          <h1>혼돈의 주문서</h1>
          <p>한 장씩 발라 보는 연습이에요. 실제 강화가 아니에요.</p>
        </div>
        <button type="button" class="cs-odds-toggle" data-odds-toggle aria-expanded="false" aria-controls="cs-odds">확률 설정 · <span data-odds-rate>성공 ${escapeHtml(table.successRate)}%</span></button>
      </header>

      <section class="cs-odds" id="cs-odds" data-odds hidden aria-label="확률 설정">
        <div class="cs-odds-top">
          <label class="cs-rate"><span>성공률</span><input data-success inputmode="decimal" autocomplete="off" /><small>%</small></label>
          <p class="cs-hint">메이플랜드 공식 확률은 확인하지 못했어요. 메이플스토리(본섭)에 공개된 것으로 알려진 표를 기본값으로 썼어요. 실패하면 업그레이드 가능 횟수만 1 줄고, 성공하면 붙어 있는 능력치마다 따로 굴려요(HP·MP는 10배, 0 이하가 되면 사라짐).</p>
        </div>
        <div class="cs-delta-grid" data-delta-grid></div>
        <div class="cs-odds-foot"><span data-delta-sum></span><button type="button" class="cs-ghost" data-odds-reset>기본값으로</button></div>
      </section>

      <div class="cs-layout">
        <section class="cs-panel cs-setup" aria-labelledby="cs-setup-title">
          <h2 id="cs-setup-title">내 아이템</h2>
          <div class="cs-search">
            <span class="ym-search-icon" aria-hidden="true"></span>
            <input data-item-search type="search" autocomplete="off" placeholder="장비 이름으로 찾기 (예: 혼목)" aria-label="장비 찾기" aria-controls="cs-results" />
            <div class="cs-pick-results" id="cs-results" data-item-results role="listbox" aria-label="장비 검색 결과" hidden></div>
          </div>
          <div class="cs-pick">
            <span class="cs-field-label">자주 쓰는 장비</span>
            <div class="cs-favs" data-favs role="group" aria-label="자주 쓰는 장비"></div>
          </div>
          <p class="cs-hint">펜던트·벨트·반지·얼굴장식·눈장식·어깨장식 중 업그레이드 가능 횟수가 있는 장비만 찾아져요.</p>
          <div class="cs-picked" data-item-picked hidden></div>
          <label class="cs-field"><span>아이템 이름 <small>선택</small></span><input data-item-name maxlength="40" autocomplete="off" placeholder="예: 노가다 목장갑" value="${escapeHtml(stored.name ?? "")}" /></label>
          <label class="cs-slots-row"><span>업그레이드 가능 횟수</span><input data-item-slots inputmode="numeric" autocomplete="off" placeholder="0" value="${escapeHtml(stored.slots ?? "")}" /></label>
          <div class="cs-stat-grid">${statInputs}</div>
          <p class="cs-hint">장비를 고르면 도감 기본 옵션으로 바로 바를 수 있어요. 내 아이템과 다르면 고친 뒤 <b>이 옵션으로 다시 시작</b>을 눌러 주세요(작은 숫자는 가능 범위). 비우거나 0인 능력치는 바뀌지 않아요.</p>
          <button type="button" class="cs-start" data-start>이 옵션으로 다시 시작</button>
        </section>

        <section class="cs-panel cs-stage" aria-labelledby="cs-stage-title" data-stage>
          <h2 id="cs-stage-title" class="sr-only">바르기</h2>
          <span class="cs-stage-glow" aria-hidden="true"></span>
          <div class="cs-tooltip" data-tooltip></div>
          <div class="cs-orb-wrap">
            <span class="cs-orb-ring" aria-hidden="true"></span>
            <button type="button" class="cs-scroll" data-roll disabled>
              <span class="cs-scroll-orb" aria-hidden="true"><img src="img/chaos-scroll.png" alt="" width="58" height="58" /></span>
              <strong>한 장 바르기</strong><small data-roll-rate>성공 ${escapeHtml(table.successRate)}%</small>
            </button>
            <div class="cs-fx" data-fx aria-hidden="true"></div>
          </div>
          <div class="cs-result sr-only" data-result aria-live="polite"></div>
          <div class="cs-stage-actions">
            <button type="button" class="cs-ghost" data-auto disabled>남은 횟수 모두 바르기</button>
            <button type="button" class="cs-ghost" data-undo disabled>한 장 되돌리기</button>
            <button type="button" class="cs-ghost cs-next" data-next-item disabled>다음 장비 가져오기</button>
            <button type="button" class="cs-ghost" data-reset disabled>시도 전체 초기화</button>
          </div>
        </section>

        <section class="cs-panel cs-log" aria-labelledby="cs-log-title">
          <div class="cs-cost">
            <div class="cs-log-head"><h2>누적 비용</h2></div>
            <div class="cs-cost-prices">
              <label class="cs-field"><span>장비 한 개 가격</span><input data-cost="item" inputmode="numeric" autocomplete="off" placeholder="메소" value="${escapeHtml(stored.prices?.item ?? "")}" /></label>
              <label class="cs-field"><span>혼줌 한 장 가격</span><input data-cost="scroll" inputmode="numeric" autocomplete="off" placeholder="메소" value="${escapeHtml(stored.prices?.scroll ?? "")}" /></label>
            </div>
            <div class="cs-cost-total" aria-live="polite"><small data-cost-count></small><strong data-cost-total></strong></div>
            <p class="cs-hint" data-cost-hint></p>
          </div>
          <div class="cs-log-head"><h2 id="cs-log-title">현재 장비 기록</h2><span data-log-count></span></div>
          <div class="cs-log-stats" data-log-stats></div>
          <div class="cs-diff" data-diff></div>
          <ol class="cs-log-list" data-log></ol>
        </section>
      </div>
    </div>
  `;

  const tooltip = root.querySelector("[data-tooltip]");
  const result = root.querySelector("[data-result]");
  const rollButton = root.querySelector("[data-roll]");
  const autoButton = root.querySelector("[data-auto]");
  const undoButton = root.querySelector("[data-undo]");
  const nextButton = root.querySelector("[data-next-item]");
  const itemPrice = root.querySelector('[data-cost="item"]');
  const scrollPrice = root.querySelector('[data-cost="scroll"]');
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
    const tone = change ? (change.gone || change.delta < 0 ? "is-down" : change.delta > 0 ? "is-up" : "is-same") : "";
    const badge = change && !change.gone ? `<em class="cs-delta ${tone}">${escapeHtml(signed(change.delta))}</em>` : `<em class="cs-delta is-blank"></em>`;
    if (!(now > 0)) return `<li class="is-gone${change ? " is-changed is-down" : ""}"><span>${escapeHtml(label)}</span><b>사라짐</b>${badge}</li>`;
    return `<li class="${change ? `is-changed ${tone}` : ""}"><span>${escapeHtml(label)}</span><b>+${escapeHtml(formatCount(now))}</b>${badge}</li>`;
  }

  function gradeOf(state, wins) {
    const tenths = chaosScoreTenths(start.base, state.stats);
    return { tenths, grade: chaosGrade(tenths, wins) };
  }

  function paintGrade() {
    if (!current) {
      tooltip.removeAttribute("data-grade");
      tooltip.style.removeProperty("--grade");
      lastGrade = "";
      return null;
    }
    const wins = history.filter((item) => item.success).length;
    const now = gradeOf(current, wins);
    tooltip.dataset.grade = now.grade.key;
    tooltip.style.setProperty("--grade", now.grade.color);
    if (lastGrade && lastGrade !== now.grade.key && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      tooltip.classList.remove("is-grade-flash");
      void tooltip.offsetWidth;
      tooltip.classList.add("is-grade-flash");
      window.clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => tooltip.classList.remove("is-grade-flash"), 1100);
    }
    lastGrade = now.grade.key;
    return now;
  }

  function paintTooltip() {
    const graded = paintGrade();
    if (!current) {
      tooltip.innerHTML = `<p class="cs-empty">왼쪽에서 장비를 고르면 바로 바를 수 있어요. 직접 적었다면 <b>이 옵션으로 다시 시작</b>을 눌러 주세요.</p>`;
      return;
    }
    const wins = history.filter((item) => item.success).length;
    // 바른 칸(성공 금색·실패 빨강)과 남은 칸(빈 테두리)을 차례로 보여 준다.
    const pips = [
      ...history.map((item) => `<i class="${item.success ? "is-ok" : "is-fail"}" title="${item.n}장째 ${item.success ? "성공" : "실패"}"></i>`),
      ...Array.from({ length: current.slots }, () => `<i title="남은 횟수"></i>`),
    ].join("");
    tooltip.innerHTML = `
      <div class="cs-tip-top">
        ${start.image ? `<div class="cs-tip-art">${start.image}</div>` : ""}
        <div class="cs-tip-head"><span class="cs-grade" title="${escapeHtml(`${start.baseLabel} 대비 점수 · HP·MP는 10당 1점`)}"><i aria-hidden="true"></i>${escapeHtml(start.baseLabel)} 대비 <b>${escapeHtml(scoreText(graded.tenths))}</b><small>${escapeHtml(graded.grade.name)}</small></span><div class="cs-tip-name${wins ? " is-up" : ""}">${escapeHtml(start.name || "내 아이템")}${wins ? ` <small>(+${wins})</small>` : ""}</div>${start.label ? `<div class="cs-tip-meta">${escapeHtml(start.label)}</div>` : ""}</div>
      </div>
      <ul class="cs-tip-stats">${CHAOS_STATS.map(statLine).join("")}</ul>
      <div class="cs-tip-slots"><span>업그레이드 가능 횟수</span><b>${escapeHtml(formatCount(current.slots))} / ${escapeHtml(formatCount(start.slots))}</b></div>
      <div class="cs-pips" aria-hidden="true">${pips}</div>
      <span class="cs-tip-fx" data-tip-fx></span>`;
  }

  const changeChip = (change) => change.gone
    ? `<span class="cs-chip is-down">${escapeHtml(CHAOS_STATS.find((stat) => stat.key === change.key).label)} 사라짐</span>`
    : `<span class="cs-chip ${change.delta > 0 ? "is-up" : change.delta < 0 ? "is-down" : ""}">${escapeHtml(CHAOS_STATS.find((stat) => stat.key === change.key).label)} ${escapeHtml(signed(change.delta))}</span>`;

  function paintLog() {
    const wins = history.filter((item) => item.success).length;
    root.querySelector("[data-log-count]").textContent = history.length ? `${formatCount(history.length)}장 사용` : "";
    // 합계 변화는 HP·MP를 10으로 나눠 다른 능력치와 같은 단위로 더한다.
    const rows = current ? statDiff(start, current) : [];
    const net = rows.reduce((sum, row) => sum + row.diff / (CHAOS_STATS.find((stat) => stat.key === row.key)?.scale || 1), 0);
    root.querySelector("[data-log-stats]").innerHTML = `
      <div class="is-ok"><small>성공</small><b>${formatCount(wins)}</b></div>
      <div class="is-fail"><small>실패</small><b>${formatCount(history.length - wins)}</b></div>
      <div class="${net > 0 ? "is-up" : net < 0 ? "is-down" : ""}"><small>${start?.egg ? "혼줌 합계 변화" : "합계 변화"}</small><b>${escapeHtml(signed(Math.round(net)))}</b></div>`;
    // 줄마다 그 장을 바른 뒤의 등급 색 점(정옵 대비 점수).
    let winsSoFar = 0;
    const gradeAfter = history.map((item, index) => {
      if (item.success) winsSoFar += 1;
      return gradeOf(history[index + 1]?.before ?? current, winsSoFar);
    });
    log.innerHTML = history.length
      ? history.slice().reverse().map((item) => `<li class="${item.success ? "is-success" : "is-fail"}"><div class="cs-log-row"><span class="cs-log-n">${item.n}장째</span><b>${item.success ? "성공" : "실패"}</b><span class="cs-log-grade" style="--grade:${gradeAfter[item.n - 1].grade.color}" title="${escapeHtml(`${gradeAfter[item.n - 1].grade.name} · ${scoreText(gradeAfter[item.n - 1].tenths)}`)}"><i aria-hidden="true"></i>${escapeHtml(scoreText(gradeAfter[item.n - 1].tenths))}</span></div><div class="cs-log-chips">${item.success ? item.changes.map(changeChip).join("") || `<span class="cs-chip">바뀐 능력치 없음</span>` : `<span class="cs-chip">능력치 변화 없음</span>`}</div></li>`).join("")
      : `<li class="cs-log-empty">가운데 주문서를 눌러 바르기 시작해요</li>`;
    diffBox.innerHTML = current && (start.egg || history.length)
      ? `<p class="cs-field-label">${start.egg ? "알 적용 옵션 대비" : "시작 대비"}</p>${rows.map((row) => `<div class="cs-diff-row ${row.diff > 0 ? "is-up" : row.diff < 0 ? "is-down" : ""}"><span>${escapeHtml(row.label)}</span><small>${escapeHtml(formatCount(row.start))} → ${row.now ? escapeHtml(formatCount(row.now)) : "사라짐"}</small><b>${escapeHtml(signed(row.diff))}</b></div>`).join("")}`
      : "";
  }

  function paintCost() {
    const items = start ? replacedItems + 1 : 0;
    const scrolls = previousScrolls + history.length;
    const item = readBig(itemPrice.value, "장비 가격");
    const scroll = readBig(scrollPrice.value, "혼줌 가격");
    itemPrice.setAttribute("aria-invalid", String(Boolean(item.error)));
    scrollPrice.setAttribute("aria-invalid", String(Boolean(scroll.error)));
    const error = item.error || scroll.error;
    const missing = (items > 0 && item.value == null) || (scrolls > 0 && scroll.value == null);
    const total = BigInt(items) * (item.value ?? 0n) + BigInt(scrolls) * (scroll.value ?? 0n);
    root.querySelector("[data-cost-count]").textContent = `장비 ${formatCount(items)}개 · 혼줌 ${formatCount(scrolls)}장`;
    root.querySelector("[data-cost-total]").textContent = error || missing ? "—" : `${formatCount(total)} 메소`;
    root.querySelector("[data-cost-hint]").textContent = error || (missing ? "사용한 장비와 주문서의 단가를 입력해 주세요." : "입력한 단가를 지금까지 사용한 수량에 적용해요.");
  }

  function paintButtons() {
    const can = Boolean(current) && current.slots > 0 && checkChaosTable(table).ok;
    rollButton.disabled = !can || Boolean(autoTimer);
    autoButton.disabled = !can;
    autoButton.textContent = autoTimer ? "멈추기" : "남은 횟수 모두 바르기";
    if (autoTimer) autoButton.disabled = false;
    undoButton.disabled = !history.length || Boolean(autoTimer);
    nextButton.disabled = !history.length || Boolean(autoTimer);
    resetButton.disabled = (!history.length && !replacedItems) || Boolean(autoTimer);
    root.querySelector("[data-stage]").classList.toggle("is-done", Boolean(current) && current.slots === 0);
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
  // 자주 쓰는 장비 아이콘. 도감에 없으면(이름이 바뀌었거나 아직 미등록) 그 칸만 뺀다.
  const favs = root.querySelector("[data-favs]");
  function paintFavorites() {
    if (!allowedItems) {
      favs.innerHTML = `<p class="cs-hint">장비를 불러오는 중…</p>`;
      return;
    }
    const rows = FAVORITE_ITEMS.map((name) => allowedItems.find((row) => squash(row.name) === squash(name))).filter(Boolean);
    const choices = rows.flatMap((row) => isHorntailNecklace(row) && Number(row.base_options.remaining_upgrades) > 1
      ? [{ row, egg: false }, { row, egg: true }]
      : [{ row, egg: false }]);
    favs.innerHTML = choices.length
      ? choices.map(({ row, egg }, index) => {
          const active = row.id === picked?.id && egg === Boolean(picked.egg);
          const name = egg ? `${row.name} (알 적용)` : row.name;
          const art = egg ? eggImage : catalogImage(row.image_url, "cs-fav-image", 40) || `<i aria-hidden="true">${escapeHtml([...row.name][0] ?? "?")}</i>`;
          const title = egg ? "알 1회 적용 · 성공 100% · 업그레이드 횟수 −1" : [row.name, typeName(row), optionText(row)].filter(Boolean).join(" · ");
          return `<button type="button" class="cs-fav${active ? " is-on" : ""}" data-pick-item="${escapeHtml(row.id)}" ${egg ? "data-egg" : ""} aria-pressed="${active}" title="${escapeHtml(title)}" style="--i:${index}">
            <span class="cs-fav-art">${art}</span>
            <span class="cs-fav-name">${escapeHtml(name)}</span>
          </button>`;
        }).join("")
      : `<p class="cs-hint">자주 쓰는 장비가 도감에 아직 없어요. 아래에서 찾아 주세요.</p>`;
  }
  async function searchItems(query) {
    const request = ++searchId;
    const out = await loadAllowed();
    if (request !== searchId || !root.isConnected) return;
    if (out.error) {
      favs.innerHTML = "";
      results.innerHTML = `<p class="cs-hint">${escapeHtml(catalogError(out.error))}</p>`;
      results.hidden = false;
      return;
    }
    paintFavorites();
    // 빈 검색이면 목록을 펼치지 않는다(자주 쓰는 장비는 위 아이콘으로).
    if (!query) {
      results.innerHTML = "";
      results.hidden = true;
      return;
    }
    results.hidden = false;
    // 아이템 검색과 같은 규칙(글자 순서·별명). 분류 이름(예: 벨트)으로도 좁힌다.
    const rows = out
      .map((row) => ({ row, rank: nameMatchRank(row.name, query) ?? (typeName(row).includes(query) ? 2 : null) }))
      .filter((item) => item.rank != null)
      .sort((left, right) => left.rank - right.rank)
      .map((item) => item.row);
    results.innerHTML = rows.length
      ? rows.map((row, index) => `<button type="button" class="cs-pick-row${row.id === picked?.id && !picked.egg ? " is-on" : ""}" data-pick-item="${escapeHtml(row.id)}" role="option" aria-selected="${row.id === picked?.id && !picked.egg}" style="--i:${Math.min(index, 12)}">
          <span class="cs-pick-art">${catalogImage(row.image_url, "cs-pick-image", 32) || `<i aria-hidden="true">${escapeHtml([...row.name][0] ?? "?")}</i>`}</span>
          <span class="cs-pick-copy"><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml([typeName(row), row.required_level == null ? "" : `Lv.${row.required_level}`, `업그레이드 ${formatCount(row.base_options.remaining_upgrades)}`, optionText(row)].filter(Boolean).join(" · "))}</small></span>
        </button>`).join("")
      : `<p class="cs-hint">혼돈의 주문서를 쓸 수 있는 장비 중에 없어요</p>`;
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

  async function pickItem(id, egg = false) {
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
    if (egg && !isHorntailNecklace(item)) return;
    const slots = Number(byKey.get("remaining_upgrades")?.base_value) - Number(egg);
    if (!(slots > 0)) {
      notify("업그레이드 가능 횟수가 없는 장비라 혼돈의 주문서를 바를 수 없어요.", "error");
      return;
    }
    const name = egg ? `${item.name} (알 적용)` : item.name;
    root.querySelector("[data-item-name]").value = name;
    root.querySelector("[data-item-slots]").value = String(slots);
    const ranges = {};
    const base = {};
    for (const input of root.querySelectorAll("[data-stat]")) {
      const key = input.dataset.stat;
      const stat = byKey.get(key);
      const bonus = egg ? HORNTAIL_EGG_BONUS[key] ?? 0 : 0;
      const value = Number(stat?.base_value ?? 0) + bonus;
      input.value = value ? String(value) : "";
      if (value > 0) base[key] = value;
      if (stat?.minimum_value != null && stat.maximum_value != null && stat.minimum_value !== stat.maximum_value) {
        ranges[key] = [Number(stat.minimum_value) + bonus, Number(stat.maximum_value) + bonus];
      }
    }
    // 이전에 저장한 장비와 같이 알 적용 후 수치를 보관한다.
    const label = [typeName(item), item.required_level == null ? "" : `Lv.${item.required_level}`, egg ? "알 1회 적용 · 성공 100% · 업그레이드 횟수 −1" : ""].filter(Boolean).join(" · ");
    picked = { id: item.id, name, image_url: item.image_url ?? null, base, label, ranges, egg };
    root.querySelector("[data-item-search]").value = "";
    void searchItems("");
    paintPicked();
    paintRanges();
    persist({ picked });
    // 기본 옵션이 바를 수 있는 상태면 바로 시작한다(시작 버튼을 따로 누르지 않게). 고친 뒤에는 시작 버튼으로 다시 시작.
    if (readSetup().error) sfx("tick");
    else startItem();
    if (!Object.keys(base).length) notify("도감에 붙어 있는 능력치가 없어요. 내 아이템 능력치를 직접 적어 주세요.", "info");
  }

  function paint() {
    paintTooltip();
    paintLog();
    paintCost();
    paintButtons();
  }

  function showResult(success, changes) {
    const ups = changes.filter((change) => change.delta > 0).length;
    const downs = changes.filter((change) => change.delta < 0 || change.gone).length;
    result.innerHTML = success
      ? `성공! ${changes.length ? `오른 능력치 ${ups}개 · 내린 능력치 ${downs}개` : "바뀐 능력치가 없어요"}`
      : "실패. 업그레이드 가능 횟수만 1 줄었어요";
  }

  // 성공·실패 연출: 바를 때마다 새 조각을 붙였다가 1.5초 뒤 지운다. 모션 축소면 건너뛴다.
  let fxTimer = 0;
  let fxCount = 0;
  function playFx(success) {
    const stage = root.querySelector("[data-stage]");
    stage.classList.remove("is-ok", "is-fail", "pop-a", "pop-b", "shake-a", "shake-b");
    void stage.offsetWidth;
    fxCount += 1;
    stage.classList.add(success ? "is-ok" : "is-fail", `${success ? "pop" : "shake"}-${fxCount % 2 ? "a" : "b"}`);
    window.clearTimeout(fxTimer);
    fxTimer = window.setTimeout(() => stage.classList.remove("is-ok", "is-fail"), 1500);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const layer = root.querySelector("[data-fx]");
    const piece = document.createElement("div");
    piece.className = `cs-fx-burst ${success ? "is-ok" : "is-fail"}`;
    piece.innerHTML = success
      ? `<i class="cs-fx-glow"></i><i class="cs-fx-rays"></i><i class="cs-fx-ring"></i><i class="cs-fx-ring is-late"></i>${Array.from({ length: 18 }, (_, i) => `<i class="cs-fx-spark${i % 3 ? "" : " is-big"}" style="--a:${i * 20 + (i % 2 ? 7 : -5)}deg;--d:${120 + (i % 4) * 16}px;--t:${0.75 + (i % 3) * 0.12}s;--w:${(i % 3) * 0.04}s"></i>`).join("")}${Array.from({ length: 8 }, (_, i) => `<i class="cs-fx-star" style="--a:${i * 45 + 22}deg;--d:82px;--w:${0.15 + i * 0.03}s"></i>`).join("")}<b class="cs-fx-word">성공</b>`
      : `<i class="cs-fx-dim"></i>${Array.from({ length: 8 }, (_, i) => `<i class="cs-fx-smoke" style="--l:${(i - 3.5) * 16}px;--s:${70 + (i % 3) * 18}px;--x:${(i - 3.5) * 10}px;--w:${i * 0.04}s"></i>`).join("")}${Array.from({ length: 7 }, (_, i) => `<i class="cs-fx-shard" style="--l:${(i - 3) * 14}px;--x:${(i - 3) * 18}px;--r:${(i % 2 ? 1 : -1) * (90 + i * 20)}deg;--w:${i * 0.03}s"></i>`).join("")}<span class="cs-fx-fail"><b>실패</b><small>업그레이드 횟수만 −1</small></span>`;
    layer.append(piece);
    window.setTimeout(() => piece.remove(), 1500);
    const tip = root.querySelector("[data-tip-fx]");
    if (tip) {
      tip.className = `cs-tip-fx ${success ? "is-ok" : "is-fail"}`;
    }
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
    playFx(out.success);
    sfx(out.success ? "chaosOk" : "chaosFail");
    if (out.success && out.changes.some((change) => change.delta > 0)) burstAt(rollButton.querySelector(".cs-scroll-orb"), ["#ffe28a", "#fff6d0", "#c9a6ff", "#ffffff"], 14, 0.8);
    return true;
  }

  function stopAuto() {
    window.clearTimeout(autoTimer);
    autoTimer = 0;
    paintButtons();
  }

  function startItem({ quiet = false } = {}) {
    const read = readSetup();
    if (read.error) {
      if (!quiet) notify(read.error, "error");
      return;
    }
    stopAuto();
    const fromPicked = Boolean(picked && picked.name === read.value.name);
    // 정옵은 고른 장비의 도감 옵션, 직접 적었거나 예전에 저장된 장비라 없으면 시작 옵션.
    const catalogBase = fromPicked ? picked.base : null;
    const egg = Boolean(catalogBase && picked.egg);
    const base = { ...(catalogBase ?? read.value.stats) };
    if (egg) {
      // 예전에 저장된 알 프리셋도 같은 형식이다. 정옵 비교에는 알 상승분을 빼서 원본을 복원한다.
      for (const [key, bonus] of Object.entries(HORNTAIL_EGG_BONUS)) base[key] -= bonus;
    }
    const baseLabel = egg ? "원본 정옵" : catalogBase ? "정옵" : "시작 옵션";
    start = { ...read.value, base, baseLabel, egg, image: fromPicked && picked.image_url ? catalogImage(picked.image_url, "cs-tip-image", 64) : "", label: fromPicked ? picked.label : "" };
    replacedItems = 0;
    previousScrolls = 0;
    resetCurrentItem();
    persist({ name: start.name, slots: String(start.slots), stats: read.raw });
    if (!quiet) sfx("tick");
    paint();
  }

  function resetCurrentItem() {
    lastGrade = "";
    tooltip.classList.remove("is-grade-flash");
    window.clearTimeout(fxTimer);
    root.querySelector("[data-stage]").classList.remove("is-ok", "is-fail", "pop-a", "pop-b", "shake-a", "shake-b");
    root.querySelector("[data-fx]").replaceChildren();
    current = { slots: start.slots, stats: { ...start.stats } };
    history = [];
    lastChanges = new Map();
    result.textContent = "";
  }

  // 확률 설정
  const successInput = root.querySelector("[data-success]");
  const deltaGrid = root.querySelector("[data-delta-grid]");
  function paintOdds() {
    successInput.value = String(table.successRate);
    const max = Math.max(...table.deltas.map((delta) => Number(delta.percent) || 0), 1);
    deltaGrid.innerHTML = table.deltas.map((delta, index) => `<label class="cs-delta-cell ${delta.value > 0 ? "is-up" : delta.value < 0 ? "is-down" : ""}" style="--i:${index};--k:${Math.abs(delta.value)}"><span class="cs-delta-bar"><i style="--h:${Math.max(4, ((Number(delta.percent) || 0) / max) * 100)}%"></i></span><b>${escapeHtml(signed(delta.value))}</b><input data-delta="${index}" inputmode="decimal" autocomplete="off" value="${escapeHtml(delta.percent)}" aria-label="변화량 ${escapeHtml(signed(delta.value))} 확률(%)" /></label>`).join("");
    paintOddsSum();
  }
  function paintOddsSum() {
    const check = checkChaosTable(table);
    const sum = table.deltas.reduce((total, delta) => total + (Number(delta.percent) || 0), 0);
    const node = root.querySelector("[data-delta-sum]");
    node.textContent = check.error ? `합계 ${Math.round(sum * 100) / 100}% · ${check.error}` : `합계 ${Math.round(sum * 100) / 100}% · 정상`;
    node.className = check.error ? "is-error" : "is-ok";
    root.querySelector("[data-roll-rate]").textContent = `성공 ${table.successRate}%`;
    root.querySelector("[data-odds-rate]").textContent = `성공 ${table.successRate}%`;
    paintButtons();
  }

  root.addEventListener("click", (event) => {
    if (!event.target.closest(".cs-search")) results.hidden = true;
    const oddsToggle = event.target.closest("[data-odds-toggle]");
    if (oddsToggle) {
      const odds = root.querySelector("[data-odds]");
      odds.hidden = !odds.hidden;
      oddsToggle.setAttribute("aria-expanded", String(!odds.hidden));
      sfx("tick");
      return;
    }
    const pickButton = event.target.closest("[data-pick-item]");
    if (pickButton) {
      pickItem(pickButton.dataset.pickItem, pickButton.hasAttribute("data-egg"));
      return;
    }
    if (event.target.closest("[data-unpick]")) {
      picked = null;
      persist({ picked: null });
      paintPicked();
      paintRanges({});
      if (allowedItems) paintFavorites();
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
        if (current.slots > 0) autoTimer = window.setTimeout(step, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 60 : 520);
        paintButtons();
      };
      step();
      return;
    }
    if (event.target.closest("[data-undo]") && history.length) {
      const last = history.pop();
      current = last.before;
      lastChanges = new Map();
      result.innerHTML = `${last.n}장째 이전 상태로 돌아왔어요`;
      sfx("uncheck");
      paint();
      return;
    }
    if (event.target.closest("[data-next-item]") && !nextButton.disabled) {
      previousScrolls += history.length;
      replacedItems += 1;
      resetCurrentItem();
      result.textContent = `${replacedItems + 1}번째 장비를 가져왔어요.`;
      sfx("tick");
      paint();
      return;
    }
    if (event.target.closest("[data-reset]") && !resetButton.disabled) {
      replacedItems = 0;
      previousScrolls = 0;
      resetCurrentItem();
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
    if (event.target.matches("[data-cost]")) {
      const input = event.target;
      const parsed = readBig(input.value, "가격");
      if (!parsed.error) persist({ prices: { ...loadStore().prices, [input.dataset.cost]: parsed.value?.toString() ?? "" } });
      paintCost();
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
    if (event.target.matches("[data-cost]")) {
      const input = event.target;
      const parsed = readBig(input.value, "가격");
      if (!parsed.error && parsed.value != null) input.value = formatCount(parsed.value);
    }
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing && event.target.matches("[data-item-search]")) {
      event.preventDefault();
      results.querySelector("[data-pick-item]")?.click();
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
  // 다시 들어오면 적어 둔 옵션으로 바로 바를 수 있게(값이 모자라면 조용히 빈 상태).
  startItem({ quiet: true });
  paint();
  void searchItems("");
}
