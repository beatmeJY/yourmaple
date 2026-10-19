import { ConfigError, getSupabase } from "./supabase-client.js";

const knownErrors = [
  ["Invalid login credentials", "이메일 또는 비밀번호가 맞지 않습니다."],
  ["Email not confirmed", "이메일 인증이 끝나지 않았습니다. 메일함의 링크를 누른 뒤 다시 로그인하세요."],
  ["User already registered", "이미 가입된 이메일입니다. 로그인을 선택해 주세요."],
  ["Password should be at least", "비밀번호가 너무 짧습니다. 6자 이상으로 다시 입력하세요."],
  ["Unable to validate email", "이메일 형식을 확인해 주세요."],
  ["Signup requires a valid password", "비밀번호를 입력해 주세요."],
  ["email rate limit exceeded", "인증 메일을 너무 많이 요청했습니다. 잠시 후 다시 시도하세요."],
  ["For security purposes", "요청이 너무 빠릅니다. 잠시 후 다시 시도하세요."],
  ["Anonymous sign-ins are disabled", "둘러보기(익명 로그인)가 아직 꺼져 있습니다. Supabase → Authentication → Sign In / Providers 에서 Anonymous sign-ins 를 켜 주세요."],
  ["provider is not enabled", "이 로그인 방식이 아직 꺼져 있습니다. Supabase → Authentication → Sign In / Providers 에서 Google·Discord 를 켜 주세요."],
  ["Manual linking is disabled", "계정 연결이 아직 꺼져 있습니다. Supabase → Authentication → Sign In / Providers 의 Allow manual linking 을 켜 주세요."],
  ["Identity is already linked to another user", "이 계정은 이미 다른 Your Maple 계정에 연결되어 있습니다. 로그아웃한 뒤 그 계정으로 로그인해 주세요."],
  ["already linked", "이 계정은 이미 다른 Your Maple 계정에 연결되어 있습니다. 로그아웃한 뒤 그 계정으로 로그인해 주세요."],
  ["access_denied", "로그인을 취소했습니다."],
];

// 구글·디스코드 로그인 (2026-10-19 사용자 요청). 버튼을 누르면 그 사이트로 갔다가 이 주소로 돌아온다.
export const OAUTH_PROVIDERS = [
  { id: "google", label: "Google" },
  { id: "discord", label: "Discord" },
];

// 돌아올 주소: 지금 페이지(쿼리·# 없이). Supabase URL Configuration 의 Redirect URLs 에 등록돼 있어야 한다.
function returnUrl() {
  return `${location.origin}${location.pathname}`;
}

/** 로그인 없이 둘러보기 = 익명 계정. 데이터는 그 브라우저의 임시 계정에 저장되고, 나중에 구글·디스코드를 연결하면 그대로 이어진다. */
export function isAnonymous(session) {
  return Boolean(session?.user?.is_anonymous);
}

/** 화면에 보일 계정 이름: 이메일 → 이름 → "임시 계정" */
export function accountLabel(session) {
  const user = session?.user;
  if (!user) return "";
  if (user.is_anonymous) return "임시 계정";
  return user.email || user.user_metadata?.full_name || user.user_metadata?.name || "로그인됨";
}

export function translateAuthError(error) {
  const raw = error?.message || "로그인 처리 중 문제가 생겼습니다.";
  if (error instanceof ConfigError) return raw;
  if (/failed to fetch|network/i.test(raw)) {
    return "Supabase에 연결하지 못했습니다. 인터넷 연결과 js/config.js 의 주소를 확인해 주세요.";
  }
  const found = knownErrors.find(([needle]) => raw.toLowerCase().includes(needle.toLowerCase()));
  return found ? found[1] : raw;
}

// 구글·디스코드에서 돌아오면 주소에 ?code=… 나 ?error=… 가 붙는다. 처리한 뒤 주소에서 지운다(새로 고침·공유 때 남지 않게).
function takeOAuthError() {
  const params = new URLSearchParams(location.search);
  const error = params.get("error_description") || params.get("error");
  if (params.has("code") || params.has("error")) {
    history.replaceState(null, "", `${location.pathname}${location.hash}`);
  }
  return error ? translateAuthError({ message: error }) : "";
}

export async function startAuth(onSession) {
  try {
    const supabase = await getSupabase();
    supabase.auth.onAuthStateChange((event, session) => {
      onSession(session, event);
      if (event === "SIGNED_IN" || event === "INITIAL_SESSION") takeOAuthError();
    });
    // 로그인 실패로 돌아온 경우(세션 없음)에는 이유를 알린다.
    const failed = new URLSearchParams(location.search).has("error") ? takeOAuthError() : "";
    if (failed) onSession(null, "OAUTH_ERROR", new Error(failed));
  } catch (error) {
    onSession(null, "CONFIG_ERROR", error);
  }
}

export async function signIn(email, password) {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error: error ? translateAuthError(error) : "" };
}

export async function signUp(email, password) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: translateAuthError(error), needsEmailConfirm: false };
  return { error: "", needsEmailConfirm: !data.session };
}

export async function signOut() {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw new Error(translateAuthError(error));
}

export async function signInWithProvider(provider) {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: returnUrl() } });
  return { error: error ? translateAuthError(error) : "" };
}

export async function signInAsGuest() {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.signInAnonymously();
  return { error: error ? translateAuthError(error) : "" };
}

/** 임시 계정에 구글·디스코드를 연결한다. 연결되면 같은 계정(같은 데이터)으로 다른 기기에서도 로그인할 수 있다. */
export async function linkProvider(provider) {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.linkIdentity({ provider, options: { redirectTo: returnUrl() } });
  return { error: error ? translateAuthError(error) : "" };
}
