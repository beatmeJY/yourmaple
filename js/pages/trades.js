import { translateDbError } from "../db-error.js";
import { BURST_COLORS, burstAt, celebrate, sfx } from "../effects.js";
import { escapeHtml, formatCount, readCount } from "../format.js";
import { matchesText } from "../filters.js";
import { getSupabase } from "../supabase-client.js";
import { notify } from "../toast.js";
import { combineLots, completeGroups, isCompleteTrade, isPartialSell, openGroups, tradeName } from "../trade-merge.js";

const columns = "id, name, buy_price, buy_qty, sell_price, sell_qty, created_at, updated_at";

const blank = {
  id: "",
  name: "",
  buy_price: "",
  buy_qty: "",
  sell_price: "",
  sell_qty: "",
};

function remainingOf(row) {
  return row.buy_qty - row.sell_qty;
}

function statusOf(row) {
  return remainingOf(row) > 0 ? "보유중" : "판매 완료";
}

function profitOf(row) {
  if (row.sell_price == null || !row.sell_qty) return null;
  return (row.sell_price - row.buy_price) * row.sell_qty;
}

function moneyClass(value) {
  if (value == null || value === 0) return "";
  return value > 0 ? "is-gain" : "is-loss";
}

function signedMoney(value) {
  if (value == null) return "-";
  if (value > 0) return `+${formatCount(value)}`;
  return formatCount(value);
}

