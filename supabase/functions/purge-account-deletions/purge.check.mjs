import assert from "node:assert/strict";
import { isAuthorized, purgeDeletedAccounts } from "./purge.js";

// 가짜 Supabase: 탈퇴 대기 목록, 인증 사용자, 버킷 파일(경로 → 있음)
function fake({ deletions, users, files, failRemoveFor = null, failDeleteFor = null }) {
  const calls = { removed: [], deletedUsers: [] };
  const storage = {
    async list(prefix, { limit, offset }) {
      const all = [...files];
      let entries;
      if (!prefix) entries = [...new Set(all.map((p) => p.split("/")[0]))].map((name) => ({ name, id: null }));
      else entries = all.filter((p) => p.startsWith(`${prefix}/`)).map((p) => ({ name: p.slice(prefix.length + 1), id: `f-${p}` }));
      return { data: entries.slice(offset, offset + limit), error: null };
    },
    async remove(paths) {
      if (failRemoveFor && paths.some((p) => p.startsWith(failRemoveFor))) return { error: { message: "remove failed" } };
      for (const p of paths) files.delete(p);
      calls.removed.push(...paths);
      return { data: paths, error: null };
    },
  };
  const admin = {
    storage: { from: () => storage },
    from: () => ({ select: () => ({ lte: async (_col, iso) => ({ data: deletions.filter((d) => d.delete_after <= iso).map((d) => ({ user_id: d.user_id })), error: null }) }) }),
    auth: { admin: {
      async deleteUser(id) {
        if (id === failDeleteFor) return { error: { message: "delete failed" } };
        users.delete(id);
        calls.deletedUsers.push(id);
        return { data: {}, error: null };
      },
      async getUserById(id) {
        return users.has(id) ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { status: 404, message: "User not found" } };
      },
    } },
  };
  return { admin, calls, files, users };
}

const A = "aaaaaaaa-0000-4000-8000-000000000001"; // 유예 끝남
const B = "bbbbbbbb-0000-4000-8000-000000000002"; // 아직 유예 중
const C = "cccccccc-0000-4000-8000-000000000003"; // 계정 없음(예전 SQL 삭제로 남은 파일)
const D = "dddddddd-0000-4000-8000-000000000004"; // 일반 사용자
const now = new Date("2026-11-08T03:00:00Z");

{
  const t = fake({
    deletions: [{ user_id: A, delete_after: "2026-11-08T00:00:00.000Z" }, { user_id: B, delete_after: "2026-11-10T00:00:00.000Z" }],
    users: new Set([A, B, D]),
    files: new Set([`${A}/c1.png`, `${A}/c2.webp`, `${B}/c3.png`, `${C}/old.png`, `${D}/c4.png`, "not-a-uuid/x.png"]),
  });
  const r = await purgeDeletedAccounts(t.admin, now);
  assert.deepEqual(r.deleted, [A]);
  assert.deepEqual(r.orphanFolders, [C]);
  assert.equal(r.files, 3);
  assert.deepEqual(r.failed, []);
  // 유예 중(B)·일반 사용자(D)·사용자 ID가 아닌 폴더 파일은 그대로
  assert.deepEqual([...t.files].sort(), [`${B}/c3.png`, `${D}/c4.png`, "not-a-uuid/x.png"].sort());
  assert.deepEqual([...t.users].sort(), [B, D].sort());
}

{
  // 이미지 삭제 실패 → 계정을 지우지 않고 다음 날 다시
  const t = fake({ deletions: [{ user_id: A, delete_after: "2026-11-01T00:00:00.000Z" }], users: new Set([A]), files: new Set([`${A}/c1.png`]), failRemoveFor: A });
  const r = await purgeDeletedAccounts(t.admin, now);
  assert.deepEqual(r.deleted, []);
  assert.equal(r.failed[0].step, "faces");
  assert.ok(t.users.has(A));
}

{
  // 계정 삭제 실패 → 실패로 보고(파일은 이미 지움), 예외 없이 끝남
  const t = fake({ deletions: [{ user_id: A, delete_after: "2026-11-01T00:00:00.000Z" }], users: new Set([A]), files: new Set([`${A}/c1.png`]), failDeleteFor: A });
  const r = await purgeDeletedAccounts(t.admin, now);
  assert.equal(r.failed[0].step, "user");
  assert.equal(t.files.size, 0);
}

{
  // 파일 1000개 넘는 폴더도 끝까지 지운다(나눠 부르기)
  const many = new Set(Array.from({ length: 2345 }, (_, i) => `${A}/c${i}.png`));
  const t = fake({ deletions: [{ user_id: A, delete_after: "2026-11-01T00:00:00.000Z" }], users: new Set([A]), files: many });
  const r = await purgeDeletedAccounts(t.admin, now);
  assert.equal(r.files, 2345);
  assert.equal(t.files.size, 0);
}
// 비밀값 확인: 같을 때만 통과, 없거나 다르거나 비밀이 비었으면 거절
{
  const secret = "a".repeat(64);
  assert.equal(isAuthorized(secret, secret), true);
  assert.equal(isAuthorized(null, secret), false);
  assert.equal(isAuthorized("", secret), false);
  assert.equal(isAuthorized(secret.slice(0, 63), secret), false);
  assert.equal(isAuthorized(secret + "a", secret), false);
  assert.equal(isAuthorized("b" + secret.slice(1), secret), false);
  assert.equal(isAuthorized("", ""), false);
  assert.equal(isAuthorized("short", "short"), false);
  assert.equal(isAuthorized(secret, undefined), false);
}
console.log("탈퇴 계정·얼굴 이미지 삭제 검증 통과");
