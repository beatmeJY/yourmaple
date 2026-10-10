import { translateDbError } from "../db-error.js";
import { BURST_COLORS, burstAt, celebrate, sfx } from "../effects.js";
import { rollRefine } from "../sim.js";
import { escapeHtml, formatCount, readBig } from "../format.js";
import {
  ENCHANT_BASE_FEE,
  ENCHANT_TIER_FEES,
  LOW_TO_MID_SUCCESS,
  MAKER_ITEMS,
  MID_TO_HIGH_SUCCESS,
  NORMAL_REFINE_FEE,
  REVERSE_BASE_FEE,
  REVERSE_CATALYST_FEE,
  REVERSE_CATALYST_ODDS,
  REVERSE_HIGH_EXTRA_FEE,
  REVERSE_RECIPE,
  STAGES,
  makerImage,
  makerItemById,
  highRoutes,
  lowBreakEven,
  lowPerMid,
  marketCraftProfits,
  midBreakEven,
  midPerHigh,
  normalRefineOdds,
  normalRefinePercent,
  reverseCraftCost,
  reverseExpectedValue,
  enchantCraftCost,
  tierPrices,
} from "../maker-calc.js";
import { getSupabase } from "../supabase-client.js";
import { notify } from "../toast.js";

const TIERS = [
  { id: "ore", label: "원석" },
  { id: "low", label: "하급" },
  { id: "mid", label: "중급" },
  { id: "high", label: "상급" },
];

function GEMS_FIRST() {
  return MAKER_ITEMS.find((item) => item.category === "gem")?.id ?? MAKER_ITEMS[0].id;
}

function tierLabel(tierId) {
  return TIERS.find((tier) => tier.id === tierId)?.label ?? tierId;
}

const TABS = [
  { id: "gem", label: "보석 제작", icon: "◆", description: "제련 원가와 거래 손익" },
  { id: "craft", label: "리버스 제작", icon: "⚒", description: "재료비와 옵션 기대값" },
  { id: "enchant", label: "장비 옵션 부여", icon: "✦", description: "보석 옵션 계산" },
];

function formatWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function stageIcon(itemId, stageId, label) {
  return `<img class="maker-icon" src="${escapeHtml(makerImage(itemId, stageId))}" alt="" width="28" height="28" data-maker-icon loading="lazy" title="${escapeHtml(label)}" />`;
}

function priceDelta(row, older) {
  if (!older) return { text: "-", className: "" };
  const diff = BigInt(row.price) - BigInt(older.price);
  if (diff === 0n) return { text: "0", className: "" };
  return {
    text: diff > 0n ? `+${formatCount(diff)}` : formatCount(diff),
    className: diff > 0n ? "is-gain" : "is-loss",
  };
}

function priceReading(value) {
  const parsed = readBig(value, "시세", 0n);
  if (parsed.error || parsed.value == null) return "";
  if (parsed.value === 0n) return "0메소";
  const units = ["", "만", "억", "조", "경", "해", "자", "양", "구", "간"];
  const parts = [];
  let amount = parsed.value;
  for (let index = 0; amount > 0n; index += 1) {
    const chunk = amount % 10_000n;
    if (chunk) parts.unshift(`${formatCount(chunk)}${units[index]}`);
    amount /= 10_000n;
  }
  return `${parts.join(" ")}메소`;
}
function meso(value) {
  return value != null ? escapeHtml(formatCount(value)) : "-";
}

function compactMeso(value) {
  const amount = BigInt(value);
  const compact = (unit, label) => {
    const whole = amount / unit;
    const decimal = (amount % unit) / (unit / 10n);
    return `${formatCount(whole)}${decimal ? `.${decimal}` : ""}${label}`;
  };
  if (amount >= 100_000_000n) return compact(100_000_000n, "억");
  if (amount >= 10_000n) return compact(10_000n, "만");
  return formatCount(amount);
}

/** 원석부터 목표 등급까지 단계 아이콘이 차례로 켜지는 길 */
function explainPath(itemId, targetStage) {
  const last = STAGES.findIndex((stage) => stage.id === targetStage);
  return `
    <ol class="maker-path" aria-label="제작 순서">
      ${STAGES.slice(0, last + 1)
        .map(
          (stage, index) => `
            <li class="maker-path-step${index === last ? " is-target" : ""}" style="--i:${index}">
              ${stageIcon(itemId, stage.id, stage.label)}
              <span>${escapeHtml(stage.label)}</span>
            </li>
          `,
        )
        .join("")}
    </ol>
  `;
}

function amount(value) {
  return value.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
}

function explainStep(index, title, formula, value) {
  return `
    <div class="maker-step" style="--i:${index}">
      <span class="maker-step-no">${index + 1}</span>
      <div class="maker-step-text">
        <strong>${escapeHtml(title)}</strong>
        <small>${formula}</small>
      </div>
      <b>${value}</b>
    </div>
  `;
}

function oddsBar(label, percent, tone, index) {
  return `
    <div class="maker-odds-row ${tone}" style="--i:${index};--p:${Math.min(percent, 100)}%">
      <span>${escapeHtml(label)}</span>
      <b>${percent}%</b>
      <div class="maker-odds-bar"><i></i></div>
    </div>
  `;
}

function oddsBlock(title, rows) {
  return `
    <div class="maker-odds">
      <p class="maker-odds-title">${escapeHtml(title)}</p>
      ${rows.join("")}
    </div>
  `;
}

function choiceRow(label, formula, value, badge) {
  return `
    <div class="maker-choice${badge ? " is-chosen" : ""}">
      <div class="maker-choice-text">
        <strong>${escapeHtml(label)}${badge ? `<em>${escapeHtml(badge)}</em>` : ""}</strong>
        ${formula ? `<small>${formula}</small>` : ""}
      </div>
      <b>${value}</b>
    </div>
  `;
}

/** 중급을 사서 상급을 만드는 게 이득인 가격 기준선과, 지금 실거래가 판정 */
function midBreakEvenBlock(extra) {
  const perHigh = midPerHigh();
  const { breakEven, midMarket } = extra;
  const basis = breakEven.basis;
  let verdict = "";
  if (midMarket != null && breakEven.value != null) {
    const gain = breakEven.value - midMarket;
    verdict = choiceRow(
      `지금 실거래가 ${formatCount(midMarket)}`,
      gain >= 0n ? `기준선보다 ${meso(gain)} 싸서 사서 가공하는 게 이득` : `기준선보다 ${meso(-gain)} 비싸서 ${escapeHtml(basis?.label ?? "다른 방법")}이 이득`,
      gain >= 0n ? `+${meso(gain)}` : `−${meso(-gain)}`,
      gain >= 0n ? "이득" : "",
    );
  }
  return `
    <div class="maker-choices">
      <p class="maker-odds-title">중급을 사서 상급 만들기 기준선</p>
      ${choiceRow(
        "이 가격 이하면 사서 가공이 이득",
        basis
          ? `(${escapeHtml(basis.label)} ${meso(basis.cost)} − 평균 제련비 ${meso(Math.round(perHigh.fee))}) ÷ 중급 ${amount(perHigh.count)}개`
          : "원석이나 상급 시세를 기록하면 계산됩니다",
        meso(breakEven.value),
        "",
      )}
      ${verdict}
    </div>
  `;
}

/** 하급을 사서 중급을 만드는 게 이득인 가격 기준선과 현재 실거래가 판정 */
function lowBreakEvenBlock(extra) {
  const perMid = lowPerMid();
  const { lowBuyBreakEven, lowMarket } = extra;
  const basis = lowBuyBreakEven.basis;
  let verdict = "";
  if (lowMarket != null && lowBuyBreakEven.value != null) {
    const gain = lowBuyBreakEven.value - lowMarket;
    verdict = choiceRow(
      `지금 실거래가 ${formatCount(lowMarket)}`,
      gain >= 0n
        ? `기준선보다 ${meso(gain)} 싸서 중급으로 제련하는 게 이득`
        : `기준선보다 ${meso(-gain)} 비싸서 ${escapeHtml(basis?.label ?? "다른 방법")}이 이득`,
      gain >= 0n ? `+${meso(gain)}` : `−${meso(-gain)}`,
      gain >= 0n ? "이득" : "",
    );
  }
  const threshold = lowBuyBreakEven.value;
  return `
    <div class="maker-choices">
      <p class="maker-odds-title">하급을 사서 중급 만들기 기준선</p>
      ${choiceRow(
        threshold === 0n ? "하급 구매·재고 의미 없음" : "이 가격 이하면 사서 제련이 이득",
        basis
          ? `(${escapeHtml(basis.label)} ${meso(basis.cost)} − 평균 제련비 ${meso(Math.round(perMid.fee))}) ÷ 하급 ${amount(perMid.count)}개`
          : "원석이나 중급 시세를 기록하면 계산됩니다",
        threshold === 0n ? "가치 없음" : meso(threshold),
        "",
      )}
      ${verdict}
    </div>
  `;
}

/** 상급을 얻는 세 가지 방법 비교 */
function highRoutesBlock(extra) {
  const perHigh = midPerHigh();
  const { routes, best } = extra.routes;
  const formula = {
    ore: "하급·중급 부산물 가치를 반영한 예상가",
    mid: `중급 실거래가 × ${amount(perHigh.count)}개 + 제련비 ${meso(Math.round(perHigh.fee))}`,
    buy: "경매장 상급 실거래가",
  };
  return `
    <div class="maker-choices">
      <p class="maker-odds-title">상급을 얻는 세 가지 방법</p>
      ${routes.map((route) => choiceRow(route.label, route.cost != null ? formula[route.id] : "시세를 기록하면 계산됩니다", meso(route.cost), best?.id === route.id ? "최저" : "")).join("")}
    </div>
  `;
}

function marketProfitValue(result) {
  if (!result) return `<b class="is-missing">시세 입력 필요</b>`;
  if (result.profit > 0n) return `<b class="is-gain">+${meso(result.profit)} 이득</b>`;
  if (result.profit < 0n) return `<b class="is-loss">−${meso(-result.profit)} 손해</b>`;
  return `<b>손익 없음</b>`;
}

function marketProfitRow(label, result, missing) {
  return `
    <div class="maker-profit-row${result ? (result.profit >= 0n ? " is-gain" : " is-loss") : " is-missing"}">
      <div class="maker-profit-copy">
        <strong>${escapeHtml(label)}</strong>
        <small>${result ? `평균 제작비 ${meso(result.cost)} → 판매가 ${meso(result.revenue)}` : `${escapeHtml(missing)} 시세가 필요합니다`}</small>
      </div>
      ${marketProfitValue(result)}
    </div>
  `;
}

