import { signInWithProvider, translateAuthError } from "../auth.js";
import { providerButtons } from "./login.js";
import { notify } from "../toast.js";
import { bosses, formatPossible, formatRemain, formatStamp, todaySlot } from "../boss-cooldown.js";
import { attachFaceUrls, faceMarkup, missingFaceColumn } from "../character-face.js";
import { translateDbError } from "../db-error.js";
import { burstAt, paletteHue, sfx } from "../effects.js";
import { escapeHtml, formatCount } from "../format.js";
import { expProgress } from "../exp-progress.js";
import { formatMinutes } from "../hunt-calc.js";
import { jobLabel, jobRecord } from "../job-label.js";
import { loadMainCharacter, mainCharacterId, setMainCharacter } from "../profile.js";
import { categories, glyphInner, routes } from "../routes.js";
import { isLoggedIn, rememberNext } from "../session.js";
import { getSupabase } from "../supabase-client.js";

// 대표 캐릭터는 js/profile.js 가 profiles.main_character_id 로 저장한다(헤더 프로필과 같다).
const NOTE_LIMIT = 4;

const art = {
  pianus: "img/pianus.png",
  papulatus: "img/papulatus.png",
  rift: "img/rift.png",
};

const sections = [
  {
    key: "papulatus",
    blurb: "오늘 돌 수 있는 시각",
    empty: "오늘 돌 수 있는 파풀라투스가 없습니다.",
    ready: "지금 가능",
    mark: "입장 가능",
  },
  {
    key: "pianus",
    blurb: "오늘 도전하는 캐릭터",
    empty: "오늘 피아누스를 도전할 캐릭터가 없습니다.",
    ready: "지금 가능",
    mark: "입장 가능",
  },
  {
    key: "rift",
    blurb: "오늘 받는 시각",
    empty: "오늘 받을 차원의 균열 조각이 없습니다.",
    ready: "지금 가능",
    mark: "수령 가능",
  },
];

const bossColumns = "pianus_enabled, pianus_at, papulatus_enabled, papulatus_at, rift_enabled, rift_at";

// sql/029 를 실행하기 전이면 exp·main_hunt_id 칸이 없으므로 빼고 다시 읽는다. 얼굴 칸도 같다.
function progressMissing(error) {
  const raw = `${error?.message || ""} ${error?.details || ""}`;
  return /\bexp\b|main_hunt_id/i.test(raw) && /could not find|schema cache|does not exist/i.test(raw);
}

async function loadCharacters(supabase) {
  let withFace = true;
  let withProgress = true;
  for (;;) {
    const columns = ["id, name, job, level", withFace ? "face_path" : "", withProgress ? "exp, main_hunt_id" : "", bossColumns, "jobs(name, color, color_dark), accounts(name)"]
      .filter(Boolean)
      .join(", ");
    const result = await supabase.from("characters").select(columns);
    if (!result.error) return result;
    if (withFace && missingFaceColumn(result.error)) withFace = false;
    else if (withProgress && progressMissing(result.error)) withProgress = false;
    else return result;
  }
}

// 로그인 전 홈: 소개 + 로그인 없이 쓰는 계산기 + 모든 기능(로그인이 필요한 곳은 자물쇠).
const OPEN_TOOLS = [
  { id: "level-plan", glyph: "EXP", icon: "img/exp-coupon-3x.png", hue: 150, title: "레벨업 계산", text: "사냥터 효율과 쿠폰으로 목표 레벨까지 걸리는 시간" },
  { id: "maker", glyph: "◆", icon: "img/maker-icon.png", hue: 210, title: "메이커 계산", text: "보석 제작 단계별 비용과 기대 이익" },
  { id: "dojo", glyph: "武", icon: "img/dojo-icon.png", hue: 25, title: "무릉도장 루트", text: "구간 기록으로 검은 허리띠까지 가장 빠른 루트" },
];

