// 배포 전 검증 묶음: 브라우저 없이 도는 검사를 모두 돌리고 하나라도 실패하면 1로 끝낸다.
// - js/*.check.mjs: 계산·표시 규칙 검사(전부)
// - tools/*.check.mjs: 브라우저(playwright)가 필요한 화면 검사는 로컬 전용이라 건너뛰고,
//   임시 Postgres(PGlite)로 SQL을 실행하는 DB 검사는 PGlite가 있을 때 돌린다.
// 사용: node tools/run-checks.mjs   (PGlite 위치는 PGLITE_MODULE 환경 변수로 바꿀 수 있다)
// GitHub Actions(CI=true)에서는 PGlite가 없으면 건너뛰지 않고 실패로 본다.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const inCi = process.env.CI === "true";

const list = (dir) =>
  readdirSync(join(root, dir))
    .filter((name) => name.endsWith(".check.mjs"))
    .sort()
    .map((name) => `${dir}/${name}`);

// 다른 검사 파일을 불러오기만 하는 검사(예: catalog-cleanup-ui → catalog-pages-ui)는 불러온 파일 기준으로 본다.
function needsBrowser(file, seen = new Set()) {
  if (seen.has(file)) return false;
  seen.add(file);
  const source = readFileSync(join(root, file), "utf8");
  if (/playwright/.test(source)) return true;
  const imported = [...source.matchAll(/import\s+["']\.\/([\w.-]+\.check\.mjs)["']/g)].map((match) => `${dirname(file)}/${match[1]}`);
  return imported.some((next) => needsBrowser(next, seen));
}
const needsPglite = (file) => /pglite/i.test(readFileSync(join(root, file), "utf8"));

async function pgliteAvailable() {
  try {
    await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
    return true;
  } catch {
    return false;
  }
}

const hasPglite = await pgliteAvailable();
const toolChecks = list("tools");
const browserOnly = toolChecks.filter((file) => needsBrowser(file));
const dbChecks = toolChecks.filter((file) => !needsBrowser(file) && needsPglite(file));
const plainTools = toolChecks.filter((file) => !needsBrowser(file) && !needsPglite(file));

if (!hasPglite && dbChecks.length && inCi) {
  console.error("PGlite를 불러오지 못했습니다. CI에서는 DB 검사를 건너뛸 수 없습니다.");
  process.exit(1);
}

const targets = [...list("js"), ...plainTools, ...(hasPglite ? dbChecks : [])];
const failed = [];
const started = Date.now();

for (const file of targets) {
  const t0 = Date.now();
  const result = spawnSync(process.execPath, [file], { cwd: root, encoding: "utf8", env: process.env });
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  if (result.status === 0) {
    console.log(`✓ ${file} (${seconds}s)`);
  } else {
    failed.push(file);
    console.log(`✗ ${file} (${seconds}s, 종료 코드 ${result.status ?? result.signal})`);
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    if (output) console.log(output.split("\n").slice(-30).map((line) => `    ${line}`).join("\n"));
  }
}

console.log("");
console.log(`검사 ${targets.length}개 중 통과 ${targets.length - failed.length}개, 실패 ${failed.length}개 (${((Date.now() - started) / 1000).toFixed(1)}s)`);
if (!hasPglite && dbChecks.length) console.log(`PGlite가 없어 DB 검사 ${dbChecks.length}개를 건너뜀: ${dbChecks.join(", ")}`);
console.log(`브라우저가 필요한 화면 검사 ${browserOnly.length}개는 로컬 전용이라 건너뜀`);
if (failed.length) {
  console.log(`실패: ${failed.join(", ")}`);
  process.exit(1);
}
