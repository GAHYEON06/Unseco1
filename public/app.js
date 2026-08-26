// =====================================================================
//  디지털 성돌 — 프런트엔드
//  · 성벽은 처음에 어둡습니다.
//  · 메시지가 저장되면 그 자리의 실제 성돌 하나에 불이 켜집니다.
//  · 다른 사람이 남긴 성돌도 Realtime 으로 즉시 켜집니다.
// =====================================================================
// supabase-js 는 실시간 갱신에만 쓰입니다. 불러오지 못해도 앱은 정상 동작합니다.
const GLOW_SRC = '/assets/glow.png';

const tilesEl     = document.getElementById('tiles');
const scrollwrap  = document.getElementById('scrollwrap');
const centerFrame = document.getElementById('centerFrame');
const scrollHint  = document.getElementById('scrollHint');
const toastEl     = document.getElementById('toast');
const firstPrompt = document.getElementById('firstPrompt');
const canvas      = document.getElementById('glowCanvas');
const ctx         = canvas.getContext('2d');
const composer    = document.getElementById('composer');
const input       = document.getElementById('msgInput');
const stackBtn    = document.getElementById('stackBtn');

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const taken = [];   // 화면에 놓인 메시지 성돌
const lit   = [];   // 불이 켜진 돌
const seenSlots = new Set();

// ───────────────────────── 불빛 렌더러 ─────────────────────────
const glowImg = new Image();
let glowReady = false;
glowImg.onload = () => { glowReady = true; draw(); };
glowImg.src = GLOW_SRC;

const spot = document.createElement('canvas');
spot.width = spot.height = 128;
{
  const c = spot.getContext('2d');
  const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0,    'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.92)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.42)');
  g.addColorStop(1,    'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 128, 128);
}

const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function lightStone(x, y, r, strong, instant) {
  lit.push({
    x, y, r,
    born: instant ? performance.now() - 1200 : performance.now(),
    strong: !!strong,
    phase: Math.random() * Math.PI * 2,
  });
  startLoop();
}

function draw() {
  const rect = centerFrame.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(devicePixelRatio || 1, 2);
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!glowReady || !lit.length) return;

  const now = performance.now();
  ctx.globalCompositeOperation = 'source-over';
  for (const s of lit) {
    const age   = now - s.born;
    const grow  = age < 900 ? easeOut(age / 900) : 1;
    const flare = age < 900 ? 1 + 0.85 * Math.sin(Math.PI * Math.min(age / 900, 1)) : 1;
    const flick = reduced ? 1 : 0.88 + 0.12 * Math.sin(now / 900 + s.phase);
    ctx.globalAlpha = Math.min(1, (s.strong ? 1 : 0.9) * flick * (0.45 + 0.55 * grow));
    const r = (s.r * w) / 100 * (0.35 + 0.65 * grow) * flare;
    ctx.drawImage(spot, (s.x * w) / 100 - r, (s.y * h) / 100 - r, r * 2, r * 2);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-in';
  ctx.drawImage(glowImg, 0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
}

let raf = null, last = 0;
function frame(t) {
  if (t - last > 40) { last = t; draw(); }
  raf = lit.length && !document.hidden ? requestAnimationFrame(frame) : null;
}
function startLoop() { if (!raf) raf = requestAnimationFrame(frame); }
document.addEventListener('visibilitychange', () => { if (!document.hidden) startLoop(); });
addEventListener('resize', () => { draw(); startLoop(); });

// ───────────────────────── 메시지 성돌 ─────────────────────────
function makeTile(x, y, text, isNew) {
  const el = document.createElement('div');
  el.className = 'tile' + (isNew ? ' new' : '');
  el.style.left = x + '%';
  el.style.top  = y + '%';
  el.style.setProperty('--delay', (Math.random() * 4.2).toFixed(2) + 's');
  el.style.setProperty('--tilt', (Math.random() * 3 - 1.5).toFixed(2) + 'deg');
  el.textContent = text;
  tilesEl.appendChild(el);
  taken.push({ x, y, el });
  return el;
}

// 이미 놓인 성돌과 겹치면 글자를 숨기고 불빛만 남깁니다
function collides(x, y, text) {
  const rect = centerFrame.getBoundingClientRect();
  const fw = rect.width || 1, fh = rect.height || 1;
  const estW = (text.length * 11.6 + 22) / fw * 100;
  const estH = 28 / fh * 100;
  return taken.some((t) => {
    const tw = (t.el.offsetWidth || 90) / fw * 100;
    return Math.abs(x - t.x) < (estW + tw) / 2 + 1.4 && Math.abs(y - t.y) < estH + 1.4;
  });
}

function placeStone(stone, { mine = false, instant = false } = {}) {
  if (stone.x == null || stone.y == null || seenSlots.has(stone.slot)) return;
  seenSlots.add(stone.slot);

  if (!collides(stone.x, stone.y, stone.message)) {
    makeTile(stone.x, stone.y, stone.message, !instant);
  }
  lightStone(stone.x, stone.y, mine ? 4.4 : 3.4, mine, instant);

  const halo = mine ? 8 : 5;
  for (let i = 0; i < halo; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 2.2 + Math.random() * 4.0;
    lightStone(stone.x + Math.cos(a) * d, stone.y + Math.sin(a) * d * 0.5,
               1.8 + Math.random() * 1.4, false, instant);
  }
  dismissPrompt();
}

function dismissPrompt() {
  if (firstPrompt && !firstPrompt.classList.contains('gone')) {
    firstPrompt.classList.add('gone');
    setTimeout(() => firstPrompt.remove(), 1000);
  }
}

// ───────────────────────── 카운터 ─────────────────────────
let total = 0, today = 0;
function renderStats() {
  document.querySelector('#totalCount b').textContent = total.toLocaleString('ko-KR');
  document.querySelector('#todayCount b').textContent = '+' + today.toLocaleString('ko-KR');
}
function flashStat(el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }

function bumpStats() {
  total += 1; today += 1;
  renderStats();
  flashStat(document.getElementById('totalCount'));
  flashStat(document.getElementById('todayCount'));
}

// ───────────────────────── 토스트 ─────────────────────────
let toastT;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

const ERRORS = {
  MESSAGE_LENGTH:    '메시지는 1자 이상 50자 이내로 적어주세요.',
  BLOCKED_WORD:      '사용할 수 없는 표현이 있어요. 다시 적어주세요.',
  TOO_MANY_REQUESTS: '잠시 후 다시 시도해주세요. (1분에 3번까지)',
  WALL_FULL:         '성벽이 가득 찼습니다. 곧 새 구간이 열립니다.',
  SERVER_ERROR:      '성돌을 쌓지 못했습니다. 잠시 후 다시 시도해주세요.',
};

// ───────────────────────── 최초 적재 ─────────────────────────
async function loadWall() {
  const res = await fetch('/api/stones');
  if (!res.ok) throw new Error('LOAD_FAILED');
  const { stones, stats } = await res.json();

  total = stats?.total ?? stones.length;
  today = stats?.today ?? 0;
  renderStats();

  // 이미 쌓인 성돌은 애니메이션 없이 켜진 상태로 시작합니다
  for (const s of stones) placeStone(s, { instant: true });
  if (!stones.length && firstPrompt) firstPrompt.classList.remove('gone');
  draw();
}

// ───────────────────────── 실시간 구독 ─────────────────────────
async function subscribeLive() {
  const cfg = await (await fetch('/api/config')).json();
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return;

  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    realtime: { params: { eventsPerSecond: 5 } },
  });

  sb.channel('stones-live')
    .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'stones' },
        async ({ new: row }) => {
          if (seenSlots.has(row.slot)) return;
          const { data } = await sb.from('slots').select('x, y').eq('idx', row.slot).single();
          if (!data) return;
          placeStone({ slot: row.slot, message: row.message, x: data.x, y: data.y });
          total += 1; today += 1; renderStats();
        })
    .subscribe();
}

