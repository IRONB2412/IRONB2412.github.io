/* Orbit Hop — IronBCorporation. Plain JS + Canvas, no external assets. */
(() => {
'use strict';

// ---------- YouTube Playables SDK ----------
const yt = window.ytgame;
const IN_YT = !!(yt && yt.IN_PLAYABLES_ENV);
const safe = (fn) => { try { return fn(); } catch (e) { return undefined; } };

// ---------- helpers ----------
// rng drives level layout (seeded in Daily mode); effects use Math.random so layout stays identical.
let rng = Math.random;
const rnd = (a, b) => a + rng() * (b - a);
const frnd = (a, b) => a + Math.random() * (b - a);
function mulberry32(a) {
  return () => { a = (a + 0x6D2B79F5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
const dayNum = () => Math.floor(Date.now() / 86400000); // UTC day, same seed for everyone
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, f) => a + (b - a) * f;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
  const f = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  return dist(px, py, ax + dx * f, ay + dy * f);
}

// ---------- data ----------
const SKINS = [
  { n: 'Ember',   c: '#ffd29a', t: '#ff7a1a', cost: 0 },
  { n: 'Frost',   c: '#e2f4ff', t: '#3fa9ff', cost: 60 },
  { n: 'Toxic',   c: '#eaffb0', t: '#5fd400', cost: 120 },
  { n: 'Nebula',  c: '#ffd6ff', t: '#b44dff', cost: 200 },
  { n: 'Solar',   c: '#fffbd0', t: '#ffc400', cost: 350 },
  { n: 'Ghost',   c: '#ffffff', t: '#9aa4c8', cost: 500 },
  { n: 'Prism',   c: '#ffffff', t: 'rainbow', cost: 800 },
];
const THEMES = [
  { a: '#0b1030', b: '#1d0b35', h: [200, 280, 330] },
  { a: '#03201f', b: '#0a2b40', h: [160, 190, 45] },
  { a: '#2a0a12', b: '#3a1a05', h: [20, 350, 45] },
  { a: '#0a0a24', b: '#04263a', h: [260, 180, 300] },
  { a: '#141414', b: '#20103a', h: [0, 60, 120] },
];
const FEAT = { 5: 'Moving planets', 10: 'Asteroid belts', 15: 'Gravity wells',
  20: 'Flip-spin planets', 25: 'Black holes', 30: 'Wormholes' };
const themeOf = (i) => THEMES[Math.floor(i / 10) % THEMES.length];

// ---------- save ----------
const save = { v: 1, best: 0, dust: 0, skins: [0], skin: 0, sound: true, music: true, haptics: true,
  dailyDay: -1, streak: 0, dailyBest: 0, dailyBestDay: -1 };
async function loadSave() {
  try {
    let s = '';
    if (IN_YT) s = await yt.game.loadData();
    else s = localStorage.getItem('orbithop') || '';
    if (s) Object.assign(save, JSON.parse(s));
  } catch (e) { /* keep defaults */ }
}
function writeSave() {
  const s = JSON.stringify(save);
  try {
    if (IN_YT) yt.game.saveData(s).catch(() => {});
    else localStorage.setItem('orbithop', s);
  } catch (e) { /* ignore */ }
}

// ---------- canvas ----------
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
let W = 1, H = 1, DPR = 1, S = 1;
let paused = false;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = Math.max(1, window.innerWidth); H = Math.max(1, window.innerHeight);
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  S = Math.min(W / 100, H / 150); // world: >=100 wide, >=150 tall
  if (state !== 'boot') draw();
}

// ---------- audio (generated, no files) ----------
let actx = null, master = null, musicGain = null, noiseBuf = null, sysAudio = true;
function ensureAudio() {
  if (!actx) {
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      master = actx.createGain(); master.gain.value = 0.8; master.connect(actx.destination);
      musicGain = actx.createGain(); musicGain.gain.value = save.music ? 1 : 0; musicGain.connect(master);
      setInterval(musicTick, 150);
      noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.5, actx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { actx = null; }
  }
  applyAudio();
}
// YouTube mute (sysAudio) and pause always win over the in-game toggles.
const audioAllowed = () => sysAudio && !paused;
const soundOn = () => save.sound && audioAllowed();
function applyAudio() {
  if (!actx) return;
  if (musicGain) musicGain.gain.setTargetAtTime(save.music ? 1 : 0, actx.currentTime, 0.1);
  if (audioAllowed() && (save.sound || save.music)) { if (actx.state === 'suspended') actx.resume().catch(() => {}); }
  else if (actx.state === 'running') actx.suspend().catch(() => {});
}
function tone(f, dur, type = 'sine', vol = 0.12, slide = 1, delay = 0) {
  if (!actx || !soundOn()) return;
  const t = actx.currentTime + delay;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(30, f * slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol) {
  if (!actx || !soundOn()) return;
  const t = actx.currentTime, s = actx.createBufferSource(), g = actx.createGain(), fl = actx.createBiquadFilter();
  s.buffer = noiseBuf; fl.type = 'lowpass'; fl.frequency.setValueAtTime(1800, t);
  fl.frequency.exponentialRampToValueAtTime(120, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl); fl.connect(g); g.connect(master); s.start(t); s.stop(t + dur);
}
const sfx = {
  launch: () => tone(420, 0.14, 'triangle', 0.1, 1.8),
  land: (c) => tone(330 * Math.pow(1.06, Math.min(c, 14)), 0.18, 'sine', 0.14, 1.01),
  perfect: (c) => { const b = 520 * Math.pow(1.06, Math.min(c, 14)); tone(b, 0.12, 'sine', 0.1); tone(b * 1.5, 0.2, 'sine', 0.09, 1, 0.07); },
  dust: () => tone(1250, 0.06, 'sine', 0.05),
  die: () => { noise(0.6, 0.25); tone(220, 0.5, 'sawtooth', 0.06, 0.3); },
  click: () => tone(700, 0.05, 'square', 0.03),
  buy: () => { tone(523, 0.1, 'triangle', 0.1); tone(659, 0.1, 'triangle', 0.1, 1, 0.08); tone(784, 0.18, 'triangle', 0.1, 1, 0.16); },
  warp: () => tone(200, 0.3, 'sine', 0.1, 4),
  deny: () => tone(150, 0.15, 'square', 0.05),
};
// Generated ambient music: Am - F - C - G, soft pads + bass + sparse plucks, 16 s loop.
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
let musicNext = 0, musicStep = 0;
function mnote(m, t0, dur, type, vol, atk) {
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = mtof(m);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + atk);
  g.gain.setTargetAtTime(0, t0 + dur - atk, atk / 3);
  o.connect(g); g.connect(musicGain); o.start(t0); o.stop(t0 + dur + atk);
}
function musicTick() {
  if (!actx || actx.state !== 'running' || !save.music) return;
  const now = actx.currentTime;
  if (musicNext < now) musicNext = now + 0.05;
  while (musicNext < now + 0.6) {
    const step = musicStep % 8, ch = CHORDS[(musicStep >> 3) % 4], t0 = musicNext;
    if (step === 0) {
      for (const m of ch) mnote(m, t0, 4.2, 'triangle', 0.018, 1.2);
      mnote(ch[0] - 12, t0, 4, 'sine', 0.05, 0.3);
    }
    if (Math.random() < 0.6) mnote(ch[(step * 2) % 3] + (Math.random() < 0.3 ? 24 : 12), t0, 0.9, 'sine', 0.022, 0.02);
    musicNext += 0.5; musicStep++;
  }
}
function buzz(ms) { if (save.haptics && navigator.vibrate) safe(() => navigator.vibrate(ms)); }

// ---------- game state ----------
let state = 'boot';
let t = 0, last = 0;
let planets = [], hazards = [], dusts = [], parts = [], floats = [];
let comet, cur, score = 0, combo = 0, runDust = 0, banked = 0, maxIdx = 0;
let revived = false, doubled = false, flyT = 0, camY = 0, deathT = 0;
let mode = 'normal', dailyBonus = 0;
let banner = null, overAt = 0, shopMsg = null;
let ui = [], focus = 0, kbd = false;
let lastAdAt = performance.now(), runsSinceAd = 0, adBusy = false;
const adsOK = () => IN_YT ? !!(yt.ads && typeof yt.ads.requestRewardedAd === 'function') : true;

const stars = Array.from({ length: 150 }, () => ({ x: rng(), y: rng(), z: rnd(0.2, 1), s: rnd(0.5, 1.8) }));

function makePlanet(i, prev) {
  const r = clamp(9.5 - i * 0.07, 5.5, 9.5) * rnd(0.9, 1.1);
  let spin = (1.5 + Math.min(i, 45) * 0.045) * (rng() < 0.5 ? 1 : -1);
  if (i === 0) spin = 1.6;
  const y = prev ? prev.y - (rnd(34, 44) + Math.min(i * 0.25, 10)) : 0;
  let bx = prev ? clamp(prev.bx + rnd(-28, 28), -30, 30) : 0;
  const th = themeOf(i);
  const p = { idx: i, x: bx, bx, y, r, R: r + 5, spin, rot: rng() * 6,
    hue: th.h[i % 3] + rnd(-12, 12), amp: 0, ms: 0, ph: rng() * 6, flip: false, flipT: 0 };
  if (i >= 5 && rng() < 0.4) {
    p.amp = rnd(8, 16); p.ms = rnd(0.6, 1.2);
    p.bx = clamp(bx, -30 + p.amp, 30 - p.amp); p.x = p.bx;
  }
  if (i >= 20 && rng() < 0.35) p.flip = true;
  return p;
}

function placeAway(h, my, a, b, minLine) {
  for (let k = 0; k < 10; k++) {
    h.x = rnd(-32, 32); h.y = my + rnd(-5, 5);
    if (dist(h.x, h.y, a.bx, a.y) > a.R + h.r + 6 && dist(h.x, h.y, b.bx, b.y) > b.R + h.r + 6 &&
        segDist(h.x, h.y, a.bx, a.y, b.bx, b.y) > minLine) { hazards.push(h); return h; }
  }
  return null;
}

function addNext() {
  const prev = planets[planets.length - 1];
  const p = makePlanet(prev.idx + 1, prev);
  planets.push(p);
  const i = p.idx, my = (prev.y + p.y) / 2;
  for (const f of [0.35, 0.5, 0.65]) {
    if (rng() < 0.7) dusts.push({ x: lerp(prev.bx, p.bx, f) + rnd(-3, 3), y: lerp(prev.y, p.y, f), tw: rng() * 6 });
  }
  if (i >= 10 && rng() < 0.55)
    hazards.push({ k: 'ast', x: rnd(-50, 50), y: my, vx: rnd(12, 24) * (rng() < 0.5 ? 1 : -1), r: rnd(2.2, 3.2), rot: 0 });
  if (i >= 15 && rng() < 0.4) placeAway({ k: 'well', str: 6000, r: 6, rot: 0 }, my, prev, p, 4);
  if (i >= 25 && rng() < 0.3) placeAway({ k: 'hole', str: 9500, r: 3.5, rot: 0 }, my, prev, p, 9);
  if (i >= 30 && rng() < 0.25) {
    const a = placeAway({ k: 'worm', r: 3.5, rot: 0 }, my, prev, p, 6);
    if (a) { const b = { k: 'worm', r: 3.5, rot: 0, x: -a.x, y: a.y - 6, to: a }; a.to = b; hazards.push(b); }
  }
}

function attach(p, ang) { cur = p; comet.fly = false; comet.a = ang; }

function reset(m = 'normal') {
  mode = m; dailyBonus = 0;
  rng = m === 'daily' ? mulberry32(Math.imul(dayNum(), 2654435761) ^ 0x5eed) : Math.random;
  planets = []; hazards = []; dusts = []; parts = []; floats = [];
  score = 0; combo = 0; runDust = 0; banked = 0; maxIdx = 0;
  revived = false; doubled = false; flyT = 0; banner = null;
  const p0 = makePlanet(0, null);
  planets.push(p0);
  while (planets.length < 5) addNext();
  comet = { x: 0, y: 0, vx: 0, vy: 0, a: Math.PI, fly: false, trail: [], warpCd: 0 };
  attach(p0, Math.PI);
  camY = camTarget();
}

const viewH = () => H / S;
function camTarget() {
  if (!cur) return 0;
  const base = cur.y - viewH() * (state === 'menu' ? 0.12 : 0.2);
  return comet && comet.fly ? Math.min(base, comet.y - viewH() * 0.1) : base;
}

function launch() {
  if (comet.fly || state !== 'play') return;
  const sgn = Math.sign(cur.spin) || 1;
  const sp = 95 + Math.min(cur.idx, 40);
  comet.vx = -Math.sin(comet.a) * sgn * sp;
  comet.vy = Math.cos(comet.a) * sgn * sp;
  comet.fly = true; flyT = 0;
  sfx.launch(); buzz(8);
}

function capture(p) {
  const sp = Math.hypot(comet.vx, comet.vy) || 1;
  const dx = comet.vx / sp, dy = comet.vy / sp, rx = p.x - comet.x, ry = p.y - comet.y;
  const perfect = Math.abs(rx * dy - ry * dx) < p.r * 0.45;
  attach(p, Math.atan2(comet.y - p.y, comet.x - p.x));
  if (p.idx <= maxIdx) { sfx.land(0); return; }
  maxIdx = p.idx;
  score += 1;
  if (perfect) {
    combo++; score += 1; runDust += combo;
    floats.push({ x: p.x, y: p.y - p.R - 4, txt: combo > 1 ? `PERFECT x${combo}` : 'PERFECT', life: 1.2, c: '#ffe680' });
    sfx.perfect(combo); buzz(25);
    burst(comet.x, comet.y, '#ffe680', 14, 30);
  } else { combo = 0; sfx.land(0); buzz(12); }
  while (planets[planets.length - 1].idx < p.idx + 4) addNext();
  planets = planets.filter(q => q.idx >= p.idx - 1);
  hazards = hazards.filter(h => h.y < p.y + 60);
  dusts = dusts.filter(d => d.y < p.y + 60);
  const nf = FEAT[p.idx + 1];
  if (nf) banner = { txt: 'NEW: ' + nf, life: 2.4 };
  else if (p.idx % 10 === 0) banner = { txt: 'SECTOR ' + (p.idx / 10 + 1), life: 2 };
}

function burst(x, y, c, n, sp) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = frnd(sp * 0.3, sp);
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: frnd(0.4, 0.9), max: 0.9, c, s: frnd(0.5, 1.2) });
  }
}

