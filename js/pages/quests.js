import { translateDbError } from "../db-error.js";
import { BURST_COLORS, burstAt, celebrate, sfx } from "../effects.js";
import { compareName, escapeHtml, formatCount, readCount } from "../format.js";
import { filterRows, readLevelFilter } from "../filters.js";
import { jobRecord, jobStyle } from "../job-label.js";
import { getSupabase } from "../supabase-client.js";
import { notify } from "../toast.js";

const blankQuest = {
  id: "",
  name: "",
  start_level: "",
  prerequisite: "",
  materials: "",
  reward: "",
  exp_reward: "",
  meso_reward: "",
  material_cost: "",
  duration_minutes: "",
  importance: "보통",
  memo: "",
};

// 시안 퀘스트 화면: 왼쪽은 진행률 링 카드 목록(전체·진행 중·완료 탭), 오른쪽은 고른 퀘스트의 상세.
// 시안의 "진행 단계"는 우리 데이터에 없어서, 캐릭터별 완료를 단계처럼 체크한다(레벨이 되는 캐릭터를 모두 끝내면 완료 연출).
export async function render(root) {
  root.innerHTML = `
    <div class="qs-page">
      <header class="ym-page-head">
        <h1>퀘스트</h1>
        <p>캐릭터마다 끝낸 퀘스트를 체크하고, 아직 안 깬 캐릭터로 받을 수 있는 메소를 모아 봐요.</p>
      </header>
      <div class="qs-layout">
        <div class="qs-main">
          <div class="qs-bar">
            <div class="qs-tabs" role="tablist" data-tabs></div>
            <span class="qs-grand" title="레벨이 되는 안 깬 캐릭터 수 × 재료비를 뺀 메소">남은 메소 합계 <strong data-grand-total>0</strong></span>
          </div>
          <div class="qs-filters">
            <label class="qs-search"><span class="sr-only">퀘스트 찾기</span><input data-search placeholder="퀘스트, 재료, 보상으로 찾기" autocomplete="off" /></label>
            <label class="qs-lv"><span>Lv</span><input data-level-min inputmode="numeric" placeholder="최소" aria-label="레벨 최소" /><i aria-hidden="true">~</i><input data-level-max inputmode="numeric" placeholder="최대" aria-label="레벨 최대" /></label>
            <label class="qs-sort"><span class="sr-only">정렬</span>
              <select data-sort-select>
                <option value="">레벨순</option>
                <option value="amount:desc">메소 많은 순</option>
                <option value="hourly:desc">1시간당 높은 순</option>
                <option value="hourly:asc">1시간당 낮은 순</option>
              </select>
            </label>
            <button class="qs-ghost" type="button" data-reset-search>초기화</button>
            <button class="qs-add" type="button" data-add-quest>+ 퀘스트 추가</button>
          </div>
          <p class="qs-hint" data-list-note hidden></p>
          <div class="qs-list" data-list></div>
        </div>

        <aside class="qs-side">
          <section class="qs-panel qs-form-panel" data-form-panel hidden>
            <form class="qs-form" id="quest-form">
              <div class="qs-form-head">
                <h2 data-quest-title>퀘스트 추가</h2>
                <button class="qs-close" type="button" data-cancel-quest aria-label="닫기">✕</button>
              </div>
              <label class="field span-all"><span>퀘스트명</span><input name="name" required /></label>
              <label class="field"><span>시작 레벨</span><input name="start_level" inputmode="numeric" /></label>
              <label class="field">
                <span>중요도</span>
                <select name="importance">
                  <option value="높음">높음</option>
                  <option value="보통" selected>보통</option>
                  <option value="낮음">낮음</option>
                </select>
              </label>
              <label class="field span-all"><span>선행 퀘스트</span><input name="prerequisite" /></label>
              <label class="field span-all"><span>필요 재료</span><textarea name="materials" placeholder="예: 달팽이 껍질 10"></textarea></label>
              <label class="field span-all"><span>보상</span><textarea name="reward" placeholder="한 줄에 하나씩 입력"></textarea></label>
              <label class="field"><span>경험치</span><input name="exp_reward" inputmode="numeric" /></label>
              <label class="field"><span>메소</span><input name="meso_reward" inputmode="numeric" data-grouped-amount /></label>
              <label class="field"><span>재료비</span><input name="material_cost" inputmode="numeric" data-grouped-amount placeholder="없으면 비움" /></label>
              <label class="field"><span>진행 시간(분)</span><input name="duration_minutes" inputmode="numeric" placeholder="예: 40" /></label>
              <label class="field span-all"><span>메모</span><textarea name="memo"></textarea></label>
              <div class="qs-form-actions span-all">
                <button class="qs-save" type="submit">저장</button>
                <button class="qs-cancel" type="button" data-cancel-quest>취소</button>
              </div>
            </form>
          </section>

          <section class="qs-panel qs-detail" data-detail>
            <p class="qs-muted">퀘스트를 고르면 자세히 보여 줘요.</p>
          </section>
        </aside>
      </div>
    </div>
  `;

  const list = root.querySelector("[data-list]");
  const detail = root.querySelector("[data-detail]");
  const formPanel = root.querySelector("[data-form-panel]");
  const questForm = root.querySelector("#quest-form");
  let quests = [];
  let characters = [];
  let hiddenCharacterCount = 0;
  let progress = [];
  let notes = [];
  let notesFor = "";
  let selectedId = "";
  let tab = "all";
  let sortKey = "";
  let sortDir = "";
  let loadId = 0;

  function showStatus(text, kind) {
    notify(text, kind);
  }

  function accountLabel(character) {
    const account = character.accounts;
    const name = Array.isArray(account) ? account[0]?.name : account?.name;
    return name || "계정 없음";
  }

  function orderedCharacters() {
    return [...characters].sort((a, b) => {
      const byAccount = compareName(accountLabel(a), accountLabel(b));
      if (byAccount) return byAccount;
      return (b.level ?? -1) - (a.level ?? -1) || a.name.localeCompare(b.name, "ko");
    });
  }

  function isDone(questId, characterId) {
    return progress.some((row) => row.quest_id === questId && row.character_id === characterId && row.completed);
  }

  function canComplete(quest, character) {
    if (quest.start_level == null) return true;
    return (character.level ?? -1) >= quest.start_level;
  }

  // 진행률: 끝냈거나 레벨이 되는 캐릭터 중 끝낸 비율.
  function questProgress(quest) {
    let done = 0;
    let total = 0;
    for (const character of characters) {
      const finished = isDone(quest.id, character.id);
      if (finished) done += 1;
      if (finished || canComplete(quest, character)) total += 1;
    }
    return { done, total, ratio: total ? done / total : 0, complete: total > 0 && done === total };
  }

  function compareDefault(a, b) {
    const byLevel = (a.start_level ?? 9999) - (b.start_level ?? 9999);
    if (byLevel) return byLevel;
    const byImportance = importanceOrder(a.importance) - importanceOrder(b.importance);
    if (byImportance) return byImportance;
    return a.name.localeCompare(b.name, "ko");
  }

  function netMeso(quest) {
    if (quest.meso_reward == null) return null;
    return quest.meso_reward - (quest.material_cost ?? 0);
  }

  function sumTitle(quest, undone, net) {
    const cost = quest.material_cost ?? 0;
    if (!cost || quest.meso_reward == null) return `${undone}명 × ${formatCount(net)}`;
    return `${undone}명 × ${formatCount(net)} (메소 ${formatCount(quest.meso_reward)} − 재료비 ${formatCount(cost)})`;
  }

  function sortNumber(quest, key) {
    if (key === "amount") return netMeso(quest);
    if (key === "hourly") return hourlyMeso(quest);
    return null;
  }

  function compareQuests(a, b) {
    if (!sortKey) return compareDefault(a, b);
    const left = sortNumber(a, sortKey);
    const right = sortNumber(b, sortKey);
    const leftMissing = left == null || !Number.isFinite(left);
    const rightMissing = right == null || !Number.isFinite(right);
    if (leftMissing || rightMissing) {
      if (leftMissing && rightMissing) return compareDefault(a, b);
      return leftMissing ? 1 : -1;
    }
    const diff = sortDir === "asc" ? left - right : right - left;
    if (diff) return diff;
    return compareDefault(a, b);
  }

  function undoneCount(questId) {
    const quest = quests.find((item) => item.id === questId);
    if (!quest) return 0;
    return characters.filter((character) => !isDone(questId, character.id) && canComplete(quest, character)).length;
  }

  function formatAmount(value) {
    if (value === null || value === undefined || value === "") return "";
    return formatCount(value);
  }

  function groupDigits(text) {
    return text.replace(/\D/g, "").replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function applyAmountCommas(input) {
    const raw = input.value;
    const caret = input.selectionStart ?? raw.length;
    const next = groupDigits(raw);
    if (next === raw) return;
    const digitsBefore = groupDigits(raw.slice(0, caret)).replaceAll(",", "").length;
    input.value = next;
    if (digitsBefore === 0) {
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

  function formatDuration(minutes) {
    if (minutes == null || minutes === "") return "";
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours && rest) return `${hours}시간 ${rest}분`;
    if (hours) return `${hours}시간`;
    return `${rest}분`;
  }

  function hourlyMeso(quest) {
    const net = netMeso(quest);
    if (net == null || quest.duration_minutes == null) return null;
    return (net * 60) / quest.duration_minutes;
  }

  function isEfficient(hourly) {
    return Number.isFinite(hourly) && hourly >= 5_000_000;
  }

  function rateTitle(hourly) {
    if (hourly == null || !Number.isFinite(hourly)) {
      return "금액과 진행 시간을 적으면 1시간당 메소가 나옵니다.";
    }
    const text = `1시간당 ${formatCount(Math.round(hourly))}메소`;
    return isEfficient(hourly) ? `${text}. 500만 이상이라 효율이 좋습니다.` : text;
  }

  function formatMan(meso) {
    if (meso == null || !Number.isFinite(meso)) return "-";
    return `${Math.round(meso / 10000).toLocaleString("ko-KR")}만`;
  }

  function importanceRank(value) {
    if (value === "높음") return "high";
    if (value === "낮음") return "low";
    return "mid";
  }

  function importanceOrder(value) {
    if (value === "높음") return 0;
    if (value === "낮음") return 2;
    return 1;
  }

  function filteredQuests() {
    return filterRows(quests, {
      query: root.querySelector("[data-search]").value,
      fields: ["name", "materials", "reward"],
      levelMode: "point",
      levelField: "start_level",
      filter: readLevelFilter(root.querySelector("[data-level-min]").value, root.querySelector("[data-level-max]").value),
    });
  }

  function tabMatch(quest) {
    if (tab === "all") return true;
    const state = questProgress(quest);
    return tab === "done" ? state.complete : !state.complete;
  }

  function paintTabs(rows) {
    const counts = { all: rows.length, doing: 0, done: 0 };
    for (const quest of rows) counts[questProgress(quest).complete ? "done" : "doing"] += 1;
    root.querySelector("[data-tabs]").innerHTML = [
      ["all", "전체"],
      ["doing", "진행 중"],
      ["done", "완료"],
    ]
      .map(([key, label]) => `<button type="button" class="qs-tab${tab === key ? " is-on" : ""}" role="tab" aria-selected="${tab === key}" data-tab="${key}">${label}<span>${counts[key]}</span></button>`)
      .join("");
  }

  function characterDots(quest) {
    return orderedCharacters()
      .slice(0, 6)
      .map((character) => {
        const done = isDone(quest.id, character.id);
        const locked = !done && !canComplete(quest, character);
        const initial = [...String(character.name).trim()][0] || "?";
        const state = done ? "완료" : locked ? "레벨 부족" : "가능";
        return `<span class="qs-dot${done ? " is-done" : ""}${locked ? " is-locked" : ""}" title="${escapeHtml(`${character.name} · ${state}`)}">${escapeHtml(initial)}</span>`;
      })
      .join("");
  }

  function questCard(quest, index) {
    const state = questProgress(quest);
    const pct = Math.round(state.ratio * 100);
    const hourly = hourlyMeso(quest);
    const efficient = isEfficient(hourly);
    const rank = importanceRank(quest.importance);
    const meta = [
      quest.duration_minutes ? `약 ${formatDuration(quest.duration_minutes)}` : "",
      `재료비 ${quest.material_cost ? formatMan(quest.material_cost) : "없음"}`,
      hourly != null && Number.isFinite(hourly) ? `1시간당 ${formatMan(hourly)}` : "",
    ]
      .filter(Boolean)
      .map((text) => `<span>${escapeHtml(text)}</span>`)
      .join("");
    const reward = quest.exp_reward ? `EXP ${formatCount(quest.exp_reward)}` : quest.meso_reward != null ? `${formatCount(quest.meso_reward)} 메소` : "보상 미입력";
    return `<button type="button" class="qs-card${quest.id === selectedId ? " is-on" : ""}${state.complete ? " is-complete" : ""}${efficient ? " is-efficient" : ""}" data-pick-quest="${quest.id}" style="--i:${Math.min(index, 14)};--deg:${state.ratio * 360}deg" aria-pressed="${quest.id === selectedId}">
      <span class="qs-ring"><span>${state.total ? `${pct}%` : "—"}</span></span>
      <span class="qs-card-body">
        <span class="qs-card-title">
          <strong>${escapeHtml(quest.name)}</strong>
          ${quest.start_level != null ? `<span class="qs-lv-badge">Lv.${escapeHtml(formatCount(quest.start_level))}+</span>` : ""}
          ${rank !== "mid" ? `<span class="qs-imp is-${rank}">${escapeHtml(quest.importance)}</span>` : ""}
          ${efficient ? `<span class="qs-imp is-hot" title="1시간당 500만 이상">효율</span>` : ""}
        </span>
        <span class="qs-card-meta">${meta}</span>
      </span>
      <span class="qs-card-side">
        <strong>${escapeHtml(reward)}</strong>
        <span class="qs-dots">${characterDots(quest)}</span>
      </span>
    </button>`;
  }

  function paintList() {
    const note = root.querySelector("[data-list-note]");
    const filtered = quests.length ? filteredQuests() : { rows: [] };
    if (!filtered.error) paintTabs(filtered.rows);
    if (!quests.length) {
      list.innerHTML = `<p class="qs-empty">등록한 퀘스트가 없습니다. "퀘스트 추가"로 첫 퀘스트를 저장해 보세요.</p>`;
      paintGrand([]);
      paintDetail();
      return;
    }
    if (filtered.error) {
      list.innerHTML = `<p class="qs-empty">${escapeHtml(filtered.error)}</p>`;
      return;
    }
    const rows = filtered.rows.filter(tabMatch).sort(compareQuests);
    paintGrand(filtered.rows);
    note.hidden = Boolean(characters.length);
    note.textContent = hiddenCharacterCount
      ? `퀘스트에 표시하지 않기로 한 캐릭터 ${hiddenCharacterCount}명은 뺐습니다.`
      : "캐릭터를 등록하면 캐릭터별 완료를 체크할 수 있어요.";
    if (!rows.length) {
      list.innerHTML = `<p class="qs-empty">${filtered.rows.length ? (tab === "done" ? "모두 끝낸 퀘스트가 없어요." : "진행 중인 퀘스트가 없어요.") : "검색 결과가 없습니다. 검색어나 레벨 범위를 바꿔 보세요."}</p>`;
    } else {
      list.innerHTML = rows.map(questCard).join("");
    }
    if (!quests.some((quest) => quest.id === selectedId)) selectedId = rows[0]?.id || "";
    paintDetail();
  }

  function paintGrand(rows) {
    let grand = 0;
    for (const quest of rows) grand += undoneCount(quest.id) * (netMeso(quest) ?? 0) || 0;
    const total = root.querySelector("[data-grand-total]");
    if (total) total.textContent = formatCount(grand);
  }

  // 목록을 다시 그리지 않고 카드 하나와 합계만 고친다(입력 중 포커스 유지).
  function refreshCard(questId) {
    const quest = quests.find((item) => item.id === questId);
    const card = list.querySelector(`[data-pick-quest="${questId}"]`);
    if (quest && card) {
      const index = [...list.children].indexOf(card);
      const holder = document.createElement("div");
      holder.innerHTML = questCard(quest, index);
      const fresh = holder.firstElementChild;
      fresh.style.animation = "none";
      card.replaceWith(fresh);
    }
    const filtered = filteredQuests();
    if (!filtered.error) {
      paintGrand(filtered.rows);
      paintTabs(filtered.rows);
    }
  }

  function splitList(text) {
    return String(text || "")
      .split(/\n|,|·/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function paintDetail() {
    const quest = quests.find((item) => item.id === selectedId);
    if (!quest) {
      detail.innerHTML = `<p class="qs-muted">${quests.length ? "퀘스트를 고르면 자세히 보여 줘요." : "퀘스트를 추가하면 여기서 캐릭터별 완료를 체크해요."}</p>`;
      return;
    }
    const state = questProgress(quest);
    const hourly = hourlyMeso(quest);
    const undone = undoneCount(quest.id);
    const net = netMeso(quest) ?? 0;
    const chars = orderedCharacters()
      .map((character) => {
        const done = isDone(quest.id, character.id);
        const locked = !done && !canComplete(quest, character);
        const initial = [...String(character.name).trim()][0] || "?";
        const sub = done ? "완료" : locked ? `Lv.${character.level ?? "?"} · 레벨 부족` : `Lv.${character.level ?? "?"} · 가능`;
        const style = jobStyle(jobRecord(character));
        return `<button type="button" class="qs-char${done ? " is-done" : ""}${locked ? " is-locked" : ""}" data-toggle-char="${character.id}" aria-pressed="${done}"${locked ? ` aria-disabled="true" title="시작 레벨 ${escapeHtml(formatCount(quest.start_level))}부터 체크할 수 있어요"` : ""}${style ? ` style="${style}"` : ""}>
          <span class="qs-char-mark">${done ? "✓" : escapeHtml(initial)}</span>
          <span class="qs-char-copy"><strong>${escapeHtml(character.name)}</strong><span>${escapeHtml(sub)}</span></span>
        </button>`;
      })
      .join("");
    const materials = splitList(quest.materials);
    const rewards = splitList(quest.reward);
    const memoRows = orderedCharacters()
      .map((character) => {
        const row = progress.find((item) => item.quest_id === quest.id && item.character_id === character.id);
        return `<div class="qs-cmemo" data-progress-row="${character.id}">
          <span>${escapeHtml(accountLabel(character))} · ${escapeHtml(character.name)}</span>
          <input data-memo value="${escapeHtml(row?.memo || "")}" placeholder="이 캐릭터 메모" aria-label="${escapeHtml(character.name)} 메모" />
          <button class="qs-ghost" type="button" data-save-progress="${character.id}">저장</button>
        </div>`;
      })
      .join("");
    detail.innerHTML = `
      <div class="qs-d-head">
        <span class="qs-d-kicker">${quest.start_level != null ? `Lv.${escapeHtml(formatCount(quest.start_level))} 이상` : "레벨 제한 없음"} · 중요도 ${escapeHtml(quest.importance || "보통")}</span>
        <strong class="qs-d-name">${escapeHtml(quest.name)}</strong>
        ${quest.prerequisite ? `<span class="qs-d-pre">선행: ${escapeHtml(quest.prerequisite)}</span>` : ""}
      </div>
      <div class="qs-d-progress">
        <span class="qs-d-row">캐릭터 완료<span>${state.done} / ${state.total}</span></span>
        <span class="qs-d-bar"><i style="width:${state.ratio * 100}%"></i></span>
        ${characters.length ? `<div class="qs-chars">${chars}</div>` : `<p class="qs-muted">${hiddenCharacterCount ? "퀘스트에 표시하지 않기로 한 캐릭터만 있어요." : "캐릭터를 등록하면 완료를 체크할 수 있어요."}</p>`}
      </div>
      <div class="qs-d-nums">
        <label class="qs-well"><span>메소</span><input data-quest-amount="${quest.id}" data-grouped-amount inputmode="numeric" value="${escapeHtml(formatAmount(quest.meso_reward))}" aria-label="${escapeHtml(quest.name)} 금액" /></label>
        <label class="qs-well"><span>재료비</span><input data-quest-cost="${quest.id}" data-grouped-amount inputmode="numeric" value="${escapeHtml(formatAmount(quest.material_cost))}" placeholder="없음" aria-label="${escapeHtml(quest.name)} 재료비" /></label>
        <label class="qs-well"><span>진행 시간(분)</span><input data-quest-duration="${quest.id}" inputmode="numeric" value="${escapeHtml(quest.duration_minutes ?? "")}" title="${escapeHtml(formatDuration(quest.duration_minutes))}" aria-label="${escapeHtml(quest.name)} 진행 시간(분)" /></label>
        <div class="qs-well is-out${isEfficient(hourly) ? " is-hot" : ""}" title="${escapeHtml(rateTitle(hourly))}"><span>1시간당</span><strong data-detail-rate>${escapeHtml(formatMan(hourly))}</strong></div>
      </div>
      <p class="qs-d-sum" data-detail-sum title="${escapeHtml(sumTitle(quest, undone, net))}">안 깬 캐릭터 ${undone}명 × ${escapeHtml(formatCount(net))} = <strong>${escapeHtml(formatCount(undone * net || 0))}</strong></p>
      <div class="qs-d-block">
        <span class="qs-d-label">필요 재료${quest.material_cost ? ` <small>· 재료비 ${escapeHtml(formatMan(quest.material_cost))}</small>` : ""}</span>
        ${materials.length ? `<div class="qs-mats">${materials.map((item) => `<span class="qs-mat">${escapeHtml(item)}</span>`).join("")}</div>` : `<p class="qs-muted">없음</p>`}
      </div>
      <div class="qs-reward">
        <span>보상</span>
        <strong>${quest.exp_reward ? `EXP ${escapeHtml(formatCount(quest.exp_reward))}` : ""}${quest.exp_reward && rewards.length ? " · " : ""}${rewards.map(escapeHtml).join(" · ") || (quest.exp_reward ? "" : "미입력")}</strong>
      </div>
      ${quest.memo ? `<p class="qs-d-memo">${escapeHtml(quest.memo)}</p>` : ""}
      <details class="qs-more" data-notes-box>
        <summary>퀘스트 메모 <span data-notes-count>${notesFor === quest.id ? notes.length : ""}</span></summary>
        <div data-notes><p class="qs-muted">불러오는 중입니다.</p></div>
        <form class="qs-note-form" id="note-form">
          <span class="qs-d-label" data-note-title>메모 추가</span>
          <input name="title" placeholder="제목" required />
          <textarea name="content" placeholder="내용"></textarea>
          <div class="qs-note-actions"><button class="qs-save is-small" type="submit">메모 저장</button><button class="qs-ghost" type="button" data-cancel-note>취소</button></div>
        </form>
      </details>
      ${characters.length ? `<details class="qs-more"><summary>캐릭터별 메모</summary><div class="qs-cmemos">${memoRows}</div></details>` : ""}
      <div class="qs-d-actions">
        <button class="qs-ghost" type="button" data-edit-quest="${quest.id}">수정</button>
        <button class="qs-ghost is-danger" type="button" data-delete-quest="${quest.id}">삭제</button>
      </div>
    `;
    if (notesFor === quest.id) paintNotes();
    else loadNotes(quest.id);
  }

  function paintNotes() {
    const box = detail.querySelector("[data-notes]");
    const count = detail.querySelector("[data-notes-count]");
    if (count) count.textContent = notes.length ? String(notes.length) : "";
    if (!box) return;
    if (!notes.length) {
      box.innerHTML = `<p class="qs-muted">이 퀘스트에 붙은 메모가 없습니다.</p>`;
      return;
    }
    box.innerHTML = notes
      .map(
        (note) => `<article class="qs-note">
          <strong>${escapeHtml(note.title)}</strong>
          ${note.content ? `<p>${escapeHtml(note.content)}</p>` : ""}
          <span class="qs-note-acts"><button class="qs-ghost" type="button" data-edit-note="${note.id}">수정</button><button class="qs-ghost is-danger" type="button" data-delete-note="${note.id}">삭제</button></span>
        </article>`,
      )
      .join("");
  }

  async function loadNotes(questId) {
    const supabase = await getSupabase();
    const { data, error } = await supabase.from("quest_notes").select("id, title, content").eq("quest_id", questId).order("updated_at", { ascending: false });
    if (!detail.isConnected || selectedId !== questId) return;
    if (error) {
      detail.querySelector("[data-notes]").innerHTML = "";
      showStatus(translateDbError(error), "error");
      return;
    }
    notes = data ?? [];
    notesFor = questId;
    paintNotes();
  }

  function noteForm() {
    return detail.querySelector("#note-form");
  }

  function resetNoteForm() {
    const form = noteForm();
    if (!form) return;
    form.dataset.noteId = "";
    form.querySelector("[data-note-title]").textContent = "메모 추가";
    form.reset();
  }

  async function saveQuestField(input, { key, label, minimum, field, success }) {
    const quest = quests.find((item) => item.id === input.dataset[field]);
    if (!quest) return;
    const parsed = readCount(input.value, label, minimum);
    const shown = (value) => (key === "duration_minutes" ? (value ?? "") : formatAmount(value));
    if (parsed.error) {
      showStatus(parsed.error, "error");
      input.value = shown(quest[key]);
      return;
    }
    input.value = shown(parsed.value);
    if ((parsed.value ?? null) === (quest[key] ?? null)) return;
    const supabase = await getSupabase();
    const { error } = await supabase.from("quests").update({ [key]: parsed.value }).eq("id", quest.id);
    if (error) {
      showStatus(translateDbError(error), "error");
      input.value = shown(quest[key]);
      return;
    }
    quest[key] = parsed.value;
    if (questForm.dataset.editingId === quest.id) questForm.elements[key].value = shown(parsed.value);
    refreshCard(quest.id);
    paintDetailFigures(quest);
    sfx("tick");
    showStatus(success, "info");
  }

  // 상세의 숫자 칸을 고친 뒤 1시간당·합계만 바꾼다(포커스가 다음 칸으로 옮겨 가도 유지되게).
  function paintDetailFigures(quest) {
    const hourly = hourlyMeso(quest);
    const rate = detail.querySelector("[data-detail-rate]");
    if (rate) {
      rate.textContent = formatMan(hourly);
      rate.closest(".qs-well").classList.toggle("is-hot", isEfficient(hourly));
      rate.closest(".qs-well").title = rateTitle(hourly);
    }
    const sum = detail.querySelector("[data-detail-sum]");
    if (sum) {
      const undone = undoneCount(quest.id);
      const net = netMeso(quest) ?? 0;
      sum.title = sumTitle(quest, undone, net);
      sum.innerHTML = `안 깬 캐릭터 ${undone}명 × ${escapeHtml(formatCount(net))} = <strong>${escapeHtml(formatCount(undone * net || 0))}</strong>`;
    }
  }

  function fillQuestForm(quest) {
    formPanel.hidden = false;
    questForm.dataset.editingId = quest.id || "";
    root.querySelector("[data-quest-title]").textContent = quest.id ? "퀘스트 수정" : "퀘스트 추가";
    for (const [key, value] of Object.entries(quest)) {
      const field = questForm.elements.namedItem(key);
      if (!field) continue;
      field.value = key === "meso_reward" || key === "material_cost" ? formatAmount(value) : (value ?? (key === "importance" ? "보통" : ""));
    }
    questForm.elements.name.focus({ preventScroll: true });
    formPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function closeQuestForm() {
    formPanel.hidden = true;
    questForm.dataset.editingId = "";
    questForm.reset();
  }

  function readQuestForm() {
    const name = questForm.elements.name.value.trim();
    if (!name) return { error: "퀘스트명을 입력해 주세요." };
    const startLevel = readCount(questForm.elements.start_level.value, "시작 레벨", 1);
    if (startLevel.error) return startLevel;
    const expReward = readCount(questForm.elements.exp_reward.value, "경험치", 0);
    if (expReward.error) return expReward;
    const mesoReward = readCount(questForm.elements.meso_reward.value, "메소", 0);
    if (mesoReward.error) return mesoReward;
    const materialCost = readCount(questForm.elements.material_cost.value, "재료비", 0);
    if (materialCost.error) return materialCost;
    const duration = readCount(questForm.elements.duration_minutes.value, "진행 시간", 1);
    if (duration.error) return duration;
    const importance = questForm.elements.importance.value;
    if (!["높음", "보통", "낮음"].includes(importance)) {
      return { error: "중요도는 높음, 보통, 낮음 중에서 선택해 주세요." };
    }
    return {
      value: {
        name,
        start_level: startLevel.value,
        prerequisite: questForm.elements.prerequisite.value.trim() || null,
        materials: questForm.elements.materials.value.trim() || null,
        reward: questForm.elements.reward.value.trim() || null,
        exp_reward: expReward.value,
        meso_reward: mesoReward.value,
        material_cost: materialCost.value,
        duration_minutes: duration.value,
        importance,
        memo: questForm.elements.memo.value.trim() || null,
      },
    };
  }

  async function saveProgress(questId, characterId, completed, memo) {
    const supabase = await getSupabase();
    const { error } = await supabase.from("character_quests").upsert(
      {
        character_id: characterId,
        quest_id: questId,
        completed,
        completed_at: completed ? new Date().toISOString() : null,
        memo: memo.trim() || null,
      },
      { onConflict: "character_id,quest_id" },
    );
    if (error) {
      showStatus(translateDbError(error), "error");
      return false;
    }
    const next = { character_id: characterId, quest_id: questId, completed, memo: memo.trim() || null };
    const index = progress.findIndex((row) => row.character_id === characterId && row.quest_id === questId);
    if (index >= 0) progress[index] = next;
    else progress.push(next);
    return true;
  }

  async function toggleCharacter(button) {
    const quest = quests.find((item) => item.id === selectedId);
    const character = characters.find((item) => item.id === button.dataset.toggleChar);
    if (!quest || !character) return;
    const done = isDone(quest.id, character.id);
    if (!done && !canComplete(quest, character)) {
      sfx("fail");
      button.classList.remove("is-shake");
      void button.offsetWidth;
      button.classList.add("is-shake");
      showStatus(`시작 레벨 ${formatCount(quest.start_level)}부터 체크할 수 있습니다.`, "error");
      return;
    }
    const before = questProgress(quest).complete;
    const existing = progress.find((item) => item.quest_id === quest.id && item.character_id === character.id);
    button.disabled = true;
    const saved = await saveProgress(quest.id, character.id, !done, existing?.memo || "");
    if (!root.isConnected) return;
    button.disabled = false;
    if (!saved) return;
    if (!done) {
      sfx("check");
      burstAt(button, BURST_COLORS.success, 16, 0.8);
    } else sfx("uncheck");
    const after = questProgress(quest).complete;
    if (!before && after) {
      setTimeout(() => {
        sfx("fanfare");
        celebrate("퀘스트 완료!", `${quest.name}${quest.exp_reward ? ` · EXP ${formatCount(quest.exp_reward)}` : ""}`);
      }, 240);
    }
    paintList();
  }

  async function loadPage() {
    const current = ++loadId;
    if (!quests.length) list.innerHTML = `<p class="qs-empty">퀘스트를 불러오는 중입니다.</p>`;
    const supabase = await getSupabase();
    const questColumns =
      "id, name, start_level, prerequisite, materials, reward, exp_reward, meso_reward, material_cost, duration_minutes, importance, memo, updated_at";
    const characterColumns = "id, name, level, server, account_id, quests_hidden, accounts(name), jobs(name, color, color_dark)";
    const [questResult, characterResult, progressResult] = await Promise.all([
      supabase.from("quests").select(questColumns).order("start_level", { ascending: true }),
      supabase.from("characters").select(characterColumns).order("name"),
      supabase.from("character_quests").select("quest_id, character_id, completed, memo"),
    ]);
    if (current !== loadId || !list.isConnected) return;
    if (questResult.error && /material_cost/i.test(questResult.error.message || "")) {
      const withoutCost = await supabase
        .from("quests")
        .select("id, name, start_level, prerequisite, materials, reward, exp_reward, meso_reward, duration_minutes, importance, memo, updated_at")
        .order("start_level", { ascending: true });
      if (current !== loadId || !list.isConnected) return;
      if (!withoutCost.error) {
        questResult.data = withoutCost.data;
        questResult.error = null;
        showStatus(translateDbError({ message: "column quests.material_cost does not exist" }), "error");
      }
    }
    if (questResult.error && /duration_minutes/i.test(questResult.error.message || "")) {
      const legacy = await supabase
        .from("quests")
        .select("id, name, start_level, prerequisite, materials, reward, exp_reward, meso_reward, importance, memo, updated_at")
        .order("start_level", { ascending: true });
      if (current !== loadId || !list.isConnected) return;
      if (!legacy.error) {
        questResult.data = legacy.data;
        questResult.error = null;
        showStatus(translateDbError({ message: "column quests.duration_minutes does not exist" }), "error");
      }
    }
    if (
      characterResult.error &&
      /quests_hidden/i.test(characterResult.error.message || "") &&
      /could not find|schema cache|does not exist/i.test(characterResult.error.message || "")
    ) {
      const withoutHidden = await supabase
        .from("characters")
        .select("id, name, level, server, account_id, accounts(name), jobs(name, color, color_dark)")
        .order("name");
      if (current !== loadId || !list.isConnected) return;
      if (!withoutHidden.error) {
        characterResult.data = withoutHidden.data;
        characterResult.error = null;
        showStatus(translateDbError({ message: "column characters.quests_hidden does not exist" }), "error");
      }
    }
    const error = questResult.error || characterResult.error || progressResult.error;
    if (error) {
      quests = [];
      list.innerHTML = "";
      showStatus(translateDbError(error), "error");
      return;
    }
    quests = questResult.data ?? [];
    const loadedCharacters = characterResult.data ?? [];
    characters = loadedCharacters.filter((character) => !character.quests_hidden);
    hiddenCharacterCount = loadedCharacters.length - characters.length;
    progress = progressResult.data ?? [];
    paintList();
  }

  root.addEventListener("input", (event) => {
    if (event.target.closest("[data-grouped-amount]")) applyAmountCommas(event.target);
    if (event.target.closest("[data-search], [data-level-min], [data-level-max]")) paintList();
  });

  root.addEventListener("click", async (event) => {
    const tabButton = event.target.closest("[data-tab]");
    if (tabButton) {
      tab = tabButton.dataset.tab;
      sfx("tick");
      paintList();
      return;
    }
    const pick = event.target.closest("[data-pick-quest]");
    if (pick) {
      if (selectedId !== pick.dataset.pickQuest) {
        selectedId = pick.dataset.pickQuest;
        sfx("tick");
        for (const card of list.querySelectorAll("[data-pick-quest]")) {
          const on = card.dataset.pickQuest === selectedId;
          card.classList.toggle("is-on", on);
          card.setAttribute("aria-pressed", String(on));
        }
        paintDetail();
        // 좁은 화면에서는 상세가 목록 아래에 있으므로 보이게 옮긴다.
        if (window.matchMedia("(max-width: 1100px)").matches) detail.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
    const toggle = event.target.closest("[data-toggle-char]");
    if (toggle) {
      await toggleCharacter(toggle);
      return;
    }
    if (event.target.closest("[data-add-quest]")) {
      showStatus("", "info");
      sfx("tick");
      fillQuestForm(blankQuest);
    }
    if (event.target.closest("[data-cancel-quest]")) closeQuestForm();
    if (event.target.closest("[data-cancel-note]")) resetNoteForm();

    if (event.target.closest("[data-reset-search]")) {
      root.querySelector("[data-search]").value = "";
      root.querySelector("[data-level-min]").value = "";
      root.querySelector("[data-level-max]").value = "";
      root.querySelector("[data-sort-select]").value = "";
      sortKey = "";
      sortDir = "";
      tab = "all";
      paintList();
    }

    const editQuestButton = event.target.closest("[data-edit-quest]");
    if (editQuestButton) {
      const quest = quests.find((item) => item.id === editQuestButton.dataset.editQuest);
      if (quest) fillQuestForm(quest);
    }

    const deleteQuestButton = event.target.closest("[data-delete-quest]");
    if (deleteQuestButton) {
      const quest = quests.find((item) => item.id === deleteQuestButton.dataset.deleteQuest);
      if (!quest) return;
      if (!window.confirm(`${quest.name} 퀘스트를 삭제할까요? 메모와 완료 기록도 함께 삭제됩니다.`)) return;
      deleteQuestButton.disabled = true;
      const supabase = await getSupabase();
      const { error } = await supabase.from("quests").delete().eq("id", quest.id);
      if (error) {
        deleteQuestButton.disabled = false;
        showStatus(translateDbError(error), "error");
        return;
      }
      sfx("fail");
      if (selectedId === quest.id) selectedId = "";
      if (questForm.dataset.editingId === quest.id) closeQuestForm();
      showStatus("퀘스트를 삭제했습니다.", "info");
      await loadPage();
    }

    const editNoteButton = event.target.closest("[data-edit-note]");
    if (editNoteButton) {
      const note = notes.find((item) => item.id === editNoteButton.dataset.editNote);
      const form = noteForm();
      if (!note || !form) return;
      form.dataset.noteId = note.id;
      form.querySelector("[data-note-title]").textContent = "메모 수정";
      form.elements.title.value = note.title;
      form.elements.content.value = note.content || "";
      form.elements.title.focus();
    }

    const deleteNoteButton = event.target.closest("[data-delete-note]");
    if (deleteNoteButton) {
      const note = notes.find((item) => item.id === deleteNoteButton.dataset.deleteNote);
      if (!note) return;
      if (!window.confirm(`${note.title} 메모를 삭제할까요?`)) return;
      const supabase = await getSupabase();
      const { error } = await supabase.from("quest_notes").delete().eq("id", note.id);
      if (error) {
        showStatus(translateDbError(error), "error");
        return;
      }
      if (noteForm()?.dataset.noteId === note.id) resetNoteForm();
      showStatus("메모를 삭제했습니다.", "info");
      await loadNotes(selectedId);
    }

    const saveProgressButton = event.target.closest("[data-save-progress]");
    if (!saveProgressButton) return;
    const characterId = saveProgressButton.dataset.saveProgress;
    const row = detail.querySelector(`[data-progress-row="${characterId}"]`);
    const existing = progress.find((item) => item.quest_id === selectedId && item.character_id === characterId);
    const saved = await saveProgress(selectedId, characterId, Boolean(existing?.completed), row.querySelector("[data-memo]").value);
    if (saved) {
      sfx("check");
      showStatus("캐릭터 메모를 저장했습니다.", "info");
    }
  });

  root.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.closest("[data-quest-amount], [data-quest-cost], [data-quest-duration]")) {
      event.preventDefault();
      event.target.blur();
    }
  });

  root.addEventListener("change", async (event) => {
    const sortSelect = event.target.closest("[data-sort-select]");
    if (sortSelect) {
      [sortKey, sortDir] = sortSelect.value ? sortSelect.value.split(":") : ["", ""];
      paintList();
      return;
    }
    const amountInput = event.target.closest("[data-quest-amount]");
    if (amountInput) {
      await saveQuestField(amountInput, { key: "meso_reward", label: "금액", minimum: 0, field: "questAmount", success: "금액을 저장했습니다." });
      return;
    }
    const costInput = event.target.closest("[data-quest-cost]");
    if (costInput) {
      await saveQuestField(costInput, { key: "material_cost", label: "재료비", minimum: 0, field: "questCost", success: "재료비를 저장했습니다." });
      return;
    }
    const durationInput = event.target.closest("[data-quest-duration]");
    if (durationInput) {
      await saveQuestField(durationInput, { key: "duration_minutes", label: "진행 시간", minimum: 1, field: "questDuration", success: "진행 시간을 저장했습니다." });
    }
  });

  questForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const parsed = readQuestForm();
    if (parsed.error) {
      showStatus(parsed.error, "error");
      return;
    }
    const saveButton = questForm.querySelector("button[type='submit']");
    saveButton.disabled = true;
    showStatus("저장하는 중입니다.", "info");
    const supabase = await getSupabase();
    const id = questForm.dataset.editingId;
    const query = id ? supabase.from("quests").update(parsed.value).eq("id", id) : supabase.from("quests").insert(parsed.value);
    const { error } = await query;
    saveButton.disabled = false;
    if (error) {
      showStatus(translateDbError(error), "error");
      return;
    }
    sfx("check");
    burstAt(saveButton, BURST_COLORS.success, 24, 1);
    closeQuestForm();
    showStatus(id ? "퀘스트를 수정했습니다." : "퀘스트를 저장했습니다.", "info");
    await loadPage();
  });

  // 메모 폼은 상세를 다시 그릴 때마다 새로 생기므로 root 에서 받는다.
  root.addEventListener("submit", async (event) => {
    const form = event.target.closest("#note-form");
    if (!form) return;
    event.preventDefault();
    if (!selectedId) return;
    const title = form.elements.title.value.trim();
    if (!title) {
      showStatus("메모 제목을 입력해 주세요.", "error");
      return;
    }
    const payload = { quest_id: selectedId, title, content: form.elements.content.value.trim() };
    const saveButton = form.querySelector("button[type='submit']");
    saveButton.disabled = true;
    const supabase = await getSupabase();
    const noteId = form.dataset.noteId;
    const query = noteId
      ? supabase.from("quest_notes").update({ title: payload.title, content: payload.content }).eq("id", noteId)
      : supabase.from("quest_notes").insert(payload);
    const { error } = await query;
    saveButton.disabled = false;
    if (error) {
      showStatus(translateDbError(error), "error");
      return;
    }
    sfx("check");
    resetNoteForm();
    showStatus(noteId ? "메모를 수정했습니다." : "메모를 저장했습니다.", "info");
    await loadNotes(selectedId);
  });

  await loadPage();
}