function renderGuest(root) {
  const tools = OPEN_TOOLS.filter((tool) => routes.some((route) => route.id === tool.id));
  root.innerHTML = `
    <div class="ym-home is-guest">
      <div class="ym-home-col">
        <section class="ym-home-hero ym-glass ym-guest-hero">
          <span class="ym-guest-kicker">메이플랜드 도우미</span>
          <h2>계산은 바로, 기록은 로그인해서</h2>
          <p>레벨업·메이커·무릉 계산은 로그인 없이 써 보세요. 저장 버튼을 누를 때만 로그인하면 되고, 입력한 값은 로그인 뒤에도 그대로 남아요.</p>
          <div class="ym-guest-providers" role="group" aria-label="로그인 방법 선택">${providerButtons("data-home-oauth")}</div>
          <p class="ym-guest-legal">계속하면 <a href="./terms.html">이용약관</a>과 <a href="./privacy.html">개인정보 처리방침</a>에 동의합니다.</p>
        </section>
        <section class="ym-home-panel ym-glass ym-home-features">
          <header class="ym-home-head"><h2>모든 기능</h2><span>🔒 = 로그인하면 열려요</span></header>
          <div class="ym-feature-grid">${categories.map(featureTile).join("")}</div>
        </section>
      </div>
      <div class="ym-home-col">
        <section class="ym-home-panel ym-glass ym-guest-tools">
          <header class="ym-home-head"><h2>로그인 없이 쓰는 계산기</h2></header>
          <div class="ym-guest-tool-list">${tools
            .map((tool, index) => `<a class="ym-guest-tool" href="#/${tool.id}" style="--hue:${tool.hue};--i:${index}">
              <span class="ym-feature-glyph${tool.icon ? " is-icon" : tool.glyph.length > 1 ? " is-small" : ""}" aria-hidden="true">${tool.icon ? glyphInner(tool) : escapeHtml(tool.glyph)}</span>
              <span><strong>${escapeHtml(tool.title)}</strong><small>${escapeHtml(tool.text)}</small></span>
              <i aria-hidden="true">›</i>
            </a>`)
            .join("")}</div>
        </section>
        <section class="ym-home-panel ym-glass ym-guest-more">
          <header class="ym-home-head"><h2>로그인하면</h2></header>
          <ul>
            <li>캐릭터별 보스·무릉·파퀘 숙제 체크와 다시 가능한 시각</li>
            <li>사냥 기록, 경험치, 퀘스트 진행, 메모·링크</li>
            <li>입력한 시세와 기록을 다른 기기에서도 그대로</li>
          </ul>
        </section>
      </div>
    </div>`;
  let signingIn = false;
  root.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-home-oauth]");
    if (button) {
      if (signingIn) return;
      signingIn = true;
      const buttons = [...root.querySelectorAll("[data-home-oauth]")];
      for (const item of buttons) item.disabled = true;
      button.classList.add("is-busy");
      button.setAttribute("aria-busy", "true");
      rememberNext("dashboard", "");
      try {
        const result = await signInWithProvider(button.dataset.homeOauth);
        if (result.error) throw new Error(result.error);
      } catch (error) {
        if (!root.isConnected) return;
        notify(translateAuthError(error), "error");
        signingIn = false;
        for (const item of buttons) item.disabled = false;
        button.classList.remove("is-busy");
        button.removeAttribute("aria-busy");
      }
      return;
    }
    if (event.target.closest(".ym-guest-tool, .ym-feature-tile a, .ym-feature-tile button")) sfx("tick");
  });
}