function die() {
  state = 'dying'; deathT = 0;
  burst(comet.x, comet.y, skinTrail(), 40, 50);
  sfx.die(); buzz([30, 40, 60]);
}

function gameOver() {
  state = 'over'; overAt = performance.now(); focus = 0;
  save.dust += runDust - banked; banked = runDust;
  if (score > save.best) save.best = score;
  if (mode === 'daily') {
    const today = dayNum();
    if (save.dailyBestDay !== today) { save.dailyBest = 0; save.dailyBestDay = today; }
    if (score > save.dailyBest) save.dailyBest = score;
    if (save.dailyDay !== today) { // first daily run today: streak bonus
      save.streak = save.dailyDay === today - 1 ? save.streak + 1 : 1;
      save.dailyDay = today;
      dailyBonus = 20 + 10 * Math.min(save.streak - 1, 6);
      save.dust += dailyBonus;
    }
  }
  writeSave();
  runsSinceAd++;
  if (IN_YT && score > 0) safe(() => yt.engagement.sendScore({ value: score }));
}

// ---------- update ----------
function update(dt) {
  t += dt;
  for (const p of planets) {
    if (p.amp) p.x = p.bx + Math.sin(t * p.ms + p.ph) * p.amp;
    if (p.flip) { p.flipT += dt; if (p.flipT > 1.8) { p.flipT = 0; p.spin = -p.spin; } }
    p.rot += p.spin * dt;
  }
  for (const h of hazards) {
    h.rot += dt;
    if (h.k === 'ast') { h.x += h.vx * dt; if (h.x > 56) h.x = -56; if (h.x < -56) h.x = 56; }
  }
  if (state === 'play' || state === 'menu') updateComet(dt);
  if (state === 'dying') { deathT += dt; if (deathT > 0.9) gameOver(); }

  for (const q of parts) { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.96; q.vy *= 0.96; q.life -= dt; }
  parts = parts.filter(q => q.life > 0);
  for (const f of floats) { f.y -= 8 * dt; f.life -= dt; }
  floats = floats.filter(f => f.life > 0);
  for (const d of dusts) d.tw += dt * 4;
  if (banner) { banner.life -= dt; if (banner.life <= 0) banner = null; }
  if (shopMsg) { shopMsg.life -= dt; if (shopMsg.life <= 0) shopMsg = null; }
  camY = lerp(camY, camTarget(), 1 - Math.exp(-4 * dt));
}