// ───────────────────────── 제출 ─────────────────────────
composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = input.value.trim().slice(0, 50);
  if (!message) return;

  stackBtn.disabled = true;
  try {
    const res = await fetch('/api/stones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const body = await res.json();

    if (!res.ok) {
      showToast(ERRORS[body.error] || ERRORS.SERVER_ERROR);
      return;
    }

    input.value = '';
    placeStone(body.stone, { mine: true });
    bumpStats();
    showToast('성돌에 불이 켜졌습니다');
    panTo(body.stone.x);
  } catch {
    showToast('연결이 불안정합니다. 잠시 후 다시 시도해주세요.');
  } finally {
    stackBtn.disabled = false;
  }
});

// ───────────────────────── 좌우 이동 ─────────────────────────
function panTo(xPercent) {
  const frameW = centerFrame.getBoundingClientRect().width;
  const wrapW  = scrollwrap.getBoundingClientRect().width;
  const lo = centerFrame.offsetLeft;
  const hi = Math.max(lo, lo + frameW - wrapW);
  const want = lo + (xPercent / 100) * frameW - wrapW / 2;
  scrollwrap.scrollTo({ left: Math.min(hi, Math.max(lo, want)), behavior: 'smooth' });
}

function setInitialScroll() {
  const frameW = centerFrame.getBoundingClientRect().width;
  scrollwrap.scrollLeft = centerFrame.offsetLeft + frameW * 0.06;
}
addEventListener('load', () => { setInitialScroll(); draw(); });
setTimeout(setInitialScroll, 50);

let down = false, startX = 0, startScroll = 0, dragged = false;
scrollwrap.addEventListener('pointerdown', (e) => {
  down = true; dragged = false;
  startX = e.clientX; startScroll = scrollwrap.scrollLeft;
  scrollwrap.classList.add('grabbing');
  scrollwrap.setPointerCapture(e.pointerId);
});
scrollwrap.addEventListener('pointermove', (e) => {
  if (!down) return;
  const dx = e.clientX - startX;
  if (Math.abs(dx) > 4) dragged = true;
  scrollwrap.scrollLeft = startScroll - dx;
  if (dragged) hideHint();
});
const endDrag = () => { down = false; scrollwrap.classList.remove('grabbing'); };
scrollwrap.addEventListener('pointerup', endDrag);
scrollwrap.addEventListener('pointerleave', endDrag);
scrollwrap.addEventListener('pointercancel', endDrag);
scrollwrap.addEventListener('wheel', (e) => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    scrollwrap.scrollLeft += e.deltaY;
    e.preventDefault();
    hideHint();
  }
}, { passive: false });

let hintHidden = false;
function hideHint() { if (!hintHidden) { hintHidden = true; scrollHint.classList.add('hidden'); } }
scrollwrap.addEventListener('scroll', hideHint, { passive: true });
setTimeout(hideHint, 9000);

// ───────────────────────── 시작 ─────────────────────────
loadWall().catch(() => showToast('성벽을 불러오지 못했습니다. 새로고침해주세요.'));
subscribeLive().catch(() => {});
