import { escapeHtml, formatCount, readBig } from "../format.js";
import { ENHANCE_SCROLLS, WEAPON_TYPES, effectiveEnhancementPrices, fairEnhancementPrices, optimizeEnhancement, reachableFinalAttacks } from "../enhance-calc.js";
import { translateDbError } from "../db-error.js";
import { getSupabase } from "../supabase-client.js";
import { notify } from "../toast.js";

const MAX_ENHANCE_PROFILES = 5;

function readAttack(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : null;
}

function readMeso(value) {
  const parsed = readBig(value, "금액", 0n);
  return parsed.error ? null : parsed.value;
}

function priceReading(value) {
  const amount = readMeso(value);
  if (amount == null) return "금액을 입력해 주세요";
  if (amount === 0n) return "0메소";
  const units = ["", "만", "억", "조", "경", "해", "자", "양", "구", "간"];
  const parts = [];
  let rest = amount;
  for (let index = 0; rest > 0n; index += 1) {
    const chunk = rest % 10_000n;
    if (chunk) parts.unshift(`${formatCount(chunk)}${units[index]}`);
    rest /= 10_000n;
  }
  return `${parts.join(" ")}메소`;
}

function chanceText(numerator, denominator, precise = false) {
  const percent = (Number(numerator) / Number(denominator)) * 100;
  if (precise) {
    const text = percent === 0 || percent >= 0.000001
      ? percent.toFixed(6).replace(/\.?0+$/, "")
      : percent.toPrecision(4);
    return `${text}%`;
  }
  if (percent >= 10) return `${percent.toFixed(1)}%`;
  if (percent >= 0.1) return `${percent.toFixed(2)}%`;
  return `${percent.toPrecision(2)}%`;
}

function decimalHundredths(value) {
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}

function signedMeso(value) {
  return `${value > 0n ? "+" : ""}${formatCount(value)}메소`;
}

function ratioText(profit, spend) {
  if (spend === 0n) return "-";
  const hundredths = (profit * 10_000n) / spend;
  const absolute = hundredths < 0n ? -hundredths : hundredths;
  return `${hundredths > 0n ? "+" : hundredths < 0n ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}%`;
}

function actionLabel(action) {
  if (action === "ten") return "10% 주문서 사용";
  if (action === "sixty") return "60% 주문서 사용";
  return "강화 중단 후 상점 판매";
}

function actionClass(action) {
  return action === "ten" ? "is-ten" : action === "sixty" ? "is-sixty" : "is-stop";
}

function sortByProfit(rows) {
  return [...rows].sort((left, right) => left.expectedProfit === right.expectedProfit ? left.expectedSpend < right.expectedSpend ? -1 : 1 : left.expectedProfit > right.expectedProfit ? -1 : 1);
}

function sortByRoi(rows) {
  return [...rows].sort((left, right) => {
    const leftValue = left.expectedProfit * right.expectedSpend;
    const rightValue = right.expectedProfit * left.expectedSpend;
    if (leftValue === rightValue) return left.expectedSpend < right.expectedSpend ? -1 : 1;
    return leftValue > rightValue ? -1 : 1;
  });
}

let weaponRowId = 0;