export async function render(root) {
  root.innerHTML = `
    <div class="trade-page">
      <header class="page-header">
        <p class="trade-kicker">장부</p>
        <div class="trade-hero-row">
          <h1>거래 장부</h1>
          <button class="primary-button" type="button" data-add>거래 추가</button>
        </div>
      </header>
      <div data-summary></div>
      <div class="trade-layout">
      <section class="trade-board">
        <div class="trade-board-bar">
          <div class="trade-segments" data-views role="group" aria-label="거래 상태">
            <button type="button" data-view="all" class="is-on" aria-pressed="true">전체</button>
            <button type="button" data-view="holding" aria-pressed="false">보유중</button>
            <button type="button" data-view="sold" aria-pressed="false">판매 완료</button>
          </div>
          <label class="field trade-search"><span>아이템명</span><input data-search placeholder="이름으로 찾기" /></label>
          <label class="field trade-sort"><span>정렬</span><select data-sort aria-label="거래 정렬 기준">
            <option value="total-desc">매수 총액 높은 순</option><option value="total-asc">매수 총액 낮은 순</option>
            <option value="price-desc">매수 단가 높은 순</option><option value="price-asc">매수 단가 낮은 순</option>
            <option value="created-desc">등록일 최신 순</option><option value="created-asc">등록일 오래된 순</option>
            <option value="updated-desc">수정일 최신 순</option><option value="updated-asc">수정일 오래된 순</option>
          </select></label>
        </div>
        <div data-list></div>
      </section>
      <aside class="trade-side">
        <form class="editor trade-editor ym-glass" id="trade-form">
          <h2 data-form-title>거래 추가</h2>
          <label class="field span-all"><span>아이템명</span><input name="name" required autocomplete="off" /></label>
          <div class="trade-form-sides span-all">
            <fieldset class="trade-form-side is-buy">
              <legend>매수</legend>
              <label class="field"><span>개당 가격</span><input name="buy_price" inputmode="numeric" required autocomplete="off" /><small data-selected-value="buy_price" hidden aria-live="polite"></small></label>
              <label class="field"><span>개수</span><input name="buy_qty" inputmode="numeric" required autocomplete="off" /><small data-selected-value="buy_qty" hidden aria-live="polite"></small></label>
              <button class="secondary-button" type="button" data-save-buy>매수 저장</button>
            </fieldset>
            <fieldset class="trade-form-side is-sell">
              <legend>매도</legend>
              <label class="field"><span>개당 가격</span><input name="sell_price" inputmode="numeric" placeholder="아직 안 팔렸으면 비움" autocomplete="off" /><small data-selected-value="sell_price" hidden aria-live="polite"></small></label>
              <label class="field"><span>개수</span><input name="sell_qty" inputmode="numeric" placeholder="아직 안 팔렸으면 비움" autocomplete="off" /><small data-selected-value="sell_qty" hidden aria-live="polite"></small></label>
              <button class="secondary-button" type="button" data-save-sell>매도 저장</button>
              <small>목록에서 선택한 거래에 이번 판매분을 추가합니다.</small>
            </fieldset>
          </div>
          <div class="button-row span-all">
            <button class="primary-button" type="submit" data-save>통합 저장</button>
            <button class="secondary-button" type="button" data-cancel>입력 초기화</button>
          </div>
        </form>
      </aside>
      </div>
    </div>
  `;

  const list = root.querySelector("[data-list]");
  const summary = root.querySelector("[data-summary]");
  const form = root.querySelector("#trade-form");
  const title = root.querySelector("[data-form-title]");
  let rows = [];
  let view = "all";
  let loadId = 0;
  let selectedId = "";
  let sort = "total-desc";

  function showStatus(text, kind) {
    notify(text, kind);
  }

  function searchedRows() {
    return rows.filter((row) => matchesText(row, root.querySelector("[data-search]").value, ["name"]));
  }

  function visibleRows() {
    return searchedRows().filter((row) => {
      const remaining = remainingOf(row);
      if (view === "holding") return remaining > 0;
      if (view === "sold") return remaining === 0;
      return true;
    });
  }

  function lotBuy(row) {
    return row.buy_price * row.buy_qty;
  }

  function lotSell(row) {
    return row.sell_qty ? row.sell_price * row.sell_qty : 0;
  }

  function paintSummary(source) {
    const heldCost = source.reduce((sum, row) => sum + row.buy_price * remainingOf(row), 0);
    const heldLots = source.filter((row) => remainingOf(row) > 0).length;
    const soldCost = source.reduce((sum, row) => sum + row.buy_price * row.sell_qty, 0);
    const soldRevenue = source.reduce((sum, row) => sum + lotSell(row), 0);
    const realized = soldRevenue - soldCost;
    const rate = soldCost > 0 ? ((soldCost - soldRevenue) / soldCost) * 100 : null;
    const rateText = rate == null ? "-" : `${rate > 0 ? "감가 " : rate < 0 ? "이익 " : ""}${Math.abs(rate).toFixed(1)}%`;
    const holding = source.filter((row) => remainingOf(row) > 0);
    const finished = source.filter((row) => remainingOf(row) === 0);
    const total = (list, pick) => list.reduce((sum, row) => sum + pick(row), 0);
    summary.innerHTML = `
      <div class="trade-kpis">
        <div class="trade-kpi-grid">
          <article class="trade-kpi"><span>보유 중인 거래</span><strong>${formatCount(heldLots)}건</strong></article>
          <article class="trade-kpi"><span>아직 안 판 원가</span><strong>${formatCount(heldCost)}</strong></article>
          <article class="trade-kpi is-focus"><span>실현 손익</span><strong class="${moneyClass(realized)}">${signedMoney(realized)}</strong></article>
          <article class="trade-kpi"><span>판매분 감가율</span><strong class="${rate > 0 ? "is-loss" : rate < 0 ? "is-gain" : ""}">${rateText}</strong></article>
        </div>
        <div class="trade-books">
          <section class="trade-booklet">
            <h3>보유중</h3>
            <span>산 총원가</span><strong>${formatCount(total(holding, lotBuy))}</strong>
            <span>판매 총원가</span><strong>${formatCount(total(holding, lotSell))}</strong>
          </section>
          <section class="trade-booklet">
            <h3>판매 완료</h3>
            <span>산 총원가</span><strong>${formatCount(total(finished, lotBuy))}</strong>
            <span>판매 총원가</span><strong>${formatCount(total(finished, lotSell))}</strong>
          </section>
        </div>
      </div>
    `;
  }

  function statusRank(row) {
    return remainingOf(row) > 0 ? 0 : 1;
  }

  function sortedTrades(source) {
    return [...source].sort((a, b) => {
      const status = statusRank(a) - statusRank(b);
      if (status) return status;
      const [field, direction] = sort.split("-");
      const valueOf = (row) => field === "price" ? BigInt(row.buy_price) : field === "total" ? BigInt(row.buy_price) * BigInt(row.buy_qty) : Date.parse(field === "created" ? row.created_at : row.updated_at) || 0;
      const left = valueOf(a);
      const right = valueOf(b);
      const order = left < right ? -1 : left > right ? 1 : 0;
      if (order) return direction === "asc" ? order : -order;
      return a.name.localeCompare(b.name, "ko");
    });
  }

  function tradeField(row, field, value, label, quiet) {
    const shown = value == null || value === "" ? "" : formatCount(value);
    return `<input class="amount-input${quiet ? " is-quiet" : ""}" data-trade-id="${row.id}" data-trade-field="${field}" inputmode="numeric" value="${escapeHtml(shown)}" aria-label="${escapeHtml(`${row.name} ${label}`)}" />`;
  }

  function card(row) {
    const profit = profitOf(row);
    const remaining = remainingOf(row);
    const sold = row.sell_price != null && row.sell_qty > 0;
    const tone = moneyClass(profit);
    const buyTotal = formatCount(row.buy_price * row.buy_qty);
    const sellTotal = sold ? formatCount(row.sell_price * row.sell_qty) : "—";
    const profitText = signedMoney(profit);
    const soldCost = row.buy_price * row.sell_qty;
    const profitRate = profit == null || soldCost === 0 ? null : profit / soldCost * 100;
    const rateText = profitRate == null ? "" : `${profitRate > 0 ? "+" : ""}${profitRate.toFixed(1)}%`;
    return `
      <article class="trade-card${selectedId === row.id ? " is-selected" : ""}" data-select-trade="${escapeHtml(row.id)}">
        <div class="trade-card-id">
          <h3><button class="text-button" type="button" data-select-name="${escapeHtml(row.id)}" aria-pressed="${selectedId === row.id}">${escapeHtml(row.name)}</button></h3>
          ${profit == null || profit === 0 ? "" : `<span class="trade-profit-sticker ${tone}">${profit > 0 ? "흑자" : "적자"}</span>`}
        </div>
        <section class="trade-lane is-buy">
          <p class="trade-lane-kicker">매수</p>
          <label class="trade-field"><span>가격</span>${tradeField(row, "buy_price", row.buy_price, "산 가격")}</label>
          <label class="trade-field"><span>개수</span>${tradeField(row, "buy_qty", row.buy_qty, "산 개수")}</label>
          <p class="trade-lane-total"><span>총액</span><strong class="${row.buy_qty === 1 ? "is-quiet" : ""}" title="${escapeHtml(buyTotal)}">${escapeHtml(buyTotal)}</strong></p>
        </section>
        <section class="trade-lane is-sell">
          <p class="trade-lane-kicker">매도</p>
          <label class="trade-field"><span>가격</span>${tradeField(row, "sell_price", row.sell_price, "판 가격")}</label>
          <label class="trade-field"><span>개수</span>${tradeField(row, "sell_qty", row.sell_qty > 0 ? row.sell_qty : null, "판 개수")}</label>
          <p class="trade-lane-total"><span>총액</span><strong class="${!sold || row.sell_qty === 1 ? "is-quiet" : ""}" title="${escapeHtml(sellTotal)}">${escapeHtml(sellTotal)}</strong></p>
        </section>
        <section class="trade-lane is-result">
          <p class="trade-metric"><span>재고</span><strong class="${remaining === row.buy_qty ? "is-quiet" : ""}">${escapeHtml(formatCount(remaining))}</strong></p>
          <p class="trade-profit ${moneyClass(profit)}"><span>총 실현 수익</span><strong title="${escapeHtml(profitText)}">${escapeHtml(profitText)}</strong>${rateText ? `<small class="trade-profit-rate">${escapeHtml(rateText)}</small>` : ""}</p>
        </section>
        <div class="row-actions">
          <button class="text-button" type="button" data-edit="${row.id}">수정</button>
          <button class="text-button is-danger" type="button" data-delete="${row.id}">삭제</button>
        </div>
        <footer class="trade-dates"><span>최초 등록 ${tradeDate(row.created_at)}</span><span>마지막 수정 ${tradeDate(row.updated_at)}</span></footer>
      </article>
    `;
  }

  function tradeDate(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return "—";
    return escapeHtml(new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date));
  }

  function paintList() {
    root.querySelectorAll("[data-view]").forEach((button) => {
      const on = button.dataset.view === view;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-pressed", on ? "true" : "false");
    });
    const visible = visibleRows();
    paintSummary(searchedRows());
    if (!rows.length) {
      list.innerHTML = `<p class="empty">등록한 거래가 없습니다. 거래 추가로 산 가격과 개수를 먼저 적어 보세요.</p>`;
      return;
    }
    if (!visible.length) {
      list.innerHTML = `<p class="empty">이 조건에 맞는 거래가 없습니다.</p>`;
      return;
    }
    const groups = [];
    for (const row of sortedTrades(visible)) {
      const status = statusOf(row);
      const last = groups[groups.length - 1];
      if (!last || last.status !== status) groups.push({ status, rows: [row] });
      else last.rows.push(row);
    }
    list.innerHTML = groups
      .map((group) => {
        const head =
          view === "all"
            ? `<header class="trade-group-head"><h2>${escapeHtml(group.status)}</h2><span class="count-pill">${formatCount(group.rows.length)}</span></header>`
            : "";
        return `<section class="trade-group">${head}<div class="trade-cards">${group.rows.map(card).join("")}</div></section>`;
      })
      .join("");
  }

  function tradeInputs(id) {
    return Object.fromEntries(
      [...root.querySelectorAll(`[data-trade-id="${id}"]`)].map((input) => [input.dataset.tradeField, input]),
    );
  }

  function restoreTradeInputs(row) {
    const inputs = tradeInputs(row.id);
    if (!inputs.buy_price) return;
    inputs.buy_price.value = formatCount(row.buy_price);
    inputs.buy_qty.value = formatCount(row.buy_qty);
    inputs.sell_price.value = row.sell_price == null ? "" : formatCount(row.sell_price);
    inputs.sell_qty.value = row.sell_qty ? formatCount(row.sell_qty) : "";
  }

  function applyAmountCommas(input) {
    const raw = input.value;
    const caret = input.selectionStart ?? raw.length;
    const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    const next = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    if (next === raw) return;
    const digitsBefore = raw.slice(0, caret).replace(/\D/g, "").replace(/^0+(?=\d)/, "").length;
    input.value = next;
    if (!digitsBefore) {
      input.setSelectionRange(0, 0);
      return;
    }
    let seen = 0;
    let pos = next.length;
    for (let index = 0; index < next.length; index += 1) {
      if (/\d/.test(next[index])) seen += 1;
      if (seen === digitsBefore) {
        pos = index + 1;
        break;
      }
    }
    input.setSelectionRange(pos, pos);
  }

  function readSellFields(priceText, qtyText, buyQty) {
    let sellPrice = null;
    let sellQty = 0;
    if (priceText) {
      const price = readCount(priceText, "판 가격", 0);
      if (price.error) return price;
      sellPrice = price.value;
    }
    if (qtyText) {
      const qty = readCount(qtyText, "판 개수", 1);
      if (qty.error) return qty;
      sellQty = qty.value;
    }
    if (sellQty > buyQty) return { error: "판 개수는 산 개수보다 많을 수 없습니다." };
    return { sellPrice, sellQty };
  }

  function readInline(row, inputs) {
    const buyPrice = readCount(inputs.buy_price.value, "산 가격", 0);
    if (buyPrice.error) return buyPrice;
    if (buyPrice.value == null) return { error: "산 가격을 입력해 주세요." };
    const buyQty = readCount(inputs.buy_qty.value, "산 개수", 1);
    if (buyQty.error) return buyQty;
    if (buyQty.value == null) return { error: "산 개수를 입력해 주세요." };
    const sold = readSellFields(inputs.sell_price.value.trim(), inputs.sell_qty.value.trim(), buyQty.value);
    if (sold.error) return sold;
    return {
      value: {
        name: row.name,
        buy_price: buyPrice.value,
        buy_qty: buyQty.value,
        sell_price: sold.sellPrice,
        sell_qty: sold.sellQty,
      },
    };
  }

  function sameTrade(row, value) {
    return (
      row.buy_price === value.buy_price &&
      row.buy_qty === value.buy_qty &&
      (row.sell_price ?? null) === (value.sell_price ?? null) &&
      row.sell_qty === value.sell_qty
    );
  }

  async function persistTrade(id, value) {
    const supabase = await getSupabase();
    const stored = { ...value, name: tradeName(value.name) };
    const complete = isCompleteTrade(stored);
    const sameLot = isPartialSell(stored)
      ? null
      : rows.find(
          (row) =>
            row.id !== id &&
            !isPartialSell(row) &&
            isCompleteTrade(row) === complete &&
            tradeName(row.name) === stored.name,
        );
    if (sameLot) {
      const updated = await supabase.from("trades").update(combineLots([sameLot, stored])).eq("id", sameLot.id);
      if (updated.error) return { error: updated.error };
      if (id) {
        const removed = await supabase.from("trades").delete().eq("id", id);
        if (removed.error) return { error: removed.error };
      }
      return { merged: true };
    }
    const query = id
      ? supabase.from("trades").update(stored).eq("id", id)
      : supabase.from("trades").insert(stored);
    const { error } = await query;
    return { error, merged: false };
  }

  const savingIds = new Set();

  async function saveInline(input) {
    const row = rows.find((item) => item.id === input.dataset.tradeId);
    if (!row || savingIds.has(row.id)) return;
    savingIds.add(row.id);
    try {
      const inputs = tradeInputs(row.id);
      if (!inputs.buy_price) return;
      const parsed = readInline(row, inputs);
      if (parsed.error) {
        showStatus(parsed.error, "error");
        restoreTradeInputs(row);
        return;
      }
      if (sameTrade(row, parsed.value)) {
        restoreTradeInputs(row);
        return;
      }
      showStatus("저장하는 중입니다.", "info");
      const saved = await persistTrade(row.id, parsed.value);
      if (saved.error) {
        showStatus(translateDbError(saved.error), "error");
        restoreTradeInputs(row);
        return;
      }
      if (form.dataset.editingId === row.id) closeForm();
      showStatus(saved.merged ? "이름이 같은 거래를 한 줄로 합쳤습니다." : "거래를 수정했습니다.", "info");
      await loadRows();
    } finally {
      savingIds.delete(row.id);
    }
  }
  function fillForm(row) {
    form.hidden = false;
    form.dataset.editingId = row.id || "";
    title.textContent = row.id ? "거래 수정" : "거래 추가";
    form.elements.name.value = row.name ?? "";
    form.elements.buy_price.value = row.buy_price ?? "";
    form.elements.buy_qty.value = row.buy_qty ?? "";
    form.elements.sell_price.value = row.sell_price ?? "";
    form.elements.sell_qty.value = row.sell_qty ? row.sell_qty : "";
    selectedId = row.id || "";
    paintSelection();
    form.elements.name.focus();
    form.scrollIntoView({ block: "nearest" });
  }

  function closeForm() {
    form.hidden = false;
    form.dataset.editingId = "";
    form.reset();
    selectedId = "";
    title.textContent = "거래 추가";
    paintSelection();
  }

  function paintSelection() {
    const selected = rows.find((row) => row.id === selectedId);
    for (const card of list.querySelectorAll("[data-select-trade]")) {
      const on = !!selected && card.dataset.selectTrade === selectedId;
      card.classList.toggle("is-selected", on);
      card.querySelector("[data-select-name]").setAttribute("aria-pressed", String(on));
    }
    const labels = { buy_price: "현재 평균 매수가", buy_qty: "누적 매수 수량", sell_price: "현재 평균 매도가", sell_qty: "누적 매도 수량" };
    for (const hint of form.querySelectorAll("[data-selected-value]")) {
      const field = hint.dataset.selectedValue;
      hint.hidden = !selected;
      const value = selected?.[field];
      hint.textContent = !selected ? "" : `${labels[field]} · ${value == null ? "판매 내역 없음" : `${formatCount(value)}${field.endsWith("price") ? "메소" : "개"}`}`;
    }
  }

  function readForm(mode = "all") {
    if (mode === "sell") {
      const selected = rows.find((row) => row.id === selectedId);
      if (!selected) return { error: "매도할 보유 거래를 목록에서 선택해 주세요." };
      if (tradeName(form.elements.name.value) !== tradeName(selected.name)) return { error: "아이템명이 선택한 거래와 다릅니다. 매도할 거래를 다시 선택해 주세요." };
      if (remainingOf(selected) <= 0) return { error: "선택한 거래에는 판매할 재고가 없습니다." };
      const sold = readSellFields(form.elements.sell_price.value.trim(), form.elements.sell_qty.value.trim(), remainingOf(selected));
      if (sold.error) return sold;
      if (sold.sellPrice == null || sold.sellQty === 0) return { error: "이번에 판 가격과 개수를 모두 입력해 주세요." };
      const sellQty = selected.sell_qty + sold.sellQty;
      const revenue = BigInt(selected.sell_price ?? 0) * BigInt(selected.sell_qty) + BigInt(sold.sellPrice) * BigInt(sold.sellQty);
      const sellPrice = Number((revenue + BigInt(sellQty) / 2n) / BigInt(sellQty));
      return { value: { name: selected.name, buy_price: selected.buy_price, buy_qty: selected.buy_qty, sell_price: sellPrice, sell_qty: sellQty } };
    }
    const name = form.elements.name.value.trim();
    if (!name) return { error: "아이템명을 입력해 주세요." };
    const buyPrice = readCount(form.elements.buy_price.value, "개당 산 가격", 0);
    if (buyPrice.error) return buyPrice;
    if (buyPrice.value == null) return { error: "개당 산 가격을 입력해 주세요." };
    const buyQty = readCount(form.elements.buy_qty.value, "산 개수", 1);
    if (buyQty.error) return buyQty;
    if (buyQty.value == null) return { error: "산 개수를 입력해 주세요." };
    const sold = mode === "buy" ? { sellPrice: null, sellQty: 0 } : readSellFields(form.elements.sell_price.value.trim(), form.elements.sell_qty.value.trim(), buyQty.value);
    if (sold.error) return sold;
    return {
      value: {
        name,
        buy_price: buyPrice.value,
        buy_qty: buyQty.value,
        sell_price: sold.sellPrice,
        sell_qty: sold.sellQty,
      },
    };
  }

  async function collapseOpenTrades(supabase, data) {
    const groups = [...openGroups(data), ...completeGroups(data)];
    if (!groups.length) return data;
    for (const group of groups) {
      const [keep, ...rest] = [...group].sort((a, b) => a.created_at.localeCompare(b.created_at));
      const { error } = await supabase.from("trades").update(combineLots(group)).eq("id", keep.id);
      if (error) throw error;
      const { error: deleteError } = await supabase.from("trades").delete().in(
        "id",
        rest.map((row) => row.id),
      );
      if (deleteError) throw deleteError;
    }
    const { data: next, error } = await supabase.from("trades").select(columns).order("updated_at", { ascending: false });
    if (error) throw error;
    return next ?? [];
  }

  async function loadRows() {
    const current = ++loadId;
    list.innerHTML = `<p class="empty">거래를 불러오는 중입니다.</p>`;
    const supabase = await getSupabase();
    const { data, error } = await supabase.from("trades").select(columns).order("updated_at", { ascending: false });
    if (current !== loadId || !list.isConnected) return;
    if (error) {
      rows = [];
      summary.innerHTML = "";
      list.innerHTML = "";
      showStatus(translateDbError(error), "error");
      return;
    }
    try {
      rows = await collapseOpenTrades(supabase, data ?? []);
    } catch (mergeError) {
      rows = data ?? [];
      showStatus(translateDbError(mergeError), "error");
    }
    if (current !== loadId || !list.isConnected) return;
    paintList();
    paintSelection();
  }

  root.addEventListener("input", (event) => {
    if (event.target.closest("[data-trade-field]")) applyAmountCommas(event.target);
    if (event.target.closest("[data-search]")) paintList();
  });

  root.addEventListener("change", (event) => {
    if (!event.target.matches("[data-sort]")) return;
    sort = event.target.value;
    paintList();
  });

  root.addEventListener("keydown", (event) => {
    const input = event.target.closest?.("[data-trade-field]");
    if (!input || event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    saveInline(input);
  });

  root.addEventListener("focusout", (event) => {
    const input = event.target.closest?.("[data-trade-field]");
    if (input) saveInline(input);
  });

  root.addEventListener("click", async (event) => {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) {
      view = viewButton.dataset.view;
      paintList();
    }
    if (event.target.closest("[data-add]")) {
      showStatus("", "info");
      fillForm(blank);
    }
    if (event.target.closest("[data-cancel]")) closeForm();
    if (event.target.closest("[data-save-buy]")) await saveForm("buy");
    if (event.target.closest("[data-save-sell]")) await saveForm("sell");

    const selectedCard = event.target.closest("[data-select-trade]");
    if (selectedCard && !event.target.closest("input, label, [data-edit], [data-delete]")) {
      selectedId = selectedCard.dataset.selectTrade;
      const selected = rows.find((row) => row.id === selectedId);
      if (selected) {
        form.dataset.editingId = "";
        title.textContent = "거래 추가";
        form.elements.name.value = selected.name;
        paintSelection();
        form.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      }
    }

    const editButton = event.target.closest("[data-edit]");
    if (editButton) {
      const row = rows.find((item) => item.id === editButton.dataset.edit);
      if (row) fillForm(row);
    }

    const deleteButton = event.target.closest("[data-delete]");
    if (!deleteButton) return;
    const row = rows.find((item) => item.id === deleteButton.dataset.delete);
    if (!row) return;
    if (!window.confirm(`${row.name} 거래를 삭제할까요? 삭제한 내용은 되돌릴 수 없습니다.`)) return;
    deleteButton.disabled = true;
    const supabase = await getSupabase();
    const { error } = await supabase.from("trades").delete().eq("id", row.id);
    if (error) {
      deleteButton.disabled = false;
      showStatus(translateDbError(error), "error");
      return;
    }
    if (form.dataset.editingId === row.id) closeForm();
    showStatus("거래를 삭제했습니다.", "info");
    await loadRows();
  });

  // 저장 연출: 판매분이 이익이면 초록 파티클, 손해면 실패음, 이익으로 모두 팔면 "흑자 완판!"(시안).
  function cheer(mode, value) {
    const button = form.querySelector(mode === "buy" ? "[data-save-buy]" : mode === "sell" ? "[data-save-sell]" : "[data-save]");
    const profit = value.sell_qty > 0 ? profitOf(value) : null;
    if (profit == null) {
      sfx("check");
      burstAt(button, BURST_COLORS.mid, 20, 0.9);
      return;
    }
    if (profit < 0) {
      sfx("fail");
      return;
    }
    if (profit > 0 && remainingOf(value) === 0) {
      celebrate("흑자 완판!", `${value.name} · ${signedMoney(profit)}`);
      return;
    }
    sfx(profit > 0 ? "mid" : "check");
    burstAt(button, BURST_COLORS.success, profit > 0 ? 28 : 16, profit > 0 ? 1.1 : 0.8);
  }

  let formSaving = false;
  async function saveForm(mode = "all") {
    if (formSaving) return;
    const parsed = readForm(mode);
    if (parsed.error) {
      showStatus(parsed.error, "error");
      return;
    }
    formSaving = true;
    const buttons = [...form.querySelectorAll("button")];
    buttons.forEach((button) => button.disabled = true);
    try {
      showStatus("저장하는 중입니다.", "info");
      const id = mode === "buy" ? "" : mode === "sell" ? selectedId : form.dataset.editingId;
      const saved = await persistTrade(id, parsed.value);
      if (saved.error) {
        showStatus(translateDbError(saved.error), "error");
        return;
      }
      form.dataset.editingId = "";
      title.textContent = "거래 추가";
      cheer(mode, parsed.value);
      showStatus(
        saved.merged ? "이름이 같은 거래를 한 줄로 합쳤습니다." : mode === "sell" ? "이번 판매분을 저장했습니다." : id ? "거래를 수정했습니다." : "거래를 저장했습니다.",
        "info",
      );
      await loadRows();
    } catch (error) {
      showStatus(translateDbError(error), "error");
    } finally {
      formSaving = false;
      buttons.forEach((button) => button.disabled = false);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveForm();
  });

  await loadRows();
}
