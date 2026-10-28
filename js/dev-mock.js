// 로컬 전용 가짜 DB(2026-10-20 사용자 요청): Google·Discord 로그인 없이 화면을 확인한다.
// 127.0.0.1·localhost 에서 주소에 ?mock(로그인된 상태) 또는 ?mock=guest(로그인 전)를 붙이면 켜진다. ?mock=0 이면 끈다.
// ?mock=reset 은 샘플 데이터로 다시 시작한다. 데이터는 이 브라우저 localStorage(ym-mock-db)에만 저장되고 실제 Supabase 는 부르지 않는다.
// supabase-js 중 이 앱이 쓰는 만큼만 흉내 낸다: from().select/insert/update/upsert/delete + eq/neq/in/gte/lte/is/order/limit/single/maybeSingle,
// 조인은 select 의 accounts(...)·jobs(...) 처럼 "표이름(칸)"을 그 표의 단수형_id 로 붙인다. rpc·storage·auth 도 최소한만.

const DB_KEY = "ym-mock-db";
const AUTH_KEY = "ym-mock-auth"; // "in" | "out"
const USER = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "mock@yourmaple.local",
  user_metadata: { full_name: "목업 사용자" },
  identities: [{ provider: "google" }],
  app_metadata: { providers: ["google"] },
};

function iso(offsetHours = 0) {
  return new Date(Date.now() + offsetHours * 3_600_000).toISOString();
}

function seed() {
  const accountMain = "a0000000-0000-4000-8000-000000000001";
  const accountSub = "a0000000-0000-4000-8000-000000000002";
  const character = (id, accountId, name, jobId, job, level, extra = {}) => ({
    id, user_id: USER.id, account_id: accountId, server: "메이플랜드", name, job, job_id: jobId, level, exp: null, main_hunt_id: null,
    gear_memo: null, extra_memo: null, quests_hidden: false, face_path: null,
    pianus_enabled: false, pianus_at: null, papulatus_enabled: false, papulatus_at: null, rift_enabled: false, rift_at: null,
    created_at: iso(-200), updated_at: iso(-1), ...extra,
  });
  return {
    jobs: [
      { id: "hero", family: "warrior", rank: 4, name: "히어로", color: "#ff7a5c", color_dark: "#c2412d", sort_order: 1 },
      { id: "bishop", family: "magician", rank: 4, name: "비숍", color: "#7cc4ff", color_dark: "#2563eb", sort_order: 2 },
      { id: "bowmaster", family: "archer", rank: 4, name: "보우마스터", color: "#8ff0c4", color_dark: "#15803d", sort_order: 3 },
      { id: "nightlord", family: "thief", rank: 4, name: "나이트로드", color: "#c9a6ff", color_dark: "#7c3aed", sort_order: 4 },
    ],
    profiles: [{ id: USER.id, display_name: "목업 사용자", main_character_id: "c0000000-0000-4000-8000-000000000001" }],
    accounts: [
      { id: accountMain, user_id: USER.id, name: "본계정", created_at: iso(-300) },
      { id: accountSub, user_id: USER.id, name: "부계정", created_at: iso(-300) },
    ],
    characters: [
      character("c0000000-0000-4000-8000-000000000001", accountMain, "단풍전사", "hero", "히어로", 118, { exp: "1500000", papulatus_enabled: true, papulatus_at: iso(-3), pianus_enabled: true }),
      character("c0000000-0000-4000-8000-000000000002", accountMain, "힐러짱", "bishop", "비숍", 96, { papulatus_enabled: true, papulatus_at: iso(-23.5), rift_enabled: true }),
      character("c0000000-0000-4000-8000-000000000003", accountMain, "표창던지기", "nightlord", "나이트로드", 74, { rift_enabled: true, rift_at: iso(-2) }),
      character("c0000000-0000-4000-8000-000000000004", accountSub, "화살비", "bowmaster", "보우마스터", 88, { rift_enabled: true }),
    ],
    homework_members: [
      { id: "m1", user_id: USER.id, character_id: "c0000000-0000-4000-8000-000000000001", task_key: "dojo" },
      { id: "m2", user_id: USER.id, character_id: "c0000000-0000-4000-8000-000000000002", task_key: "dojo" },
      { id: "m3", user_id: USER.id, character_id: "c0000000-0000-4000-8000-000000000001", task_key: "zakum" },
    ],
    homework_checks: [{ id: "h1", user_id: USER.id, character_id: "c0000000-0000-4000-8000-000000000001", task_key: "zakum-normal", checked_at: iso(-5) }],
    homework_tasks: [],
    homework_prefs: [],
    dojo_records: [
      { id: "d1", user_id: USER.id, character_id: "c0000000-0000-4000-8000-000000000001", character_name: "단풍전사", party: false, floors: { 1: 60, 6: 80, 11: 110, 16: 150, 21: 200, 26: 120 }, score: 4100, runs: { "": 760 }, memo: null, created_at: iso(-48), updated_at: iso(-20) },
    ],
    dojo_score_log: [],
    dojo_belt_prices: [{ id: "p1", user_id: USER.id, belt: "white", price: "180000", created_at: iso(-30) }],
    notes: [{ id: "n1", user_id: USER.id, title: "목업 메모", content: "?mock 으로 연 가짜 데이터입니다.", category: "일반", created_at: iso(-10), updated_at: iso(-10) }],
    catalog_monsters: [{ id: "d0000000-0000-4000-8000-000000000001", name: "연습용 달팽이", level: 1, hp: 15, exp: 3, required_accuracy: 1, accuracy_per_level: 0.1, weak_elements: null, resist_elements: null }],
    catalog_items: [{ id: "e0000000-0000-4000-8000-000000000001", name: "연습용 아대", category: "아대", base_options: { attack: 30, remaining_upgrades: 7 }, requirements: { 레벨: 50 }, image_url: null }],
    catalog_monster_drops: [],
    hunts: [], level_exp: [], quests: [], character_quests: [], quest_notes: [], monsters: [], links: [], trades: [],
    maker_gem_prices: [], enhance_profiles: [], account_deletions: [],
  };
}

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장이 막히면 이번 화면에서만 유지된다.
  }
}

