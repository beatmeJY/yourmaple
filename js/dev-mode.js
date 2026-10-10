// 개발 중인 기능 감추기: 운영 주소에서는 숨기고, 주소에 dev 를 붙이면 보인다.
// 예: https://yourmaple.kr/?dev  또는  https://yourmaple.kr/#/enhance?dev
// 한 번 dev 로 열면 이 탭을 닫을 때까지 유지한다. ?dev=0 이면 끈다. 로컬(127.0.0.1·localhost)에서는 늘 보인다.
const KEY = "maple-note-dev";

function readFlag() {
  const hashQuery = location.hash.split("?")[1] ?? "";
  const params = [new URLSearchParams(location.search), new URLSearchParams(hashQuery)];
  for (const param of params) {
    if (!param.has("dev")) continue;
    const on = param.get("dev") !== "0";
    try {
      if (on) sessionStorage.setItem(KEY, "1");
      else sessionStorage.removeItem(KEY);
    } catch {
      // 저장이 막혀도 이번 주소에서는 그대로 따른다.
    }
    return on;
  }
  if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) return true;
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export const devMode = readFlag();
