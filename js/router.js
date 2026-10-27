import { categories, categoryOf, glyphInner, homeRoute, isHiddenRoute, routes } from "./routes.js";

const pages = {
  dashboard: () => import("./pages/dashboard.js"),
  characters: () => import("./pages/characters.js"),
  homework: () => import("./pages/homework.js"),
  hunts: () => import("./pages/hunts.js"),
  "level-plan": () => import("./pages/level-plan.js"),
  "monster-park": () => import("./pages/monster-park.js"),
  dojo: () => import("./pages/dojo.js"),
  maker: () => import("./pages/maker.js"),
  enhance: () => import("./pages/enhance.js"),
  monsters: () => import("./pages/monsters.js"),
  "item-catalog": () => import("./pages/item-catalog.js"),
  trades: () => import("./pages/trades.js"),
  quests: () => import("./pages/quests.js"),
  notes: () => import("./pages/notes.js"),
  links: () => import("./pages/links.js"),
};

export function getRouteId() {
  const id = location.hash.replace(/^#\/?/, "").split("?")[0];
  if (id === "items") return "trades";
  return pages[id] && !isHiddenRoute(id) ? id : "dashboard";
}

export function navigate(id) {
  location.hash = `#/${id}`;
}

// 화면마다 빈 새 영역에 그린다. 화면 모듈이 root 에 단 클릭·입력 처리가 같은 #main 에 쌓이면
// 화면을 다시 열 때 처리가 여러 번 실행된다(예: 메이커 보관함이 열렸다 바로 닫힘). 복제본으로 바꾸면 예전 처리는 함께 버려지고,
// 늦게 도착한 응답은 각 화면의 isConnected 검사로 버려진다. 바뀐 요소는 document.querySelector("#main")로 찾는다.
export async function renderRoute(root) {
  const id = getRouteId();
  const page = await pages[id]();
  // 불러오는 사이 주소가 바뀌었으면 그리지 않는다(늦게 온 앞 화면이 새 화면을 덮지 않게). 새 주소는 hashchange 가 그린다.
  if (getRouteId() !== id) return null;
  // 화면 모듈을 불러오는 사이 다른 이동이 #main 을 이미 바꿨을 수 있으므로 지금 문서에 있는 것을 다시 찾는다.
  const current = document.querySelector("#main") ?? root;
  const fresh = current.cloneNode(false);
  fresh.dataset.page = id;
  current.replaceWith(fresh);
  await page.render(fresh);
  return id;
}

// 메뉴 분류는 기본으로 모두 펼친다(2026-10-21 사용자 요청: 메뉴가 적어 한 번에 누를 수 있게).
// 사용자가 접은 분류만 이 브라우저에 기억한다. 지금 보는 화면의 분류는 늘 펼쳐 보인다.
const COLLAPSED_KEY = "maple-note-nav-collapsed";

function readCollapsed() {
  try {
    const list = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || "[]");
    return new Set(Array.isArray(list) ? list : []);
  } catch {
    return new Set();
  }
}

function writeCollapsed() {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedCategories]));
  } catch {
    // 기억하지 못해도 이번 방문에서는 그대로 따른다.
  }
}

const collapsedCategories = readCollapsed();
let navRendered = false;

function hueColor(hue, alpha = 1) {
  return `oklch(0.8 0.13 ${hue}${alpha < 1 ? ` / ${alpha}` : ""})`;
}

function subLink(route, activeId) {
  const active = route.id === activeId;
  const attrs = route.quick ? `type="button" data-quick-nav="${route.id}"` : `href="#/${route.id}" data-route="${route.id}"`;
  const tag = route.quick ? "button" : "a";
  return `<${tag} class="nav-sub${active ? " is-active" : ""}" ${attrs}${active ? ` aria-current="page"` : ""}><i class="nav-dot" aria-hidden="true"></i><span>${route.label}</span></${tag}>`;
}

