// 로컬 전용 가짜 DB(2026-10-20 사용자 요청): Google·Discord 로그인 없이 화면을 확인한다.
// 127.0.0.1·localhost 에서 주소에 ?mock(로그인된 상태) 또는 ?mock=guest(로그인 전)를 붙이면 켜진다. ?mock=0 이면 끈다.
// ?mock=reset 은 샘플 데이터로 다시 시작한다. 데이터는 이 브라우저 localStorage(ym-mock-db)에만 저장되고 실제 Supabase 는 부르지 않는다.
// supabase-js 중 이 앱이 쓰는 만큼만 흉내 낸다: from().select/insert/update/upsert/delete + eq/neq/in/gte/lte/is/order/limit/single/maybeSingle,
// 조인은 select 의 accounts(...)·jobs(...) 처럼 "표이름(칸)"을 그 표의 단수형_id 로 붙인다. rpc·storage·auth 도 최소한만.

import { ZONES } from "./monster-park-calc.js";
import { nameMatchRank, normalizeSearch } from "./search-match.js";
import { itemFilterMatch, itemKindKey, itemPart } from "./equipment-groups.js";
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
    catalog_monsters: [{ id: "d0000000-0000-4000-8000-000000000001", name: "연습용 달팽이", level: 1, hp: 15, exp: 3, required_accuracy: 1, accuracy_per_level: 0.1, weak_elements: null, resist_elements: null },
      // 그림 점검 확인용: 스티지는 뜨고, 스티지(월묘)는 원본 API에 없는 stand 동작이라 안 뜨고, 마지막은 그림 주소가 없다.
      { id: "d0000000-0000-4000-8000-000000000002", name: "스티지", source_id: "2300100", level: 22, hp: 90, exp: 15, required_accuracy: 33, weak_elements: null, resist_elements: null, image_url: "https://maplestory.io/api/gms/100/mob/2300100/render/fly?bgColor=" },
      { id: "d0000000-0000-4000-8000-000000000003", name: "스티지(월묘)", source_id: "9300063", level: 22, hp: 90, exp: 15, required_accuracy: 33, weak_elements: null, resist_elements: null, image_url: "https://maplestory.io/api/gms/100/mob/9300063/render/stand?bgColor=" },
      { id: "d0000000-0000-4000-8000-000000000004", name: "그림 없는 시험 몬스터", source_id: "9999990", level: 30, hp: 300, exp: 20, required_accuracy: 40, weak_elements: null, resist_elements: null, image_url: null }],
    catalog_items: [
      // 혼줌 알 적용 확인용 장비. 수치는 가짜 데이터다.
      { id: "e0000000-0000-4000-8000-000000000014", name: "혼테일의 목걸이", category: "장비", subcategory: "Pendant", required_level: 120, base_options: { str: 7, dex: 7, int: 7, luk: 7, defense: 100, magic_defense: 100, avoidability: 0, remaining_upgrades: 3 }, requirements: {}, image_url: null },
      { id: "e0000000-0000-4000-8000-000000000001", name: "연습용 아대", category: "장비", subcategory: "Claw", required_level: 50, base_options: { attack: 30, remaining_upgrades: 7 }, requirements: { 레벨: 50 }, image_url: null },
      // 거래 장부 확인용(2026-11-04): 장비 1개(옵션 범위 있음)·소비 1개. 그림은 이 사이트 그림을 빌려 쓴다.
      { id: "e0000000-0000-4000-8000-000000000002", name: "연습용 청갑충", category: "장비", subcategory: "Claw", required_level: 70, base_options: { attack: 34, luk: 5, defense: 4, remaining_upgrades: 7 }, requirements: { level: 70 }, image_url: "https://yourmaple.kr/img/chaos-scroll.png" },
      // 리버스 제작 무기 고르기 확인용(2026-11-07): 무기 2개(완드는 마력 기준)·방어구 1개(목록에서 빠져야 함).
      { id: "e0000000-0000-4000-8000-000000000011", name: "리버스 페스카즈", category: "Equip", middle_category: "One-Handed Weapon", subcategory: "Dagger", required_level: 120, base_options: { attack: 105, remaining_upgrades: 7 }, requirements: {}, image_url: "https://yourmaple.kr/img/maker-icon.png" },
      { id: "e0000000-0000-4000-8000-000000000012", name: "리버스 엔릴 티어", category: "Equip", middle_category: "One-Handed Weapon", subcategory: "Wand", required_level: 118, base_options: { attack: 81, magic_attack: 133, remaining_upgrades: 7 }, requirements: {}, image_url: null },
      { id: "e0000000-0000-4000-8000-000000000013", name: "리버스 코럴", category: "Equip", middle_category: "Armor", subcategory: "Hat", required_level: 120, base_options: { int: 6, defense: 60 }, requirements: {}, image_url: null },
      { id: "e0000000-0000-4000-8000-000000000003", name: "연습용 엘릭서", category: "소비", subcategory: "Potion", required_level: null, base_options: {}, requirements: {}, image_url: "https://yourmaple.kr/img/rift.png" },
    ],
    catalog_item_stats: [
      { item_id: "e0000000-0000-4000-8000-000000000002", stat_key: "attack", base_value: 34, minimum_value: 30, maximum_value: 38 },
      { item_id: "e0000000-0000-4000-8000-000000000002", stat_key: "luk", base_value: 5, minimum_value: 4, maximum_value: 6 },
      { item_id: "e0000000-0000-4000-8000-000000000002", stat_key: "defense", base_value: 4, minimum_value: 3, maximum_value: 5 },
      { item_id: "e0000000-0000-4000-8000-000000000002", stat_key: "remaining_upgrades", base_value: 7, minimum_value: null, maximum_value: null },
    ],
    catalog_monster_drops: [],
    hunts: [], level_exp: [], quests: [], character_quests: [], quest_notes: [], monsters: [], links: [],
    trades: [],
    maker_gem_prices: [], maker_reverse_prices: [], enhance_profiles: [], account_deletions: [],
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
  all[table] ??= table === "monster_park_settings"
    ? [{ singleton: true, ...Object.fromEntries(ZONES.map(({ id, exp }) => [id, Number(exp)])) }]
    : [];
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
  // 이름 검색 흉내: % 는 아무 글자, 대소문자 무시.
  ilike(column, pattern) {
    const source = String(pattern).split("%").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    const regex = new RegExp(`^${source}$`, "i");
    this.filters.push((row) => regex.test(String(row[column] ?? "")));
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
    if (this.table === "monster_park_settings" && this.action !== "select" && (this.action !== "update" || !reviewAllowed())) {
      return { data: null, error: { message: "permission denied for monster park settings", code: "42501" } };
    }
    if ((["catalog_monsters", "catalog_items", "catalog_monster_drops", "catalog_changes", "catalog_revision", "catalog_item_stats", "catalog_item_requirements", "catalog_item_jobs", "catalog_item_source_attributes"].includes(this.table) && this.action !== "select") || this.table === "catalog_monster_reviews") return { data: null, error: { message: "permission denied for shared catalog", code: "42501" } };
    // sql/063·069 와 같이 도감 변경 이력은 관리자만 읽는다.
    if (this.table === "catalog_changes" && this.action === "select" && !reviewAllowed()) return { data: [], error: null, count: 0 };
    const rows = rowsOf(this.table);
    let result = [];
    if (this.action === "select") {
      result = rows.filter((row) => this.matches(row));
      // sql/071 흉내: 지운 몬스터와 그 드랍은 공개 읽기에서 숨긴다
      const gone = new Set(rowsOf("catalog_monsters").filter((row) => row.deleted_at).map((row) => row.id));
      if (this.table === "catalog_monsters") result = result.filter((row) => !gone.has(row.id));
      if (this.table === "catalog_monster_drops") result = result.filter((row) => !gone.has(row.monster_id));
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

const reviewAllowed = () => loggedIn() && sessionStorage.getItem("ym-mock-review-admin") === "1";
function mockReviewRows() {
  const db = tables();
  if (!db.catalog_review_items) {
    const draft = {attack_speed_label:"보통",name:"연습용 아이템",description:"보완할 설명입니다.",effect_description:"HP를 50 회복합니다.",base_options:{attack:5,remaining_upgrades:7},requirements:{level:10,fame:0},review_note:""};
    db.catalog_review_items = [
      {source_id:"1000001",category:"장비",review_kind:"different",image_url:null,status:"draft",revision:1,comparison:{differences:[{field:"공격력",api:5,reference:7}],unknown:[]},proposals:{api:{attack_speed_label:"보통",description:"",base_options:{attack:5},requirements:{level:10}},comparison:{attack_speed_label:"빠름",description:"",base_options:{attack:7},requirements:{level:10}}},draft:{...draft,description:"",effect_description:""}},
      {source_id:"2000001",category:"소비",review_kind:"unverified",image_url:null,status:"draft",revision:1,comparison:{differences:[],unknown:["효과 설명 검토 필요"]},proposals:{api:{description:"HP를 50 회복합니다.",base_options:{},requirements:{}},comparison:{description:"HP를 100 회복합니다.",base_options:{},requirements:{}}},draft:{...draft,name:"연습용 포션",base_options:{},requirements:{}}},
      {source_id:"4000001",category:"기타",review_kind:"unverified",image_url:null,status:"draft",revision:1,comparison:{differences:[],unknown:["효과 미제공"]},proposals:{},draft:{...draft,name:"연습용 재료",description:"",effect_description:"",base_options:{},requirements:{}}},
    ];
    save();
  }
  return db.catalog_review_items;
}
function mockMaps() {
  const maps = rowsOf("catalog_maps");
  if (!maps.length) {
    const sample = [
      ["f0000000-0000-4000-8000-000000000001", 100000000, "헤네시스", "헤네시스", "collected", []],
      ["f0000000-0000-4000-8000-000000000002", 100010000, "헤네시스동쪽언덕", "헤네시스", "collected", [["d0000000-0000-4000-8000-000000000001", 12], ["d0000000-0000-4000-8000-000000000002", 10], ["d0000000-0000-4000-8000-000000000003", null]]],
      ["f0000000-0000-4000-8000-000000000003", 270000100, "시간의 신전", "시간의신전", "operator", [["d0000000-0000-4000-8000-000000000002", 3], ["d0000000-0000-4000-8000-000000000004", null]]],
    ];
    // 그림·포탈·등장 위치는 실제 수집 값(헤네시스=100000000, 헤네시스동쪽언덕=100010000, 시간의 신전=270000100은 그림 기준점이 없는 경우).
    // 몬스터 번호만 가짜 도감 몬스터로 바꿨다. 포탈 목적지도 예시 3곳 안으로 맞췄다.
    const detail = {
      100000000: { render: {"v":"gms/70","ox":-536,"oy":-477,"w":6894,"h":1193}, minimap: {"v":"gms/70","cx":618,"cy":661,"w":6994,"h":1391}, portals: [{"n":"portal1","x":5917,"y":489,"to":100010000,"t":2,"v":true,"tp":"west00"},{"n":"portal4","x":3030,"y":365,"to":270000100,"t":2,"v":true,"tp":""}], spawns: [] },
      100010000: { render: {"v":"gms/62","ox":-655,"oy":-607,"w":2677,"h":1363}, minimap: {"v":"gms/62","cx":710,"cy":763,"w":2767,"h":1561}, portals: [{"n":"west00","x":-542,"y":457,"to":100000000,"t":2,"v":true,"tp":"portal1"}],
        spawns: [{"m":"100100","x":-278,"y":455},{"m":"100100","x":-53,"y":455},{"m":"2300100","x":373,"y":455},{"m":"2300100","x":1372,"y":455},{"m":"9300063","x":679,"y":455},{"m":"9300063","x":1612,"y":455},{"m":"2300100","x":894,"y":305},{"m":"9300063","x":767,"y":305},{"m":"2300100","x":-70,"y":-355},{"m":"100100","x":168,"y":425},{"m":"100100","x":1480,"y":-355},{"m":"2300100","x":1589,"y":-355},{"m":"9300063","x":374,"y":-235},{"m":"9300063","x":565,"y":-235},{"m":"2300100","x":847,"y":-235},{"m":"2300100","x":704,"y":-595},{"m":"2300100","x":810,"y":-595},{"m":"9300063","x":-432,"y":-55},{"m":"100100","x":554,"y":455},{"m":"9300063","x":-283,"y":-55},{"m":"9300063","x":-124,"y":-55},{"m":"100100","x":461,"y":-235},{"m":"9300063","x":917,"y":-235},{"m":"9300063","x":778,"y":-235},{"m":"100100","x":504,"y":-595},{"m":"9300063","x":0,"y":-55},{"m":"9300063","x":694,"y":-235},{"m":"9300063","x":1300,"y":-55},{"m":"100100","x":836,"y":455},{"m":"9300063","x":1471,"y":-55},{"m":"9300063","x":1594,"y":-55},{"m":"9300063","x":1716,"y":-55},{"m":"9300063","x":-471,"y":-355},{"m":"9300063","x":-337,"y":-355},{"m":"100100","x":-263,"y":-355},{"m":"100100","x":1236,"y":455},{"m":"100100","x":1511,"y":455},{"m":"100100","x":1717,"y":455},{"m":"2300100","x":-160,"y":455},{"m":"2300100","x":77,"y":455}] },
      270000100: { render: {"v":"gms/92"}, minimap: null, portals: [{"n":"portal1","x":2003,"y":490,"to":100000000,"t":2,"v":true,"tp":"portal4"}], spawns: [] },
    };
    for (const [id, source_id, name, street_name, name_source, monsters] of sample) {
      maps.push({ id, source_id, name, street_name, name_en: null, street_name_en: null, name_source, in_old_version: true, updated_at: iso(-5), ...detail[source_id] });
      rowsOf("catalog_map_monsters").push(...monsters.map(([monster_id, max_count]) => ({ map_id: id, monster_id, source: "collected", max_count })));
    }
    save();
  }
  return maps;
}
function mapMonsters(mapId) {
  const links = new Map(rowsOf("catalog_map_monsters").filter(l => l.map_id === mapId).map(l => [l.monster_id, l]));
  const ids = new Set(links.keys());
  const all = rowsOf("catalog_monsters").filter(m => ids.has(m.id) && !m.deleted_at).sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name))
    .map(({ id, name, level, hp, exp, source_id, image_url, image_fallback_url }) => ({ id, name, level, hp, exp, source_id, image_url, image_fallback_url, source: links.get(id)?.source ?? "collected", max_count: links.get(id)?.max_count ?? null }));
  const levels = all.map(m => m.level).filter(v => v != null);
  return { all, monster_count: all.length, min_level: levels.length ? Math.min(...levels) : null, max_level: levels.length ? Math.max(...levels) : null };
}
function assertMockReviewer() { if (!reviewAllowed()) throw Object.assign(new Error("검토 권한이 없습니다"),{code:"42501"}); }

