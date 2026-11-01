// 탈퇴 7일 유예가 지난 계정 삭제(2026-11-01). 얼굴 이미지는 Storage API로 지워야 실제 파일이 사라진다
// (SQL로 storage.objects 행만 지우면 파일이 버킷에 남는다 — Supabase "Delete Objects" 문서).
// 순서: 이미지 파일 삭제 → 성공했을 때만 인증 계정 삭제(서비스 기록은 cascade). 실패한 계정은 다음 날 다시 시도한다.
// 이어서 계정이 이미 없는데 남아 있는 이미지 폴더(예전 SQL 삭제로 남은 파일)도 지운다.

export const FACE_BUCKET = "character-faces";

// 예약 작업만 부르게: 요청 헤더 x-cron-secret 이 함수 비밀 CRON_SECRET 과 같아야 한다(JWT 확인은 끔).
// 비밀이 비었거나 짧으면 항상 거절한다. 길이·내용 비교에 걸리는 시간을 같게 해 추측을 어렵게 한다.
export function isAuthorized(given, secret) {
  if (typeof secret !== "string" || secret.length < 32 || typeof given !== "string") return false;
  const encoder = new TextEncoder();
  const a = encoder.encode(given);
  const b = encoder.encode(secret);
  let diff = a.length ^ b.length;
  for (let index = 0; index < b.length; index += 1) diff |= (a[index] ?? 0) ^ b[index];
  return diff === 0;
}
const PAGE = 1000;

async function listAll(storage, prefix) {
  const names = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await storage.list(prefix, { limit: PAGE, offset });
    if (error) return { error };
    names.push(...(data ?? []));
    if (!data || data.length < PAGE) return { data: names };
  }
}

// 한 사용자 폴더(`사용자ID/`)의 파일을 모두 지운다. 지운 개수 또는 error.
export async function removeUserFaces(storage, userId) {
  const listed = await listAll(storage, userId);
  if (listed.error) return { error: listed.error };
  const paths = listed.data.filter((item) => item.id).map((item) => `${userId}/${item.name}`);
  for (let index = 0; index < paths.length; index += PAGE) {
    const { error } = await storage.remove(paths.slice(index, index + PAGE));
    if (error) return { error };
  }
  return { removed: paths.length };
}

// admin = 서비스 키로 만든 supabase 클라이언트(브라우저에 두지 않는다). now = 기준 시각(Date).
export async function purgeDeletedAccounts(admin, now = new Date()) {
  const storage = admin.storage.from(FACE_BUCKET);
  const report = { deleted: [], failed: [], orphanFolders: [], files: 0 };

  const due = await admin.from("account_deletions").select("user_id").lte("delete_after", now.toISOString());
  if (due.error) throw new Error(`탈퇴 대기 목록을 읽지 못함: ${due.error.message}`);
  for (const { user_id: userId } of due.data ?? []) {
    const faces = await removeUserFaces(storage, userId);
    if (faces.error) {
      report.failed.push({ userId, step: "faces", message: faces.error.message });
      continue;
    }
    report.files += faces.removed;
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      report.failed.push({ userId, step: "user", message: error.message });
      continue;
    }
    report.deleted.push(userId);
  }

  // 남은 고아 폴더: 폴더 이름이 사용자 ID인데 그 계정이 없으면 지운다. 계정이 있으면 손대지 않는다.
  const roots = await listAll(storage, "");
  if (roots.error) {
    report.failed.push({ step: "list", message: roots.error.message });
    return report;
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const folder of roots.data.filter((item) => !item.id && uuid.test(item.name))) {
    const user = await admin.auth.admin.getUserById(folder.name);
    if (user.data?.user) continue;
    if (user.error && !/not.?found|user_not_found|404/i.test(`${user.error.status ?? ""} ${user.error.code ?? ""} ${user.error.message ?? ""}`)) {
      report.failed.push({ userId: folder.name, step: "orphan-check", message: user.error.message });
      continue;
    }
    const faces = await removeUserFaces(storage, folder.name);
    if (faces.error) report.failed.push({ userId: folder.name, step: "orphan-faces", message: faces.error.message });
    else {
      report.files += faces.removed;
      report.orphanFolders.push(folder.name);
    }
  }
  return report;
}
