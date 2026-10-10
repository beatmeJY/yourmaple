// 게임 같은 연출: 파티클, 성공 오버레이, 효과음.
// 화면 어디서든 import 해서 쓴다. 파티클·오버레이는 reduced-motion이면 끄고, 효과음은 헤더 토글로 끈다.

const SOUND_KEY = "maple-note-sound";
const quiet = window.matchMedia("(prefers-reduced-motion: reduce)");

export const BURST_COLORS = {
  success: ["#8ff0c4", "#ffe28a", "#ffffff"],
  low: ["#9fe3ff", "#d8f4ff", "#6fc6f0"],
  mid: ["#c9a6ff", "#efe2ff", "#9b7bff", "#ffffff"],
  gold: ["#ffe28a", "#fff6d0", "#ffb347", "#ff8a5c", "#ffffff"],
  warm: ["#ff9a6b", "#c9a6ff", "#ffffff"],
};

// 시안의 카드 색 5가지(hue). DB에 색 컬럼이 없는 메모·링크는 분류 이름마다 하나로 고정한다.
export const PALETTE_HUES = [295, 25, 150, 210, 85];

export function paletteHue(name) {
  if (!name) return PALETTE_HUES[0];
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return PALETTE_HUES[hash % PALETTE_HUES.length];
}

// ── 효과음 ───────────────────────────────────────────────────────────────

// [주파수, 시작(초), 길이(초), 파형, 음량]
const SOUNDS = {
  tick: [[1320, 0, 0.06, "sine", 0.05]],
  check: [[660, 0, 0.12, "triangle", 0.12], [990, 0.07, 0.2, "triangle", 0.12]],
  uncheck: [[440, 0, 0.12, "sine", 0.07]],
  low: [[600, 0, 0.16, "triangle", 0.11]],
  mid: [[523, 0, 0.12, "triangle", 0.12], [784, 0.08, 0.24, "triangle", 0.12]],
  high: [[523, 0, 0.14, "square", 0.05], [659, 0.1, 0.14, "square", 0.05], [784, 0.2, 0.14, "square", 0.05], [1047, 0.3, 0.5, "square", 0.06]],
  fail: [[220, 0, 0.22, "sawtooth", 0.05], [150, 0.1, 0.3, "sawtooth", 0.05]],
  fanfare: [[392, 0, 0.16, "triangle", 0.13], [523, 0.12, 0.16, "triangle", 0.13], [659, 0.24, 0.16, "triangle", 0.13], [784, 0.36, 0.6, "triangle", 0.15]],
};

let audio = null;

export function isSoundOn() {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundOn(on) {
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // 저장이 막힌 브라우저에서는 이번 방문 동안만 기본값을 쓴다.
  }
}

export function sfx(name) {
  const notes = SOUNDS[name];
  if (!notes || !isSoundOn()) return;
  try {
    // 브라우저는 사용자 동작 뒤에만 소리를 허용하므로 처음 소리를 낼 때 만든다.
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    const start = audio.currentTime;
    for (const [frequency, at, duration, type, volume] of notes) {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start + at);
      gain.gain.setValueAtTime(0.0001, start + at);
      gain.gain.exponentialRampToValueAtTime(volume, start + at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + at + duration);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(start + at);
      oscillator.stop(start + at + duration + 0.05);
    }
  } catch {
    // 소리를 낼 수 없는 환경이면 조용히 넘어간다.
  }
}

// ── 파티클 ───────────────────────────────────────────────────────────────

let canvas = null;
let context = null;
let particles = [];
let frame = 0;
let ratio = 1;

function ensureCanvas() {
  if (canvas?.isConnected) return;
  canvas = document.createElement("canvas");
  canvas.className = "fx-canvas";
  canvas.setAttribute("aria-hidden", "true");
  document.body.append(canvas);
  context = canvas.getContext("2d");
}

