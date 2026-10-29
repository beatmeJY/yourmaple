import { getSupabase } from "./supabase-client.js";

// 공용 도감 응답만 짧게 보관합니다. 계정/거래 응답은 이 캐시를 사용하지 않습니다.
const cache = new Map();
let revision = 0;
export function clearCatalogCache() { cache.clear(); }
export async function catalogRpc(name, args = {}, client = null, fresh = false) {
  if (!["catalog_search_items", "catalog_search_monsters", "catalog_item_detail", "catalog_monster_detail"].includes(name)) throw new Error("공용 도감 조회만 캐시할 수 있습니다.");
  const key = JSON.stringify([name, args]);
  const entry = cache.get(key);
  if (!fresh && entry && Date.now() - entry.time < 30_000) return structuredClone(entry.result);
  const supabase = client ?? await getSupabase();
  const result = await supabase.rpc(name, args);
  if (!result.error && !(result.data?.revision && result.data.revision < revision)) {
    if (result.data?.revision > revision) { cache.clear(); revision = result.data.revision; }
    cache.set(key, { time: Date.now(), result: structuredClone(result) });
    while (cache.size > 40) cache.delete(cache.keys().next().value);
  }
  return result;
}

export async function monsterDrops(id, client = null) {
  const supabase = client ?? await getSupabase();
  // 선택한 몬스터만 읽습니다. 드랍 순번은 중복 아이템을 합치지 않습니다.
  const rows = [];
  for (let offset = 0;; offset += 200) {
    const result = await supabase.from("catalog_monster_drops")
      .select("id,item_id,source_entry,rate_percent,item:catalog_items(id,name,image_url)")
      .eq("monster_id", id).order("source_entry", { ascending: true }).range(offset, offset + 199);
    if (result.error) return result;
    rows.push(...(result.data ?? []));
    if (!result.data || result.data.length < 200) return { data: rows, error: null };
  }
}

export async function itemDropPage(id, page = 0, client = null) {
  const supabase = client ?? await getSupabase();
  const offset = Math.max(0, Math.min(Number.isSafeInteger(page) ? page : 0, 10000)) * 24;
  // 선택한 아이템만 조회합니다. 다음 페이지 유무를 알기 위한 한 행만 더 읽습니다.
  const result = await supabase.from("catalog_monster_drops")
    .select("id,source_entry,rate_percent,monster:catalog_monsters(id,name,level,source_id,image_url)")
    .eq("item_id", id).order("monster_id", { ascending: true })
    .order("source_entry", { ascending: true }).order("id", { ascending: true })
    .range(offset, offset + 24);
  if (result.error) return result;
  return { data: (result.data ?? []).slice(0, 24), hasMore: (result.data?.length ?? 0) > 24, error: null };
}