export async function render(root) {
  if (!isLoggedIn()) {
    renderGuest(root);
    return;
  }
  root.innerHTML = `
    <div class="ym-home">
      <div class="ym-home-col">
        <section class="ym-home-hero ym-glass" data-hero>
          <p class="home-empty">캐릭터를 불러오는 중입니다.</p>
        </section>
        <section class="ym-home-panel ym-glass ym-home-features">
          <header class="ym-home-head"><h2>모든 기능</h2><span>${categories.length}개 분류 · ${routes.length - 1}개 기능</span></header>
          <div class="ym-feature-grid">${categories.map(featureTile).join("")}</div>
        </section>
      </div>
      <div class="ym-home-col">
        <section class="ym-home-panel ym-glass ym-home-bosses">
          <header class="ym-home-head"><h2>오늘의 보스</h2><span class="ym-home-ready" data-ready-count></span></header>
          <div class="home-board" data-glance>
            <p class="home-empty">불러오는 중입니다.</p>
          </div>
        </section>
        <section class="ym-home-panel ym-glass ym-home-memo">
          <header class="ym-home-head"><h2>메모</h2><a class="ym-home-more" href="#/notes">메모 관리</a></header>
          <div data-notes>
            <p class="home-empty">메모를 불러오는 중입니다.</p>
          </div>
        </section>
      </div>
    </div>
  `;

  const glance = root.querySelector("[data-glance]");
  const notes = root.querySelector("[data-notes]");
  const hero = root.querySelector("[data-hero]");
  const readyCount = root.querySelector("[data-ready-count]");
  let rows = [];
  let progress = { curve: new Map(), hunts: [] };

  root.addEventListener("click", (event) => {
    const pick = event.target.closest("[data-hero-pick]");
    if (pick) {
      sfx("tick");
      setMainCharacter(pick.dataset.heroPick).then((ok) => {
        if (!ok || !hero.isConnected) return;
        burstAt(hero.querySelector(".ym-hero-face"), ["#ffe28a", "#c9a6ff", "#ffffff"], 18, 0.8);
      });
      return;
    }
    if (event.target.closest(".ym-feature-tile a, .ym-feature-tile button, .ym-home-more")) sfx("tick");
  });

  const supabase = await getSupabase();
  if (!glance.isConnected) return;
  const noteResult = await supabase
    .from("notes")
    .select("id, title, content, category")
    .order("updated_at", { ascending: false })
    .limit(NOTE_LIMIT);
  const [result, curveResult, huntResult] = await Promise.all([
    loadCharacters(supabase),
    supabase.from("level_exp").select("level, exp_to_next"),
    supabase.from("hunts").select("id, title, character_id, level, exp_per_hour"),
    loadMainCharacter(),
  ]);
  if (!glance.isConnected) return;
  progress = {
    curve: new Map((curveResult.data ?? []).map((row) => [row.level, row.exp_to_next])),
    hunts: huntResult.data ?? [],
  };
  paintNotes(notes, noteResult);
  if (result.error) {
    glance.innerHTML = `<p class="form-message is-error"></p>`;
    glance.querySelector("p").textContent = translateDbError(result.error);
    hero.innerHTML = `<p class="home-empty">캐릭터를 불러오지 못했습니다.</p>`;
    return;
  }

  rows = result.data ?? [];
  await attachFaceUrls(supabase, rows);
  if (!glance.isConnected) return;
  paintHero(hero, rows, mainCharacterId(), progress);
  // 헤더 프로필에서 대표를 바꿔도 홈이 따라 바뀐다. 화면을 떠나면 리스너를 뗀다.
  const onMainChange = (event) => {
    if (!hero.isConnected) {
      window.removeEventListener("main-character-change", onMainChange);
      return;
    }
    paintHero(hero, rows, event.detail.id, progress);
  };
  window.addEventListener("main-character-change", onMainChange);
  let signature = "";
  const timer = window.setInterval(tick, 1000);

  function tick() {
    if (!glance.isConnected) {
      window.clearInterval(timer);
      return;
    }
    const now = Date.now();
    const next = boardSignature(rows, now);
    if (next === signature) {
      refreshClocks(glance, now);
      return;
    }
    signature = next;
    const lanes = sections.map((section) => ({ section, items: rowsFor(rows, section, now) }));
    glance.innerHTML = lanes.map(({ section, items }, index) => sectionCard(section, items, index)).join("");
    const ready = lanes.reduce((sum, lane) => sum + lane.items.filter((item) => item.slot.ready).length, 0);
    readyCount.textContent = ready ? `지금 가능 ${formatCount(ready)}` : "";
  }

  tick();
}

// ── 대표 캐릭터 ──────────────────────────────────────────────────────────

function byLevel(left, right) {
  return (right.level ?? -1) - (left.level ?? -1) || left.name.localeCompare(right.name, "ko");
}

function jobColor(row) {
  const color = jobRecord(row)?.color;
  return /^#[0-9a-fA-F]{6}$/.test(color || "") ? color : "";
}

function accountName(row) {
  const account = Array.isArray(row.accounts) ? row.accounts[0] : row.accounts;
  return account?.name || "";
}

// 경험치 막대: 입력이 없으면 입력 안내, 레벨 표가 없으면 레벨업 계산 안내.
function expHtml(main, progress) {
  const result = expProgress({
    level: main.level,
    exp: main.exp,
    curve: progress.curve,
    hunts: progress.hunts,
    characterId: main.id,
    mainHuntId: main.main_hunt_id,
  });
  if (result.state === "no-exp") {
    return `<a class="ym-hero-exp-hint" href="#/characters">경험치를 입력하면 다음 레벨까지 남은 양과 사냥 시간이 보입니다 ›</a>`;
  }
  if (result.state === "no-curve") {
    return `<a class="ym-hero-exp-hint" href="#/level-plan">레벨업 계산에 ${escapeHtml(formatCount(main.level))}레벨 경험치 표를 넣으면 진행률이 보입니다 ›</a>`;
  }
  if (result.state === "over") {
    return `<a class="ym-hero-exp-hint" href="#/characters">입력한 경험치가 이 레벨의 필요 경험치보다 큽니다. 레벨을 확인해 주세요 ›</a>`;
  }
  const hunt = result.hunt
    ? `<span class="ym-hero-exp-time">사냥 약 <strong>${escapeHtml(formatMinutes(result.minutes))}</strong> · ${escapeHtml(result.hunt.title || "이름 없는 기록")} ${result.mainHunt ? "(대표 사냥터)" : "(가장 좋은 기록)"}</span>`
    : `<a class="ym-hero-exp-time" href="#/hunts">사냥 기록을 남기면 남은 시간이 보입니다 ›</a>`;
  return `
    <div class="ym-hero-exp">
      <div class="ym-hero-exp-head">
        <span class="ym-hero-exp-label">EXP</span>
        <span class="ym-hero-exp-value">${result.percent}% <span>· 다음 레벨까지 ${escapeHtml(formatCount(result.remaining))}</span></span>
      </div>
      <div class="ym-hero-exp-track" role="progressbar" aria-label="경험치 진행률" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${result.percent}">
        <div class="ym-hero-exp-fill" style="--w:${Math.max(0.5, result.ratio * 100)}%"><i></i></div>
      </div>
      ${hunt}
    </div>
  `;
}

