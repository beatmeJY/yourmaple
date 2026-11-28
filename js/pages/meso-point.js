import { escapeHtml, formatCount, readBig } from "../format.js";
import { getSupabase } from "../supabase-client.js";
import { translateDbError } from "../db-error.js";
import { notify } from "../toast.js";
import { burstAt, sfx } from "../effects.js";
import { isLoggedIn, requireLogin, restoreFields, snapshotFields, takeDraft } from "../session.js";
import { cashForMeso, cashMesoPer10k, exchangeWonPer1m, mesoForCash, mesoShort, pointValue } from "../meso-point-calc.js";

// 현금·메소·포인트 계산기(2026-11-28 사용자 요청).
// 주인공: 상품 포인트 가격 → 게임 내 교환 기준 메소 / 현금 거래 기준 메소 → 차이.
// 시세 두 개는 사용자가 적는다(자동 수집 없음). 로그인하면 시세를 기록하고 다시 불러올 수 있다(sql/082).
// 입력값은 이 기기에도 기억한다(편의용).
const ROUTE = "meso-point";
const STORE_KEY = "maple-note-meso-point";
const POINT_PRESETS = [1000, 3000, 5000, 10000, 30000];
const LIMITS = {
  points: { label: "포인트 가격", max: 100000000n },
  exchange: { label: "게임 내 교환 시세", max: 1000000000000n },
  cash: { label: "현금 거래 시세", max: 1000000n },
  meso: { label: "원하는 메소", max: 10n ** 15n },
  won: { label: "가진 현금", max: 10n ** 10n },
};

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function saveStore(value) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(value));
  } catch {
    // 저장이 막혀도 화면은 그대로 쓴다
  }
}

/** 입력칸 읽기: 빈칸 = null, 0·범위 밖·숫자 아님 = error */
function readField(key, value) {
  const { label, max } = LIMITS[key];
  const parsed = readBig(value, label, 1n);
  if (parsed.error) return parsed;
  if (parsed.value != null && parsed.value > max) return { error: `${label} 숫자가 너무 커요.` };
  return parsed;
}

const exact = (value) => (value == null ? "" : `${formatCount(value)} 메소`);
const wonText = (value) => (value == null ? "-" : `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}원`);

function formatWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", { year: "2-digit", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function deltaText(now, before, unit) {
  if (before == null) return "";
  const diff = BigInt(now) - BigInt(before);
  if (diff === 0n) return `<small class="mpc-delta">변화 없음</small>`;
  const shown = unit === "meso" ? mesoShort(diff < 0n ? -diff : diff) : formatCount(diff < 0n ? -diff : diff);
  return `<small class="mpc-delta ${diff > 0n ? "is-up" : "is-down"}">${diff > 0n ? "▲" : "▼"} ${escapeHtml(shown)}</small>`;
}

