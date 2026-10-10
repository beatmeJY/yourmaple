import { bosses } from "../boss-cooldown.js";
import { translateDbError } from "../db-error.js";
import { BURST_COLORS, burstAt, celebrate, sfx } from "../effects.js";
import { compareName, escapeHtml, formatCount } from "../format.js";
import { RESET_KINDS, clockRemain, homeworkState, nextMidnight, shortRemain } from "../homework-calc.js";
import { jobRecord, jobStyle } from "../job-label.js";
import { getSupabase } from "../supabase-client.js";
import { notify } from "../toast.js";

// 숙제 체크리스트(시안 homework): 위는 초기화 시계 3개, 아래는 숙제(행) × 캐릭터(열) 표.
// 보스 3종은 캐릭터 표의 도전 시각(…_at)을 그대로 쓰고, 보스를 켠 캐릭터만 칸이 생긴다(캐릭터 화면과 같은 기록).
// 무릉도장과 직접 추가한 숙제는 homework_checks 에 끝낸 시각을 남긴다(sql/030).

const BOSS_ART = { pianus: "img/pianus.png", papulatus: "img/papulatus.png", rift: "img/rift.png" };
const BOSS_KIND = { papulatus: "after24h", rift: "after24h", pianus: "after7d" };
const BOSS_ORDER = ["papulatus", "rift", "pianus"];
const CHARACTER_COLUMNS = "id, name, level, account_id, accounts(name), jobs(name, color, color_dark), pianus_enabled, pianus_at, papulatus_enabled, papulatus_at, rift_enabled, rift_at";
const TABS = [
  { id: "all", label: "전체" },
  { id: "daily", label: "매일 00시" },
  { id: "after24h", label: "24시간" },
  { id: "after7d", label: "7일" },
];

function tableMissing(error) {
  const raw = `${error?.message || ""} ${error?.details || ""} ${error?.code || ""}`;
  return /homework_(tasks|checks)/i.test(raw) && /does not exist|schema cache|could not find|42P01|PGRST205/i.test(raw);
}

