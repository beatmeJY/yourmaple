// 이 파일을 복사해 js/config.js 를 만듭니다.
// Project URL과 Publishable key만 넣습니다.
// Secret key, service_role, sb_secret_ 는 넣지 않습니다.
export const config = {
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabasePublishableKey: "YOUR_KEY",
  // 선택: Google 공식 로그인 버튼(Google Cloud 콘솔 OAuth 웹 클라이언트 ID, 공개 값). 비우면 예전 이동 방식 버튼.
  googleClientId: "",
};
