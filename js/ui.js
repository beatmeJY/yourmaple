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

// 2026-10 다크 글래스 리디자인부터 다크 전용이다. 예전에 저장한 라이트 설정은 지운다.
export function applyDarkTheme() {
  document.documentElement.dataset.theme = "dark";
  localStorage.removeItem(THEME_KEY);
}

// 배경 색 구슬과 커서를 따라오는 빛. 로그인 화면과 앱 화면이 함께 쓰도록 body에 한 번만 붙인다.
export function mountAmbient() {
  if (document.querySelector(".ambient")) return;
  const ambient = document.createElement("div");
  ambient.className = "ambient";
  ambient.setAttribute("aria-hidden", "true");
  ambient.innerHTML = `<i class="ambient-orb is-violet"></i><i class="ambient-orb is-coral"></i><i class="ambient-orb is-blue"></i><i class="ambient-glow"></i>`;
  document.body.prepend(ambient);
  const glow = ambient.querySelector(".ambient-glow");
  const quiet = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(pointer: fine)");
  let frame = 0;
  let point = null;
  window.addEventListener("pointermove", (event) => {
    if (quiet.matches || !finePointer.matches) return;
    point = { x: event.clientX, y: event.clientY };
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      glow.style.transform = `translate(${point.x - 260}px, ${point.y - 260}px)`;
      glow.classList.add("is-on");
    });
  }, { passive: true });
  document.addEventListener("pointerleave", () => glow.classList.remove("is-on"));
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
          <img class="brand-logo" src="./apple-touch-icon.png" alt="" width="40" height="40" />
          <strong>Your Maple</strong>
          <span>메이플 도우미</span>
          <button class="nav-toggle nav-close" type="button" data-close-nav aria-label="메뉴 닫기">${NAV_CHEVRON}</button>
        </div>
        <nav class="nav" id="nav" aria-label="주요 메뉴"></nav>
        </div>
      </aside>
      <div class="content">
        <header class="topbar">
          <button class="nav-toggle" type="button" data-open-nav aria-controls="sidebar" aria-expanded="true" aria-label="메뉴 닫기">${NAV_CHEVRON}</button>
          <nav class="topbar-crumb" data-crumb aria-label="현재 위치"></nav>
          <div class="feature-search" data-feature-search>
            <label class="feature-search-field">
              <span class="ym-search-icon" aria-hidden="true"></span>
              <input type="search" placeholder="기능 찾기" aria-label="기능 찾기" autocomplete="off" role="combobox" aria-controls="feature-results" aria-expanded="false" />
              <kbd aria-hidden="true">/</kbd>
            </label>
            <div class="feature-search-results" id="feature-results" data-feature-results role="listbox" aria-label="기능 목록"></div>
          </div>
          <div class="topbar-actions">
            <button class="feature-search-open" type="button" data-feature-search-open aria-label="기능 찾기"><span class="ym-search-icon" aria-hidden="true"></span></button>
            <div class="topbar-profile-wrap">
              <button class="topbar-profile" type="button" data-profile-toggle aria-haspopup="menu" aria-expanded="false" aria-label="대표 캐릭터 고르기"></button>
              <div class="profile-menu ym-glass" data-profile-menu hidden></div>
            </div>
            <button class="sound-toggle" type="button" data-sound-toggle aria-pressed="true"><i aria-hidden="true"></i><span>효과음 켜짐</span></button>
            <p class="account-email" id="account-email"></p>
            <button class="icon-button" type="button" data-logout>로그아웃</button>
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