function paintHero(hero, rows, heroId, progress) {
  if (!rows.length) {
    hero.innerHTML = `
      <div class="ym-hero-empty">
        <strong>아직 캐릭터가 없습니다</strong>
        <p>캐릭터를 넣으면 대표 캐릭터와 오늘의 보스가 여기에 보입니다.</p>
        <a class="ym-add" href="#/characters">캐릭터 추가하러 가기</a>
      </div>
    `;
    return;
  }
  const sorted = [...rows].sort(byLevel);
  const main = sorted.find((row) => row.id === heroId) || sorted[0];
  const job = jobRecord(main);
  const jobName = job?.name || main.job || "직업 없음";
  const color = jobColor(main);
  const face = main.face_url
    ? faceMarkup(main.face_url)
    : `<span class="char-face is-letter">${escapeHtml([...String(main.name).trim()][0] || "?")}</span>`;
  const meta = [job ? jobLabel(job.name, job) : escapeHtml(jobName), accountName(main) ? escapeHtml(accountName(main)) : "", "대표 캐릭터"]
    .filter(Boolean)
    .join(" · ");
  const alts = sorted
    .filter((row) => row.id !== main.id)
    .slice(0, 5)
    .map((row) => {
      const tint = jobColor(row);
      return `<button type="button" class="ym-hero-alt" data-hero-pick="${row.id}"${tint ? ` style="--tint:${tint}"` : ""} title="${escapeHtml(row.name)}을 대표로">
        <span class="ym-hero-alt-dot">${escapeHtml([...String(row.name).trim()][0] || "?")}</span>
        <span class="ym-hero-alt-copy"><strong>${escapeHtml(row.name)}</strong><span>Lv.${escapeHtml(formatCount(row.level))} · ${escapeHtml(jobRecord(row)?.name || row.job || "직업 없음")}</span></span>
      </button>`;
    })
    .join("");
  hero.innerHTML = `
    <div class="ym-hero-main"${color ? ` style="--tint:${color}"` : ""}>
      <div class="ym-hero-face">${face}</div>
      <div class="ym-hero-copy">
        <div class="ym-hero-name"><strong>${escapeHtml(main.name)}</strong><span class="ym-hero-level">Lv. ${escapeHtml(formatCount(main.level))}</span></div>
        <span class="ym-hero-meta">${meta}</span>
      </div>
    </div>
    ${expHtml(main, progress)}
    ${alts ? `<div class="ym-hero-alts" role="group" aria-label="대표 캐릭터 바꾸기">${alts}</div>` : ""}
  `;
}

// ── 모든 기능 ────────────────────────────────────────────────────────────

function featureTile(category, index) {
  const lock = (route) => (route.auth && !isLoggedIn() ? `<i class="ym-feature-lock" aria-label="로그인 필요">🔒</i>` : "");
  const subs = category.routes
    .map((route) =>
      route.quick
        ? `<button type="button" class="ym-feature-sub" data-quick-nav="${route.id}">${escapeHtml(route.label)}${lock(route)}</button>`
        : `<a class="ym-feature-sub" href="#/${route.id}">${escapeHtml(route.label)}${lock(route)}</a>`,
    )
    .join("");
  const first = category.routes.find((route) => !route.quick) ?? category.routes[0];
  const glyph = String(category.glyph);
  // 링크처럼 화면이 없는(quick) 분류는 타일을 눌러도 패널을 연다.
  const mainAttrs = first.quick ? `type="button" data-quick-nav="${first.id}"` : `href="#/${first.id}"`;
  const mainTag = first.quick ? "button" : "a";
  return `
    <div class="ym-feature-tile" style="--hue:${category.hue};--i:${index}">
      <${mainTag} class="ym-feature-main" ${mainAttrs}>
        <span class="ym-feature-glyph${category.icon ? " is-icon" : glyph.length > 1 ? " is-small" : ""}" aria-hidden="true">${category.icon ? glyphInner(category) : escapeHtml(glyph)}</span>
        <strong>${escapeHtml(category.label)}</strong>
      </${mainTag}>
      <div class="ym-feature-subs">${subs}</div>
    </div>
  `;
}

