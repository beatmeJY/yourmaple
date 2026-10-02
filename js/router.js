import { routes } from "./routes.js";

const pages = {
  dashboard: () => import("./pages/dashboard.js"),
  characters: () => import("./pages/characters.js"),
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

export async function renderRoute(root) {
  const id = getRouteId();
  const page = await pages[id]();
  await page.render(root);
  return id;
}

function navLink(route, activeId) {
  if (route.quick) {
    return `
      <button
        type="button"
        class="nav-link${route.id === activeId ? " is-active" : ""}"
        data-quick-nav="${route.id}"
      >
        <span>${route.label}</span>
      </button>
    `;
  }
  return `
    <a
      class="nav-link${route.id === activeId ? " is-active" : ""}"
      href="#/${route.id}"
      data-route="${route.id}"
    >
      <span>${route.label}</span>
    </a>
  `;
}

export function renderNav(nav, activeId) {
  const main = routes.filter((route) => !route.pin);
  const pinned = routes.filter((route) => route.pin);
  const spacer = pinned.length ? `<div class="nav-spacer"></div>` : "";
  nav.innerHTML = `${main.map((route) => navLink(route, activeId)).join("")}${spacer}${pinned.map((route) => navLink(route, activeId)).join("")}`;
}
