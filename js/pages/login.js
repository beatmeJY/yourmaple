import { signIn, signUp } from "../auth.js";
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

export function renderLogin(root) {
  root.innerHTML = `
    <section class="auth-screen">
      <div class="auth-card">
        <img class="auth-logo" src="./apple-touch-icon.png" alt="" width="64" height="64" />
        <h1>Your Maple</h1>
        <p>로그인한 계정만 내 데이터를 볼 수 있습니다.</p>
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
      </div>
    </section>
  `;

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
