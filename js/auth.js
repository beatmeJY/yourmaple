import { ConfigError, getSupabase, googleClientId } from "./supabase-client.js";

const knownErrors = [
  ["For security purposes", "요청이 너무 빠릅니다. 잠시 후 다시 시도하세요."],
  ["Signups not allowed", "새 가입이 꺼져 있습니다. Supabase → Authentication → Sign In / Providers 의 User Signups 에서 Allow new users to sign up 을 켜 주세요."],
  ["provider is not enabled", "이 로그인 방식이 아직 꺼져 있습니다. Supabase → Authentication → Sign In / Providers 에서 Google·Discord 를 켜 주세요."],
  ["Manual linking is disabled", "계정 연결이 아직 꺼져 있습니다. Supabase → Authentication → Sign In / Providers 의 Allow manual linking 을 켜 주세요."],
  ["Identity is already linked to another user", "이 계정은 이미 다른 Your Maple 계정에 연결되어 있습니다. 로그아웃한 뒤 그 계정으로 로그인해 주세요."],
  ["already linked", "이 계정은 이미 다른 Your Maple 계정에 연결되어 있습니다. 로그아웃한 뒤 그 계정으로 로그인해 주세요."],
  ["access_denied", "로그인을 취소했습니다."],
  ["Nonces mismatch", "Google 로그인 확인이 맞지 않았습니다. 다시 눌러 주세요."],
  ["Unacceptable audience", "Supabase Google 설정의 Client ID가 버튼의 Client ID와 다릅니다. Authentication → Sign In / Providers → Google 을 확인해 주세요."],
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

// ── Google 공식 로그인 버튼(2026-11-04 사용자 요청) ──────────────────────
// 이동 방식(signInWithOAuth)은 Google이 로그인 결과를 Supabase 주소로 보내서 Google 창에 "…supabase.co(으)로 이동"이 보인다.
// 공식 버튼은 결과(신원 토큰)를 이 화면(yourmaple.kr)이 직접 받고, Supabase에는 토큰만 넘긴다(signInWithIdToken).
// Google Cloud 콘솔의 "승인된 JavaScript 원본"에 이 사이트 주소가 있어야 한다(README "Google 공식 로그인 버튼").
const GSI_SRC = "https://accounts.google.com/gsi/client";
let gsiLoading = null;

function loadGoogleIdentity() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  gsiLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GSI_SRC;
    script.async = true;
    script.onload = () => (window.google?.accounts?.id ? resolve(window.google) : reject(new Error("Google 로그인 버튼을 불러오지 못했습니다.")));
    script.onerror = () => {
      gsiLoading = null;
      script.remove();
      reject(new Error("Google 로그인 버튼을 불러오지 못했습니다."));
    };
    document.head.append(script);
  });
  return gsiLoading;
}

// 한 번 쓰는 값(nonce): Google에는 SHA-256 해시, Supabase에는 원래 값을 준다(같은 토큰을 다시 쓰지 못하게).
async function makeNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const raw = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hashed = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return { raw, hashed };
}

/**
 * fallback(기존 Google 버튼) 자리에 Google 공식 버튼을 그린다. 그리면 true, 설정이 없거나 불러오지 못하면 false(기존 버튼 유지).
 * onStart: Google에서 계정을 고른 직후(토큰을 Supabase에 넘기기 전), onError(문구): 실패.
 * 성공하면 Supabase가 SIGNED_IN 을 알리고 main.js 가 앱 화면으로 바꾼다(페이지 이동 없음).
 */
export async function mountGoogleButton(fallback, { onStart, onError } = {}) {
  const clientId = await googleClientId();
  if (!clientId || !fallback?.isConnected) return false;
  let google;
  try {
    google = await loadGoogleIdentity();
  } catch {
    return false;
  }
  if (!fallback.isConnected) return false;
  const nonce = await makeNonce();
  const supabase = await getSupabase();
  google.accounts.id.initialize({
    client_id: clientId,
    nonce: nonce.hashed,
    ux_mode: "popup",
    context: "signin",
    itp_support: true,
    use_fedcm_for_button: true,
    callback: async ({ credential }) => {
      onStart?.();
      const { error } = await supabase.auth.signInWithIdToken({ provider: "google", token: credential, nonce: nonce.raw });
      if (!error) return;
      onError?.(translateAuthError(error));
      // nonce 는 한 번만 쓸 수 있어 새 값으로 버튼을 다시 그린다.
      if (host.isConnected) mountGoogleButton(fallback, { onStart, onError }).then((ok) => ok && host.remove());
    },
  });
  const host = document.createElement("div");
  host.className = `${fallback.className} is-gsi`;
  host.dataset.gsiButton = "";
  fallback.after(host);
  // 다시 그릴 때는 기존 버튼이 숨어 있어 폭이 0이므로 처음 잰 폭을 쓴다. offsetWidth 는 등장 연출(transform) 영향을 받지 않는다.
  const measured = fallback.offsetWidth || Number(fallback.dataset.gsiWidth) || 320;
  fallback.dataset.gsiWidth = String(measured);
  const width = Math.max(200, Math.min(400, measured));
  google.accounts.id.renderButton(host, {
    type: "standard",
    theme: "outline",
    size: "large",
    text: "continue_with",
    shape: "pill",
    logo_alignment: "center",
    width,
    locale: "ko",
  });
  fallback.hidden = true;
  return true;
}
