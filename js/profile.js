import { attachFaceUrls, faceMarkup, missingFaceColumn } from "./character-face.js";
import { translateDbError } from "./db-error.js";
import { burstAt, sfx } from "./effects.js";
import { escapeHtml, formatCount } from "./format.js";
import { jobRecord } from "./job-label.js";
import { getSupabase } from "./supabase-client.js";
import { notify } from "./toast.js";

// 대표 캐릭터: profiles.main_character_id 에 저장해 모든 기기에서 같게 보인다.
// sql/029 를 아직 실행하지 않아 칸이 없으면 이 브라우저에만 기억한다(예전 홈 방식).
// 바뀌면 window 에 "main-character-change" 이벤트를 보내 홈 같은 화면이 다시 그린다.
const LOCAL_KEY = "maple-note-hero";

let state = { loaded: false, saved: false, mainId: "", characters: [], userId: "" };
let loading = null;

function readLocal() {
  try {
    return localStorage.getItem(LOCAL_KEY) || "";
  } catch {
    return "";
  }
}

function writeLocal(id) {
  try {
    localStorage.setItem(LOCAL_KEY, id);
  } catch {
    // 저장이 막힌 브라우저에서는 이번 방문 동안만 바꾼다.
  }
}

function columnMissing(error) {
  const raw = `${error?.message || ""} ${error?.details || ""}`;
  return /main_character_id/i.test(raw) && /could not find|schema cache|does not exist/i.test(raw);
}

function byLevel(left, right) {
  return (right.level ?? -1) - (left.level ?? -1) || String(left.name).localeCompare(String(right.name), "ko");
}

async function load() {
  const supabase = await getSupabase();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id || "";
  let characters = await supabase.from("characters").select("id, name, level, job, face_path, jobs(name, color, color_dark)");
  if (characters.error && missingFaceColumn(characters.error)) {
    characters = await supabase.from("characters").select("id, name, level, job, jobs(name, color, color_dark)");
  }
  const rows = characters.error ? [] : [...(characters.data ?? [])].sort(byLevel);
  if (rows.length) await attachFaceUrls(supabase, rows);
  let mainId = "";
  let saved = false;
  if (userId) {
    const profile = await supabase.from("profiles").select("main_character_id").eq("id", userId).maybeSingle();
    if (!profile.error) {
      saved = true;
      mainId = profile.data?.main_character_id || "";
    } else if (!columnMissing(profile.error)) {
      notify(translateDbError(profile.error), "error");
    }
  }
  if (!saved) mainId = readLocal();
  if (!rows.some((row) => row.id === mainId)) mainId = rows[0]?.id || "";
  state = { loaded: true, saved, mainId, characters: rows, userId };
  return state;
}

/** 대표 캐릭터와 캐릭터 목록. force 면 다시 불러온다(캐릭터를 고친 뒤). */
export async function loadMainCharacter(force = false) {
  if (!force && state.loaded) return state;
  if (!force && loading) return loading;
  loading = load().finally(() => {
    loading = null;
  });
  return loading;
}

export function mainCharacterId() {
  return state.mainId;
}

/** 대표 캐릭터를 바꾼다. 성공하면 true. */
export async function setMainCharacter(id) {
  if (!id || id === state.mainId) return true;
  const previous = state.mainId;
  state = { ...state, mainId: id };
  if (state.saved && state.userId) {
    const supabase = await getSupabase();
    const { error } = await supabase.from("profiles").update({ main_character_id: id }).eq("id", state.userId);
    if (error) {
      state = { ...state, mainId: previous };
      notify(translateDbError(error), "error");
      return false;
    }
  } else {
    writeLocal(id);
  }
  window.dispatchEvent(new CustomEvent("main-character-change", { detail: { id } }));
  paintProfileButton();
  return true;
}

// ── 헤더 프로필 얼굴 + 대표 캐릭터 고르기 메뉴 ─────────────────────────────

function letterFace(row) {
  return `<span class="char-face is-letter">${escapeHtml([...String(row?.name ?? "").trim()][0] || "?")}</span>`;
}

function faceOf(row) {
  return row?.face_url ? faceMarkup(row.face_url) : letterFace(row);
}

function jobColor(row) {
  const color = jobRecord(row)?.color;
  return /^#[0-9a-fA-F]{6}$/.test(color || "") ? color : "";
}

