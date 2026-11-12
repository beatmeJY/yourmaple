import { escapeHtml } from "./format.js";
import { isLoggedIn } from "./session.js";

export function showGuestPreview(root, action) {
  if (isLoggedIn()) return false;

  const header = root.querySelector("header");
  const notice = document.createElement("div");
  notice.className = "ym-glass guest-preview";
  notice.innerHTML = `
    <p>화면을 둘러볼 수 있어요. 내 기록을 확인하거나 저장하려면 로그인해 주세요.</p>
    <button class="ym-add" type="button" data-login-open>${escapeHtml(action)}</button>
  `;
  header.after(notice);
  const workspace = root.querySelector("[data-workspace]");
  if (workspace) workspace.hidden = false;
  const actions = root.querySelector("[data-character-actions]");
  if (actions) actions.hidden = false;
  for (const button of header.querySelectorAll("button")) button.dataset.loginOpen = "";
  for (const child of header.parentElement.children) {
    if (child === header || child === notice) continue;
    child.inert = true;
  }
  for (const selector of ["[data-cards]", "[data-hunt-list]", "[data-list]", "[data-rows]"]) {
    const list = root.querySelector(selector);
    if (list) list.textContent = "로그인하면 내 기록이 여기에 표시돼요.";
  }
  return true;
}