let db = null;
function tables() {
  db ??= readJson(DB_KEY) ?? seed();
  return db;
}
function save() {
  writeJson(DB_KEY, db);
}
function rowsOf(table) {
  const all = tables();
  all[table] ??= [];
  return all[table];
}

export function resetMockDb() {
  db = seed();
  save();
}

// select("id, name, accounts(name), jobs(name, color)") 에서 조인할 표 이름만 뽑는다.
function joinsOf(columns) {
  return [...String(columns || "").matchAll(/([a-z_]+)\s*\(/g)].map((match) => match[1]);
}

function withJoins(row, joins) {
  if (!joins.length) return { ...row };
  const out = { ...row };
  for (const join of joins) {
    const foreignKey = `${join.replace(/s$/, "")}_id`;
    const target = rowsOf(join).find((item) => item.id === row[foreignKey]);
    out[join] = target ? { ...target } : null;
  }
  return out;
}

function compare(left, right) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right));
}

class Query {
  constructor(table) {
    this.table = table;
    this.action = "select";
    this.payload = null;
    this.options = {};
    this.filters = [];
    this.sorts = [];
    this.limitCount = null;
    this.rangeStart = 0;
    this.columns = "*";
    this.returning = false;
    this.mode = "many";
  }

  select(columns = "*") {
    this.columns = columns;
    if (this.action !== "select") this.returning = true;
    return this;
  }
  insert(payload) {
    this.action = "insert";
    this.payload = payload;
    return this;
  }
  update(payload) {
    this.action = "update";
    this.payload = payload;
    return this;
  }
  upsert(payload, options = {}) {
    this.action = "upsert";
    this.payload = payload;
    this.options = options;
    return this;
  }
  delete() {
    this.action = "delete";
    return this;
  }
  eq(column, value) {
    this.filters.push((row) => String(row[column]) === String(value));
    return this;
  }
  neq(column, value) {
    this.filters.push((row) => String(row[column]) !== String(value));
    return this;
  }
  in(column, values) {
    const set = new Set((values ?? []).map(String));
    this.filters.push((row) => set.has(String(row[column])));
    return this;
  }
  gte(column, value) {
    this.filters.push((row) => compare(row[column], value) >= 0);
    return this;
  }
  lte(column, value) {
    this.filters.push((row) => compare(row[column], value) <= 0);
    return this;
  }
  is(column, value) {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }
  match(values) {
    for (const [column, value] of Object.entries(values ?? {})) this.eq(column, value);
    return this;
  }
  order(column, { ascending = true } = {}) {
    this.sorts.push({ column, ascending });
    return this;
  }
  limit(count) {
    this.limitCount = count;
    return this;
  }
  range(start, end) { this.rangeStart = start; this.limitCount = end - start + 1; return this; }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  matches(row) {
    return this.filters.every((filter) => filter(row));
  }

