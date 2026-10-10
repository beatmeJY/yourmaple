import { signOut, startAuth, translateAuthError } from "./auth.js";
import { closeLinkPanel, isLinkPanelOpen, openLinkPanel } from "./link-panel.js";
import { renderLogin, renderSetup } from "./pages/login.js";
import { renderCrumb, renderNav, renderRoute, toggleNavCategory } from "./router.js";
import { isSoundOn, setSoundOn, sfx } from "./effects.js";
import { clearToasts, notify } from "./toast.js";
import { applyDarkTheme, applyNavPreference, isDesktopNav, mountAmbient, renderShell, setNavCollapsed, setNavOpen } from "./ui.js";

applyDarkTheme();
mountAmbient();
applyNavPreference();

const app = document.querySelector("#app");
let mode = "loading";

function renderLoading() {
  app.innerHTML = `<p class="boot">로그인 상태를 확인하고 있습니다.</p>`;
  mode = "loading";
}

async function showPage() {
  const main = document.querySelector("#main");
  const nav = document.querySelector("#nav");
  if (!main || !nav) return;
  // renderRoute 가 #main 을 새 요소로 바꾸므로(이전 화면의 처리기 정리) 화면 이름은 그 안에서 적는다.
  const activeId = await renderRoute(main);
  if (!activeId) return;
  renderNav(nav, activeId);
  renderCrumb(document.querySelector("[data-crumb]"), activeId);
  setNavOpen(false);
  closeLinkPanel();
}

function syncSoundToggle() {
  const button = document.querySelector("[data-sound-toggle]");
  if (!button) return;
  const on = isSoundOn();
  button.setAttribute("aria-pressed", String(on));
  button.querySelector("span").textContent = on ? "효과음 켜짐" : "효과음 꺼짐";
}

function showApp(session) {
  const entered = mode !== "app";
  if (entered) {
    clearToasts();
    renderShell();
    syncSoundToggle();
    mode = "app";
  }
  const email = document.querySelector("#account-email");
  if (email) email.textContent = session?.user?.email ?? "";
  if (entered) showPage();
}

function showLogin() {
  renderLogin(app);
  mode = "login";
}

function showSetup(error) {
  const message = translateAuthError(error);
  const title = message.includes("라이브러리") ? "연결할 수 없습니다" : "설정이 필요합니다";
  renderSetup(app, message, title);
  mode = "setup";
}

document.body.addEventListener("click", async (event) => {
  const navCategory = event.target.closest("[data-nav-cat]");
  if (navCategory) {
    sfx("tick");
    toggleNavCategory(navCategory);
    return;
  }
  if (event.target.closest(".nav-sub, .nav-home")) sfx("tick");
  if (event.target.closest("[data-sound-toggle]")) {
    const on = !isSoundOn();
    setSoundOn(on);
    syncSoundToggle();
    if (on) sfx("check");
    return;
  }
  if (event.target.closest("[data-open-nav]")) {
    if (isDesktopNav()) setNavCollapsed(!document.body.classList.contains("nav-collapsed"));
    else setNavOpen(true);
  }
  if (event.target.closest("[data-close-nav]")) {
    if (isDesktopNav()) setNavCollapsed(true);
    else setNavOpen(false);
  }
  if (event.target.closest("[data-quick-nav='links']")) {
    if (!isDesktopNav()) setNavOpen(false);
    openLinkPanel();
    return;
  }
  if (event.target.closest("[data-link-panel-close], [data-link-panel-manage]")) {
    closeLinkPanel();
  }
  const openLinkButton = event.target.closest("[data-open-link]");
  if (openLinkButton) {
    closeLinkPanel();
    window.open(openLinkButton.dataset.openLink, "_blank", "noopener,noreferrer");
    return;
  }
  if (event.target.closest("[data-logout]")) {
    const button = event.target.closest("[data-logout]");
    button.disabled = true;
    try {
      await signOut();
    } catch (error) {
      button.disabled = false;
      notify(translateAuthError(error), "error");
    }
  }
});

document.body.addEventListener(
  "error",
  (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.matches("[data-favicon]")) return;
    image.hidden = true;
    const letter = image.parentElement?.querySelector(".link-mark-letter");
    if (letter) letter.hidden = false;
  },
  true,
);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && isLinkPanelOpen()) closeLinkPanel();
});

window.addEventListener("hashchange", () => {
  if (mode === "app") showPage();
});

renderLoading();
startAuth((session, event, error) => {
  if (event === "CONFIG_ERROR") {
    showSetup(error);
    return;
  }
  if (session) showApp(session);
  else if (mode !== "login") showLogin();
});
