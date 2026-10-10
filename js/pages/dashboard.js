import { bosses, formatPossible, formatRemain, formatStamp, todaySlot } from "../boss-cooldown.js";
import { attachFaceUrls, faceMarkup, missingFaceColumn } from "../character-face.js";
import { translateDbError } from "../db-error.js";
import { burstAt, paletteHue, sfx } from "../effects.js";
import { escapeHtml, formatCount } from "../format.js";
import { jobLabel, jobRecord } from "../job-label.js";
import { categories, routes } from "../routes.js";
import { getSupabase } from "../supabase-client.js";

// 대표 캐릭터는 DB에 없으므로 이 브라우저에만 기억한다. 없으면 가장 높은 레벨 캐릭터.
const HERO_KEY = "maple-note-hero";
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

function readHero() {
  try {
    return localStorage.getItem(HERO_KEY) || "";
  } catch {
    return "";
  }
}

function saveHero(id) {
  try {
    localStorage.setItem(HERO_KEY, id);
  } catch {
    // 저장이 막힌 브라우저에서는 이번 방문 동안만 바꾼다.
  }
}

export async function render(root) {
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

  root.addEventListener("click", (event) => {
    const pick = event.target.closest("[data-hero-pick]");
    if (pick) {
      saveHero(pick.dataset.heroPick);
      sfx("tick");
      paintHero(hero, rows, pick.dataset.heroPick);
      burstAt(hero.querySelector(".ym-hero-face"), ["#ffe28a", "#c9a6ff", "#ffffff"], 18, 0.8);
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
  let result = await supabase
    .from("characters")
    .select(`id, name, job, level, face_path, ${bossColumns}, jobs(name, color, color_dark), accounts(name)`);
  if (result.error && missingFaceColumn(result.error)) {
    result = await supabase
      .from("characters")
      .select(`id, name, job, level, ${bossColumns}, jobs(name, color, color_dark), accounts(name)`);
  }
  if (!glance.isConnected) return;
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
  paintHero(hero, rows, readHero());
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

function paintHero(hero, rows, heroId) {
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
    ${alts ? `<div class="ym-hero-alts" role="group" aria-label="대표 캐릭터 바꾸기">${alts}</div>` : ""}
  `;
}

// ── 모든 기능 ────────────────────────────────────────────────────────────

function featureTile(category, index) {
  const subs = category.routes
    .map((route) =>
      route.quick
        ? `<button type="button" class="ym-feature-sub" data-quick-nav="${route.id}">${escapeHtml(route.label)}</button>`
        : `<a class="ym-feature-sub" href="#/${route.id}">${escapeHtml(route.label)}</a>`,
    )
    .join("");
  const first = category.routes.find((route) => !route.quick) ?? category.routes[0];
  const glyph = String(category.glyph);
  return `
    <div class="ym-feature-tile" style="--hue:${category.hue};--i:${index}">
      <a class="ym-feature-main" href="#/${first.id}">
        <span class="ym-feature-glyph${glyph.length > 1 ? " is-small" : ""}" aria-hidden="true">${escapeHtml(glyph)}</span>
        <strong>${escapeHtml(category.label)}</strong>
      </a>
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
