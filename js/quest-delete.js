// 퀘스트 논리 삭제 확인창(도감 관리자 전용, sql/079). 행은 남기고 공개 퀘스트 정보에서만 숨긴다(몬스터 삭제 monster-delete.js 와 같은 흐름).
import { escapeHtml } from "./format.js";
import { reviewRpc, reviewError } from "./catalog-review.js";
import { clearCatalogCache } from "./catalog-api.js";

const esc = (value) => escapeHtml(String(value ?? ""));

export function openQuestDelete(root, quest, onDeleted) {
  const dialog = document.createElement("dialog");
  dialog.className = "catalog-edit-dialog md-dialog ym-glass";
  dialog.setAttribute("aria-labelledby", "qd-title");
  dialog.innerHTML = `<header><h2 id="qd-title">퀘스트 삭제</h2><button type="button" class="mo-ghost" data-qd-close aria-label="삭제창 닫기">닫기</button></header>
    <form data-qd-form novalidate>
      <p class="md-lead"><strong>${esc(quest.name)}</strong>을(를) 퀘스트 목록·검색·다른 퀘스트의 연속 퀘스트에서 숨겨요.</p>
      <p class="hint">정보는 지우지 않고 남겨 둬요. "삭제한 퀘스트" 화면에서 언제든 되살릴 수 있어요.</p>
      <label><span>삭제 이유 <small>(선택, 관리자만 봐요)</small></span><textarea name="reason" rows="2" maxlength="500" placeholder="예: 메이플랜드에 없는 퀘스트, 중복 퀘스트"></textarea></label>
      <p data-qd-status role="status" class="hint"></p>
      <footer><button type="button" class="mo-ghost" data-qd-close>취소</button><button type="submit" class="md-danger">삭제하기</button></footer>
    </form>`;
  root.append(dialog);
  for (const type of ["click", "input", "change", "submit", "keydown"]) dialog.addEventListener(type, (event) => event.stopPropagation());
  const opener = document.activeElement;
  let saving = false;
  dialog.addEventListener("close", () => { dialog.remove(); if (opener?.isConnected) opener.focus({ preventScroll: true }); }, { once: true });
  dialog.addEventListener("cancel", (event) => { if (saving) event.preventDefault(); });
  dialog.addEventListener("click", (event) => { if (!saving && event.target.closest("[data-qd-close]")) dialog.close(); });
  dialog.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving) return;
    saving = true;
    const status = dialog.querySelector("[data-qd-status]");
    const controls = dialog.querySelectorAll("button,textarea");
    controls.forEach((node) => (node.disabled = true));
    status.classList.remove("is-error");
    status.textContent = "공개 퀘스트 정보에서 숨기고 있습니다.";
    const reason = dialog.querySelector("textarea").value.trim();
    const result = await reviewRpc("catalog_quest_set_deleted", { p_id: quest.id, p_deleted: true, p_reason: reason || null });
    saving = false;
    if (!dialog.isConnected) return;
    if (result.error) {
      controls.forEach((node) => (node.disabled = false));
      status.textContent = /Could not find the function|schema cache|does not exist/i.test(result.error.message || "") ? "퀘스트 삭제를 쓰려면 sql/079를 먼저 실행해 주세요." : reviewError(result.error);
      status.classList.add("is-error");
      return;
    }
    clearCatalogCache();
    dialog.close();
    if (root.isConnected) onDeleted(result.data);
  });
  dialog.showModal();
  dialog.querySelector("textarea").focus();
}
