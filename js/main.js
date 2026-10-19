import { openAccountDialog } from "./account.js";
import { accountLabel, signOut, startAuth, translateAuthError } from "./auth.js";
import { closeLinkPanel, isLinkPanelOpen, openLinkPanel } from "./link-panel.js";
import { renderLogin, renderSetup } from "./pages/login.js";
import { getRouteId, renderCrumb, renderNav, renderRoute, toggleNavCategory } from "./router.js";
import { needsLogin, routes } from "./routes.js";
import { cancelLogin, currentSession, isLoggedIn, onLoginRequest, pendingReason, rememberNext, setSession, takeNext } from "./session.js";
import { isSoundOn, setSoundOn, sfx } from "./effects.js";
import { mountFeatureSearch } from "./feature-search.js";
import { mountProfile } from "./profile.js";
import { clearToasts, notify } from "./toast.js";
import { applyDarkTheme, applyNavPreference, isDesktopNav, mountAmbient, renderShell, setNavCollapsed, setNavOpen } from "./ui.js";

applyDarkTheme();
mountAmbient();
applyNavPreference();

const app = document.querySelector("#app");
let mode = "loading";
let shellUser = null;
let pendingAuthError = "";

function renderLoading() {
  app.innerHTML = `<p class="boot">로그인 상태를 확인하고 있습니다.</p>`;
  mode = "loading";
}

async function showPage() {
  const main = document.querySelector("#main");
  const nav = document.querySelector("#nav");
  if (!main || !nav) return;
  // 내 기록 화면(캐릭터·숙제·사냥 등)은 로그인해야 연다. 로그인하면 이 화면으로 돌아온다.
  const routeId = getRouteId();
  if (needsLogin(routeId) && !isLoggedIn()) {
    const label = routes.find((route) => route.id === routeId)?.label ?? "이 화면";
    rememberNext(routeId, `${label} 화면은 내 계정의 기록을 보여 줘서 로그인해야 열려요.`);
    showLogin({ reason: pendingReason() });
    return;
  }
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

// 로그인 없이도 앱을 연다(2026-10-19). session 이 없으면 계산기·홈 소개만 쓰고, 저장하거나 내 기록 화면을 열 때 로그인 화면을 띄운다.
function showApp(session) {
  const userId = session?.user?.id ?? "";
  // 처음 열 때, 로그인 화면에서 돌아올 때, 로그인·로그아웃으로 사용자가 바뀔 때는 틀부터 다시 그린다.
  const entered = mode !== "app" || shellUser !== userId;
  setSession(session);
  if (entered) {
    clearToasts();
    renderShell();
    syncSoundToggle();
    mountFeatureSearch();
    if (userId) mountProfile();
    mode = "app";
    shellUser = userId;
  }
  const email = document.querySelector("#account-email");
  if (email) email.textContent = accountLabel(session);
  for (const node of document.querySelectorAll("[data-logged-in]")) node.hidden = !userId;
  for (const node of document.querySelectorAll("[data-logged-out]")) node.hidden = Boolean(userId);
  if (!entered) return;
  // 로그인하고 돌아왔으면 저장하려던 화면으로 간다(그 화면이 맡겨 둔 입력값을 되살린다).
  const next = userId ? takeNext() : null;
  if (next?.route && `#/${next.route}` !== location.hash.split("?")[0]) location.hash = `#/${next.route}`;
  else showPage();
}

function showLogin({ failure = "", reason = "" } = {}) {
  renderLogin(app, { failure, reason });
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
    if (!isLoggedIn()) {
      rememberNext(getRouteId(), "링크는 로그인한 계정에 저장돼요.");
      showLogin({ reason: pendingReason() });
      return;
    }
    openLinkPanel();
    return;
  }
  if (event.target.closest("[data-account-open]")) {
    openAccountDialog();
    return;
  }
  if (event.target.closest("[data-login-open]")) {
    sfx("tick");
    rememberNext(getRouteId(), "");
    showLogin();
    return;
  }
  // 로그인 화면에서 "돌아가기": 저장하려던 값은 버리고, 내 기록 화면이었으면 홈으로 간다.
  if (event.target.closest("[data-login-cancel]")) {
    sfx("tick");
    cancelLogin();
    if (needsLogin(getRouteId())) history.replaceState(null, "", `${location.pathname}${location.search}#/dashboard`);
    mode = "loading";
    showApp(currentSession());
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
  // 구글·디스코드에서 로그인·계정 연결을 취소했거나 실패해서 돌아온 경우. 세션 확인보다 먼저 오므로,
  // 이유를 들고 있다가 다음 화면(앱 또는 로그인)을 그린 뒤 알린다.
  if (event === "OAUTH_ERROR") {
    pendingAuthError = error?.message || "로그인하지 못했습니다.";
    if (mode === "app") {
      notify(pendingAuthError, "error");
      pendingAuthError = "";
    }
    return;
  }
  const failure = pendingAuthError;
  pendingAuthError = "";
  // 로그인 화면에 있는 동안 로그인 전 상태가 다시 오면(토큰 갱신 실패 등) 그대로 둔다.
  if (!session && mode === "login") {
    if (failure) notify(failure, "error");
    return;
  }
  // 로그인 실패로 돌아왔으면 로그인 화면에 이유를 보여 준다.
  if (!session && failure) {
    showLogin({ failure, reason: pendingReason() });
    return;
  }
  showApp(session);
  if (failure) notify(failure, "error");
});

// 계산기 화면이 저장 버튼에서 부른다(requireLogin): 입력값은 session.js 가 맡아 두었다.
onLoginRequest((reason) => {
  sfx("tick");
  showLogin({ reason });
});
