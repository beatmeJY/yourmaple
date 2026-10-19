import { OAUTH_PROVIDERS, signIn, signInAsGuest, signInWithProvider, signUp } from "../auth.js";
import { notify } from "../toast.js";

export function renderSetup(root, message, title = "설정이 필요합니다") {
  root.innerHTML = `
    <section class="auth-screen">
      <div class="auth-toolbar">
        <p class="brand-mark">Your Maple</p>
      </div>
      <div class="auth-card">
        <h1></h1>
        <p class="setup-message"></p>
      </div>
    </section>
  `;
  root.querySelector("h1").textContent = title;
  root.querySelector(".setup-message").textContent = message;
}

// 로그인 버튼의 서비스 표시(브랜드 기본 모양 그대로)
export const PROVIDER_MARKS = {
  google: `<svg viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"/><path fill="#FBBC05" d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33Z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"/></svg>`,
  discord: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.32 4.37A19.8 19.8 0 0 0 15.4 2.85a13.7 13.7 0 0 0-.63 1.29 18.4 18.4 0 0 0-5.5 0 12.6 12.6 0 0 0-.64-1.29 19.7 19.7 0 0 0-4.92 1.52C.6 9.05-.24 13.62.18 18.12a19.9 19.9 0 0 0 6.03 3.05c.49-.66.92-1.36 1.29-2.1a12.9 12.9 0 0 1-2.03-.97l.5-.39a14.2 14.2 0 0 0 12.06 0l.5.39c-.65.38-1.33.71-2.04.98.37.73.8 1.43 1.29 2.09a19.8 19.8 0 0 0 6.03-3.05c.5-5.22-.84-9.75-3.55-13.75ZM8.02 15.33c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.2 0 2.17 1.1 2.15 2.42 0 1.34-.95 2.42-2.15 2.42Zm7.96 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.2 0 2.17 1.1 2.15 2.42 0 1.34-.94 2.42-2.15 2.42Z"/></svg>`,
};

export function providerButtons(attr) {
  return OAUTH_PROVIDERS.map(
    (provider) => `<button class="auth-provider is-${provider.id}" type="button" ${attr}="${provider.id}">${PROVIDER_MARKS[provider.id]}<span>${provider.label}로 계속하기</span></button>`,
  ).join("");
}

export function renderLogin(root, failure = "") {
  root.innerHTML = `
    <section class="auth-screen">
      <div class="auth-card">
        <img class="auth-logo" src="./apple-touch-icon.png" alt="" width="64" height="64" />
        <h1>Your Maple</h1>
        <p>메이플랜드 강화·무릉·숙제·사냥을 한곳에서 계산하고 기록해요.</p>
        <div class="auth-providers">${providerButtons("data-oauth")}</div>
        <button class="auth-guest" type="button" data-guest>
          <strong>로그인 없이 둘러보기</strong>
          <small>이 브라우저에 임시 계정을 만들어요. 나중에 Google·Discord를 연결하면 기록이 그대로 이어져요.</small>
        </button>
        <details class="auth-email">
          <summary>이메일로 로그인</summary>
        <form id="auth-form">
          <label class="field">
            <span>이메일</span>
            <input name="email" type="email" autocomplete="username" required />
          </label>
          <label class="field">
            <span>비밀번호</span>
            <input name="password" type="password" minlength="6" autocomplete="current-password" required />
          </label>
          <button class="primary-button" type="submit">로그인</button>
        </form>
        <button class="text-button" type="button" data-switch-auth>계정이 없으면 가입</button>
        </details>
        <p class="auth-legal">계속하면 <a href="./terms.html">이용약관</a>과 <a href="./privacy.html">개인정보 처리방침</a>에 동의하는 것으로 봅니다.</p>
      </div>
    </section>
  `;
  if (failure) notify(failure, "error");

  // 구글·디스코드·둘러보기: 누르는 동안 다른 버튼을 막고, 실패하면 이유를 알린다(성공하면 그 사이트로 이동하거나 바로 앱이 열린다).
  const quickButtons = [...root.querySelectorAll("[data-oauth], [data-guest]")];
  async function runQuick(button, action) {
    for (const item of quickButtons) item.disabled = true;
    button.classList.add("is-busy");
    const result = await action().catch((error) => ({ error: error?.message || "로그인 처리 중 문제가 생겼습니다." }));
    if (result.error) {
      notify(result.error, "error");
      for (const item of quickButtons) item.disabled = false;
      button.classList.remove("is-busy");
    }
  }
  for (const button of root.querySelectorAll("[data-oauth]")) {
    button.addEventListener("click", () => runQuick(button, () => signInWithProvider(button.dataset.oauth)));
  }
  const guest = root.querySelector("[data-guest]");
  guest.addEventListener("click", () => runQuick(guest, signInAsGuest));

  const form = root.querySelector("#auth-form");
  const switchButton = root.querySelector("[data-switch-auth]");
  const submitButton = form.querySelector(".primary-button");
  const password = form.elements.password;
  let mode = "login";

  function showMessage(text, kind) {
    notify(text, kind);
  }

  function setMode(next) {
    mode = next;
    const joining = mode === "signup";
    submitButton.textContent = joining ? "가입하기" : "로그인";
    switchButton.textContent = joining ? "이미 계정이 있으면 로그인" : "계정이 없으면 가입";
    password.autocomplete = joining ? "new-password" : "current-password";
    showMessage("", "info");
  }

  switchButton.addEventListener("click", () => {
    setMode(mode === "login" ? "signup" : "login");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = form.elements.email.value.trim();
    const passwordValue = form.elements.password.value;
    submitButton.disabled = true;
    switchButton.disabled = true;
    showMessage("처리 중입니다.", "info");

    try {
      if (mode === "signup") {
        const result = await signUp(email, passwordValue);
        if (result.error) {
          showMessage(result.error, "error");
        } else if (result.needsEmailConfirm) {
          setMode("login");
          showMessage("가입 메일을 보냈습니다. 메일의 링크를 누른 뒤 로그인해 주세요.", "info");
        }
      } else {
        const result = await signIn(email, passwordValue);
        if (result.error) showMessage(result.error, "error");
      }
    } catch (error) {
      showMessage(error?.message || "로그인 처리 중 문제가 생겼습니다.", "error");
    } finally {
      submitButton.disabled = false;
      switchButton.disabled = false;
      if (mode === "signup") submitButton.textContent = "가입하기";
    }
  });
}
