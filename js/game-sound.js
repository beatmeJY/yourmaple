// 게임 소리 주소와 해석(2026-11-23). 공개 게임 데이터 서버의 소리 값은 base64 로 된 게임 소리 원본이고,
// 앞 82바이트(소리 형식 머리말) 뒤가 MP3 자료다(EnchantSuccess·EnchantFailure 실측). 재생은 js/effects.js 의 playSound.
export const GAME_SOUND_URLS = {
  scrollSuccess: "https://maplestory.io/api/wz/GMS/83/Sound/Game.img/EnchantSuccess",
  scrollFail: "https://maplestory.io/api/wz/GMS/83/Sound/Game.img/EnchantFailure",
  portal: "https://maplestory.io/api/wz/GMS/83/Sound/Game.img/Portal", // 맵 정보 포탈 이동(2026-11-23)
};
const HEADER = 82;

export function decodeGameSound(base64) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const mp3 = bytes.subarray(HEADER);
  // MP3 프레임 시작(0xFF, 다음 바이트 위 3비트 111)인지 확인해 형식이 바뀌었으면 쓰지 않는다.
  if (mp3.length < 4 || mp3[0] !== 0xff || (mp3[1] & 0xe0) !== 0xe0) throw new Error("알 수 없는 소리 형식");
  return mp3.slice().buffer;
}
