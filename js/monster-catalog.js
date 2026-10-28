import { loadCatalog } from "./catalog.js";

// 이름은 저장하지 않고 아이템 FK를 조인한 응답에서만 가져옵니다.
export async function loadMonsterCatalog(client) {
  const result = await loadCatalog("catalog_monsters", "id,name,level,hp,exp,required_accuracy,hp_per_exp,accuracy_per_level,weak_elements,resist_elements,updated_at,image_url,source_id", client);
  if (result.error) return result;
  const drops = [];
  for (let offset = 0;; offset += 500) {
    const response = await client.from("catalog_monster_drops")
      .select("id,monster_id,item_id,source_entry,rate_percent,rate_text,item:catalog_items(id,name,image_url)")
      .order("id", { ascending: true }).range(offset, offset + 499);
    if (response.error) return { data: null, error: response.error };
    drops.push(...(response.data ?? []));
    if (!response.data || response.data.length < 500) break;
  }
  const grouped = new Map();
  for (const drop of drops) {
    const entries = grouped.get(drop.monster_id) ?? [];
    entries.push(drop);
    grouped.set(drop.monster_id, entries);
  }
  return { data: result.data.map(row => {
    const entries = (grouped.get(row.id) ?? []).sort((a, b) => a.source_entry - b.source_entry);
    return { ...row, drops: entries, drop_search: entries.map(d => d.item?.name ?? "").join(" · ") };
  }), error: null };
}
