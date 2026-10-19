import { accountLabel, isAnonymous, linkProvider, signOut, startAuth, translateAuthError } from "./auth.js";
import { closeLinkPanel, isLinkPanelOpen, openLinkPanel } from "./link-panel.js";
import { providerButtons, renderLogin, renderSetup } from "./pages/login.js";
import { renderCrumb, renderNav, renderRoute, toggleNavCategory } from "./router.js";
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
let currentSession = null;
let pendingAuthError = "";

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
    mountFeatureSearch();
    mountProfile();
    mode = "app";
  }
  currentSession = session;
  const email = document.querySelector("#account-email");
  if (email) email.textContent = accountLabel(session);
  // 임시 계정(로그인 없이 둘러보기)이면 "계정 연결"을 보인다. 연결하면 다른 기기에서도 같은 기록으로 로그인할 수 있다.
  const linkButton = document.querySelector("[data-link-account]");
  if (linkButton) linkButton.hidden = !isAnonymous(session);
  if (entered) showPage();
}

function showLogin(failure = "") {
  currentSession = null;
  renderLogin(app, failure);
  mode = "login";
}

// 임시 계정에 구글·디스코드를 연결하는 창. 처음 열 때 만든다.
function openLinkAccount() {
  let dialog = document.querySelector("[data-link-account-dialog]");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.className = "link-account-dialog ym-glass";
    dialog.dataset.linkAccountDialog = "";
    dialog.innerHTML = `
      <h2>계정 연결</h2>
      <p>지금은 이 브라우저에만 있는 임시 계정이에요. Google이나 Discord를 연결하면 지금까지의 기록이 그대로 이어지고, 다른 기기에서도 로그인할 수 있어요.</p>
      <div class="auth-providers">${providerButtons("data-link-provider")}</div>
      <button class="text-button" type="button" data-link-account-close>나중에</button>`;
    document.body.append(dialog);
    dialog.addEventListener("click", async (event) => {
      if (event.target === dialog || event.target.closest("[data-link-account-close]")) {
        dialog.close();
        return;
      }
      const button = event.target.closest("[data-link-provider]");
      if (!button) return;
      const buttons = [...dialog.querySelectorAll("[data-link-provider]")];
      for (const item of buttons) item.disabled = true;
      button.classList.add("is-busy");
      const result = await linkProvider(button.dataset.linkProvider).catch((error) => ({ error: error?.message || "계정 연결 중 문제가 생겼습니다." }));
      // 성공하면 그 사이트로 이동한다. 실패했을 때만 여기로 온다.
      if (result.error) {
        notify(result.error, "error");
        for (const item of buttons) item.disabled = false;
        button.classList.remove("is-busy");
      }
    });
  }
  sfx("tick");
  if (!dialog.open) dialog.showModal();
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
  if (event.target.closest("[data-link-account]")) {
    openLinkAccount();
    return;
  }
  if (event.target.closest("[data-logout]")) {
    const button = event.target.closest("[data-logout]");
    // 임시 계정은 로그아웃하면 다시 들어올 방법이 없다(그 기록도 못 찾는다). 먼저 묻는다.
    if (isAnonymous(currentSession) && !window.confirm("임시 계정에서 로그아웃하면 다시 들어올 수 없고, 지금까지의 기록도 찾을 수 없어요. 먼저 '계정 연결'로 Google·Discord를 연결하는 걸 권해요. 그래도 로그아웃할까요?")) return;
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
  if (session) {
    showApp(session);
    if (failure) notify(failure, "error");
  } else if (mode !== "login") showLogin(failure);
  else if (failure) notify(failure, "error");
});