function normalProfitBreakdown(item, result) {
  if (!result?.breakdown) return "";
  const stageLabels = { low: "하급", mid: "중급", high: "상급" };
  return `
    <div class="maker-expectation">
      <p><strong>기대 판매가 계산</strong><span>한 번에는 하나만 나오며, 반복 제련 시 1회 평균입니다.</span></p>
      <div class="maker-expectation-grid">
        ${result.breakdown
          .map(
            (row) => `
              <div class="maker-expectation-item is-${row.stage}">
                ${stageIcon(item.id, row.stage, stageLabels[row.stage])}
                <span>${stageLabels[row.stage]} <b>${row.percent}%</b></span>
                <small>${meso(row.price)} × ${row.percent}%</small>
                <strong>+${meso(row.weighted)}</strong>
              </div>
            `,
          )
          .join("")}
      </div>
      <div class="maker-expectation-cost">
        <span>1회 투입 비용</span>
        <small>원석 10개 ${meso(result.oreCost)} + 조합비 ${meso(result.craftFee)} + 제련비 ${meso(result.refineFee)}</small>
        <b>${meso(result.cost)}</b>
      </div>
      <div class="maker-expectation-total">
        <span>확률을 반영한 1회 기대 판매가</span>
        <b>${meso(result.revenue)}</b>
      </div>
    </div>
  `;
}

/** 기록한 실거래가만 사용한 단계별 제작 손익 */
function marketProfitBlock(item, profits) {
  return `
    <section class="maker-market-profit" aria-label="${escapeHtml(item.name)} 실거래가 제작 손익">
      <div class="maker-profit-head">
        <span class="maker-profit-orb" aria-hidden="true">₩</span>
        <div><strong>실거래가 제작 손익</strong><small>판매 수수료 제외 · 평균값</small></div>
      </div>
      <div class="maker-profit-list">
        ${marketProfitRow("일반 제련 1회", profits.normal, "원석·하급·중급·상급")}
        ${normalProfitBreakdown(item, profits.normal)}
        ${marketProfitRow("하급 → 중급 1개", profits.mid, "하급·중급")}
        ${marketProfitRow("중급 → 상급 1개", profits.high, "중급·상급")}
      </div>
    </section>
  `;
}

function reverseMaterialRow(material) {
  return `
    <label class="reverse-material-card">
      <span class="reverse-material-icon" aria-hidden="true">◆</span>
      <span class="reverse-material-name"><strong>${escapeHtml(material.label)}</strong><small>${formatCount(material.count)}개 필요</small></span>
      <span class="reverse-material-input"><input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="40" autocomplete="off" spellcheck="false" data-reverse-price="${material.id}" aria-label="${escapeHtml(material.label)} 개당 시세" placeholder="개당 시세" /><small data-reverse-reading="${material.id}">메소</small></span>
      <b data-reverse-total="${material.id}">-</b>
    </label>
  `;
}

function reverseGemSelectorHtml() {
  return `
    <div class="reverse-gem-select">
      <div class="enchant-slots reverse-enchant-slots">
        ${[0, 1, 2]
          .map(
            (index) => `
              <article class="enchant-slot reverse-enchant-slot" data-reverse-gem-slot="${index}" style="--i:${index}">
                <div class="enchant-slot-head"><span>상급 보석 슬롯 ${index + 1}</span></div>
                <button type="button" class="enchant-material-button" data-reverse-slot="${index}" aria-expanded="false">
                  <span class="enchant-slot-empty" aria-hidden="true">+</span>
                  <span><strong>보석·크리스탈 선택</strong><small>눌러서 재료 선택</small></span>
                </button>
                <button type="button" class="reverse-gem-price-add enchant-price-add" data-reverse-add-price="${index}" hidden>시세 입력</button>
                <div class="enchant-slot-cost"><span>상급 재료 시세</span><b data-reverse-total="high_${index + 1}">-</b></div>
              </article>
            `,
          )
          .join("")}
      </div>
      <div class="reverse-gem-picker" data-reverse-gem-picker hidden>
        <div class="reverse-gem-picker-head"><strong>상급 재료 선택</strong><small>같은 재료를 여러 번 선택할 수 있습니다.</small></div>
        <div class="reverse-gem-picker-grid">
          ${MAKER_ITEMS.map((item) => `<button type="button" data-reverse-gem="${item.id}" aria-pressed="false">${stageIcon(item.id, "high", `상급 ${item.name}`)}<span>${escapeHtml(item.name)}</span></button>`).join("")}
        </div>
      </div>
    </div>
  `;
}

function reverseCalculatorHtml() {
  return `
    <div class="reverse-workshop" data-reverse-calculator>
      <div class="reverse-workshop-head">
        <div><span class="reverse-kicker">REVERSE FORGE</span><h2>리버스 제작 비용</h2><p>재료의 개당 시세를 입력하면 제작 1회 비용과 파괴 위험까지 계산합니다.</p></div>
        <label class="reverse-catalyst-toggle"><input type="checkbox" data-reverse-catalyst checked /><span aria-hidden="true"></span><strong>촉진제 사용</strong><small>+${formatCount(REVERSE_CATALYST_FEE)}메소</small></label>
      </div>
      <section class="reverse-panel">
        <div class="reverse-panel-title"><span>01</span><div><strong>재료 시세 입력</strong><small>상급 보석·크리스탈은 서로 가격이 다를 수 있어 3개를 따로 입력합니다.</small></div></div>
        <div class="reverse-material-grid">${REVERSE_RECIPE.filter((material) => !material.id.startsWith("high_")).map(reverseMaterialRow).join("")}</div>
        <div class="reverse-gem-divider"><span>상급 보석·크리스탈 3개</span><small>보석 제작에 기록한 상급 실거래가를 사용합니다.</small></div>
        ${reverseGemSelectorHtml()}
      </section>
      <section class="reverse-panel reverse-fixed-panel">
        <div class="reverse-panel-title"><span>02</span><div><strong>고정 제작 비용</strong><small>재료 시세와 별도로 항상 들어가는 메소입니다.</small></div></div>
        <div class="reverse-fixed-grid">
          <div><span>기본 제작비</span><b>${formatCount(REVERSE_BASE_FEE)}</b></div>
          <div><span>상급 재료 추가비</span><small>${formatCount(REVERSE_HIGH_EXTRA_FEE)} × 3개</small><b>${formatCount(REVERSE_HIGH_EXTRA_FEE * 3n)}</b></div>
          <div data-reverse-catalyst-fee><span>촉진제 비용</span><b>${formatCount(REVERSE_CATALYST_FEE)}</b></div>
        </div>
      </section>
      <section class="reverse-panel" data-reverse-odds-panel>
        <div class="reverse-panel-title"><span>03</span><div><strong>촉진제 제작 결과</strong><small>완성 성공률 90% · 파괴 확률 10%</small></div></div>
        <div class="reverse-odds-grid">
          ${REVERSE_CATALYST_ODDS.map((row) => `<div class="reverse-odd${row.bonus == null ? " is-destroy" : row.bonus >= 3 ? " is-rare" : ""}"><span>${escapeHtml(row.label)}</span><b>${row.percent}%</b><i style="--p:${row.percent}%"></i></div>`).join("")}
        </div>
      </section>
      <section class="reverse-panel reverse-value-panel" data-reverse-value-panel>
        <div class="reverse-panel-title"><span>04</span><div><strong>공격력별 적정 판매가</strong><small>전체 제작비를 정옵~+5에 1/6씩 배분한 뒤, 각 옵션의 예상 수량으로 나눕니다. 파괴 10%도 비용에 포함됩니다.</small></div></div>
        <label class="reverse-base-attack"><span>정옵 공격력</span><input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" data-reverse-base-attack placeholder="예: 120" /><small>입력하면 +1~+5 공격력이 자동으로 채워집니다.</small></label>
        <div class="reverse-value-list">
          ${REVERSE_CATALYST_ODDS.filter((row) => row.bonus != null)
            .map(
              (row) => `
                <label class="reverse-value-row">
                  <span class="reverse-value-grade">${escapeHtml(row.label)}</span>
                  <strong data-reverse-attack-label="${row.bonus}">공격력 -</strong>
                  <em>${row.percent}% · 101회 중 ${(101 * row.percent / 100).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}개</em>
                  <b data-reverse-fair-price="${row.bonus}">제작비 입력 대기</b>
                  <span class="reverse-value-input"><input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="40" autocomplete="off" spellcheck="false" data-reverse-output-price="${row.bonus}" aria-label="${escapeHtml(row.label)} 실거래가" placeholder="비교할 실거래가" /><small data-reverse-output-reading="${row.bonus}">선택 입력</small></span>
                </label>
              `,
            )
            .join("")}
          <div class="reverse-value-row is-destroy">
            <span class="reverse-value-grade">파괴</span><strong>장비 없음</strong><em>10% · 101회 중 10.1회</em><b>판매가 0메소</b><span class="reverse-value-zero">회수 금액 없음</span>
          </div>
        </div>
        <p class="hint">계산식: 1회 제작비 ÷ 6 ÷ 옵션 확률. 희귀한 옵션일수록 높은 기준 가격이 됩니다. 이 가격으로 모든 결과물을 판매하면 예상 판매 총액과 제작비가 일치합니다(메소 반올림 차이 제외). 실제 시장 가격을 예측하는 값은 아니며, 실거래가는 비교용 선택 입력입니다.</p>
        <div class="reverse-value-summary" data-reverse-value-summary></div>
        <div class="reverse-target-results" data-reverse-target-results></div>
      </section>
      <section class="reverse-result" data-reverse-result></section>
    </div>
  `;
}

const ENCHANT_TIERS = [
  { id: "low", label: "하급" },
  { id: "mid", label: "중급" },
  { id: "high", label: "상급" },
];

