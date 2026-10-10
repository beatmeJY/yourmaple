import { translateDbError } from "./db-error.js";
import { sfx } from "./effects.js";
import { escapeHtml, formatCount } from "./format.js";
import { DOJO_DAILY_GOAL, DOJO_RESET_POINTS, dojoDays, localDay } from "./homework-calc.js";
import { getSupabase } from "./supabase-client.js";
import { notify } from "./toast.js";

// 무릉 화면 "통합 점수 기록" 창: 숙제 체크리스트·수련 점수에서 적은 통합 점수(dojo_score_log, sql/033)를 날짜별로 보여 준다.
// 날짜 줄 = 그날 마지막 통합 점수와 그날 번 점수(어제 마지막 기록부터 오른 만큼). 누르면 그날 적은 기록과 지우기.

function weekday(day) {
  const [year, month, date] = day.split("-").map(Number);
  return ["일", "월", "화", "수", "목", "금", "토"][new Date(year, month - 1, date).getDay()];
}

function timeText(value) {
  const date = new Date(value);
  const two = (part) => String(part).padStart(2, "0");
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

function tableMissing(error) {
  const raw = `${error?.message || ""} ${error?.details || ""} ${error?.code || ""}`;
  return /dojo_score_log/i.test(raw) && /does not exist|schema cache|could not find|42P01|PGRST205/i.test(raw);
}

// section 은 <dialog> 안에 둔다. 돌려주는 open(characterId)으로 그 캐릭터 기록을 새로 불러와 연다.
export function mountDojoScoreLog(section) {
  section.innerHTML = `
    <div class="dj-panel-head">
      <h2><i aria-hidden="true">◆</i>통합 점수 기록</h2>
      <span class="dj-sub">수련 점수·숙제 체크리스트에서 적은 점수 · 어제보다 ${formatCount(DOJO_DAILY_GOAL)}점 오르면 그날 숙제 완료</span>
      <a class="dj-log-link" href="#/homework">숙제에서 적기</a>
      <button class="text-button" type="button" data-log-close aria-label="닫기">닫기</button>
    </div>
    <div class="dj-log-chips" data-log-chips></div>
    <div class="dj-log-body" data-log-body><p class="empty">기록을 불러오는 중입니다.</p></div>`;

  const chips = section.querySelector("[data-log-chips]");
  const body = section.querySelector("[data-log-body]");
  let characters = [];
  let rows = [];
  let picked = "";
  const open = new Set();

  function entriesOf(characterId) {
    return rows.filter((row) => row.character_id === characterId);
  }

  function paintChips() {
    const withLog = characters.filter((character) => entriesOf(character.id).length);
    if (!withLog.some((character) => character.id === picked)) picked = withLog[0]?.id ?? "";
    chips.innerHTML = withLog
      .map((character) => {
        const on = character.id === picked;
        return `<button type="button" class="dj-log-chip${on ? " is-on" : ""}" data-log-pick="${character.id}" aria-pressed="${on}">${escapeHtml(character.name)}<small>${entriesOf(character.id).length}</small></button>`;
      })
      .join("");
  }

  function paintBody() {
    if (!picked) {
      body.innerHTML = `<p class="empty">아직 적은 통합 점수가 없습니다. 위 수련 점수를 저장하거나 숙제 체크리스트의 무릉 숙제표에서 "현재 점수"를 적어 보세요.</p>`;
      return;
    }
    const days = dojoDays(entriesOf(picked)).reverse();
    const today = localDay(Date.now());
    body.innerHTML = `<div class="dj-log-table" role="table">
      <div class="dj-log-row is-head" role="row"><span>날짜</span><span>통합 점수</span><span>그날 번 점수</span><span>기록</span></div>
      ${days
        .map((day) => {
          const ratio = Math.min(1, day.earned / DOJO_DAILY_GOAL);
          const done = day.earned >= DOJO_DAILY_GOAL;
          const resets = day.entries.filter((entry) => entry.kind === "reset").length;
          const isOpen = open.has(day.day);
          const detail = isOpen
            ? `<div class="dj-log-detail">${day.entries
                .map((entry) => `<div class="dj-log-entry">
                  <span>${timeText(entry.recorded_at)}</span>
                  <span>${entry.kind === "reset" ? `<em class="dj-log-reset">${formatCount(DOJO_RESET_POINTS)} 초기화</em>` : entry.kind === "clear" ? `<em class="dj-log-reset">오늘 점수 초기화</em>` : "점수 입력"}</span>
                  <b>${formatCount(entry.total)}</b>
                  <span class="${entry.change ? "is-up" : ""}">${entry.change == null ? "기준 없음" : entry.kind !== "set" ? "—" : `+${formatCount(entry.change)}`}</span>
                  <button type="button" class="text-button is-danger" data-log-delete="${escapeHtml(entry.id)}">지우기</button>
                </div>`)
                .join("")}</div>`
            : "";
          return `<div class="dj-log-group${isOpen ? " is-open" : ""}">
            <button type="button" class="dj-log-row" role="row" data-log-day="${day.day}" aria-expanded="${isOpen}">
              <span><b>${day.day.slice(5).replace("-", ".")}</b> ${weekday(day.day)}${day.day === today ? ` <em class="dj-log-today">오늘</em>` : ""}</span>
              <span><b>${formatCount(day.last)}</b>${resets ? ` <em class="dj-log-reset">초기화 ${resets}</em>` : ""}</span>
              <span class="dj-log-earned${done ? " is-done" : ""}"><span class="dj-log-bar"><i style="width:${ratio * 100}%"></i></span><b>${formatCount(day.earned)}</b>${done ? " ✓" : `/${formatCount(DOJO_DAILY_GOAL)}`}${day.partial ? ` <small title="처음 적은 날이라 비교할 어제 기록이 없어요">기준 없음</small>` : ""}</span>
              <span>${day.entries.length}개 <i aria-hidden="true">${isOpen ? "▴" : "▾"}</i></span>
            </button>
            ${detail}
          </div>`;
        })
        .join("")}
    </div>`;
  }

  async function load() {
    const supabase = await getSupabase();
    const [characterResult, logResult] = await Promise.all([
      supabase.from("characters").select("id, name, level"),
      supabase.from("dojo_score_log").select("id, character_id, total, kind, recorded_at").order("recorded_at"),
    ]);
    if (!section.isConnected) return;
    if (logResult.error && tableMissing(logResult.error)) {
      chips.innerHTML = "";
      body.innerHTML = `<p class="empty">통합 점수 기록을 쓰려면 Supabase에서 sql/033_dojo_score_log.sql을 실행해 주세요.</p>`;
      return;
    }
    const error = characterResult.error || logResult.error;
    if (error) {
      body.innerHTML = "";
      notify(translateDbError(error), "error");
      return;
    }
    characters = [...(characterResult.data ?? [])].sort((a, b) => (b.level ?? -1) - (a.level ?? -1) || a.name.localeCompare(b.name, "ko"));
    rows = logResult.data ?? [];
    paintChips();
    paintBody();
  }

  section.addEventListener("click", async (event) => {
    if (event.target.closest("[data-log-close]")) {
      section.closest("dialog")?.close();
      return;
    }
    const pick = event.target.closest("[data-log-pick]");
    if (pick) {
      picked = pick.dataset.logPick;
      open.clear();
      sfx("tick");
      paintChips();
      paintBody();
      return;
    }
    const dayButton = event.target.closest("[data-log-day]");
    if (dayButton) {
      const day = dayButton.dataset.logDay;
      if (open.has(day)) open.delete(day);
      else open.add(day);
      sfx("tick");
      paintBody();
      return;
    }
    const remove = event.target.closest("[data-log-delete]");
    if (remove) {
      const row = rows.find((item) => String(item.id) === remove.dataset.logDelete);
      if (!row || !window.confirm(`${timeText(row.recorded_at)}에 적은 ${formatCount(row.total)}점 기록을 지울까요? 그날·다음 날 번 점수 계산이 바뀝니다.`)) return;
      const supabase = await getSupabase();
      const { error } = await supabase.from("dojo_score_log").delete().eq("id", row.id);
      if (!section.isConnected) return;
      if (error) {
        notify(translateDbError(error), "error");
        return;
      }
      rows = rows.filter((item) => item !== row);
      // 지운 기록이 그 캐릭터의 마지막 기록이었으면, 무릉 화면 수련 점수를 남은 마지막 기록으로 맞춘다
      // (숙제 화면이 수련 점수를 통합 점수로도 읽기 때문에, 그대로 두면 지운 점수가 다시 보인다).
      const remaining = entriesOf(row.character_id).sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));
      const wasLatest = !remaining.some((item) => new Date(item.recorded_at) > new Date(row.recorded_at));
      if (wasLatest && remaining.length) {
        const synced = await supabase.from("dojo_records").update({ score: Number(remaining.at(-1).total) }).eq("character_id", row.character_id);
        if (synced.error) notify(translateDbError(synced.error), "error");
      }
      sfx("fail");
      notify(wasLatest && !remaining.length ? "기록을 지웠습니다. 무릉 화면의 수련 점수는 그대로라 필요하면 직접 고쳐 주세요." : "기록을 지웠습니다.", "info");
      paintChips();
      paintBody();
    }
  });

  return {
    async open(characterId) {
      if (characterId) picked = characterId;
      open.clear();
      const dialog = section.closest("dialog");
      if (dialog && !dialog.open) dialog.showModal();
      await load();
    },
  };
}
