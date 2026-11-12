export function render(root) {
  root.innerHTML = `<section class="ym-glass" style="padding: 24px">
    <h1>배 시간표와 헬리오스탑</h1>
    <p>상단의 교통 시간표를 열면 탑승 마감, 다음 출발 시각과 남은 시간을 확인할 수 있어요.</p>
    <ul>
      <li>배는 10분 간격으로 출발해요. 출발 5분 전부터 탑승할 수 있고, 1분 전에 마감돼요.</li>
      <li>헬리오스탑 엘리베이터는 4분 주기로 상행·하행을 반복해요.</li>
    </ul>
  </section>`;
}