  prepare(row) {
    const now = new Date().toISOString();
    const next = { id: crypto.randomUUID(), created_at: now, updated_at: now, ...row };
    if (this.table !== "jobs" && this.table !== "profiles" && !next.user_id) next.user_id = USER.id;
    if (this.table === "account_deletions") {
      next.user_id = USER.id;
      next.requested_at = now;
      next.delete_after = new Date(Date.now() + 7 * 86_400_000).toISOString();
    }
    return next;
  }

  run() {
    if ((["catalog_monsters", "catalog_items", "catalog_monster_drops", "catalog_changes", "catalog_revision", "catalog_item_stats", "catalog_item_requirements", "catalog_item_jobs", "catalog_item_source_attributes"].includes(this.table) && this.action !== "select") || this.table === "catalog_monster_reviews") return { data: null, error: { message: "permission denied for shared catalog", code: "42501" } };
    const rows = rowsOf(this.table);
    let result = [];
    if (this.action === "select") {
      result = rows.filter((row) => this.matches(row));
    } else if (this.action === "insert") {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((row) => this.prepare(row));
      rows.push(...list);
      result = list;
      save();
    } else if (this.action === "upsert") {
      const keys = String(this.options.onConflict || "id").split(",").map((key) => key.trim());
      result = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((row) => {
        const found = rows.find((item) => keys.every((key) => row[key] != null && String(item[key]) === String(row[key])));
        if (found) {
          Object.assign(found, row, { updated_at: new Date().toISOString() });
          return found;
        }
        const created = this.prepare(row);
        rows.push(created);
        return created;
      });
      save();
    } else if (this.action === "update") {
      result = rows.filter((row) => this.matches(row));
      for (const row of result) Object.assign(row, this.payload, { updated_at: new Date().toISOString() });
      save();
    } else if (this.action === "delete") {
      result = rows.filter((row) => this.matches(row));
      tables()[this.table] = rows.filter((row) => !result.includes(row));
      save();
    }
    for (const { column, ascending } of [...this.sorts].reverse()) {
      result = [...result].sort((left, right) => compare(left[column], right[column]) * (ascending ? 1 : -1));
    }
    if (this.limitCount != null) result = result.slice(this.rangeStart, this.rangeStart + this.limitCount);
    const joins = joinsOf(this.columns);
    const data = result.map((row) => {
      const value=withJoins(row,joins);
      if(this.table==="catalog_monster_drops"&&this.columns.includes("item:catalog_items"))value.item=rowsOf("catalog_items").find(i=>i.id===row.item_id)??null;
      if(this.table==="catalog_monster_drops"&&this.columns.includes("monster:catalog_monsters"))value.monster=rowsOf("catalog_monsters").find(m=>m.id===row.monster_id)??null;
      return value;
    });
    if (this.action !== "select" && !this.returning && this.mode === "many") return { data: null, error: null };
    if (this.mode === "single") return data.length ? { data: data[0], error: null } : { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };
    if (this.mode === "maybe") return { data: data[0] ?? null, error: null };
    return { data, error: null };
  }

