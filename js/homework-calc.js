import { DAY_MS } from "./boss-cooldown.js";

// 숙제 초기화 규칙 (2026-10-10 사용자 결정)
// - daily: 매일 00시(이 기기 시간)에 초기화. 예: 무릉도장
// - after24h: 끝낸 시각부터 24시간 뒤. 예: 파풀라투스, 차원의 균열 조각
// - after7d: 끝낸 시각부터 7일 뒤. 예: 피아누스
export const RESET_KINDS = {
  daily: { id: "daily", label: "매일 00시", short: "00시" },
  after24h: { id: "after24h", label: "끝낸 뒤 24시간", short: "24시간" },
  after7d: { id: "after7d", label: "끝낸 뒤 7일", short: "7일" },
};

export function startOfDay(now) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function nextMidnight(now) {
  const date = new Date(now);
  date.setHours(24, 0, 0, 0);
  return date.getTime();
}

function toMillis(value) {
  if (value == null || value === "") return null;
  const ms = typeof value === "number" ? value : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * 숙제 한 칸의 상태. checkedAt: 마지막으로 끝낸 시각(없으면 null).
 * 결과: { done, next } — done 이면 next(다시 할 수 있는 시각, ms)까지 기다린다. 아니면 next 는 null.
 */
export function homeworkState(kind, checkedAt, now) {
  const at = toMillis(checkedAt);
  if (at == null) return { done: false, next: null };
  if (kind === "daily") {
    // 오늘 00시 이후에 끝냈으면 오늘 몫은 했다. 다음 00시에 다시.
    return at >= startOfDay(now) ? { done: true, next: nextMidnight(now) } : { done: false, next: null };
  }
  const period = kind === "after7d" ? 7 * DAY_MS : DAY_MS;
  const next = at + period;
  return now < next ? { done: true, next } : { done: false, next: null };
}

/** 남은 시간 짧게: 2일 3시간 · 5시간 12분 · 8분 · 1분 미만 */
export function shortRemain(ms) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days) return hours ? `${days}일 ${hours}시간` : `${days}일`;
  if (hours) return rest ? `${hours}시간 ${rest}분` : `${hours}시간`;
  if (rest) return `${rest}분`;
  return "1분 미만";
}

/** 시계 표시: 05:12:09 (24시간 넘으면 1일 05:12:09) */
export function clockRemain(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const two = (value) => String(value).padStart(2, "0");
  const time = `${two(Math.floor((total % 86400) / 3600))}:${two(Math.floor((total % 3600) / 60))}:${two(total % 60)}`;
  return days ? `${days}일 ${time}` : time;
}
