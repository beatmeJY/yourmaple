import { BURST_COLORS, burstAt, celebrate, sfx } from "./effects.js";
import { ENHANCE_SCROLLS } from "./enhance-calc.js";
import { formatCount } from "./format.js";
import { planOutcome, rollScroll, scrollPlan } from "./sim.js";

// 강화 화면 맨 위 시뮬레이터(시안 enhance): 무기 슬롯에 10%·60% 주문서를 직접 바르거나 계획대로 끝까지 바른다.
// 계산 화면(STEP 1~4)과 따로 놀지 않도록 무기 종류·주문서 시세·첫 노작 공격력·목표 공격력은 화면 상태에서 읽는다.
// getContext(): { slots, weaponLabel, name, baseAttack, targetAttack, tenPrice, sixtyPrice } (값이 없으면 null)

const STEP_MS = 420;

function readInt(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,4}$/.test(text)) return null;
  return Number(text);
}

function percentText(numerator, denominator) {
  const percent = (Number(numerator) / Number(denominator)) * 100;
  if (percent >= 10) return `${percent.toFixed(1)}%`;
  if (percent >= 1) return `${percent.toFixed(2)}%`;
  if (percent === 0) return "0%";
  return percent < 0.01 ? "<0.01%" : `${percent.toFixed(2)}%`;
}

