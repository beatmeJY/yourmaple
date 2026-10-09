import { escapeHtml, formatCount, readBig } from "../format.js";
import { DEFAULT_GIVE_UP_TRIALS, ENHANCE_SCROLLS, WEAPON_TYPES, attemptLeaves, bestAttemptMix, enhancementPolicyMap, enhancementSalePrices, optimizeEnhancement, reachableFinalAttacks, sameStateRoutes } from "../enhance-calc.js";
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

let weaponRowId = 0;

export async function render(root) {
  const state = {
    weaponType: "normal",
    centerAttack: "",
    shopPrice: "",
    scrollPrices: { ten: "", sixty: "" },
    weapons: [{ id: ++weaponRowId, attack: "", price: "" }],
    marketPrices: {},
    targetAttack: "",
    budget: "",
    giveUpTrials: String(DEFAULT_GIVE_UP_TRIALS),
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
  let currentMap = null;
  let selectedMapNode = null;
  let mapObserver = null;

  root.innerHTML = `
    <div class="enhance-page enhance-optimizer-page">
      <header class="page-header enhance-hero">
        <div><span class="enhance-eyebrow">OPTIMAL ENCHANT LAB</span><h1>강화 계산</h1><p>보유 메소로 강화에 도전할지, 목표 무기를 바로 살지 비교합니다.</p></div>
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
        <p class="enhance-rule"><strong>자동 의사결정</strong><span>각 단계에서 10% 사용 · 60% 사용 · 상점 판매 중 기대 회수액이 가장 높은 행동을 선택합니다. 완성된 무기는 모두 판매합니다.</span></p>
      </section>
      <section class="trade-board enhance-weapon-book" aria-labelledby="enhance-weapon-title">
        <div class="enhance-section-head">
          <div><span>STEP 2</span><h2 id="enhance-weapon-title">노작 무기 시세</h2></div>
          <div class="enhance-range-maker"><input type="text" inputmode="numeric" pattern="[0-9]*" data-center-attack placeholder="기준 공격력" aria-label="기준 공격력" /><button type="button" data-generate-range>−5부터 +5 생성</button><button type="button" data-add-weapon>직접 추가</button></div>
        </div>
        <p class="enhance-book-help">같은 무기의 공격력별 구매가를 입력하세요. 비어 있는 행은 계산에서 제외됩니다.</p>
        <div class="enhance-base-list" data-base-weapons></div>
      </section>
      <section class="trade-board enhance-state-board" aria-labelledby="enhance-state-title">
        <div class="enhance-section-head"><div><span>STEP 2-1</span><h2 id="enhance-state-title">같은 상태 만들기 비교</h2></div><small>주문서를 바른 뒤 공격력과 남은 횟수가 같으면 그 뒤 결과는 똑같습니다.<br />예: 공53 + 10% 성공 = 공56 + 60% 성공 = 공58 · 남은 6회</small></div>
        <div data-enhance-states></div>
      </section>
      <section class="trade-board" aria-labelledby="enhance-goal-title">
        <div class="enhance-section-head"><div><span>STEP 3</span><h2 id="enhance-goal-title">도전 조건</h2></div></div>
        <div class="enhance-input-grid is-three enhance-goal-grid">
          <label class="enhance-field is-budget"><span>보유 메소</span><input type="text" inputmode="numeric" pattern="[0-9]*" data-budget placeholder="도전에 쓸 메소" autocomplete="off" /><small data-budget-reading>도전에 쓸 수 있는 메소</small></label>
          <label class="enhance-field is-target"><span>목표 공격력</span><span class="enhance-select-wrap" data-target-slot></span><small>이 공격력 무기를 바로 살지 비교합니다</small></label>
          <label class="enhance-field"><span>포기 기준</span><span class="enhance-unit-input"><input type="text" inputmode="numeric" pattern="[0-9]*" data-give-up placeholder="${DEFAULT_GIVE_UP_TRIALS}" autocomplete="off" /><b>회</b></span><small>이 횟수를 도전해도 평균 1개도 안 나오면 포기 구간</small></label>
        </div>
      </section>
      <section class="trade-board" aria-labelledby="enhance-market-title">
        <div class="enhance-section-head"><div><span>STEP 4</span><h2 id="enhance-market-title">완성 공격력별 판매가</h2></div><small>목표보다 낮거나 가장 낮은 입력 시세보다 아래는 상점가라 입력하지 않아도 됩니다.<br />그 위로 포기 구간 전까지는 입력이 필요합니다. 포기 구간은 비워 두면 가장 비싼 입력 시세를 도달 확률로 비례해 추정합니다.</small></div>
        <div data-enhance-market></div>
      </section>
      <section class="enhance-ranking" data-enhance-ranking></section>
    </div>
  `;

  const weaponList = root.querySelector("[data-base-weapons]");
  const marketRoot = root.querySelector("[data-enhance-market]");
  const rankingRoot = root.querySelector("[data-enhance-ranking]");
  const statesRoot = root.querySelector("[data-enhance-states]");
  const profileSlots = root.querySelector("[data-profile-slots]");
  const profileNameInput = root.querySelector("[data-profile-name]");
  const profileStatus = root.querySelector("[data-profile-status]");
  const profileSaveButton = root.querySelector("[data-save-profile]");
  const profileDeleteButton = root.querySelector("[data-delete-profile]");

  function profileSnapshot() {
    return {
      schemaVersion: 2,
      weaponType: state.weaponType,
      centerAttack: state.centerAttack,
      shopPrice: state.shopPrice,
      scrollPrices: { ...state.scrollPrices },
      weapons: state.weapons.map((weapon) => ({ attack: String(weapon.attack ?? ""), price: String(weapon.price ?? "") })),
      marketPrices: Object.fromEntries(Object.entries(state.marketPrices).map(([attack, value]) => [String(attack), String(value ?? "")])),
      targetAttack: state.targetAttack,
      budget: state.budget,
      giveUpTrials: state.giveUpTrials,
    };
  }

  function resetCalculation() {
    state.weaponType = "normal";
    state.centerAttack = "";
    state.shopPrice = "";
    state.scrollPrices = { ten: "", sixty: "" };
    state.weapons = [{ id: ++weaponRowId, attack: "", price: "" }];
    state.marketPrices = {};
    state.targetAttack = "";
    state.budget = "";
    state.giveUpTrials = String(DEFAULT_GIVE_UP_TRIALS);
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
    // schemaVersion 1 프로필에는 아래 값이 없어 기본값으로 읽는다.
    state.targetAttack = String(source.targetAttack ?? "");
    state.budget = String(source.budget ?? "");
    state.giveUpTrials = String(source.giveUpTrials ?? DEFAULT_GIVE_UP_TRIALS);
  }

  function syncStaticInputs() {
    root.querySelector("[data-center-attack]").value = state.centerAttack;
    root.querySelector("[data-global-price='shop']").value = state.shopPrice;
    root.querySelector("[data-global-price='ten']").value = state.scrollPrices.ten;
    root.querySelector("[data-global-price='sixty']").value = state.scrollPrices.sixty;
    root.querySelector("[data-global-reading='shop']").textContent = state.shopPrice ? priceReading(state.shopPrice) : "강화 중단 시 회수하는 가격";
    root.querySelector("[data-global-reading='ten']").textContent = state.scrollPrices.ten ? priceReading(state.scrollPrices.ten) : "성공 시 공격력 +5";
    root.querySelector("[data-global-reading='sixty']").textContent = state.scrollPrices.sixty ? priceReading(state.scrollPrices.sixty) : "성공 시 공격력 +2";
    root.querySelector("[data-budget]").value = state.budget;
    root.querySelector("[data-budget-reading]").textContent = state.budget ? priceReading(state.budget) : "도전에 쓸 수 있는 메소";
    root.querySelector("[data-give-up]").value = state.giveUpTrials;
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

  function readTrials() {
    const trials = readAttack(state.giveUpTrials);
    return trials != null && trials >= 1 && trials <= 1_000_000_000 ? trials : DEFAULT_GIVE_UP_TRIALS;
  }

  function priceModel() {
    const weapons = validWeapons();
    const globals = globalValues();
    const slots = WEAPON_TYPES[state.weaponType].slots;
    const attacks = reachableFinalAttacks(weapons.map((weapon) => weapon.attack), slots);
    const chosen = readAttack(state.targetAttack);
    const target = attacks.includes(chosen) ? chosen : null;
    const sale = target == null || globals.shopPrice == null ? null : enhancementSalePrices({
      baseAttacks: weapons.map((weapon) => weapon.attack), slots, shopPrice: globals.shopPrice,
      marketPrices: globals.marketPrices, targetAttack: target, giveUpTrials: readTrials(),
    });
    return { weapons, globals, slots, attacks, target, sale };
  }

  function paintTargetSelect(attacks) {
    const slot = root.querySelector("[data-target-slot]");
    const chosen = readAttack(state.targetAttack);
    const options = attacks.map((attack) => `<option value="${attack}"${attack === chosen ? " selected" : ""}>공 ${attack}</option>`).join("");
    slot.innerHTML = attacks.length
      ? `<select data-target-attack aria-label="목표 공격력"><option value=""${attacks.includes(chosen) ? "" : " selected"}>선택</option>${options}</select>`
      : `<select disabled aria-label="목표 공격력"><option>노작 입력 필요</option></select>`;
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

  // 분수 금액은 나누어떨어지면 그대로, 아니면 반올림해 "약"을 붙인다.
  function fractionMeso(numerator, denominator) {
    if (numerator % denominator === 0n) return priceReading(numerator / denominator);
    return `약 ${priceReading((numerator + denominator / 2n) / denominator)}`;
  }

  function scrollName(scrollId) {
    return scrollId === "ten" ? "10%" : "60%";
  }

  function stateRouteCard(route, best, index) {
    const extra = route.cost - best.cost;
    const steps = route.plan.length;
    const lines = [
      `<li><span>노작 구매가</span><b>${escapeHtml(priceReading(route.basePrice))}</b></li>`,
      ...route.scrolls.map((scroll, order) => `<li><span>${order + 1}번째 ${scrollName(scroll.scrollId)} ${escapeHtml(priceReading(scroll.price))} × 바를 확률 ${chanceText(scroll.reachNumerator, route.denominator, true)}${order ? " (앞 장 성공 시만)" : ""}</span><b>+ ${escapeHtml(fractionMeso(scroll.price * scroll.reachNumerator, route.denominator))}</b></li>`),
      `<li class="is-sum"><span>1회 평균 지출</span><b>${escapeHtml(fractionMeso(route.spendNumerator, route.denominator))}</b></li>`,
      `<li><span>실패 확률 ${chanceText(route.failNumerator, route.denominator, true)} × 상점가 회수</span><b>− ${escapeHtml(fractionMeso(route.recoveryNumerator, route.denominator))}</b></li>`,
      `<li><span>${steps > 1 ? `전부 성공할 확률 (${route.plan.map((scrollId) => scrollName(scrollId)).join(" × ")})` : "성공 확률"}</span><b>÷ ${chanceText(route.successNumerator, route.denominator, true)}</b></li>`,
      `<li class="is-total"><span>평균 제작 비용 (메소 단위 올림)</span><b>= ${escapeHtml(priceReading(route.cost))}</b></li>`,
    ];
    return `<article class="enhance-state-route${index === 0 ? " is-best" : ""}">
      <header><strong>공 ${route.baseAttack} 노작 → ${route.plan.map((scrollId) => scrollName(scrollId)).join(" → ")}</strong><em>${index === 0 ? "가장 쌈" : `+${escapeHtml(priceReading(extra))}`}</em></header>
      <p class="enhance-state-cost"><span>평균 제작 비용</span><b>${escapeHtml(priceReading(route.cost))}</b></p>
      <ol class="enhance-formula">${lines.join("")}</ol>
    </article>`;
  }

  function paintStates() {
    const weapons = validWeapons();
    const globals = globalValues();
    if (!weapons.length || globals.shopPrice == null || globals.scrollPrices.ten == null || globals.scrollPrices.sixty == null) {
      statesRoot.innerHTML = `<div class="enhance-empty"><span aria-hidden="true">⇄</span><strong>상점가·주문서 시세·노작 무기 시세를 입력하면 비교합니다.</strong></div>`;
      return;
    }
    const slots = WEAPON_TYPES[state.weaponType].slots;
    const states = sameStateRoutes({ weapons, slots, shopPrice: globals.shopPrice, scrollPrices: globals.scrollPrices });
    if (!states.length) {
      statesRoot.innerHTML = `<div class="enhance-empty"><span aria-hidden="true">⇄</span><strong>비교할 상태가 없습니다.</strong><small>공격력이 3 차이(10% 1장 vs 60% 1장) 나는 노작을 함께 입력하면 생깁니다.</small></div>`;
      return;
    }
    // 묶음마다 가장 싼 경로를 고를 때 두 번째 경로보다 아끼는 금액이 큰 순서로 보여준다.
    const saving = (item) => item.routes[1].cost - item.routes[0].cost;
    const groups = [1, 2]
      .map((steps) => states.filter((item) => item.steps === steps).sort((left, right) => (saving(right) > saving(left) ? 1 : saving(right) < saving(left) ? -1 : 0)))
      .filter((group) => group.length);
    const medal = (rank) => rank === 1 ? "is-gold" : rank === 2 ? "is-silver" : rank === 3 ? "is-bronze" : "";
    statesRoot.innerHTML = `
      <p class="enhance-state-rule">평균 제작 비용 = (노작가 + 평균 주문서 지출 − 실패작 상점 회수액) ÷ 전부 성공할 확률<br /><small>10%를 먼저 바르고, 중간에 실패하면 남은 주문서는 바르지 않고 상점가로 팝니다. 경로를 잘 고를수록 많이 아끼는 상태부터 보여줍니다. 이 비교는 아래 결론 계산과 별개인 참고 정보입니다.</small></p>
      ${groups.map((group, groupIndex) => `<div class="enhance-state-group">
        <div class="enhance-state-group-head"><h3>주문서 ${group[0].steps}장 뒤 · 남은 ${group[0].remaining}회 <small>${group.length}개 · 절약 큰 순</small></h3><div class="enhance-market-arrows"><button type="button" data-state-step="-1" data-state-group="${groupIndex}" aria-label="이전 비교">‹</button><button type="button" data-state-step="1" data-state-group="${groupIndex}" aria-label="다음 비교">›</button></div></div>
        <div class="enhance-state-track" data-state-track="${groupIndex}" tabindex="0" aria-label="주문서 ${group[0].steps}장 뒤 비교 카드, 가로로 스크롤">${group.map((item, index) => `
        <section class="enhance-state-card ${medal(index + 1)}" style="--i:${Math.min(index, 6)}" aria-label="${index + 1}위 공 ${item.attack} 남은 ${item.remaining}회 만들기">
          <header><span class="enhance-state-rank" aria-hidden="true">${index + 1}</span><div><small>같은 상태</small><h4>공 ${item.attack} · 남은 ${item.remaining}회</h4></div><em class="enhance-state-saving">${escapeHtml(compactMeso(saving(item)))} 절약</em></header>
          ${item.routes.map((route, routeIndex) => stateRouteCard(route, item.routes[0], routeIndex)).join("")}
        </section>`).join("")}</div></div>`).join("")}`;
  }

  function marketStatus(row, target) {
    if (target == null) return { label: "목표 선택 필요", tone: "is-wait" };
    if (row.source === "market") return { label: row.attack < target ? "입력 판매가" : "입력 시세", tone: "is-market" };
    if (row.source === "shop") return { label: "상점 판매", tone: "is-shop" };
    if (row.source === "estimate") return { label: "포기 구간 추정", tone: "is-estimate" };
    return { label: row.givenUp ? "시세 1개 이상 필요" : "입력 필요", tone: "is-missing" };
  }

  function paintMarket() {
    const { weapons, globals, attacks, target, sale } = priceModel();
    if (!weapons.length) {
      marketRoot.innerHTML = `<div class="enhance-empty"><span aria-hidden="true">⚔</span><strong>노작 무기 공격력과 가격을 입력해 주세요.</strong><small>가능한 완성 공격력이 자동으로 생성됩니다.</small></div>`;
      return;
    }
    const rows = new Map((sale?.rows ?? []).map((row) => [row.attack, row]));
    const expanded = new Set([...marketRoot.querySelectorAll(".enhance-market-card details[open]")].map((details) => Number(details.closest("[data-price-card]").dataset.priceCard)));
    if (!attacks.includes(focusedMarketAttack)) focusedMarketAttack = target ?? attacks.find((attack) => globals.marketPrices[String(attack)] != null) ?? attacks[0];
    const summary = sale == null
      ? (globals.shopPrice == null ? "상점 판매가를 먼저 입력해 주세요." : "STEP 3에서 목표 공격력을 선택해 주세요.")
      : sale.missingAttacks.length
        ? `입력이 필요한 공격력 ${sale.missingAttacks.length}개 · 빨간 표시를 채워 주세요.`
        : "모든 판매가가 준비됐습니다.";
    marketRoot.innerHTML = `<div class="enhance-market-toolbar"><div><strong>${escapeHtml(summary)}</strong><small>${sale?.giveUpAttack != null ? `공 ${sale.giveUpAttack}부터 포기 구간입니다 (${formatCount(BigInt(readTrials()))}회 기준).` : "카드를 옆으로 넘겨 판매가를 확인할 수 있습니다."}</small></div><label>공격력 바로가기<select data-market-jump aria-label="확인할 완성 공격력">${attacks.map((attack) => `<option value="${attack}"${attack === focusedMarketAttack ? " selected" : ""}>공 ${attack}</option>`).join("")}</select></label><div class="enhance-market-arrows"><button type="button" data-market-step="-1" aria-label="이전 공격력">‹</button><button type="button" data-market-step="1" aria-label="다음 공격력">›</button></div></div>
      <div class="enhance-attack-rail" aria-label="완성 공격력 선택">${attacks.map((attack) => {
        const tone = rows.has(attack) ? marketStatus(rows.get(attack), target).tone : "";
        return `<button type="button" data-focus-market="${attack}" aria-pressed="${attack === focusedMarketAttack}" class="${globals.marketPrices[String(attack)] != null ? "has-market" : ""} ${tone}${attack === target ? " is-target" : ""}"><small>${attack === target ? "목표" : "공"}</small><b>${attack}</b><i aria-hidden="true"></i></button>`;
      }).join("")}</div>
      <div class="enhance-market-grid enhance-market-track" tabindex="0" aria-label="완성 공격력별 판매가 카드, 좌우 방향키로 이동">${attacks.map((attack, index) => {
      const value = state.marketPrices[String(attack)] ?? "";
      const market = globals.marketPrices[String(attack)];
      const row = rows.get(attack) ?? { attack, price: market ?? null, source: market != null ? "market" : "missing", givenUp: false, reachNumerator: null };
      const status = marketStatus(row, target);
      const reach = row.reachNumerator == null ? "" : `<span>공 ${attack} 이상 가장 쉬운 도달 확률<b>${chanceText(row.reachNumerator, sale.denominator, true)}</b></span>`;
      const anchorRow = sale?.anchor ? rows.get(sale.anchor.attack) : null;
      const giveUpRow = sale?.giveUpAttack != null ? rows.get(sale.giveUpAttack) : null;
      const estimateNote = row.source === "estimate" && sale.anchor
        ? `<ol class="enhance-formula is-compact"><li><span>가장 비싼 입력 시세 (공 ${sale.anchor.attack})</span><b>${escapeHtml(priceReading(sale.anchor.price))}</b></li><li><span>× 공 ${sale.anchor.attack} 이상 도달 확률</span><b>${chanceText(anchorRow.reachNumerator, sale.denominator, true)}</b></li><li><span>÷ 공 ${sale.giveUpAttack} 이상 도달 확률 (포기선)</span><b>${chanceText(giveUpRow.reachNumerator, sale.denominator, true)}</b></li><li class="is-total"><span>추정가 (올림${sale.estimate === globals.shopPrice ? " · 상점가 하한" : ""})</span><b>= ${escapeHtml(priceReading(sale.estimate))}</b></li></ol><p class="enhance-market-reference">포기 구간(공 ${sale.giveUpAttack} 이상)은 모두 이 추정가를 씁니다.</p>`
        : row.givenUp && row.source !== "market" && !sale?.anchor ? `<p class="enhance-market-reference">경매장 시세를 하나 이상 입력하면 이 구간 가격을 추정합니다.</p>` : "";
      const priceText = row.price == null ? (status.tone === "is-missing" ? "입력 필요" : "목표 선택 대기") : priceReading(row.price);
      const detail = reach ? `<details${expanded.has(attack) ? " open" : ""}><summary>도달 확률 자세히</summary><div class="enhance-market-recipe"><div class="enhance-market-chance">${reach}</div><small>입력한 노작 중 가장 유리한 노작에서 매 단계 주문서를 최적으로 골랐을 때의 확률입니다.${row.givenUp ? ` ${formatCount(BigInt(readTrials()))}회 도전해도 평균 1개가 안 나와 포기 구간입니다.` : ""}</small></div></details>` : "";
      return `<article class="enhance-market-card ${status.tone}${attack === target ? " is-target" : ""}${market != null ? " has-price" : ""}" data-price-card="${attack}" style="--i:${index}" aria-labelledby="enhance-price-title-${attack}"><header><span class="enhance-market-emblem" aria-hidden="true">${attack === target ? "★" : "⚔"}</span><div><small>${attack === target ? "목표 공격력" : "완성 공격력"}</small><h3 id="enhance-price-title-${attack}">공 <b>${attack}</b></h3></div><span class="enhance-market-status" data-market-status>${escapeHtml(status.label)}</span></header><div class="enhance-market-price"><span>계산에 쓰는 판매가</span><strong>${escapeHtml(priceText)}</strong><small>${attack === target ? "바로 구매할 때의 가격으로도 씁니다." : row.source === "shop" ? (sale?.firstMarketAttack != null && attack < sale.firstMarketAttack && attack >= target ? `가장 낮은 입력 시세(공 ${sale.firstMarketAttack})보다 아래라 상점가로 팝니다.` : "목표보다 낮아 비우면 상점가로 팝니다.") : "강화 결과물로 나오면 이 가격에 판매합니다."}</small></div><label class="enhance-market-input"><span>경매장 시세 <small>메소</small></span><input type="text" inputmode="numeric" pattern="[0-9]*" data-market-attack="${attack}" aria-label="공 ${attack} 경매장 시세" value="${escapeHtml(value)}" placeholder="${status.tone === "is-missing" ? "대략이라도 입력해 주세요" : "비우면 자동 적용"}" autocomplete="off"${status.tone === "is-missing" ? ` aria-invalid="true"` : ""} /></label><em data-market-reading>${escapeHtml(market != null ? priceReading(value) : "상점가 이하 시세는 저장하지 않습니다.")}</em>${estimateNote}${detail}</article>`;
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

  function outcomeLabel(outcome) {
    if (outcome.remaining) return `${outcome.remaining}회 남기고 중단`;
    return "끝까지 강화";
  }

  function saleSourceLabel(outcome) {
    if (outcome.remaining || outcome.saleType === "shop") return "상점가";
    return outcome.saleType === "estimate" ? "포기 구간 추정가" : "입력 시세";
  }

  function calcDetails(route, scrollPrices) {
    const usage = route.expectedUsageHundredths;
    const rows = [...route.outcomes].sort((left, right) => left.attack - right.attack || right.remaining - left.remaining);
    return `<details class="enhance-calc-detail"><summary>계산 근거 보기</summary>
      <h5>① 1트 평균 지출</h5>
      <ol class="enhance-formula">
        <li><span>노작 구매가</span><b>${escapeHtml(priceReading(route.basePrice))}</b></li>
        <li><span>10% 평균 ${decimalHundredths(usage.ten)}장 × ${escapeHtml(priceReading(scrollPrices.ten))}</span><b>+ ${escapeHtml(fractionMeso(usage.ten * scrollPrices.ten, 100n))}</b></li>
        <li><span>60% 평균 ${decimalHundredths(usage.sixty)}장 × ${escapeHtml(priceReading(scrollPrices.sixty))}</span><b>+ ${escapeHtml(fractionMeso(usage.sixty * scrollPrices.sixty, 100n))}</b></li>
        <li class="is-total"><span>1트 평균 지출</span><b>= ${escapeHtml(priceReading(route.expectedSpend))}</b></li>
      </ol>
      <h5>② 1트 평균 판매액 (결과별 확률 × 판매가)</h5>
      <div class="enhance-calc-table-wrap"><table class="enhance-calc-table">
        <thead><tr><th scope="col">결과</th><th scope="col">확률</th><th scope="col">판매가</th><th scope="col">확률 × 판매가</th></tr></thead>
        <tbody>${rows.map((outcome) => `<tr><th scope="row">공 ${outcome.attack}<small>${outcomeLabel(outcome)}</small></th><td>${chanceText(outcome.probabilityNumerator, outcome.denominator, true)}</td><td>${escapeHtml(priceReading(outcome.salePrice))}<small>${saleSourceLabel(outcome)}</small></td><td>${escapeHtml(fractionMeso(outcome.salePrice * outcome.probabilityNumerator, outcome.denominator))}</td></tr>`).join("")}</tbody>
        <tfoot><tr><th scope="row" colspan="3">1트 평균 판매액</th><td>${escapeHtml(priceReading(route.expectedSale))}</td></tr></tfoot>
      </table></div>
      <h5>③ 1트 기대 이익</h5>
      <ol class="enhance-formula">
        <li><span>1트 평균 판매액 − 1트 평균 지출</span><b class="${route.expectedProfit >= 0n ? "is-gain" : "is-loss"}">= ${signedMeso(route.expectedProfit)}</b></li>
      </ol>
    </details>`;
  }

  function compareCard(result, rank, count, budget, scrollPrices) {
    const { weapon, route, attempt } = result;
    const affordable = attempt.maxSpend <= budget;
    const tone = count > 0n ? " is-best" : !affordable ? " is-locked" : "";
    const badge = count > 0n ? `추천 ${formatCount(count)}번` : !affordable ? "보유 메소 부족" : route.expectedProfit > 0n ? "조합에서 제외" : "손해라 제외";
    return `<article class="enhance-compare-card${tone}" style="--i:${rank}">
      <header><span class="enhance-medal">${rank}</span><div><small>노작 무기 · ${escapeHtml(badge)}</small><h3>공격력 ${weapon.attack} 노작</h3></div><b>${formatCount(weapon.price)}메소</b></header>
      <div class="enhance-compare-main"><span>1트 기대 이익</span><strong class="${route.expectedProfit >= 0n ? "is-gain" : "is-loss"}">${signedMeso(route.expectedProfit)}</strong><em>평균 지출 대비 ${ratioText(route.expectedProfit, route.expectedSpend)}</em></div>
      <div class="enhance-route-kpis">
        <p><span>1트 평균 지출</span><b>${formatCount(route.expectedSpend)}메소</b></p>
        <p><span>1트 평균 판매액</span><b>${formatCount(route.expectedSale)}메소</b></p>
        <p><span>1트 최악 지출</span><b>${formatCount(attempt.maxSpend)}메소</b></p>
        <p><span>최악 지출 대비 이익</span><b>${ratioText(route.expectedProfit, attempt.maxSpend)}</b></p>
      </div>
      ${calcDetails(route, scrollPrices)}
    </article>`;
  }

  function actionText(node) {
    if (node.action === "ten") return "10% 바르기";
    if (node.action === "sixty") return "60% 바르기";
    if (node.action === "sell") return "상점 판매";
    return node.saleType === "estimate" ? "완성 · 추정가 판매" : node.saleType === "market" ? "완성 · 시세 판매" : "완성 · 상점 판매";
  }

  function actionTone(node) {
    if (node.action === "ten") return "is-ten";
    if (node.action === "sixty") return "is-sixty";
    if (node.action === "sell") return "is-sell";
    return "is-done";
  }

  // 지도 노드는 칸이 좁아 만 단위로 반올림해 보여준다. 정확한 값은 선택 시 상세에 나온다.
  function compactMeso(value) {
    const negative = value < 0n;
    const amount = negative ? -value : value;
    if (amount < 10_000n) return `${negative ? "-" : ""}${formatCount(amount)}메소`;
    const man = (amount + 5_000n) / 10_000n;
    const eok = man / 10_000n;
    const rest = man % 10_000n;
    return `${negative ? "-" : ""}${eok ? `${formatCount(eok)}억` : ""}${eok && rest ? " " : ""}${rest ? `${formatCount(rest)}만` : ""}`;
  }

  function reachRatio(numerator) {
    return currentMap && currentMap.denominator ? Number(numerator) / Number(currentMap.denominator) : 0;
  }

  // 보드 한 칸: 구슬에 행동을 쓰고 아래에 1트당 도달 확률을 적는다. 자주 가는 칸일수록 진하게 보인다.
  function mapNodeButton(node, row, column) {
    const orb = node.action === "ten" ? "10%" : node.action === "sixty" ? "60%" : node.action === "sell" ? "판매" : "★";
    const ratio = reachRatio(node.reachNumerator);
    const startCount = node.starts.reduce((sum, start) => sum + start.count, 0n);
    const tip = `공 ${node.attack} · ${node.remaining ? `남은 ${node.remaining}회` : "완성"} · ${actionText(node)}${node.action === "ten" || node.action === "sixty" ? ` · 기대 ${compactMeso(node.value)}` : ` · ${compactMeso(node.salePrice)}`}`;
    return `<button type="button" class="enhance-map-node ${actionTone(node)}${node.starts.length ? " is-start" : ""}" data-map-node="${node.key}" style="grid-row:${row};grid-column:${column};--c:${column - 2};--alpha:${(0.5 + 0.5 * Math.sqrt(ratio)).toFixed(3)}" aria-pressed="${node.key === selectedMapNode}" title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}, 도달 ${chanceText(node.reachNumerator, currentMap.denominator)}">
      ${node.starts.length ? `<em class="enhance-map-start">출발${startCount > 1n ? ` ×${formatCount(startCount)}` : ""}</em>` : ""}
      <span class="enhance-map-orb" aria-hidden="true">${orb}</span>
      <small class="enhance-map-reach">${chanceText(node.reachNumerator, currentMap.denominator)}</small>
    </button>`;
  }

  // 노드를 고르면 행동별 기대값과 지금 판매 대비 변동액, 성공·실패 다음 상태를 보여준다.
  function paintMapDetail() {
    const panel = rankingRoot.querySelector("[data-map-detail]");
    if (!panel || !currentMap) return;
    const node = currentMap.nodes.get(selectedMapNode);
    if (!node) {
      panel.innerHTML = "";
      return;
    }
    const outgoing = currentMap.edges.filter((edge) => edge.from === node.key);
    const nextText = (kind) => {
      const edge = outgoing.find((item) => item.kind === kind);
      const next = edge ? currentMap.nodes.get(edge.to) : null;
      return next ? `<button type="button" class="enhance-map-next is-${kind}" data-map-node="${next.key}"><small>${kind === "success" ? "성공하면" : "실패하면"}</small><b>공 ${next.attack} · ${next.remaining ? `남은 ${next.remaining}회` : "완성"}</b><span>${escapeHtml(actionText(next))}</span></button>` : "";
    };
    if (!node.alternatives.length) {
      panel.innerHTML = `<div class="enhance-map-detail-head"><span class="enhance-map-orb ${actionTone(node)}" aria-hidden="true">★</span><div><small>업그레이드 횟수를 모두 사용 · 1트당 도달 ${chanceText(node.reachNumerator, currentMap.denominator)}</small><h4>공 ${node.attack} 완성</h4></div></div>
        <ol class="enhance-formula"><li class="is-total"><span>판매가 (${node.saleType === "estimate" ? "포기 구간 추정가" : node.saleType === "market" ? "입력 시세" : "상점가"})</span><b>${escapeHtml(priceReading(node.salePrice))}</b></li></ol>`;
      return;
    }
    const sellValue = node.alternatives.find((row) => row.id === "sell")?.expectedValue ?? 0n;
    const ordered = ["ten", "sixty", "sell"].map((id) => node.alternatives.find((row) => row.id === id)).filter(Boolean);
    panel.innerHTML = `<div class="enhance-map-detail-head"><span class="enhance-map-orb ${actionTone(node)}" aria-hidden="true">${node.action === "ten" ? "10%" : node.action === "sixty" ? "60%" : "판매"}</span><div><small>지금 상태 · 남은 ${node.remaining}회 · 1트당 도달 ${chanceText(node.reachNumerator, currentMap.denominator)}</small><h4>공 ${node.attack}에서는 ${escapeHtml(actionText(node))}</h4></div></div>
      <div class="enhance-map-actions">${ordered.map((row) => {
        const delta = row.expectedValue - sellValue;
        const best = row.id === node.action;
        return `<div class="enhance-map-action-row ${row.id === "ten" ? "is-ten" : row.id === "sixty" ? "is-sixty" : "is-sell"}${best ? " is-best" : ""}"><span>${row.id === "ten" ? "10% 바르기" : row.id === "sixty" ? "60% 바르기" : "지금 상점 판매"}${best ? "<em>추천</em>" : ""}</span><b>${escapeHtml(priceReading(row.expectedValue < 0n ? 0n : row.expectedValue))}${row.expectedValue < 0n ? " 미만" : ""}</b><small class="${delta > 0n ? "is-gain" : delta < 0n ? "is-loss" : ""}">${row.id === "sell" ? "기준" : `판매보다 ${signedMeso(delta)}`}</small></div>`;
      }).join("")}</div>
      <p class="enhance-calc-note">기대값 = 이 행동부터 추천대로 끝까지 했을 때의 평균 판매액 − 앞으로 바를 주문서 값의 평균입니다.</p>
      <div class="enhance-map-nexts">${nextText("success")}${nextText("fail")}</div>`;
  }

  function drawMapLines() {
    const canvas = rankingRoot.querySelector(".enhance-map-grid");
    const svg = canvas?.querySelector(".enhance-map-lines");
    if (!canvas || !svg || !currentMap) return;
    // 크기가 그대로면 다시 그리지 않는다. 다시 그리면 선이 나타나는 효과가 처음부터 재생된다.
    const size = `${canvas.scrollWidth}x${canvas.scrollHeight}`;
    if (svg.dataset.size === size && svg.childElementCount) return;
    svg.dataset.size = size;
    const bounds = canvas.getBoundingClientRect();
    svg.setAttribute("width", String(canvas.scrollWidth));
    svg.setAttribute("height", String(canvas.scrollHeight));
    svg.setAttribute("viewBox", `0 0 ${canvas.scrollWidth} ${canvas.scrollHeight}`);
    const point = (key, side) => {
      const element = canvas.querySelector(`[data-map-node="${key}"] .enhance-map-orb`);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      // 구슬 중심끼리 이어 선이 구슬 뒤로 지나가게 한다. 칸이 좁아도 기울기가 잘 보인다.
      return { x: rect.left + rect.width / 2 - bounds.left, y: rect.top + rect.height / 2 - bounds.top };
    };
    svg.innerHTML = currentMap.edges.map((edge, index) => {
      const from = point(edge.from, "out");
      const to = point(edge.to, "in");
      if (!from || !to) return "";
      const bend = (to.x - from.x) * 0.45;
      const active = edge.from === selectedMapNode || edge.to === selectedMapNode;
      // 이 경로를 지날 확률이 클수록 굵고 진하게 그린다.
      const strength = Math.sqrt(reachRatio(edge.reachNumerator));
      const width = (edge.kind === "success" ? 1.4 : 1.1) + strength * 7;
      const opacity = 0.18 + strength * 0.75;
      return `<path class="enhance-map-line is-${edge.kind} is-${edge.action}${active ? " is-active" : ""}" data-from="${edge.from}" data-to="${edge.to}" style="--e:${index};--w:${width.toFixed(2)}px;--o:${opacity.toFixed(3)}" pathLength="1" d="M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}" />`;
    }).join("");
  }

  function selectMapNode(key) {
    selectedMapNode = key;
    for (const button of rankingRoot.querySelectorAll(".enhance-map-node")) button.setAttribute("aria-pressed", String(button.dataset.mapNode === key));
    // 선을 다시 그리지 않고 강조만 바꿔 그리기 애니메이션이 반복되지 않게 한다.
    for (const line of rankingRoot.querySelectorAll(".enhance-map-line")) line.classList.toggle("is-active", line.dataset.from === key || line.dataset.to === key);
    paintMapDetail();
  }

  function paintRanking() {
    const { weapons, globals, slots, target, sale } = priceModel();
    const lock = (message, detail = "") => {
      currentMap = null;
      rankingRoot.innerHTML = `<div class="enhance-result-lock"><span aria-hidden="true">✦</span><strong>${escapeHtml(message)}</strong>${detail ? `<p>${escapeHtml(detail)}</p>` : ""}</div>`;
    };
    if (!weapons.length || globals.shopPrice == null || globals.scrollPrices.ten == null || globals.scrollPrices.sixty == null) {
      lock("상점가·주문서 시세·노작 무기 시세를 입력하면 계산합니다.");
      return;
    }
    if (target == null) {
      lock("STEP 3에서 목표 공격력을 선택해 주세요.");
      return;
    }
    if (sale.missingAttacks.length) {
      const required = sale.missingAttacks.filter((attack) => sale.giveUpAttack == null || attack < sale.giveUpAttack);
      lock("판매가가 부족해 계산을 기다리고 있습니다.", required.length
        ? `입력이 필요한 공격력: ${required.map((attack) => `공 ${attack}`).join(" · ")}`
        : "경매장 시세를 하나 이상 입력해 주세요.");
      return;
    }
    const budget = readMeso(state.budget);
    if (budget == null) {
      lock("STEP 3에서 보유 메소를 입력해 주세요.");
      return;
    }
    const targetPrice = sale.prices[String(target)];
    const results = weapons.map((weapon) => {
      const route = optimizeEnhancement({
        baseAttack: weapon.attack, basePrice: weapon.price, slots, ...globals,
        marketPrices: sale.prices, estimatedPrices: sale.estimatedPrices,
      });
      return { weapon, route, attempt: attemptLeaves(route, globals.scrollPrices) };
    });
    const mix = bestAttemptMix({ budget, items: results.map((result) => ({ id: result.weapon.id, weight: result.attempt.maxSpend, value: result.route.expectedProfit, result })) });
    const counts = new Map(mix.rows.map((row) => [row.item.id, row.count]));
    const ranked = [...results].sort((left, right) => {
      const leftCount = counts.get(left.weapon.id) ?? 0n;
      const rightCount = counts.get(right.weapon.id) ?? 0n;
      if ((leftCount > 0n) !== (rightCount > 0n)) return leftCount > 0n ? -1 : 1;
      return left.route.expectedProfit === right.route.expectedProfit ? 0 : left.route.expectedProfit > right.route.expectedProfit ? -1 : 1;
    });

    // 지도는 추천 조합의 노작에서 출발한다. 조합이 비면 1트 기대 이익이 가장 큰 노작 하나를 보여준다.
    const mapResults = mix.rows.length ? mix.rows.map((row) => row.item.result) : [ranked[0]];
    const policyMap = enhancementPolicyMap(mapResults.map((result) => result.route), mix.rows.length ? mix.rows.map((row) => row.count) : [1n]);
    currentMap = { ...policyMap, nodes: new Map(policyMap.columns.flatMap((column) => column.nodes.map((node) => [node.key, node]))) };
    if (!currentMap.nodes.has(selectedMapNode)) selectedMapNode = policyMap.columns[0]?.nodes[0]?.key ?? null;

    const affordable = results.some((result) => result.attempt.maxSpend <= budget);
    const buyLeft = budget - targetPrice;
    const targetSource = sale.rows.find((row) => row.attack === target)?.source;
    const priceLabel = targetSource === "estimate" ? "추정 구매가" : targetSource === "shop" ? "상점가 기준 구매가" : "경매장 구매가";
    let verdict;
    if (mix.rows.length) verdict = { tone: "is-challenge", title: "강화 도전 후 구매가 평균적으로 유리합니다", text: `추천 조합대로 도전하면 평균 ${priceReading(mix.totalValue)}를 더 남깁니다.` };
    else if (affordable) verdict = { tone: "is-buy", title: "도전하지 말고 바로 구매하세요", text: "보유 메소로 할 수 있는 도전은 모두 1트 기대 이익이 0 이하입니다." };
    else verdict = { tone: "is-wait", title: "보유 메소로는 도전할 수 없습니다", text: "모든 노작의 1트 최악 지출이 보유 메소보다 큽니다." };
    const afterChallenge = budget + mix.totalValue - targetPrice;
    const moneyText = (value) => value >= 0n ? escapeHtml(priceReading(value)) : `${escapeHtml(priceReading(-value))} 부족`;

    rankingRoot.innerHTML = `
      <section class="enhance-ranking-board">
        <div class="enhance-ranking-head"><div><span>RESULT</span><h2>도전할까, 바로 살까</h2></div><p>보유 메소 ${escapeHtml(priceReading(budget))} · 목표 공 ${target}</p></div>
        <article class="enhance-verdict ${verdict.tone}">
          <div class="enhance-verdict-title"><span aria-hidden="true">${verdict.tone === "is-challenge" ? "⚔" : verdict.tone === "is-buy" ? "🛒" : "✦"}</span><div><h3>${escapeHtml(verdict.title)}</h3><p>${escapeHtml(verdict.text)}</p></div></div>
          ${mix.rows.length ? `<div class="enhance-mix">${mix.rows.map((row, index) => `<div class="enhance-mix-chip" style="--i:${index}"><b>공 ${row.item.result.weapon.attack} 노작</b><span>× ${formatCount(row.count)}번</span><small>1트 ${signedMeso(row.item.value)} · 최악 ${escapeHtml(priceReading(row.item.weight))}</small></div>`).join(`<span class="enhance-mix-plus" aria-hidden="true">+</span>`)}</div>` : ""}
          <div class="enhance-verdict-compare">
            <div class="is-buy-side"><small>바로 구매</small><strong>${moneyText(buyLeft)}</strong><span>보유 ${escapeHtml(priceReading(budget))} − ${priceLabel} ${escapeHtml(priceReading(targetPrice))}</span></div>
            <div class="is-challenge-side"><small>추천 조합 도전 후 구매 (평균)</small><strong>${mix.rows.length ? moneyText(afterChallenge) : "도전 안 함"}</strong><span>${mix.rows.length ? `보유 ${escapeHtml(priceReading(budget))} + 기대 이익 ${escapeHtml(priceReading(mix.totalValue))} − ${priceLabel} ${escapeHtml(priceReading(targetPrice))}` : "도전할 만한 조합이 없습니다"}</span></div>
          </div>
          ${mix.rows.length ? `<details class="enhance-calc-detail"><summary>조합 계산 근거 보기</summary><ol class="enhance-formula">${mix.rows.map((row) => `<li><span>공 ${row.item.result.weapon.attack} 노작 ${formatCount(row.count)}번 × 1트 기대 이익 ${escapeHtml(priceReading(row.item.value))}<br />최악 지출 ${escapeHtml(priceReading(row.item.weight))} × ${formatCount(row.count)}번 = ${escapeHtml(priceReading(row.item.weight * row.count))}</span><b>+ ${escapeHtml(priceReading(row.item.value * row.count))}</b></li>`).join("")}<li class="is-sum"><span>최악 지출 합계 (보유 ${escapeHtml(priceReading(budget))} 이하)</span><b>${escapeHtml(priceReading(mix.totalWeight))}</b></li><li class="is-total"><span>기대 이익 합계</span><b>= ${escapeHtml(priceReading(mix.totalValue))}</b></li></ol><p class="enhance-calc-note">운이 가장 나빠도 메소가 모자라지 않도록 각 도전의 최악 지출(노작가 + 추천대로 바를 때 가장 많이 드는 주문서 값)을 합쳐 보유 메소 이하로 맞춥니다. 그 안에서 기대 이익 합계가 가장 큰 횟수 조합을 모두 비교해 골랐습니다.${mix.exact ? "" : " 경우의 수가 너무 많아 일부만 비교했습니다."}</p></details>` : ""}
        </article>
        <section class="enhance-map-board" aria-labelledby="enhance-map-title">
          <div class="enhance-map-head"><div><span>ROUTE MAP</span><h3 id="enhance-map-title">강화 지도</h3><p>왼쪽에서 지금 공격력 줄을, 위에서 남은 횟수 열을 찾아 만나는 칸의 행동대로 바르면 됩니다. 칸 아래 %는 1트당 그 칸에 올 확률이고, 굵은 길일수록 자주 지나갑니다. 칸을 누르면 행동별 기대값을 볼 수 있습니다.</p></div>
            <ul class="enhance-map-legend"><li class="is-ten">10% 바르기</li><li class="is-sixty">60% 바르기</li><li class="is-sell">상점 판매</li><li class="is-done">완성 · 판매</li><li class="is-line">— 성공 · ┄ 실패</li></ul></div>
          <div class="enhance-map-scroll" tabindex="0" aria-label="강화 지도, 가로로 스크롤">
            <div class="enhance-map-grid" style="--cols:${policyMap.columns.length};--rows:${policyMap.attacks.length}">
              <svg class="enhance-map-lines" aria-hidden="true"></svg>
              <div class="enhance-map-corner" style="grid-row:1;grid-column:1"><small>공격력</small><small>남은 횟수 →</small></div>
              ${policyMap.columns.map((column, index) => `<div class="enhance-map-col-head" style="grid-row:1;grid-column:${index + 2};--c:${index}"><b>${column.remaining ? `${column.remaining}회` : "완성"}</b><small>${column.remaining ? "남음" : "판매"}</small></div>`).join("")}
              ${policyMap.attacks.map((attack, index) => `<div class="enhance-map-row-label" style="grid-row:${index + 2};grid-column:1">공 <b>${attack}</b></div><div class="enhance-map-row-guide" style="grid-row:${index + 2};grid-column:2 / -1" aria-hidden="true"></div>`).join("")}
              ${policyMap.columns.map((column, columnIndex) => column.nodes.map((node) => mapNodeButton(node, policyMap.attacks.indexOf(node.attack) + 2, columnIndex + 2)).join("")).join("")}
            </div>
          </div>
          <div class="enhance-map-detail" data-map-detail aria-live="polite"></div>
        </section>
        <h3 class="enhance-compare-title">노작별 1트 기대값</h3>
        <div class="enhance-compare-list">${ranked.map((result, index) => compareCard(result, index + 1, counts.get(result.weapon.id) ?? 0n, budget, globals.scrollPrices)).join("")}</div>
      </section>
    `;
    mapObserver?.disconnect();
    const canvas = rankingRoot.querySelector(".enhance-map-grid");
    mapObserver = new ResizeObserver(() => drawMapLines());
    mapObserver.observe(canvas);
    drawMapLines();
    // 글꼴이 늦게 적용되면 노드 위치가 바뀌므로 한 번 더 그린다.
    document.fonts?.ready.then(() => { if (root.isConnected) drawMapLines(); });
    paintMapDetail();
  }

  function paintResults() {
    paintWeaponTypes();
    paintTargetSelect(reachableFinalAttacks(validWeapons().map((weapon) => weapon.attack), WEAPON_TYPES[state.weaponType].slots));
    paintStates();
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
    const mapNode = event.target.closest("[data-map-node]");
    if (mapNode) {
      selectMapNode(mapNode.dataset.mapNode);
      if (mapNode.classList.contains("enhance-map-next")) rankingRoot.querySelector(`.enhance-map-node[data-map-node="${mapNode.dataset.mapNode}"]`)?.scrollIntoView({ block: "nearest", inline: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      return;
    }
    const attackButton = event.target.closest("[data-focus-market]");
    if (attackButton) {
      focusMarketAttack(Number(attackButton.dataset.focusMarket));
      return;
    }
    const stateStep = event.target.closest("[data-state-step]");
    if (stateStep) {
      const track = statesRoot.querySelector(`[data-state-track="${stateStep.dataset.stateGroup}"]`);
      const cards = track ? [...track.querySelectorAll(".enhance-state-card")] : [];
      if (!cards.length) return;
      // 지금 맨 앞 카드에서 한 장씩 앞뒤로 옮긴다.
      const offsets = cards.map((card) => card.offsetLeft - cards[0].offsetLeft);
      const current = offsets.reduce((best, offset, index) => Math.abs(offset - track.scrollLeft) < Math.abs(offsets[best] - track.scrollLeft) ? index : best, 0);
      const next = Math.max(0, Math.min(cards.length - 1, current + Number(stateStep.dataset.stateStep)));
      track.scrollTo({ left: offsets[next], behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
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
    if (input.matches("[data-budget]")) {
      state.budget = input.value;
      root.querySelector("[data-budget-reading]").textContent = input.value ? priceReading(input.value) : "도전에 쓸 수 있는 메소";
      markProfileDirty();
    }
    if (input.matches("[data-give-up]")) {
      state.giveUpTrials = input.value;
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
      card.querySelector("[data-market-status]").textContent = input.value ? "시세 입력 중" : "재계산 대기";
      card.querySelector("[data-market-reading]").textContent = input.value ? priceReading(input.value) : "상점가 이하 시세는 저장하지 않습니다.";
      markProfileDirty();
    }
  });

  root.addEventListener("change", (event) => {
    if (event.target.matches("[data-target-attack]")) {
      state.targetAttack = event.target.value;
      if (readAttack(state.targetAttack) != null) focusedMarketAttack = readAttack(state.targetAttack);
      markProfileDirty();
      paintMarket();
      paintRanking();
      return;
    }
    if (event.target.matches("[data-budget]")) {
      paintRanking();
      return;
    }
    if (event.target.matches("[data-give-up]")) {
      if (readAttack(state.giveUpTrials) !== readTrials()) {
        notify(`포기 기준은 1회 이상 숫자로 입력해 주세요. ${formatCount(BigInt(DEFAULT_GIVE_UP_TRIALS))}회로 계산합니다.`, "info");
      }
      paintMarket();
      paintRanking();
      return;
    }
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
      if (event.target.matches("[data-global-price]")) paintStates();
      paintMarket();
      paintRanking();
      return;
    }
    if (event.target.matches("[data-global-price]")) {
      paintStates();
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
