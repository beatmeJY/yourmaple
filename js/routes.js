// 메뉴를 추가할 때는 분류의 routes에 한 줄 넣고, js/pages/ 에 화면 파일을 추가합니다.
// hue는 분류 색(oklch(0.8 0.13 hue))이고, glyph는 사이드바 아이콘 글자입니다.
// quick: true는 페이지 이동 대신 버튼으로 동작합니다(예: 링크 패널).
// dev: true는 개발 중이라 운영 주소에서는 숨깁니다(주소에 ?dev 를 붙이면 보임, js/dev-mode.js).
import { devMode } from "./dev-mode.js";

export const homeRoute = { id: "dashboard", label: "홈", glyph: "⌂" };

const allCategories = [
  { id: "account", label: "계정·캐릭", glyph: "캐", hue: 295, routes: [{ id: "characters", label: "캐릭터 관리" }, { id: "homework", label: "숙제 체크리스트" }] },
  { id: "hunt", label: "경험치·사냥터", glyph: "EXP", hue: 150, routes: [{ id: "hunts", label: "사냥 기록" }, { id: "level-plan", label: "레벨업 계산" }] },
  { id: "dojo", label: "무릉도장", glyph: "武", hue: 25, routes: [{ id: "dojo", label: "층별 기록 · 허리띠 시세" }] },
  { id: "maker", label: "메이커·강화", glyph: "◆", hue: 210, routes: [{ id: "maker", label: "메이커 계산" }, { id: "enhance", label: "강화 계산", dev: true }] },
  { id: "trade", label: "거래", glyph: "⇄", hue: 180, routes: [{ id: "trades", label: "거래 장부" }] },
  { id: "quest", label: "퀘스트·몬스터", glyph: "Q", hue: 85, routes: [{ id: "quests", label: "퀘스트" }, { id: "monsters", label: "몬스터 도감" }] },
  { id: "memo", label: "메모", glyph: "✎", hue: 340, routes: [{ id: "notes", label: "메모" }, { id: "links", label: "링크", quick: true }] },
];

export const categories = allCategories
  .map((category) => ({ ...category, routes: category.routes.filter((route) => devMode || !route.dev) }))
  .filter((category) => category.routes.length);

/** 숨긴 화면인지(운영 주소에서 dev 없이 연 경우) */
export function isHiddenRoute(id) {
  return !devMode && allCategories.some((category) => category.routes.some((route) => route.id === id && route.dev));
}

export const routes = [homeRoute, ...categories.flatMap((category) => category.routes)];

export function categoryOf(routeId) {
  return categories.find((category) => category.routes.some((route) => route.id === routeId)) ?? null;
}