function fitCanvas() {
  ratio = window.devicePixelRatio || 1;
  const width = Math.round(window.innerWidth * ratio);
  const height = Math.round(window.innerHeight * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function drawStar(particle) {
  const size = particle.size * 2;
  context.save();
  context.translate(particle.x, particle.y);
  context.rotate(particle.rotation);
  context.moveTo(0, -size);
  context.quadraticCurveTo(0, 0, size, 0);
  context.quadraticCurveTo(0, 0, 0, size);
  context.quadraticCurveTo(0, 0, -size, 0);
  context.quadraticCurveTo(0, 0, 0, -size);
  context.fill();
  context.restore();
}

function loop() {
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = "lighter";
  particles = particles.filter((particle) => particle.life > 0);
  for (const particle of particles) {
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.vy += 0.11; // 중력
    particle.vx *= 0.985;
    particle.life -= particle.decay;
    particle.rotation += 0.08;
    context.globalAlpha = Math.max(particle.life, 0);
    context.fillStyle = particle.color;
    context.beginPath();
    if (particle.star) drawStar(particle);
    else {
      context.arc(particle.x, particle.y, particle.size * 0.6, 0, Math.PI * 2);
      context.fill();
    }
  }
  frame = particles.length ? requestAnimationFrame(loop) : 0;
  if (!frame) context.clearRect(0, 0, canvas.width, canvas.height);
}

/** 화면 좌표(x, y)에서 파티클을 터뜨린다. power가 클수록 멀리, 크게 퍼진다. */
export function burst(x, y, colors = BURST_COLORS.success, count = 22, power = 1) {
  if (quiet.matches) return;
  ensureCanvas();
  fitCanvas();
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (1.4 + Math.random() * 4) * power;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.6 * power,
      life: 1,
      decay: 0.012 + Math.random() * 0.018,
      size: 2 + Math.random() * 3.5 * Math.min(power, 1.6),
      color: colors[index % colors.length],
      star: Math.random() < 0.5,
      rotation: Math.random() * 6,
    });
  }
  if (!frame) frame = requestAnimationFrame(loop);
}

/** 요소 가운데 또는 클릭 위치에서 터뜨린다. */
export function burstAt(target, colors, count, power) {
  if (!target) return;
  if ("clientX" in target && (target.clientX || target.clientY)) {
    burst(target.clientX, target.clientY, colors, count, power);
    return;
  }
  // 키보드로 누른 클릭은 좌표가 0이므로 이벤트가 일어난 요소 가운데에서 터뜨린다.
  const element = target instanceof Element ? target : target.target;
  if (!(element instanceof Element)) return;
  const rect = element.getBoundingClientRect();
  burst(rect.left + rect.width / 2, rect.top + rect.height / 2, colors, count, power);
}

// ── 성공 오버레이 ─────────────────────────────────────────────────────────

let celebrateTimer = 0;

/** "상급 획득!" 같은 큰 성공 연출. 2.3초 뒤 사라지며 화면 조작을 막지 않는다. */
export function celebrate(title, subtitle = "") {
  clearTimeout(celebrateTimer);
  document.querySelector(".fx-celebrate")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "fx-celebrate";
  overlay.setAttribute("role", "status");
  overlay.innerHTML = `<div class="fx-celebrate-body"><i class="fx-ring"></i><i class="fx-ring is-late"></i><div class="fx-celebrate-text"><strong></strong><span></span></div></div>`;
  overlay.querySelector("strong").textContent = title;
  overlay.querySelector("span").textContent = subtitle;
  document.body.append(overlay);
  sfx("fanfare");
  const x = window.innerWidth / 2;
  const y = window.innerHeight / 2;
  burst(x, y, BURST_COLORS.gold, 90, 2.2);
  setTimeout(() => burst(x, y, BURST_COLORS.warm, 50, 1.6), 180);
  celebrateTimer = setTimeout(() => {
    overlay.classList.add("is-leaving");
    setTimeout(() => overlay.remove(), 300);
  }, 2300);
}
