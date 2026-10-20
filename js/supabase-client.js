let client;
let createClient;

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

function isSecretKey(key) {
  if (key.startsWith("sb_secret_")) return true;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const body = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = body + "=".repeat((4 - (body.length % 4)) % 4);
    return JSON.parse(atob(padded)).role === "service_role";
  } catch {
    return false;
  }
}

async function loadLibrary() {
  if (createClient) return;
  try {
    ({ createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"));
  } catch {
    throw new ConfigError("로그인 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.");
  }
}

async function readConfig() {
  let imported;
  try {
    imported = await import("./config.js");
  } catch {
    throw new ConfigError(
      "js/config.js 파일이 없습니다. js/config.example.js 를 복사해 js/config.js 를 만들고, Supabase 주소와 Publishable key를 넣어 주세요.",
    );
  }

  const url = imported.config?.supabaseUrl?.trim() ?? "";
  const key = imported.config?.supabasePublishableKey?.trim() ?? "";
  if (!url || !key || url.includes("YOUR_PROJECT") || key.includes("YOUR_KEY")) {
    throw new ConfigError(
      "js/config.js 에 Project URL과 Publishable key를 넣어 주세요. 예시 문구가 그대로면 연결되지 않습니다.",
    );
  }
  if (isSecretKey(key)) {
    throw new ConfigError(
      "비밀 키(service_role, sb_secret_)는 넣을 수 없습니다. Publishable key를 사용하세요.",
    );
  }

  return { url, key };
}

// 로컬 전용 가짜 DB(js/dev-mock.js): 127.0.0.1·localhost 에서 ?mock(로그인됨)·?mock=guest(로그인 전)·?mock=reset(샘플로 처음부터)으로 켜고 ?mock=0 으로 끈다.
// 이 탭을 닫을 때까지 유지한다. 운영 주소에서는 읽지도 않는다.
const MOCK_KEY = "ym-mock";
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

function mockRequest() {
  if (!LOCAL_HOSTS.includes(location.hostname)) return null;
  const params = new URLSearchParams(location.search);
  try {
    if (params.has("mock")) {
      const value = params.get("mock");
      if (value === "0") sessionStorage.removeItem(MOCK_KEY);
      else sessionStorage.setItem(MOCK_KEY, "1");
      return value === "0" ? null : value || "in";
    }
    return sessionStorage.getItem(MOCK_KEY) === "1" ? "keep" : null;
  } catch {
    return params.has("mock") && params.get("mock") !== "0" ? params.get("mock") || "in" : null;
  }
}

export async function getSupabase() {
  if (client) return client;
  const mock = mockRequest();
  if (mock) {
    const { createMockClient, mountMockBadge, resetMockDb, setMockAuth } = await import("./dev-mock.js");
    if (mock === "reset") resetMockDb();
    if (mock === "guest") setMockAuth(false);
    else if (mock !== "keep") setMockAuth(true);
    // 주소의 ?mock=… 은 한 번 읽었으니 지운다(새로 고쳐도 상태 바꾸기가 반복되지 않게).
    if (mock !== "keep") history.replaceState(null, "", `${location.pathname}${location.hash}`);
    client = createMockClient();
    if (document.body) mountMockBadge();
    else document.addEventListener("DOMContentLoaded", mountMockBadge, { once: true });
    return client;
  }
  const { url, key } = await readConfig();
  await loadLibrary();
  client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // 구글·디스코드에서 돌아올 때 토큰을 # 대신 ?code= 로 받는다(# 은 화면 주소로 쓰기 때문).
      flowType: "pkce",
    },
  });
  return client;
}
