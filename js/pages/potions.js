import { escapeHtml, formatCount } from "../format.js";
import { POTIONS, potionIcon } from "../potion-data.js";
import { perUnitText, rankPotions } from "../potion-calc.js";
import { sfx } from "../effects.js";

// 물약 효율 순위(2026-11-28 사용자 요청). 상점 물약을 1만 회복에 드는 메소로 줄 세운다.
// 묘묘 상점을 켜면 묘묘가 더 싼 물약은 묘묘 가격으로 계산하고 (묘묘)를 붙인다.
// 고른 탭·묘묘·최대 HP/MP는 이 기기에만 기억한다(편의용).
const STORE_KEY = "maple-note-potions";
const TABS = [
  { id: "hp", label: "HP", hint: "HP 1만 회복에 드는 메소" },
  { id: "mp", label: "MP", hint: "MP 1만 회복에 드는 메소" },
  { id: "both", label: "HP·MP 함께", hint: "HP+MP 합 1만 회복에 드는 메소" },
];
const UNIT = 10000;

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
    // 저장이 막혀도 화면은 그대로 쓴다
  }
}

const readMax = (value) => {
  const number = Number(String(value ?? "").replace(/[,\s]/g, ""));
  return Number.isInteger(number) && number > 0 && number <= 99999 ? number : null;
};

function recoverText(row, tab) {
  const parts = [];
  if (tab !== "mp" && row.hp) parts.push(`<span class="pt-hp">HP ${formatCount(row.hp)}</span>`);
  if (tab !== "hp" && row.mp) parts.push(`<span class="pt-mp">MP ${formatCount(row.mp)}</span>`);
  // HP 탭에서 MP도 채워 주면 알려 준다(가격은 HP만으로 나눔)
  if (tab === "hp" && (row.potion.mp || row.potion.mpPct)) parts.push('<span class="pt-also">MP도 회복</span>');
  if (tab === "mp" && (row.potion.hp || row.potion.hpPct)) parts.push('<span class="pt-also">HP도 회복</span>');
  return parts.join("");
}

function badges(potion, row) {
  const list = [];
  if (potion.malaysia) list.push('<span class="pt-badge is-new">말레이시아</span>');
  if (potion.hpPct || potion.mpPct) list.push(`<span class="pt-badge is-pct">${escapeHtml([potion.hpPct && `HP ${potion.hpPct}%`, potion.mpPct && `MP ${potion.mpPct}%`].filter(Boolean).join(" · "))}</span>`);
  if (potion.extra) list.push(`<span class="pt-badge is-extra">${escapeHtml(potion.extra)}</span>`);
  if (potion.unsure) list.push('<span class="pt-badge is-unsure" title="회복량을 해외판 게임 자료로 넣었어요. 메이플랜드 값은 확인이 필요해요.">회복량 확인 필요</span>');
  return list.join("");
}

function whereText(row) {
  const { potion } = row;
  if (row.myo) return `<b>묘묘 상점</b><span>일반 상점 ${formatCount(potion.price)}</span>`;
  const same = row.same ? "<span>묘묘도 같은 값</span>" : "";
  return `<b>${escapeHtml(potion.npc)}</b><span>${escapeHtml(potion.map)}</span>${same}`;
}

const nameWithMyo = (row) => `${escapeHtml(row.potion.name)}${row.myo ? '<em class="pt-myo-mark">(묘묘)</em>' : ""}`;
const costText = (row) => formatCount(Math.round(row.perUnit * UNIT));
const icon = (potion, size) => `<img class="pt-icon" src="${escapeHtml(potionIcon(potion))}" alt="" width="${size}" height="${size}" loading="lazy" />`;

