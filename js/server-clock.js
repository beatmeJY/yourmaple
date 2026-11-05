// 사이트 서버 시각에 맞춘 현재 시각(2026-11-05 사용자 요청: 기기 시계가 밀려도 교통 시간이 맞게).
// 우리 사이트에 HEAD 요청을 보내 응답 머리 Date(초 단위)를 읽고, 보낸·받은 시각의 가운데를 그 시각으로 본다.
// 기기 시계와의 차이(offset)만 기억해 Date.now()에 더한다. 서버 시각을 못 받으면 기기 시계를 그대로 쓴다.

const SAMPLES = 3;
const MAX_RTT = 3000; // 왕복이 이보다 길면 오차가 커서 버린다
const RESYNC_AFTER = 10 * 60_000; // 화면에 돌아왔을 때 마지막 맞춘 지 이만큼 지났으면 다시 맞춘다
const JUMP = 2000; // 기기 시계와 경과 시간이 이만큼 어긋나면(시계 변경·잠자기) 다시 맞춘다

let offset = 0;
let synced = false;
let syncedAt = 0; // performance.now 기준
let anchor = null; // { date, perf } 시계 점프 감지용
let pending = null;
const listeners = new Set();

// 표본 하나: { sentAt, receivedAt }(기기 시각, ms)과 서버 Date(ms, 초 단위로 잘린 값)
// Date 는 초 아래가 잘려 실제 서버 시각은 [date, date+1000) 이므로 가운데 +500 을 쓴다.
export function sampleOffset({ sentAt, receivedAt, serverDate }) {
  const rtt = receivedAt - sentAt;
  if (!Number.isFinite(serverDate) || !(rtt >= 0) || rtt > MAX_RTT) return null;
  return { rtt, offset: serverDate + 500 - (sentAt + rtt / 2) };
}

// 왕복이 가장 짧은 표본이 가장 정확하다.
export function bestOffset(samples) {
  const valid = samples.filter(Boolean).sort((a, b) => a.rtt - b.rtt);
  return valid.length ? valid[0].offset : null;
}

async function takeSample() {
  const sentAt = Date.now();
  const response = await fetch(`./?clock=${sentAt}`, { method: "HEAD", cache: "no-store" });
  const receivedAt = Date.now();
  return sampleOffset({ sentAt, receivedAt, serverDate: Date.parse(response.headers.get("date") ?? "") });
}

export function syncServerClock() {
  if (pending) return pending;
  pending = (async () => {
    const samples = [];
    for (let i = 0; i < SAMPLES; i++) {
      try { samples.push(await takeSample()); } catch { samples.push(null); }
    }
    const value = bestOffset(samples);
    if (value != null) {
      offset = Math.round(value);
      synced = true;
      syncedAt = performance.now();
      anchor = { date: Date.now(), perf: syncedAt };
      for (const listener of listeners) listener();
    }
    pending = null;
  })();
  return pending;
}

export function serverNow() {
  const now = Date.now();
  if (anchor && Math.abs(now - anchor.date - (performance.now() - anchor.perf)) > JUMP) {
    anchor = null; // 한 번만 다시 맞춘다
    void syncServerClock();
  }
  return now + offset;
}

// 기기 시계가 서버보다 늦으면 양수(ms). 서버 시각을 아직 못 받았으면 null.
export function clockOffset() {
  return synced ? offset : null;
}

export function onServerClockChange(listener) {
  listeners.add(listener);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && (!synced || performance.now() - syncedAt > RESYNC_AFTER)) void syncServerClock();
  });
}
