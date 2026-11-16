// 몬스터 논리 삭제 확인창(도감 관리자 전용, sql/071). 행은 남기고 공개 도감에서만 숨긴다.
import { escapeHtml } from "./format.js";
import { reviewRpc, reviewError } from "./catalog-review.js";
import { clearCatalogCache } from "./catalog-api.js";

const esc = (value) => escapeHtml(String(value ?? ""));

export function openMonsterDelete(root, row, onDeleted) {
  const dialog = document.createElement("dialog");
  dialog.className = "catalog-edit-dialog md-dialog ym-glass";
  dialog.setAttribute("aria-labelledby", "md-title");
  dialog.innerHTML = `<header><h2 id="md-title">몬스터 삭제</h2><button type="button" class="mo-ghost" data-md-close aria-label="삭제창 닫기">닫기</button></header>
    <form data-md-form novalidate>
      <p class="md-lead"><strong>${esc(row.name)}</strong>을(를) 공개 도감·검색·아이템의 드랍 몬스터에서 숨겨요.</p>
      <p class="hint">정보와 드랍은 지우지 않고 남겨 둬요. "삭제한 몬스터" 화면에서 언제든 복구할 수 있어요.</p>
      <label><span>삭제 이유 <small>(선택, 관리자만 봐요)</small></span><textarea name="reason" rows="2" maxlength="500" placeholder="예: 중복 몬스터, 메이플랜드에 없는 몬스터"></textarea></label>
      <p data-md-status role="status" class="hint"></p>
      <footer><button type="button" class="mo-ghost" data-md-close>취소</button><button type="submit" class="md-danger">삭제하기</button></footer>
    </form>`;
  root.append(dialog);
  for (const type of ["click", "input", "change", "submit", "keydown"]) dialog.addEventListener(type, (event) => event.stopPropagation());
  const opener = document.activeElement;
  let saving = false;
  dialog.addEventListener("close", () => { dialog.remove(); if (opener?.isConnected) opener.focus({ preventScroll: true }); }, { once: true });
  dialog.addEventListener("cancel", (event) => { if (saving) event.preventDefault(); });
  dialog.addEventListener("click", (event) => { if (!saving && event.target.closest("[data-md-close]")) dialog.close(); });
  dialog.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving) return;
    saving = true;
    const status = dialog.querySelector("[data-md-status]");
    const controls = dialog.querySelectorAll("button,textarea");
    controls.forEach((node) => (node.disabled = true));
    status.classList.remove("is-error");
    status.textContent = "공개 도감에서 숨기고 있습니다.";
    const reason = dialog.querySelector("textarea").value.trim();
    const result = await reviewRpc("catalog_monster_set_deleted", { p_id: row.id, p_deleted: true, p_reason: reason || null });
    saving = false;
    if (!dialog.isConnected) return;
    if (result.error) {
      controls.forEach((node) => (node.disabled = false));
      status.textContent = /Could not find the function|schema cache|does not exist/i.test(result.error.message || "") ? "몬스터 삭제를 쓰려면 sql/071을 먼저 실행해 주세요." : reviewError(result.error);
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
