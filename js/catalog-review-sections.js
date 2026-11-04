// 원문에 양쪽 모두 없는 항목만 생략합니다. 다른 차이나 직접 작성한 초안은 지우지 않습니다.
const hasText = value => typeof value === "string" && value.trim().length > 0;
const hasDescription = value => hasText(value?.description) || hasText(value?.effect_description);
const hasStats = value => value && typeof value === "object" && !Array.isArray(value)
  && Object.values(value).some(v => v != null && String(v).trim() !== "");
export function reviewSections(item) {
  const a = item?.proposals?.api, b = item?.proposals?.comparison;
  const skipDescription = !hasDescription(a) && !hasDescription(b);
  const skipStats = !hasStats(a?.base_options) && !hasStats(b?.base_options);
  const draft = item?.draft ?? {};
  return {
    skipDescription, skipStats,
    openDescription: !skipDescription || hasDescription(draft),
    openStats: !skipStats || Boolean(hasStats(draft.base_options)),
    // 범용 미확인/한쪽 누락/실제 수치 차이는 생략하지 않습니다.
    unknown: (item?.comparison?.unknown ?? []).filter(reason => !(skipDescription && reason === "양쪽 효과 설명이 없어 옵션 비교 불가")),
  };
}