export async function render(root) {
  root.innerHTML = `
    <div class="hw-page">
      <header class="ym-page-head hw-head">
        <div><h1>숙제 체크리스트</h1><p>캐릭터마다 오늘 할 일을 체크해요. 끝낸 칸은 초기화 시각이 지나면 저절로 다시 비어요.</p></div>
      </header>
      <div class="hw-clocks" data-clocks></div>
      <p class="hw-notice" data-notice hidden></p>
      <section class="hw-board">
        <div class="hw-board-head">
          <h2>캐릭터별 숙제표</h2>
          <div class="hw-tabs" role="tablist" data-tabs></div>
          <span class="hw-total" data-total></span>
        </div>
        <div class="hw-scroll" data-matrix><p class="hw-muted">불러오는 중입니다.</p></div>
        <form class="hw-add" data-add-form hidden>
          <span class="hw-add-title">숙제 추가</span>
          <input name="name" maxlength="40" placeholder="예: 일일 퀘스트" autocomplete="off" aria-label="숙제 이름" />
          <select name="reset_kind" aria-label="초기화 방식">
            ${Object.values(RESET_KINDS).map((kind) => `<option value="${kind.id}">${kind.label}</option>`).join("")}
          </select>
          <button type="submit" class="hw-add-save">추가</button>
        </form>
        <p class="hw-muted hw-foot">보스 칸은 캐릭터 화면의 보스 도전 기록과 같아요. 보스를 켜지 않은 캐릭터는 "—"로 보여요.</p>
      </section>
    </div>
  `;

  const matrix = root.querySelector("[data-matrix]");
  const addForm = root.querySelector("[data-add-form]");
  let characters = [];
  let tasks = [];
  let checks = new Map(); // `${characterId}:${taskKey}` → checked_at
  let ready = true; // sql/030 실행 여부
  let tab = "all";
  let loadId = 0;
  let celebrated = new Set();
  // 이 화면에서 방금 바꾼 보스 기록을 되돌릴 때 쓸 예전 값
  const bossPrevious = new Map();

  function accountLabel(character) {
    const account = character.accounts;
    const name = Array.isArray(account) ? account[0]?.name : account?.name;
    return name || "계정 없음";
  }

  function orderedCharacters() {
    return [...characters].sort((a, b) => compareName(accountLabel(a), accountLabel(b)) || (b.level ?? -1) - (a.level ?? -1) || a.name.localeCompare(b.name, "ko"));
  }

  function allTasks() {
    const builtIn = [
      ...BOSS_ORDER.map((key) => {
        const boss = bosses.find((item) => item.key === key);
        return { key, name: boss.label, kind: BOSS_KIND[key], boss, img: BOSS_ART[key], sub: key === "pianus" ? "보스 · 입장 후 7일" : "보스 · 입장 후 24시간" };
      }),
      { key: "dojo", name: "무릉도장", kind: "daily", glyph: "武", hue: 25, sub: "매일 00시 초기화", needsTable: true },
    ];
    const custom = tasks.map((task) => ({ key: task.id, name: task.name, kind: task.reset_kind, glyph: [...task.name.trim()][0] || "숙", hue: 295, sub: `직접 추가 · ${RESET_KINDS[task.reset_kind]?.label ?? ""}`, custom: true, needsTable: true }));
    return [...builtIn, ...custom];
  }

  function visibleTasks() {
    return allTasks().filter((task) => tab === "all" || task.kind === tab);
  }

  // 칸 하나: applicable(보스를 켰는지), checkedAt, 상태
  function cell(task, character, now) {
    if (task.boss) {
      const applicable = Boolean(character[task.boss.columnEnabled]);
      const at = character[task.boss.columnAt] ?? null;
      return { applicable, at, ...homeworkState(task.kind, at, now) };
    }
    if (task.needsTable && !ready) return { applicable: false, at: null, done: false, next: null, blocked: true };
    const at = checks.get(`${character.id}:${task.key}`) ?? null;
    return { applicable: true, at, ...homeworkState(task.kind, at, now) };
  }

  function characterProgress(character, list, now) {
    let total = 0;
    let done = 0;
    for (const task of list) {
      const state = cell(task, character, now);
      if (!state.applicable) continue;
      total += 1;
      if (state.done) done += 1;
    }
    return { total, done };
  }

  function paintTabs() {
    root.querySelector("[data-tabs]").innerHTML = TABS.map((item) => `<button type="button" class="hw-tab${tab === item.id ? " is-on" : ""}" role="tab" aria-selected="${tab === item.id}" data-tab="${item.id}">${item.label}</button>`).join("");
  }

  function paintMatrix() {
    const now = Date.now();
    const people = orderedCharacters();
    const list = visibleTasks();
    paintTabs();
    if (!people.length) {
      matrix.innerHTML = `<p class="hw-muted">캐릭터를 추가하면 숙제표가 생겨요. <a href="#/characters">캐릭터 추가하러 가기</a></p>`;
      root.querySelector("[data-total]").textContent = "";
      return;
    }
    let allTotal = 0;
    let allDone = 0;
    const heads = people
      .map((character) => {
        const { total, done } = characterProgress(character, list, now);
        allTotal += total;
        allDone += done;
        const ratio = total ? done / total : 0;
        const full = total > 0 && done === total;
        const style = jobStyle(jobRecord(character));
        const initial = [...String(character.name).trim()][0] || "?";
        return `<div class="hw-person${full ? " is-full" : ""}" style="--deg:${ratio * 360}deg${style ? `;${style}` : ""}" title="${escapeHtml(`${accountLabel(character)} · ${character.name}`)}">
          <span class="hw-ring"><span>${escapeHtml(initial)}</span></span>
          <strong>${escapeHtml(character.name)}</strong>
          <small>${total ? `${done}/${total}` : "—"}${character.level ? ` · Lv.${escapeHtml(formatCount(character.level))}` : ""}</small>
        </div>`;
      })
      .join("");
    const rows = list
      .map((task, rowIndex) => {
        const icon = task.img
          ? `<img src="${escapeHtml(task.img)}" alt="" width="30" height="30" />`
          : `<span class="hw-glyph" style="--hue:${task.hue}">${escapeHtml(task.glyph)}</span>`;
        const cells = people
          .map((character) => {
            const state = cell(task, character, now);
            if (!state.applicable) {
              const reason = state.blocked ? "sql/030 실행 후 쓸 수 있어요" : "캐릭터 화면에서 이 보스를 켜면 생겨요";
              return `<span class="hw-cell is-off" title="${escapeHtml(`${character.name} · ${task.name}: ${reason}`)}">—</span>`;
            }
            const label = state.done
              ? `${character.name} · ${task.name} 끝냄${state.next ? ` · ${shortRemain(state.next - now)} 뒤 다시` : ""}`
              : `${character.name} · ${task.name} 하기`;
            return `<button type="button" class="hw-cell${state.done ? " is-done" : ""}" data-cell="${escapeHtml(task.key)}" data-character="${character.id}" aria-pressed="${state.done}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
              <b>${state.done ? "✓" : ""}</b>${state.done && task.kind !== "daily" && state.next ? `<small>${escapeHtml(shortRemain(state.next - now))}</small>` : ""}
            </button>`;
          })
          .join("");
        return `<div class="hw-row" style="--i:${Math.min(rowIndex, 12)}">
          <div class="hw-task">${icon}<span><strong>${escapeHtml(task.name)}</strong><small>${escapeHtml(task.sub)}</small></span>${task.custom ? `<button type="button" class="hw-del" data-delete-task="${task.key}" aria-label="${escapeHtml(task.name)} 숙제 지우기" title="숙제 지우기">✕</button>` : ""}</div>
          ${cells}
        </div>`;
      })
      .join("");
    const empty = list.length ? "" : `<p class="hw-muted">이 초기화 방식의 숙제가 없어요.</p>`;
    matrix.innerHTML = `<div class="hw-grid" style="--cols:${people.length}">
      <div class="hw-row is-head"><div class="hw-task is-corner"><button type="button" class="hw-add-open" data-add-open${ready ? "" : " disabled"}>+ 숙제 추가</button></div>${heads}</div>
      ${rows}
    </div>${empty}`;
    root.querySelector("[data-total]").innerHTML = `전체 <strong>${allDone}</strong> / ${allTotal}`;
  }

  function paintClocks() {
    const now = Date.now();
    const people = orderedCharacters();
    const tasksAll = allTasks();
    const soonest = (kind) => {
      let best = null;
      let waiting = 0;
      let open = 0;
      for (const task of tasksAll.filter((item) => item.kind === kind)) {
        for (const character of people) {
          const state = cell(task, character, now);
          if (!state.applicable) continue;
          if (state.done) {
            waiting += 1;
            if (best == null || state.next < best.next) best = { next: state.next, task, character };
          } else open += 1;
        }
      }
      return { best, waiting, open };
    };
    const midnight = nextMidnight(now);
    const dayLeft = midnight - now;
    const day = soonest("after24h");
    const week = soonest("after7d");
    const card = (label, value, sub, ratio, tone, index) => `<div class="hw-clock is-${tone}" style="--i:${index}">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${sub}</small>
      <i><b style="width:${Math.max(0, Math.min(100, ratio * 100))}%"></b></i>
    </div>`;
    const waitCard = (label, info, period, tone, index) => {
      if (!info.best) return card(label, info.open ? "지금 가능" : "—", info.open ? `할 수 있는 칸 ${info.open}개` : "해당 숙제가 없어요", info.open ? 1 : 0, tone, index);
      const left = info.best.next - now;
      return card(label, clockRemain(left), `${escapeHtml(info.best.character.name)} · ${escapeHtml(info.best.task.name)}${info.open ? ` · 지금 가능 ${info.open}칸` : ""}`, left / period, tone, index);
    };
    root.querySelector("[data-clocks]").innerHTML = [
      card("매일 00시 초기화까지", clockRemain(dayLeft), "무릉도장 · 매일 숙제", dayLeft / 86_400_000, "day", 0),
      waitCard("다음 24시간 숙제", day, 86_400_000, "boss", 1),
      waitCard("다음 7일 숙제", week, 7 * 86_400_000, "week", 2),
    ].join("");
  }

  async function load() {
    const current = ++loadId;
    const supabase = await getSupabase();
    const [characterResult, taskResult, checkResult] = await Promise.all([
      supabase.from("characters").select(CHARACTER_COLUMNS),
      supabase.from("homework_tasks").select("id, name, reset_kind, sort_order, created_at").order("sort_order").order("created_at"),
      supabase.from("homework_checks").select("character_id, task_key, checked_at"),
    ]);
    if (current !== loadId || !root.isConnected) return;
    if (characterResult.error) {
      notify(translateDbError(characterResult.error), "error");
      matrix.innerHTML = "";
      return;
    }
    characters = characterResult.data ?? [];
    const missing = tableMissing(taskResult.error) || tableMissing(checkResult.error);
    ready = !missing;
    const notice = root.querySelector("[data-notice]");
    notice.hidden = ready;
    notice.textContent = ready ? "" : "무릉도장과 직접 추가한 숙제를 저장하려면 Supabase에서 sql/030_homework.sql을 실행해 주세요. 지금은 보스 숙제만 쓸 수 있어요.";
    if (!missing && (taskResult.error || checkResult.error)) notify(translateDbError(taskResult.error || checkResult.error), "error");
    tasks = taskResult.error ? [] : (taskResult.data ?? []);
    checks = new Map((checkResult.error ? [] : (checkResult.data ?? [])).map((row) => [`${row.character_id}:${row.task_key}`, row.checked_at]));
    paintAll();
  }

  function paintAll() {
    paintMatrix();
    paintClocks();
  }

  function cheerIfComplete(character) {
    const now = Date.now();
    const { total, done } = characterProgress(character, allTasks(), now);
    const key = `${character.id}:${new Date(now).toDateString()}`;
    if (total && done === total && !celebrated.has(key)) {
      celebrated.add(key);
      setTimeout(() => {
        sfx("fanfare");
        celebrate(`${character.name} 완료!`, "지금 할 수 있는 숙제를 모두 끝냈어요");
      }, 220);
    }
  }

  async function toggleBoss(task, character, button) {
    const boss = task.boss;
    const now = Date.now();
    const state = cell(task, character, now);
    const memoKey = `${character.id}:${boss.key}`;
    let next;
    if (!state.done) {
      bossPrevious.set(memoKey, character[boss.columnAt] ?? null);
      next = new Date(now).toISOString();
    } else if (bossPrevious.has(memoKey)) {
      next = bossPrevious.get(memoKey);
      bossPrevious.delete(memoKey);
    } else {
      if (!window.confirm(`${character.name}의 ${boss.label} 도전 기록을 지울까요? 지우면 바로 다시 도전할 수 있는 상태가 돼요.`)) return;
      next = null;
    }
    const previous = character[boss.columnAt] ?? null;
    character[boss.columnAt] = next;
    paintAll();
    feedback(!state.done, root.querySelector(`[data-cell="${task.key}"][data-character="${character.id}"]`) ?? button);
    const supabase = await getSupabase();
    const { error } = await supabase.from("characters").update({ [boss.columnAt]: next }).eq("id", character.id);
    if (!root.isConnected) return;
    if (error) {
      character[boss.columnAt] = previous;
      paintAll();
      notify(translateDbError(error), "error");
      return;
    }
    if (!state.done) cheerIfComplete(character);
  }

  async function toggleCheck(task, character, button) {
    const now = Date.now();
    const state = cell(task, character, now);
    const mapKey = `${character.id}:${task.key}`;
    const previous = checks.get(mapKey) ?? null;
    const supabase = await getSupabase();
    if (!state.done) {
      const at = new Date(now).toISOString();
      checks.set(mapKey, at);
      paintAll();
      feedback(true, root.querySelector(`[data-cell="${task.key}"][data-character="${character.id}"]`) ?? button);
      const { error } = await supabase.from("homework_checks").upsert({ character_id: character.id, task_key: task.key, checked_at: at }, { onConflict: "character_id,task_key" });
      if (!root.isConnected) return;
      if (error) {
        if (previous == null) checks.delete(mapKey);
        else checks.set(mapKey, previous);
        paintAll();
        notify(translateDbError(error), "error");
        return;
      }
      cheerIfComplete(character);
      return;
    }
    checks.delete(mapKey);
    paintAll();
    feedback(false);
    const { error } = await supabase.from("homework_checks").delete().eq("character_id", character.id).eq("task_key", task.key);
    if (!root.isConnected) return;
    if (error) {
      checks.set(mapKey, previous);
      paintAll();
      notify(translateDbError(error), "error");
    }
  }

  function feedback(checked, target) {
    if (checked) {
      sfx("check");
      if (target) burstAt(target, BURST_COLORS.success, 18, 0.9);
    } else sfx("uncheck");
  }

  root.addEventListener("click", async (event) => {
    const tabButton = event.target.closest("[data-tab]");
    if (tabButton) {
      tab = tabButton.dataset.tab;
      sfx("tick");
      paintMatrix();
      return;
    }
    const cellButton = event.target.closest("[data-cell]");
    if (cellButton) {
      const task = allTasks().find((item) => item.key === cellButton.dataset.cell);
      const character = characters.find((item) => item.id === cellButton.dataset.character);
      if (!task || !character) return;
      if (task.boss) await toggleBoss(task, character, cellButton);
      else await toggleCheck(task, character, cellButton);
      return;
    }
    if (event.target.closest("[data-add-open]")) {
      addForm.hidden = !addForm.hidden;
      sfx("tick");
      if (!addForm.hidden) addForm.elements.name.focus();
      return;
    }
    const deleteButton = event.target.closest("[data-delete-task]");
    if (deleteButton) {
      const task = tasks.find((item) => item.id === deleteButton.dataset.deleteTask);
      if (!task || !window.confirm(`"${task.name}" 숙제를 지울까요? 체크 기록도 함께 지워져요.`)) return;
      const supabase = await getSupabase();
      // 체크 기록은 task_key 로만 이어져 있어 함께 지운다.
      const removed = await supabase.from("homework_checks").delete().eq("task_key", task.id);
      if (removed.error) {
        notify(translateDbError(removed.error), "error");
        return;
      }
      const { error } = await supabase.from("homework_tasks").delete().eq("id", task.id);
      if (!root.isConnected) return;
      if (error) {
        notify(translateDbError(error), "error");
        return;
      }
      sfx("fail");
      notify("숙제를 지웠습니다.", "info");
      await load();
    }
  });

  addForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = addForm.elements.name.value.trim();
    const kind = addForm.elements.reset_kind.value;
    if (!name) {
      notify("숙제 이름을 적어 주세요.", "error");
      addForm.elements.name.focus();
      return;
    }
    if (!RESET_KINDS[kind]) return;
    const button = addForm.querySelector("[type=submit]");
    button.disabled = true;
    const supabase = await getSupabase();
    const { error } = await supabase.from("homework_tasks").insert({ name, reset_kind: kind, sort_order: tasks.length });
    if (!root.isConnected) return;
    button.disabled = false;
    if (error) {
      notify(translateDbError(error), "error");
      return;
    }
    sfx("check");
    burstAt(button, BURST_COLORS.success, 18, 0.9);
    addForm.reset();
    addForm.hidden = true;
    await load();
  });

  // 초기화 시계는 1초마다, 칸(남은 시간·자동 초기화)은 30초마다 다시 그린다.
  let ticks = 0;
  const timer = setInterval(() => {
    if (!root.isConnected) {
      clearInterval(timer);
      return;
    }
    ticks += 1;
    paintClocks();
    if (ticks % 30 === 0) paintMatrix();
  }, 1000);

  paintTabs();
  await load();
}