const RPCS = {
  can_review_catalog() { return reviewAllowed(); },
  catalog_review_list({p_query="",p_kind="",p_status="",p_page=0}={}) {
    assertMockReviewer();const all=mockReviewRows();const rows=all.filter(x=>(!p_query||x.draft.name.includes(p_query)||x.source_id===p_query)&&(!p_kind||x.review_kind===p_kind)&&(p_status==="deleted"?!!x.deleted_at:!x.deleted_at&&(!p_status||x.status===p_status)));
    return {total:rows.length,counts:{all:all.filter(x=>!x.deleted_at).length,deleted:all.filter(x=>x.deleted_at).length,published:all.filter(x=>!x.deleted_at&&x.published_item_id).length,ready:all.filter(x=>!x.deleted_at&&x.status==="ready").length},rows:rows.slice(p_page*24,p_page*24+24).map(x=>({...x,name:x.draft.name}))};
  },
  catalog_review_set_deleted({p_id,p_revision,p_deleted}) {
    assertMockReviewer();const row=mockReviewRows().find(x=>x.source_id===p_id);if(!row)throw new Error("검토 항목이 없습니다");
    if(row.revision!==p_revision)throw Object.assign(new Error("다른 화면에서 수정되었습니다"),{code:"40001"});
    if(!!row.deleted_at===p_deleted)return structuredClone(row);
    if(row.published_revision===row.revision)row.published_revision=row.revision+1;
    row.deleted_at=p_deleted?iso():null;row.revision++;row.updated_at=iso();save();return structuredClone(row);
  },
  catalog_review_detail({p_id}) { assertMockReviewer();return structuredClone(mockReviewRows().find(x=>x.source_id===p_id)||null); },
  catalog_review_save({p_id,p_revision,p_draft,p_status,p_publish=false}) {
    assertMockReviewer();const row=mockReviewRows().find(x=>x.source_id===p_id);if(!row)throw new Error("검토 항목이 없습니다");
    if(row.deleted_at)throw new Error("삭제한 검토 항목입니다. 먼저 복구해 주세요");
    if(row.revision!==p_revision)throw Object.assign(new Error("다른 화면에서 수정되었습니다"),{code:"40001"});
    if (p_publish && p_status!=="ready") throw new Error("공개 상태를 확인해 주세요");
    if (JSON.stringify(row.draft)===JSON.stringify(p_draft) && row.status===p_status && (!p_publish || row.published_revision===row.revision)) return structuredClone(row);
    row.draft=structuredClone(p_draft);row.status=p_status;row.revision++;row.updated_at=iso();
    if (p_publish) {
      const items=rowsOf("catalog_items"),existing=items.find(x=>x.source_id===p_id);
      const published={...existing,attack_speed_label:p_draft.attack_speed_label??existing?.attack_speed_label??null,id:existing?.id||crypto.randomUUID(),source:"collected",source_id:p_id,name:p_draft.name,category:row.category,image_url:row.image_url,base_options:structuredClone(p_draft.base_options),requirements:structuredClone(p_draft.requirements),description:p_draft.description,effect_description:p_draft.effect_description,required_level:p_draft.requirements.level??null};
      if(existing)Object.assign(existing,published);else items.push(published);
      row.published_item_id=published.id;row.published_revision=row.revision;
    }
    save();return structuredClone(row);
  },
  catalog_search_items({p_query="",p_page=0,p_kind="",p_job="",p_part="",p_common=true}={}) {
    // sql/054 와 같은 규칙: 이름 그대로 → 글자 순서만 맞음 → 분류·외부 ID, 같은 순위는 짧은 이름 먼저. sql/075 분류·개수도 흉내 낸다.
    const q=p_query.toLowerCase();
    const rank=r=>{const n=nameMatchRank(r.name,p_query);return n??([r.category,r.middle_category].some(v=>String(v??"").toLowerCase().includes(q))||r.source_id===p_query?2:null)};
    const jobsOf=r=>rowsOf("catalog_item_jobs").filter(j=>j.item_id===r.id).map(j=>j.job_name);
    const matched=rowsOf("catalog_items").filter(r=>!normalizeSearch(p_query)||rank(r)!=null);
    const kind=p_kind||(p_job||p_part?"equip":"");
    const byKind=matched.filter(r=>itemFilterMatch(r,[],{kind}));
    const byJob=byKind.filter(r=>itemFilterMatch(r,jobsOf(r),{kind,job:p_job,common:p_common}));
    const filtered=byJob.filter(r=>itemFilterMatch(r,[],{kind,part:p_part}))
      .sort((a,b)=>(normalizeSearch(p_query)?(rank(a)-rank(b))||(a.name.length-b.name.length):0)||(a.required_level??Infinity)-(b.required_level??Infinity)||String(a.id).localeCompare(String(b.id)));
    const tally=(rows,key)=>rows.reduce((o,r)=>{const k=key(r);if(k!=null)o[k]=(o[k]??0)+1;return o;},{});
    const equipKind=byKind.filter(r=>itemKindKey(r.category)==="equip");
    const jobs={};for(const j of ["전사","마법사","궁수","도적","해적"]){const n=equipKind.filter(r=>{const js=jobsOf(r);return js.includes(j)||(p_common&&js.includes("공용"));}).length;if(n)jobs[j]=n;}
    return {rows:filtered.slice(p_page*24,p_page*24+24),total:filtered.length,revision:1,
      kinds:tally(matched,r=>itemKindKey(r.category)),jobs,common:equipKind.filter(r=>jobsOf(r).includes("공용")).length,
      parts:tally(byJob.filter(r=>itemKindKey(r.category)==="equip"),r=>itemPart(r.subcategory))};
  },
  catalog_search_monsters({p_query="",p_drop="",p_min=null,p_max=null,p_weak=[],p_resist=[],p_sort="level",p_page=0}={}) {
    const filtered=rowsOf("catalog_monsters").filter(r=>!r.deleted_at&&(String(r.name).toLowerCase().includes(p_query.toLowerCase())||r.source_id===p_query)
      &&(p_min==null||r.level>=p_min)&&(p_max==null||r.level<=p_max)
      &&p_weak.every(v=>String(r.weak_elements??"").split(", ").includes(v))
      &&p_resist.every(v=>String(r.resist_elements??"").split(", ").includes(v))
      &&(!p_drop||rowsOf("catalog_monster_drops").some(d=>d.monster_id===r.id&&rowsOf("catalog_items").some(i=>i.id===d.item_id&&(i.name.toLowerCase().includes(p_drop.toLowerCase())||i.source_id===p_drop)))))
      .sort((a,b)=>(p_sort==="eff"?(a.exp>0?a.hp/a.exp:Infinity)-(b.exp>0?b.hp/b.exp:Infinity):0)||a.level-b.level||String(a.id).localeCompare(String(b.id)));
    const fallback=r=>rowsOf("catalog_monsters").find(l=>l.id===r.image_link_monster_id)?.image_url??null;
    return {rows:filtered.slice(p_page*24,p_page*24+24).map(r=>({...r,image_fallback_url:fallback(r)})),total:filtered.length,revision:1};
  },
  // sql/070 흉내: 그림 점검·원본 주소 고치기·대체 그림 연결
  catalog_monster_image_audit() {
    assertMockReviewer();const all=rowsOf("catalog_monsters");
    return all.filter(m=>!m.deleted_at).map(m=>{const l=all.find(x=>x.id===m.image_link_monster_id);return {id:m.id,name:m.name,level:m.level,source_id:m.source_id??null,image_url:m.image_url??null,image_link_monster_id:m.image_link_monster_id??null,image_link_name:l?.name??null,image_fallback_url:l?.image_url??null};})
      .sort((a,b)=>(a.level??Infinity)-(b.level??Infinity)||a.name.localeCompare(b.name));
  },
  // sql/071 흉내: 논리 삭제·복구·삭제한 몬스터 목록
  catalog_monster_set_deleted({p_id,p_deleted,p_reason=null}) {
    assertMockReviewer();const m=rowsOf("catalog_monsters").find(x=>x.id===p_id);if(!m)throw new Error("몬스터를 찾을 수 없습니다");
    const reason=String(p_reason??"").trim()||null;if(reason&&reason.length>500)throw new Error("삭제 이유는 500자까지 적을 수 있습니다");
    if(Boolean(m.deleted_at)===p_deleted)return {id:p_id,deleted_at:m.deleted_at??null,deleted_reason:m.deleted_reason??null};
    m.deleted_at=p_deleted?iso():null;m.deleted_reason=p_deleted?reason:null;
    const log=rowsOf("catalog_changes");log.push({id:(log.reduce((n,x)=>Math.max(n,Number(x.id)||0),0))+1,entity_type:"monster",entity_id:p_id,entity_name:m.name,operation:"UPDATE",changes:{deleted:{before:!p_deleted,after:p_deleted},...(p_deleted&&reason?{deleted_reason:{before:null,after:reason}}:{})},release_label:p_deleted?"운영자 몬스터 삭제":"운영자 몬스터 복구",changed_at:iso()});
    save();return {id:p_id,deleted_at:m.deleted_at,deleted_reason:m.deleted_reason};
  },
  catalog_monster_deleted_list() {
    assertMockReviewer();const all=rowsOf("catalog_monsters");
    return all.filter(m=>m.deleted_at).sort((a,b)=>String(b.deleted_at).localeCompare(String(a.deleted_at))).map(m=>({id:m.id,name:m.name,level:m.level,hp:m.hp,exp:m.exp,source_id:m.source_id??null,image_url:m.image_url??null,image_fallback_url:all.find(l=>l.id===m.image_link_monster_id)?.image_url??null,deleted_at:m.deleted_at,deleted_reason:m.deleted_reason??null,drop_count:rowsOf("catalog_monster_drops").filter(d=>d.monster_id===m.id).length}));
  },
  catalog_monster_set_image({p_id,p_expected,p_image_url}) {
    assertMockReviewer();const m=rowsOf("catalog_monsters").find(x=>x.id===p_id);if(!m)throw new Error("몬스터를 찾을 수 없습니다");
    if(p_image_url!=null&&!/^https:\/\/\S+$/.test(p_image_url))throw new Error("https:// 로 시작하는 그림 주소를 입력해 주세요");
    if((m.image_url??null)!==(p_expected??null))throw Object.assign(new Error("다른 화면에서 그림이 바뀌었습니다"),{code:"40001"});
    if((m.image_url??null)===p_image_url)return {id:p_id,image_url:p_image_url};
    const log=rowsOf("catalog_changes");log.push({id:(log.reduce((n,x)=>Math.max(n,Number(x.id)||0),0))+1,entity_type:"monster",entity_id:p_id,entity_name:m.name,operation:"UPDATE",changes:{image_url:{before:m.image_url??null,after:p_image_url}},release_label:"운영자 원본 그림 주소 수정",changed_at:iso()});
    m.image_url=p_image_url;save();return {id:p_id,image_url:p_image_url};
  },
  catalog_monster_set_image_link({p_id,p_expected,p_link}) {
    assertMockReviewer();const all=rowsOf("catalog_monsters"),m=all.find(x=>x.id===p_id);if(!m)throw new Error("몬스터를 찾을 수 없습니다");
    if((m.image_link_monster_id??null)!==(p_expected??null))throw Object.assign(new Error("다른 화면에서 그림 연결이 바뀌었습니다"),{code:"40001"});
    const target=p_link?all.find(x=>x.id===p_link):null;
    if(p_link&&p_link===p_id)throw new Error("자기 자신은 연결할 수 없습니다");
    if(p_link&&!target)throw new Error("연결할 몬스터를 찾을 수 없습니다");
    if(target&&!target.image_url)throw new Error("연결할 몬스터에 그림이 없습니다");
    if((m.image_link_monster_id??null)!==(p_link??null)){
      const before=all.find(x=>x.id===m.image_link_monster_id)?.name??null;
      const log=rowsOf("catalog_changes");log.push({id:(log.reduce((n,x)=>Math.max(n,Number(x.id)||0),0))+1,entity_type:"monster",entity_id:p_id,entity_name:m.name,operation:"UPDATE",changes:{image_link:{before,after:target?.name??null}},release_label:"운영자 대체 그림 연결",changed_at:iso()});
      m.image_link_monster_id=p_link??null;save();
    }
    return {id:p_id,image_link_monster_id:p_link??null,image_fallback_url:target?.image_url??null};
  },
  // 맵 정보(sql/076 흉내). 처음 열면 연습용 맵 3개를 넣는다(예전 가짜 DB 에도 생기게).
  catalog_search_maps({p_query="",p_street="",p_page=0}={}) {
    const norm=v=>String(v??"").replace(/\s+/g,"").toLowerCase(), q=norm(p_query);
    const matched=mockMaps().map(m=>({...m,...mapMonsters(m.id)})).filter(m=>m.monster_count>0&&(!q||norm(m.name).includes(q)||norm(m.street_name).includes(q)||String(m.source_id)===p_query.trim()||m.all.some(x=>norm(x.name).includes(q))));
    const filtered=matched.filter(m=>!p_street||m.street_name===p_street).sort((a,b)=>(a.min_level??0)-(b.min_level??0)||a.name.localeCompare(b.name));
    const streets={};for(const m of matched)streets[m.street_name??""]=(streets[m.street_name??""]??0)+1;
    return {rows:filtered.slice(p_page*24,p_page*24+24).map(({all,portals:_p,spawns:_s,minimap,render,...m})=>({...m,image_v:minimap?.v??render?.v??null,monsters:all.slice(0,4)})),total:filtered.length,streets,revision:1};
  },
  catalog_map_detail({p_id=null,p_source_id=null}={}) {
    const map=mockMaps().find(m=>m.id===p_id||(p_source_id!=null&&m.source_id===Number(p_source_id)));
    if(!map)return null;
    const maps=mockMaps(), mons=rowsOf("catalog_monsters").filter(m=>!m.deleted_at);
    const portals=(map.portals??[]).flatMap(p=>{const t=maps.find(m=>m.source_id===p.to);return t?[{...p,to_name:t.name,to_street:t.street_name}]:[];});
    const spawns=(map.spawns??[]).flatMap(sp=>{const m=mons.find(x=>x.source_id===sp.m);return m?[{x:sp.x,y:sp.y,monster_id:m.id}]:[];});
    const {portals:_p,spawns:_s,minimap=null,render=null,...rest}=map;
    return {map:{...rest,version:String(map.updated_at)},monsters:mapMonsters(map.id).all,minimap,render,portals,spawns,revision:1};
  },
  catalog_monster_maps({p_monster_id}={}) {
    const ids=new Set(rowsOf("catalog_map_monsters").filter(l=>l.monster_id===p_monster_id).map(l=>l.map_id));
    return mockMaps().filter(m=>ids.has(m.id)).map(({id,source_id,name,street_name})=>({id,source_id,name,street_name}));
  },
  catalog_map_edit_save({p_id,p_version,p_name,p_street_name}) {
    assertMockReviewer();const m=mockMaps().find(x=>x.id===p_id);if(!m)throw new Error("맵을 찾을 수 없습니다");
    if(String(m.updated_at)!==String(p_version))throw Object.assign(new Error("다른 곳에서 먼저 고쳤습니다"),{code:"40001"});
    const name=String(p_name??"").trim(),street=String(p_street_name??"").trim()||null;
    if(!name||name.length>200)throw Object.assign(new Error("맵 이름은 1~200자로 적어 주세요"),{code:"22023"});
    const changes={};if(m.name!==name)changes.name={before:m.name,after:name};if(m.street_name!==street)changes.street_name={before:m.street_name,after:street};
    if(Object.keys(changes).length){const log=rowsOf("catalog_changes");log.push({id:(log.reduce((n,x)=>Math.max(n,Number(x.id)||0),0))+1,entity_type:"map",entity_id:p_id,entity_name:name,operation:"UPDATE",changes,release_label:"운영자 맵 수정",changed_at:iso()});
      Object.assign(m,{name,street_name:street,name_source:"operator",updated_at:iso()});save();}
    return RPCS.catalog_map_detail({p_id});
  },
  catalog_monster_detail({p_id}={}) { const monster=rowsOf("catalog_monsters").find(row=>row.id===p_id); return monster ? {monster} : null; },
  catalog_monster_edit_detail({p_id}) {
    assertMockReviewer();const m=rowsOf("catalog_monsters").find(x=>x.id===p_id);if(!m)throw new Error("몬스터를 찾을 수 없습니다");
    const keys=["level","hp","exp","mp","required_accuracy","accuracy_reference_level","accuracy_per_level","physical_attack","magic_attack","physical_defense","magic_defense","movement_speed","knockback_damage","meso_value"];
    const split=v=>String(v??"").split(", ").filter(Boolean);
    return {version:JSON.stringify(m),draft:{name:m.name,...Object.fromEntries(keys.map(k=>[k,m[k]??null])),weak_elements:split(m.weak_elements),resist_elements:split(m.resist_elements)}};
  },
  catalog_monster_edit_save({p_id,p_version,p_draft}) {
    assertMockReviewer();const m=rowsOf("catalog_monsters").find(x=>x.id===p_id);if(!m)throw new Error("몬스터를 찾을 수 없습니다");
    if(JSON.stringify(m)!==p_version)throw Object.assign(new Error("다른 화면에서 수정되었습니다"),{code:"40001"});
    const next={...p_draft,weak_elements:p_draft.weak_elements.length?p_draft.weak_elements.join(", "):null,resist_elements:p_draft.resist_elements.length?p_draft.resist_elements.join(", "):null};
    const changes={};for(const [k,v] of Object.entries(next))if(JSON.stringify(m[k]??null)!==JSON.stringify(v))changes[k]={before:m[k]??null,after:v};
    if(!Object.keys(changes).length)return {monster:m};
    Object.assign(m,next,{updated_at:iso()});
    const log=rowsOf("catalog_changes");log.push({id:(log.reduce((n,x)=>Math.max(n,Number(x.id)||0),0))+1,entity_type:"monster",entity_id:p_id,entity_name:m.name,operation:"UPDATE",changes,release_label:"운영자 상세 수정",changed_at:iso()});
    save();return {monster:m};
  },
  // sql/072 흉내: 드랍 수정(관리자 전용, 목록 전체 저장·버전 충돌·바뀐 줄마다 이력)
  catalog_monster_drops_edit_detail({p_id}) {
    assertMockReviewer();const m=rowsOf("catalog_monsters").find(x=>x.id===p_id&&!x.deleted_at);if(!m)throw new Error("몬스터를 찾을 수 없습니다");
    const own=rowsOf("catalog_monster_drops").filter(d=>d.monster_id===p_id).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
    const items=rowsOf("catalog_items");
    const drops=own.map(d=>{const i=items.find(x=>x.id===d.item_id);return {id:d.id,item_id:d.item_id,rate_percent:d.rate_percent??null,source:d.source,item:i?{id:i.id,name:i.name,image_url:i.image_url??null,source_id:i.source_id??null}:null};})
      .sort((a,b)=>(b.rate_percent??-1)-(a.rate_percent??-1));
    return {version:JSON.stringify(own),drops};
  },
  catalog_monster_drops_save({p_id,p_version,p_drops}) {
    assertMockReviewer();const m=rowsOf("catalog_monsters").find(x=>x.id===p_id&&!x.deleted_at);if(!m)throw new Error("몬스터를 찾을 수 없습니다");
    const all=rowsOf("catalog_monster_drops"),items=rowsOf("catalog_items");
    const own=all.filter(d=>d.monster_id===p_id).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
    if(JSON.stringify(own)!==p_version)throw Object.assign(new Error("다른 화면에서 드랍이 바뀌었습니다. 다시 불러온 뒤 저장해 주세요"),{code:"40001"});
    if(!Array.isArray(p_drops)||p_drops.length>500)throw new Error("드랍 목록 형식이 아닙니다");
    const kept=new Set();
    for(const e of p_drops){
      if(!items.some(i=>i.id===e.item_id))throw new Error("도감에 없는 아이템입니다");
      if(e.rate_percent!=null&&(typeof e.rate_percent!=="number"||e.rate_percent<0||e.rate_percent>100))throw new Error("드랍 확률은 0~100% 사이로 입력해 주세요");
      if(e.id){if(!own.some(d=>d.id===e.id))throw new Error("이 몬스터의 드랍이 아닙니다");if(kept.has(e.id))throw new Error("같은 드랍이 두 번 들어 있습니다");kept.add(e.id);}
    }
    const log=rowsOf("catalog_changes"),name=id=>items.find(i=>i.id===id)?.name??null;
    const push=(operation,changes)=>log.push({id:(log.reduce((n,x)=>Math.max(n,Number(x.id)||0),0))+1,entity_type:"monster",entity_id:p_id,entity_name:m.name,operation,changes,release_label:"운영자 드랍 수정",changed_at:iso()});
    const label=r=>r==null?"확률 미상":`${r}%`;
    for(const d of own)if(!kept.has(d.id)){all.splice(all.indexOf(d),1);push("DELETE",{item_id:{before:name(d.item_id),after:null},rate_percent:{before:d.rate_percent??null,after:null}});}
    let next=all.filter(d=>d.source==="operator"&&d.monster_source_id===p_id).reduce((n,d)=>Math.max(n,d.source_entry+1),0);
    for(const e of p_drops){
      if(e.id){const d=all.find(x=>x.id===e.id),changes={};
        if(d.item_id!==e.item_id)changes.item_id={before:name(d.item_id),after:name(e.item_id)};
        if((d.rate_percent??null)!==(e.rate_percent??null))changes.rate_percent={before:d.rate_percent??null,after:e.rate_percent??null};
        if(Object.keys(changes).length){Object.assign(d,{item_id:e.item_id,rate_percent:e.rate_percent??null,rate_text:label(e.rate_percent)});push("UPDATE",changes);}
      }else{all.push({id:crypto.randomUUID(),monster_id:p_id,item_id:e.item_id,source:"operator",monster_source_id:p_id,source_entry:next++,rate_percent:e.rate_percent??null,rate_text:label(e.rate_percent),created_at:iso()});push("INSERT",{item_id:{before:null,after:name(e.item_id)},rate_percent:{before:null,after:e.rate_percent??null}});}
    }
    save();return this.catalog_monster_drops_edit_detail({p_id});
  },
  catalog_item_edit_detail({p_id}) {
    assertMockReviewer();const item=rowsOf("catalog_items").find(x=>x.id===p_id);if(!item)throw new Error("아이템을 찾을 수 없습니다");
    return {version:JSON.stringify(item),speed_supported:true,percent_supported:true,level_up_supported:true,ranges_supported:true,ranges:structuredClone(item.source_data?.option_ranges||Object.fromEntries(rowsOf("catalog_item_stats").filter(x=>x.item_id===p_id&&x.minimum_value!=null&&x.maximum_value!=null).map(x=>[x.stat_key,{min:x.minimum_value,max:x.maximum_value}]))),draft:{attack_speed_label:item.attack_speed_label||"",level_up_count:item.level_up_count??null,name:item.name,description:item.description||"",effect_description:item.effect_description||"",base_options:structuredClone(item.base_options||{}),requirements:structuredClone(item.requirements||{}),review_note:""}};
  },
  catalog_item_edit_save({p_id,p_version,p_draft,p_ranges}) {
    assertMockReviewer();const item=rowsOf("catalog_items").find(x=>x.id===p_id);if(!item)throw new Error("아이템을 찾을 수 없습니다");
    if(JSON.stringify(item)!==p_version)throw Object.assign(new Error("다른 화면에서 수정되었습니다"),{code:"40001"});
    const old=structuredClone(item.base_options||{});
    if(p_ranges!=null)item.source_data={...item.source_data,option_ranges:structuredClone(p_ranges)};
    Object.assign(item,{attack_speed_label:p_draft.attack_speed_label??item.attack_speed_label??null,level_up_count:Object.hasOwn(p_draft,"level_up_count")?p_draft.level_up_count:item.level_up_count??null,name:p_draft.name,description:p_draft.description,effect_description:p_draft.effect_description,base_options:structuredClone(p_draft.base_options),requirements:structuredClone(p_draft.requirements),required_level:p_draft.requirements.level??null,gender_restriction:p_draft.requirements.GENDER??null,updated_at:iso()});
    const stats=rowsOf("catalog_item_stats");tables().catalog_item_stats=stats.filter(x=>x.item_id!==p_id).concat(Object.entries(item.base_options).map(([stat_key,base_value])=>{
      const previous=stats.find(x=>x.item_id===p_id&&x.stat_key===stat_key);return {item_id:p_id,stat_key,base_value,minimum_value:p_ranges!=null?p_ranges[stat_key]?.min??null:old[stat_key]===base_value?previous?.minimum_value??null:null,maximum_value:p_ranges!=null?p_ranges[stat_key]?.max??null:old[stat_key]===base_value?previous?.maximum_value??null:null};
    }));
    tables().catalog_item_requirements=rowsOf("catalog_item_requirements").filter(x=>x.item_id!==p_id).concat(Object.entries(item.requirements).filter(([k,v])=>typeof v==="number"&&k!=="level").map(([requirement_key,required_value])=>({item_id:p_id,requirement_key,required_value})));
    if(item.requirements["REQ JOB"]){tables().catalog_item_jobs=rowsOf("catalog_item_jobs").filter(x=>x.item_id!==p_id).concat(item.requirements["REQ JOB"].split(/[\s/,·]+/).filter(Boolean).map(job_name=>({item_id:p_id,job_name})));}
    save();return RPCS.catalog_item_detail({p_id});
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
  try { return { data: RPCS[name](args), error: null }; } catch (error) { return {data:null,error:{message:error.message,code:error.code}}; }
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
  badge.innerHTML = `<b>MOCK</b><span>${loggedIn() ? "로그인됨" : "로그인 전"}</span><button type="button" data-mock-toggle>${loggedIn() ? "로그아웃 상태로" : "로그인 상태로"}</button><button type="button" data-mock-reset>샘플로 되돌리기</button><a href="?mock=0" data-mock-off>끄기</a>`;
  badge.addEventListener("click", (event) => {
    if (event.target.closest("[data-mock-off]")) {
      event.preventDefault();
      const url = new URL(location.href);
      url.searchParams.set("mock", "0");
      location.assign(url);
    }
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
