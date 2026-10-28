import { getSupabase } from "./supabase-client.js";
import { translateDbError } from "./db-error.js";

export function catalogError(error) {
  if (/catalog_search_|catalog_item_detail|catalog_changes/i.test(`${error?.message} ${error?.details}`) && /schema cache|could not find|does not exist/i.test(`${error?.message} ${error?.details}`)) return "도감 검색·변경 이력을 준비 중입니다. 운영자가 SQL047을 실행해야 합니다.";
  if (/catalog_|item_snapshot|item_options|item_id|replace_my_trades_v2/i.test(`${error?.message} ${error?.details}`) && /schema cache|could not find|does not exist/i.test(`${error?.message} ${error?.details}`)) return "공용 도감을 준비 중입니다. 운영자가 sql/038_shared_game_catalog.sql을 실행해야 합니다.";
  return translateDbError(error);
}

// Supabase 기본 응답 개수 제한으로 도감 일부가 빠지지 않도록 나눠 읽는다.
export async function loadCatalog(table, columns = "*", supabase = null) {
  if (!["catalog_monsters", "catalog_items"].includes(table)) throw new Error("알 수 없는 도감입니다.");
  const client = supabase ?? await getSupabase();
  const rows = [];
  const size = 500;
  for (let offset = 0;; offset += size) {
    const { data, error } = await client.from(table).select(columns).order("id", { ascending: true }).range(offset, offset + size - 1);
    if (error) return { data: null, error };
    rows.push(...(data ?? []));
    if (!data || data.length < size) return { data: rows, error: null };
  }
}
