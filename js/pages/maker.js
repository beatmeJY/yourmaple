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
  reverseFairProof,
  enchantCraftCost,
  tierPrices,
} from "../maker-calc.js";
import { equipmentTypeName } from "../catalog-equipment.js";
import { isLoggedIn, requireLogin, restoreFields, snapshotFields, takeDraft } from "../session.js";
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

// 메이커의 세 기능은 운영 주소에서도 공개한다.
const MAKER_PAGES = [
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

// 리버스 v2 디자인: 등급 색(정옵~+5)과 재료 아이콘 색
const REVERSE_GRADE_COLORS = ["oklch(0.82 0.03 290)", "oklch(0.8 0.14 150)", "oklch(0.75 0.14 235)", "oklch(0.72 0.19 305)", "oklch(0.84 0.15 80)", "oklch(0.7 0.21 30)"];
const REVERSE_MATERIAL_HUES = { orihalcon: 55, monster_b: 200, monster_a: 150, time_piece: 280 };

function reverseMaterialRow(material, index) {
  return `
    <label class="reverse-material-card" data-reverse-material="${material.id}" style="--hue:${REVERSE_MATERIAL_HUES[material.id] ?? 260};--i:${index}">
      <span class="reverse-material-icon" aria-hidden="true">${escapeHtml([...material.label][0])}</span>
      <span class="reverse-material-name"><strong>${escapeHtml(material.label)}</strong><small>${formatCount(material.count)}개 · ${material.optional ? "선택 · 비우면 0메소" : "필수"}</small></span>
      <span class="reverse-material-input"><span class="reverse-material-field"><input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="40" autocomplete="off" spellcheck="false" data-reverse-price="${material.id}" aria-label="${escapeHtml(material.label)} 개당 시세" placeholder="${material.optional ? "선택" : "필수"}" /><em>/개</em></span><small data-reverse-reading="${material.id}">메소</small></span>
      <b data-reverse-total="${material.id}">-</b>
    </label>
  `;
}

function reverseGemSelectorHtml() {
  return `
    <div class="reverse-gem-select">
      <div class="reverse-gem-divider"><span>상급 보석·크리스탈 3개 · 필수</span><small>보석 제작에 기록한 상급 실거래가를 써요.</small></div>
      <div class="reverse-enchant-slots">
        ${[0, 1, 2]
          .map(
            (index) => `
              <article class="reverse-enchant-slot" data-reverse-gem-slot="${index}" style="--i:${index}">
                <button type="button" class="reverse-slot-button" data-reverse-slot="${index}" aria-expanded="false" aria-label="상급 재료 슬롯 ${index + 1}">
                  <span class="reverse-slot-box"><span class="enchant-slot-empty" aria-hidden="true">+</span></span>
                  <span class="reverse-slot-text"><strong>슬롯 ${index + 1}</strong><small>상급 재료 고르기</small></span>
                </button>
                <button type="button" class="reverse-gem-price-add" data-reverse-add-price="${index}" hidden>시세 입력</button>
                <b class="reverse-slot-cost" data-reverse-total="high_${index + 1}">-</b>
              </article>
            `,
          )
          .join("")}
      </div>
      <div class="reverse-gem-picker" data-reverse-gem-picker hidden>
        <div class="reverse-gem-picker-head"><strong data-reverse-picker-title>상급 재료 선택</strong><small>같은 재료는 한 슬롯에만 들어가요. 이미 쓴 재료를 고르면 자리를 옮겨요.</small><button type="button" class="reverse-picker-close" data-reverse-picker-close aria-label="닫기">×</button></div>
        <div class="reverse-gem-picker-grid">
          ${MAKER_ITEMS.map((item) => `<button type="button" data-reverse-gem="${item.id}" aria-pressed="false">${stageIcon(item.id, "high", `상급 ${item.name}`)}<span>${escapeHtml(item.name)}</span><small data-reverse-gem-price="${item.id}">-</small></button>`).join("")}
        </div>
      </div>
    </div>
  `;
}

function reverseCalculatorHtml() {
  const valueRows = REVERSE_CATALYST_ODDS.filter((row) => row.bonus != null);
  return `
    <div class="reverse-workshop rv2" data-reverse-calculator>
      <div class="reverse-workshop-head">
        <div><span class="reverse-kicker">REVERSE FORGE</span><h2>리버스 제작 비용</h2><p>재료 시세를 적으면 1회 제작비와 파괴 위험, 공격력별 적정 판매가까지 계산해요.</p></div>
        <label class="reverse-catalyst-toggle"><input type="checkbox" data-reverse-catalyst checked /><span class="reverse-switch" aria-hidden="true"><i></i></span><span class="reverse-switch-text"><strong>촉진제 사용</strong><small>+${formatCount(REVERSE_CATALYST_FEE)} 메소 · 파괴 10%</small></span></label>
      </div>
      <section class="reverse-summary" data-reverse-result aria-live="polite"></section>
      <div class="reverse-columns">
        <section class="reverse-panel reverse-material-panel">
          <div class="reverse-panel-title"><span>01</span><div><strong>재료</strong><small>시간조각과 상급 재료 3개는 필수예요. 나머지는 비우면 0메소로 계산해요.</small></div></div>
          <div class="reverse-material-grid">${REVERSE_RECIPE.filter((material) => !material.id.startsWith("high_")).map(reverseMaterialRow).join("")}</div>
          ${reverseGemSelectorHtml()}
          <div class="reverse-receipt reverse-fixed-panel" aria-label="고정 제작 비용">
            <div><span>기본 제작비</span><b>${formatCount(REVERSE_BASE_FEE)}</b></div>
            <div><span>상급 추가비 <small>${formatCount(REVERSE_HIGH_EXTRA_FEE)} × 3</small></span><b>${formatCount(REVERSE_HIGH_EXTRA_FEE * 3n)}</b></div>
            <div data-reverse-catalyst-fee><span>촉진제</span><b>${formatCount(REVERSE_CATALYST_FEE)}</b></div>
            <div class="is-total"><span>고정 비용 합계</span><b data-reverse-fixed-total>-</b></div>
          </div>
        </section>
        <section class="reverse-panel reverse-value-panel" data-reverse-value-panel>
          <div class="reverse-panel-title"><span>02</span><div><strong>공격력별 적정 판매가</strong><small>제작비를 정옵~+5에 1/6씩 나눈 뒤 각 옵션의 예상 수량으로 나눠요. 파괴 10%도 비용에 들어가요.</small></div></div>
          <div class="reverse-weapon-pick" data-reverse-weapons>
            <div class="reverse-weapon-head"><strong>리버스 무기</strong><small data-reverse-weapon-note>도감에서 리버스 무기를 불러오는 중…</small></div>
            <div class="reverse-weapon-grid" data-reverse-weapon-grid role="radiogroup" aria-label="리버스 무기 고르기"></div>
            <div class="reverse-weapon-save" data-reverse-weapon-save hidden></div>
          </div>
          <label class="reverse-base-attack"><span data-reverse-base-label>정옵 공격력</span><input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" data-reverse-base-attack placeholder="예: 120" /><small>적으면 +1~+5 공격력이 채워져요.</small></label>
          <div class="reverse-odds-strip" data-reverse-odds-panel role="img" aria-label="촉진제 제작 결과 확률: ${REVERSE_CATALYST_ODDS.map((row) => `${row.label} ${row.percent}%`).join(", ")}">
            ${REVERSE_CATALYST_ODDS.map((row, index) => `<i style="--w:${row.percent};--c:${row.bonus == null ? "rgba(255,255,255,.14)" : REVERSE_GRADE_COLORS[index]};--i:${index}" title="${escapeHtml(row.label)} ${row.percent}%"></i>`).join("")}
          </div>
          <div class="reverse-value-list">
            ${valueRows
              .map(
                (row, index) => `
                  <details class="reverse-market-detail reverse-grade" style="--c:${REVERSE_GRADE_COLORS[index]};--i:${index}">
                    <summary>
                      <span class="reverse-grade-badge">${escapeHtml(row.label)}</span>
                      <span class="reverse-grade-main"><strong data-reverse-attack-label="${row.bonus}">공격력 -</strong><em>${row.percent}% · 101회 중 ${countText(101 * row.percent / 100)}개</em></span>
                      <b class="reverse-grade-fair" data-reverse-fair-price="${row.bonus}">제작비 입력 대기</b>
                      <span class="reverse-grade-chev" aria-hidden="true">›</span>
                    </summary>
                    <div class="reverse-grade-body">
                      <span class="reverse-value-input"><input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="40" autocomplete="off" spellcheck="false" data-reverse-output-price="${row.bonus}" aria-label="${escapeHtml(row.label)} 시장가" placeholder="시장가 · 선택" /><small data-reverse-output-reading="${row.bonus}">비교할 때만 적어요</small></span>
                      <span class="reverse-grade-diff" data-reverse-diff="${row.bonus}"></span>
                      <button type="button" class="reverse-grade-history" data-reverse-history="${row.bonus}" hidden></button>
                      <div class="reverse-proof-steps" data-reverse-proof="${row.bonus}"></div>
                    </div>
                  </details>
                `,
              )
              .join("")}
            <div class="reverse-grade is-destroy"><span class="reverse-grade-badge">파괴</span><span class="reverse-grade-main"><strong>장비 없음</strong><em>10% · 101회 중 10.1회</em></span><b class="reverse-grade-fair">0메소</b></div>
          </div>
          <details class="reverse-proof" data-reverse-proof-panel>
            <summary><span class="reverse-proof-icon" aria-hidden="true">∑</span><span><strong>적정 판매가 계산 과정 펼쳐 보기</strong><small>제작비가 어떻게 나뉘어 각 공격력의 적정가가 되는지 숫자로 보여 줘요</small></span><span class="reverse-grade-chev" aria-hidden="true">›</span></summary>
            <div class="reverse-proof-body" data-reverse-proof-body></div>
          </details>
          <p class="hint">계산식: 1회 제작비 ÷ 6 ÷ 옵션 확률. 이 가격으로 모두 팔면 예상 판매 총액과 제작비가 같아져요(메소 반올림 차이 제외). 시장 가격을 예측하는 값은 아니고, 시장가는 비교용 선택 입력이에요. 무기를 고르면 무기마다 시장가를 따로 저장할 수 있어요.</p>
          <div class="reverse-value-summary" data-reverse-value-summary></div>
          <div class="reverse-target-results" data-reverse-target-results></div>
        </section>
      </div>
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
                <span><strong>상급 보석·크리스탈 선택</strong><small>상급만 선택 · 시세 필수</small></span>
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

// 리버스 무기: 완드·스태프는 마력이 주 수치라 마력 기준으로 채운다(촉진제 +1~+5가 마력에 붙는다고 봄 [추정]).
const REVERSE_MAGIC_WEAPON_TYPES = new Set(["Wand", "Staff"]);

function reverseWeaponStat(weapon) {
  const options = weapon?.base_options ?? {};
  const magic = REVERSE_MAGIC_WEAPON_TYPES.has(weapon?.subcategory);
  const raw = magic ? options.magic_attack : options.attack;
  return { magic, name: magic ? "마력" : "공격력", value: raw == null || !Number.isFinite(Number(raw)) ? null : BigInt(Math.trunc(Number(raw))) };
}

function reverseWeaponName(weapon) {
  return String(weapon?.name ?? "").replace(/^리버스\s*/, "");
}

function countText(value) {
  return value.toLocaleString("ko-KR", { maximumFractionDigits: 4 });
}

/** 적정가 계산 과정 전체(1회 제작비 내역 → 101회 → 1/6 몫 → 예상 개수 → 적정가 → 판매 총액 확인) */
function reverseProofHtml(craftResult, proof, statName, baseAttack) {
  if (!proof) return `<p class="reverse-proof-wait">재료 시세를 모두 적으면 숫자로 채워져요. 지금 비어 있는 재료: ${craftResult.rows.filter((row) => row.unitPrice == null).map((row) => escapeHtml(row.label)).join(" · ") || "-"}</p>`;
  const materialLines = craftResult.rows
    .map((row) => `<div><span>${escapeHtml(row.label)} <small>${formatCount(row.unitPrice ?? 0n)} × ${formatCount(row.count)}</small></span><b>${meso(row.cost)}</b></div>`)
    .join("");
  const optionRows = proof.rows
    .map((row, index) => {
      const destroy = row.bonus == null;
      const name = destroy ? "장비 없음" : baseAttack == null ? escapeHtml(row.label) : `${statName} ${formatCount(baseAttack + BigInt(row.bonus))}`;
      return `
        <div class="reverse-proof-row${destroy ? " is-destroy" : ""}" role="listitem" style="--c:${destroy ? "rgba(255,255,255,.4)" : REVERSE_GRADE_COLORS[index]};--i:${index}">
          <span class="reverse-proof-name"><b>${escapeHtml(row.label)}</b><small>${name}</small></span>
          <span data-label="확률">${row.percent}%</span>
          <span data-label="101회 중">${countText(row.expectedCount)}개</span>
          <span data-label="비용 몫">${destroy ? "0" : meso(row.share)}</span>
          <span data-label="적정가" class="is-fair">${destroy ? "0" : meso(row.fairPrice)}</span>
          <span data-label="판매 총액">${destroy ? "0" : meso(row.revenue)}</span>
        </div>`;
    })
    .join("");
  const gap = proof.roundingGap;
  const gapText = gap === 0n ? "딱 맞아요" : `반올림 차이 ${gap > 0n ? "+" : "−"}${formatCount(gap > 0n ? gap : -gap)}메소`;
  return `
    <ol class="reverse-proof-flow">
      <li><span class="reverse-proof-no">1</span><div><strong>제작 1회 비용</strong>
        <div class="reverse-proof-receipt">${materialLines}
          <div><span>기본 제작비</span><b>${meso(REVERSE_BASE_FEE)}</b></div>
          <div><span>상급 추가비 <small>${formatCount(REVERSE_HIGH_EXTRA_FEE)} × 3</small></span><b>${meso(craftResult.highExtraFee)}</b></div>
          <div><span>촉진제</span><b>${meso(craftResult.catalystFee)}</b></div>
          <div class="is-total"><span>1회 합계</span><b>${meso(proof.attemptCost)}</b></div>
        </div></div></li>
      <li><span class="reverse-proof-no">2</span><div><strong>101번 만든다고 생각해요</strong><p>${meso(proof.attemptCost)} × 101 = <b>${meso(proof.totalCost)}</b></p><small>101번 중 파괴가 10.1번, 나머지 90.9번은 정옵~+5 장비가 나와요.</small></div></li>
      <li><span class="reverse-proof-no">3</span><div><strong>정옵~+5 여섯 결과가 비용을 똑같이 1/6씩 나눠 가져요</strong><p>${meso(proof.totalCost)} ÷ 6 = <b>${meso(proof.share)}</b> <small>(결과 하나의 비용 몫)</small></p><small>파괴는 팔 수 없어서 몫이 없고, 그만큼 비용은 다른 여섯 결과가 나눠 내요.</small></div></li>
      <li><span class="reverse-proof-no">4</span><div><strong>몫을 101번 동안 나오는 개수로 나누면 개당 적정가</strong><p>비용 몫 ÷ (101 × 확률) = 적정가</p><small>+5처럼 드물게 나오는 결과는 같은 몫을 적은 개수로 나누니 개당 값이 커져요.</small></div></li>
    </ol>
    <div class="reverse-proof-table" role="list" aria-label="결과별 적정가 계산">
      ${optionRows}
      <div class="reverse-proof-total"><span>여섯 결과를 적정가로 모두 팔면</span><b>${meso(proof.totalRevenue)}</b><small>101회 총 제작비 ${meso(proof.totalCost)}와 ${gapText}</small></div>
    </div>
    <p class="reverse-proof-note">판매 총액 = 적정가 × 101회 중 개수. 적정가는 손해도 이득도 없는 기준선이에요. 시장가가 이보다 높으면 그 결과는 이득, 낮으면 손해예요.</p>
  `;
}

function reverseRowProofHtml(proof, bonus) {
  if (!proof) return `<p class="reverse-proof-wait">재료 시세를 모두 적으면 이 가격이 나온 과정을 보여 줘요.</p>`;
  const row = proof.rows.find((item) => item.bonus === bonus);
  if (!row) return "";
  return `
    <span class="reverse-proof-title">이 가격이 나온 과정</span>
    <ol>
      <li><span>101회 총 제작비</span><b>${meso(proof.attemptCost)} × 101 = ${meso(proof.totalCost)}</b></li>
      <li><span>여섯 결과가 1/6씩 나눈 몫</span><b>÷ 6 = ${meso(proof.share)}</b></li>
      <li><span>101회 중 ${escapeHtml(row.label)} 예상 개수</span><b>101 × ${row.percent}% = ${countText(row.expectedCount)}개</b></li>
      <li class="is-result"><span>적정 판매가</span><b>${meso(proof.share)} ÷ ${countText(row.expectedCount)} ≈ ${meso(row.fairPrice)}</b></li>
    </ol>
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
              <div class="reverse-target-market"><span>시장가 ${meso(target.price)}</span><b>${profit >= 0n ? `+${meso(profit)} 이득` : `−${meso(-profit)} 손해`}</b></div>
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

export async function render(root, mode = "gem") {
  const page = MAKER_PAGES.find((item) => item.id === mode) ?? MAKER_PAGES[0];
  const routeId = page.id === "gem" ? "maker" : `maker-${page.id}`;
  root.innerHTML = `
    <div class="maker-page">
      <header class="page-header maker-page-header">
        <div class="maker-title-block">
          <p class="trade-kicker">메이커</p>
          <div class="trade-hero-row">
            <h1>${escapeHtml(page.label)}</h1>
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
      <section id="maker-panel-gem" class="trade-board maker-tab-panel" data-tab-panel="gem" aria-label="보석 제작"${page.id !== "gem" ? " hidden" : ""}>
        <div class="mk-gem" data-craft-body></div>
      </section>
      <section id="maker-panel-craft" class="trade-board maker-tab-panel" data-tab-panel="craft" aria-label="리버스 제작"${page.id !== "craft" ? " hidden" : ""}>
        ${reverseCalculatorHtml()}
      </section>
      <section id="maker-panel-enchant" class="trade-board maker-tab-panel" data-tab-panel="enchant" aria-label="장비 옵션 부여"${page.id !== "enchant" ? " hidden" : ""}>
        ${enchantCalculatorHtml()}
      </section>
      <div class="maker-quick-price-layer" data-quick-price-layer hidden>
        <section class="maker-quick-price-panel" data-quick-price-panel role="dialog" aria-modal="true" aria-labelledby="maker-quick-price-title">
          <div data-quick-price-content></div>
        </section>
      </div>
      <dialog class="belt-history-dialog" data-reverse-history-dialog>
        <div class="belt-history-head">
          <h2 data-reverse-history-title>시장가 기록</h2>
          <button class="text-button" type="button" data-reverse-history-close aria-label="닫기">닫기</button>
        </div>
        <div data-reverse-history-body></div>
        <p class="hint">새 시장가는 리버스 제작 화면의 입력칸에 적고 "시장가 저장"을 누르면 쌓여요.</p>
      </dialog>
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
  // 리버스 무기별 시장가(sql/065): 도감 무기 목록과 내 기록(최신 순).
  const reverseHistoryDialog = root.querySelector("[data-reverse-history-dialog]");
  let reverseWeapons = [];
  let reverseWeaponNote = "도감에서 리버스 무기를 불러오는 중…";
  let reversePriceRows = [];
  let reversePriceError = "";
  let reverseWeaponId = "";
  let reverseLoadId = 0;
  let savingReverse = false;
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

  // focusTier: 고른 등급(예: 리버스·옵션 부여의 상급 슬롯이면 "high") 칸에 바로 커서를 둔다. 없으면 첫 칸(원석).
  function openQuickPrice(itemId, focusTier = "") {
    const item = makerItemById(itemId);
    if (!item) return;
    window.clearTimeout(quickPriceCloseTimer);
    quickPriceItemId = itemId;
    quickPriceLayer.hidden = false;
    quickPriceLayer.classList.remove("is-closing");
    refreshQuickPrice();
    window.requestAnimationFrame(() => quickPriceLayer.classList.add("is-open"));
    const input = (focusTier && quickPriceLayer.querySelector(`[data-price-input="${itemId}:${focusTier}"]`))
      || quickPriceLayer.querySelector("[data-price-input]");
    if (!input) return;
    input.closest(".maker-quick-price-row")?.classList.add("is-focus-target");
    input.focus({ preventScroll: true });
    if (input.value) input.select();
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
        : `<span class="enchant-slot-empty" aria-hidden="true">+</span><span><strong>상급 보석·크리스탈 선택</strong><small>상급만 선택 · 시세 필수</small></span>`;
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
      slot.classList.toggle("is-active", reverseActiveSlot === index);
      button.setAttribute("aria-expanded", String(reverseActiveSlot === index));
      button.innerHTML = item
        ? `<span class="reverse-slot-box">${stageIcon(item.id, "high", `상급 ${item.name}`)}</span><span class="reverse-slot-text"><strong>상급 ${escapeHtml(item.name)}</strong><small>${market ? escapeHtml(priceReading(String(market.price))) : "등록된 상급 시세 없음"}</small></span>`
        : `<span class="reverse-slot-box"><span class="enchant-slot-empty" aria-hidden="true">+</span></span><span class="reverse-slot-text"><strong>슬롯 ${index + 1}</strong><small>상급 재료 고르기</small></span>`;
      addButton.hidden = !item || Boolean(market);
    }
    const title = reverseCalculator.querySelector("[data-reverse-picker-title]");
    if (title) title.textContent = reverseActiveSlot == null ? "상급 재료 선택" : `슬롯 ${reverseActiveSlot + 1}에 넣을 상급 재료`;
    for (const option of reverseCalculator.querySelectorAll("[data-reverse-gem]")) {
      const selected = reverseActiveSlot != null && reverseHighSelections[reverseActiveSlot] === option.dataset.reverseGem;
      option.classList.toggle("is-selected", selected);
      option.classList.toggle("is-used", !selected && reverseHighSelections.includes(option.dataset.reverseGem));
      option.setAttribute("aria-pressed", String(selected));
      const market = latestPrice(option.dataset.reverseGem, "high");
      const price = option.querySelector("[data-reverse-gem-price]");
      if (price) price.textContent = market ? meso(market.price) : "시세 없음";
    }
  }

  function pickedReverseWeapon() {
    return reverseWeapons.find((weapon) => weapon.id === reverseWeaponId) ?? null;
  }

  function reverseHistory(itemId, bonus) {
    return reversePriceRows.filter((row) => row.item_id === itemId && Number(row.bonus) === bonus);
  }

  function latestReverse(itemId, bonus) {
    return reverseHistory(itemId, bonus)[0] ?? null;
  }

  // 고른 무기의 저장값과 다른(새로 적은) 시장가만 모은다. 칸을 비운 것은 저장하지 않는다.
  function reverseChanges() {
    const weapon = pickedReverseWeapon();
    if (!weapon || !reverseCalculator) return [];
    const changes = [];
    for (const input of reverseCalculator.querySelectorAll("[data-reverse-output-price]")) {
      const bonus = Number(input.dataset.reverseOutputPrice);
      const parsed = readBig(input.value, "시장가", 0n);
      if (parsed.error || parsed.value == null) continue;
      const latest = latestReverse(weapon.id, bonus);
      if (!latest || BigInt(latest.price) !== parsed.value) changes.push({ bonus, value: parsed.value });
    }
    return changes;
  }

  function paintReverseWeapons() {
    if (!reverseCalculator) return;
    const grid = reverseCalculator.querySelector("[data-reverse-weapon-grid]");
    const savedCount = (itemId) => new Set(reversePriceRows.filter((row) => row.item_id === itemId).map((row) => Number(row.bonus))).size;
    const card = (weapon, index) => {
      const picked = (weapon?.id ?? "") === reverseWeaponId;
      if (!weapon) {
        return `<label class="reverse-weapon is-manual${picked ? " is-picked" : ""}" style="--i:0"><input type="radio" name="reverse-weapon" value="" data-reverse-weapon${picked ? " checked" : ""} /><span class="reverse-weapon-art" aria-hidden="true">✎</span><span class="reverse-weapon-text"><strong>직접 입력</strong><small>공격력·시장가를 직접</small></span></label>`;
      }
      const stat = reverseWeaponStat(weapon);
      const saved = savedCount(weapon.id);
      const name = reverseWeaponName(weapon);
      return `<label class="reverse-weapon${picked ? " is-picked" : ""}" style="--i:${index + 1}" title="${escapeHtml(weapon.name)}"><input type="radio" name="reverse-weapon" value="${escapeHtml(weapon.id)}" data-reverse-weapon${picked ? " checked" : ""} /><span class="reverse-weapon-art">${weapon.image_url ? `<img src="${escapeHtml(weapon.image_url)}" alt="" loading="lazy" decoding="async" />` : `<i aria-hidden="true">⚔</i>`}</span><span class="reverse-weapon-text"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(equipmentTypeName(weapon.subcategory) || "무기")} · ${stat.name} ${stat.value == null ? "-" : formatCount(stat.value)}</small></span>${saved ? `<em class="reverse-weapon-saved" title="저장한 시장가 ${saved}/6">${saved}/6</em>` : ""}</label>`;
    };
    if (grid) grid.innerHTML = [card(null, 0), ...reverseWeapons.map(card)].join("");
    const note = reverseCalculator.querySelector("[data-reverse-weapon-note]");
    if (note) note.textContent = reverseWeaponNote;
    paintReverseSave();
  }

  function paintReverseSave() {
    if (!reverseCalculator) return;
    const weapon = pickedReverseWeapon();
    const bar = reverseCalculator.querySelector("[data-reverse-weapon-save]");
    for (const input of reverseCalculator.querySelectorAll("[data-reverse-output-price]")) {
      const bonus = Number(input.dataset.reverseOutputPrice);
      const history = weapon ? reverseHistory(weapon.id, bonus) : [];
      const latest = history[0] ?? null;
      const parsed = readBig(input.value, "시장가", 0n);
      const changed = Boolean(weapon && parsed.value != null && (!latest || BigInt(latest.price) !== parsed.value));
      input.classList.toggle("is-changed", changed);
      const reading = reverseCalculator.querySelector(`[data-reverse-output-reading="${bonus}"]`);
      if (reading) {
        const text = priceReading(input.value);
        reading.textContent = latest && !changed && parsed.value != null
          ? `저장됨 · ${formatWhen(latest.created_at)}`
          : changed ? `${text || "메소"} · 저장 전` : text || (weapon ? "이 무기 시장가를 적어요" : "비교할 때만 적어요");
      }
      const historyButton = reverseCalculator.querySelector(`[data-reverse-history="${bonus}"]`);
      if (historyButton) {
        historyButton.hidden = !history.length;
        historyButton.textContent = `기록 ${history.length}개`;
      }
    }
    if (!bar) return;
    if (!weapon) {
      bar.hidden = true;
      bar.innerHTML = "";
      return;
    }
    const changes = reverseChanges();
    const rows = reversePriceRows.filter((row) => row.item_id === weapon.id);
    const saved = new Set(rows.map((row) => Number(row.bonus))).size;
    const status = reversePriceError
      ? `시장가 기록을 불러오지 못했어요: ${reversePriceError}`
      : !isLoggedIn()
        ? "적은 시장가는 로그인하면 무기별로 저장돼요"
        : saved
          ? `저장 ${saved}/6 · 마지막 ${formatWhen(rows[0].created_at)}`
          : "아직 저장한 시장가가 없어요";
    bar.hidden = false;
    bar.classList.toggle("has-changes", changes.length > 0);
    bar.innerHTML = `
      <span class="reverse-weapon-save-art">${weapon.image_url ? `<img src="${escapeHtml(weapon.image_url)}" alt="" />` : "⚔"}</span>
      <span class="reverse-weapon-save-text"><strong>${escapeHtml(weapon.name)} 시장가</strong><small${reversePriceError ? ' class="is-error"' : ""}>${escapeHtml(status)}</small></span>
      <button type="button" class="reverse-weapon-save-button" data-reverse-save-prices${changes.length ? "" : " disabled"}>${changes.length ? `시장가 저장 · ${changes.length}개` : "바뀐 시장가 없음"}</button>
    `;
  }

  // 무기를 고르면 정옵 공격력(완드·스태프는 마력)과 그 무기에 저장한 최신 시장가를 채운다.
  function pickReverseWeapon(itemId) {
    if (itemId === reverseWeaponId) return;
    const pending = reverseChanges();
    if (pending.length && !window.confirm(`저장하지 않은 ${reverseWeaponName(pickedReverseWeapon())} 시장가 ${pending.length}개가 있어요. 무기를 바꿀까요?`)) {
      const back = reverseCalculator.querySelector(`[data-reverse-weapon][value="${CSS.escape(reverseWeaponId)}"]`);
      if (back) back.checked = true;
      return;
    }
    reverseWeaponId = itemId;
    const weapon = pickedReverseWeapon();
    const stat = reverseWeaponStat(weapon);
    reverseCalculator.querySelector("[data-reverse-base-label]").textContent = `정옵 ${stat.name}`;
    if (weapon) {
      reverseCalculator.querySelector("[data-reverse-base-attack]").value = stat.value == null ? "" : stat.value.toString();
      for (const input of reverseCalculator.querySelectorAll("[data-reverse-output-price]")) {
        const latest = latestReverse(weapon.id, Number(input.dataset.reverseOutputPrice));
        input.value = latest ? String(latest.price) : "";
      }
    }
    for (const label of reverseCalculator.querySelectorAll("[data-reverse-weapon]")) {
      label.closest(".reverse-weapon")?.classList.toggle("is-picked", label.value === reverseWeaponId);
    }
    updateReverseCalculator();
  }

  async function loadReverseWeapons() {
    if (!reverseCalculator) return;
    try {
      const supabase = await getSupabase();
      const { data, error } = await supabase
        .from("catalog_items")
        .select("id, name, subcategory, middle_category, base_options, image_url")
        .ilike("name", "리버스%");
      if (!root.isConnected) return;
      if (error) throw error;
      reverseWeapons = (data ?? [])
        .filter((item) => /Weapon$/.test(item.middle_category ?? ""))
        .sort((a, b) => (equipmentTypeName(a.subcategory) || "").localeCompare(equipmentTypeName(b.subcategory) || "", "ko") || a.name.localeCompare(b.name, "ko"));
      reverseWeaponNote = reverseWeapons.length
        ? `도감의 리버스 무기 ${reverseWeapons.length}종 · 고르면 정옵 공격력과 저장한 시장가가 채워져요`
        : "도감에 리버스 무기가 없어요. 직접 입력으로 계산해요";
    } catch (error) {
      reverseWeapons = [];
      reverseWeaponNote = `무기 목록을 불러오지 못했어요: ${translateDbError(error)}`;
    }
    paintReverseWeapons();
  }

  async function loadReversePrices() {
    const current = ++reverseLoadId;
    if (!isLoggedIn()) {
      reversePriceRows = [];
      reversePriceError = "";
      paintReverseWeapons();
      return;
    }
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("maker_reverse_prices")
      .select("id, item_id, bonus, price, created_at")
      .order("created_at", { ascending: false });
    if (current !== reverseLoadId || !root.isConnected) return;
    reversePriceError = error ? translateDbError(error) : "";
    reversePriceRows = error ? [] : data ?? [];
    paintReverseWeapons();
  }

  async function saveReversePrices(button) {
    const weapon = pickedReverseWeapon();
    if (savingReverse || !weapon) return;
    for (const input of reverseCalculator.querySelectorAll("[data-reverse-output-price]")) {
      const parsed = readBig(input.value, `${input.closest(".reverse-grade")?.querySelector(".reverse-grade-badge")?.textContent ?? ""} 시장가`, 0n);
      if (parsed.error) {
        notify(parsed.error, "error");
        input.focus();
        return;
      }
    }
    const changes = reverseChanges();
    if (!changes.length) {
      notify("바뀐 시장가가 없어요.", "info");
      return;
    }
    if (!requireLogin("리버스 무기 시장가는 로그인한 계정에 저장돼요.", { fields: snapshotFields(root) })) return;
    savingReverse = true;
    if (button) button.disabled = true;
    try {
      const supabase = await getSupabase();
      const { error } = await supabase
        .from("maker_reverse_prices")
        .insert(changes.map((change) => ({ item_id: weapon.id, bonus: change.bonus, price: change.value.toString() })));
      if (!root.isConnected) return;
      if (error) {
        notify(translateDbError(error), "error");
        return;
      }
      sfx("check");
      if (button?.isConnected) burstAt(button, ["#ffe28a", "#c9a6ff", "#ffffff"], 18, 0.8);
      notify(`${reverseWeaponName(weapon)} 시장가 ${changes.length}개를 저장했어요.`);
      await loadReversePrices();
    } finally {
      savingReverse = false;
      paintReverseSave();
    }
  }

  function refreshReverseHistory() {
    const weapon = pickedReverseWeapon();
    const bonus = Number(reverseHistoryDialog.dataset.bonus);
    const odd = REVERSE_CATALYST_ODDS.find((row) => row.bonus === bonus);
    if (!weapon || !odd) return;
    reverseHistoryDialog.querySelector("[data-reverse-history-title]").textContent = `${weapon.name} ${odd.label} 시장가 기록`;
    const history = reverseHistory(weapon.id, bonus);
    reverseHistoryDialog.querySelector("[data-reverse-history-body]").innerHTML = history.length
      ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>시장가</th><th>이전과 차이</th><th>기록 시각</th><th></th></tr></thead><tbody>${history
          .map((row, index) => {
            const delta = priceDelta(row, history[index + 1]);
            return `<tr><td class="num">${escapeHtml(formatCount(row.price))}</td><td class="num ${delta.className}">${escapeHtml(delta.text)}</td><td>${escapeHtml(formatWhen(row.created_at))}</td><td><button class="text-button is-danger" type="button" data-delete-reverse-price="${escapeHtml(row.id)}">삭제</button></td></tr>`;
          })
          .join("")}</tbody></table></div>`
      : `<p class="hint">아직 기록이 없어요.</p>`;
  }

  function openReverseHistory(bonus) {
    if (!pickedReverseWeapon()) return;
    reverseHistoryDialog.dataset.bonus = String(bonus);
    refreshReverseHistory();
    if (!reverseHistoryDialog.open) reverseHistoryDialog.showModal();
  }

  async function deleteReversePrice(id) {
    const row = reversePriceRows.find((item) => item.id === id);
    const weapon = pickedReverseWeapon();
    if (!row || !weapon) return;
    const odd = REVERSE_CATALYST_ODDS.find((item) => item.bonus === Number(row.bonus));
    if (!window.confirm(`${weapon.name} ${odd?.label ?? ""} ${formatCount(row.price)} 시장가 기록을 삭제할까요?`)) return;
    const input = reverseCalculator.querySelector(`[data-reverse-output-price="${Number(row.bonus)}"]`);
    // 입력칸이 지우는 값(=최신 저장값)을 보이고 있었다면, 지운 뒤 그 이전 기록으로 바꿔 둔다.
    const wasShowing = input && latestReverse(weapon.id, Number(row.bonus))?.id === row.id && input.value === String(row.price);
    const supabase = await getSupabase();
    const { error } = await supabase.from("maker_reverse_prices").delete().eq("id", id);
    if (!root.isConnected) return;
    if (error) {
      notify(translateDbError(error), "error");
      return;
    }
    notify("시장가 기록을 삭제했어요.");
    await loadReversePrices();
    if (wasShowing && input?.isConnected) {
      const next = latestReverse(weapon.id, Number(row.bonus));
      input.value = next ? String(next.price) : "";
      updateReverseCalculator();
    }
    if (reverseHistoryDialog.open) refreshReverseHistory();
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
      // 필수 재료가 비어 있으면 줄을 주황 테두리로 표시합니다.
      reverseCalculator.querySelector(`[data-reverse-material="${row.id}"]`)?.classList.toggle("is-missing", row.unitPrice == null);
    }
    reverseCalculator.querySelector("[data-reverse-catalyst-fee]").hidden = !useCatalyst;
    reverseCalculator.querySelector("[data-reverse-odds-panel]").hidden = !useCatalyst;
    reverseCalculator.querySelector("[data-reverse-value-panel]").hidden = !useCatalyst;
    reverseCalculator.querySelector("[data-reverse-fixed-total]").textContent = formatCount(result.fixedCost);
    reverseCalculator.classList.toggle("is-no-catalyst", !useCatalyst);
    const missing = result.rows.filter((row) => row.unitPrice == null);
    const attemptCard = result.complete
      ? `<article class="reverse-card is-main"><span>제작 1회 총비용</span><b>${formatCount(result.attemptCost)}<small>메소</small></b><em>${escapeHtml(priceReading(result.attemptCost.toString()))}</em></article>`
      : `<article class="reverse-card is-main is-waiting"><span>제작 1회 총비용</span><b>${missing.length}개 재료 시세 필요</b><em>${missing.map((row) => escapeHtml(row.label)).join(" · ")}</em></article>`;
    const averageCard = result.complete
      ? `<article class="reverse-card"><span>완성품 1개 평균 투입비</span><b>${formatCount(result.averageCompletedCost)}<small>메소</small></b><em>${useCatalyst ? `파괴 후 다시 만드는 비용 포함 · 1회당 파괴 위험분 ${formatCount(result.destructionLoss)}` : "촉진제 없이 만들면 파괴 없음"}</em></article>`
      : `<article class="reverse-card is-waiting"><span>완성품 1개 평균 투입비</span><b>-</b><em>${useCatalyst ? "파괴 후 다시 만드는 비용 포함" : "촉진제 없이 만들면 파괴 없음"}</em></article>`;
    reverseCalculator.querySelector("[data-reverse-result]").innerHTML = `
      ${attemptCard}
      ${averageCard}
      <article class="reverse-card"><span>${result.complete ? "재료 합계" : "입력된 재료 합계"} + 고정 비용</span><b>${formatCount(result.materialCost)}<small>+ ${formatCount(result.fixedCost)}</small></b><em>${useCatalyst ? "촉진제 사용" : "촉진제 미사용"}</em></article>
      <article class="reverse-card" data-reverse-profit-card><span>기대 손익</span><b>-</b><em>${useCatalyst ? "시장가를 적으면 계산" : "촉진제를 쓸 때만 계산해요"}</em></article>
    `;
    updateReverseExpectedValue(result, useCatalyst);
    updateReverseGemSlots();
    paintReverseSave();
  }

  function updateReverseExpectedValue(craftResult, useCatalyst = true) {
    const baseInput = reverseCalculator.querySelector("[data-reverse-base-attack]");
    const baseParsed = readBig(baseInput.value, "정옵 공격력", 0n);
    const baseAttack = baseParsed.value ?? null;
    const outcomePrices = {};
    for (const input of reverseCalculator.querySelectorAll("[data-reverse-output-price]")) {
      const parsed = readBig(input.value, `+${input.dataset.reverseOutputPrice} 시장가`, 0n);
      outcomePrices[input.dataset.reverseOutputPrice] = parsed.value ?? null;
    }
    const expected = reverseExpectedValue(baseAttack, outcomePrices, craftResult.attemptCost);
    const statName = reverseWeaponStat(pickedReverseWeapon()).name;
    const proof = useCatalyst ? reverseFairProof(craftResult.attemptCost) : null;
    const proofBody = reverseCalculator.querySelector("[data-reverse-proof-body]");
    if (proofBody) proofBody.innerHTML = reverseProofHtml(craftResult, proof, statName, baseAttack);
    for (const row of expected.rows) {
      if (row.bonus == null) continue;
      const rowProof = reverseCalculator.querySelector(`[data-reverse-proof="${row.bonus}"]`);
      if (rowProof) rowProof.innerHTML = reverseRowProofHtml(proof, row.bonus);
      reverseCalculator.querySelector(`[data-reverse-attack-label="${row.bonus}"]`).textContent = row.attack == null ? `${statName} -` : `${statName} ${formatCount(row.attack)}`;
      reverseCalculator.querySelector(`[data-reverse-fair-price="${row.bonus}"]`).innerHTML = row.fairPrice == null
        ? "제작비 입력 대기"
        : `<span class="reverse-fair-main">${meso(row.fairPrice)}</span><small class="reverse-fair-reading">${escapeHtml(priceReading(row.fairPrice.toString()))}</small>`;
      // 시장가를 적은 줄은 적정가와의 차이를 알약 모양으로 보여 줍니다.
      const diff = reverseCalculator.querySelector(`[data-reverse-diff="${row.bonus}"]`);
      const price = outcomePrices[row.bonus];
      if (price == null || row.fairPrice == null) {
        diff.className = "reverse-grade-diff";
        diff.textContent = row.fairPrice == null ? "재료 시세를 모두 적으면 비교해요" : "시장가를 적으면 적정가와 비교해요";
      } else {
        const gap = price - row.fairPrice;
        diff.className = `reverse-grade-diff ${gap >= 0n ? "is-gain" : "is-loss"}`;
        diff.textContent = gap === 0n ? "적정가와 같음" : gap > 0n ? `적정가보다 ${meso(gap)} 높음 · 이득` : `적정가보다 ${meso(-gap)} 낮음 · 손해`;
      }
    }
    const valueRows = expected.rows.filter((row) => row.bonus != null);
    const filled = valueRows.filter((row) => row.price != null).length;
    const missingPrices = valueRows.length - filled;
    const profitCard = reverseCalculator.querySelector("[data-reverse-profit-card]");
    const summary = reverseCalculator.querySelector("[data-reverse-value-summary]");
    if (baseAttack == null || missingPrices) {
      if (profitCard && useCatalyst) profitCard.querySelector("em").textContent = `시장가 ${filled}/${valueRows.length} · 모두 적으면 계산`;
      const needs = [baseAttack == null ? "정옵 공격력" : null, missingPrices ? `${missingPrices}개 공격력의 시장가` : null].filter(Boolean).join("과 ");
      summary.innerHTML = craftResult.attemptCost == null
        ? `<span>적정가 계산 대기</span><b>재료 시세를 모두 입력해 주세요</b>`
        : `<span>제작비를 여섯 옵션에 배분한 적정가입니다</span><b>${escapeHtml(needs)}를 입력하면 시장가 손익도 비교합니다</b>`;
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
    if (profitCard && useCatalyst) {
      if (expected.expectedProfit == null) {
        profitCard.querySelector("em").textContent = "재료 시세를 모두 적으면 계산";
      } else {
        const gain = expected.expectedProfit >= 0n;
        profitCard.classList.add(gain ? "is-gain" : "is-loss");
        profitCard.querySelector("b").innerHTML = `${gain ? "+" : "−"}${formatCount(gain ? expected.expectedProfit : -expected.expectedProfit)}<small>메소</small>`;
        profitCard.querySelector("em").textContent = `제작 1회당 기대 ${gain ? "이득" : "손해"} · 시장가 ${filled}/${valueRows.length}`;
      }
    }
    summary.className = `reverse-value-summary${expected.expectedProfit != null && expected.expectedProfit < 0n ? " is-loss" : " is-complete"}`;
    summary.innerHTML = `<span>입력한 시장가 기준 1회 기대 판매가</span><b>${meso(expected.expectedSale)}</b>${profit}`;
    reverseCalculator.querySelector("[data-reverse-target-results]").innerHTML = craftResult.attemptCost == null
      ? `<div class="reverse-target-wait">재료 시세를 모두 입력하면 목표 옵션별 순제작비가 표시됩니다.</div>`
      : reverseTargetResultsHtml(expected.targets);
  }

  async function loadPrices() {
    const current = ++loadId;
    // 로그인 전에는 저장된 시세가 없다(저장할 때 로그인).
    if (!isLoggedIn()) {
      priceRows = [];
      paint();
      return;
    }
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
    // 로그인 전이면 적은 시세와 화면의 다른 입력을 맡기고 로그인하러 간다. 돌아오면 같은 시세 창에 그대로 채워 준다.
    if (!requireLogin("메이커 시세는 로그인한 계정에 저장돼요.", { key, value: input?.value ?? "", fields: snapshotFields(root) })) return;
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

  root.addEventListener("click", (event) => {
    const reverseSave = event.target.closest("[data-reverse-save-prices]");
    if (reverseSave) {
      saveReversePrices(reverseSave);
      return;
    }
    const reverseHistoryButton = event.target.closest("[data-reverse-history]");
    if (reverseHistoryButton) {
      openReverseHistory(Number(reverseHistoryButton.dataset.reverseHistory));
      return;
    }
    if (event.target.closest("[data-reverse-history-close]")) {
      reverseHistoryDialog.close();
      return;
    }
    const reverseDelete = event.target.closest("[data-delete-reverse-price]");
    if (reverseDelete) {
      deleteReversePrice(reverseDelete.dataset.deleteReversePrice);
      return;
    }
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
      openQuickPrice(itemId, enchantSelections[targetIndex]?.tier);
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
      if (selection?.itemId) openQuickPrice(selection.itemId, selection.tier);
      return;
    }
    if (event.target.closest("[data-reverse-picker-close]")) {
      reverseActiveSlot = null;
      reverseCalculator.querySelector("[data-reverse-gem-picker]").hidden = true;
      updateReverseGemSlots();
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
      openQuickPrice(itemId, "high");
      return;
    }
    const reverseAddPrice = event.target.closest("[data-reverse-add-price]");
    if (reverseAddPrice) {
      const itemId = reverseHighSelections[Number(reverseAddPrice.dataset.reverseAddPrice)];
      if (itemId) openQuickPrice(itemId, "high");
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
    if (event.target.matches("[data-reverse-weapon]") && event.target.checked) pickReverseWeapon(event.target.value);
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
  paintReverseWeapons();
  updateReverseCalculator();
  await Promise.all([loadPrices(), page.id === "craft" ? loadReverseWeapons().then(loadReversePrices) : null]);
  // 로그인하러 가기 전에 적던 시세가 있으면 되살린다: 다른 칸은 그대로, 시세는 그 시세 창을 열어 채워 둔다(저장은 사용자가 누른다).
  const draft = takeDraft(routeId);
  if (draft && root.isConnected) {
    restoreFields(root, draft.fields);
    const [itemId, tierId] = String(draft.key || "").split(":");
    if (itemId && tierId && makerItemById(itemId)) {
      openHistory(itemId, tierId);
      const input = historyDialog.querySelector(`[data-price-input="${draft.key}"]`);
      if (input) {
        input.value = draft.value;
        updatePriceInput(input);
      }
    }
    notify("로그인했어요. 적어 둔 시세를 그대로 채워 뒀으니 저장을 눌러 주세요.", "info");
  }
}
