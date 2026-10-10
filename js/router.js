import { categories, categoryOf, homeRoute, routes } from "./routes.js";

const pages = {
  dashboard: () => import("./pages/dashboard.js"),
  characters: () => import("./pages/characters.js"),
  homework: () => import("./pages/homework.js"),
  hunts: () => import("./pages/hunts.js"),
  "level-plan": () => import("./pages/level-plan.js"),
  dojo: () => import("./pages/dojo.js"),
  maker: () => import("./pages/maker.js"),
  enhance: () => import("./pages/enhance.js"),
  monsters: () => import("./pages/monsters.js"),
  trades: () => import("./pages/trades.js"),
  quests: () => import("./pages/quests.js"),
  notes: () => import("./pages/notes.js"),
  links: () => import("./pages/links.js"),
};

export function getRouteId() {
  const id = location.hash.replace(/^#\/?/, "").split("?")[0];
  if (id === "items") return "trades";
  return pages[id] ? id : "dashboard";
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

const openCategories = new Set();
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

// 펼침형 분류 트리. 지금 화면의 분류는 항상 펼치고, 나머지는 누른 것만 펼친다.
export function renderNav(nav, activeId) {
  const current = categoryOf(activeId);
  if (current) openCategories.add(current.id);
  const home = `<a class="nav-home${activeId === homeRoute.id ? " is-active" : ""}" href="#/${homeRoute.id}" data-route="${homeRoute.id}"${activeId === homeRoute.id ? ` aria-current="page"` : ""}><span class="nav-glyph" aria-hidden="true">${homeRoute.glyph}</span><span>${homeRoute.label}</span></a>`;
  // 메뉴가 차례로 떠오르는 효과는 처음 한 번만. 페이지를 옮길 때마다 다시 재생되지 않게 한다.
  nav.classList.toggle("is-entering", !navRendered);
  navRendered = true;
  nav.innerHTML = `${home}<div class="nav-groups">${categories.map((category, index) => {
    const open = openCategories.has(category.id);
    const active = category.id === current?.id;
    return `<section class="nav-group${open ? " is-open" : ""}${active ? " is-active" : ""}" style="--hue:${category.hue};--cat:${hueColor(category.hue)};--i:${index}">
      <button type="button" class="nav-cat" data-nav-cat="${category.id}" aria-expanded="${open}" aria-controls="nav-subs-${category.id}">
        <span class="nav-glyph${category.glyph.length > 2 ? " is-long" : ""}" aria-hidden="true">${category.glyph}</span>
        <span class="nav-cat-name">${category.label}</span>
        <span class="nav-count">${category.routes.length}</span>
        <span class="nav-chev" aria-hidden="true">›</span>
      </button>
      <div class="nav-subs" id="nav-subs-${category.id}"><div class="nav-subs-inner">${category.routes.map((route) => subLink(route, activeId)).join("")}</div></div>
    </section>`;
  }).join("")}</div>`;
}

export function toggleNavCategory(button) {
  const group = button.closest(".nav-group");
  const open = !group.classList.contains("is-open");
  group.classList.toggle("is-open", open);
  button.setAttribute("aria-expanded", String(open));
  if (open) openCategories.add(button.dataset.navCat);
  else openCategories.delete(button.dataset.navCat);
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
