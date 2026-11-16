// 몬스터 도감 수정창(도감 관리자 전용, sql/069). 아이템 수정창(catalog-item-editor.js)과 같은 흐름:
// 불러오기 → 고치기 → 저장하면 공개 도감에 바로 반영, 다른 화면에서 먼저 고쳤으면 저장을 막는다.
import { escapeHtml } from "./format.js";
import { reviewRpc, reviewError } from "./catalog-review.js";
import { clearCatalogCache } from "./catalog-api.js";
import { elements } from "./monster-merge.js";
import { monsterEditFields, readMonsterDraft } from "./monster-edit.js";

const esc = (value) => escapeHtml(String(value ?? ""));
const groups = [
  ["기본", ["level", "hp", "exp", "mp"]],
  ["명중", ["required_accuracy", "accuracy_reference_level", "accuracy_per_level"]],
  ["전투", ["physical_attack", "magic_attack", "physical_defense", "magic_defense", "movement_speed", "knockback_damage", "meso_value"]],
];
const label = Object.fromEntries(monsterEditFields.map(([key, name]) => [key, name]));

function field(key, value) {
  return `<label><span>${esc(label[key])}</span><input name="${esc(key)}" inputmode="decimal" autocomplete="off" value="${esc(value)}" placeholder="미제공"></label>`;
}

function elementPicks(group, picked) {
  return `<div class="catalog-edit-els" role="group" aria-label="${group === "weak" ? "약점 속성" : "반감 속성"}">${elements
    .map((name) => `<label class="catalog-edit-el element-chip" data-element="${esc(name)}"><input type="checkbox" name="${group}" value="${esc(name)}"${picked.includes(name) ? " checked" : ""}><span>${esc(name)}</span></label>`)
    .join("")}</div>`;
}

export function monsterEditForm(draft) {
  return `<form data-monster-edit-form novalidate>
    <label><span>몬스터 이름</span><input name="name" maxlength="200" autocomplete="off" value="${esc(draft.name)}"></label>
    ${groups.map(([title, keys]) => `<section><h3>${esc(title)}</h3><div class="catalog-edit-grid">${keys.map((key) => field(key, draft[key])).join("")}</div></section>`).join("")}
    <section><h3>속성</h3><p class="hint">한 속성을 약점과 반감에 함께 둘 수 없어요.</p>
      <div class="catalog-edit-el-row"><span>약점</span>${elementPicks("weak", draft.weak_elements ?? [])}</div>
      <div class="catalog-edit-el-row"><span>반감</span>${elementPicks("resist", draft.resist_elements ?? [])}</div>
    </section>
    <p class="hint">빈칸은 "미제공", 0은 실제 값입니다. 저장하면 공개 도감에 바로 반영되고 변경 이력에 남습니다.</p>
    <p data-edit-status role="status"></p>
    <div data-close-warning hidden><p>저장하지 않은 변경을 버리고 닫을까요?</p><button type="button" class="mo-ghost" data-discard-edit>변경을 버리고 닫기</button></div>
    <footer><button type="button" class="mo-ghost" data-close-edit>취소</button><button type="submit" class="primary-button">수정 저장 · 공개 반영</button></footer>
  </form>`;
}

function readForm(form) {
  const data = new FormData(form);
  const values = { name: data.get("name"), weak: data.getAll("weak"), resist: data.getAll("resist") };
  for (const [key] of monsterEditFields) values[key] = data.get(key);
  return readMonsterDraft(values);
}

export function mountMonsterEditor(button, root, id, onSaved) {
  button.setAttribute("aria-haspopup", "dialog");
  let dialog;
  button.addEventListener("click", async () => {
    if (dialog?.isConnected) return;
    dialog = document.createElement("dialog");
    dialog.className = "catalog-edit-dialog ym-glass";
    dialog.setAttribute("aria-labelledby", "monster-edit-title");
    dialog.innerHTML = '<header><h2 id="monster-edit-title">몬스터 수정</h2><button type="button" class="mo-ghost" data-close-edit aria-label="수정창 닫기">닫기</button></header><div data-edit-body><p class="hint">수정할 정보를 불러오는 중입니다.</p></div>';
    root.append(dialog);
    // 몬스터 화면의 검색·필터 처리기가 수정창 입력을 받지 않게 막는다.
    for (const type of ["click", "input", "change", "submit", "keydown"]) dialog.addEventListener(type, (event) => event.stopPropagation());
    dialog.showModal();
    const active = dialog;
    let dirty = false, saving = false;
    const close = () => {
      if (saving) return;
      if (dirty) { const warning = active.querySelector("[data-close-warning]"); if (warning) { warning.hidden = false; return; } }
      active.close();
    };
    active.addEventListener("close", () => { active.remove(); if (button.isConnected) button.focus({ preventScroll: true }); }, { once: true });
    active.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
    active.addEventListener("click", (event) => {
      if (event.target.closest("[data-discard-edit]")) { dirty = false; close(); }
      else if (event.target.closest("[data-close-edit]")) close();
    });
    active.addEventListener("input", () => { dirty = true; const warning = active.querySelector("[data-close-warning]"); if (warning) warning.hidden = true; });

    const result = await reviewRpc("catalog_monster_edit_detail", { p_id: id });
    if (!active.isConnected || !active.open) return;
    const body = active.querySelector("[data-edit-body]");
    if (result.error || !result.data?.draft) {
      const missing = /Could not find the function|schema cache/i.test(result.error?.message || "");
      body.innerHTML = `<p class="hint" role="alert">${esc(missing ? "몬스터 수정을 쓰려면 sql/069를 먼저 실행해 주세요." : result.error ? reviewError(result.error) : "몬스터를 찾을 수 없습니다.")}</p>`;
      return;
    }
    body.innerHTML = monsterEditForm(result.data.draft);
    active.querySelector('input[name="name"]')?.focus();
    active.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (saving) return;
      const status = active.querySelector("[data-edit-status]");
      let draft;
      try { draft = readForm(active.querySelector("form")); }
      catch (error) { status.textContent = error.message; status.classList.add("is-error"); return; }
      saving = true;
      status.classList.remove("is-error");
      status.textContent = "공개 도감에 반영하고 있습니다.";
      const controls = active.querySelectorAll("button,input");
      controls.forEach((node) => (node.disabled = true));
      const saved = await reviewRpc("catalog_monster_edit_save", { p_id: id, p_version: result.data.version, p_draft: draft });
      saving = false;
      if (!active.isConnected) return;
      if (saved.error) {
        controls.forEach((node) => (node.disabled = false));
        status.textContent = reviewError(saved.error);
        status.classList.add("is-error");
        return;
      }
      clearCatalogCache();
      dirty = false;
      active.close();
      if (root.isConnected) await onSaved(saved.data);
    });
  });
}