// 펼침형 분류 트리. 기본은 모두 펼침, 사용자가 접은 분류만 접는다(지금 화면의 분류는 늘 펼침).
export function renderNav(nav, activeId) {
  const current = categoryOf(activeId);
  const home = `<a class="nav-home${activeId === homeRoute.id ? " is-active" : ""}" href="#/${homeRoute.id}" data-route="${homeRoute.id}"${activeId === homeRoute.id ? ` aria-current="page"` : ""}><span class="nav-glyph" aria-hidden="true">${homeRoute.glyph}</span><span>${homeRoute.label}</span></a>`;
  // 메뉴가 차례로 떠오르는 효과는 처음 한 번만. 페이지를 옮길 때마다 다시 재생되지 않게 한다.
  nav.classList.toggle("is-entering", !navRendered);
  navRendered = true;
  nav.innerHTML = `${home}<div class="nav-groups">${categories.map((category, index) => {
    const open = !collapsedCategories.has(category.id) || category.id === current?.id;
    const active = category.id === current?.id;
    const glyph = `<span class="nav-glyph${category.icon ? " is-icon" : category.glyph.length > 2 ? " is-long" : ""}" aria-hidden="true">${glyphInner(category)}</span>`;
    // 메뉴가 하나뿐인 분류(무릉도장·거래 등)는 펼칠 것 없이 분류 줄을 누르면 바로 그 화면으로 간다(2026-10-21 사용자 요청).
    // 링크처럼 화면 없이 패널을 여는 메뉴(quick)는 링크 대신 버튼으로 둔다.
    const [only] = category.routes;
    if (category.routes.length === 1) {
      const attrs = only.quick
        ? `type="button" data-quick-nav="${only.id}"`
        : `href="#/${only.id}" data-route="${only.id}"${active ? ` aria-current="page"` : ""}`;
      const tag = only.quick ? "button" : "a";
      return `<section class="nav-group is-single${active ? " is-active" : ""}" style="--hue:${category.hue};--cat:${hueColor(category.hue)};--i:${index}">
      <${tag} class="nav-cat nav-single" ${attrs} title="${only.label}">
        ${glyph}
        <span class="nav-cat-name">${category.label}</span>
      </${tag}>
    </section>`;
    }
    return `<section class="nav-group${open ? " is-open" : ""}${active ? " is-active" : ""}" style="--hue:${category.hue};--cat:${hueColor(category.hue)};--i:${index}">
      <button type="button" class="nav-cat" data-nav-cat="${category.id}" aria-expanded="${open}" aria-controls="nav-subs-${category.id}">
        ${glyph}
        <span class="nav-cat-name">${category.label}</span>
        <span class="nav-count">${category.routes.length}</span>
        <span class="nav-chev" aria-hidden="true">›</span>
      </button>
      <div class="nav-subs" id="nav-subs-${category.id}"><div class="nav-subs-inner">${category.routes.map((route) => subLink(route, activeId)).join("")}</div></div>
    </section>`;
  }).join("")}</div>`;
  // 메뉴를 다 펼치면 세로가 짧은 화면에서 사이드바가 스크롤된다. 지금 화면 메뉴가 보이게 사이드바 안에서만 맞춘다.
  const active = nav.querySelector(".nav-sub.is-active, .nav-single[aria-current]");
  const panel = nav.closest(".sidebar-panel");
  if (active && panel && panel.scrollHeight > panel.clientHeight) {
    const top = active.getBoundingClientRect().top - panel.getBoundingClientRect().top;
    if (top < 0 || top + active.offsetHeight > panel.clientHeight) panel.scrollTop += top - panel.clientHeight / 2;
  }
}

export function toggleNavCategory(button) {
  const group = button.closest(".nav-group");
  const open = !group.classList.contains("is-open");
  group.classList.toggle("is-open", open);
  button.setAttribute("aria-expanded", String(open));
  if (open) collapsedCategories.delete(button.dataset.navCat);
  else collapsedCategories.add(button.dataset.navCat);
  writeCollapsed();
}

// 헤더의 분류 경로: 분류 색 점 + 분류 이름 › 화면 이름
export function renderCrumb(crumb, activeId) {
  if (!crumb) return;
  const category = categoryOf(activeId);
  const route = routes.find((item) => item.id === activeId);
  crumb.innerHTML = category
    ? `<span class="crumb-cat" style="--cat:${hueColor(category.hue)}"><i aria-hidden="true"></i>${category.label}</span><span class="crumb-sep" aria-hidden="true">›</span><span class="crumb-page">${route?.label ?? ""}</span>`
    : `<span class="crumb-page">${homeRoute.label}</span>`;
}