function enchantCalculatorHtml() {
  return `
    <div class="enchant-workshop" data-enchant-calculator>
      <header class="enchant-workshop-head">
        <div><span class="reverse-kicker">OPTION ENCHANT</span><h2>장비 옵션 부여</h2><p>보석·크리스탈을 최대 3개까지 골라 필요한 총 제작비를 확인합니다.</p></div>
        <div class="enchant-base-chip"><span>기본 메이커 비용</span><b>${formatCount(ENCHANT_BASE_FEE)}<small>메소</small></b></div>
      </header>
      <section class="enchant-panel">
        <div class="reverse-panel-title"><span>01</span><div><strong>옵션 재료 선택</strong><small>등급을 고른 뒤 보석 슬롯을 눌러 재료를 선택해 주세요. 같은 재료도 여러 번 사용할 수 있습니다.</small></div></div>
        <div class="enchant-slots">
          ${[0, 1, 2].map((index) => `
            <article class="enchant-slot" data-enchant-slot-card="${index}" style="--i:${index}">
              <div class="enchant-slot-head"><span>보석 슬롯 ${index + 1}</span><button type="button" data-enchant-clear="${index}" hidden>비우기</button></div>
              <div class="enchant-tier-buttons" role="group" aria-label="보석 슬롯 ${index + 1} 등급">
                ${ENCHANT_TIERS.map((tier) => `<button type="button" data-enchant-tier="${tier.id}" data-enchant-index="${index}" class="${tier.id === "high" ? "is-on" : ""}" aria-pressed="${tier.id === "high"}"><span>${tier.label}</span><small>+${formatCount(ENCHANT_TIER_FEES[tier.id])}</small></button>`).join("")}
              </div>
              <button type="button" class="enchant-material-button" data-enchant-slot="${index}" aria-expanded="false">
                <span class="enchant-slot-empty" aria-hidden="true">+</span>
                <span><strong>보석·크리스탈 선택</strong><small>눌러서 재료 선택</small></span>
              </button>
              <button type="button" class="reverse-gem-price-add enchant-price-add" data-enchant-add-price="${index}" hidden>시세 입력</button>
              <div class="enchant-slot-cost" data-enchant-slot-cost="${index}"><span>슬롯 비용</span><b>-</b></div>
            </article>
          `).join("")}
        </div>
        <div class="reverse-gem-picker enchant-gem-picker" data-enchant-gem-picker hidden>
          <div class="reverse-gem-picker-head"><strong>보석·크리스탈 선택</strong><small>현재 선택한 등급의 최신 실거래가를 사용합니다.</small></div>
          <div class="reverse-gem-picker-grid">
            ${MAKER_ITEMS.map((item) => `<button type="button" data-enchant-gem="${item.id}" aria-pressed="false">${stageIcon(item.id, "low", item.name)}<span>${escapeHtml(item.name)}</span></button>`).join("")}
          </div>
        </div>
      </section>
      <section class="enchant-panel enchant-fee-panel">
        <div class="reverse-panel-title"><span>02</span><div><strong>비용 합계</strong><small>보석 실거래가와 등급별 옵션 부여 비용을 더합니다.</small></div></div>
        <div class="enchant-fee-grid">
          <div><span>기본 제작비</span><b>${formatCount(ENCHANT_BASE_FEE)}</b></div>
          <div><span>보석 실거래가</span><b data-enchant-material-total>0</b></div>
          <div><span>등급별 추가 비용</span><b data-enchant-option-total>0</b></div>
        </div>
      </section>
      <section class="enchant-result" data-enchant-result></section>
    </div>
  `;
}

