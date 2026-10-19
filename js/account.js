import { translateDbError } from "./db-error.js";
import { burstAt, sfx } from "./effects.js";
import { escapeHtml } from "./format.js";
import { currentSession } from "./session.js";
import { getSupabase } from "./supabase-client.js";
import { notify } from "./toast.js";

// 내 계정 창(헤더 이메일을 누르면 열림): 로그인한 계정, 연결된 로그인 수단, 회원 탈퇴.
// 탈퇴는 7일 유예(2026-10-19, 실수로 즉시 탈퇴해 기록을 잃은 일 뒤 사용자 요청, sql/036):
//   본인 이메일을 똑같이 적어야 "탈퇴 신청" → account_deletions 에 한 줄(7일 뒤 삭제 예정) → 그 사이 "탈퇴 취소"로 되돌림.
//   7일이 지나면 매일 예약 작업이 계정을 지우고, 모든 기록은 cascade 로 함께 지워진다.

const PROVIDER_LABEL = { google: "Google", discord: "Discord", email: "이메일" };

let pending = null; // { requested_at, delete_after } | null — 탈퇴 대기 중이면 값이 있다
let ready = true; // sql/036 실행 여부

function providersOf(user) {
  const fromIdentities = (user?.identities ?? []).map((identity) => identity.provider);
  const list = fromIdentities.length ? fromIdentities : (user?.app_metadata?.providers ?? []);
  return [...new Set(list)];
}

function tableMissing(error) {
  const raw = `${error?.message || ""} ${error?.details || ""} ${error?.code || ""}`;
  return /account_deletions/i.test(raw) && /does not exist|schema cache|could not find|42P01|PGRST205/i.test(raw);
}

function stamp(value) {
  const date = new Date(value);
  const two = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}.${two(date.getMonth() + 1)}.${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

function daysLeft(value) {
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000));
}

// 확인 문구: 본인 이메일(대소문자 무시). 이메일이 없는 계정이면 "탈퇴".
function confirmWord(user) {
  return user?.email || "탈퇴";
}

/** 로그인할 때마다 부른다: 탈퇴 대기 중인지 읽고, 대기 중이면 화면 위에 띠를 보인다. */
export async function checkPendingDeletion() {
  pending = null;
  if (!currentSession()?.user) {
    paintBanner();
    return;
  }
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("account_deletions").select("requested_at, delete_after").maybeSingle();
  ready = !(error && tableMissing(error));
  pending = error ? null : (data ?? null);
  paintBanner();
}

function paintBanner() {
  let banner = document.querySelector("[data-deletion-banner]");
  if (!pending) {
    banner?.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement("div");
    banner.className = "deletion-banner";
    banner.dataset.deletionBanner = "";
    banner.setAttribute("role", "status");
    document.body.append(banner);
  }
  banner.innerHTML = `<span><b>탈퇴 대기 중</b> · ${escapeHtml(stamp(pending.delete_after))} 이후 계정과 모든 기록이 지워져요 (${daysLeft(pending.delete_after)}일 남음)</span><button type="button" data-account-open>탈퇴 취소하기</button>`;
}

async function requestDeletion(dialog) {
  const user = currentSession()?.user;
  if (!user) return;
  const input = dialog.querySelector("[data-account-confirm]");
  if (input.value.trim().toLowerCase() !== confirmWord(user).toLowerCase()) {
    notify("확인 문구가 계정 이메일과 다릅니다.", "error");
    input.focus();
    return;
  }
  const button = dialog.querySelector("[data-account-request]");
  button.disabled = true;
  const supabase = await getSupabase();
  // 신청 시각·7일 뒤 삭제 시각은 서버(sql/036 트리거)가 정한다.
  const { data, error } = await supabase.from("account_deletions").insert({}).select("requested_at, delete_after").single();
  button.disabled = false;
  if (error) {
    notify(tableMissing(error) ? "탈퇴 유예 기능을 쓰려면 Supabase에서 sql/036_account_deletion_grace.sql 을 실행해 주세요." : translateDbError(error), "error");
    return;
  }
  pending = data;
  paintBanner();
  sfx("uncheck");
  paint(dialog);
  notify(`탈퇴를 신청했어요. ${stamp(data.delete_after)} 전까지는 언제든 취소할 수 있어요.`, "info");
}

async function cancelDeletion(dialog) {
  const button = dialog.querySelector("[data-account-cancel]");
  button.disabled = true;
  const supabase = await getSupabase();
  const userId = currentSession()?.user?.id;
  const { error } = await supabase.from("account_deletions").delete().eq("user_id", userId);
  button.disabled = false;
  if (error) {
    notify(translateDbError(error), "error");
    return;
  }
  pending = null;
  paintBanner();
  sfx("check");
  paint(dialog);
  burstAt(dialog.querySelector(".account-head h2"), ["#9ff0c4", "#ffe28a", "#ffffff"], 18, 0.8);
  notify("탈퇴를 취소했어요. 계정과 기록이 그대로 남아요.", "info");
}

function dangerHtml(user) {
  if (!ready) {
    return `<section class="account-danger"><h3>회원 탈퇴</h3><p>탈퇴 기능을 준비하고 있어요. 운영자가 Supabase에서 sql/036_account_deletion_grace.sql 을 실행하면 쓸 수 있어요.</p></section>`;
  }
  if (pending) {
    return `<section class="account-danger is-pending">
      <h3>탈퇴 대기 중</h3>
      <p><b>${escapeHtml(stamp(pending.delete_after))}</b> 이후 계정과 모든 기록이 지워져요(${daysLeft(pending.delete_after)}일 남음). 그 전에는 아래 버튼으로 언제든 취소할 수 있어요.</p>
      <button class="account-cancel" type="button" data-account-cancel>탈퇴 취소하기</button>
    </section>`;
  }
  const word = confirmWord(user);
  return `<section class="account-danger">
    <h3>회원 탈퇴</h3>
    <p>신청하면 <b>7일 뒤</b> 계정과 캐릭터·숙제·사냥·무릉·거래·메모 등 <b>모든 기록과 얼굴 이미지</b>가 지워져요. 7일 안에는 여기서 취소할 수 있고, 지워진 뒤에는 되돌릴 수 없어요.</p>
    <label class="field"><span>확인을 위해 계정 이메일 <b>${escapeHtml(word)}</b>을 똑같이 적어 주세요</span><input data-account-confirm autocomplete="off" spellcheck="false" placeholder="${escapeHtml(word)}" /></label>
    <button class="account-delete" type="button" data-account-request disabled>7일 뒤 탈퇴 신청</button>
  </section>`;
}

function paint(dialog) {
  const user = currentSession()?.user;
  if (!user) return;
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
    ${dangerHtml(user)}`;
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
    if (event.target.closest("[data-account-request]")) await requestDeletion(dialog);
    if (event.target.closest("[data-account-cancel]")) await cancelDeletion(dialog);
  });
  dialog.addEventListener("input", (event) => {
    const input = event.target.closest("[data-account-confirm]");
    if (!input) return;
    const word = confirmWord(currentSession()?.user).toLowerCase();
    dialog.querySelector("[data-account-request]").disabled = input.value.trim().toLowerCase() !== word;
  });
  return dialog;
}

export async function openAccountDialog() {
  if (!currentSession()?.user) return;
  const dialog = ensureDialog();
  paint(dialog);
  sfx("tick");
  if (!dialog.open) dialog.showModal();
  // 열 때마다 대기 상태를 새로 읽는다(다른 기기에서 취소했을 수 있다).
  await checkPendingDeletion();
  if (dialog.open) paint(dialog);
}