function updateComet(dt) {
  if (!comet.fly) {
    comet.a += cur.spin * dt;
    comet.x = cur.x + Math.cos(comet.a) * cur.R;
    comet.y = cur.y + Math.sin(comet.a) * cur.R;
  } else {
    flyT += dt;
    comet.warpCd -= dt;
    for (const h of hazards) {
      if (h.k !== 'well' && h.k !== 'hole') continue;
      const dx = h.x - comet.x, dy = h.y - comet.y, d2 = Math.max(dx * dx + dy * dy, 16), d = Math.sqrt(d2);
      const a = h.str / d2;
      comet.vx += dx / d * a * dt; comet.vy += dy / d * a * dt;
    }
    const sp = Math.hypot(comet.vx, comet.vy);
    const steps = Math.max(1, Math.ceil(sp * dt / 1.2));
    const sdt = dt / steps;
    for (let s = 0; s < steps && comet.fly && state === 'play'; s++) {
      comet.x += comet.vx * sdt; comet.y += comet.vy * sdt;
      for (const p of planets) {
        if (p !== cur && dist(comet.x, comet.y, p.x, p.y) < p.R + 1.2) { capture(p); break; }
      }
      if (!comet.fly) break;
      for (const h of hazards) {
        const d = dist(comet.x, comet.y, h.x, h.y);
        if (h.k === 'ast' && d < h.r + 1.4) return die();
        if (h.k === 'hole' && d < h.r) return die();
        if (h.k === 'worm' && d < h.r && comet.warpCd <= 0) {
          const v = Math.hypot(comet.vx, comet.vy) || 1;
          comet.x = h.to.x + comet.vx / v * (h.r + 1.5); comet.y = h.to.y + comet.vy / v * (h.r + 1.5);
          comet.warpCd = 0.4; comet.trail = []; sfx.warp(); burst(h.to.x, h.to.y, '#7ff', 12, 25);
          break;
        }
      }
      for (let i = dusts.length - 1; i >= 0; i--) {
        if (dist(comet.x, comet.y, dusts[i].x, dusts[i].y) < 4) {
          burst(dusts[i].x, dusts[i].y, '#ffe680', 5, 15); dusts.splice(i, 1); runDust++; sfx.dust();
        }
      }
    }
    if (comet.fly && state === 'play') {
      const top = planets[planets.length - 1].y;
      if (flyT > 3.2 || Math.abs(comet.x) > 60 || comet.y > cur.y + 70 || comet.y < top - 60) die();
    }
  }
  comet.trail.push({ x: comet.x, y: comet.y });
  if (comet.trail.length > 22) comet.trail.shift();
}