export async function render(root) {
  const state = {
    weaponType: "normal",
    centerAttack: "",
    shopPrice: "",
    scrollPrices: { ten: "", sixty: "" },
    weapons: [{ id: ++weaponRowId, attack: "", price: "" }],
    marketPrices: {},
  };
  let profiles = [];
  let activeProfileId = null;
  let activeSortOrder = 0;
  let profileName = "";
  let profileDirty = false;
  let profileSaving = false;
  let profileLoadId = 0;
  let focusedMarketAttack = null;
  let marketScrollTarget = null;

  root.innerHTML = `
    <div class="enhance-page enhance-optimizer-page">
      <header class="page-header enhance-hero">
        <div><span class="enhance-eyebrow">OPTIMAL ENCHANT LAB</span><h1>강화 계산</h1><p>성공과 실패 이후의 행동까지 계산해 가장 이득인 강화 전략을 찾습니다.</p></div>
        <div class="enhance-hero-orb" aria-hidden="true"><span>BEST<br />ROUTE</span></div>
      </header>
      <section class="enhance-profile-vault" aria-labelledby="enhance-profile-title">
        <div class="enhance-profile-head"><div><span>SAVED ITEMS</span><h2 id="enhance-profile-title">내 강화 아이템</h2></div><small>계정별로 최대 ${MAX_ENHANCE_PROFILES}개까지 바로 불러옵니다.</small></div>
        <div class="enhance-profile-slots" data-profile-slots><span class="enhance-profile-loading">저장한 아이템을 불러오는 중입니다.</span></div>
        <div class="enhance-profile-editor">
          <label><span>아이템 이름</span><input type="text" maxlength="60" data-profile-name placeholder="예: 리버스 니플하임" autocomplete="off" /></label>
          <span class="enhance-profile-status" data-profile-status>새 아이템</span>
          <button type="button" class="enhance-profile-delete" data-delete-profile hidden>삭제</button>
          <button type="button" class="enhance-profile-save" data-save-profile>현재 설정 저장</button>
        </div>
      </section>
      <section class="trade-board" aria-labelledby="enhance-rule-title">
        <div class="enhance-section-head">
          <div><span>STEP 1</span><h2 id="enhance-rule-title">강화 규칙과 비용</h2></div>
          <div class="enhance-weapon-types" role="group" aria-label="무기 종류">
            ${Object.values(WEAPON_TYPES).map((weapon) => `<button type="button" data-weapon-type="${weapon.id}" class="${weapon.id === state.weaponType ? "is-on" : ""}" aria-pressed="${weapon.id === state.weaponType}">${escapeHtml(weapon.label)} <small>${weapon.slots}회</small></button>`).join("")}
          </div>
        </div>
        <div class="enhance-input-grid is-three">
          <label class="enhance-field"><span>상점 판매가</span><input type="text" inputmode="numeric" pattern="[0-9]*" data-global-price="shop" placeholder="강화 중단 시 회수 금액" autocomplete="off" /><small data-global-reading="shop">강화 중단 시 회수하는 가격</small></label>
          <label class="enhance-field is-ten"><span>10% 주문서 시세</span><input type="text" inputmode="numeric" pattern="[0-9]*" data-global-price="ten" placeholder="1장 가격" autocomplete="off" /><small data-global-reading="ten">성공 시 공격력 +5</small></label>
          <label class="enhance-field is-sixty"><span>60% 주문서 시세</span><input type="text" inputmode="numeric" pattern="[0-9]*" data-global-price="sixty" placeholder="1장 가격" autocomplete="off" /><small data-global-reading="sixty">성공 시 공격력 +2</small></label>
        </div>
        <p class="enhance-rule"><strong>자동 의사결정</strong><span>각 단계에서 10% 사용 · 60% 사용 · 상점 판매 중 기대 회수액이 가장 높은 행동을 선택합니다.</span></p>
      </section>
      <section class="trade-board enhance-weapon-book" aria-labelledby="enhance-weapon-title">
        <div class="enhance-section-head">
          <div><span>STEP 2</span><h2 id="enhance-weapon-title">노작 무기 시세</h2></div>
          <div class="enhance-range-maker"><input type="text" inputmode="numeric" pattern="[0-9]*" data-center-attack placeholder="기준 공격력" aria-label="기준 공격력" /><button type="button" data-generate-range>−5부터 +5 생성</button><button type="button" data-add-weapon>직접 추가</button></div>
        </div>
        <p class="enhance-book-help">같은 무기의 공격력별 구매가를 입력하세요. 비어 있는 행은 계산에서 제외됩니다.</p>
        <div class="enhance-base-list" data-base-weapons></div>
      </section>
      <section class="trade-board" aria-labelledby="enhance-market-title">
        <div class="enhance-section-head"><div><span>STEP 3</span><h2 id="enhance-market-title">완성 공격력별 경매장 시세</h2></div><small>시세를 입력하면 시장가로 계산합니다.<br />제작 근거는 카드에서 펼쳐보세요.</small></div>
        <div data-enhance-market></div>
      </section>
      <section class="enhance-ranking" data-enhance-ranking></section>
    </div>
  `;

  const weaponList = root.querySelector("[data-base-weapons]");
  const marketRoot = root.querySelector("[data-enhance-market]");
  const rankingRoot = root.querySelector("[data-enhance-ranking]");
  const profileSlots = root.querySelector("[data-profile-slots]");
  const profileNameInput = root.querySelector("[data-profile-name]");
  const profileStatus = root.querySelector("[data-profile-status]");
  const profileSaveButton = root.querySelector("[data-save-profile]");
  const profileDeleteButton = root.querySelector("[data-delete-profile]");

  function profileSnapshot() {
    return {
      schemaVersion: 1,
      weaponType: state.weaponType,
      centerAttack: state.centerAttack,
      shopPrice: state.shopPrice,
      scrollPrices: { ...state.scrollPrices },
      weapons: state.weapons.map((weapon) => ({ attack: String(weapon.attack ?? ""), price: String(weapon.price ?? "") })),
      marketPrices: Object.fromEntries(Object.entries(state.marketPrices).map(([attack, value]) => [String(attack), String(value ?? "")])),
    };
  }

  function resetCalculation() {
    state.weaponType = "normal";
    state.centerAttack = "";
    state.shopPrice = "";
    state.scrollPrices = { ten: "", sixty: "" };
    state.weapons = [{ id: ++weaponRowId, attack: "", price: "" }];
    state.marketPrices = {};
  }

  function applyProfileSettings(settings) {
    const source = settings && typeof settings === "object" ? settings : {};
    state.weaponType = WEAPON_TYPES[source.weaponType] ? source.weaponType : "normal";
    state.centerAttack = String(source.centerAttack ?? "");
    state.shopPrice = String(source.shopPrice ?? "");
    state.scrollPrices = {
      ten: String(source.scrollPrices?.ten ?? ""),
      sixty: String(source.scrollPrices?.sixty ?? ""),
    };
    state.weapons = Array.isArray(source.weapons) && source.weapons.length
      ? source.weapons.map((weapon) => ({ id: ++weaponRowId, attack: String(weapon?.attack ?? ""), price: String(weapon?.price ?? "") }))
      : [{ id: ++weaponRowId, attack: "", price: "" }];
    state.marketPrices = source.marketPrices && typeof source.marketPrices === "object"
      ? Object.fromEntries(Object.entries(source.marketPrices).map(([attack, value]) => [String(attack), String(value ?? "")]))
      : {};
  }

  function syncStaticInputs() {
    root.querySelector("[data-center-attack]").value = state.centerAttack;
    root.querySelector("[data-global-price='shop']").value = state.shopPrice;
    root.querySelector("[data-global-price='ten']").value = state.scrollPrices.ten;
    root.querySelector("[data-global-price='sixty']").value = state.scrollPrices.sixty;
    root.querySelector("[data-global-reading='shop']").textContent = state.shopPrice ? priceReading(state.shopPrice) : "강화 중단 시 회수하는 가격";
    root.querySelector("[data-global-reading='ten']").textContent = state.scrollPrices.ten ? priceReading(state.scrollPrices.ten) : "성공 시 공격력 +5";
    root.querySelector("[data-global-reading='sixty']").textContent = state.scrollPrices.sixty ? priceReading(state.scrollPrices.sixty) : "성공 시 공격력 +2";
  }

  function paintProfileControls() {
    profileNameInput.value = profileName;
    profileDeleteButton.hidden = !activeProfileId;
    profileSaveButton.disabled = profileSaving;
    profileSaveButton.textContent = profileSaving ? "저장 중" : activeProfileId ? "변경 내용 저장" : "아이템 등록";
    profileStatus.textContent = profileSaving ? "저장 중" : profileDirty ? "저장 필요" : activeProfileId ? "저장됨" : "새 아이템";
    profileStatus.classList.toggle("is-dirty", profileDirty);
  }

  function paintProfileSlots() {
    const visible = profiles.slice(0, MAX_ENHANCE_PROFILES);
    profileSlots.innerHTML = Array.from({ length: MAX_ENHANCE_PROFILES }, (_, index) => {
      const profile = visible[index];
      if (!profile) return `<button type="button" class="enhance-profile-slot is-empty" data-new-profile="${index}"><span>+</span><small>빈 슬롯 ${index + 1}</small></button>`;
      const active = profile.id === activeProfileId;
      const weapon = WEAPON_TYPES[profile.settings?.weaponType] ?? WEAPON_TYPES.normal;
      return `<button type="button" class="enhance-profile-slot${active ? " is-active" : ""}" data-profile-id="${escapeHtml(profile.id)}" aria-pressed="${active}"><span>${index + 1}</span><strong>${escapeHtml(profile.name)}</strong><small>${escapeHtml(weapon.label)} · ${weapon.slots}회</small></button>`;
    }).join("");
  }

  function markProfileDirty() {
    if (profileSaving) return;
    profileDirty = true;
    profileStatus.textContent = "저장 필요";
    profileStatus.classList.add("is-dirty");
  }

  function selectProfile(profile) {
    focusedMarketAttack = null;
    activeProfileId = profile?.id ?? null;
    activeSortOrder = profile?.sort_order ?? profiles.length;
    profileName = profile?.name ?? "";
    if (profile) applyProfileSettings(profile.settings);
    else resetCalculation();
    profileDirty = removeLowMarketPrices() > 0;
    syncStaticInputs();
    paintWeapons();
    paintResults();
    paintProfileSlots();
    paintProfileControls();
  }

  async function loadProfiles(selectId = activeProfileId) {
    const current = ++profileLoadId;
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("enhance_profiles")
      .select("id, name, sort_order, settings, created_at, updated_at")
      .order("sort_order", { ascending: true })
      .order("updated_at", { ascending: false });
    if (current !== profileLoadId || !root.isConnected) return;
    if (error) {
      profiles = [];
      paintProfileSlots();
      notify(translateDbError(error), "error");
      return;
    }
    profiles = data ?? [];
    if (profileDirty && !selectId) {
      paintProfileSlots();
      paintProfileControls();
      return;
    }
    const selected = profiles.find((profile) => profile.id === selectId) ?? profiles[0] ?? null;
    if (selected) selectProfile(selected);
    else {
      paintProfileSlots();
      paintProfileControls();
    }
  }

  async function saveProfile() {
    if (profileSaving) return;
    const name = profileName.trim();
    if (!name) {
      notify("아이템 이름을 입력해 주세요.", "error");
      profileNameInput.focus();
      return;
    }
    if (!activeProfileId && profiles.length >= MAX_ENHANCE_PROFILES) {
      notify(`아이템은 현재 ${MAX_ENHANCE_PROFILES}개까지 등록할 수 있습니다.`, "error");
      return;
    }
    removeLowMarketPrices();
    profileSaving = true;
    paintProfileControls();
    const supabase = await getSupabase();
    const payload = { name, sort_order: activeSortOrder, settings: profileSnapshot() };
    const query = activeProfileId
      ? supabase.from("enhance_profiles").update(payload).eq("id", activeProfileId).select("id").single()
      : supabase.from("enhance_profiles").insert(payload).select("id").single();
    const { data, error } = await query;
    if (!root.isConnected) return;
    profileSaving = false;
    if (error) {
      paintProfileControls();
      notify(translateDbError(error), "error");
      return;
    }
    profileDirty = false;
    notify(activeProfileId ? "강화 아이템 설정을 저장했습니다." : "강화 아이템을 등록했습니다.");
    await loadProfiles(data.id);
  }

  async function deleteProfile() {
    if (!activeProfileId || profileSaving) return;
    if (!window.confirm(`${profileName || "이 아이템"} 강화 설정을 삭제할까요?`)) return;
    profileSaving = true;
    paintProfileControls();
    const supabase = await getSupabase();
    const { error } = await supabase.from("enhance_profiles").delete().eq("id", activeProfileId);
    if (!root.isConnected) return;
    profileSaving = false;
    if (error) {
      paintProfileControls();
      notify(translateDbError(error), "error");
      return;
    }
    activeProfileId = null;
    profileName = "";
    notify("강화 아이템 설정을 삭제했습니다.");
    await loadProfiles(null);
    if (!profiles.length) selectProfile(null);
  }

  function validWeapons() {
    return state.weapons
      .map((weapon) => ({ id: weapon.id, attack: readAttack(weapon.attack), price: readMeso(weapon.price) }))
      .filter((weapon) => weapon.attack != null && weapon.price != null);
  }

  function globalValues() {
    const shopPrice = readMeso(state.shopPrice);
    return {
      shopPrice,
      scrollPrices: { ten: readMeso(state.scrollPrices.ten), sixty: readMeso(state.scrollPrices.sixty) },
      marketPrices: Object.fromEntries(Object.entries(state.marketPrices).map(([attack, value]) => {
        const price = readMeso(value);
        return [attack, price != null && shopPrice != null && price > shopPrice ? price : null];
      })),
    };
  }

  function removeLowMarketPrices() {
    const shopPrice = readMeso(state.shopPrice);
    if (shopPrice == null) return 0;
    let removed = 0;
    for (const [attack, value] of Object.entries(state.marketPrices)) {
      const price = readMeso(value);
      if (price != null && price <= shopPrice) {
        delete state.marketPrices[attack];
        removed += 1;
      }
    }
    return removed;
  }

  function priceModel() {
    const weapons = validWeapons();
    const globals = globalValues();
    const fair = fairEnhancementPrices({ weapons, slots: WEAPON_TYPES[state.weaponType].slots, ...globals });
    return { weapons, globals, fair, ...effectiveEnhancementPrices({ fairPrices: fair, marketPrices: globals.marketPrices, shopPrice: globals.shopPrice }) };
  }

  function paintWeaponTypes() {
    for (const button of root.querySelectorAll("[data-weapon-type]")) {
      const on = button.dataset.weaponType === state.weaponType;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-pressed", String(on));
    }
  }

  function paintWeapons() {
    const ordered = [...state.weapons].sort((left, right) => (readAttack(left.attack) ?? Number.MAX_SAFE_INTEGER) - (readAttack(right.attack) ?? Number.MAX_SAFE_INTEGER));
    weaponList.innerHTML = ordered.map((weapon, index) => `
      <article class="enhance-base-card" data-weapon-row="${weapon.id}" style="--i:${index}">
        <span class="enhance-base-rank">${String(index + 1).padStart(2, "0")}</span>
        <label class="enhance-base-attack"><span>노작 공격력 ${escapeHtml(weapon.attack || "입력")}</span><input type="text" inputmode="numeric" pattern="[0-9]*" data-base-attack value="${escapeHtml(weapon.attack)}" placeholder="공격력" aria-label="${index + 1}번 노작 무기 공격력" /></label>
        <label class="enhance-base-price"><span>구매 가격</span><input type="text" inputmode="numeric" pattern="[0-9]*" data-base-price value="${escapeHtml(weapon.price)}" placeholder="메소" aria-label="공격력 ${escapeHtml(weapon.attack || "미입력")} 노작 무기 구매 가격" /><small>${weapon.price ? escapeHtml(priceReading(weapon.price)) : "시세 미입력"}</small></label>
        <button type="button" data-remove-weapon aria-label="노작 무기 행 삭제">×</button>
      </article>
    `).join("");
  }

  function paintMarket() {
    const weapons = validWeapons();
    if (!weapons.length) {
      marketRoot.innerHTML = `<div class="enhance-empty"><span aria-hidden="true">⚔</span><strong>노작 무기 공격력과 가격을 입력해 주세요.</strong><small>가능한 완성 공격력이 자동으로 생성됩니다.</small></div>`;
      return;
    }
    const attacks = reachableFinalAttacks(weapons.map((weapon) => weapon.attack), WEAPON_TYPES[state.weaponType].slots);
    const { globals, fair, effective, firstMarketAttack } = priceModel();
    const expanded = new Set([...marketRoot.querySelectorAll(".enhance-market-card details[open]")].map((details) => Number(details.closest("[data-price-card]").dataset.priceCard)));
    if (!attacks.includes(focusedMarketAttack)) focusedMarketAttack = attacks.includes(firstMarketAttack) ? firstMarketAttack : attacks[0];
    marketRoot.innerHTML = `<div class="enhance-market-toolbar"><div><strong>확인할 공격력을 선택하세요</strong><small>카드를 옆으로 넘겨 시세를 비교할 수 있습니다.</small></div><label>공격력 바로가기<select data-market-jump aria-label="확인할 완성 공격력">${attacks.map((attack) => `<option value="${attack}"${attack === focusedMarketAttack ? " selected" : ""}>공 ${attack}</option>`).join("")}</select></label><div class="enhance-market-arrows"><button type="button" data-market-step="-1" aria-label="이전 공격력">‹</button><button type="button" data-market-step="1" aria-label="다음 공격력">›</button></div></div>
      <div class="enhance-attack-rail" aria-label="완성 공격력 선택">${attacks.map((attack) => `<button type="button" data-focus-market="${attack}" aria-pressed="${attack === focusedMarketAttack}" class="${globals.marketPrices[String(attack)] != null ? "has-market" : ""}"><small>공</small><b>${attack}</b><i aria-hidden="true"></i></button>`).join("")}</div>
      <div class="enhance-market-grid enhance-market-track" tabindex="0" aria-label="완성 공격력별 시세 카드, 좌우 방향키로 이동">${attacks.map((attack) => {
      const value = state.marketPrices[String(attack)] ?? "";
      const market = globals.marketPrices[String(attack)];
      const shopOnly = firstMarketAttack != null && attack < firstMarketAttack;
      const basis = fair.get(attack);
      const estimate = basis?.price ?? null;
      const difference = market != null && estimate != null ? market - estimate : null;
      const comparison = difference == null ? "" : `<div class="enhance-market-diff${difference >= 0n ? " is-gain" : " is-loss"}"><span>획득 비용 대비 시장가</span><strong>${escapeHtml(signedMeso(difference))}</strong><small>${escapeHtml(ratioText(difference, estimate))}</small></div>`;
      const applied = effective[String(attack)] ?? null;
      const status = market != null ? "시장가 적용" : shopOnly ? "상점 판매" : estimate != null ? "획득 비용 추정" : "계산 대기";
      const basisPanel = !shopOnly && basis ? `<details${expanded.has(attack) ? " open" : ""}><summary>제작 확률 · 비용 자세히</summary><div class="enhance-market-recipe"><span>최저 비용 출발 무기 <b>노작 공 ${basis.baseAttack}</b></span><div class="enhance-scroll-recipe"><span>10% <b>${basis.tenCount}장</b></span><span>60% <b>${basis.sixtyCount}장</b></span></div><div class="enhance-market-chance"><span>공 ${attack} 이상 획득 확률<b>${chanceText(basis.successNumerator, basis.denominator, true)}</b></span></div><span>1회 제작비 <b>${escapeHtml(priceReading(basis.investment))}</b></span><span>미달 결과 평균 회수 <b>${escapeHtml(priceReading(basis.expectedFailureRecovery))}</b></span><small>평균 획득 비용은 위의 이상 확률로 계산합니다. 더 높은 공격력도 성공에 포함합니다.</small></div></details>` : "";
      return `<article class="enhance-market-card${market != null ? " has-price" : ""}${shopOnly ? " is-shop" : ""}" data-price-card="${attack}" aria-labelledby="enhance-price-title-${attack}"><header><span class="enhance-market-emblem" aria-hidden="true">⚔</span><div><small>완성 공격력</small><h3 id="enhance-price-title-${attack}">공 <b>${attack}</b></h3></div><span class="enhance-market-status" data-market-status>${status}</span></header><div class="enhance-market-price"><span>계산에 적용하는 가격</span><strong>${escapeHtml(applied == null ? "입력 대기" : priceReading(applied))}</strong></div><p class="enhance-market-reference">${shopOnly ? "첫 경매장 시세보다 낮아 상점가로 계산합니다." : estimate == null ? "무기와 주문서 가격을 입력해 주세요." : `공 ${attack} 이상 평균 획득 비용 <b>${escapeHtml(priceReading(estimate))}</b>`}</p><label class="enhance-market-input"><span>경매장 시세 <small>메소</small></span><input type="text" inputmode="numeric" pattern="[0-9]*" data-market-attack="${attack}" aria-label="공 ${attack} 경매장 시세" value="${escapeHtml(value)}" placeholder="시세를 직접 입력하세요" autocomplete="off" /></label><em data-market-reading>${escapeHtml(market != null ? priceReading(value) : "시세 입력 시 이 가격으로 계산합니다.")}</em>${comparison}${basisPanel}</article>`;
    }).join("")}</div>`;
    focusMarketAttack(focusedMarketAttack, false);
    const track = marketRoot.querySelector(".enhance-market-track");
    for (const event of ["wheel", "touchstart", "pointerdown"]) track.addEventListener(event, () => { marketScrollTarget = null; }, { passive: true });
    track.addEventListener("scroll", () => {
      const selected = marketRoot.querySelector(".enhance-market-card.is-selected");
      if (!selected) return;
      const bounds = track.getBoundingClientRect();
      const position = selected.getBoundingClientRect();
      const visible = position.right > bounds.left + 8 && position.left < bounds.right - 8;
      if (marketScrollTarget != null) {
        if (!visible) return;
        marketScrollTarget = null;
      }
      if (visible) return;
      const cards = [...track.querySelectorAll("[data-price-card]")];
      const nearest = cards.reduce((best, card) => Math.abs(card.getBoundingClientRect().left - bounds.left) < Math.abs(best.getBoundingClientRect().left - bounds.left) ? card : best);
      focusedMarketAttack = Number(nearest.dataset.priceCard);
      syncMarketFocus();
    }, { passive: true });
  }

  function syncMarketFocus() {
    for (const button of marketRoot.querySelectorAll("[data-focus-market]")) button.setAttribute("aria-pressed", String(Number(button.dataset.focusMarket) === focusedMarketAttack));
    for (const card of marketRoot.querySelectorAll("[data-price-card]")) {
      const selected = Number(card.dataset.priceCard) === focusedMarketAttack;
      card.classList.toggle("is-selected", selected);
      if (!selected) card.querySelector("details")?.removeAttribute("open");
    }
    const jump = marketRoot.querySelector("[data-market-jump]");
    if (jump) jump.value = String(focusedMarketAttack);
  }

  function focusMarketAttack(attack, smooth = true) {
    const card = marketRoot.querySelector(`[data-price-card="${attack}"]`);
    const track = marketRoot.querySelector(".enhance-market-track");
    if (!card || !track) return;
    focusedMarketAttack = attack;
    marketScrollTarget = attack;
    syncMarketFocus();
    const behavior = smooth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "instant";
    track.scrollTo({ left: card.offsetLeft - 8, behavior });
    const rail = marketRoot.querySelector(".enhance-attack-rail");
    const button = marketRoot.querySelector(`[data-focus-market="${attack}"]`);
    if (rail && button) rail.scrollTo({ left: button.offsetLeft - rail.clientWidth / 2 + button.clientWidth / 2, behavior });
  }

  function routeCard(result, rank, mode) {
    const topOutcomes = [...result.outcomes].sort((left, right) => left.probabilityNumerator > right.probabilityNumerator ? -1 : 1).slice(0, 4);
    return `
      <article class="enhance-route-card rank-${rank}">
        <header><span class="enhance-medal">${rank}</span><div><small>${mode === "profit" ? "기대 이익 순위" : "수익률 순위"}</small><h3>공격력 ${result.baseAttack} 노작</h3></div><b>${formatCount(result.basePrice)}메소</b></header>
        <div class="enhance-route-first ${actionClass(result.root.action)}"><span>첫 행동</span><strong>${actionLabel(result.root.action)}</strong></div>
        <div class="enhance-route-kpis">
          <p><span>기대 이익</span><b class="${result.expectedProfit >= 0n ? "is-gain" : "is-loss"}">${signedMeso(result.expectedProfit)}</b></p>
          <p><span>기대 수익률</span><b>${ratioText(result.expectedProfit, result.expectedSpend)}</b></p>
          <p><span>평균 총투입</span><b>${formatCount(result.expectedSpend)}메소</b></p>
          <p><span>평균 회수액</span><b>${formatCount(result.expectedSale)}메소</b></p>
        </div>
        <div class="enhance-route-usage"><span>10% 평균 <b>${decimalHundredths(result.expectedUsageHundredths.ten)}장</b></span><span>60% 평균 <b>${decimalHundredths(result.expectedUsageHundredths.sixty)}장</b></span><span>중도 판매 <b>${chanceText(result.earlyStopNumerator, result.denominator)}</b></span></div>
        <div class="enhance-route-outcomes">${topOutcomes.map((outcome) => `<span><b>공 ${outcome.attack}</b><small>${outcome.remaining ? `${outcome.remaining}회 남기고 상점` : outcome.saleType === "market" ? "경매장 판매" : outcome.saleType === "estimate" ? "획득 비용 추정" : "상점 판매"}</small><em>${chanceText(outcome.probabilityNumerator, outcome.denominator)}</em></span>`).join("")}</div>
        <details><summary>상태별 최적 행동 보기</summary><div class="enhance-policy-list">${result.policy.map((node) => `<div><span>공격력 <b>${node.attack}</b> · ${node.remaining}회 남음</span><strong class="${actionClass(node.action)}">${actionLabel(node.action)}</strong></div>`).join("")}</div></details>
      </article>
    `;
  }

  function paintRanking() {
    const { weapons, globals, effective, estimatedPrices } = priceModel();
    if (!weapons.length || globals.shopPrice == null || globals.scrollPrices.ten == null || globals.scrollPrices.sixty == null) {
      rankingRoot.innerHTML = `<div class="enhance-result-lock"><span aria-hidden="true">✦</span><strong>상점가·주문서 시세·노작 무기 시세를 입력하면 최적 경로를 계산합니다.</strong></div>`;
      return;
    }
    const slots = WEAPON_TYPES[state.weaponType].slots;
    const results = weapons.map((weapon) => optimizeEnhancement({ baseAttack: weapon.attack, basePrice: weapon.price, slots, ...globals, marketPrices: effective, estimatedPrices }));
    const profitTop = sortByProfit(results).slice(0, 3);
    const roiTop = sortByRoi(results).slice(0, 3);
    rankingRoot.innerHTML = `
      <section class="enhance-ranking-board">
        <div class="enhance-ranking-head"><div><span>RESULT</span><h2>최적 강화 경로</h2></div><p>강화 도중 기대가치가 상점가보다 낮아지는 순간 자동으로 중단합니다.</p></div>
        <p class="enhance-estimate-note">평균 획득 비용 = (1회 무기·주문서 비용 − 목표 미달 결과의 평균 판매 회수액) ÷ 해당 공격력 이상 확률. 미달 결과도 입력한 경매장 시세 또는 낮은 공격력부터 계산한 추정 가격으로 판매합니다. 첫 경매장 시세보다 낮은 미입력 공격력은 상점가입니다. 추정 가격을 판매가로 사용한 수익은 실제 시세와 다를 수 있습니다.</p>
        <div class="enhance-ranking-columns">
          <div><h3>메소를 가장 많이 남기는 무기</h3>${profitTop.map((result, index) => routeCard(result, index + 1, "profit")).join("")}</div>
          <div><h3>투입 대비 효율이 좋은 무기</h3>${roiTop.map((result, index) => routeCard(result, index + 1, "roi")).join("")}</div>
        </div>
      </section>
    `;
  }

  function paintResults() {
    paintWeaponTypes();
    paintMarket();
    paintRanking();
  }

  function canSwitchProfile() {
    return !profileDirty || window.confirm("저장하지 않은 변경 내용이 있습니다. 다른 아이템으로 이동할까요?");
  }

  marketRoot.addEventListener("focusin", (event) => {
    const card = event.target.closest("[data-price-card]");
    if (!card) return;
    focusedMarketAttack = Number(card.dataset.priceCard);
    syncMarketFocus();
  });

  root.addEventListener("click", (event) => {
    const attackButton = event.target.closest("[data-focus-market]");
    if (attackButton) {
      focusMarketAttack(Number(attackButton.dataset.focusMarket));
      return;
    }
    const stepButton = event.target.closest("[data-market-step]");
    if (stepButton) {
      const attacks = [...marketRoot.querySelectorAll("[data-price-card]")].map((card) => Number(card.dataset.priceCard));
      const index = attacks.indexOf(focusedMarketAttack) + Number(stepButton.dataset.marketStep);
      if (attacks[index] != null) focusMarketAttack(attacks[index]);
      return;
    }
    const profileButton = event.target.closest("[data-profile-id]");
    if (profileButton) {
      if (profileButton.dataset.profileId === activeProfileId || !canSwitchProfile()) return;
      const profile = profiles.find((item) => item.id === profileButton.dataset.profileId);
      if (profile) selectProfile(profile);
      return;
    }
    const newProfileButton = event.target.closest("[data-new-profile]");
    if (newProfileButton) {
      if (!canSwitchProfile()) return;
      selectProfile(null);
      activeSortOrder = Number(newProfileButton.dataset.newProfile);
      paintProfileControls();
      profileNameInput.focus();
      return;
    }
    if (event.target.closest("[data-save-profile]")) {
      saveProfile();
      return;
    }
    if (event.target.closest("[data-delete-profile]")) {
      deleteProfile();
      return;
    }
    const weaponType = event.target.closest("[data-weapon-type]");
    if (weaponType) {
      state.weaponType = weaponType.dataset.weaponType;
      markProfileDirty();
      paintResults();
      return;
    }
    if (event.target.closest("[data-generate-range]")) {
      const center = readAttack(state.centerAttack);
      if (center == null) return;
      const previous = new Map(state.weapons.map((weapon) => [readAttack(weapon.attack), weapon.price]));
      state.weapons = Array.from({ length: 11 }, (_, index) => {
        const attack = center - 5 + index;
        return { id: ++weaponRowId, attack: String(attack), price: previous.get(attack) ?? "" };
      });
      markProfileDirty();
      paintWeapons();
      paintResults();
      return;
    }
    if (event.target.closest("[data-add-weapon]")) {
      state.weapons.push({ id: ++weaponRowId, attack: "", price: "" });
      markProfileDirty();
      paintWeapons();
      return;
    }
    const remove = event.target.closest("[data-remove-weapon]");
    if (remove) {
      const id = Number(remove.closest("[data-weapon-row]").dataset.weaponRow);
      state.weapons = state.weapons.filter((weapon) => weapon.id !== id);
      if (!state.weapons.length) state.weapons.push({ id: ++weaponRowId, attack: "", price: "" });
      markProfileDirty();
      paintWeapons();
      paintResults();
    }
  });

  root.addEventListener("input", (event) => {
    const input = event.target;
    if (input.matches("[data-profile-name]")) {
      profileName = input.value;
      markProfileDirty();
    }
    if (input.matches("[data-center-attack]")) {
      state.centerAttack = input.value;
      markProfileDirty();
    }
    if (input.matches("[data-global-price]")) {
      const id = input.dataset.globalPrice;
      if (id === "shop") state.shopPrice = input.value;
      else state.scrollPrices[id] = input.value;
      const reading = root.querySelector(`[data-global-reading="${id}"]`);
      if (reading) reading.textContent = input.value ? priceReading(input.value) : id === "shop" ? "강화 중단 시 회수하는 가격" : `성공 시 공격력 +${ENHANCE_SCROLLS[id].attackGain}`;
      markProfileDirty();
    }
    const row = input.closest("[data-weapon-row]");
    if (row) {
      const weapon = state.weapons.find((item) => item.id === Number(row.dataset.weaponRow));
      if (input.matches("[data-base-attack]")) weapon.attack = input.value;
      if (input.matches("[data-base-price]")) {
        weapon.price = input.value;
        row.querySelector("small").textContent = input.value ? priceReading(input.value) : "시세 미입력";
      }
      markProfileDirty();
    }
    if (input.matches("[data-market-attack]")) {
      state.marketPrices[input.dataset.marketAttack] = input.value;
      const card = input.closest(".enhance-market-card");
      card.classList.toggle("has-price", readMeso(input.value) != null);
      focusedMarketAttack = Number(input.dataset.marketAttack);
      syncMarketFocus();
      card.querySelector("[data-market-status]").textContent = input.value ? "시장가 입력 중" : "재계산 대기";
      card.querySelector("[data-market-reading]").textContent = input.value ? priceReading(input.value) : "시세 입력 시 이 가격으로 계산합니다.";
      markProfileDirty();
    }
  });

  root.addEventListener("change", (event) => {
    if (event.target.matches("[data-market-jump]")) {
      focusMarketAttack(Number(event.target.value));
      return;
    }
    if (event.target.matches("[data-base-attack], [data-base-price]")) {
      paintWeapons();
      paintResults();
      return;
    }
    if (event.target.matches("[data-global-price='shop'], [data-market-attack]")) {
      const removed = removeLowMarketPrices();
      if (removed) {
        markProfileDirty();
        notify(`상점가 이하의 경매장 시세 ${removed}개를 정리했습니다.`, "info");
      }
      paintMarket();
      paintRanking();
      return;
    }
    if (event.target.matches("[data-global-price]")) {
      paintMarket();
      paintRanking();
    }
  });

  root.addEventListener("keydown", (event) => {
    if (event.target.matches(".enhance-market-track, [data-focus-market]") && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      const step = event.key === "ArrowLeft" ? -1 : 1;
      const buttons = [...marketRoot.querySelectorAll("[data-focus-market]")];
      const index = buttons.findIndex((button) => Number(button.dataset.focusMarket) === focusedMarketAttack) + step;
      if (buttons[index]) {
        focusMarketAttack(Number(buttons[index].dataset.focusMarket));
        if (event.target.matches("[data-focus-market]")) buttons[index].focus({ preventScroll: true });
      }
      return;
    }
    if (event.key !== "Enter" || !event.target.matches("input")) return;
    event.preventDefault();
    event.target.blur();
  });

  paintWeapons();
  paintResults();
  paintProfileControls();
  loadProfiles();
}