function reverseTargetResultsHtml(targets) {
  const stageLabel = (row) => (row.bonus == null ? "파괴" : row.label);
  return `
    <div class="reverse-target-title"><strong>목표 옵션별 순제작비</strong><small>목표가 나올 때까지 만든 뒤, 다른 완성품을 모두 판매한 결과입니다.</small></div>
    <div class="reverse-target-grid">
      ${targets
        .map((target) => {
          const profit = target.marketProfit;
          const tone = profit >= 0n ? "is-gain" : "is-loss";
          return `
            <article class="reverse-target-card ${tone}">
              <header><span>${escapeHtml(target.label)}</span><strong>공격력 ${formatCount(target.attack)}</strong><em>${target.percent}%</em></header>
              <div class="reverse-target-kpis">
                <div><span>평균 시도</span><b>${target.averageAttempts.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}회</b></div>
                <div><span>총 제작비</span><b>${meso(target.grossCost)}</b></div>
                <div><span>잔여템 판매</span><b>−${meso(target.residualRevenue)}</b></div>
              </div>
              <div class="reverse-target-net"><span>순제작비</span><b>${target.netCost >= 0n ? meso(target.netCost) : `−${meso(-target.netCost)}`}</b></div>
              <div class="reverse-target-market"><span>실거래가 ${meso(target.price)}</span><b>${profit >= 0n ? `+${meso(profit)} 이득` : `−${meso(-profit)} 손해`}</b></div>
              <details>
                <summary>잔여 결과 자세히 보기</summary>
                <div class="reverse-leftover-list">
                  ${target.leftovers
                    .map(
                      (row) => `<div><span>${escapeHtml(stageLabel(row))}${row.attack != null ? ` · 공격력 ${formatCount(row.attack)}` : ""}</span><small>평균 ${row.averageCount.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}개</small><b>${row.expectedRevenue ? `+${meso(row.expectedRevenue)}` : "0메소"}</b></div>`,
                    )
                    .join("")}
                </div>
              </details>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function explainHtml(item, stageId, prices, extra) {
  const normal = prices?.normal ?? null;
  const attempt = prices?.refineAttempt ?? null;
  const output = prices?.output ?? null;
  const unit = item.category === "crystal" ? "크리스탈" : "보석";
  const missing = prices ? "" : `<p class="maker-explain-hint">원석 시세를 기록하면 숫자가 채워집니다.</p>`;
  const outputText = output ? `하급 ${output.low}개 · 중급 ${output.mid}개 · 상급 ${output.high}개` : "확률에 따른 등급별 결과";
  const odds = oddsBlock(
    "일반 1개 제련 결과",
    normalRefineOdds(item.category).map((odd, index) => oddsBar(odd.label, odd.percent, odd.stage === "low" ? "is-main" : "is-lucky", index)),
  );

  if (stageId === "low") {
    const lowResult = prices?.lowMeaningless
      ? `<div class="maker-value-none"><strong>가격·재고 의미 없음</strong><span>중급과 상급 부산물만으로 제련비를 회수할 수 있어 하급에 배분할 원가가 남지 않습니다.</span></div>`
      : `<div class="maker-explain-extra"><span>연립식으로 구한 하급 적정가</span><b>${meso(prices?.low)}</b></div>`;
    return `
      ${explainPath(item.id, "low")}
      <div class="maker-steps">
        ${explainStep(0, "원석 10개 준비", "원석 시세 × 10", meso(prices?.oreCost))}
        ${explainStep(1, `일반 ${unit} 1개 조합`, `+ 조합비 ${meso(prices?.craftFee)}`, meso(normal))}
        ${explainStep(2, "일반 1개 제련 시도", `+ 제련비 ${meso(NORMAL_REFINE_FEE)}`, meso(attempt))}
        ${explainStep(3, "100회 결과의 가치 배분", outputText, meso(prices?.sampleCost))}
      </div>
      ${lowResult}
      ${lowBreakEvenBlock(extra)}
      ${odds}
      <p class="maker-explain-note">100회 제련비를 하급·중급·상급 결과물에 함께 배분하고, 중급과 상급의 승급 손익분기 관계를 연립해 계산합니다. 계산된 하급 가치가 0 이하이면 하급 가격과 재고는 의미가 없는 것으로 처리합니다.</p>
      ${missing}
    `;
  }

  if (stageId === "mid") {
    const lowFormula = prices?.lowMeaningless
      ? "하급의 계산 가치가 0 이하라 비용 배분에서 제외"
      : `하급 ${meso(prices?.low)} × 평균 11개 + 평균 제련비 66만`;
    return `
      ${explainPath(item.id, "mid")}
      <div class="maker-steps">
        ${explainStep(0, "일반 제련 100회 비용", `1회 ${meso(attempt)} × 100`, meso(prices?.sampleCost))}
        ${explainStep(1, "100회 예상 결과", outputText, "가치 배분")}
        ${explainStep(2, "하급 → 중급 손익분기", lowFormula, meso(prices?.mid))}
      </div>
      ${midBreakEvenBlock(extra)}
      ${oddsBlock("중급 승급 확률", [
        oddsBar("일반 → 바로 중급", normalRefinePercent(item.category, "mid"), "is-lucky", 0),
        oddsBar("하급 10개 → 중급", LOW_TO_MID_SUCCESS, "is-main", 1),
        oddsBar("중급 10개 → 상급", MID_TO_HIGH_SUCCESS, "is-main", 2),
      ])}
      <p class="maker-explain-note">중급 적정가는 하급 10개와 실패 시 소모되는 평균 하급 0.1개, 평균 제련비를 반영합니다. 하급 가치가 없으면 일반 제련에서 나온 중급·상급만으로 100회 비용을 나누어 중급 가격을 계산합니다.</p>
      ${missing}
    `;
  }

  return `
    ${explainPath(item.id, "high")}
    <div class="maker-steps">
      ${explainStep(0, "일반 제련 100회 비용", `1회 ${meso(attempt)} × 100`, meso(prices?.sampleCost))}
      ${explainStep(1, "함께 나온 부산물 차감", `${outputText}${prices?.lowMeaningless ? " · 하급 제외" : ""}`, "중급·상급에 배분")}
      ${explainStep(2, "중급 → 상급 손익분기", `중급 ${meso(prices?.mid)} × 평균 13개 + 평균 제련비 220만`, meso(prices?.high))}
    </div>
    ${oddsBlock("상급까지 가는 확률", [
      oddsBar("일반 → 바로 상급", normalRefinePercent(item.category, "high"), "is-lucky", 0),
      oddsBar("일반 → 바로 중급", normalRefinePercent(item.category, "mid"), "is-lucky", 1),
      oddsBar("하급 10개 → 중급", LOW_TO_MID_SUCCESS, "is-main", 2),
      oddsBar("중급 10개 → 상급", MID_TO_HIGH_SUCCESS, "is-main", 3),
    ])}
    <div class="maker-explain-extra">
      <span>부산물 가치를 반영한 상급 적정가</span>
      <b>${meso(prices?.high)}</b>
    </div>
    ${highRoutesBlock(extra)}
    <p class="maker-explain-note">상급 적정가는 일반 제련 100회의 총비용에서 함께 나온 하급·중급의 가치를 차감한 결과입니다. 중급 13개와 평균 제련비 220만으로 상급 1개를 얻는 손익분기 관계도 함께 만족하도록 계산합니다.</p>
    ${missing}
  `;
}

export async function render(root) {
  root.innerHTML = `
    <div class="maker-page">
      <header class="page-header maker-page-header">
        <div class="maker-title-block">
          <p class="trade-kicker">메이커</p>
          <div class="trade-hero-row">
            <h1>메이커 계산</h1>
          </div>
        </div>
        <section class="maker-price-board" aria-label="보석 시세 보관함">
          <div class="maker-price-card-grid" id="maker-price-body" data-price-body inert aria-hidden="true"></div>
          <button type="button" class="maker-price-board-head" data-toggle-price-board aria-expanded="false" aria-controls="maker-price-body">
            <strong><span aria-hidden="true">◆</span> 보석 시세</strong>
            <small data-price-board-summary>불러오는 중</small>
            <span class="maker-price-toggle" aria-hidden="true">⌄</span>
          </button>
        </section>
      </header>
      <div class="trade-segments maker-tabs" data-maker-tabs role="tablist" aria-label="메이커 기능">
        ${TABS.map((tab, index) => `<button type="button" class="maker-tab-button ${index === 0 ? "is-on" : ""}" data-tab="${tab.id}" role="tab" aria-selected="${index === 0}" aria-controls="maker-panel-${tab.id}"><span class="maker-tab-icon" aria-hidden="true">${tab.icon}</span><span class="maker-tab-copy"><strong>${escapeHtml(tab.label)}</strong><small>${escapeHtml(tab.description)}</small></span><i aria-hidden="true"></i></button>`).join("")}
      </div>
      <section id="maker-panel-gem" class="trade-board maker-tab-panel" data-tab-panel="gem" role="tabpanel">
        <div class="mk-gem" data-craft-body></div>
      </section>
      <section id="maker-panel-craft" class="trade-board maker-tab-panel" data-tab-panel="craft" role="tabpanel" hidden>
        ${reverseCalculatorHtml()}
      </section>
      <section id="maker-panel-enchant" class="trade-board maker-tab-panel" data-tab-panel="enchant" role="tabpanel" hidden>
        ${enchantCalculatorHtml()}
      </section>
      <div class="maker-quick-price-layer" data-quick-price-layer hidden>
        <section class="maker-quick-price-panel" data-quick-price-panel role="dialog" aria-modal="true" aria-labelledby="maker-quick-price-title">
          <div data-quick-price-content></div>
        </section>
      </div>
      <dialog class="belt-history-dialog" data-price-history-dialog>
        <div class="belt-history-head">
          <h2 data-price-history-title>시세 기록</h2>
          <button class="text-button" type="button" data-price-history-close aria-label="닫기">닫기</button>
        </div>
        <div data-price-history-body></div>
        <div class="belt-history-add" data-price-history-add></div>
      </dialog>
    </div>
  `;

  const tabBar = root.querySelector("[data-maker-tabs]");
  const priceBody = root.querySelector("[data-price-body]");
  const craftBody = root.querySelector("[data-craft-body]");
  const historyDialog = root.querySelector("[data-price-history-dialog]");
  const reverseCalculator = root.querySelector("[data-reverse-calculator]");
  const enchantCalculator = root.querySelector("[data-enchant-calculator]");
  const quickPriceLayer = root.querySelector("[data-quick-price-layer]");

  let priceRows = [];
  let loadId = 0;
  const openExplain = new Set();
  // 시안 배치: 왼쪽에서 고른 재료 하나의 체인을 오른쪽에 크게 보여 준다.
  let pickedItemId = GEMS_FIRST();
  let explainStage = "";
  // 제련 시뮬레이터(시안): 고른 재료가 바뀌면 처음부터.
  let refineSim = { itemId: pickedItemId, tries: 0, low: 0, mid: 0, high: 0, last: "" };
  let refineTimer = 0;
  const reverseHighSelections = [null, null, null];
  let reverseActiveSlot = null;
  const enchantSelections = [
    { itemId: null, tier: "high" },
    { itemId: null, tier: "high" },
    { itemId: null, tier: "high" },
  ];
  let enchantActiveSlot = null;
  let quickPriceItemId = null;
  let quickPriceCloseTimer = 0;

  function moveEnchantSelection(itemId, targetIndex) {
    const sourceIndex = enchantSelections.findIndex((selection, index) => index !== targetIndex && selection.itemId === itemId);
    if (sourceIndex < 0) {
      enchantSelections[targetIndex].itemId = itemId;
      return null;
    }

    const movedSelection = { ...enchantSelections[sourceIndex] };
    enchantSelections[sourceIndex] = { itemId: null, tier: "high" };
    enchantSelections[targetIndex] = movedSelection;
    return sourceIndex;
  }

  function moveReverseSelection(itemId, targetIndex) {
    const sourceIndex = reverseHighSelections.findIndex((selectedItemId, index) => index !== targetIndex && selectedItemId === itemId);
    if (sourceIndex < 0) {
      reverseHighSelections[targetIndex] = itemId;
      return null;
    }

    reverseHighSelections[sourceIndex] = null;
    reverseHighSelections[targetIndex] = itemId;
    return sourceIndex;
  }

  function historyFor(itemId, tierId) {
    return priceRows.filter((row) => row.item === itemId && row.tier === tierId);
  }

  function latestPrice(itemId, tierId) {
    return historyFor(itemId, tierId)[0] ?? null;
  }

  function priceEditor(itemId, tierId) {
    const key = `${itemId}:${tierId}`;
    return `<div class="maker-price-editor">
      <div class="maker-price-caption"><span>시세 등록</span><small>메소 단위</small></div>
      <div class="maker-price-entry">
        <label class="maker-price-field"><span class="maker-meso-coin" aria-hidden="true">M</span><input class="maker-price" data-price-input="${key}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="40" autofocus autocomplete="off" spellcheck="false" aria-label="새 시세" placeholder="금액 입력" aria-describedby="maker-price-reading" /></label>
        <div class="maker-price-badge"><span class="maker-price-badge-label">입력 금액</span><output id="maker-price-reading" class="maker-price-reading" data-price-reading aria-live="polite">금액을 입력해 주세요</output></div>
      </div>
      <div class="maker-price-footer"><small><kbd>Enter</kbd>로 바로 저장</small><button class="maker-price-save" type="button" data-save-price="${key}">시세 저장 <span aria-hidden="true">✦</span></button></div>
    </div>`;
  }

  function historyBody(itemId, tierId) {
    const history = historyFor(itemId, tierId);
    if (!history.length) return `<p class="hint">아직 시세가 없습니다.</p>`;
    const rows = history
      .map((row, index) => {
        const delta = priceDelta(row, history[index + 1]);
        return `<tr><td class="num">${escapeHtml(formatCount(row.price))}</td><td class="num ${delta.className}">${escapeHtml(delta.text)}</td><td>${escapeHtml(formatWhen(row.created_at))}</td><td><button class="text-button is-danger" type="button" data-delete-price="${escapeHtml(row.id)}">삭제</button></td></tr>`;
      })
      .join("");
    return `<div class="table-wrap"><table class="data-table"><thead><tr><th>시세</th><th>이전과 차이</th><th>기록 시각</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function refreshHistory() {
    const itemId = historyDialog.dataset.item;
    const tierId = historyDialog.dataset.tier;
    if (!itemId || !tierId) return;
    historyDialog.querySelector("[data-price-history-body]").innerHTML = historyBody(itemId, tierId);
    historyDialog.querySelector("[data-price-history-add]").innerHTML = priceEditor(itemId, tierId);
  }

  function openHistory(itemId, tierId) {
    const item = makerItemById(itemId);
    if (!item) return;
    historyDialog.dataset.item = itemId;
    historyDialog.dataset.tier = tierId;
    historyDialog.querySelector("[data-price-history-title]").textContent = `${item.name} ${tierLabel(tierId)} 시세 기록`;
    refreshHistory();
    if (!historyDialog.open) historyDialog.showModal();
    historyDialog.querySelector("[data-price-input]")?.focus({ preventScroll: true });
  }

  function quickPriceHtml(item) {
    return `
      <header class="maker-quick-price-head">
        <div class="maker-quick-price-title">${stageIcon(item.id, "normal", item.name)}<div><span>QUICK MARKET</span><h2 id="maker-quick-price-title">${escapeHtml(item.name)} 시세</h2></div></div>
        <button type="button" data-quick-price-close aria-label="빠른 시세 편집 닫기">×</button>
      </header>
      <p>현재 보석의 원석부터 상급까지 한 번에 수정합니다.</p>
      <div class="maker-quick-price-grid">
        ${TIERS.map((tier) => {
          const key = `${item.id}:${tier.id}`;
          const latest = latestPrice(item.id, tier.id);
          const value = latest ? String(latest.price) : "";
          return `
            <div class="maker-quick-price-row${latest ? " has-price" : ""}">
              <span class="maker-quick-tier">${stageIcon(item.id, tier.id, `${tier.label} ${item.name}`)}<b>${escapeHtml(tier.label)}</b></span>
              <span class="maker-quick-input"><input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="40" autocomplete="off" spellcheck="false" data-price-input="${key}" value="${escapeHtml(value)}" aria-label="${escapeHtml(item.name)} ${escapeHtml(tier.label)} 시세" placeholder="시세 입력" /><small data-quick-price-reading>${latest ? escapeHtml(priceReading(value)) : "등록된 시세 없음"}</small></span>
              <button type="button" data-save-price="${key}">${latest ? "수정" : "저장"}</button>
            </div>
          `;
        }).join("")}
      </div>
      <small class="maker-quick-price-help">Enter로 저장 · 바깥을 누르면 닫힙니다</small>
    `;
  }

  function refreshQuickPrice() {
    if (!quickPriceItemId || quickPriceLayer.hidden) return;
    const item = makerItemById(quickPriceItemId);
    if (!item) return;
    quickPriceLayer.querySelector("[data-quick-price-content]").innerHTML = quickPriceHtml(item);
  }

  function openQuickPrice(itemId) {
    const item = makerItemById(itemId);
    if (!item) return;
    window.clearTimeout(quickPriceCloseTimer);
    quickPriceItemId = itemId;
    quickPriceLayer.hidden = false;
    quickPriceLayer.classList.remove("is-closing");
    refreshQuickPrice();
    window.requestAnimationFrame(() => quickPriceLayer.classList.add("is-open"));
    quickPriceLayer.querySelector("[data-price-input]")?.focus({ preventScroll: true });
  }

  function closeQuickPrice() {
    if (quickPriceLayer.hidden) return;
    quickPriceLayer.classList.remove("is-open");
    quickPriceLayer.classList.add("is-closing");
    quickPriceCloseTimer = window.setTimeout(() => {
      quickPriceLayer.hidden = true;
      quickPriceLayer.classList.remove("is-closing");
      quickPriceItemId = null;
    }, 400);
  }

  function paintPrices() {
    priceBody.innerHTML = MAKER_ITEMS.map((item) => {
      const priceButton = (tier) => {
        const latest = latestPrice(item.id, tier.id);
        const fullPrice = latest ? `${formatCount(latest.price)}메소` : "시세 없음";
        return `<button type="button" class="maker-market-chip maker-price-cell${latest ? "" : " is-missing"}" data-price-cell="${item.id}:${tier.id}" title="${escapeHtml(fullPrice)}" aria-label="${escapeHtml(item.name)} ${escapeHtml(tier.label)} 시세 기록 보기"><span>${escapeHtml(tier.label)}</span><b>${latest ? escapeHtml(compactMeso(latest.price)) : "입력"}</b></button>`;
      };
      const oreTier = TIERS.find((tier) => tier.id === "ore");
      const gradeTiers = TIERS.filter((tier) => tier.id !== "ore");
      return `<article class="maker-market-card"><div class="maker-market-card-top" data-quick-price-item="${item.id}" role="button" tabindex="0" aria-label="${escapeHtml(item.name)} 전체 시세 빠르게 수정">${stageIcon(item.id, "normal", item.name)}<strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong>${priceButton(oreTier)}</div><div class="maker-market-grades">${gradeTiers.map(priceButton).join("")}</div></article>`;
    }).join("");
    const tierCounts = Object.fromEntries(TIERS.map((tier) => [tier.id, MAKER_ITEMS.filter((item) => latestPrice(item.id, tier.id)).length]));
    const registered = Object.values(tierCounts).reduce((sum, count) => sum + count, 0);
    root.querySelector("[data-price-board-summary]").textContent = `${registered}/${MAKER_ITEMS.length * TIERS.length} 입력 · 모든 계산에 공용`;
  }

  function craftExtra(item) {
    const ore = latestPrice(item.id, "ore");
    const high = latestPrice(item.id, "high");
    const prices = ore ? tierPrices(item.category, BigInt(ore.price), item.id) : null;
    const buyCost = high ? BigInt(high.price) : null;
    const midMarket = latestPrice(item.id, "mid");
    const midMarketPrice = midMarket ? BigInt(midMarket.price) : null;
    const lowMarket = latestPrice(item.id, "low");
    const lowMarketPrice = lowMarket ? BigInt(lowMarket.price) : null;
    const marketPrices = { ore: ore ? BigInt(ore.price) : null, low: lowMarketPrice, mid: midMarketPrice, high: buyCost };
    const marketProfits = marketCraftProfits(item.category, marketPrices, item.id);
    const routes = highRoutes(prices?.high ?? null, midMarketPrice, buyCost);
    const others = routes.routes.filter((route) => route.id !== "mid" && route.cost != null);
    const basis = others.length ? others.reduce((a, b) => (b.cost < a.cost ? b : a)) : null;
    const breakEven = { value: midBreakEven(basis?.cost ?? null), basis };
    const midOptions = [
      { id: "ore", label: "원석부터 제련", cost: prices?.mid ?? null },
      { id: "buy", label: "중급 바로 구매", cost: midMarketPrice },
    ].filter((route) => route.cost != null);
    const lowBasis = midOptions.length ? midOptions.reduce((a, b) => (b.cost < a.cost ? b : a)) : null;
    const lowBuyBreakEven = { value: lowBreakEven(lowBasis?.cost ?? null), basis: lowBasis };
    return { ore, prices, marketProfits, extra: { routes, breakEven, midMarket: midMarketPrice, lowBuyBreakEven, lowMarket: lowMarketPrice } };
  }

  // 시세와 적정가 차이(%)를 0.1% 단위로. 시세가 낮으면 사기 좋고, 높으면 만들어 팔기 좋다.
  function verdict(market, fair) {
    if (market == null || fair == null || fair <= 0n) return null;
    const diff = market - fair;
    const tenth = Number((diff * 1000n) / fair) / 10;
    if (diff === 0n) return { text: "적정가", tone: "is-even" };
    return diff < 0n
      ? { text: `−${Math.abs(tenth).toFixed(1)}% · 사기 좋음`, tone: "is-buy", title: "시세가 적정가보다 낮아요. 사는 쪽이 이득이에요." }
      : { text: `+${tenth.toFixed(1)}% · 팔기 좋음`, tone: "is-sell", title: "시세가 적정가보다 높아요. 만들어 파는 쪽이 이득이에요." };
  }

  // 결과 1개의 값: 실거래가가 있으면 그것, 없으면 적정가(하급 가치 없음이면 0).
  function stageValue(item, stageId, prices) {
    const market = latestPrice(item.id, stageId);
    if (market) return BigInt(market.price);
    return prices?.[stageId] ?? null;
  }

  function refineSimHtml(item, prices) {
    const sim = refineSim;
    const attempt = prices?.refineAttempt ?? null;
    const last = sim.last;
    const lastLabel = last ? `${tierLabel(last)}${last === "high" ? "!" : ""}` : "준비";
    const tally = ["low", "mid", "high"]
      .map((stageId) => `<div class="mk-tally is-${stageId}">${stageIcon(item.id, stageId, tierLabel(stageId))}<span><small>${tierLabel(stageId)}</small><strong>${formatCount(sim[stageId])}</strong></span></div>`)
      .join("");
    let profit = "";
    if (sim.tries) {
      if (attempt == null) profit = `<span class="mk-sim-profit">원석 시세를 적으면 손익을 계산해요</span>`;
      else {
        const values = ["low", "mid", "high"].map((stageId) => stageValue(item, stageId, prices));
        const earned = ["low", "mid", "high"].reduce((sum, stageId, index) => sum + BigInt(sim[stageId]) * (values[index] ?? 0n), 0n);
        const spent = attempt * BigInt(sim.tries);
        const diff = earned - spent;
        profit = `<span class="mk-sim-profit ${diff >= 0n ? "is-gain" : "is-loss"}" title="결과 가치 ${formatCount(earned)} − 제련비 ${formatCount(spent)} (실거래가가 없으면 적정가)">${diff >= 0n ? "+" : ""}${formatCount(diff)}메소</span>`;
      }
    }
    return `
      <div class="mk-sim-head"><h2>제련 시뮬레이터</h2><button type="button" class="mk-ghost" data-refine-reset>초기화</button></div>
      <div class="mk-sim-row">
        <div class="mk-ped is-${last || "none"}">
          <i class="mk-ped-glow" aria-hidden="true"></i><i class="mk-ped-ring" aria-hidden="true"></i>
          <span class="mk-ped-item" data-refine-item>${stageIcon(item.id, last || "normal", last ? tierLabel(last) : item.name)}</span>
        </div>
        <div class="mk-sim-copy">
          <span>${sim.tries ? "마지막 결과" : `일반 ${escapeHtml(item.name)} 1개로 제련해 보세요`}</span>
          <strong class="is-${last || "none"}">${lastLabel}</strong>
          <small>1회 ${attempt != null ? `${escapeHtml(compactMeso(attempt))}메소` : "비용은 원석 시세 입력 후"} · 일반 1개 소모</small>
        </div>
      </div>
      <div class="mk-sim-actions">
        <button type="button" class="mk-refine-1" data-refine="1"${refineTimer ? " disabled" : ""}>1회 제련</button>
        <button type="button" class="mk-refine-10" data-refine="10"${refineTimer ? " disabled" : ""}>10회 연속</button>
      </div>
      <div class="mk-tallies">${tally}</div>
      <div class="mk-sim-foot"><span>${sim.tries ? `${formatCount(sim.tries)}회 제련` : "아직 제련하지 않았어요"}</span>${profit}</div>`;
  }

  function paintRefineSim(fresh = false) {
    const box = craftBody.querySelector("[data-refine-sim]");
    const item = makerItemById(pickedItemId) ?? MAKER_ITEMS[0];
    if (!box) return;
    const ore = latestPrice(item.id, "ore");
    const prices = ore ? tierPrices(item.category, BigInt(ore.price), item.id) : null;
    box.innerHTML = refineSimHtml(item, prices);
    if (fresh) box.querySelector(".mk-ped")?.classList.add("is-fresh");
  }

  function refineOnce() {
    const item = makerItemById(pickedItemId) ?? MAKER_ITEMS[0];
    const stage = rollRefine(normalRefineOdds(item.category));
    refineSim = { ...refineSim, tries: refineSim.tries + 1, [stage]: refineSim[stage] + 1, last: stage };
    paintRefineSim(true);
    const target = craftBody.querySelector(".mk-ped");
    if (stage === "high") {
      sfx("fanfare");
      burstAt(target, ["#ffe28a", "#fff4c2", "#ffffff"], 40, 1.3);
      celebrate("상급 획득!", `상급 ${item.name}`);
    } else if (stage === "mid") {
      sfx("mid");
      burstAt(target, BURST_COLORS.mid, 20, 0.9);
    } else {
      sfx("low");
    }
    return stage;
  }

  function refine(count) {
    if (refineTimer) return;
    if (count === 1) {
      refineOnce();
      return;
    }
    let left = count;
    refineTimer = setInterval(() => {
      if (!craftBody.isConnected) {
        clearInterval(refineTimer);
        refineTimer = 0;
        return;
      }
      left -= 1;
      const stage = refineOnce();
      // 상급이 나오면 연출을 볼 수 있게 멈춘다.
      if (left <= 0 || stage === "high") {
        clearInterval(refineTimer);
        refineTimer = 0;
        paintRefineSim();
      }
    }, 160);
    paintRefineSim();
  }

  function paintCraft() {
    const item = makerItemById(pickedItemId) ?? MAKER_ITEMS[0];
    if (refineSim.itemId !== item.id) {
      clearInterval(refineTimer);
      refineTimer = 0;
      refineSim = { itemId: item.id, tries: 0, low: 0, mid: 0, high: 0, last: "" };
    }
    const { ore, prices, marketProfits, extra } = craftExtra(item);
    const { routes, breakEven, lowBuyBreakEven } = extra;
    const picker = (category, title) => `
      <span class="mk-pick-label">${title}</span>
      <div class="mk-pick-grid">${MAKER_ITEMS.filter((entry) => entry.category === category)
        .map((entry) => {
          const on = entry.id === item.id;
          const hasOre = Boolean(latestPrice(entry.id, "ore"));
          return `<button type="button" class="mk-pick${on ? " is-on" : ""}" data-pick-item="${entry.id}" aria-pressed="${on}">${stageIcon(entry.id, "normal", entry.name)}<span>${escapeHtml(entry.name)}</span>${hasOre ? "" : `<small>시세 없음</small>`}</button>`;
        })
        .join("")}</div>`;
    const nodes = STAGES.map((stage, index) => {
      const market = latestPrice(item.id, stage.id);
      const fair = stage.id === "ore" ? null : stage.id === "normal" ? prices?.normal ?? null : prices?.[stage.id] ?? null;
      const meaningless = stage.id === "low" && prices?.lowMeaningless;
      const value = stage.id === "ore" ? (market ? meso(market.price) : "입력 필요") : meaningless ? "가치 없음" : fair != null ? meso(fair) : "-";
      const note = stage.id === "ore"
        ? "개당 시세"
        : stage.id === "normal"
          ? "원석 10개 + 제작비"
          : market
            ? `실거래 ${escapeHtml(compactMeso(market.price))}`
            : "실거래 기록 없음";
      const clickable = ["low", "mid", "high"].includes(stage.id) && prices;
      const tag = clickable ? "button" : "div";
      const next = index < STAGES.length - 1
        ? `<span class="mk-link" aria-hidden="true"><small>${STAGES[index + 1].id === "normal" ? "10개 조합" : STAGES[index + 1].id === "low" ? "제련" : STAGES[index + 1].id === "mid" ? `10개 · ${LOW_TO_MID_SUCCESS}%` : `10개 · ${MID_TO_HIGH_SUCCESS}%`}</small><i></i></span>`
        : "";
      return `<div class="mk-node-wrap">
        <${tag} class="mk-node is-${stage.id}${explainStage === stage.id ? " is-open" : ""}"${clickable ? ` type="button" data-explain-stage="${stage.id}" aria-expanded="${explainStage === stage.id}"` : ""} style="--i:${index}">
          <span class="mk-node-art">${stageIcon(item.id, stage.id, `${stage.label} ${item.name}`)}</span>
          <span class="mk-node-label">${escapeHtml(stage.label)}</span>
          <strong>${value}</strong>
          <small>${note}</small>
        </${tag}>
        ${next}
      </div>`;
    }).join("");
    const explain = explainStage && prices
      ? `<div class="mk-explain"><div class="mk-explain-head"><strong>${escapeHtml(tierLabel(explainStage))} 적정가 계산</strong><button type="button" class="mk-ghost" data-explain-stage="${explainStage}">접기</button></div>${explainHtml(item, explainStage, prices, extra)}</div>`
      : "";
    const odds = normalRefineOdds(item.category);
    const oddsColors = { low: "oklch(0.82 0.11 210)", mid: "oklch(0.8 0.15 295)", high: "oklch(0.88 0.15 85)" };
    const compare = ["low", "mid", "high"]
      .map((stageId) => {
        const market = latestPrice(item.id, stageId);
        const fair = prices?.[stageId] ?? null;
        const result = verdict(market ? BigInt(market.price) : null, fair);
        return `<div class="mk-cmp">
          ${stageIcon(item.id, stageId, tierLabel(stageId))}
          <span class="mk-cmp-copy"><strong>${escapeHtml(tierLabel(stageId))} 시세 ${market ? escapeHtml(compactMeso(market.price)) : "없음"}</strong><small>적정가 ${fair != null ? escapeHtml(compactMeso(fair)) : "-"}</small></span>
          ${result ? `<span class="mk-verdict ${result.tone}"${result.title ? ` title="${escapeHtml(result.title)}"` : ""}>${escapeHtml(result.text)}</span>` : `<button type="button" class="mk-verdict is-empty" data-price-cell="${item.id}:${stageId}">시세 입력</button>`}
        </div>`;
      })
      .join("");
    craftBody.innerHTML = `
      <section class="mk-panel mk-picker">
        <h2>재료 선택</h2>
        ${picker("gem", "보석")}
        ${picker("crystal", "크리스탈")}
      </section>
      <div class="mk-right">
        <section class="mk-panel mk-chain">
          <div class="mk-chain-head">
            <h2>${escapeHtml(item.name)} 적정가</h2>
            <label class="mk-ore">
              <span>원석 시세</span>
              <input data-ore-input="${item.id}" inputmode="numeric" maxlength="40" autocomplete="off" value="${ore ? escapeHtml(String(ore.price)) : ""}" placeholder="원석 1개" aria-label="${escapeHtml(item.name)} 원석 시세" />
              <small data-ore-reading>${ore ? escapeHtml(priceReading(String(ore.price))) : "메소"}</small>
              <button type="button" data-save-ore="${item.id}">저장</button>
            </label>
            <button type="button" class="mk-ghost" data-price-cell="${item.id}:ore">기록</button>
          </div>
          ${prices ? "" : `<p class="mk-muted">원석 시세를 적으면 일반부터 상급까지 적정가를 계산해요.</p>`}
          <div class="mk-nodes">${nodes}</div>
          ${prices ? `<p class="mk-muted">하급·중급·상급을 누르면 계산 과정을 볼 수 있어요. 적정가는 제련할 때 함께 나오는 부산물 가치까지 나눠 반영한 값이에요.</p>` : ""}
          ${explain}
        </section>
        <div class="mk-split">
          <section class="mk-panel mk-sim" data-refine-sim>${refineSimHtml(item, prices)}</section>
          <section class="mk-panel mk-odds">
            <h2>일반 1회 제련 확률</h2>
            <div class="mk-odds-bar">${odds.map((odd) => `<i style="width:${odd.percent}%;--c:${oddsColors[odd.stage]}"></i>`).join("")}</div>
            <div class="mk-odds-legend">${odds.map((odd) => `<span><i style="--c:${oddsColors[odd.stage]}"></i>${escapeHtml(odd.label)} <small>${odd.percent}%</small></span>`).join("")}</div>
            <div class="mk-cmp-list">
              <span class="mk-cmp-title">시세 비교</span>
              ${compare}
            </div>
          </section>
          <section class="mk-panel mk-routes">
            <h2>상급을 가장 싸게 얻는 방법</h2>
            <div class="mk-route-list">
              ${routes.routes
                .map((route) => `<div class="mk-route${routes.best?.id === route.id ? " is-best" : ""}"><span>${escapeHtml(route.label)}${routes.best?.id === route.id ? "<em>최저</em>" : ""}</span><b>${meso(route.cost)}</b></div>`)
                .join("")}
            </div>
            ${breakEven.value != null ? `<div class="mk-hint-row"><span>중급이 이 가격 이하면 사서 가공 이득</span><b>${meso(breakEven.value)}</b></div>` : ""}
            ${lowBuyBreakEven.value != null ? `<div class="mk-hint-row${lowBuyBreakEven.value === 0n ? " is-muted" : ""}"><span>${lowBuyBreakEven.value === 0n ? "하급 구매·재고 의미 없음" : "하급이 이 가격 이하면 중급 제련 이득"}</span><b>${lowBuyBreakEven.value === 0n ? "가치 없음" : meso(lowBuyBreakEven.value)}</b></div>` : ""}
            ${marketProfitBlock(item, marketProfits)}
          </section>
        </div>
      </div>`;
  }

  function paint() {
    paintPrices();
    paintCraft();
    updateReverseCalculator();
    updateEnchantCalculator();
    refreshQuickPrice();
    if (historyDialog.open) refreshHistory();
  }

  function updateEnchantSlots() {
    if (!enchantCalculator) return;
    for (let index = 0; index < enchantSelections.length; index += 1) {
      const selection = enchantSelections[index];
      const item = selection.itemId ? makerItemById(selection.itemId) : null;
      const market = item ? latestPrice(item.id, selection.tier) : null;
      const card = enchantCalculator.querySelector(`[data-enchant-slot-card="${index}"]`);
      const selectButton = card.querySelector("[data-enchant-slot]");
      const addPriceButton = card.querySelector("[data-enchant-add-price]");
      const clearButton = card.querySelector("[data-enchant-clear]");
      const tier = ENCHANT_TIERS.find((row) => row.id === selection.tier);
      card.classList.toggle("has-selection", Boolean(item));
      card.classList.toggle("is-missing-price", Boolean(item && !market));
      card.classList.toggle("is-active", enchantActiveSlot === index);
      selectButton.setAttribute("aria-expanded", String(enchantActiveSlot === index));
      selectButton.innerHTML = item
        ? `${stageIcon(item.id, selection.tier, `${tier?.label ?? ""} ${item.name}`)}<span><strong>${escapeHtml(tier?.label ?? "")} ${escapeHtml(item.name)}</strong><small>${market ? `실거래 ${meso(market.price)}` : "등록된 시세 없음"}</small></span>`
        : `<span class="enchant-slot-empty" aria-hidden="true">+</span><span><strong>보석·크리스탈 선택</strong><small>눌러서 재료 선택</small></span>`;
      addPriceButton.hidden = !item || Boolean(market);
      clearButton.hidden = !item;
      for (const tierButton of card.querySelectorAll("[data-enchant-tier]")) {
        const selected = tierButton.dataset.enchantTier === selection.tier;
        tierButton.classList.toggle("is-on", selected);
        tierButton.setAttribute("aria-pressed", String(selected));
      }
    }

    const active = enchantActiveSlot == null ? null : enchantSelections[enchantActiveSlot];
    for (const option of enchantCalculator.querySelectorAll("[data-enchant-gem]")) {
      const item = makerItemById(option.dataset.enchantGem);
      const selected = Boolean(active && active.itemId === item?.id);
      option.classList.toggle("is-selected", selected);
      option.setAttribute("aria-pressed", String(selected));
      if (item && active) option.innerHTML = `${stageIcon(item.id, active.tier, `${tierLabel(active.tier)} ${item.name}`)}<span>${escapeHtml(item.name)}</span>`;
    }
  }

  function updateEnchantCalculator() {
    if (!enchantCalculator) return;
    const selections = enchantSelections.map((selection, slotIndex) => {
      const market = selection.itemId ? latestPrice(selection.itemId, selection.tier) : null;
      return { ...selection, slotIndex, marketPrice: market ? BigInt(market.price) : null };
    });
    const result = enchantCraftCost(selections);
    result.rows.forEach((row) => {
      const cost = enchantCalculator.querySelector(`[data-enchant-slot-cost="${row.slotIndex}"]`);
      if (cost) cost.querySelector("b").textContent = row.cost == null ? "시세 입력 필요" : `${formatCount(row.cost)}메소`;
    });
    enchantSelections.forEach((selection, index) => {
      if (selection.itemId) return;
      enchantCalculator.querySelector(`[data-enchant-slot-cost="${index}"] b`).textContent = "-";
    });
    enchantCalculator.querySelector("[data-enchant-material-total]").textContent = formatCount(result.materialCost);
    enchantCalculator.querySelector("[data-enchant-option-total]").textContent = formatCount(result.optionFee);
    const missing = result.rows.filter((row) => row.marketPrice == null);
    const resultRoot = enchantCalculator.querySelector("[data-enchant-result]");
    if (!result.rows.length) {
      resultRoot.innerHTML = `<div class="enchant-result-wait"><strong>보석 슬롯을 선택해 주세요</strong><span>1개부터 최대 3개까지 계산할 수 있습니다.</span></div>`;
    } else if (missing.length) {
      resultRoot.innerHTML = `<div class="enchant-result-wait"><strong>${missing.length}개 보석의 시세가 필요합니다</strong><span>각 슬롯의 시세 입력 버튼으로 바로 기록할 수 있습니다.</span></div>`;
    } else {
      resultRoot.innerHTML = `<div class="enchant-result-label"><span>선택한 ${result.rows.length}개 보석의 총 제작비</span><small>기본 제작비 + 실거래가 + 등급별 추가 비용</small></div><b>${formatCount(result.totalCost)}<small>메소</small></b><em>${escapeHtml(priceReading(result.totalCost.toString()))}</em>`;
    }
    updateEnchantSlots();
  }

  function updateReverseGemSlots() {
    if (!reverseCalculator) return;
    for (let index = 0; index < reverseHighSelections.length; index += 1) {
      const itemId = reverseHighSelections[index];
      const item = itemId ? makerItemById(itemId) : null;
      const slot = reverseCalculator.querySelector(`[data-reverse-gem-slot="${index}"]`);
      const button = slot.querySelector("[data-reverse-slot]");
      const addButton = slot.querySelector("[data-reverse-add-price]");
      const market = item ? latestPrice(item.id, "high") : null;
      slot.classList.toggle("has-selection", Boolean(item));
      slot.classList.toggle("is-missing-price", Boolean(item && !market));
      button.classList.toggle("is-active", reverseActiveSlot === index);
      button.setAttribute("aria-expanded", String(reverseActiveSlot === index));
      button.innerHTML = item
        ? `${stageIcon(item.id, "high", `상급 ${item.name}`)}<span><strong>상급 ${escapeHtml(item.name)}</strong><small>${market ? `실거래 ${meso(market.price)}` : "등록된 상급 시세 없음"}</small></span>`
        : `<span class="enchant-slot-empty" aria-hidden="true">+</span><span><strong>보석·크리스탈 선택</strong><small>눌러서 재료 선택</small></span>`;
      addButton.hidden = !item || Boolean(market);
    }
    for (const option of reverseCalculator.querySelectorAll("[data-reverse-gem]")) {
      const selected = reverseActiveSlot != null && reverseHighSelections[reverseActiveSlot] === option.dataset.reverseGem;
      option.classList.toggle("is-selected", selected);
      option.setAttribute("aria-pressed", String(selected));
    }
  }

  function updateReverseCalculator() {
    if (!reverseCalculator) return;
    const prices = {};
    for (const input of reverseCalculator.querySelectorAll("[data-reverse-price]")) {
      const parsed = readBig(input.value, input.dataset.reversePrice, 0n);
      prices[input.dataset.reversePrice] = parsed.value ?? null;
    }
    reverseHighSelections.forEach((itemId, index) => {
      const market = itemId ? latestPrice(itemId, "high") : null;
      prices[`high_${index + 1}`] = market ? BigInt(market.price) : null;
    });
    const useCatalyst = reverseCalculator.querySelector("[data-reverse-catalyst]").checked;
    const result = reverseCraftCost(prices, useCatalyst);
    for (const row of result.rows) {
      reverseCalculator.querySelector(`[data-reverse-total="${row.id}"]`).textContent = row.cost == null ? "-" : `${formatCount(row.cost)}메소`;
    }
    reverseCalculator.querySelector("[data-reverse-catalyst-fee]").hidden = !useCatalyst;
    reverseCalculator.querySelector("[data-reverse-odds-panel]").hidden = !useCatalyst;
    reverseCalculator.querySelector("[data-reverse-value-panel]").hidden = !useCatalyst;
    const missing = result.rows.filter((row) => row.unitPrice == null);
    const completion = result.complete
      ? `<div class="reverse-result-main"><span>제작 1회 총비용</span><b>${formatCount(result.attemptCost)}<small>메소</small></b></div>`
      : `<div class="reverse-result-wait"><strong>${missing.length}개 재료의 시세를 더 입력해 주세요</strong><span>${missing.map((row) => escapeHtml(row.label)).join(" · ")}</span></div>`;
    reverseCalculator.querySelector("[data-reverse-result]").innerHTML = `
      <div class="reverse-result-head"><span>계산 결과</span><small>${useCatalyst ? "촉진제 사용" : "촉진제 미사용"}</small></div>
      ${completion}
      <div class="reverse-result-grid">
        <div><span>${result.complete ? "재료 합계" : "입력된 재료 합계"}</span><b>${formatCount(result.materialCost)}</b></div>
        <div><span>고정 비용 합계</span><b>${formatCount(result.fixedCost)}</b></div>
        ${result.complete && useCatalyst ? `<div class="is-risk"><span>1회당 파괴 위험분</span><b>${formatCount(result.destructionLoss)}</b></div><div class="is-highlight"><span>완성품 1개 평균 투입비</span><b>${formatCount(result.averageCompletedCost)}</b><small>파괴 후 재제작 포함</small></div>` : ""}
      </div>
    `;
    updateReverseExpectedValue(result);
    updateReverseGemSlots();
  }

  function updateReverseExpectedValue(craftResult) {
    const baseInput = reverseCalculator.querySelector("[data-reverse-base-attack]");
    const baseParsed = readBig(baseInput.value, "정옵 공격력", 0n);
    const baseAttack = baseParsed.value ?? null;
    const outcomePrices = {};
    for (const input of reverseCalculator.querySelectorAll("[data-reverse-output-price]")) {
      const parsed = readBig(input.value, `+${input.dataset.reverseOutputPrice} 실거래가`, 0n);
      outcomePrices[input.dataset.reverseOutputPrice] = parsed.value ?? null;
    }
    const expected = reverseExpectedValue(baseAttack, outcomePrices, craftResult.attemptCost);
    for (const row of expected.rows) {
      if (row.bonus == null) continue;
      reverseCalculator.querySelector(`[data-reverse-attack-label="${row.bonus}"]`).textContent = row.attack == null ? "공격력 -" : `공격력 ${formatCount(row.attack)}`;
      reverseCalculator.querySelector(`[data-reverse-fair-price="${row.bonus}"]`).innerHTML = row.fairPrice == null
        ? "제작비 입력 대기"
        : `<span>적정가</span> ${meso(row.fairPrice)}<small class="reverse-fair-reading">${escapeHtml(priceReading(row.fairPrice.toString()))}</small>`;
    }
    const missingPrices = expected.rows.filter((row) => row.bonus != null && row.price == null).length;
    const summary = reverseCalculator.querySelector("[data-reverse-value-summary]");
    if (baseAttack == null || missingPrices) {
      const needs = [baseAttack == null ? "정옵 공격력" : null, missingPrices ? `${missingPrices}개 공격력의 실거래가` : null].filter(Boolean).join("과 ");
      summary.innerHTML = craftResult.attemptCost == null
        ? `<span>적정가 계산 대기</span><b>재료 시세를 모두 입력해 주세요</b>`
        : `<span>제작비를 여섯 옵션에 배분한 적정가입니다</span><b>${escapeHtml(needs)}를 입력하면 실거래 손익도 비교합니다</b>`;
      summary.className = "reverse-value-summary is-waiting";
      reverseCalculator.querySelector("[data-reverse-target-results]").innerHTML = "";
      return;
    }
    let profit = "";
    if (expected.expectedProfit != null) {
      profit = expected.expectedProfit >= 0n
        ? `<span class="is-gain">제작 1회당 +${meso(expected.expectedProfit)} 기대 이득</span>`
        : `<span class="is-loss">제작 1회당 −${meso(-expected.expectedProfit)} 기대 손해</span>`;
    }
    summary.className = `reverse-value-summary${expected.expectedProfit != null && expected.expectedProfit < 0n ? " is-loss" : " is-complete"}`;
    summary.innerHTML = `<span>입력한 실거래가 기준 1회 기대 판매가</span><b>${meso(expected.expectedSale)}</b>${profit}`;
    reverseCalculator.querySelector("[data-reverse-target-results]").innerHTML = craftResult.attemptCost == null
      ? `<div class="reverse-target-wait">재료 시세를 모두 입력하면 목표 옵션별 순제작비가 표시됩니다.</div>`
      : reverseTargetResultsHtml(expected.targets);
  }

  async function loadPrices() {
    const current = ++loadId;
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("maker_gem_prices")
      .select("id, item, tier, price, created_at")
      .order("created_at", { ascending: false });
    if (current !== loadId || !root.isConnected) return;
    if (error) {
      priceRows = [];
      notify(translateDbError(error), "error");
      paint();
      return;
    }
    priceRows = data ?? [];
    paint();
  }

  let savingPrice = false;

  async function savePrice(key, field = null, cheerTarget = null) {
    if (savingPrice) return;
    savingPrice = true;
    try {
      const saved = await persistPrice(key, field);
      if (saved && cheerTarget?.isConnected) {
        sfx("check");
        burstAt(cheerTarget, ["#ffe28a", "#c9a6ff", "#ffffff"], 18, 0.8);
      }
    } finally {
      savingPrice = false;
    }
  }

  // field: 시세를 읽을 입력칸. 없으면 기록 창 → 화면 순서로 같은 키의 칸을 찾는다.
  async function persistPrice(key, field = null) {
    const [itemId, tierId] = key.split(":");
    const item = makerItemById(itemId);
    const input = field ?? historyDialog.querySelector(`[data-price-input="${key}"]`) ?? root.querySelector(`[data-price-input="${key}"]`);
    const parsed = readBig(input?.value ?? "", `${item?.name ?? itemId} ${tierLabel(tierId)}`, 0n);
    if (parsed.error) {
      notify(parsed.error, "error");
      return;
    }
    if (parsed.value == null) {
      notify("시세를 입력해 주세요.", "error");
      return;
    }
    const latest = latestPrice(itemId, tierId);
    if (latest && BigInt(latest.price) === parsed.value) {
      notify("지금 시세와 같습니다.", "info");
      return;
    }
    const supabase = await getSupabase();
    const { error } = await supabase.from("maker_gem_prices").insert({ item: itemId, tier: tierId, price: parsed.value.toString() });
    if (!root.isConnected) return;
    if (error) {
      notify(translateDbError(error), "error");
      return;
    }
    notify("시세를 기록했습니다.");
    await loadPrices();
    if (historyDialog.open) historyDialog.close();
    return true;
  }

  async function deletePrice(id) {
    const row = priceRows.find((item) => item.id === id);
    if (!row) return;
    const item = makerItemById(row.item);
    if (!window.confirm(`${item?.name ?? row.item} ${tierLabel(row.tier)} ${formatCount(row.price)} 시세 기록을 삭제할까요?`)) return;
    const supabase = await getSupabase();
    const { error } = await supabase.from("maker_gem_prices").delete().eq("id", id);
    if (!root.isConnected) return;
    if (error) {
      notify(translateDbError(error), "error");
      return;
    }
    notify("시세 기록을 삭제했습니다.");
    await loadPrices();
  }

  tabBar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tab]");
    if (!button) return;
    const id = button.dataset.tab;
    for (const b of tabBar.querySelectorAll("[data-tab]")) {
      const on = b.dataset.tab === id;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", String(on));
    }
    for (const panel of root.querySelectorAll("[data-tab-panel]")) {
      panel.hidden = panel.dataset.tabPanel !== id;
    }
  });

  root.addEventListener("click", (event) => {
    const priceToggle = event.target.closest("[data-toggle-price-board]");
    if (priceToggle) {
      const open = priceToggle.getAttribute("aria-expanded") !== "true";
      priceToggle.setAttribute("aria-expanded", String(open));
      priceToggle.closest(".maker-price-board").classList.toggle("is-open", open);
      priceBody.inert = !open;
      priceBody.setAttribute("aria-hidden", String(!open));
      return;
    }
    if (event.target === quickPriceLayer || event.target.closest("[data-quick-price-close]")) {
      closeQuickPrice();
      return;
    }
    const quickPriceItem = event.target.closest("[data-quick-price-item]");
    if (quickPriceItem && !event.target.closest("[data-price-cell]")) {
      openQuickPrice(quickPriceItem.dataset.quickPriceItem);
      return;
    }
    if (event.target.closest("[data-price-history-close]")) {
      historyDialog.close();
      return;
    }
    const enchantTier = event.target.closest("[data-enchant-tier]");
    if (enchantTier) {
      const index = Number(enchantTier.dataset.enchantIndex);
      enchantSelections[index].tier = enchantTier.dataset.enchantTier;
      updateEnchantCalculator();
      return;
    }
    const enchantSlot = event.target.closest("[data-enchant-slot]");
    if (enchantSlot) {
      const index = Number(enchantSlot.dataset.enchantSlot);
      enchantActiveSlot = enchantActiveSlot === index ? null : index;
      enchantCalculator.querySelector("[data-enchant-gem-picker]").hidden = enchantActiveSlot == null;
      updateEnchantSlots();
      return;
    }
    const enchantGem = event.target.closest("[data-enchant-gem]");
    if (enchantGem && enchantActiveSlot != null) {
      const itemId = enchantGem.dataset.enchantGem;
      const targetIndex = enchantActiveSlot;
      const sourceIndex = moveEnchantSelection(itemId, targetIndex);
      enchantActiveSlot = null;
      enchantCalculator.querySelector("[data-enchant-gem-picker]").hidden = true;
      updateEnchantCalculator();
      if (sourceIndex != null) notify(`${makerItemById(itemId)?.name ?? "보석"} 위치를 ${targetIndex + 1}번 슬롯으로 옮겼습니다.`, "info");
      openQuickPrice(itemId);
      return;
    }
    const enchantClear = event.target.closest("[data-enchant-clear]");
    if (enchantClear) {
      const index = Number(enchantClear.dataset.enchantClear);
      enchantSelections[index] = { itemId: null, tier: "high" };
      if (enchantActiveSlot === index) {
        enchantActiveSlot = null;
        enchantCalculator.querySelector("[data-enchant-gem-picker]").hidden = true;
      }
      updateEnchantCalculator();
      return;
    }
    const enchantAddPrice = event.target.closest("[data-enchant-add-price]");
    if (enchantAddPrice) {
      const selection = enchantSelections[Number(enchantAddPrice.dataset.enchantAddPrice)];
      if (selection?.itemId) openQuickPrice(selection.itemId);
      return;
    }
    const reverseSlot = event.target.closest("[data-reverse-slot]");
    if (reverseSlot) {
      const index = Number(reverseSlot.dataset.reverseSlot);
      reverseActiveSlot = reverseActiveSlot === index ? null : index;
      reverseCalculator.querySelector("[data-reverse-gem-picker]").hidden = reverseActiveSlot == null;
      updateReverseGemSlots();
      return;
    }
    const reverseGem = event.target.closest("[data-reverse-gem]");
    if (reverseGem && reverseActiveSlot != null) {
      const itemId = reverseGem.dataset.reverseGem;
      const targetIndex = reverseActiveSlot;
      const sourceIndex = moveReverseSelection(itemId, targetIndex);
      reverseActiveSlot = null;
      reverseCalculator.querySelector("[data-reverse-gem-picker]").hidden = true;
      updateReverseCalculator();
      if (sourceIndex != null) notify(`${makerItemById(itemId)?.name ?? "보석"} 위치를 ${targetIndex + 1}번 슬롯으로 옮겼습니다.`, "info");
      openQuickPrice(itemId);
      return;
    }
    const reverseAddPrice = event.target.closest("[data-reverse-add-price]");
    if (reverseAddPrice) {
      const itemId = reverseHighSelections[Number(reverseAddPrice.dataset.reverseAddPrice)];
      if (itemId) openQuickPrice(itemId);
      return;
    }
    const saveButton = event.target.closest("[data-save-price]");
    if (saveButton) {
      savePrice(saveButton.dataset.savePrice);
      return;
    }
    const refineButton = event.target.closest("[data-refine]");
    if (refineButton) {
      refine(Number(refineButton.dataset.refine));
      return;
    }
    if (event.target.closest("[data-refine-reset]")) {
      clearInterval(refineTimer);
      refineTimer = 0;
      refineSim = { itemId: pickedItemId, tries: 0, low: 0, mid: 0, high: 0, last: "" };
      sfx("tick");
      paintRefineSim();
      return;
    }
    const pickItem = event.target.closest("[data-pick-item]");
    if (pickItem) {
      if (pickItem.dataset.pickItem !== pickedItemId) {
        pickedItemId = pickItem.dataset.pickItem;
        explainStage = "";
        sfx("tick");
        paintCraft();
        craftBody.querySelector(`[data-pick-item="${pickedItemId}"]`)?.focus({ preventScroll: true });
      }
      return;
    }
    const explainStageButton = event.target.closest("[data-explain-stage]");
    if (explainStageButton) {
      const stage = explainStageButton.dataset.explainStage;
      explainStage = explainStage === stage ? "" : stage;
      sfx("tick");
      paintCraft();
      return;
    }
    const saveOre = event.target.closest("[data-save-ore]");
    if (saveOre) {
      const input = craftBody.querySelector("[data-ore-input]");
      savePrice(`${saveOre.dataset.saveOre}:ore`, input, saveOre);
      return;
    }
    const deleteButton = event.target.closest("[data-delete-price]");
    if (deleteButton) {
      deletePrice(deleteButton.dataset.deletePrice);
      return;
    }
    const cell = event.target.closest("[data-price-cell]");
    if (cell) {
      const [itemId, tierId] = cell.dataset.priceCell.split(":");
      openHistory(itemId, tierId);
    }
  });

  root.addEventListener(
    "error",
    (event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement) || !image.matches("[data-maker-icon]")) return;
      image.hidden = true;
    },
    true,
  );

  function updatePriceInput(input) {
    const original = input.value;
    const cursor = input.selectionStart;
    const digits = original.replace(/[^0-9]/g, "");
    if (original !== digits) {
      input.value = digits;
      if (cursor != null) {
        const nextCursor = original.slice(0, cursor).replace(/[^0-9]/g, "").length;
        input.setSelectionRange(nextCursor, nextCursor);
      }
    }
    const editor = input.closest(".maker-price-editor");
    const reading = priceReading(input.value);
    if (editor) {
      editor.querySelector("[data-price-reading]").textContent = reading || (input.value.trim() ? "숫자를 확인해 주세요" : "금액을 입력해 주세요");
      editor.classList.toggle("has-price", Boolean(reading));
      return;
    }
    const quickRow = input.closest(".maker-quick-price-row");
    if (quickRow) {
      quickRow.querySelector("[data-quick-price-reading]").textContent = reading || (input.value.trim() ? "숫자를 확인해 주세요" : "시세를 입력해 주세요");
      quickRow.classList.toggle("has-price", Boolean(reading));
    }
  }

  function updateReverseInput(input) {
    const original = input.value;
    const cursor = input.selectionStart;
    const digits = original.replace(/[^0-9]/g, "");
    if (original !== digits) {
      input.value = digits;
      if (cursor != null) {
        const nextCursor = original.slice(0, cursor).replace(/[^0-9]/g, "").length;
        input.setSelectionRange(nextCursor, nextCursor);
      }
    }
    const reading = priceReading(input.value);
    reverseCalculator.querySelector(`[data-reverse-reading="${input.dataset.reversePrice}"]`).textContent = reading || "메소";
    updateReverseCalculator();
  }

  function updateReverseValueInput(input) {
    const original = input.value;
    const cursor = input.selectionStart;
    const digits = original.replace(/[^0-9]/g, "");
    if (original !== digits) {
      input.value = digits;
      if (cursor != null) {
        const nextCursor = original.slice(0, cursor).replace(/[^0-9]/g, "").length;
        input.setSelectionRange(nextCursor, nextCursor);
      }
    }
    if (input.matches("[data-reverse-output-price]")) {
      const reading = priceReading(input.value);
      reverseCalculator.querySelector(`[data-reverse-output-reading="${input.dataset.reverseOutputPrice}"]`).textContent = reading || "메소";
    }
    updateReverseCalculator();
  }

  root.addEventListener("input", (event) => {
    const reverseValueInput = event.target.closest("[data-reverse-base-attack], [data-reverse-output-price]");
    if (reverseValueInput) {
      if (!event.isComposing) updateReverseValueInput(reverseValueInput);
      return;
    }
    const reverseInput = event.target.closest("[data-reverse-price]");
    if (reverseInput) {
      if (!event.isComposing) updateReverseInput(reverseInput);
      return;
    }
    const oreInput = event.target.closest("[data-ore-input]");
    if (oreInput && !event.isComposing) {
      const digits = oreInput.value.replace(/[^0-9]/g, "");
      if (digits !== oreInput.value) oreInput.value = digits;
      const reading = priceReading(oreInput.value);
      craftBody.querySelector("[data-ore-reading]").textContent = reading || (oreInput.value.trim() ? "숫자를 확인해 주세요" : "메소");
      return;
    }
    const input = event.target.closest("[data-price-input]");
    if (!input || event.isComposing) return;
    updatePriceInput(input);
  });

  root.addEventListener("compositionend", (event) => {
    const reverseValueInput = event.target.closest("[data-reverse-base-attack], [data-reverse-output-price]");
    if (reverseValueInput) {
      updateReverseValueInput(reverseValueInput);
      return;
    }
    const reverseInput = event.target.closest("[data-reverse-price]");
    if (reverseInput) {
      updateReverseInput(reverseInput);
      return;
    }
    const input = event.target.closest("[data-price-input]");
    if (input) updatePriceInput(input);
  });

  root.addEventListener("change", (event) => {
    if (event.target.matches("[data-reverse-catalyst]")) updateReverseCalculator();
  });

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !quickPriceLayer.hidden) {
      event.preventDefault();
      closeQuickPrice();
      return;
    }
    const oreField = event.target.closest("[data-ore-input]");
    if (oreField && event.key === "Enter") {
      if (event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      if (!event.repeat) savePrice(`${oreField.dataset.oreInput}:ore`, oreField, craftBody.querySelector("[data-save-ore]"));
      return;
    }
    const input = event.target.closest("[data-price-input]");
    if (input && event.key === "Enter") {
      if (event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      if (!event.repeat) savePrice(input.dataset.priceInput);
      return;
    }
    const quickPriceItem = event.target.closest("[data-quick-price-item]");
    if (quickPriceItem && !event.target.closest("[data-price-cell]") && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      openQuickPrice(quickPriceItem.dataset.quickPriceItem);
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    const cell = event.target.closest("[data-price-cell]");
    if (!cell) return;
    event.preventDefault();
    const [itemId, tierId] = cell.dataset.priceCell.split(":");
    openHistory(itemId, tierId);
  });

  paint();
  updateReverseCalculator();
  await loadPrices();
}
