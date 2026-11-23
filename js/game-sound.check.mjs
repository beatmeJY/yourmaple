// 게임 소리 해석 검사: node js/game-sound.check.mjs
// 공개 게임 데이터 서버의 소리 값(base64)은 앞 82바이트 머리말 뒤가 MP3 다(2026-11-23 EnchantSuccess·EnchantFailure 실측).
import assert from "node:assert/strict";
import { decodeGameSound } from "./game-sound.js";

const make = (body) => Buffer.from([...new Uint8Array(82).fill(7), ...body]).toString("base64");
const mp3 = new Uint8Array(decodeGameSound(make([0xff, 0xf3, 0x44, 0xc4, 1, 2, 3])));
assert.deepEqual([...mp3], [0xff, 0xf3, 0x44, 0xc4, 1, 2, 3], "머리말 82바이트를 뺀 MP3");
assert.equal(new Uint8Array(decodeGameSound(make([0xff, 0xfb, 0x90, 0x00]))).length, 4, "MPEG-1 프레임도 허용");
assert.throws(() => decodeGameSound(make([0x52, 0x49, 0x46, 0x46])), /소리 형식/, "MP3 가 아니면 쓰지 않음");
assert.throws(() => decodeGameSound(make([])), /소리 형식/, "빈 자료");
console.log("game-sound: 머리말 82바이트·MP3 프레임 확인·다른 형식 거절 통과");