export function render(root) {
  const stored = loadStore();
  const initial = (key) => (stored[key] && !readField(key, stored[key]).error ? String(stored[key]) : "");
  let history = [];
  let historyError = "";
  let loadId = 0;
  let saving = false;
  let prevKey = "";

  root.innerHTML = `
    <div class="mpc-page">
      <header class="mpc-head">
        <span class="mpc-head-art" aria-hidden="true"><i class="is-p">P</i><i class="is-m">M</i><i class="is-w">₩</i></span>
        <div class="mpc-head-copy">
          <p class="mpc-kicker">현금 · 메소 · 메이플포인트</p>
          <h1>포인트 상품, 메소로 얼마?</h1>
          <p>상품의 포인트 가격을 <b>게임 내 교환</b>과 <b>현금 거래</b> 두 기준의 메소로 바꿔 비교해요.</p>
        </div>
      </header>

      <section class="mpc-hero ym-glass" aria-label="포인트 가격 비교">
        <div class="mpc-input-row">
          <label class="mpc-field is-point">
            <span>상품 포인트 가격</span>
            <span class="mpc-input-wrap"><input data-field="points" inputmode="numeric" autocomplete="off" placeholder="예: 5000" value="${escapeHtml(initial("points") || "5000")}" aria-describedby="mpc-point-won" /><em>포인트</em></span>
          </label>
          <div class="mpc-presets" role="group" aria-label="자주 쓰는 포인트">
            ${POINT_PRESETS.map((value) => `<button type="button" class="mpc-chip" data-preset="${value}">${formatCount(value)}</button>`).join("")}
          </div>
        </div>
        <p class="mpc-won" id="mpc-point-won" data-point-won></p>

        <div class="mpc-compare" data-compare>
          <article class="mpc-card is-exchange">
            <span class="mpc-card-label"><i aria-hidden="true">⇄</i>게임 내 교환으로</span>
            <strong class="mpc-card-value" data-out="exchange">-</strong>
            <span class="mpc-card-exact" data-out-exact="exchange"></span>
            <span class="mpc-bar" aria-hidden="true"><i data-bar="exchange"></i></span>
          </article>
          <article class="mpc-card is-cash">
            <span class="mpc-card-label"><i aria-hidden="true">₩</i>현금 거래로</span>
            <strong class="mpc-card-value" data-out="cash">-</strong>
            <span class="mpc-card-exact" data-out-exact="cash"></span>
            <span class="mpc-bar" aria-hidden="true"><i data-bar="cash"></i></span>
          </article>
        </div>
        <div class="mpc-diff" data-diff aria-live="polite"></div>
      </section>

      <section class="mpc-rates ym-glass" aria-label="시세">
        <div class="mpc-section-head">
          <h2>시세 <small>직접 적어요</small></h2>
          <button type="button" class="mpc-history-btn" data-open-history>기록 <b data-history-count>0</b>개</button>
        </div>
        <div class="mpc-rate-grid">
          <label class="mpc-rate is-exchange">
            <span class="mpc-rate-title">게임 내 교환</span>
            <span class="mpc-rate-line">1만 포인트당 <span class="mpc-input-wrap is-small"><input data-field="exchange" inputmode="numeric" autocomplete="off" placeholder="예: 30000000" value="${escapeHtml(initial("exchange"))}" /></span> 메소</span>
            <small class="mpc-rate-hint" data-rate-hint="exchange"></small>
          </label>
          <label class="mpc-rate is-cash">
            <span class="mpc-rate-title">유저 현금 거래</span>
            <span class="mpc-rate-line">100만 메소당 <span class="mpc-input-wrap is-small"><input data-field="cash" inputmode="numeric" autocomplete="off" placeholder="예: 300" value="${escapeHtml(initial("cash"))}" /></span> 원</span>
            <small class="mpc-rate-hint" data-rate-hint="cash"></small>
          </label>
        </div>
        <div class="mpc-save-row">
          <input class="mpc-memo" data-field-memo maxlength="100" autocomplete="off" placeholder="메모 (선택)" aria-label="시세 메모" />
          <button type="button" class="mpc-save" data-save-rate>시세 기록</button>
        </div>
        <p class="mpc-last" data-last-rate></p>
        <p class="mpc-base">기준: 월드코인 1개 = 7.5원 · 1만 포인트 = 1,400 월드코인 = 10,500원</p>
      </section>

      <section class="mpc-extra" aria-label="더 계산하기">
        <div class="mpc-tool ym-glass">
          <h2>원하는 메소에 드는 현금</h2>
          <label class="mpc-field"><span class="mpc-input-wrap"><input data-field="meso" inputmode="numeric" autocomplete="off" placeholder="예: 100000000" value="${escapeHtml(initial("meso") || "100000000")}" /><em>메소</em></span></label>
          <p class="mpc-reading" data-reading="meso"></p>
          <div class="mpc-routes" data-routes="meso"></div>
        </div>
        <div class="mpc-tool ym-glass">
          <h2>가진 현금으로 얻는 메소</h2>
          <label class="mpc-field"><span class="mpc-input-wrap"><input data-field="won" inputmode="numeric" autocomplete="off" placeholder="예: 10000" value="${escapeHtml(initial("won") || "10000")}" /><em>원</em></span></label>
          <p class="mpc-reading" data-reading="won"></p>
          <div class="mpc-routes" data-routes="won"></div>
        </div>
      </section>
      <p class="mpc-note">포인트는 필요한 만큼 살 수 있다고 보고 계산해요(묶음 단위·수수료 없음). 얻는 메소는 소수점 아래를 버리고, 필요한 현금은 1원 단위로 올려요.</p>

      <dialog class="belt-history-dialog mpc-dialog" data-history-dialog>
        <div class="belt-history-head">
          <h2>시세 기록</h2>
          <button class="text-button" type="button" data-close-history aria-label="닫기">닫기</button>
        </div>
        <div data-history-body></div>
        <p class="hint">새 시세는 화면의 시세 칸에 적고 "시세 기록"을 누르면 쌓여요. "불러오기"를 누르면 그 시세로 다시 계산해요.</p>
      </dialog>
    </div>
  `;

  const field = (key) => root.querySelector(`[data-field="${key}"]`);
  const dialog = root.querySelector("[data-history-dialog]");

  function readAll() {
    const values = {};
    const errors = {};
    for (const key of Object.keys(LIMITS)) {
      const input = field(key);
      const parsed = readField(key, input.value);
      input.classList.toggle("is-invalid", Boolean(parsed.error));
      input.setAttribute("aria-invalid", parsed.error ? "true" : "false");
      if (parsed.error) errors[key] = parsed.error;
      values[key] = parsed.error ? null : parsed.value;
    }
    return { values, errors };
  }

  function paintRoutes(key, result, better) {
    const box = root.querySelector(`[data-routes="${key}"]`);
    const unit = key === "meso" ? "원" : " 메소";
    const show = (value) => (value == null ? null : key === "meso" ? `${formatCount(value)}원` : `${mesoShort(value)} 메소`);
    const routes = [
      { id: "cash", label: "현금 거래로 바로", value: result.viaCash, sub: "" },
      { id: "point", label: "포인트 사서 교환", value: result.viaPoint, sub: result.points != null ? `${formatCount(result.points)} 포인트` : "" },
    ];
    const best = routes.filter((route) => route.value != null).sort((a, b) => (better === "low" ? (a.value < b.value ? -1 : 1) : a.value > b.value ? -1 : 1))[0];
    const tie = routes.every((route) => route.value != null) && routes[0].value === routes[1].value;
    box.innerHTML = routes
      .map((route) => {
        const text = show(route.value);
        const isBest = !tie && best && route.id === best.id && routes.every((item) => item.value != null);
        return `<div class="mpc-route is-${route.id}${isBest ? " is-best" : ""}">
          <span class="mpc-route-label">${route.label}${isBest ? `<em>${better === "low" ? "더 쌈" : "더 많음"}</em>` : ""}</span>
          <b>${text ? escapeHtml(text) : '<span class="mpc-need">시세를 적어 주세요</span>'}</b>
          ${route.sub ? `<small>${escapeHtml(route.sub)}</small>` : key === "won" && route.value != null ? `<small>${escapeHtml(formatCount(route.value))}${unit}</small>` : ""}
        </div>`;
      })
      .join("");
  }

  function update({ animate = false } = {}) {
    const { values, errors } = readAll();
    const rates = { exchange: values.exchange, cash: values.cash };
    saveStore({ points: field("points").value, exchange: field("exchange").value, cash: field("cash").value, meso: field("meso").value, won: field("won").value });

    // 포인트 → 원
    const wonBox = root.querySelector("[data-point-won]");
    if (errors.points) wonBox.innerHTML = `<span class="mpc-error">${escapeHtml(errors.points)}</span>`;
    else if (values.points == null) wonBox.textContent = "포인트 가격을 적어 주세요.";
    else {
      const value = pointValue(values.points, rates);
      const coins = (Number(values.points) * 1400) / 10000;
      wonBox.innerHTML = `= <b>${escapeHtml(wonText(value.won))}</b><span>월드코인 ${escapeHtml(coins.toLocaleString("ko-KR", { maximumFractionDigits: 1 }))}개</span>`;
    }
    for (const button of root.querySelectorAll("[data-preset]")) button.setAttribute("aria-pressed", String(values.points != null && BigInt(button.dataset.preset) === values.points));

    // 두 기준 메소 가치
    const value = values.points != null ? pointValue(values.points, rates) : null;
    const outputs = { exchange: value?.exchangeMeso ?? null, cash: value?.cashMeso ?? null };
    const top = [outputs.exchange, outputs.cash].filter((item) => item != null).reduce((a, b) => (a > b ? a : b), 0n);
    for (const key of ["exchange", "cash"]) {
      const out = outputs[key];
      const card = root.querySelector(`.mpc-card.is-${key}`);
      const hasRate = rates[key] != null;
      card.classList.toggle("is-empty", out == null);
      root.querySelector(`[data-out="${key}"]`).innerHTML = out != null ? `${escapeHtml(mesoShort(out))}<small>메소</small>` : `<span class="mpc-need">${hasRate ? "-" : "시세를 적어 주세요"}</span>`;
      root.querySelector(`[data-out-exact="${key}"]`).textContent = out != null && out >= 10000n ? exact(out) : "";
      const bar = root.querySelector(`[data-bar="${key}"]`);
      bar.style.setProperty("--w", out != null && top > 0n ? `${Number((out * 1000n) / top) / 10}%` : "0%");
      const winner = outputs.exchange != null && outputs.cash != null && out === top && outputs.exchange !== outputs.cash;
      card.classList.toggle("is-more", winner);
    }

    // 차이(주인공)
    const diffBox = root.querySelector("[data-diff]");
    if (value?.diff != null) {
      const abs = value.diff < 0n ? -value.diff : value.diff;
      const bigger = value.diff > 0n ? "현금 거래" : "게임 내 교환";
      const smaller = value.diff > 0n ? "게임 내 교환" : "현금 거래";
      const percent = value.diff > 0n ? value.rate : Number((abs * 10000n) / value.cashMeso) / 100;
      const key = `${values.points}:${rates.exchange}:${rates.cash}`;
      diffBox.className = `mpc-diff is-${value.diff === 0n ? "same" : value.diff > 0n ? "cash" : "exchange"}${animate || key !== prevKey ? " is-pop" : ""}`;
      prevKey = key;
      diffBox.innerHTML = value.diff === 0n
        ? `<span class="mpc-diff-label">두 기준이 같아요</span><strong>차이 없음</strong>`
        : `<span class="mpc-diff-label">두 기준 차이</span>
           <strong>${escapeHtml(mesoShort(abs))}<small>메소</small></strong>
           <span class="mpc-diff-copy"><b>${bigger}</b> 기준이 ${escapeHtml(percent.toLocaleString("ko-KR", { maximumFractionDigits: 2 }))}% 더 커요 · ${smaller} 기준이 ${escapeHtml(mesoShort(abs))} 적어요</span>
           ${abs >= 10000n ? `<small class="mpc-diff-exact">${escapeHtml(formatCount(abs))} 메소</small>` : ""}`;
    } else {
      diffBox.className = "mpc-diff is-wait";
      diffBox.innerHTML = `<span class="mpc-diff-label">두 기준 차이</span><span class="mpc-diff-copy">${errors.exchange || errors.cash || errors.points ? escapeHtml(errors.exchange || errors.cash || errors.points) : "포인트 가격과 아래 시세 두 개를 적으면 차이를 보여 줘요."}</span>`;
    }

    // 시세 보조 문구: 서로 다른 단위로 바꿔 보기
    const exHint = root.querySelector('[data-rate-hint="exchange"]');
    exHint.innerHTML = errors.exchange
      ? `<span class="mpc-error">${escapeHtml(errors.exchange)}</span>`
      : rates.exchange != null
        ? `${escapeHtml(mesoShort(rates.exchange))} 메소 · 현금으로 치면 100만당 ${escapeHtml(exchangeWonPer1m(rates.exchange).toLocaleString("ko-KR"))}원`
        : "게임 안에서 1만 포인트를 메소로 바꾸는 값";
    const cashHint = root.querySelector('[data-rate-hint="cash"]');
    cashHint.innerHTML = errors.cash
      ? `<span class="mpc-error">${escapeHtml(errors.cash)}</span>`
      : rates.cash != null
        ? `1만 포인트 값(10,500원)이면 ${escapeHtml(mesoShort(cashMesoPer10k(rates.cash)))} 메소`
        : "유저끼리 메소를 사고파는 값";

    // 추가 계산
    for (const key of ["meso", "won"]) {
      const reading = root.querySelector(`[data-reading="${key}"]`);
      reading.innerHTML = errors[key] ? `<span class="mpc-error">${escapeHtml(errors[key])}</span>` : values[key] != null ? (key === "meso" ? `${escapeHtml(mesoShort(values[key]))} 메소` : `${escapeHtml(formatCount(values[key]))}원`) : "";
      if (values[key] == null) {
        root.querySelector(`[data-routes="${key}"]`).innerHTML = "";
        continue;
      }
      if (key === "meso") paintRoutes(key, cashForMeso(values.meso, rates), "low");
      else paintRoutes(key, mesoForCash(values.won, rates), "high");
    }
    paintSave();
  }

  // ── 시세 기록 ──────────────────────────────────────────
  function currentRates() {
    const exchange = readField("exchange", field("exchange").value);
    const cash = readField("cash", field("cash").value);
    return { exchange, cash };
  }

  function paintSave() {
    const button = root.querySelector("[data-save-rate]");
    const { exchange, cash } = currentRates();
    const ready = exchange.value != null && cash.value != null;
    const latest = history[0];
    const same = ready && latest && BigInt(latest.exchange_meso) === exchange.value && BigInt(latest.cash_won) === cash.value;
    button.disabled = saving || !ready;
    button.textContent = saving ? "기록 중…" : same ? "같은 시세 다시 기록" : "시세 기록";
    root.querySelector("[data-history-count]").textContent = String(history.length);
    const last = root.querySelector("[data-last-rate]");
    if (historyError) last.innerHTML = `<span class="mpc-error">${escapeHtml(historyError)}</span>`;
    else if (!isLoggedIn()) last.textContent = "로그인하면 시세를 기록해 두고 나중에 불러올 수 있어요.";
    else if (latest) last.innerHTML = `마지막 기록 <b>${escapeHtml(formatWhen(latest.created_at))}</b> · 교환 ${escapeHtml(mesoShort(BigInt(latest.exchange_meso)))} · 현금 ${escapeHtml(formatCount(latest.cash_won))}원${same ? ' <span class="mpc-tag">지금 시세와 같음</span>' : ""}`;
    else last.textContent = "아직 기록한 시세가 없어요.";
  }

  async function loadHistory({ fillIfEmpty = false } = {}) {
    const current = ++loadId;
    if (!isLoggedIn()) {
      history = [];
      historyError = "";
      paintSave();
      return;
    }
    const supabase = await getSupabase();
    const { data, error } = await supabase.from("meso_point_rates").select("id, exchange_meso, cash_won, memo, created_at").order("created_at", { ascending: false });
    if (current !== loadId || !root.isConnected) return;
    // 표가 아직 없으면(sql/082 실행 전) 계산은 그대로 쓰고 기록만 안내한다
    historyError = error ? (/meso_point_rates/.test(error.message || "") || error.code === "42P01" || error.code === "PGRST205" ? "시세 기록은 준비 중이에요. 계산은 그대로 쓸 수 있어요." : translateDbError(error)) : "";
    history = error ? [] : data ?? [];
    if (fillIfEmpty && history[0] && !field("exchange").value && !field("cash").value) {
      field("exchange").value = String(history[0].exchange_meso);
      field("cash").value = String(history[0].cash_won);
      update();
    }
    paintSave();
    if (dialog.open) paintHistory();
  }

  async function saveRate(button) {
    if (saving) return;
    const { exchange, cash } = currentRates();
    if (exchange.error || cash.error || exchange.value == null || cash.value == null) {
      notify(exchange.error || cash.error || "시세 두 개를 모두 적어 주세요.", "error");
      (exchange.error || exchange.value == null ? field("exchange") : field("cash")).focus();
      return;
    }
    if (!requireLogin("시세 기록은 로그인한 계정에 저장돼요.", { fields: snapshotFields(root) })) return;
    saving = true;
    paintSave();
    try {
      const memo = root.querySelector("[data-field-memo]").value.trim();
      const supabase = await getSupabase();
      const { error } = await supabase.from("meso_point_rates").insert({ exchange_meso: exchange.value.toString(), cash_won: Number(cash.value), memo: memo || null });
      if (!root.isConnected) return;
      if (error) {
        notify(translateDbError(error), "error");
        return;
      }
      sfx("check");
      if (button?.isConnected) burstAt(button, ["#ffe28a", "#8fd3ff", "#9ff0b8"], 18, 0.8);
      notify("시세를 기록했어요.");
      root.querySelector("[data-field-memo]").value = "";
      await loadHistory();
    } finally {
      saving = false;
      if (root.isConnected) paintSave();
    }
  }

  function paintHistory() {
    const body = root.querySelector("[data-history-body]");
    if (historyError) {
      body.innerHTML = `<p class="hint">${escapeHtml(historyError)}</p>`;
      return;
    }
    if (!history.length) {
      body.innerHTML = `<p class="hint">${isLoggedIn() ? "아직 기록이 없어요." : "로그인하면 시세를 기록할 수 있어요."}</p>`;
      return;
    }
    body.innerHTML = `<ol class="mpc-history">${history
      .map((row, index) => {
        const older = history[index + 1];
        return `<li class="mpc-history-row" style="--i:${Math.min(index, 12)}">
          <span class="mpc-history-when">${escapeHtml(formatWhen(row.created_at))}${row.memo ? `<small>${escapeHtml(row.memo)}</small>` : ""}</span>
          <span class="mpc-history-val is-exchange"><small>교환 1만P</small><b>${escapeHtml(mesoShort(BigInt(row.exchange_meso)))}</b>${deltaText(row.exchange_meso, older?.exchange_meso, "meso")}</span>
          <span class="mpc-history-val is-cash"><small>현금 100만</small><b>${escapeHtml(formatCount(row.cash_won))}원</b>${deltaText(row.cash_won, older?.cash_won, "won")}</span>
          <span class="mpc-history-act">
            <button type="button" class="mpc-chip" data-load-rate="${escapeHtml(row.id)}">불러오기</button>
            <button type="button" class="text-button is-danger" data-delete-rate="${escapeHtml(row.id)}">삭제</button>
          </span>
        </li>`;
      })
      .join("")}</ol>`;
  }

  function loadRate(id) {
    const row = history.find((item) => item.id === id);
    if (!row) return;
    field("exchange").value = String(row.exchange_meso);
    field("cash").value = String(row.cash_won);
    update({ animate: true });
    dialog.close();
    sfx("tick");
    notify(`${formatWhen(row.created_at)} 시세로 다시 계산했어요.`);
  }

  async function deleteRate(id) {
    const row = history.find((item) => item.id === id);
    if (!row) return;
    if (!window.confirm(`${formatWhen(row.created_at)} 시세 기록(교환 ${mesoShort(BigInt(row.exchange_meso))} · 현금 ${formatCount(row.cash_won)}원)을 삭제할까요?`)) return;
    const supabase = await getSupabase();
    const { error } = await supabase.from("meso_point_rates").delete().eq("id", id);
    if (!root.isConnected) return;
    if (error) {
      notify(translateDbError(error), "error");
      return;
    }
    notify("시세 기록을 삭제했어요.");
    await loadHistory();
  }

  // ── 이벤트 ────────────────────────────────────────────
  root.addEventListener("input", (event) => {
    if (event.target.matches("[data-field]")) update();
  });
  root.addEventListener("click", (event) => {
    const preset = event.target.closest("[data-preset]");
    if (preset) {
      field("points").value = preset.dataset.preset;
      sfx("tick");
      update({ animate: true });
      return;
    }
    if (event.target.closest("[data-save-rate]")) {
      saveRate(event.target.closest("[data-save-rate]"));
      return;
    }
    if (event.target.closest("[data-open-history]")) {
      paintHistory();
      if (!dialog.open) dialog.showModal();
      return;
    }
    if (event.target.closest("[data-close-history]")) {
      dialog.close();
      return;
    }
    const load = event.target.closest("[data-load-rate]");
    if (load) {
      loadRate(load.dataset.loadRate);
      return;
    }
    const del = event.target.closest("[data-delete-rate]");
    if (del) deleteRate(del.dataset.deleteRate);
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  update();
  // 로그인하러 가기 전에 적던 값이 있으면 되살린다(저장은 사용자가 다시 누른다)
  const draft = takeDraft(ROUTE);
  if (draft) {
    restoreFields(root, draft.fields);
    update();
    notify("로그인했어요. 적어 둔 시세를 그대로 채워 뒀으니 \"시세 기록\"을 눌러 주세요.", "info");
  }
  loadHistory({ fillIfEmpty: true });
}
