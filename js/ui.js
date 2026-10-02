const THEME_KEY = "maple-note-theme";
const NAV_KEY = "maple-note-nav";
const DESKTOP_NAV = window.matchMedia("(min-width: 801px)");

export function isDesktopNav() {
  return DESKTOP_NAV.matches;
}

export function applyNavPreference() {
  document.body.classList.toggle("nav-collapsed", localStorage.getItem(NAV_KEY) === "collapsed");
}

function syncNavChrome() {
  const sidebar = document.querySelector("#sidebar");
  const toggle = document.querySelector("[data-open-nav]");
  const hidden = isDesktopNav()
    ? document.body.classList.contains("nav-collapsed")
    : !document.body.classList.contains("nav-open");
  if (sidebar) {
    sidebar.toggleAttribute("inert", hidden);
    sidebar.setAttribute("aria-hidden", hidden ? "true" : "false");
  }
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(!hidden));
    toggle.setAttribute("aria-label", hidden ? "메뉴 열기" : "메뉴 닫기");
  }
}

DESKTOP_NAV.addEventListener("change", syncNavChrome);

export function getTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
}

const NAV_CHEVRON = `<svg class="nav-chevron" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function renderShell() {
  const app = document.querySelector("#app");
  app.innerHTML = `
    <div class="layout">
      <div class="backdrop" data-close-nav></div>
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-panel">
        <div class="brand">
          <strong>Your Maple</strong>
          <span>개인용 정보 메모</span>
          <button class="nav-toggle nav-close" type="button" data-close-nav aria-label="메뉴 닫기">${NAV_CHEVRON}</button>
        </div>
        <nav class="nav" id="nav" aria-label="주요 메뉴"></nav>
        </div>
      </aside>
      <div class="content">
        <header class="topbar">
          <button class="nav-toggle" type="button" data-open-nav aria-controls="sidebar" aria-expanded="true" aria-label="메뉴 닫기">${NAV_CHEVRON}</button>
          <p class="topbar-title">Your Maple</p>
          <div class="topbar-actions">
            <p class="account-email" id="account-email"></p>
            <button class="icon-button" type="button" data-logout>로그아웃</button>
            <button class="icon-button" type="button" data-theme-toggle>다크 모드</button>
          </div>
        </header>
        <main id="main" class="main"></main>
      </div>
      <div class="link-panel" data-link-panel>
        <div class="link-panel-backdrop" data-link-panel-close></div>
        <div class="link-panel-sheet" role="dialog" aria-modal="true" aria-label="바로가기 링크">
          <div class="link-panel-handle"></div>
          <div class="link-panel-head">
            <p class="link-panel-title">바로가기</p>
            <a class="text-button" href="#/links" data-link-panel-manage>링크 관리</a>
          </div>
          <div class="link-panel-body" data-link-panel-body></div>
        </div>
      </div>
    </div>
  `;
  syncNavChrome();
}

export function setNavOpen(open) {
  document.body.classList.toggle("nav-open", open);
  syncNavChrome();
}

export function setNavCollapsed(collapsed) {
  document.body.classList.toggle("nav-collapsed", collapsed);
  localStorage.setItem(NAV_KEY, collapsed ? "collapsed" : "open");
  syncNavChrome();
}

export function syncThemeButton() {
  const button = document.querySelector("[data-theme-toggle]");
  if (!button) return;
  const dark = document.documentElement.dataset.theme !== "light";
  button.textContent = dark ? "라이트 모드" : "다크 모드";
}