// ---------- drawing ----------
const w2s = (x, y) => [W / 2 + x * S, H / 2 + (y - camY) * S];
const FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif';
function text(s, x, y, size, color = '#fff', weight = '800', align = 'center') {
  ctx.font = `${weight} ${Math.round(size)}px ${FONT}`;
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
const skin = () => SKINS[save.skin] || SKINS[0];
const skinTrail = (k = 0) => skin().t === 'rainbow' ? `hsl(${(t * 160 + k * 14) % 360},100%,60%)` : skin().t;

function drawBg() {
  const th = themeOf(cur ? cur.idx : 0);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, th.a); g.addColorStop(1, th.b);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  for (const s of stars) {
    const y = ((s.y * H - camY * S * 0.12 * s.z) % H + H) % H;
    ctx.globalAlpha = 0.35 + 0.5 * s.z * (0.7 + 0.3 * Math.sin(t * 2 + s.x * 40));
    ctx.fillStyle = '#fff';
    ctx.fillRect(s.x * W, y, s.s, s.s);
  }
  ctx.globalAlpha = 1;
}

function drawPlanet(p) {
  const [sx, sy] = w2s(p.x, p.y), r = p.r * S;
  if (sy < -p.R * S * 2 || sy > H + p.R * S * 2) return;
  ctx.setLineDash([3, 6]); ctx.lineWidth = 1.2;
  ctx.strokeStyle = p.flip ? `rgba(255,220,90,${0.25 + 0.2 * Math.sin(t * 8)})` : 'rgba(255,255,255,0.16)';
  ctx.beginPath(); ctx.arc(sx, sy, p.R * S, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  const glow = ctx.createRadialGradient(sx, sy, r * 0.8, sx, sy, r * 1.6);
  glow.addColorStop(0, `hsla(${p.hue},90%,60%,0.35)`); glow.addColorStop(1, `hsla(${p.hue},90%,60%,0)`);
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(sx, sy, r * 1.6, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createRadialGradient(sx - r * 0.35, sy - r * 0.35, r * 0.1, sx, sy, r);
  g.addColorStop(0, `hsl(${p.hue},85%,72%)`); g.addColorStop(0.6, `hsl(${p.hue},65%,42%)`); g.addColorStop(1, `hsl(${p.hue},60%,20%)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = `hsla(${p.hue},60%,18%,0.45)`;
  for (let k = 0; k < 3; k++) {
    const a = p.rot + k * 2.1, d = r * (0.35 + k * 0.15);
    ctx.beginPath(); ctx.arc(sx + Math.cos(a) * d, sy + Math.sin(a) * d * 0.9, r * (0.2 - k * 0.04), 0, Math.PI * 2); ctx.fill();
  }
}

function drawHazard(h) {
  const [sx, sy] = w2s(h.x, h.y), r = h.r * S;
  if (sy < -r * 4 || sy > H + r * 4) return;
  if (h.k === 'ast') {
    ctx.fillStyle = '#8a8178'; ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = h.rot + k / 8 * Math.PI * 2, rr2 = r * (0.8 + 0.2 * Math.sin(k * 3.7));
      k ? ctx.lineTo(sx + Math.cos(a) * rr2, sy + Math.sin(a) * rr2) : ctx.moveTo(sx + Math.cos(a) * rr2, sy + Math.sin(a) * rr2);
    }
    ctx.fill(); ctx.fillStyle = '#5d564f';
    ctx.beginPath(); ctx.arc(sx + r * 0.2, sy - r * 0.1, r * 0.25, 0, Math.PI * 2); ctx.fill();
  } else if (h.k === 'well') {
    for (let k = 0; k < 3; k++) {
      const f = ((t * 0.6 + k / 3) % 1);
      ctx.strokeStyle = `rgba(190,120,255,${0.5 * (1 - f)})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sy, r * (1.6 - f * 1.3), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = '#c99bff'; ctx.beginPath(); ctx.arc(sx, sy, r * 0.25, 0, Math.PI * 2); ctx.fill();
  } else if (h.k === 'hole') {
    const g = ctx.createRadialGradient(sx, sy, r * 0.6, sx, sy, r * 2.4);
    g.addColorStop(0, 'rgba(255,140,40,0.9)'); g.addColorStop(0.4, 'rgba(255,80,20,0.35)'); g.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r * 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
  } else if (h.k === 'worm') {
    ctx.lineWidth = 2.5;
    for (let k = 0; k < 2; k++) {
      ctx.strokeStyle = k ? 'rgba(120,255,255,0.9)' : 'rgba(120,180,255,0.6)';
      ctx.beginPath(); ctx.ellipse(sx, sy, r * (1 - k * 0.35), r * (1 - k * 0.35) * 0.8, h.rot * (k ? -2 : 2), 0, Math.PI * 2); ctx.stroke();
    }
  }
}

function drawComet() {
  const tr = comet.trail;
  for (let i = 1; i < tr.length; i++) {
    const [ax, ay] = w2s(tr[i - 1].x, tr[i - 1].y), [bx, by] = w2s(tr[i].x, tr[i].y);
    const f = i / tr.length;
    ctx.strokeStyle = skinTrail(i); ctx.globalAlpha = f * 0.8; ctx.lineWidth = f * 1.6 * S;
    ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const [sx, sy] = w2s(comet.x, comet.y), r = 1.6 * S;
  const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 3);
  g.addColorStop(0, skin().c); g.addColorStop(0.35, skinTrail()); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r * 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = skin().c; ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
}

function drawGuide() {
  const sgn = Math.sign(cur.spin) || 1, dx = -Math.sin(comet.a) * sgn, dy = Math.cos(comet.a) * sgn;
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  for (let k = 3; k < 45; k += 3) {
    const [sx, sy] = w2s(comet.x + dx * k, comet.y + dy * k);
    ctx.beginPath(); ctx.arc(sx, sy, 1.6, 0, Math.PI * 2); ctx.fill();
  }
}

function drawWorld() {
  drawBg();
  for (const h of hazards) drawHazard(h);
  for (const p of planets) drawPlanet(p);
  for (const d of dusts) {
    const [sx, sy] = w2s(d.x, d.y), s = (1 + 0.25 * Math.sin(d.tw)) * S * 1.1;
    ctx.fillStyle = '#ffe680'; ctx.beginPath();
    ctx.moveTo(sx, sy - s); ctx.lineTo(sx + s * 0.3, sy - s * 0.3); ctx.lineTo(sx + s, sy); ctx.lineTo(sx + s * 0.3, sy + s * 0.3);
    ctx.lineTo(sx, sy + s); ctx.lineTo(sx - s * 0.3, sy + s * 0.3); ctx.lineTo(sx - s, sy); ctx.lineTo(sx - s * 0.3, sy - s * 0.3);
    ctx.fill();
  }
  if (state === 'play' && !comet.fly && maxIdx < 3) drawGuide();
  if (state === 'play' || state === 'menu') drawComet();
  for (const q of parts) {
    const [sx, sy] = w2s(q.x, q.y);
    ctx.globalAlpha = clamp(q.life / q.max, 0, 1); ctx.fillStyle = q.c;
    ctx.beginPath(); ctx.arc(sx, sy, q.s * S * 0.6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const f of floats) {
    const [sx, sy] = w2s(f.x, f.y);
    ctx.globalAlpha = clamp(f.life, 0, 1);
    text(f.txt, sx, sy, Math.max(14, S * 4), f.c, '900');
  }
  ctx.globalAlpha = 1;
}

function shade(a) { ctx.fillStyle = `rgba(4,6,20,${a})`; ctx.fillRect(0, 0, W, H); }

function layoutButtons(defs, top) {
  const land = W > H * 1.25 && defs.length > 2;
  const cols = land ? 2 : 1;
  const bh = clamp(H * 0.085, 40, 58), gap = bh * 0.25;
  const bw = Math.min(land ? W * 0.3 : W * 0.72, 320);
  defs.forEach((d, i) => {
    const c = i % cols, r = (i / cols) | 0;
    const inRow = Math.min(cols, defs.length - r * cols), rw = inRow * bw + (inRow - 1) * gap; // centre a short last row
    ui.push(Object.assign({ x: W / 2 - rw / 2 + c * (bw + gap), y: top + r * (bh + gap), w: bw, h: bh }, d));
  });
  return top + Math.ceil(defs.length / cols) * (bh + gap);
}

function layoutRow(defs, top) { // small buttons side by side (settings toggles)
  const land = W > H * 1.25;
  const bh = clamp(H * 0.085, 40, 58), gap = bh * 0.25;
  const tw = land ? Math.min(W * 0.6 + gap, 660) : Math.min(W * 0.72, 320);
  const bw = (tw - gap * (defs.length - 1)) / defs.length;
  defs.forEach((d, i) => ui.push(Object.assign({ x: W / 2 - tw / 2 + i * (bw + gap), y: top, w: bw, h: bh,
    fs: Math.min(bh * 0.3, bw / 5.6) }, d)));
  return top + bh + gap;
}

function drawButton(b, f) {
  rr(b.x, b.y, b.w, b.h, b.h * 0.3);
  ctx.fillStyle = b.disabled ? 'rgba(255,255,255,0.06)' : b.primary ? '#ffb347' : 'rgba(255,255,255,0.14)';
  ctx.fill();
  if (f) { ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke(); }
  text(b.label, b.x + b.w / 2, b.y + b.h / 2, b.fs || b.h * 0.34, b.primary ? '#2a1200' : b.disabled ? 'rgba(255,255,255,0.35)' : '#fff');
}

function drawCard(b, f) {
  const i = b.card, sk = SKINS[i], owned = save.skins.includes(i), sel = save.skin === i;
  rr(b.x, b.y, b.w, b.h, b.w * 0.12);
  ctx.fillStyle = sel ? 'rgba(255,179,71,0.25)' : 'rgba(255,255,255,0.1)'; ctx.fill();
  ctx.lineWidth = f ? 3 : sel ? 2 : 1; ctx.strokeStyle = f ? '#fff' : sel ? '#ffb347' : 'rgba(255,255,255,0.2)'; ctx.stroke();
  const cx = b.x + b.w / 2, cy = b.y + b.h * 0.38, r = b.w * 0.12;
  const col = sk.t === 'rainbow' ? `hsl(${(t * 160) % 360},100%,60%)` : sk.t;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.6);
  g.addColorStop(0, sk.c); g.addColorStop(0.4, col); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r * 2.6, 0, Math.PI * 2); ctx.fill();
  text(sk.n, cx, b.y + b.h * 0.72, b.w * 0.14, '#fff');
  text(sel ? 'SELECTED' : owned ? 'OWNED' : '✦ ' + sk.cost, cx, b.y + b.h * 0.88, b.w * 0.11,
    sel ? '#ffb347' : owned ? '#9fe' : save.dust >= sk.cost ? '#ffe680' : 'rgba(255,255,255,0.45)', '700');
}

function drawUI() {
  ui = [];
  const u = Math.min(W, H);
  if (state === 'play' || state === 'dying') {
    const y = Math.max(H * 0.13, 56);
    text(String(score), W / 2, y, u * 0.1, '#fff', '900');
    text('✦ ' + (save.dust + runDust - banked), W / 2, y + u * 0.07, u * 0.04, '#ffe680', '700');
    if (state === 'play' && maxIdx === 0 && !comet.fly) {
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 5);
      text('TAP TO LAUNCH', W / 2, H * 0.86, u * 0.055, '#fff', '800');
      ctx.globalAlpha = 1;
    }
    if (mode === 'daily') text('DAILY CHALLENGE', W / 2, y + u * 0.12, u * 0.035, '#9fe', '800');
  } else if (state === 'menu') {
    shade(0.35);
    const today = dayNum(), playedToday = save.dailyDay === today;
    const streak = playedToday || save.dailyDay === today - 1 ? save.streak : 0;
    text('ORBIT HOP', W / 2, H * 0.18, u * 0.12, '#fff', '900');
    text(`BEST ${save.best}    ✦ ${save.dust}`, W / 2, H * 0.18 + u * 0.1, u * 0.045, '#cfe', '700');
    text(playedToday ? `Daily streak ${streak} · come back tomorrow for more ✦` : streak ? `Daily bonus waiting! Keep your ${streak}-day streak` : 'Daily bonus waiting!',
      W / 2, H * 0.18 + u * 0.16, u * 0.034, playedToday ? 'rgba(255,255,255,0.6)' : '#ffe680', '700');
    const y1 = layoutButtons([
      { label: 'PLAY', primary: true, cb: () => startRun('normal') },
      { label: 'DAILY CHALLENGE', cb: () => startRun('daily') },
      { label: 'SKINS', cb: () => { state = 'shop'; focus = 0; } },
    ], H * 0.42);
    layoutRow([
      { label: 'SFX ' + (save.sound ? 'ON' : 'OFF'), cb: () => { save.sound = !save.sound; applyAudio(); writeSave(); } },
      { label: 'MUSIC ' + (save.music ? 'ON' : 'OFF'), cb: () => { save.music = !save.music; applyAudio(); writeSave(); } },
      { label: 'VIBE ' + (save.haptics ? 'ON' : 'OFF'), cb: () => { save.haptics = !save.haptics; writeSave(); buzz(30); } },
    ], y1);
  } else if (state === 'over') {
    shade(0.6);
    const land = W > H * 1.25;
    const y0 = H * (land ? 0.12 : 0.17);
    const daily = mode === 'daily';
    text(daily ? 'DAILY RUN OVER' : 'GAME OVER', W / 2, y0, u * 0.07, '#ff9a8a', '900');
    text(String(score), W / 2, y0 + u * 0.13, u * 0.15, '#fff', '900');
    text(daily ? "TODAY'S BEST " + save.dailyBest : score >= save.best && score > 0 ? 'NEW BEST!' : 'BEST ' + save.best,
      W / 2, y0 + u * 0.24, u * 0.045, '#cfe', '700');
    text('+' + runDust + ' ✦' + (doubled ? '  (DOUBLED)' : '') + (dailyBonus ? `   +${dailyBonus} ✦ daily bonus (streak ${save.streak})` : ''),
      W / 2, y0 + u * 0.3, u * 0.04, '#ffe680', '700');
    const defs = [];
    if (!revived && adsOK()) defs.push({ label: 'REVIVE  ▶ AD', primary: true, cb: doRevive, disabled: adBusy });
    if (!doubled && runDust > 0 && adsOK()) defs.push({ label: 'DOUBLE ✦  ▶ AD', cb: doDouble, disabled: adBusy });
    defs.push({ label: 'PLAY AGAIN', primary: defs.length === 0, cb: async () => { await maybeInterstitial(); startRun(mode); } });
    defs.push({ label: 'MENU', cb: async () => { await maybeInterstitial(); reset(); state = 'menu'; focus = 0; } });
    layoutButtons(defs, y0 + u * 0.38);
  } else if (state === 'shop') {
    shade(0.65);
    text('SKINS', W / 2, H * 0.08, u * 0.075, '#fff', '900');
    text('✦ ' + save.dust, W / 2, H * 0.08 + u * 0.07, u * 0.045, '#ffe680', '700');
    let top = H * 0.08 + u * 0.12;
    if (save.skins.length >= SKINS.length) { text('All skins unlocked! You have collected everything.', W / 2, top, u * 0.035, '#9fe', '700'); top += u * 0.05; }
    else if (shopMsg) { ctx.globalAlpha = clamp(shopMsg.life, 0, 1); text(shopMsg.txt, W / 2, top, u * 0.04, '#ff9a8a', '700'); ctx.globalAlpha = 1; top += u * 0.05; }
    const cols = W > H ? 4 : 3, rows = Math.ceil(SKINS.length / cols), gap = u * 0.025;
    const backH = clamp(H * 0.085, 40, 58);
    const availH = H - top - backH - gap * 4;
    let cw = Math.min((W * 0.92 - gap * (cols - 1)) / cols, 130);
    cw = Math.max(40, Math.min(cw, (availH - gap * (rows - 1)) / rows / 1.1));
    const ch = cw * 1.1, tw = cols * cw + (cols - 1) * gap;
    SKINS.forEach((sk, i) => {
      const c = i % cols, r = (i / cols) | 0;
      ui.push({ x: W / 2 - tw / 2 + c * (cw + gap), y: top + r * (ch + gap), w: cw, h: ch, card: i, cb: () => pickSkin(i) });
    });
    layoutButtons([{ label: 'BACK', cb: () => { state = 'menu'; focus = 0; } }], top + rows * (ch + gap) + gap);
  }
  if (banner && (state === 'play' || state === 'dying')) {
    ctx.globalAlpha = clamp(banner.life, 0, 1);
    text(banner.txt, W / 2, H * 0.3, u * 0.06, '#9fe', '900');
    ctx.globalAlpha = 1;
  }
  if (focus >= ui.length) focus = 0;
  ui.forEach((b, i) => (b.card != null ? drawCard : drawButton)(b, kbd && i === focus));
}

