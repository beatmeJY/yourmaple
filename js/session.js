// 로그인 없이도 앱을 연다(2026-10-19 사용자 결정). 계정에 저장해야 하는 순간에만 로그인 화면으로 보내고,
// 로그인하고 돌아오면 그 화면으로 가서 아까 입력한 값을 되살린다(구글·디스코드는 다른 사이트로 갔다 오므로 sessionStorage 에 둔다).

const NEXT_KEY = "ym-login-next"; // { route, reason }
const DRAFT_KEY = "ym-login-draft"; // { route, at, data }
const DRAFT_TTL = 30 * 60 * 1000;

let current = null;
let loginHandler = null;

export function setSession(session) {
  current = session ?? null;
}

export function currentSession() {
  return current;
}

export function isLoggedIn() {
  return Boolean(current?.user);
}

/** main.js 가 등록한다: 로그인 화면을 띄우는 함수 (reason: 왜 로그인해야 하는지) */
export function onLoginRequest(handler) {
  loginHandler = handler;
}

function read(key) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value == null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 기억하지 못하면 로그인 뒤 처음 화면으로 간다.
  }
}

function routeNow() {
  return location.hash.replace(/^#\/?/, "").split("?")[0] || "dashboard";
}

/**
 * 저장 직전에 부른다. 로그인돼 있으면 true(그대로 저장). 아니면 입력값(draft)을 맡기고 로그인 화면을 띄운 뒤 false.
 * draft 는 JSON 으로 저장할 수 있는 값이어야 한다.
 */
export function requireLogin(reason, draft = null) {
  if (isLoggedIn()) return true;
  const route = routeNow();
  write(NEXT_KEY, { route, reason });
  write(DRAFT_KEY, draft == null ? null : { route, at: Date.now(), data: draft });
  loginHandler?.(reason);
  return false;
}

/** 로그인 화면으로 보낼 때 돌아올 화면만 기억한다(입력값 없음). 로그인이 필요한 메뉴를 눌렀을 때. */
export function rememberNext(route, reason) {
  write(NEXT_KEY, { route, reason });
}

/** 로그인 직후 한 번: 돌아갈 화면 */
export function takeNext() {
  const next = read(NEXT_KEY);
  write(NEXT_KEY, null);
  return next;
}

/** 로그인 화면에 보여 줄 이유(남겨 둔 채로 읽기만) */
export function pendingReason() {
  return read(NEXT_KEY)?.reason ?? "";
}

/** 로그인을 그만두고 돌아갈 때: 돌아갈 화면·맡긴 입력값을 버린다 */
export function cancelLogin() {
  write(NEXT_KEY, null);
  write(DRAFT_KEY, null);
}

/** 화면이 다 그려진 뒤 부른다: 이 화면에 맡겨 둔 입력값(로그인됐을 때만). 꺼내면 지운다. */
export function takeDraft(route) {
  if (!isLoggedIn()) return null;
  const draft = read(DRAFT_KEY);
  if (!draft || draft.route !== route) return null;
  write(DRAFT_KEY, null);
  if (Date.now() - draft.at > DRAFT_TTL) return null;
  return draft.data;
}

// ── 입력칸 통째로 맡기기·되살리기(계산기 화면 공용) ─────────────────────────
// 칸 이름: name 또는 data-* 속성 하나(예: data-price-input="diamond:ore"), 같은 이름이 여러 개면 순서까지.

function fieldKey(element, seen) {
  const attr = element.name ? `name=${element.name}` : [...element.attributes].find((item) => item.name.startsWith("data-"))?.name;
  const value = attr && !attr.startsWith("name=") ? `${attr}=${element.getAttribute(attr)}` : attr;
  if (!value) return null;
  const index = seen.get(value) ?? 0;
  seen.set(value, index + 1);
  return `${value}#${index}`;
}

function fields(root) {
  return [...root.querySelectorAll("input, select, textarea")].filter((element) => !["file", "password", "hidden", "submit", "button"].includes(element.type));
}

export function snapshotFields(root) {
  const seen = new Map();
  const out = {};
  for (const element of fields(root)) {
    const key = fieldKey(element, seen);
    if (!key) continue;
    out[key] = element.type === "checkbox" || element.type === "radio" ? element.checked : element.value;
  }
  return out;
}

/** 값을 넣고 input·change 를 알려 화면이 다시 계산하게 한다. 되살린 칸 수를 돌려준다. */
export function restoreFields(root, snapshot) {
  if (!snapshot) return 0;
  const seen = new Map();
  let count = 0;
  for (const element of fields(root)) {
    const key = fieldKey(element, seen);
    if (!key || !(key in snapshot)) continue;
    const value = snapshot[key];
    if (element.type === "checkbox" || element.type === "radio") {
      if (element.checked === Boolean(value)) continue;
      element.checked = Boolean(value);
    } else {
      if (element.value === value) continue;
      element.value = value;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    count += 1;
  }
  return count;
}
