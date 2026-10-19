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

export async function getSupabase() {
  if (client) return client;
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