// ── 오늘의 보스 ──────────────────────────────────────────────────────────

function boardSignature(rows, now) {
  return sections
    .map((section) => {
      const items = rowsFor(rows, section, now);
      return `${section.key}:${items.map((item) => `${item.row.id}:${item.slot.ready ? "ready" : item.slot.at}`).join(",")}`;
    })
    .join("|");
}

function rowsFor(rows, section, now) {
  const boss = bosses.find((item) => item.key === section.key);
  return rows
    .filter((row) => row[boss.columnEnabled])
    .map((row) => ({ row, slot: todaySlot(row[boss.columnAt], now, boss) }))
    .filter((item) => item.slot.include)
    .sort(byToday);
}

function byToday(left, right) {
  const leftKey = left.slot.ready ? 0 : left.slot.at;
  const rightKey = right.slot.ready ? 0 : right.slot.at;
  if (leftKey !== rightKey) return leftKey - rightKey;
  return left.row.name.localeCompare(right.row.name, "ko");
}

function sectionCard(section, items, index) {
  const boss = bosses.find((item) => item.key === section.key);
  const body = items.length
    ? `<div class="home-chars">${items.map((item) => characterCard(section, item)).join("")}</div>`
    : `<p class="home-empty">${section.empty}</p>`;
  return `
    <section class="home-lane" style="--i:${index}">
      <header class="home-head">
        <img class="home-art" src="${art[section.key]}" alt="" width="44" height="44" />
        <div class="home-title">
          <h3>${boss.label}</h3>
          <p>${section.blurb}</p>
        </div>
        <span class="count-pill">${items.length}</span>
      </header>
      ${body}
    </section>
  `;
}

function characterCard(section, item) {
  const { row, slot } = item;
  const job = jobRecord(row);
  const name = job?.name || row.job;
  const meta = name ? `<span class="home-meta">${job ? jobLabel(job.name, job) : escapeHtml(name)}</span>` : "";
  const time = slot.ready
    ? `<strong class="home-ready">${section.ready}</strong>`
    : `<div class="home-clock"><div class="home-clock-line"><strong>${escapeHtml(formatPossible(slot.at))}</strong><span class="home-kicker">${section.mark}</span></div><span class="home-remain" data-next="${slot.at}" title="${escapeHtml(formatStamp(slot.at))}">${escapeHtml(formatRemain(slot.at - Date.now()))} 남음</span></div>`;
  return `
    <article class="home-char${slot.ready ? " is-ready" : ""}">
      <div class="home-who">
        <div class="home-identity">
          ${faceMarkup(row.face_url)}
          <strong>${escapeHtml(row.name)}</strong>
        </div>
        ${meta}
      </div>
      ${time}
    </article>
  `;
}

function refreshClocks(glance, now) {
  for (const node of glance.querySelectorAll("[data-next]")) {
    const at = Number(node.dataset.next);
    if (!Number.isFinite(at) || now >= at) continue;
    node.textContent = `${formatRemain(at - now)} 남음`;
  }
}

// ── 메모 미리보기 ─────────────────────────────────────────────────────────

function paintNotes(notes, result) {
  if (!notes.isConnected) return;
  if (result.error) {
    notes.innerHTML = `<p class="form-message is-error"></p>`;
    notes.querySelector("p").textContent = translateDbError(result.error);
    return;
  }
  const rows = result.data ?? [];
  if (!rows.length) {
    notes.innerHTML = `<p class="home-empty">아직 메모가 없습니다.</p>`;
    return;
  }
  notes.innerHTML = `<div class="home-notes">${rows.map(noteCard).join("")}</div>`;
}

function noteCard(row) {
  const content = String(row.content ?? "").trim();
  const body = content ? `<p>${escapeHtml(content)}</p>` : "";
  const hue = paletteHue(String(row.category ?? "").trim());
  return `<a class="home-note" href="#/notes" style="--hue:${hue}"><h3>${escapeHtml(row.title)}</h3>${body}</a>`;
}
