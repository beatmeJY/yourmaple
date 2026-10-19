import { ConfigError, getSupabase } from "./supabase-client.js";

const knownErrors = [
  ["For security purposes", "요청이 너무 빠릅니다. 잠시 후 다시 시도하세요."],
  ["Signups not allowed", "새 가입이 꺼져 있습니다. Supabase → Authentication → Sign In / Providers 의 User Signups 에서 Allow new users to sign up 을 켜 주세요."],
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

/** 화면에 보일 계정 이름: 이메일 → 이름 (2026-10-19부터 로그인은 Google·Discord만, 비밀번호는 받지 않는다) */
export function accountLabel(session) {
  const user = session?.user;
  if (!user) return "";
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