export function paintProfileButton() {
  const button = document.querySelector("[data-profile-toggle]");
  if (!button) return;
  const main = state.characters.find((row) => row.id === state.mainId);
  const color = main ? jobColor(main) : "";
  button.style.setProperty("--tint", color || "oklch(0.8 0.13 295)");
  button.innerHTML = main
    ? `${faceOf(main)}<span class="topbar-profile-name">${escapeHtml(main.name)}</span>`
    : `<span class="char-face is-letter">?</span><span class="topbar-profile-name">대표 캐릭터</span>`;
  button.setAttribute("aria-label", main ? `대표 캐릭터 ${main.name}, 바꾸기` : "대표 캐릭터 고르기");
}

function paintMenu(menu) {
  if (!state.characters.length) {
    menu.innerHTML = `<p class="profile-menu-empty">캐릭터가 없습니다.</p><a class="profile-menu-link" href="#/characters" data-profile-close>캐릭터 추가하러 가기</a>`;
    return;
  }
  const items = state.characters
    .map((row) => {
      const on = row.id === state.mainId;
      const color = jobColor(row);
      return `<button type="button" class="profile-menu-item${on ? " is-on" : ""}" data-profile-pick="${row.id}" role="menuitemradio" aria-checked="${on}"${color ? ` style="--tint:${color}"` : ""}>
        ${faceOf(row)}
        <span class="profile-menu-copy"><strong>${escapeHtml(row.name)}</strong><span>Lv.${escapeHtml(formatCount(row.level))} · ${escapeHtml(jobRecord(row)?.name || row.job || "직업 없음")}</span></span>
        ${on ? `<span class="profile-menu-mark">대표</span>` : ""}
      </button>`;
    })
    .join("");
  const note = state.saved ? "모든 기기에서 같은 대표 캐릭터가 보입니다." : "sql/029 실행 전이라 이 브라우저에만 기억합니다.";
  menu.innerHTML = `<p class="profile-menu-title">대표 캐릭터</p><div class="profile-menu-list" role="menu">${items}</div><p class="profile-menu-note">${note}</p>`;
}

function closeMenu() {
  const menu = document.querySelector("[data-profile-menu]");
  const button = document.querySelector("[data-profile-toggle]");
  if (menu) menu.hidden = true;
  button?.setAttribute("aria-expanded", "false");
}

async function toggleMenu() {
  const menu = document.querySelector("[data-profile-menu]");
  const button = document.querySelector("[data-profile-toggle]");
  if (!menu || !button) return;
  if (!menu.hidden) {
    closeMenu();
    return;
  }
  sfx("tick");
  menu.hidden = false;
  button.setAttribute("aria-expanded", "true");
  menu.innerHTML = `<p class="profile-menu-empty">불러오는 중입니다.</p>`;
  await loadMainCharacter(true);
  if (menu.hidden) return;
  paintMenu(menu);
  paintProfileButton();
  menu.querySelector(".profile-menu-item.is-on, .profile-menu-item")?.focus({ preventScroll: true });
}

let wired = false;

/** 헤더가 그려질 때마다 부른다. 이벤트는 한 번만 단다. */
export function mountProfile() {
  paintProfileButton();
  loadMainCharacter(true).then(paintProfileButton);
  if (wired) return;
  wired = true;
  document.addEventListener("click", async (event) => {
    if (event.target.closest("[data-profile-toggle]")) {
      await toggleMenu();
      return;
    }
    const pick = event.target.closest("[data-profile-pick]");
    if (pick) {
      const ok = await setMainCharacter(pick.dataset.profilePick);
      if (!ok) return;
      sfx("check");
      burstAt(document.querySelector("[data-profile-toggle]"), ["#ffe28a", "#c9a6ff", "#ffffff"], 18, 0.8);
      closeMenu();
      return;
    }
    if (event.target.closest("[data-profile-close]") || !event.target.closest("[data-profile-menu]")) closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    const menu = document.querySelector("[data-profile-menu]");
    if (!menu || menu.hidden) return;
    if (event.key === "Escape") {
      closeMenu();
      document.querySelector("[data-profile-toggle]")?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = [...menu.querySelectorAll(".profile-menu-item")];
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement);
    const next = event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
    items[next].focus();
  });
}
