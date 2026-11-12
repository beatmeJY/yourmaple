import { showGuestPreview } from "../guest-preview.js";
import { catalogError } from "../catalog.js";
import { catalogRpc } from "../catalog-api.js";
import { equipmentTypeName, isEquipment } from "../catalog-equipment.js";
import { catalogImage, mountCatalogImageFallback } from "../catalog-image.js";
import { itemOptionFields, itemSnapshot, readItemOptions, tradeItemKey } from "../item-options.js";
import { groupTotals, groupTrades, optionChips, tradeGroupKey } from "../trade-groups.js";
import { translateDbError } from "../db-error.js";
import { BURST_COLORS, burstAt, celebrate, sfx } from "../effects.js";
import { escapeHtml, formatCount, readCount } from "../format.js";
import { matchesText } from "../filters.js";
import { getSupabase } from "../supabase-client.js";
import { notify } from "../toast.js";
import { combineLots, isCompleteTrade, isPartialSell, tradeName } from "../trade-merge.js";
import { exactLinks, linkedTrade, unlinkedNames } from "../trade-link.js";

const columns = "id, name, buy_price, buy_qty, sell_price, sell_qty, created_at, updated_at, item_id, item_snapshot, item_options";

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
    <div class="trade-page tr2">
      <header class="page-header tr2-head">
        <div>
          <p class="trade-kicker">TRADE LEDGER</p>
          <h1>거래 장부</h1>
          <p class="tr2-sub">산 가격·판 가격을 적으면 손익을 계산해요. 장비는 옵션이 같으면 수량으로 합치고, 다르면 따로 기록해요.</p>
        </div>
        <button class="primary-button" type="button" data-add>＋ 거래 추가</button>
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
        <form class="editor trade-editor ym-glass" id="trade-form" autocomplete="off">
          <h2 data-form-title>거래 추가</h2>
          <div class="tr2-picker span-all">
            <label class="field"><span>아이템</span>
              <span class="tr2-search ym-search-wrap"><i class="ym-search-icon" aria-hidden="true"></i><input name="name" required autocomplete="off" spellcheck="false" placeholder="이름으로 찾기 · 도감에 없으면 그대로 적기" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="trade-item-results" /></span>
            </label>
            <input type="hidden" name="catalog_item" />
            <div class="tr2-results" id="trade-item-results" data-item-results role="listbox" aria-label="도감 아이템" hidden></div>
            <div class="tr2-picked" data-item-picked hidden></div>
            <small class="trade-catalog-status" data-catalog-status>도감에서 고르면 그림과 기본 옵션이 붙어요.</small>
          </div>
          <section class="tr2-options span-all" data-options hidden>
            <header><strong>실제 아이템 옵션</strong><small data-options-hint>산 아이템에 붙은 옵션을 적어요. 옵션이 같으면 수량으로 합치고, 다르면 따로 기록해요.</small></header>
            <div class="trade-options-grid">${itemOptionFields.map(({ key, label }) => `<label class="field tr2-option" data-option-field="${key}"><span>${escapeHtml(label)}<em data-option-range="${key}"></em></span><input name="option_${key}" inputmode="numeric" autocomplete="off" placeholder="—" /></label>`).join("")}</div>
            <button type="button" class="text-button tr2-more" data-options-more aria-expanded="false">＋ 다른 옵션도 적기</button>
          </section>
          <button type="button" class="text-button tr2-options-open span-all" data-options-open hidden>＋ 장비라면 옵션 적기</button>
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
            <button class="secondary-button" type="button" data-undo-save disabled>↶ 마지막 저장 취소</button>
          </div>
        </form>
      </aside>
      </div>
      <dialog class="tr2-link-dialog" data-link-dialog aria-labelledby="trade-link-title"></dialog>
    </div>
  `;
  if (showGuestPreview(root, "로그인하고 거래 기록하기")) return;

  mountCatalogImageFallback(root);

  const list = root.querySelector("[data-list]");
  const summary = root.querySelector("[data-summary]");
  const form = root.querySelector("#trade-form");
  const title = root.querySelector("[data-form-title]");
  let rows = [];
  let currentItemSnapshot = {};
  // 도감에서 고른 아이템(그림·분류·옵션 범위 표시용). 거래 저장 값은 catalog_item·item_snapshot·옵션 칸이 정한다.
  let picked = null;
  // 목록 그림: 도감 ID → { image_url, category, subcategory, required_level }
  const itemInfo = new Map();
  // 펼친 묶음(같은 아이템 거래가 여러 건)
  const openGroups = new Set();
  let showAllOptions = false;
  let view = "all";
  let loadId = 0;
  let selectedId = "";
  let sort = "total-desc";
  let lastSave = null;
  let changing = false;
  const undoButton = root.querySelector("[data-undo-save]");

  function paintUndo() {
    undoButton.disabled = changing || !lastSave;
    undoButton.title = lastSave ? `${lastSave.name} 저장 직전으로 되돌리기` : "이 화면에서 저장한 마지막 작업을 취소합니다.";
  }

  function saveError(error) {
    if (/replace_my_trades|PGRST202/.test(`${error?.message} ${error?.code}`)) {
      return "거래 저장·취소를 사용하려면 Supabase에서 sql/038_shared_game_catalog.sql을 실행해 주세요.";
    }
    if (error?.code === "40001" || /다른 곳에서.*변경/.test(error?.message ?? "")) {
      return "다른 곳에서 거래가 변경되어 처리하지 않았습니다. 새로고침 후 최신 거래를 확인해 주세요.";
    }
    return translateDbError(error);
  }

  async function undoSave() {
    if (changing || !lastSave) return;
    changing = true;
    paintUndo();
    const saved = lastSave;
    try {
      const supabase = await getSupabase();
      const { error } = await supabase.rpc("replace_my_trades_v2", { expected: saved.after, replacement: saved.before, restore_times: true });
      if (error) { showStatus(saveError(error), "error"); return; }
      lastSave = null;
      form.dataset.editingId = "";
      title.textContent = "거래 추가";
      await loadRows();
      sfx("uncheck");
      showStatus(`${saved.name}의 마지막 저장을 취소했습니다.`, "info");
    } catch (error) { showStatus(saveError(error), "error"); }
    finally { changing = false; paintUndo(); }
  }

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

  // 아이템 그림 칸: 도감 그림이 있으면 그림, 없으면 이름 첫 글자.
  function itemArt(row, size = 44) {
    const info = row.item_id ? itemInfo.get(row.item_id) : null;
    const image = info?.image_url ? catalogImage(info.image_url, "tr2-art-img", size) : "";
    return `<span class="tr2-art${image ? "" : " is-glyph"}" aria-hidden="true">${image || escapeHtml([...tradeName(row.name)][0] ?? "?")}</span>`;
  }

  function itemTags(row) {
    const info = row.item_id ? itemInfo.get(row.item_id) : null;
    const category = info?.category ?? row.item_snapshot?.category;
    const tags = [
      category && (isEquipment({ category }) ? equipmentTypeName(info?.subcategory) || "장비" : category),
      info?.required_level ? `Lv.${info.required_level}` : "",
      row.item_id ? "" : "직접 입력",
    ].filter(Boolean);
    return tags.map((tag) => `<span class="tr2-tag">${escapeHtml(tag)}</span>`).join("");
  }

  // 공격력과 주 스탯 4개는 칩에 색을 입힌다(스탯은 직업 계열 색: STR 전사·DEX 궁수·INT 마법사·LUK 도적).
  const STAT_TONE = new Set(["attack", "str", "dex", "int", "luk"]);

  // 도감에 연결된 장비면 옵션 칩 끝에 "옵션 적기/고치기" 버튼을 둔다.
  function chipHtml(chips, equipment, row) {
    const edit = row?.item_id && equipment
      ? `<button type="button" class="tr2-chip is-edit" data-option-open="${escapeHtml(row.id)}">${chips.length ? "✎ 옵션 고치기" : "＋ 옵션 적기"}</button>`
      : "";
    if (!chips.length) return edit || (equipment ? `<span class="tr2-chip is-empty">옵션 미기록</span>` : "");
    return chips.map((chip) => `<span class="tr2-chip${chip.unique ? " is-unique" : ""}"${STAT_TONE.has(chip.key) ? ` data-stat="${chip.key}"` : ""}${chip.unique ? ` title="이 묶음에서 거래마다 다른 옵션"` : ""}>${escapeHtml(chip.label)} <b>${chip.value === undefined ? "—" : escapeHtml(formatCount(chip.value))}</b></span>`).join("") + edit;
  }

  // 거래 한 건(=옵션이 같은 물건 묶음). 가격·개수는 그 자리에서 고친다.
  function lotCard(row, chips, { equipment, inGroup, index }) {
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
    const chipsText = chipHtml(chips, equipment, row);
    return `
      <article class="trade-card tr2-lot${selectedId === row.id ? " is-selected" : ""}" data-select-trade="${escapeHtml(row.id)}" style="--i:${Math.min(index, 10)}">
        <div class="trade-card-id">
          ${inGroup ? "" : itemArt(row)}
          <div class="tr2-lot-title">
            <h3><button class="text-button" type="button" data-select-name="${escapeHtml(row.id)}" aria-pressed="${selectedId === row.id}">${escapeHtml(inGroup ? `${index + 1}번 · ${remaining > 0 ? `보유 ${formatCount(remaining)}개` : "판매 완료"}` : row.name)}</button></h3>
            ${inGroup ? "" : `<p class="tr2-tags">${itemTags(row)}${row.item_id ? "" : linkButton(tradeGroupKey(row), 1)}<span class="tr2-tag is-${remaining > 0 ? "hold" : "done"}">${remaining > 0 ? `보유 ${formatCount(remaining)}개` : "판매 완료"}</span></p>`}
            ${chipsText ? `<p class="trade-option-copy tr2-chips">${chipsText}</p>` : ""}
          </div>
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

  // 같은 아이템 거래 묶음. 한 건이면 그 거래만, 여러 건이면 머리 줄을 눌러 펼치고 거래마다 다른 옵션을 금색으로 보여 준다.
  function groupCard(group, groupIndex) {
    const first = group.lots[0];
    const equipment = isEquipment({ category: (first.item_id ? itemInfo.get(first.item_id)?.category : null) ?? first.item_snapshot?.category })
      || group.lots.some((row) => Object.keys(row.item_options ?? {}).length);
    const chips = optionChips(group.lots);
    if (group.lots.length === 1) return `<div class="tr2-group is-single" style="--i:${Math.min(groupIndex, 10)}">${lotCard(first, chips[0], { equipment, inGroup: false, index: 0 })}</div>`;
    const open = openGroups.has(group.key);
    const totals = groupTotals(group.lots);
    const uniqueCount = new Set(chips.flat().filter((chip) => chip.unique).map((chip) => chip.key)).size;
    return `
      <section class="tr2-group${open ? " is-open" : ""}" data-group="${escapeHtml(group.key)}" style="--i:${Math.min(groupIndex, 10)}">
        <button type="button" class="tr2-group-head" data-toggle-group="${escapeHtml(group.key)}" aria-expanded="${open}">
          ${itemArt(first, 48)}
          <span class="tr2-group-copy">
            <strong>${escapeHtml(first.name)}</strong>
            <span class="tr2-tags">${itemTags(first)}<span class="tr2-tag is-count">거래 ${formatCount(group.lots.length)}건${uniqueCount ? ` · 옵션 ${formatCount(group.lots.length)}종` : ""}</span></span>
            <small>${open ? "거래마다 다른 옵션을 금색으로 표시했어요." : "눌러서 거래마다 다른 옵션을 비교해요."}</small>
          </span>
          <span class="tr2-group-stats">
            <span><small>보유</small><b>${escapeHtml(formatCount(totals.remaining))}개</b></span>
            <span><small>실현 손익</small><b class="${moneyClass(totals.realized)}">${escapeHtml(signedMoney(totals.realized))}</b></span>
          </span>
          <i class="tr2-chevron" aria-hidden="true"></i>
        </button>
        ${first.item_id ? "" : `<p class="tr2-group-link">${linkButton(group.key, group.lots.length)}<small>별명으로 적었으면 도감에서 찾아 이어 주세요.</small></p>`}
        <div class="tr2-lots" ${open ? "" : "hidden"}>${group.lots.map((row, index) => lotCard(row, chips[index], { equipment, inGroup: true, index })).join("")}</div>
      </section>
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
      list.innerHTML = `<div class="tr2-empty"><span aria-hidden="true">📒</span><strong>아직 기록한 거래가 없어요</strong><p>오른쪽에서 아이템을 고르고 산 가격과 개수를 적어 보세요.</p></div>`;
      return;
    }
    if (!visible.length) {
      list.innerHTML = `<p class="empty">이 조건에 맞는 거래가 없습니다.</p>`;
      return;
    }
    // 선택한 거래가 든 묶음은 펼쳐 둔다.
    const selected = rows.find((row) => row.id === selectedId);
    if (selected) openGroups.add(tradeGroupKey(selected));
    const groups = groupTrades(sortedTrades(visible));
    list.innerHTML = `<div class="trade-cards tr2-groups">${groups.map(groupCard).join("")}</div>`;
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
        item_id: row.item_id ?? null, item_snapshot: row.item_snapshot ?? {}, item_options: row.item_options ?? {},
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

  // remember: 마지막 저장 취소에 남길지. restoreTimes: 도감 연결처럼 가격이 안 바뀌는 변경은 등록·수정 시각을 그대로 둔다.
  // merge: false면 같은 거래가 있어도 합치지 않는다(화면을 열 때 하는 자동 연결 — 조회 중 자동 합산은 하지 않는다, docs/domain.md 2026-10-21).
  async function persistTrade(id, value, { remember = true, restoreTimes = false, merge = true } = {}) {
    const supabase = await getSupabase();
    const stored = { ...value, name: tradeName(value.name) };
    const complete = isCompleteTrade(stored);
    const sameLot = !merge || isPartialSell(stored)
      ? null
      : rows.find(
          (row) =>
            row.id !== id &&
            !isPartialSell(row) &&
            isCompleteTrade(row) === complete &&
            tradeItemKey(row) === tradeItemKey(stored),
        );
    const before = [sameLot, id ? rows.find((row) => row.id === id) : null].filter(Boolean).map((row) => ({ ...row }));
    const target = sameLot ?? before[0];
    const after = { ...(target ?? {}), ...(sameLot ? combineLots([sameLot, stored]) : stored), id: target?.id ?? crypto.randomUUID() };
    const { data, error } = await supabase.rpc("replace_my_trades_v2", { expected: before, replacement: [after], ...(restoreTimes ? { restore_times: true } : {}) });
    if (!error && data && remember) {
      lastSave = { ...data, name: stored.name };
      paintUndo();
    }
    return { error, merged: Boolean(sameLot) };
  }

  const savingIds = new Set();

  async function saveInline(input) {
    const row = rows.find((item) => item.id === input.dataset.tradeId);
    if (!row || changing || savingIds.has(row.id)) return;
    changing = true;
    paintUndo();
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
        showStatus(saveError(saved.error), "error");
        restoreTradeInputs(row);
        return;
      }
      if (form.dataset.editingId === row.id) closeForm();
      showStatus(saved.merged ? "이름과 옵션이 같은 거래를 한 줄로 합쳤습니다." : "거래를 수정했습니다.", "info");
      await loadRows();
    } catch (error) {
      showStatus(saveError(error), "error");
      restoreTradeInputs(row);
    } finally {
      savingIds.delete(row.id);
      changing = false;
      paintUndo();
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
    fillTradeItem(row);
    selectedId = row.id || "";
    paintSelection();
    form.elements.name.focus();
    form.scrollIntoView({ block: "nearest" });
  }

  function closeForm() {
    form.hidden = false;
    form.dataset.editingId = "";
    form.reset();
    currentItemSnapshot = {};
    picked = null;
    optionsForced = false;
    showAllOptions = false;
    closeResults();
    paintPicked();
    paintOptions();
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

  function fillTradeItem(row) {
    form.elements.catalog_item.value = row.item_id || "";
    currentItemSnapshot = { ...(row.item_snapshot ?? {}) };
    for (const { key } of itemOptionFields) form.elements[`option_${key}`].value = row.item_options?.[key] ?? "";
    const info = row.item_id ? itemInfo.get(row.item_id) : null;
    picked = row.item_id ? { id: row.item_id, name: row.item_snapshot?.name || row.name, category: row.item_snapshot?.category, base_options: row.item_snapshot?.base_options ?? {}, ranges: {}, ...info } : null;
    optionsForced = false;
    showAllOptions = false;
    closeResults();
    paintPicked();
    paintOptions();
    // 그림·옵션 범위만 더 불러온다(적어 둔 실제 옵션은 덮어쓰지 않는다).
    if (row.item_id) loadPickedDetail(row.item_id, { fill: false });
  }

  function readTradeItem() {
    const parsed = readItemOptions(Object.fromEntries(itemOptionFields.map(({ key }) => [key, form.elements[`option_${key}`].value])));
    if (parsed.error) return parsed;
    return { value: { item_id: form.elements.catalog_item.value || null, item_snapshot: { ...currentItemSnapshot }, item_options: parsed.value } };
  }

  // ── 아이템 고르기: 이름으로 도감 검색(서버 함수, 글자 순서 검색), 고르면 그림·기본 옵션·옵션 범위 ──
  const resultsBox = root.querySelector("[data-item-results]");
  const pickedBox = root.querySelector("[data-item-picked]");
  const optionsBox = root.querySelector("[data-options]");
  const optionsOpen = root.querySelector("[data-options-open]");
  const optionsMore = root.querySelector("[data-options-more]");
  const catalogStatus = root.querySelector("[data-catalog-status]");
  let optionsForced = false;
  let searchTimer = 0;
  let searchId = 0;
  let pickId = 0;

  const pickedIsEquipment = () => Boolean(picked && isEquipment({ category: picked.category }));

  function closeResults() {
    window.clearTimeout(searchTimer);
    searchId += 1;
    resultsBox.hidden = true;
    resultsBox.innerHTML = "";
    form.elements.name.setAttribute("aria-expanded", "false");
    form.elements.name.removeAttribute("aria-activedescendant");
  }

  function resultTags(row) {
    const equipment = isEquipment({ category: row.category });
    return [equipment ? equipmentTypeName(row.subcategory) || "장비" : row.category, row.required_level ? `Lv.${row.required_level}` : ""].filter(Boolean).join(" · ");
  }

  async function runSearch(query) {
    const request = ++searchId;
    if (!query) { closeResults(); return; }
    const out = await catalogRpc("catalog_search_items", { p_query: query, p_page: 0 });
    if (request !== searchId || !root.isConnected || form.elements.name.value.trim() !== query) return;
    const direct = `<button type="button" class="tr2-result is-direct" data-pick-direct role="option" id="trade-item-direct"><span class="tr2-art is-glyph" aria-hidden="true">✎</span><span><strong>‘${escapeHtml(query)}’ 그대로 쓰기</strong><small>도감 연결 없이 이름만 기록</small></span></button>`;
    if (out.error) {
      resultsBox.innerHTML = `<p class="tr2-results-note">${escapeHtml(catalogError(out.error))}</p>${direct}`;
    } else {
      const found = (out.data?.rows ?? []).slice(0, 8);
      resultsBox.innerHTML = found.map((row, index) => `<button type="button" class="tr2-result" data-pick-item="${escapeHtml(row.id)}" role="option" id="trade-item-${index}" style="--i:${index}">
          <span class="tr2-art${row.image_url ? "" : " is-glyph"}" aria-hidden="true">${catalogImage(row.image_url, "tr2-art-img", 32) || escapeHtml([...row.name][0] ?? "?")}</span>
          <span><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(resultTags(row))}</small></span>
        </button>`).join("") + (found.length ? "" : `<p class="tr2-results-note">도감에 없는 이름이에요.</p>`) + direct;
      for (const row of found) if (!itemInfo.has(row.id)) itemInfo.set(row.id, { image_url: row.image_url, category: row.category, subcategory: row.subcategory, required_level: row.required_level });
    }
    resultsBox.hidden = false;
    form.elements.name.setAttribute("aria-expanded", "true");
  }

  function moveActive(step) {
    const options = [...resultsBox.querySelectorAll("[role=option]")];
    if (!options.length) return;
    const current = options.findIndex((option) => option.classList.contains("is-active"));
    const next = (current + step + options.length) % options.length;
    options.forEach((option, index) => option.classList.toggle("is-active", index === next));
    form.elements.name.setAttribute("aria-activedescendant", options[next].id);
    options[next].scrollIntoView({ block: "nearest" });
  }

  function paintPicked() {
    const equipment = pickedIsEquipment();
    pickedBox.hidden = !picked;
    pickedBox.innerHTML = picked
      ? `<span class="tr2-art${picked.image_url ? "" : " is-glyph"}" aria-hidden="true">${catalogImage(picked.image_url, "tr2-art-img", 44) || escapeHtml([...picked.name][0] ?? "?")}</span>
        <span class="tr2-picked-copy"><strong>${escapeHtml(picked.name)}</strong><small>${escapeHtml(resultTags(picked) || "도감 아이템")} · 도감 연결됨</small></span>
        <button type="button" class="text-button" data-unpick>연결 해제</button>`
      : "";
    catalogStatus.textContent = !picked
      ? "도감에서 고르면 그림과 기본 옵션이 붙어요. 없으면 이름만 적어도 돼요."
      : equipment ? "장비예요. 실제로 산 물건의 옵션으로 고쳐 주세요." : "장비가 아니라 옵션 없이 수량만 기록해요.";
  }

  function paintOptions() {
    const values = new Set(itemOptionFields.map(({ key }) => key).filter((key) => form.elements[`option_${key}`].value.trim() !== ""));
    const equipment = pickedIsEquipment();
    const show = equipment || values.size > 0 || optionsForced;
    optionsBox.hidden = !show;
    optionsOpen.hidden = show || Boolean(picked);
    // 이 장비에 있는 옵션(기본값·범위)과 적어 둔 옵션만 먼저 보여 준다. 없으면 전부.
    const relevant = new Set([...Object.keys(picked?.base_options ?? {}), ...Object.keys(picked?.ranges ?? {}), ...values]);
    const all = showAllOptions || relevant.size === 0;
    for (const field of optionsBox.querySelectorAll("[data-option-field]")) {
      const key = field.dataset.optionField;
      field.hidden = !(all || relevant.has(key));
      const range = picked?.ranges?.[key];
      field.querySelector("[data-option-range]").textContent = range ? `${formatCount(range[0])}~${formatCount(range[1])}` : "";
    }
    optionsMore.hidden = all || relevant.size >= itemOptionFields.length;
    optionsMore.setAttribute("aria-expanded", String(all));
  }

  async function loadPickedDetail(id, { fill }) {
    const request = ++pickId;
    const out = await catalogRpc("catalog_item_detail", { p_id: id });
    if (request !== pickId || !root.isConnected || form.elements.catalog_item.value !== id) return null;
    const item = out.data?.item;
    if (out.error || !item) {
      if (fill) notify(out.error ? catalogError(out.error) : "아이템 정보를 찾지 못했어요.", "error");
      return null;
    }
    const ranges = Object.fromEntries((out.data.stats ?? []).filter((row) => row.minimum_value != null && row.maximum_value != null).map((row) => [row.stat_key, [row.minimum_value, row.maximum_value]]));
    const info = { image_url: item.image_url, category: item.category, subcategory: item.subcategory, required_level: item.required_level };
    itemInfo.set(id, info);
    picked = { ...picked, id, name: picked?.name || item.name, base_options: fill ? item.base_options ?? {} : picked?.base_options ?? item.base_options ?? {}, ranges, ...info };
    paintPicked();
    paintOptions();
    return item;
  }

  async function pickItem(id) {
    closeResults();
    const info = itemInfo.get(id) ?? {};
    form.elements.catalog_item.value = id;
    picked = { id, name: resultsName.get(id) ?? form.elements.name.value.trim(), base_options: {}, ranges: {}, ...info };
    paintPicked();
    const item = await loadPickedDetail(id, { fill: true });
    if (!item) {
      form.elements.catalog_item.value = "";
      picked = null;
      paintPicked();
      paintOptions();
      return;
    }
    currentItemSnapshot = itemSnapshot(item);
    form.elements.name.value = item.name;
    picked = { ...picked, name: item.name };
    const equipment = isEquipment(item);
    // 장비면 도감 기본 옵션을 채우고(실제 값은 사용자가 고친다), 장비가 아니면 옵션을 비운다.
    for (const { key } of itemOptionFields) form.elements[`option_${key}`].value = equipment ? item.base_options?.[key] ?? "" : "";
    optionsForced = false;
    showAllOptions = false;
    paintPicked();
    paintOptions();
    sfx("tick");
    if (equipment) {
      optionsBox.classList.remove("is-arrive");
      void optionsBox.offsetWidth;
      optionsBox.classList.add("is-arrive");
    }
    form.elements.buy_price.focus();
  }

  // 검색 결과의 이름(고른 직후 detail 응답 전까지 보여 줄 값)
  const resultsName = new Map();

  // 목록 그림: 화면에 보이는 도감 아이템만 한 번에 읽는다(도감 SQL이 없거나 실패해도 거래는 그대로 보인다).
  async function loadItemInfo() {
    const ids = [...new Set(rows.map((row) => row.item_id).filter((id) => id && !itemInfo.has(id)))];
    if (!ids.length) return;
    const supabase = await getSupabase();
    let changed = false;
    for (let index = 0; index < ids.length; index += 100) {
      const { data, error } = await supabase.from("catalog_items").select("id,image_url,category,subcategory,required_level").in("id", ids.slice(index, index + 100));
      if (error || !root.isConnected) return;
      for (const row of data ?? []) { itemInfo.set(row.id, row); changed = true; }
    }
    if (changed && root.isConnected) { paintList(); paintSelection(); }
  }

  function readForm(mode = "all") {
    if (mode === "sell") {
      const selected = rows.find((row) => row.id === selectedId);
      if (!selected) return { error: "매도할 보유 거래를 목록에서 선택해 주세요." };
      if (tradeName(form.elements.name.value) !== tradeName(selected.name)) return { error: "아이템명이 선택한 거래와 다릅니다. 매도할 거래를 다시 선택해 주세요." };
      const descriptor = readTradeItem();
      if (descriptor.error) return descriptor;
      if (tradeItemKey({ name: selected.name, ...descriptor.value }) !== tradeItemKey(selected)) return { error: "선택한 거래와 옵션이 다릅니다. 거래를 다시 선택하거나 수정으로 옵션을 변경해 주세요." };
      if (remainingOf(selected) <= 0) return { error: "선택한 거래에는 판매할 재고가 없습니다." };
      const sold = readSellFields(form.elements.sell_price.value.trim(), form.elements.sell_qty.value.trim(), remainingOf(selected));
      if (sold.error) return sold;
      if (sold.sellPrice == null || sold.sellQty === 0) return { error: "이번에 판 가격과 개수를 모두 입력해 주세요." };
      const sellQty = selected.sell_qty + sold.sellQty;
      const revenue = BigInt(selected.sell_price ?? 0) * BigInt(selected.sell_qty) + BigInt(sold.sellPrice) * BigInt(sold.sellQty);
      const sellPrice = Number((revenue + BigInt(sellQty) / 2n) / BigInt(sellQty));
      return { value: { item_id: selected.item_id ?? null, item_snapshot: selected.item_snapshot ?? {}, item_options: selected.item_options ?? {}, name: selected.name, buy_price: selected.buy_price, buy_qty: selected.buy_qty, sell_price: sellPrice, sell_qty: sellQty } };
    }
    const descriptor = readTradeItem();
    if (descriptor.error) return descriptor;
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
        ...descriptor.value,
        name,
        buy_price: buyPrice.value,
        buy_qty: buyQty.value,
        sell_price: sold.sellPrice,
        sell_qty: sold.sellQty,
      },
    };
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
      showStatus(catalogError(error), "error");
      return;
    }
    rows = data ?? [];
    if (current !== loadId || !list.isConnected) return;
    paintList();
    paintSelection();
    loadItemInfo();
    autoLinkExact();
  }

  // ── 예전 거래 도감 연결(2026-11-05 사용자 요청) ──
  // 이름이 도감과 완전히 같으면 화면을 열 때 자동으로 잇고, 별명·줄인 이름이면 창에서 찾아 잇는다. 장비면 실제 옵션 칸이 펼쳐진다.
  const linkDialog = root.querySelector("[data-link-dialog]");
  let link = null;
  let linkSearchId = 0;
  let linkPickId = 0;
  let linkTimer = 0;
  let autoLinkTried = false;
  const linkResults = new Map();

  function linkButton(key, count) {
    return `<button type="button" class="tr2-link-open" data-link-open="${escapeHtml(key)}"><i aria-hidden="true">🔗</i>${count > 1 ? `도감 연결 · ${formatCount(count)}건 모두` : "도감 연결"}</button>`;
  }

  async function fetchRows() {
    const supabase = await getSupabase();
    const { data, error } = await supabase.from("trades").select(columns).order("updated_at", { ascending: false });
    return error ? null : data ?? [];
  }

  // 거래를 한 건씩 저장한다(서버 함수가 한 번에 두 줄까지만 받는다). make(row)가 null이면 건너뛴다.
  async function saveLinks(ids, make, { remember = false, restoreTimes = false, merge = true } = {}) {
    changing = true;
    paintUndo();
    let done = 0;
    let merged = 0;
    try {
      for (const id of ids) {
        const row = rows.find((item) => item.id === id);
        const value = row ? make(row) : null;
        if (!value) continue;
        const saved = await persistTrade(row.id, value, { remember, restoreTimes, merge });
        if (saved.error) return { done, merged, failed: saved.error };
        done += 1;
        if (saved.merged) merged += 1;
        const fresh = await fetchRows();
        if (fresh) rows = fresh;
      }
      return { done, merged, failed: null };
    } catch (error) {
      return { done, merged, failed: error };
    } finally {
      // 여러 건을 한꺼번에 바꾸면 "마지막 저장 취소"로 일부만 되돌리게 되므로 취소를 끈다.
      if (!remember && done) lastSave = null;
      changing = false;
      paintUndo();
    }
  }

  async function autoLinkExact() {
    if (autoLinkTried || changing) return;
    autoLinkTried = true;
    const names = unlinkedNames(rows);
    if (!names.length) return;
    const supabase = await getSupabase();
    const items = [];
    for (let index = 0; index < names.length; index += 100) {
      const { data, error } = await supabase.from("catalog_items").select("id,name,category,subcategory,image_url,required_level,base_options,requirements").in("name", names.slice(index, index + 100));
      if (error || !root.isConnected) return;
      items.push(...(data ?? []));
    }
    if (changing || !root.isConnected) return;
    const links = exactLinks(rows, items);
    if (!links.length) return;
    const byTrade = new Map(links.map(({ row, item }) => [row.id, item]));
    for (const { item } of links) itemInfo.set(item.id, { image_url: item.image_url, category: item.category, subcategory: item.subcategory, required_level: item.required_level });
    const result = await saveLinks([...byTrade.keys()], (row) => (row.item_id ? null : linkedTrade(row, byTrade.get(row.id))), { restoreTimes: true, merge: false });
    if (!root.isConnected) return;
    if (result.done) {
      paintList();
      paintSelection();
      showStatus(`이름이 도감과 똑같은 예전 거래 ${formatCount(result.done)}건을 도감 아이템에 연결했어요.`, "info");
    }
    if (result.failed) showStatus(`예전 거래 일부를 도감에 연결하지 못했어요. ${saveError(result.failed)}`, "error");
  }

  const linkLots = () => (link ? rows.filter((row) => link.lotIds.includes(row.id)) : []);
  const linkEl = (selector) => linkDialog.querySelector(selector);

  function openLink(lots, mode) {
    if (!lots.length || changing) return;
    const first = lots[0];
    const many = lots.length > 1;
    link = { lotIds: lots.map((row) => row.id), name: tradeName(first.name), mode, item: null, ranges: {}, showAll: false };
    const options = mode === "options";
    linkDialog.innerHTML = `
      <div class="tr2-link">
        <header class="tr2-link-head">
          <div>
            <p class="trade-kicker">${options ? "ITEM OPTIONS" : "LINK ITEM"}</p>
            <h2 id="trade-link-title">${options ? "실제 옵션 적기" : "도감 아이템 연결"}</h2>
            <p>‘${escapeHtml(link.name)}’ ${many ? `거래 ${formatCount(lots.length)}건` : "거래"} · ${options ? "산 물건에 붙은 옵션을 적으면 옵션이 같은 거래끼리 합쳐요." : "별명이나 줄인 이름이어도 찾아서 이으면 그림·분류가 붙어요."}</p>
          </div>
          <button type="button" class="tr2-link-x" data-link-close aria-label="닫기">×</button>
        </header>
        <div class="tr2-link-search" data-link-search>
          <span class="tr2-search ym-search-wrap"><i class="ym-search-icon" aria-hidden="true"></i><input data-link-query value="${escapeHtml(link.name)}" autocomplete="off" spellcheck="false" placeholder="도감 아이템 이름 · 띄어쓰기·줄임말도 찾아요" aria-label="도감 아이템 찾기" aria-controls="trade-link-results" /></span>
          <div class="tr2-link-results" id="trade-link-results" data-link-results role="listbox" aria-label="도감 아이템"></div>
        </div>
        <div class="tr2-picked tr2-link-picked" data-link-picked hidden></div>
        <label class="tr2-link-rename" data-link-rename-row hidden><input type="checkbox" data-link-rename checked /><span data-link-rename-text></span></label>
        <section class="tr2-options tr2-link-options" data-link-options hidden>
          <header><strong>실제 아이템 옵션</strong><small>산 물건에 붙은 옵션으로 고쳐 주세요. <span data-link-options-source></span></small></header>
          <div class="trade-options-grid">${itemOptionFields.map(({ key, label }) => `<label class="field tr2-option" data-link-option="${key}"><span>${escapeHtml(label)}<em data-link-range="${key}"></em></span><input name="link_option_${key}" inputmode="numeric" autocomplete="off" placeholder="—" /></label>`).join("")}</div>
          <button type="button" class="text-button tr2-more" data-link-more aria-expanded="false">＋ 다른 옵션도 적기</button>
        </section>
        <p class="tr2-link-note" data-link-note hidden></p>
        <p class="tr2-link-error" data-link-error role="alert" hidden></p>
        <div class="button-row tr2-link-actions">
          <button class="primary-button" type="button" data-link-save disabled>${options ? "옵션 저장" : "연결 저장"}</button>
          <button class="secondary-button" type="button" data-link-close>취소</button>
        </div>
      </div>`;
    linkDialog.showModal();
    sfx("tick");
    if (first.item_id) {
      linkPick(first.item_id);
    } else {
      const input = linkEl("[data-link-query]");
      input.focus();
      input.select();
      runLinkSearch(link.name);
    }
  }

  function showLinkError(text) {
    const box = linkEl("[data-link-error]");
    box.hidden = !text;
    box.textContent = text ?? "";
  }

  async function runLinkSearch(query) {
    const request = ++linkSearchId;
    const box = linkEl("[data-link-results]");
    if (!query) { box.innerHTML = `<p class="tr2-results-note">찾을 이름을 적어 주세요.</p>`; return; }
    const out = await catalogRpc("catalog_search_items", { p_query: query, p_page: 0 });
    if (request !== linkSearchId || !link || !linkDialog.open) return;
    if (out.error) { box.innerHTML = `<p class="tr2-results-note">${escapeHtml(catalogError(out.error))}</p>`; return; }
    const found = (out.data?.rows ?? []).slice(0, 8);
    for (const row of found) {
      linkResults.set(row.id, row);
      if (!itemInfo.has(row.id)) itemInfo.set(row.id, { image_url: row.image_url, category: row.category, subcategory: row.subcategory, required_level: row.required_level });
    }
    box.innerHTML = found.length
      ? found.map((row, index) => `<button type="button" class="tr2-result" data-link-pick="${escapeHtml(row.id)}" role="option" style="--i:${index}">
          <span class="tr2-art${row.image_url ? "" : " is-glyph"}" aria-hidden="true">${catalogImage(row.image_url, "tr2-art-img", 32) || escapeHtml([...row.name][0] ?? "?")}</span>
          <span><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(resultTags(row))}</small></span>
        </button>`).join("")
      : `<p class="tr2-results-note">‘${escapeHtml(query)}’와 맞는 도감 아이템이 없어요. 다른 이름이나 줄인 말로 찾아보세요.</p>`;
  }

  async function linkPick(id) {
    const request = ++linkPickId;
    showLinkError("");
    const out = await catalogRpc("catalog_item_detail", { p_id: id });
    if (request !== linkPickId || !link || !linkDialog.open) return;
    const item = out.data?.item;
    if (out.error || !item) {
      showLinkError(out.error ? catalogError(out.error) : "아이템 정보를 찾지 못했어요.");
      if (!link.item) { linkEl("[data-link-search]").hidden = false; runLinkSearch(linkEl("[data-link-query]").value.trim()); }
      return;
    }
    itemInfo.set(id, { image_url: item.image_url, category: item.category, subcategory: item.subcategory, required_level: item.required_level });
    link.item = item;
    link.ranges = Object.fromEntries((out.data.stats ?? []).filter((row) => row.minimum_value != null && row.maximum_value != null).map((row) => [row.stat_key, [row.minimum_value, row.maximum_value]]));
    link.showAll = false;
    paintLink(true);
  }

  function paintLinkOptions() {
    const item = link?.item;
    const values = new Set(itemOptionFields.map(({ key }) => key).filter((key) => linkEl(`[name="link_option_${key}"]`).value.trim() !== ""));
    const relevant = new Set([...Object.keys(item?.base_options ?? {}), ...Object.keys(link?.ranges ?? {}), ...values]);
    const all = link?.showAll || relevant.size === 0;
    for (const field of linkDialog.querySelectorAll("[data-link-option]")) {
      const key = field.dataset.linkOption;
      field.hidden = !(all || relevant.has(key));
      const range = link?.ranges?.[key];
      field.querySelector("[data-link-range]").textContent = range ? `${formatCount(range[0])}~${formatCount(range[1])}` : "";
    }
    const more = linkEl("[data-link-more]");
    more.hidden = all || relevant.size >= itemOptionFields.length;
    more.setAttribute("aria-expanded", String(all));
  }

  function paintLink(arrive = false) {
    const lots = linkLots();
    const item = link.item;
    const equipment = Boolean(item && isEquipment(item));
    const single = lots.length === 1;
    linkEl("[data-link-search]").hidden = Boolean(item);
    const picked = linkEl("[data-link-picked]");
    picked.hidden = !item;
    picked.innerHTML = item
      ? `<span class="tr2-art${item.image_url ? "" : " is-glyph"}" aria-hidden="true">${catalogImage(item.image_url, "tr2-art-img", 44) || escapeHtml([...item.name][0] ?? "?")}</span>
        <span class="tr2-picked-copy"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(resultTags(item) || "도감 아이템")} · ${lots.every((row) => row.item_id === item.id) ? "연결돼 있어요" : "이 아이템에 연결해요"}</small></span>
        <button type="button" class="text-button" data-link-change>다른 아이템</button>`
      : "";
    const differs = Boolean(item) && lots.some((row) => tradeName(row.name) !== tradeName(item.name));
    linkEl("[data-link-rename-row]").hidden = !differs;
    if (differs) linkEl("[data-link-rename-text]").textContent = `거래 이름도 도감 이름 ‘${item.name}’(으)로 바꾸기`;
    const optionsBox = linkEl("[data-link-options]");
    optionsBox.hidden = !(equipment && single);
    if (arrive && equipment && single) {
      // 적어 둔 옵션이 있으면(같은 아이템이거나 아직 연결 전) 그 값을, 없으면 도감 기본값을 채운다.
      const lot = lots[0];
      const own = lot.item_options ?? {};
      const source = Object.keys(own).length && (!lot.item_id || lot.item_id === item.id) ? own : item.base_options ?? {};
      for (const { key } of itemOptionFields) linkEl(`[name="link_option_${key}"]`).value = source[key] ?? "";
      linkEl("[data-link-options-source]").textContent = source === own ? "적어 둔 옵션을 불러왔어요." : "도감 기본값을 미리 채워 뒀어요.";
      optionsBox.classList.remove("is-arrive");
      void optionsBox.offsetWidth;
      optionsBox.classList.add("is-arrive");
    }
    if (equipment && single) paintLinkOptions();
    const note = linkEl("[data-link-note]");
    note.hidden = !item || (equipment && single);
    note.textContent = !item ? "" : equipment
      ? `거래가 ${formatCount(lots.length)}건이라 옵션은 연결한 뒤 거래마다 ‘＋ 옵션 적기’로 따로 적어요.`
      : "장비가 아니라 옵션 없이 수량만 기록해요.";
    linkEl("[data-link-save]").disabled = !item;
    if (arrive && item) (equipment && single ? optionsBox.querySelector(".tr2-option:not([hidden]) input") : linkEl("[data-link-save]"))?.focus();
  }

  async function saveLink() {
    if (!link?.item || changing) return;
    const lots = linkLots();
    if (!lots.length) { linkDialog.close(); return; }
    const item = link.item;
    let options;
    if (isEquipment(item) && lots.length === 1) {
      const parsed = readItemOptions(Object.fromEntries(itemOptionFields.map(({ key }) => [key, linkEl(`[name="link_option_${key}"]`).value])));
      if (parsed.error) { showLinkError(parsed.error); return; }
      options = parsed.value;
    }
    const renameRow = linkEl("[data-link-rename-row]");
    const rename = renameRow.hidden || linkEl("[data-link-rename]").checked;
    const saveButton = linkEl("[data-link-save]");
    saveButton.disabled = true;
    showLinkError("");
    const ids = lots.map((row) => row.id);
    if (ids.includes(selectedId) || ids.includes(form.dataset.editingId)) closeForm();
    const result = await saveLinks(ids, (row) => linkedTrade(row, item, { rename, options }), { remember: ids.length === 1 });
    if (!root.isConnected) return;
    if (result.failed) {
      showLinkError(saveError(result.failed));
      saveButton.disabled = false;
      if (result.done) { paintList(); paintSelection(); }
      return;
    }
    const { mode, name } = link;
    linkDialog.close();
    paintList();
    paintSelection();
    sfx("check");
    // 연결된 거래 카드(묶음이면 묶음 머리)에서 반짝인다.
    const target = list.querySelector(`[data-group="id:${CSS.escape(item.id)}"] .tr2-group-head`)
      ?? [...list.querySelectorAll("[data-select-trade]")].find((node) => rows.find((row) => row.id === node.dataset.selectTrade)?.item_id === item.id);
    if (target) burstAt(target, BURST_COLORS.success, 18, 0.8);
    const merged = result.merged ? " 옵션까지 같은 거래가 있어 한 줄로 합쳤어요." : "";
    showStatus(mode === "options" ? `${item.name} 옵션을 저장했어요.${merged}` : `‘${name}’ 거래 ${formatCount(result.done)}건을 ${item.name}에 연결했어요.${merged}`, "info");
  }

  linkDialog.addEventListener("close", () => {
    window.clearTimeout(linkTimer);
    linkSearchId += 1;
    linkPickId += 1;
    link = null;
  });

  function handleLinkClick(event) {
    if (event.target === linkDialog || event.target.closest("[data-link-close]")) { linkDialog.close(); return; }
    const pick = event.target.closest("[data-link-pick]");
    if (pick) { sfx("tick"); linkPick(pick.dataset.linkPick); return; }
    if (event.target.closest("[data-link-change]")) {
      link.item = null;
      link.ranges = {};
      linkPickId += 1;
      paintLink();
      const input = linkEl("[data-link-query]");
      input.focus();
      input.select();
      runLinkSearch(input.value.trim());
      return;
    }
    if (event.target.closest("[data-link-more]")) { link.showAll = true; paintLinkOptions(); return; }
    if (event.target.closest("[data-link-save]")) saveLink();
  }

  root.addEventListener("input", (event) => {
    if (event.target.closest("[data-link-dialog]")) {
      if (event.target.matches("[data-link-query]")) {
        window.clearTimeout(linkTimer);
        const query = event.target.value.trim();
        linkTimer = window.setTimeout(() => runLinkSearch(query), 180);
      }
      if (event.target.closest("[data-link-option]")) paintLinkOptions();
      return;
    }
    if (event.target === form.elements.name) {
      // 고른 도감 아이템과 이름이 달라지면 연결을 끊는다(직접 입력). 그리고 잠깐 멈추면 도감을 찾는다.
      if (form.elements.name.value.trim() !== currentItemSnapshot.name && form.elements.catalog_item.value) {
        form.elements.catalog_item.value = "";
        currentItemSnapshot = {};
        picked = null;
        pickId += 1;
        paintPicked();
        paintOptions();
      }
      window.clearTimeout(searchTimer);
      const query = form.elements.name.value.trim();
      searchTimer = window.setTimeout(() => runSearch(query), 180);
    }
    if (event.target.closest("[data-option-field]")) paintOptions();
    if (event.target.closest("[data-trade-field]")) applyAmountCommas(event.target);
    if (event.target.closest("[data-search]")) paintList();
  });

  root.addEventListener("change", (event) => {
    if (!event.target.matches("[data-sort]")) return;
    sort = event.target.value;
    paintList();
  });

  root.addEventListener("keydown", (event) => {
    if (event.target.closest?.("[data-link-dialog]") && event.key === "Enter" && !event.isComposing) {
      // 찾기 칸에서 Enter면 첫 결과를 고르고, 옵션 칸에서 Enter면 저장한다.
      if (event.target.matches("[data-link-query]")) { event.preventDefault(); linkEl("[data-link-results] [data-link-pick]")?.click(); return; }
      if (event.target.closest("[data-link-option]")) { event.preventDefault(); saveLink(); return; }
      return;
    }
    if (event.target === form.elements.name && !event.isComposing) {
      const open = !resultsBox.hidden;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!open) return;
        event.preventDefault();
        moveActive(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (event.key === "Escape" && open) { event.preventDefault(); closeResults(); return; }
      if (event.key === "Enter" && open) {
        // 목록을 고르는 중이면 그 항목, 아니면 첫 도감 결과를 고른다(폼 저장은 하지 않는다).
        event.preventDefault();
        const target = resultsBox.querySelector(".is-active") ?? resultsBox.querySelector("[data-pick-item]") ?? resultsBox.querySelector("[data-pick-direct]");
        target?.click();
        return;
      }
    }
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
    if (event.target.closest("[data-link-dialog]")) { handleLinkClick(event); return; }
    const linkOpen = event.target.closest("[data-link-open]");
    if (linkOpen) { openLink(rows.filter((row) => tradeGroupKey(row) === linkOpen.dataset.linkOpen), "link"); return; }
    const optionOpen = event.target.closest("[data-option-open]");
    if (optionOpen) { const row = rows.find((item) => item.id === optionOpen.dataset.optionOpen); if (row) openLink([row], "options"); return; }
    if (!event.target.closest(".tr2-picker")) closeResults();
    const pickButton = event.target.closest("[data-pick-item]");
    if (pickButton) {
      resultsName.set(pickButton.dataset.pickItem, pickButton.querySelector("strong")?.textContent ?? "");
      await pickItem(pickButton.dataset.pickItem);
      return;
    }
    if (event.target.closest("[data-pick-direct]")) { closeResults(); form.elements.buy_price.focus(); return; }
    if (event.target.closest("[data-unpick]")) {
      form.elements.catalog_item.value = "";
      currentItemSnapshot = {};
      picked = null;
      pickId += 1;
      paintPicked();
      paintOptions();
      form.elements.name.focus();
      return;
    }
    if (event.target.closest("[data-options-open]")) { optionsForced = true; showAllOptions = true; paintOptions(); optionsBox.querySelector("input:not([hidden])")?.focus(); return; }
    if (event.target.closest("[data-options-more]")) { showAllOptions = true; paintOptions(); return; }
    const groupToggle = event.target.closest("[data-toggle-group]");
    if (groupToggle) {
      const key = groupToggle.dataset.toggleGroup;
      if (openGroups.has(key)) openGroups.delete(key); else openGroups.add(key);
      sfx("tick");
      const section = groupToggle.closest("[data-group]");
      const open = openGroups.has(key);
      section.classList.toggle("is-open", open);
      groupToggle.setAttribute("aria-expanded", String(open));
      section.querySelector(".tr2-lots").hidden = !open;
      groupToggle.querySelector(".tr2-group-copy small").textContent = open ? "거래마다 다른 옵션을 금색으로 표시했어요." : "눌러서 거래마다 다른 옵션을 비교해요.";
      return;
    }
    if (event.target.closest("[data-undo-save]")) { await undoSave(); return; }
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
        fillTradeItem(selected);
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
    if (!deleteButton || changing) return;
    const row = rows.find((item) => item.id === deleteButton.dataset.delete);
    if (!row) return;
    if (!window.confirm(`${row.name} 거래를 삭제할까요? 삭제한 내용은 되돌릴 수 없습니다.`)) return;
    changing = true;
    paintUndo();
    deleteButton.disabled = true;
    try {
      const supabase = await getSupabase();
      const { error } = await supabase.from("trades").delete().eq("id", row.id);
      if (error) { showStatus(translateDbError(error), "error"); return; }
      if (form.dataset.editingId === row.id) closeForm();
      lastSave = null;
      showStatus("거래를 삭제했습니다.", "info");
      await loadRows();
    } catch (error) { showStatus(translateDbError(error), "error"); }
    finally { changing = false; deleteButton.disabled = false; paintUndo(); }
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
    if (formSaving || changing) return;
    const parsed = readForm(mode);
    if (parsed.error) {
      showStatus(parsed.error, "error");
      return;
    }
    formSaving = true;
    changing = true;
    paintUndo();
    const buttons = [...form.querySelectorAll("button")];
    buttons.forEach((button) => button.disabled = true);
    try {
      showStatus("저장하는 중입니다.", "info");
      const id = mode === "buy" ? "" : mode === "sell" ? selectedId : form.dataset.editingId;
      const saved = await persistTrade(id, parsed.value);
      if (saved.error) {
        showStatus(saveError(saved.error), "error");
        return;
      }
      form.dataset.editingId = "";
      title.textContent = "거래 추가";
      cheer(mode, parsed.value);
      showStatus(
        saved.merged ? "이름과 옵션이 같은 거래를 한 줄로 합쳤습니다." : mode === "sell" ? "이번 판매분을 저장했습니다." : id ? "거래를 수정했습니다." : "거래를 저장했습니다.",
        "info",
      );
      await loadRows();
    } catch (error) {
      showStatus(translateDbError(error), "error");
    } finally {
      formSaving = false;
      buttons.forEach((button) => button.disabled = false);
      changing = false;
      paintUndo();
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveForm();
  });

  paintPicked();
  paintOptions();
  await loadRows();
}
