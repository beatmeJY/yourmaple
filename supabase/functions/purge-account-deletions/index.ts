// Supabase Edge Function: purge-account-deletions
// 매일 pg_cron(sql/056)이 부른다. 서비스 키는 Edge Function 환경 변수로만 쓰고 저장소·브라우저에 두지 않는다.
// Verify JWT 는 끄고, 대신 x-cron-secret 헤더를 함수 비밀 CRON_SECRET 과 비교한다(Supabase 권장 방식).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { isAuthorized, purgeDeletedAccounts } from "./purge.js";

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response("POST only", { status: 405 });
  if (!isAuthorized(request.headers.get("x-cron-secret"), Deno.env.get("CRON_SECRET"))) {
    return new Response("unauthorized", { status: 401 });
  }
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const report = await purgeDeletedAccounts(admin);
    // 사용자 ID는 응답에 개수만 남긴다(로그 노출 최소화).
    const body = { deleted: report.deleted.length, files: report.files, orphanFolders: report.orphanFolders.length, failed: report.failed.map(({ step, message }) => ({ step, message })) };
    console.log(JSON.stringify(body));
    return new Response(JSON.stringify(body), { status: report.failed.length ? 207 : 200, headers: { "Content-Type": "application/json" } });
  } catch (error) {
    console.error(String(error));
    return new Response(JSON.stringify({ error: String(error) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