function podium(rows, tab) {
  const top = rows.slice(0, 3);
  if (!top.length) return "";
  return `<ol class="pt-podium" aria-label="효율 상위 3개">${top.map((row, index) => `
    <li class="pt-top is-rank-${row.rank}" style="--i:${index}">
      <span class="pt-top-rank">${row.rank}<small>위</small></span>
      <span class="pt-top-art">${icon(row.potion, 44)}</span>
      <strong class="pt-top-name">${nameWithMyo(row)}</strong>
      <span class="pt-top-recover">${recoverText(row, tab)}</span>
      <span class="pt-top-cost"><b>${costText(row)}</b><small>메소 / 1만</small></span>
      <span class="pt-top-price">개당 ${formatCount(row.price)} 메소</span>
    </li>`).join("")}</ol>`;
}

function rowHtml(row, tab, index) {
  const { potion } = row;
  return `
    <li class="pt-row${row.rank <= 3 ? " is-top" : ""}${potion.malaysia ? " is-malaysia" : ""}" style="--i:${Math.min(index, 20)}; --ratio:${(row.ratio * 100).toFixed(1)}%">
      <span class="pt-rank" aria-label="${row.rank}위">${row.rank}</span>
      <span class="pt-art">${icon(potion, 36)}</span>
      <span class="pt-main">
        <span class="pt-name">${nameWithMyo(row)}</span>
        <span class="pt-badges">${badges(potion, row)}</span>
        <span class="pt-recover">${recoverText(row, tab)}</span>
      </span>
      <span class="pt-price"><b>${formatCount(row.price)}</b><small>메소 / 개</small></span>
      <span class="pt-where">${whereText(row)}</span>
      <span class="pt-eff">
        <span class="pt-eff-num"><b>${costText(row)}</b><small>메소 / 1만</small></span>
        <span class="pt-bar" aria-hidden="true"><i></i></span>
        <span class="pt-eff-sub">1당 ${perUnitText(row.perUnit)}</span>
      </span>
    </li>`;
}