function draw() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawWorld();
  drawUI();
}

// ---------- actions ----------
function startRun(m) { reset(m); state = 'play'; focus = 0; }

function pickSkin(i) {
  const sk = SKINS[i];
  if (save.skins.includes(i)) { save.skin = i; writeSave(); return; }
  if (save.dust >= sk.cost) {
    save.dust -= sk.cost; save.skins.push(i); save.skin = i; writeSave(); sfx.buy(); buzz(30);
  } else { shopMsg = { txt: `Need ${sk.cost - save.dust} more ✦`, life: 1.6 }; sfx.deny(); }
}

async function rewarded(id) {
  if (adBusy) return false;
  adBusy = true;
  let ok = false;
  try {
    if (IN_YT) ok = (await yt.ads.requestRewardedAd(id)) === true;
    else { await new Promise(r => setTimeout(r, 400)); ok = true; } // local test only
  } catch (e) { ok = false; }
  adBusy = false; lastAdAt = performance.now();
  return ok;
}

async function maybeInterstitial() {
  if (!IN_YT || adBusy || !(yt.ads && typeof yt.ads.requestInterstitialAd === 'function')) return;
  if (performance.now() - lastAdAt < 90000 || runsSinceAd < 2) return;
  adBusy = true;
  try { await yt.ads.requestInterstitialAd(); } catch (e) { /* no ad */ }
  adBusy = false; lastAdAt = performance.now(); runsSinceAd = 0;
}

