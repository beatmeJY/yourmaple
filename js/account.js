import { signOut, translateAuthError } from "./auth.js";
import { sfx } from "./effects.js";
import { escapeHtml } from "./format.js";
import { currentSession } from "./session.js";
import { getSupabase } from "./supabase-client.js";
import { notify } from "./toast.js";

// 내 계정 창(헤더 이메일을 누르면 열림): 로그인한 계정, 연결된 로그인 수단, 회원 탈퇴.
// 탈퇴 = delete_my_account(dry_run) 로 준비 확인 → 얼굴 이미지(character-faces/내 id/) 삭제 → delete_my_account() 로 계정 삭제(sql/035) → 모든 기록은 cascade 로 함께 삭제.

const FACE_BUCKET = "character-faces";
const PROVIDER_LABEL = { google: "Google", discord: "Discord", email: "이메일" };
const CONFIRM_WORD = "탈퇴";

function providersOf(user) {
  const fromIdentities = (user?.identities ?? []).map((identity) => identity.provider);
  const list = fromIdentities.length ? fromIdentities : (user?.app_metadata?.providers ?? []);
  return [...new Set(list)];
}

function functionMissing(error) {
  const raw = `${error?.message || ""} ${error?.details || ""} ${error?.code || ""}`;
  return /delete_my_account/i.test(raw) && /could not find|does not exist|schema cache|PGRST202|42883/i.test(raw);
}

async function removeFaces(supabase, userId) {
  const { data, error } = await supabase.storage.from(FACE_BUCKET).list(userId, { limit: 1000 });
  if (error) return { error };
  const paths = (data ?? []).filter((item) => item.name).map((item) => `${userId}/${item.name}`);
  if (!paths.length) return { error: null };
  const removed = await supabase.storage.from(FACE_BUCKET).remove(paths);
  return { error: removed.error ?? null };
}

async function deleteAccount(dialog) {
  const session = currentSession();
  const userId = session?.user?.id;
  if (!userId) return;
  const button = dialog.querySelector("[data-account-delete]");
  button.disabled = true;
  button.classList.add("is-busy");
  const done = (message, tone = "error") => {
    button.disabled = false;
    button.classList.remove("is-busy");
    notify(message, tone);
  };
  const supabase = await getSupabase();
  // 탈퇴 함수가 준비됐는지 먼저 확인한다(sql/035 전이면 이미지만 지워지고 계정이 남지 않게).
  const ready = await supabase.rpc("delete_my_account", { dry_run: true });
  if (ready.error) {
    done(functionMissing(ready.error) ? "탈퇴 기능을 쓰려면 Supabase에서 sql/035_delete_my_account.sql 을 실행해 주세요." : `탈퇴하지 못했습니다. ${translateAuthError(ready.error)}`);
    return;
  }
  const faces = await removeFaces(supabase, userId);
  if (faces.error) {
    done(`얼굴 이미지를 지우지 못해 탈퇴를 멈췄습니다. 잠시 후 다시 시도해 주세요. (${faces.error.message || "저장소 오류"})`);
    return;
  }
  const { error } = await supabase.rpc("delete_my_account", { dry_run: false });
  if (error) {
    done(functionMissing(error) ? "탈퇴 기능을 쓰려면 Supabase에서 sql/035_delete_my_account.sql 을 실행해 주세요." : `탈퇴하지 못했습니다. ${translateAuthError(error)}`);
    return;
  }
  dialog.close();
  sfx("uncheck");
  // 계정이 지워졌으니 서버 로그아웃은 실패할 수 있다. 이 브라우저의 로그인 정보만 지운다.
  await signOut().catch(() => {});
  notify("탈퇴했습니다. 계정과 모든 기록을 지웠어요. 그동안 이용해 주셔서 고마워요.", "info");
}

function ensureDialog() {
  let dialog = document.querySelector("[data-account-dialog]");
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.className = "account-dialog ym-glass";
  dialog.dataset.accountDialog = "";
  document.body.append(dialog);
  dialog.addEventListener("click", async (event) => {
    if (event.target === dialog || event.target.closest("[data-account-close]")) {
      dialog.close();
      return;
    }
    if (event.target.closest("[data-account-delete]")) await deleteAccount(dialog);
  });
  dialog.addEventListener("input", (event) => {
    const input = event.target.closest("[data-account-confirm]");
    if (!input) return;
    dialog.querySelector("[data-account-delete]").disabled = input.value.trim() !== CONFIRM_WORD;
  });
  return dialog;
}

export function openAccountDialog() {
  const user = currentSession()?.user;
  if (!user) return;
  const dialog = ensureDialog();
  const name = user.user_metadata?.full_name || user.user_metadata?.name || "";
  const providers = providersOf(user);
  dialog.innerHTML = `
    <header class="account-head">
      <h2>내 계정</h2>
      <button class="text-button" type="button" data-account-close aria-label="닫기">닫기</button>
    </header>
    <dl class="account-info">
      <div><dt>이메일</dt><dd>${escapeHtml(user.email || "-")}</dd></div>
      ${name ? `<div><dt>이름</dt><dd>${escapeHtml(name)}</dd></div>` : ""}
      <div><dt>로그인 수단</dt><dd class="account-providers">${providers.map((provider) => `<span class="account-provider is-${escapeHtml(provider)}">${escapeHtml(PROVIDER_LABEL[provider] ?? provider)}</span>`).join("") || "-"}</dd></div>
    </dl>
    <p class="account-note">Your Maple은 비밀번호를 보관하지 않아요. 로그인에 필요한 이메일·이름만 Google·Discord에서 받아요. <a href="./privacy.html">개인정보 처리방침</a></p>
    <section class="account-danger">
      <h3>회원 탈퇴</h3>
      <p>계정과 캐릭터·숙제·사냥·무릉·거래·메모 등 <b>모든 기록과 얼굴 이미지</b>를 바로 지워요. 되돌릴 수 없어요.</p>
      <label class="field"><span>확인을 위해 <b>${CONFIRM_WORD}</b>라고 적어 주세요</span><input data-account-confirm autocomplete="off" placeholder="${CONFIRM_WORD}" /></label>
      <button class="account-delete" type="button" data-account-delete disabled>계정과 모든 기록 지우기</button>
    </section>`;
  sfx("tick");
  if (!dialog.open) dialog.showModal();
}