export function mountEnhanceSim(box, getContext) {
  const sim = {
    base: null,
    baseTouched: false,
    target: null,
    targetTouched: false,
    tenFirst: 2,
    results: [],
    slots: 7,
    running: false,
    celebrated: false,
  };
  let timer = 0;

  box.innerHTML = `
    <section class="es-hero">
      <div class="es-top">
        <div class="es-weapon" aria-hidden="true"><span>⚔</span></div>
        <div class="es-id">
          <span class="es-type" data-sim-type></span>
          <strong data-sim-name>강화 시뮬레이터</strong>
          <label class="es-base">기본 공격력 <input data-sim-base inputmode="numeric" maxlength="4" placeholder="공격력" aria-label="시뮬레이터 기본 공격력" /> · <span data-sim-slots></span></label>
        </div>
        <div class="es-atk">
          <span>현재 공격력</span>
          <strong data-sim-atk>—</strong>
          <span data-sim-gain></span>
        </div>
      </div>
      <div class="es-slots" data-sim-slotbox></div>
      <div class="es-actions">
        <button type="button" class="es-ten" data-sim-apply="ten">10% 주문서 <small>성공 +5</small></button>
        <button type="button" class="es-sixty" data-sim-apply="sixty">60% 주문서 <small>성공 +2</small></button>
        <button type="button" class="es-auto" data-sim-auto>계획대로 끝까지</button>
        <button type="button" class="es-reset" data-sim-reset>새 무기</button>
      </div>
      <span class="es-spent" data-sim-spent></span>
    </section>
    <div class="es-grid">
      <section class="es-panel es-plan">
        <h2>강화 계획</h2>
        <div class="es-slider">
          <span class="es-row">10% 먼저 바를 횟수<strong data-sim-ten-label>2회</strong></span>
          <input type="range" min="0" max="7" step="1" value="2" data-sim-ten aria-label="10% 먼저 바를 횟수" />
          <span class="es-note" data-sim-plan-text></span>
        </div>
        <div class="es-prices">
          <div class="es-well"><span>10% 주문서 시세</span><strong data-sim-price="ten">-</strong></div>
          <div class="es-well"><span>60% 주문서 시세</span><strong data-sim-price="sixty">-</strong></div>
        </div>
        <div class="es-tiles">
          <div class="is-avg"><span>평균 공격력</span><strong data-sim-avg>—</strong></div>
          <div><span>주문서 비용</span><strong data-sim-cost>—</strong></div>
        </div>
        <p class="es-note">시세는 아래 STEP 1에 적은 값을 써요. 시뮬레이터는 연습용이고, 아래 계산(추천 행동)과는 따로 움직여요.</p>
      </section>
      <section class="es-panel es-dist">
        <div class="es-dist-head">
          <h2>최종 공격력 확률</h2>
          <label class="es-target"><span>목표</span><input data-sim-target inputmode="numeric" maxlength="4" placeholder="공격력" aria-label="목표 공격력" /><span>이상</span></label>
        </div>
        <div class="es-chart" data-sim-chart></div>
        <div class="es-hit"><span data-sim-hit-label>목표를 적으면 확률을 보여 줘요</span><strong data-sim-hit></strong></div>
      </section>
    </div>`;

  const q = (selector) => box.querySelector(selector);

  function context() {
    return getContext() ?? {};
  }

  function plan() {
    return scrollPlan(sim.slots, sim.tenFirst);
  }

  function currentAttack() {
    if (sim.base == null) return null;
    return sim.base + sim.results.reduce((sum, result) => sum + (result.success ? ENHANCE_SCROLLS[result.scroll].attackGain : 0), 0);
  }

  function paintSlots(lastIndex = -1) {
    q("[data-sim-slotbox]").style.setProperty("--n", sim.slots);
    q("[data-sim-slotbox]").innerHTML = Array.from({ length: sim.slots }, (_, index) => {
      const result = sim.results[index];
      if (!result) {
        const next = index === sim.results.length;
        const planned = plan()[index];
        return `<div class="es-slot${next ? " is-next" : ""}"><b>${index + 1}</b><span>${planned === "ten" ? "10% 예정" : "60% 예정"}</span></div>`;
      }
      const gain = ENHANCE_SCROLLS[result.scroll].attackGain;
      const fresh = index === lastIndex ? " is-fresh" : "";
      return result.success
        ? `<div class="es-slot is-ok is-${result.scroll}${fresh}"><b>+${gain}</b><span>${result.scroll === "ten" ? "10%" : "60%"} 성공</span></div>`
        : `<div class="es-slot is-fail is-${result.scroll}${fresh}"><b>✕</b><span>${result.scroll === "ten" ? "10%" : "60%"} 실패</span></div>`;
    }).join("");
  }

  function paintHead() {
    const ctx = context();
    q("[data-sim-type]").textContent = ctx.weaponLabel || "일반 무기";
    q("[data-sim-name]").textContent = ctx.name || "강화 시뮬레이터";
    q("[data-sim-slots]").textContent = `업그레이드 가능 ${sim.slots}회`;
    const attack = currentAttack();
    const gain = attack == null ? 0 : attack - sim.base;
    const atk = q("[data-sim-atk]");
    atk.textContent = attack == null ? "—" : String(attack);
    atk.classList.toggle("is-up", gain > 0);
    atk.classList.toggle("is-hit", sim.target != null && attack != null && attack >= sim.target);
    q("[data-sim-gain]").textContent = attack == null ? "기본 공격력을 적어 주세요" : gain ? `+${gain} 상승` : "아직 그대로";
    const used = sim.results.length;
    const done = used >= sim.slots;
    for (const button of box.querySelectorAll("[data-sim-apply], [data-sim-auto]")) button.disabled = sim.running || done || sim.base == null;
    q("[data-sim-reset]").disabled = sim.running;
    const tens = sim.results.filter((result) => result.scroll === "ten").length;
    const sixties = used - tens;
    const cost = (ctx.tenPrice != null || ctx.sixtyPrice != null)
      ? BigInt(tens) * (ctx.tenPrice ?? 0n) + BigInt(sixties) * (ctx.sixtyPrice ?? 0n)
      : null;
    q("[data-sim-spent]").textContent = used
      ? `사용한 주문서 10% ${tens}장 · 60% ${sixties}장${cost != null ? ` · ${formatCount(cost)}메소` : ""}${done ? " · 끝" : ` · 남은 ${sim.slots - used}회`}`
      : `업그레이드 ${sim.slots}회가 남았어요`;
  }

  function paintPlan() {
    const ctx = context();
    const slider = q("[data-sim-ten]");
    slider.max = String(sim.slots);
    slider.value = String(sim.tenFirst);
    q("[data-sim-ten-label]").textContent = `${sim.tenFirst}회`;
    const sixty = sim.slots - sim.tenFirst;
    q("[data-sim-plan-text]").textContent = sim.tenFirst === 0 ? `60%만 ${sixty}장` : sixty === 0 ? `10%만 ${sim.tenFirst}장` : `10% ${sim.tenFirst}장을 먼저 바르고 60% ${sixty}장`;
    q('[data-sim-price="ten"]').textContent = ctx.tenPrice != null ? `${formatCount(ctx.tenPrice)}` : "STEP 1에서 입력";
    q('[data-sim-price="sixty"]').textContent = ctx.sixtyPrice != null ? `${formatCount(ctx.sixtyPrice)}` : "STEP 1에서 입력";
    // 평균 상승 = 10% 장수 × 0.5 + 60% 장수 × 1.2 (각 주문서 성공 확률 × 오르는 공격력)
    const avgGain = sim.tenFirst * 0.5 + sixty * 1.2;
    q("[data-sim-avg]").textContent = sim.base == null ? `+${avgGain.toFixed(1)}` : (sim.base + avgGain).toFixed(1);
    const cost = ctx.tenPrice != null && ctx.sixtyPrice != null ? BigInt(sim.tenFirst) * ctx.tenPrice + BigInt(sixty) * ctx.sixtyPrice : null;
    q("[data-sim-cost]").textContent = cost == null ? "시세 입력 필요" : formatCount(cost);
  }

  function paintChart() {
    const chart = q("[data-sim-chart]");
    const base = sim.base ?? 0;
    const outcome = planOutcome(base, plan(), sim.target);
    const max = outcome.rows.reduce((value, row) => (row.numerator > value ? row.numerator : value), 1n);
    chart.innerHTML = outcome.rows
      .map((row, index) => {
        const hit = sim.target != null && row.attack >= sim.target;
        const height = Math.max(1.5, (Number(row.numerator) / Number(max)) * 78);
        const big = Number(row.numerator) / Number(outcome.denominator) >= 0.005;
        return `<span class="es-bar${hit ? " is-hit" : ""}" style="--i:${index}" title="공격력 ${sim.base == null ? `+${row.attack}` : row.attack}: ${percentText(row.numerator, outcome.denominator)}">
          <small class="${big ? "" : "is-dim"}">${percentText(row.numerator, outcome.denominator)}</small>
          <i style="height:${height}%"></i>
          <b>${sim.base == null ? `+${row.attack}` : row.attack}</b>
        </span>`;
      })
      .join("");
    const label = q("[data-sim-hit-label]");
    const value = q("[data-sim-hit]");
    if (sim.target == null || sim.base == null) {
      label.textContent = sim.base == null ? "기본 공격력을 적으면 실제 공격력으로 보여 줘요" : "목표를 적으면 확률을 보여 줘요";
      value.textContent = "";
      return;
    }
    label.textContent = `공격력 ${sim.target} 이상 나올 확률`;
    value.textContent = percentText(outcome.hit, outcome.denominator);
  }

  function paintAll(lastIndex = -1) {
    paintHead();
    paintSlots(lastIndex);
    paintPlan();
    paintChart();
  }

  function finishCheck() {
    if (sim.results.length < sim.slots || sim.celebrated) return;
    sim.celebrated = true;
    const attack = currentAttack();
    if (sim.results.every((result) => result.success)) {
      setTimeout(() => {
        sfx("fanfare");
        celebrate("퍼펙트!", `${sim.slots}회 모두 성공 · 공격력 ${attack}`);
      }, 260);
    } else if (sim.target != null && attack >= sim.target) {
      setTimeout(() => {
        sfx("fanfare");
        celebrate("목표 달성!", `공격력 ${attack} (목표 ${sim.target} 이상)`);
      }, 260);
    }
  }

  function apply(scrollId) {
    if (sim.base == null || sim.results.length >= sim.slots) return false;
    const result = rollScroll(scrollId);
    sim.results.push({ scroll: scrollId, success: result.success });
    const index = sim.results.length - 1;
    paintAll(index);
    const slot = q("[data-sim-slotbox]").children[index];
    if (result.success) {
      sfx(scrollId === "ten" ? "high" : "mid");
      burstAt(slot, scrollId === "ten" ? ["#ffb08a", "#ffe28a", "#ffffff"] : BURST_COLORS.low, scrollId === "ten" ? 26 : 16, scrollId === "ten" ? 1.1 : 0.8);
    } else {
      sfx("fail");
    }
    finishCheck();
    return true;
  }

  function stopAuto() {
    clearInterval(timer);
    timer = 0;
    sim.running = false;
  }

  function auto() {
    if (sim.running || sim.base == null) return;
    sim.running = true;
    paintHead();
    const steps = plan();
    timer = setInterval(() => {
      if (!box.isConnected) {
        stopAuto();
        return;
      }
      const next = steps[sim.results.length];
      if (!next) {
        stopAuto();
        paintHead();
        return;
      }
      apply(next);
      if (sim.results.length >= sim.slots) {
        stopAuto();
        paintHead();
      }
    }, STEP_MS);
  }

  function reset() {
    stopAuto();
    sim.results = [];
    sim.celebrated = false;
    sfx("tick");
    paintAll();
  }

  box.addEventListener("click", (event) => {
    const applyButton = event.target.closest("[data-sim-apply]");
    if (applyButton) {
      apply(applyButton.dataset.simApply);
      return;
    }
    if (event.target.closest("[data-sim-auto]")) {
      auto();
      return;
    }
    if (event.target.closest("[data-sim-reset]")) reset();
  });

  box.addEventListener("input", (event) => {
    if (event.target.matches("[data-sim-base]")) {
      sim.base = readInt(event.target.value);
      sim.baseTouched = true;
      if (!sim.running) paintAll();
    }
    if (event.target.matches("[data-sim-target]")) {
      sim.target = readInt(event.target.value);
      sim.targetTouched = true;
      paintHead();
      paintChart();
    }
    if (event.target.matches("[data-sim-ten]")) {
      sim.tenFirst = Number(event.target.value);
      paintPlan();
      paintChart();
      if (!sim.running) paintSlots();
    }
  });

  box.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.matches("input[type='text'], input:not([type])")) event.target.blur();
  });

  /** 계산 화면 상태가 바뀔 때 부른다(무기 종류·시세·첫 노작·목표). 사용자가 직접 고친 값은 덮지 않는다. */
  function refresh() {
    const ctx = context();
    const slots = ctx.slots || 7;
    if (slots !== sim.slots) {
      stopAuto();
      sim.slots = slots;
      sim.results = [];
      sim.celebrated = false;
      sim.tenFirst = Math.min(sim.tenFirst, slots);
    }
    if (!sim.baseTouched && ctx.baseAttack != null && ctx.baseAttack !== sim.base) {
      sim.base = ctx.baseAttack;
      q("[data-sim-base]").value = String(sim.base);
    }
    if (!sim.targetTouched && ctx.targetAttack != null && ctx.targetAttack !== sim.target) {
      sim.target = ctx.targetAttack;
      q("[data-sim-target]").value = String(sim.target);
    }
    if (!sim.running) paintAll();
    else {
      paintPlan();
      paintChart();
    }
  }

  refresh();
  return { refresh };
}