async function doRevive() {
  if (!(await rewarded('revive'))) return;
  revived = true;
  hazards = hazards.filter(h => dist(h.x, h.y, cur.x, cur.y) > 22);
  comet.trail = [];
  attach(cur, Math.PI);
  comet.x = cur.x - cur.R; comet.y = cur.y;
  state = 'play'; focus = 0;
}

async function doDouble() {
  if (!(await rewarded('double_dust'))) return;
  doubled = true; save.dust += runDust; writeSave(); sfx.buy();
}

// ---------- input ----------
function press(x, y) {
  if (paused) return;
  if (state === 'play') { launch(); return; }
  if (state === 'over' && performance.now() - overAt < 450) return;
  for (const b of ui) {
    if (!b.disabled && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { sfx.click(); b.cb(); return; }
  }
}
cv.addEventListener('pointerdown', (e) => { e.preventDefault(); kbd = false; ensureAudio(); press(e.clientX, e.clientY); });
cv.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  ensureAudio();
  const k = e.key;
  if (state === 'play') {
    if (k === ' ' || k === 'Enter' || k === 'ArrowUp' || k === 'w' || k === 'W') { e.preventDefault(); if (!e.repeat && !paused) launch(); }
    return;
  }
  if (k === 'Escape') { if (state === 'shop') { state = 'menu'; focus = 0; } return; }
  if (!ui.length) return;
  if (k === 'ArrowDown' || k === 'ArrowRight' || k === 'Tab') { e.preventDefault(); kbd = true; focus = (focus + 1) % ui.length; }
  else if (k === 'ArrowUp' || k === 'ArrowLeft') { e.preventDefault(); kbd = true; focus = (focus - 1 + ui.length) % ui.length; }
  else if (k === 'Enter' || k === ' ') {
    e.preventDefault();
    if (e.repeat || paused || (state === 'over' && performance.now() - overAt < 450)) return;
    const b = ui[focus];
    if (b && !b.disabled) { sfx.click(); b.cb(); }
  }
});

// ---------- pause / resume ----------
function onPause() { paused = true; applyAudio(); }
function onResume() { paused = false; last = performance.now(); applyAudio(); }
if (!IN_YT) document.addEventListener('visibilitychange', () => (document.hidden ? onPause() : onResume()));

// ---------- loop & boot ----------
function loop(now) {
  requestAnimationFrame(loop);
  if (paused) { last = now; return; }
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
}

async function boot() {
  window.addEventListener('resize', resize);
  reset();
  state = 'menu';
  resize();
  camY = camTarget();
  draw();
  if (IN_YT) {
    safe(() => yt.game.firstFrameReady());
    safe(() => yt.system.onPause(onPause));
    safe(() => yt.system.onResume(onResume));
    sysAudio = safe(() => yt.system.isAudioEnabled()) !== false;
    safe(() => yt.system.onAudioEnabledChange((on) => { sysAudio = !!on; applyAudio(); }));
  }
  await loadSave();
  draw();
  if (IN_YT) safe(() => yt.game.gameReady());
  last = performance.now();
  requestAnimationFrame(loop);
}
boot();
})();
