// 사용자 시간표: 한국 시각 기준. 서버 호출 없이 기기의 현재 시각에서 매번 계산한다.
const MINUTE = 60_000;
const SHIP_CYCLE = 10 * MINUTE;
const HELIOS = [
  { direction: "down", label: "내려감 출발", waiting: false },
  { direction: "up", label: "올라감 출발 대기", waiting: true },
  { direction: "up", label: "올라감 출발", waiting: false },
  { direction: "down", label: "내려감 출발 대기", waiting: true },
];

export function transportState(now = Date.now()) {
  const minute = Math.floor(now / MINUTE);
  const remainder = ((minute % 4) + 4) % 4;
  const minuteStart = minute * MINUTE;
  const cycleStart = Math.floor(now / SHIP_CYCLE) * SHIP_CYCLE;
  const boardingAt = cycleStart + 5 * MINUTE;
  const closesAt = cycleStart + 9 * MINUTE;
  const departsAt = cycleStart + SHIP_CYCLE;
  const phase = now < boardingAt ? "waiting" : now < closesAt ? "boarding" : "closed";
  return {
    helios: {
      ...HELIOS[remainder], remainder, changesAt: minuteStart + MINUTE,
      upAt: minuteStart + (((2 - remainder + 4) % 4) || 4) * MINUTE,
      downAt: minuteStart + (((4 - remainder) % 4) || 4) * MINUTE,
    },
    ship: { phase, boardingAt, closesAt, departsAt, changesAt: phase === "waiting" ? boardingAt : phase === "boarding" ? closesAt : departsAt },
  };
}

const seoulClock = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hourCycle: "h23", hour: "2-digit", minute: "2-digit" });
export function transportTime(timestamp) {
  return seoulClock.format(timestamp);
}

export function transportCountdown(target, now = Date.now()) {
  const seconds = Math.max(0, Math.ceil((target - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
