import { sfx } from "./effects.js";
import { escapeHtml } from "./format.js";
import { categories, homeRoute } from "./routes.js";

// 헤더 기능 검색: 화면 이름·분류 이름으로 찾아 이동한다. "/" 키로 어디서든 검색칸에 들어간다.
// 좁은 화면에서는 돋보기 버튼만 보이고, 누르면 헤더 위로 검색칸이 펼쳐진다.

const items = [
  { id: homeRoute.id, label: homeRoute.label, category: "", hue: 40, glyph: homeRoute.glyph },
  ...categories.flatMap((category) =>
    category.routes.map((route) => ({
      id: route.id,
      label: route.label,
      category: category.label,
      hue: category.hue,
      glyph: category.glyph,
      quick: Boolean(route.quick),
    })),
  ),
];

function normalize(text) {
  return String(text ?? "").toLowerCase().replace(/[\s·]/g, "");
}

export function searchFeatures(query) {
  const key = normalize(query);
  if (!key) return items;
  return items.filter((item) => normalize(`${item.label}${item.category}`).includes(key));
}

let active = 0;

function box() {
  return document.querySelector("[data-feature-search]");
}

function paint(results) {
  const list = box()?.querySelector("[data-feature-results]");
  if (!list) return;
  if (!results.length) {
    list.innerHTML = `<p class="feature-search-empty">맞는 기능이 없습니다.</p>`;
    return;
  }
  active = Math.min(active, results.length - 1);
  list.innerHTML = results
    .map(
      (item, index) => `<button type="button" class="feature-search-item${index === active ? " is-active" : ""}" data-feature-go="${item.id}"${item.quick ? ' data-quick="true"' : ""} role="option" aria-selected="${index === active}" style="--hue:${item.hue}">
        <span class="feature-search-glyph${String(item.glyph).length > 1 ? " is-small" : ""}" aria-hidden="true">${escapeHtml(item.glyph)}</span>
        <span class="feature-search-copy"><strong>${escapeHtml(item.label)}</strong>${item.category ? `<span>${escapeHtml(item.category)}</span>` : ""}</span>
      </button>`,
    )
    .join("");
}

function open() {
  const root = box();
  if (!root) return;
  root.classList.add("is-open");
  root.querySelector("input").setAttribute("aria-expanded", "true");
  document.querySelector(".topbar")?.classList.add("is-searching");
  active = 0;
  paint(searchFeatures(root.querySelector("input").value));
}

function close() {
  const root = box();
  if (!root) return;
  root.classList.remove("is-open");
  root.querySelector("input").setAttribute("aria-expanded", "false");
  document.querySelector(".topbar")?.classList.remove("is-searching");
  root.querySelector("input").value = "";
}

function go(button) {
  sfx("tick");
  close();
  document.activeElement?.blur?.();
  if (button.dataset.quick) {
    // 링크처럼 페이지가 아닌 기능은 메뉴 버튼과 같은 동작을 부른다.
    document.querySelector(`[data-quick-nav="${button.dataset.featureGo}"]`)?.click();
    return;
  }
  location.hash = `#/${button.dataset.featureGo}`;
}

let wired = false;

export function mountFeatureSearch() {
  if (wired) return;
  wired = true;
  document.addEventListener("focusin", (event) => {
    if (event.target.matches?.("[data-feature-search] input")) open();
  });
  document.addEventListener("input", (event) => {
    if (!event.target.matches?.("[data-feature-search] input")) return;
    // 포커스 이벤트를 못 받은 경우(창 밖에서 포커스만 옮겨진 경우)에도 입력하면 목록을 연다.
    if (!box().classList.contains("is-open")) open();
    active = 0;
    paint(searchFeatures(event.target.value));
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-feature-go]");
    if (button) {
      go(button);
      return;
    }
    if (event.target.closest("[data-feature-search-open]")) {
      // 좁은 화면에서는 검색칸이 접혀 있으므로 먼저 펼친 뒤 포커스한다.
      sfx("tick");
      open();
      box()?.querySelector("input")?.focus();
      return;
    }
    if (event.target.matches?.("[data-feature-search] input")) {
      if (!box().classList.contains("is-open")) open();
      return;
    }
    if (!event.target.closest("[data-feature-search]")) close();
  });
  document.addEventListener("keydown", (event) => {
    const root = box();
    if (!root) return;
    const input = root.querySelector("input");
    const typing = event.target.closest?.("input, textarea, select, [contenteditable='true']");
    if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      input.focus();
      return;
    }
    if (!root.classList.contains("is-open") || event.target !== input) return;
    const results = [...root.querySelectorAll("[data-feature-go]")];
    if (event.key === "Escape") {
      close();
      input.blur();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!results.length) return;
      active = event.key === "ArrowDown" ? (active + 1) % results.length : (active - 1 + results.length) % results.length;
      paint(searchFeatures(input.value));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (results[active]) go(results[active]);
    }
  });
}