  then(resolve, reject) {
    try {
      return Promise.resolve(this.run()).then(resolve, reject);
    } catch (error) {
      return Promise.resolve({ data: null, error: { message: String(error?.message || error) } }).then(resolve, reject);
    }
  }
}

// ── 로그인 흉내 ─────────────────────────────────────────────

function loggedIn() {
  try {
    return sessionStorage.getItem(AUTH_KEY) !== "out";
  } catch {
    return true;
  }
}

function setLoggedIn(on) {
  try {
    sessionStorage.setItem(AUTH_KEY, on ? "in" : "out");
  } catch {
    // 막혀 있으면 이번 화면에서만.
  }
}

export function setMockAuth(on) {
  setLoggedIn(on);
}

function session() {
  return loggedIn() ? { user: USER, access_token: "mock", refresh_token: "mock", expires_in: 3600 } : null;
}

const listeners = new Set();
function emit(event) {
  for (const listener of listeners) setTimeout(() => listener(event, session()), 0);
}

const auth = {
  onAuthStateChange(callback) {
    listeners.add(callback);
    setTimeout(() => callback("INITIAL_SESSION", session()), 0);
    return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
  },
  async getSession() {
    return { data: { session: session() }, error: null };
  },
  async getUser() {
    return { data: { user: session()?.user ?? null }, error: null };
  },
  // Google·Discord 대신 바로 로그인된 상태로 돌아온다(실제로는 다른 사이트에 갔다 오므로 새로 고침으로 흉내).
  async signInWithOAuth() {
    setLoggedIn(true);
    location.reload();
    return { data: {}, error: null };
  },
  async signOut() {
    setLoggedIn(false);
    emit("SIGNED_OUT");
    return { error: null };
  },
};

// ── 저장소·함수 흉내 ───────────────────────────────────────

const files = new Map();
const storage = {
  from() {
    return {
      async upload(path, file) {
        files.set(path, URL.createObjectURL(file));
        return { data: { path }, error: null };
      },
      async remove(paths) {
        for (const path of paths) files.delete(path);
        return { data: [], error: null };
      },
      async list() {
        return { data: [], error: null };
      },
      async createSignedUrls(paths) {
        return { data: paths.map((path) => ({ path, signedUrl: files.get(path) || "./apple-touch-icon.png" })), error: null };
      },
    };
  },
};

