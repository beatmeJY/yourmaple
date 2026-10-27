import { bosses } from "./boss-cooldown.js";
import { DOJO_DAILY_GOAL, homeworkLevelAllowed, RAIDS, dojoProgress, homeworkState } from "./homework-calc.js";

// 캐릭터 카드에 붙이는 숙제 요약: 숙제 체크리스트와 같은 기준(할 수 있는 캐릭터·숨긴 숙제·완료 판단)으로 읽기만 한다.
// 표가 아직 없으면(sql/030·031·033 실행 전) 그 부분만 빼고 보여 준다.

const BOSS_SHORT = { papulatus: "파풀", rift: "차균조", pianus: "피아" };
const BOSS_ORDER = ["papulatus", "rift", "pianus"];
const BOSS_KIND = { papulatus: "after24h", rift: "after24h", pianus: "after7d" };

function rowsOf(result) {
  return result.error ? [] : (result.data ?? []);
}

export async function loadHomeworkStatus(supabase) {
  const [bossResult, taskResult, checkResult, memberResult, prefResult, dojoResult] = await Promise.all([
    supabase.from("characters").select("id, level, pianus_enabled, pianus_at, papulatus_enabled, papulatus_at, rift_enabled, rift_at"),
    supabase.from("homework_tasks").select("id, name, reset_kind, sort_order, created_at").order("sort_order").order("created_at"),
    supabase.from("homework_checks").select("character_id, task_key, checked_at"),
    supabase.from("homework_members").select("character_id, task_key"),
    supabase.from("homework_prefs").select("hidden_tasks"),
    supabase.from("dojo_score_log").select("character_id, total, kind, recorded_at").order("recorded_at"),
  ]);
  const bossRows = new Map(rowsOf(bossResult).map((row) => [row.id, row]));
  const tablesReady = !taskResult.error && !checkResult.error;
  const membersReady = !memberResult.error;
  const members = new Set(rowsOf(memberResult).map((row) => `${row.character_id}:${row.task_key}`));
  const hidden = new Set(rowsOf(prefResult)[0]?.hidden_tasks ?? []);
  const checks = new Map(rowsOf(checkResult).map((row) => [`${row.character_id}:${row.task_key}`, row.checked_at]));
  const dojoLog = new Map();
  for (const row of rowsOf(dojoResult)) {
    if (!dojoLog.has(row.character_id)) dojoLog.set(row.character_id, []);
    dojoLog.get(row.character_id).push(row);
  }
  const tasks = [
    ...BOSS_ORDER.map((key) => ({ key, short: BOSS_SHORT[key], name: bosses.find((boss) => boss.key === key).label, kind: BOSS_KIND[key], boss: bosses.find((boss) => boss.key === key) })),
    // 자쿰·혼테일·핑크빈은 모드마다 칩 하나(막아 둔 모드 제외). 표시 캐릭터·숨기기는 보스(group) 기준.
    ...(tablesReady
      ? RAIDS.flatMap((raid) => raid.modes.filter((mode) => !mode.disabled).map((mode) => ({ key: mode.key, group: raid.key, short: mode.short, name: raid.modes.length > 1 ? `${raid.name} ${mode.label}` : raid.name, kind: raid.kind, minLevel: raid.minLevel, maxLevel: raid.maxLevel })))
      : []),
    ...(tablesReady ? [{ key: "dojo", short: "무릉", name: "무릉도장", kind: "daily" }] : []),
    ...(tablesReady ? rowsOf(taskResult).map((task) => ({ key: String(task.id), short: task.name, name: task.name, kind: task.reset_kind, custom: true })) : []),
  ].filter((task) => !hidden.has(task.group ?? task.key));

  /** 그 캐릭터가 할 숙제 [{ key, short, name, done, next }] */
  return function statusFor(characterId, now = Date.now()) {
    const bossRow = bossRows.get(characterId) ?? {};
    return tasks
      .filter((task) => homeworkLevelAllowed(task, bossRow.level) && (task.boss ? Boolean(bossRow[task.boss.columnEnabled]) : !membersReady || members.has(`${characterId}:${task.group ?? task.key}`)))
      .map((task) => {
        const checkedAt = task.boss ? bossRow[task.boss.columnAt] : checks.get(`${characterId}:${task.key}`);
        let state = homeworkState(task.kind, checkedAt ?? null, now);
        if (task.key === "dojo" && !state.done && (dojoProgress(dojoLog.get(characterId), now).today ?? 0) >= DOJO_DAILY_GOAL) {
          state = homeworkState("daily", now, now);
        }
        return { key: task.key, short: task.short, name: task.name, custom: Boolean(task.custom), done: state.done, next: state.next };
      });
  };
}
