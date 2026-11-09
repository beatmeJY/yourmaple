import { ZONES } from "./monster-park-calc.js";
import { getSupabase } from "./supabase-client.js";

const table = "monster_park_settings";
const columns = "low,mid,high";

export function zoneExpValues(row = null) {
  return Object.fromEntries(ZONES.map(({ id, exp }) => [id, row ? BigInt(row[id]) : exp]));
}

export async function loadParkSettings() {
  try {
    const client = await getSupabase();
    const { data, error } = await client.from(table).select(columns).eq("singleton", true).single();
    if (!error && data) return { zoneExp: zoneExpValues(data), editable: true };
    // SQL 적용 전에는 서버 설정이 없으므로 기존 공식 기본값을 사용한다.
    if (["42P01", "PGRST205"].includes(error?.code)) return { zoneExp: zoneExpValues(), editable: false };
    return { error: error ?? new Error("몬스터파크 설정이 없습니다.") };
  } catch (error) {
    return { error };
  }
}

export async function saveParkSettings(values) {
  const client = await getSupabase();
  return client.from(table).update(values).eq("singleton", true).select(columns).single();
}