// DB 함수 흉내: 거래 저장·취소(sql/037 replace_my_trades)만. 실제 함수의 "다른 곳에서 바뀜" 검사는 하지 않는다.
// 탈퇴처럼 되돌릴 수 없는 함수는 목업에서 실행하지 않는다.
const strip = ({ user_id: _userId, ...row }) => row;
const RPCS = {
  catalog_search_items({p_query="",p_page=0}={}) {
    const q=p_query.toLowerCase();
    const filtered=rowsOf("catalog_items").filter(r=>[r.name,r.category,r.middle_category,r.source_id].some(v=>String(v??"").toLowerCase().includes(q)))
      .sort((a,b)=>(a.required_level??Infinity)-(b.required_level??Infinity)||String(a.id).localeCompare(String(b.id)));
    return {rows:filtered.slice(p_page*24,p_page*24+24),total:filtered.length,revision:1};
  },
  catalog_search_monsters({p_query="",p_drop="",p_min=null,p_max=null,p_weak=[],p_resist=[],p_sort="level",p_page=0}={}) {
    const filtered=rowsOf("catalog_monsters").filter(r=>(String(r.name).toLowerCase().includes(p_query.toLowerCase())||r.source_id===p_query)
      &&(p_min==null||r.level>=p_min)&&(p_max==null||r.level<=p_max)
      &&p_weak.every(v=>String(r.weak_elements??"").split(", ").includes(v))
      &&p_resist.every(v=>String(r.resist_elements??"").split(", ").includes(v))
      &&(!p_drop||rowsOf("catalog_monster_drops").some(d=>d.monster_id===r.id&&rowsOf("catalog_items").some(i=>i.id===d.item_id&&(i.name.toLowerCase().includes(p_drop.toLowerCase())||i.source_id===p_drop)))))
      .sort((a,b)=>(p_sort==="eff"?(a.exp>0?a.hp/a.exp:Infinity)-(b.exp>0?b.hp/b.exp:Infinity):0)||a.level-b.level||String(a.id).localeCompare(String(b.id)));
    return {rows:filtered.slice(p_page*24,p_page*24+24),total:filtered.length,revision:1};
  },
  catalog_item_detail({p_id}={}) {
    const item=rowsOf("catalog_items").find(i=>i.id===p_id);
    if(!item)return null;
    return {item,stats:rowsOf("catalog_item_stats").some(r=>r.item_id===p_id)?rowsOf("catalog_item_stats").filter(r=>r.item_id===p_id):Object.entries(item.base_options??{}).map(([stat_key,base_value])=>({stat_key,base_value,minimum_value:null,maximum_value:null})),requirements:rowsOf("catalog_item_requirements").filter(r=>r.item_id===p_id),jobs:rowsOf("catalog_item_jobs").filter(r=>r.item_id===p_id).map(r=>r.job_name),attributes:rowsOf("catalog_item_source_attributes").filter(r=>r.item_id===p_id)};
  },
  replace_my_trades_v2(args) { return RPCS.replace_my_trades(args); },
  replace_my_trades({ expected = [], replacement = [], restore_times = false } = {}) {
    const rows = rowsOf("trades");
    const ids = new Set([...expected, ...replacement].map((row) => String(row.id)));
    const before = rows.filter((row) => ids.has(String(row.id))).map(strip);
    tables().trades = rows.filter((row) => !ids.has(String(row.id)));
    const now = new Date().toISOString();
    const after = replacement.map((row) => ({ ...row, user_id: USER.id, created_at: row.created_at ?? now, updated_at: restore_times ? (row.updated_at ?? now) : now }));
    tables().trades.push(...after);
    save();
    return { before, after: after.map(strip) };
  },
};

async function rpc(name, args) {
  if (!RPCS[name]) return { data: null, error: { message: `목업에서는 ${name} 함수를 실행하지 않습니다.`, code: "MOCK" } };
  return { data: RPCS[name](args), error: null };
}

export function createMockClient() {
  return { auth, storage, rpc, from: (table) => new Query(table) };
}

// 화면 오른쪽 아래 표시: 목업이라는 걸 잊지 않게, 눌러서 로그인 상태를 바꾸거나 데이터를 처음으로 돌린다.
export function mountMockBadge() {
  if (document.querySelector("[data-mock-badge]")) return;
  const badge = document.createElement("div");
  badge.className = "mock-badge";
  badge.dataset.mockBadge = "";
  badge.innerHTML = `<b>MOCK</b><span>${loggedIn() ? "로그인됨" : "로그인 전"}</span><button type="button" data-mock-toggle>${loggedIn() ? "로그아웃 상태로" : "로그인 상태로"}</button><button type="button" data-mock-reset>샘플로 되돌리기</button><a href="?mock=0">끄기</a>`;
  badge.addEventListener("click", (event) => {
    if (event.target.closest("[data-mock-toggle]")) {
      setLoggedIn(!loggedIn());
      location.reload();
    }
    if (event.target.closest("[data-mock-reset]") && window.confirm("목업 데이터를 샘플로 되돌릴까요? (실제 DB 와는 상관없습니다)")) {
      resetMockDb();
      location.reload();
    }
  });
  document.body.append(badge);
}