export function render(root) {
  const stored = loadStore();
  const state = {
    tab: TABS.some((tab) => tab.id === stored.tab) ? stored.tab : "hp",
    useMyo: stored.useMyo === true,
    maxHp: readMax(stored.maxHp),
    maxMp: readMax(stored.maxMp),
  };

  root.innerHTML = `
    <div class="pt-page">
      <header class="pt-head">
        <span class="pt-head-art" aria-hidden="true">${icon({ id: 2000000 }, 48)}${icon({ id: 2000003 }, 48)}</span>
        <div class="pt-head-copy">
          <p class="pt-kicker">물약 효율</p>
          <h1>물약 가성비 순위</h1>
          <p>상점에서 파는 물약을 <b>1만 회복에 드는 메소</b>로 줄 세웠어요. 숫자가 작을수록 싸게 채워요.</p>
        </div>
      </header>

      <section class="pt-controls ym-glass" aria-label="보기 설정">
        <div class="pt-tabs" role="tablist" aria-label="회복 종류">
          ${TABS.map((tab) => `<button type="button" role="tab" class="pt-tab is-${tab.id}" data-tab="${tab.id}" aria-selected="${tab.id === state.tab}"><span>${tab.label}</span><small data-tab-count="${tab.id}"></small></button>`).join("")}
        </div>
        <button type="button" class="pt-myo" data-myo role="switch" aria-checked="${state.useMyo}">
          <span class="pt-switch" aria-hidden="true"><i></i></span>
          <span class="pt-myo-copy"><b>묘묘 상점 있음</b><small>더 싼 물약은 묘묘 가격으로</small></span>
        </button>
        <div class="pt-max">
          <span class="pt-max-title">내 최대치 <small>선택 · % 회복 물약 계산용</small></span>
          <label class="pt-max-field is-hp"><span>최대 HP</span><input data-max="hp" inputmode="numeric" autocomplete="off" placeholder="예: 8000" value="${state.maxHp ?? ""}" /></label>
          <label class="pt-max-field is-mp"><span>최대 MP</span><input data-max="mp" inputmode="numeric" autocomplete="off" placeholder="예: 12000" value="${state.maxMp ?? ""}" /></label>
          <button type="button" class="pt-ghost" data-max-fill>둘 다 1만 이상</button>
        </div>
      </section>

      <p class="pt-legend" data-legend></p>
      <div data-podium></div>
      <ol class="pt-list" data-list aria-label="물약 순위"></ol>
      <p class="pt-note" data-hidden-note hidden></p>
      <p class="pt-foot">가격은 상점 기준이에요. 묘묘 상점은 묘묘가 더 쌀 때만 반영하고, 같은 값이면 원래 상점을 보여 줘요. % 회복 물약은 최대치의 %와 고정량(최대치 1만 초과 시) 중 작은 값으로 계산해요. 능력치만 올려 주는 음식(나시 르막·로티 프라타·꾸이 등)은 빠져 있어요.</p>
    </div>`;

  const list = root.querySelector("[data-list]");

  function paint({ animate = false } = {}) {
    const max = { hp: state.maxHp, mp: state.maxMp };
    for (const tab of TABS) {
      const count = rankPotions(POTIONS, { tab: tab.id, useMyo: state.useMyo, max }).rows.length;
      root.querySelector(`[data-tab-count="${tab.id}"]`).textContent = `${count}개`;
    }
    root.querySelectorAll("[data-tab]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.tab === state.tab)));
    root.querySelector("[data-myo]").setAttribute("aria-checked", String(state.useMyo));

    const { rows, hidden } = rankPotions(POTIONS, { tab: state.tab, useMyo: state.useMyo, max });
    const tab = TABS.find((item) => item.id === state.tab);
    root.querySelector("[data-legend]").innerHTML = `<b>${escapeHtml(tab.hint)}</b> · 막대가 길수록 효율이 좋아요${state.useMyo ? ' · <em class="pt-myo-mark">(묘묘)</em> = 묘묘 상점에서 사는 게 더 쌈' : ""}`;
    root.querySelector("[data-podium]").innerHTML = podium(rows, state.tab);
    list.innerHTML = rows.length ? rows.map((row, index) => rowHtml(row, state.tab, index)).join("") : '<li class="pt-empty">보여 줄 물약이 없어요.</li>';
    list.classList.toggle("is-animate", animate);
    const note = root.querySelector("[data-hidden-note]");
    note.hidden = !hidden;
    if (hidden) note.innerHTML = `% 회복 물약 <b>${hidden}개</b>(혼스터·마나불·인삼 원액 등)는 최대 ${state.tab === "both" ? "HP·MP" : state.tab.toUpperCase()}를 적으면 순위에 들어가요.`;
    saveStore({ tab: state.tab, useMyo: state.useMyo, maxHp: state.maxHp, maxMp: state.maxMp });
  }

  root.addEventListener("click", (event) => {
    const tabButton = event.target.closest("[data-tab]");
    if (tabButton && tabButton.dataset.tab !== state.tab) {
      state.tab = tabButton.dataset.tab;
      sfx("tick");
      paint({ animate: true });
      return;
    }
    if (event.target.closest("[data-myo]")) {
      state.useMyo = !state.useMyo;
      sfx(state.useMyo ? "check" : "uncheck");
      paint({ animate: true });
      return;
    }
    if (event.target.closest("[data-max-fill]")) {
      state.maxHp = UNIT;
      state.maxMp = UNIT;
      root.querySelector('[data-max="hp"]').value = String(state.maxHp);
      root.querySelector('[data-max="mp"]').value = String(state.maxMp);
      paint({ animate: true });
    }
  });

  root.addEventListener("keydown", (event) => {
    const tabButton = event.target.closest("[data-tab]");
    if (!tabButton || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const index = TABS.findIndex((tab) => tab.id === tabButton.dataset.tab);
    const next = TABS[(index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    state.tab = next.id;
    paint({ animate: true });
    root.querySelector(`[data-tab="${next.id}"]`).focus();
    event.preventDefault();
  });

  root.addEventListener("input", (event) => {
    const input = event.target.closest("[data-max]");
    if (!input) return;
    const value = readMax(input.value);
    input.classList.toggle("is-invalid", Boolean(input.value.trim()) && value === null);
    if (input.dataset.max === "hp") state.maxHp = value;
    else state.maxMp = value;
    paint();
  });

  paint({ animate: true });
}
