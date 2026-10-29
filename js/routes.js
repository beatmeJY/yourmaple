// 메뉴를 추가할 때는 분류의 routes에 한 줄 넣고, js/pages/ 에 화면 파일을 추가합니다.
// auth: true = 내 기록을 보여 주는 화면이라 로그인해야 열린다. 없으면 로그인 없이도 열리는 계산기(저장할 때만 로그인).
// hue는 분류 색(oklch(0.8 0.13 hue))이고, glyph는 사이드바 아이콘 글자입니다. icon(그림 경로)이 있으면 글자 대신 그림을 씁니다(무릉도장, 2026-10-21).
// quick: true는 페이지 이동 대신 버튼으로 동작합니다(예: 링크 패널).
// dev: true는 개발 중이라 운영 주소에서는 숨깁니다(주소에 ?dev 를 붙이면 보임, js/dev-mode.js).
// until: "YYYY-MM-DD"는 이벤트 화면이라 그날(서울)이 지나면 운영 주소에서 숨깁니다(몬스터파크, 2026-10-27).
import { devMode } from "./dev-mode.js";
import { accountMenuFaceUrl } from "./profile.js";
import { escapeHtml } from "./format.js";

export const homeRoute = { id: "dashboard", label: "홈", glyph: "⌂" };

const allCategories = [
  { id: "account", label: "계정·캐릭", glyph: "캐", icon: "img/account-default-1.png", hue: 295, routes: [{ id: "characters", label: "캐릭터 관리", auth: true }, { id: "homework", label: "숙제 체크리스트", auth: true }] },
  { id: "hunt", label: "경험치·사냥터", glyph: "EXP", icon: "img/exp-coupon-3x.png", hue: 150, routes: [{ id: "hunts", label: "사냥 기록", auth: true }, { id: "level-plan", label: "레벨업 계산" }] },
  { id: "event", label: "몬스터 파크", glyph: "MP", icon: "img/monster-park.png", hue: 120, routes: [{ id: "monster-park", label: "몬스터파크 계산", until: "2026-11-30" }] },
  { id: "dojo", label: "무릉도장", glyph: "武", icon: "img/dojo-icon.png", hue: 25, routes: [{ id: "dojo", label: "층별 기록 · 허리띠 시세" }] },
  { id: "maker", label: "메이커", glyph: "◆", icon: "img/maker-icon.png", hue: 210, routes: [{ id: "maker", label: "보석 제작" }, { id: "maker-craft", label: "리버스 제작" }, { id: "maker-enchant", label: "장비 옵션 부여" }] },
  { id: "enhance", label: "강화", glyph: "⚒", icon: "img/enhance-icon.png", hue: 285, routes: [{ id: "chaos-scroll", label: "혼돈의 주문서" }, { id: "enhance", label: "강화 계산", dev: true }] },
  { id: "trade", label: "거래 내역", glyph: "⇄", icon: "img/trade-icon.png", hue: 180, routes: [{ id: "trades", label: "거래 내역", auth: true }] },
  { id: "quest", label: "퀘스트 정보", glyph: "Q", icon: "img/quest-icon.png", hue: 85, routes: [{ id: "quests", label: "퀘스트 정보", auth: true }] },
  { id: "monster", label: "몬스터 정보", glyph: "M", icon: "img/monster-icon.png", hue: 65, routes: [{ id: "monsters", label: "몬스터 도감" }] },
  { id: "item", label: "아이템 정보", glyph: "템", hue: 75, routes: [{ id: "item-catalog", label: "아이템 정보" }] },
  { id: "memo", label: "메모", glyph: "✎", hue: 340, routes: [{ id: "notes", label: "메모", auth: true }] },
  // 링크는 화면이 아니라 떠 있는 패널(quick). 2026-10-21 메모와 분리해 한 줄 메뉴로.
  { id: "link", label: "링크", glyph: "↗", hue: 260, routes: [{ id: "links", label: "링크", quick: true, auth: true }] },
];

const seoulToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const hiddenRoute = (route) => !devMode && (route.dev || (route.until && seoulToday > route.until));

export const categories = allCategories
  .map((category) => ({ ...category, routes: category.routes.filter((route) => !hiddenRoute(route)) }))
  .filter((category) => category.routes.length);

/** 숨긴 화면인지(운영 주소에서 dev 없이 연 경우, 기간이 끝난 이벤트 화면) */
export function isHiddenRoute(id) {
  return allCategories.some((category) => category.routes.some((route) => route.id === id && hiddenRoute(route)));
}

export const routes = [homeRoute, ...categories.flatMap((category) => category.routes)];

export function categoryOf(routeId) {
  return categories.find((category) => category.routes.some((route) => route.id === routeId)) ?? null;
}

export function needsLogin(routeId) {
  return routes.some((route) => route.id === routeId && route.auth);
}

/** 메뉴·홈·검색에 쓰는 분류 아이콘 안쪽: 그림(icon)이 있으면 그림, 없으면 글자(glyph) */
export function glyphInner(item) {
  if (item?.id === "account") return `<img class="glyph-icon account-menu-face" data-account-face src="${escapeHtml(accountMenuFaceUrl())}" alt="" width="36" height="36" />`;
  return item?.icon ? `<img class="glyph-icon" src="${item.icon}" alt="" width="36" height="36" />` : String(item?.glyph ?? "");
}
