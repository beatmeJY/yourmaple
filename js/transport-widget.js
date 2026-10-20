import { transportState, transportTime, transportCountdown } from "./transport-calc.js";

const elevatorIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 15V8m-2 2 2-2 2 2m4-1v7m-2-2 2 2 2-2"/></svg>`;
const shipIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 14h18l-4 6H7l-4-6Zm5 0V8h8v6m-4-6V3m0 1 6 3h-6M3 22c2-2 4 2 6 0s4 2 6 0 4 2 6 0"/></svg>`;

// #app 밖에 한 번만 붙여 화면 전환·로그인 화면에서도 시간을 유지한다.
export function mountTransportWidget() {
  if (document.querySelector(".transport-widget")) return;
  const host = document.createElement("aside");
  host.className = "transport-widget";
  host.setAttribute("aria-label", "메이플랜드 교통 시간표");
  host.innerHTML = `
    <section class="transport-panel ym-glass" id="transport-panel" aria-label="교통 시간표 상세" hidden>
      <header><span><small>MAPLELAND TRANSIT</small><strong>잠깐, 출발 시간!</strong></span><button type="button" data-transit-close aria-label="교통 시간표 닫기">×</button></header>
      <div class="transport-clock"><span>한국 시각</span><time data-transit-clock></time></div>
      <article class="transport-card" data-helios-card>
        <div class="transport-card-title">${elevatorIcon}<h2>헬리오스탑</h2><span data-helios-direction></span></div>
        <strong data-helios-state></strong><p>다음 상태까지 <b data-helios-remain></b></p>
        <div class="transport-times"><span>↑ 다음 출발 <b data-helios-up></b></span><span>↓ 다음 출발 <b data-helios-down></b></span></div>
      </article>
      <article class="transport-card" data-ship-card>
        <div class="transport-card-title">${shipIcon}<h2>배 시간표</h2><span data-ship-badge></span></div>
        <strong data-ship-state></strong><p><span data-ship-next></span> <b data-ship-remain></b></p>
        <div class="transport-times"><span>탑승 마감 <b data-ship-close></b></span><span>출발 <b data-ship-depart></b></span></div>
      </article>
      <p class="transport-note">배는 출발 1분 전 마감 · 기기 시각 기준</p>
    </section>
    <button class="transport-toggle" type="button" aria-controls="transport-panel" aria-expanded="false">
      <span class="transport-mini" data-mini-helios>${elevatorIcon}<span><b data-helios-mini></b><small data-helios-mini-remain></small></span></span><i></i><span class="transport-mini" data-mini-ship>${shipIcon}<span><b data-ship-mini></b><small data-ship-mini-remain></small></span></span>
    </button>`;
  document.body.append(host);
  const button = host.querySelector(".transport-toggle");
  const panel = host.querySelector(".transport-panel");
  const nodes = Object.fromEntries([...host.querySelectorAll("[data-transit-clock], [data-helios-direction], [data-helios-state], [data-helios-remain], [data-helios-up], [data-helios-down], [data-ship-badge], [data-ship-state], [data-ship-next], [data-ship-remain], [data-ship-close], [data-ship-depart], [data-helios-mini], [data-ship-mini], [data-helios-mini-remain], [data-ship-mini-remain]")].map((node) => [node.attributes[0].name, node]));
  const text = (key, value) => { if (nodes[key].textContent !== value) nodes[key].textContent = value; };
  let timer = 0;
  function update() {
    clearTimeout(timer);
    if (!host.isConnected) return;
    const now = Date.now();
    const { helios, ship } = transportState(now);
    const shipLabel = { waiting: "다음 배 대기", boarding: "탑승 가능", closed: "탑승 마감" }[ship.phase];
    const miniHelios = `${helios.direction === "up" ? "↑" : "↓"} ${helios.waiting ? "대기" : "출발"}`;
    text("data-transit-clock", transportTime(now));
    text("data-helios-direction", helios.direction === "up" ? "상행" : "하행");
    text("data-helios-state", helios.label);
    text("data-helios-remain", transportCountdown(helios.changesAt, now));
    text("data-helios-up", transportTime(helios.upAt));
    text("data-helios-down", transportTime(helios.downAt));
    text("data-ship-state", shipLabel);
    text("data-ship-badge", { waiting: "대기", boarding: "탑승 중", closed: "마감" }[ship.phase]);
    text("data-ship-next", { waiting: "탑승 시작까지", boarding: "탑승 마감까지", closed: "출발까지" }[ship.phase]);
    text("data-ship-remain", transportCountdown(ship.changesAt, now));
    text("data-ship-close", transportTime(ship.closesAt));
    text("data-ship-depart", transportTime(ship.departsAt));
    text("data-helios-mini", miniHelios);
    text("data-ship-mini", { waiting: "대기", boarding: "탑승", closed: "마감" }[ship.phase]);
    text("data-helios-mini-remain", `${helios.waiting ? "출발" : "다음 상태"} ${transportCountdown(helios.changesAt, now)}`);
    text("data-ship-mini-remain", `${{ waiting: "탑승", boarding: "마감", closed: "출발" }[ship.phase]} ${transportCountdown(ship.changesAt, now)}`);
    host.dataset.shipPhase = ship.phase;
    host.dataset.heliosDirection = helios.direction;
    button.setAttribute("aria-label", `교통 시간표: 헬리오스탑 ${helios.label}, 배 ${shipLabel}`);
    if (!document.hidden) timer = setTimeout(update, 1000 - (now % 1000));
  }
  function setOpen(open, focusBack = false) {
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (open) {
      update();
      host.querySelector("[data-transit-close]").focus({ preventScroll: true });
    }
    if (focusBack) button.focus();
  }
  button.addEventListener("click", () => setOpen(panel.hidden));
  host.querySelector("[data-transit-close]").addEventListener("click", () => setOpen(false, true));
  document.addEventListener("pointerdown", (event) => { if (!host.contains(event.target)) setOpen(false); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !panel.hidden) setOpen(false, true); });
  document.addEventListener("visibilitychange", update);
  window.addEventListener("pageshow", update);
  window.addEventListener("pagehide", () => clearTimeout(timer));
  update();
}
