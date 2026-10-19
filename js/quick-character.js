// 이름만으로 캐릭터 만들기(2026-10-19 사용자 요청): 캐릭터가 없는 채로 무릉 기록을 저장하려 할 때 쓴다.
// 계정은 자리(6명)가 남은 첫 계정, 없으면 새로 만든다. 서버는 메이플랜드. 직업·레벨은 나중에 캐릭터 관리에서 채운다.
// homeworkKeys: 이 캐릭터를 바로 보이게 할 숙제(homework_members, sql/031). 퀘스트는 quests_hidden 기본값(false)이라 따로 할 일이 없다.

export const QUICK_SERVER = "메이플랜드";
const ACCOUNT_LIMIT = 6;

function missingTable(error) {
  const raw = `${error?.message || ""} ${error?.code || ""}`;
  return /does not exist|schema cache|could not find|42P01|PGRST205/i.test(raw);
}

/** 결과: { character, account, createdAccount } 또는 { error } (error 는 화면에 보일 문장) */
export async function createQuickCharacter(supabase, rawName, { homeworkKeys = [] } = {}) {
  const name = String(rawName ?? "").trim();
  if (!name) return { error: "캐릭터 이름을 적어 주세요." };
  if (name.length > 30) return { error: "캐릭터 이름이 너무 깁니다." };
  const [accountResult, characterResult] = await Promise.all([
    supabase.from("accounts").select("id, name").order("name"),
    supabase.from("characters").select("id, account_id, name"),
  ]);
  if (accountResult.error || characterResult.error) return { dbError: accountResult.error || characterResult.error };
  const characters = characterResult.data ?? [];
  if (characters.some((character) => character.name === name)) return { error: `이미 "${name}" 캐릭터가 있어요. 목록에서 골라 주세요.` };
  const counts = new Map();
  for (const character of characters) counts.set(character.account_id, (counts.get(character.account_id) ?? 0) + 1);
  const accounts = accountResult.data ?? [];
  let account = accounts.find((item) => (counts.get(item.id) ?? 0) < ACCOUNT_LIMIT) ?? null;
  let createdAccount = false;
  if (!account) {
    const accountName = accounts.length ? `계정 ${accounts.length + 1}` : "본계정";
    const created = await supabase.from("accounts").insert({ name: accountName }).select("id, name").single();
    if (created.error) return { dbError: created.error };
    account = created.data;
    createdAccount = true;
  }
  const inserted = await supabase
    .from("characters")
    .insert({ account_id: account.id, server: QUICK_SERVER, name })
    .select("id, account_id, name, job, level")
    .single();
  if (inserted.error) return { dbError: inserted.error };
  const character = inserted.data;
  for (const key of homeworkKeys) {
    const linked = await supabase.from("homework_members").upsert({ character_id: character.id, task_key: key }, { onConflict: "character_id,task_key" });
    // sql/031 전이면 표가 없다. 그때는 원래 모든 캐릭터가 보이므로 넘어간다.
    if (linked.error && !missingTable(linked.error)) return { character, account, createdAccount, warning: linked.error };
  }
  return { character, account, createdAccount };
}
