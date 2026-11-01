import { getSupabase } from "./supabase-client.js";
import { translateDbError } from "./db-error.js";
export async function reviewRpc(name, args = {}) {
  try {
    const client = await getSupabase();
    return await client.rpc(name, args);
  } catch (error) { return { data: null, error }; }
}
export async function canReviewCatalog() {
  const {data,error} = await reviewRpc("can_review_catalog");
  return !error && data === true;
}
export function reviewError(error) {
  const message = error?.message || "";
  if (error?.code === "42501" || /검토 권한/.test(message)) return "이 계정에는 검토 권한이 없습니다.";
  if (error?.code === "40001") return "다른 화면에서 수정되었습니다. 입력은 유지했습니다. 다시 불러온 뒤 비교해 주세요.";
  if (/schema cache|does not exist|Could not find the function/i.test(message)) return "검토 보관함이 아직 준비되지 않았습니다. 운영 설정을 확인해 주세요.";
  return translateDbError(error);
}
