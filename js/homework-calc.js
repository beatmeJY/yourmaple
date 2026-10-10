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

// ── 무릉도장 통합 점수 (2026-10-11 사용자 결정) ──────────────────────────
// 사용자는 게임에 보이는 "현재 통합 점수"를 적는다. 오늘 번 점수 = 오늘 00시 전 마지막 기록부터 오른 만큼.
// 오늘 3,500점을 벌면 그날 무릉 숙제 완료. 12,000점 초기화는 사용자가 누를 때 기록(kind: reset)한다.
export const DOJO_DAILY_GOAL = 3500;
export const DOJO_RESET_POINTS = 12000;

/** 기기 시간 기준 날짜 "2026-10-11" */
export function localDay(now) {
  const date = new Date(now);
  const two = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/**
 * 기록을 날짜별로 묶어 그날 번 점수를 센다. entries: [{ total, kind, recorded_at }] (순서 상관없음)
 * - 이전 기록보다 오른 만큼이 그 기록의 변화(change).
 * - reset 기록과 점수가 줄어든 기록은 게임에서 초기화한 것으로 보고 0으로 센다.
 * - clear 기록(오늘 초기화)은 그날 쌓은 점수를 0으로 되돌린다. 통합 점수는 그대로.
 * - 맨 처음 기록은 비교할 이전 기록이 없어 change 가 null(그날은 partial: 기준 없음).
 * 결과: 날짜 오름차순 [{ day, earned, partial, last, entries: [{ ...entry, change }] }]
 */
export function dojoDays(entries) {
  const sorted = [...(entries ?? [])].sort((left, right) => new Date(left.recorded_at) - new Date(right.recorded_at));
  const days = [];
  let ref = null;
  for (const entry of sorted) {
    const total = Number(entry.total) || 0;
    const day = localDay(new Date(entry.recorded_at).getTime());
    let change;
    if (entry.kind === "reset" || entry.kind === "clear") change = 0;
    else if (ref == null) change = null;
    else change = Math.max(0, total - ref);
    ref = total;
    let bucket = days[days.length - 1];
    if (!bucket || bucket.day !== day) {
      bucket = { day, earned: 0, partial: false, last: total, entries: [] };
      days.push(bucket);
    }
    // 오늘 초기화(clear): 그날 쌓은 점수를 0으로 되돌리고 이 점수부터 다시 센다.
    if (entry.kind === "clear") {
      bucket.earned = 0;
      bucket.partial = false;
    }
    if (change == null) bucket.partial = true;
    else bucket.earned += change;
    bucket.last = total;
    bucket.entries.push({ ...entry, change });
  }
  return days;
}

/** 지금 통합 점수와 오늘 번 점수. 기록이 없으면 total·today 가 null. */
export function dojoProgress(entries, now) {
  const days = dojoDays(entries);
  if (!days.length) return { total: null, today: null, partial: false, lastAt: null };
  const last = days[days.length - 1];
  const lastEntry = last.entries[last.entries.length - 1];
  const today = last.day === localDay(now) ? last : null;
  return {
    total: last.last,
    today: today ? today.earned : 0,
    partial: today ? today.partial : false,
    lastAt: lastEntry.recorded_at,
  };
}

/** 12,000점 초기화: 12,000점을 빼고 넘친 점수는 남긴다(0 아래로는 내려가지 않음). */
export function resetDojoTotal(total) {
  return Math.max(0, (Number(total) || 0) - DOJO_RESET_POINTS);
}

/** 다시 가능한 날: "오늘" · "내일" · "10.14" */
export function availableDay(next, now) {
  if (localDay(next) === localDay(now)) return "오늘";
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (localDay(next) === localDay(tomorrow.getTime())) return "내일";
  const date = new Date(next);
  return `${date.getMonth() + 1}.${date.getDate()}`;
}

/** 다시 가능한 시각 "01:13" */
export function availableTime(next) {
  const date = new Date(next);
  const two = (value) => String(value).padStart(2, "0");
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** 한 줄로 쓸 때: 오늘이면 "14:30", 내일이면 "내일 14:30", 그 밖이면 "10.14 14:30" */
export function availableLabel(next, now) {
  const day = availableDay(next, now);
  return day === "오늘" ? availableTime(next) : `${day} ${availableTime(next)}`;
}
