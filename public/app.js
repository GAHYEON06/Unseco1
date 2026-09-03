// =====================================================================
//  디지털 성돌 — 프런트엔드
//  · 성벽은 처음에 어둡습니다.
//  · 메시지가 저장되면 그 자리의 실제 성돌 하나에 불이 켜집니다.
//  · 켜진 성돌(작은 표식)을 누르면 남긴 메시지를 다시 볼 수 있습니다.
//  · 다른 사람이 남긴 성돌도 Realtime 으로 즉시 켜집니다.
// =====================================================================
// supabase-js 는 실시간 갱신에만 쓰입니다. 불러오지 못해도 앱은 정상 동작합니다.
const GLOW_SRC = '/assets/glow.png';
const MAX_LEN  = 200;   // 응원 메시지 최대 길이

// ─── 외부 링크 ────────────────────────────────────────────────
//  · eventForm : 경품 이벤트 응모 구글폼 링크
//  · gameEmail : 보드게임 제작·교육 활용 문의 메일
const LINKS = {
  instagram: 'https://www.instagram.com/_sumunjang_',
  eventForm: 'https://docs.google.com/forms/d/e/1FAIpQLSeDkMO2pmcJNAdoA09aagfDDBYqRwvqL-tHSp3jGg31MV5W4Q/viewform',
  gameEmail: 'sumunjang2026@gmail.com',
};

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
const charCount   = document.getElementById('charCount');
const wallLoading  = document.getElementById('wallLoading');
const boardCountEl = document.getElementById('boardCount');

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const messages  = [];   // 남겨진 메시지 { slot, message, x, y, created_at, mine, el }
const lit       = [];   // 불이 켜진 돌
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

// ───────────────────────── 시간 표기 ─────────────────────────
function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)     return '방금 전';
  if (s < 3600)   return Math.floor(s / 60) + '분 전';
  if (s < 86400)  return Math.floor(s / 3600) + '시간 전';
  if (s < 604800) return Math.floor(s / 86400) + '일 전';
  return new Date(iso).toLocaleDateString('ko-KR');
}

// ───────────────────────── 성돌 표식 ─────────────────────────
// 사진 속 실제 돌 크기에 맞춘 작은 표식을 놓습니다. 누르면 메시지를 봅니다.
function makeMark(entry, isNew) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'stonemark' + (isNew ? ' new' : '');
  el.style.left = entry.x + '%';
  el.style.top  = entry.y + '%';
  el.style.setProperty('--delay', (Math.random() * 4.6).toFixed(2) + 's');
  el.setAttribute('aria-label', '성돌 메시지 보기');
  el.addEventListener('click', (e) => { e.stopPropagation(); openStone(entry); });
  tilesEl.appendChild(el);
  entry.el = el;
  return el;
}

function flashMark(entry) {
  if (!entry?.el) return;
  entry.el.classList.remove('pulse');
  void entry.el.offsetWidth;
  entry.el.classList.add('pulse');
}

function registerStone(stone, { mine = false } = {}) {
  if (stone.x == null || stone.y == null || seenSlots.has(stone.slot)) return null;
  seenSlots.add(stone.slot);

  const entry = {
    slot: stone.slot,
    message: stone.message,
    x: stone.x,
    y: stone.y,
    created_at: stone.created_at || new Date().toISOString(),
    mine,
  };
  messages.push(entry);
  updateBoardCount();
  if (boardPanel.classList.contains('open')) renderBoard();
  return entry;
}

// 성돌 하나와 주변 잔불을 켭니다
function igniteStone(entry, { mine = false, instant = false } = {}) {
  lightStone(entry.x, entry.y, mine ? 4.4 : 3.4, mine, instant);
  const halo = mine ? 8 : 5;
  for (let i = 0; i < halo; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 2.2 + Math.random() * 4.0;
    lightStone(entry.x + Math.cos(a) * d, entry.y + Math.sin(a) * d * 0.5,
               1.8 + Math.random() * 1.4, false, instant);
  }
  dismissPrompt();
}

function placeStone(stone, { mine = false, instant = false } = {}) {
  const entry = registerStone(stone, { mine });
  if (!entry) return;
  makeMark(entry, !instant);
  igniteStone(entry, { mine, instant });
}

// 내가 쓴 메시지 — 입력창에서 성벽의 그 자리로 빛이 날아가 꽂힙니다
async function launchToWall(stone) {
  const entry = registerStone(stone, { mine: true });
  if (!entry) return;
  const mark = makeMark(entry, false);
  mark.classList.add('pending');
  panTo(stone.x);

  if (reduced) {
    mark.classList.remove('pending');
    igniteStone(entry, { mine: true });
    flashMark(entry);
    return;
  }

  await new Promise((r) => setTimeout(r, 420)); // 부드러운 스크롤이 멎을 시간

  const box = mark.getBoundingClientRect();
  const tx = box.left + box.width / 2;
  const ty = box.top + box.height / 2;
  const sx = innerWidth / 2;
  const sy = innerHeight - 132;

  const proj = document.createElement('div');
  proj.className = 'projectile';
  proj.style.left = sx + 'px';
  proj.style.top  = sy + 'px';
  document.body.appendChild(proj);

  const mx = (sx + tx) / 2;
  const my = Math.min(sy, ty) - Math.min(180, Math.max(70, Math.abs(sy - ty) * 0.4));
  const anim = proj.animate(
    [
      { left: `${sx}px`, top: `${sy}px`, opacity: 0.2, transform: 'translate(-50%,-50%) scale(0.55)' },
      { opacity: 1, offset: 0.12 },
      { left: `${mx}px`, top: `${my}px`, offset: 0.5, transform: 'translate(-50%,-50%) scale(1)' },
      { left: `${tx}px`, top: `${ty}px`, opacity: 1, transform: 'translate(-50%,-50%) scale(0.65)' },
    ],
    { duration: 650, easing: 'cubic-bezier(.35,0,.25,1)' }
  );

  await Promise.race([
    anim.finished ? anim.finished.catch(() => {}) : Promise.resolve(),
    new Promise((r) => setTimeout(r, 900)),
  ]);

  proj.remove();
  mark.classList.remove('pending');
  igniteStone(entry, { mine: true });
  flashMark(entry);
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
function updateBoardCount() {
  if (boardCountEl) boardCountEl.textContent = messages.length.toLocaleString('ko-KR');
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
function showToast(msg, type = 'error') {
  toastEl.textContent = msg;
  toastEl.className = 'toast show' + (type === 'error' ? ' error' : '');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

const ERRORS = {
  MESSAGE_LENGTH:    `메시지는 1자 이상 ${MAX_LEN}자 이내로 적어주세요.`,
  BLOCKED_WORD:      '사용할 수 없는 표현이 있어요. 다시 적어주세요.',
  TOO_MANY_REQUESTS: '잠시 후 다시 시도해주세요. (1분에 3번까지)',
  WALL_FULL:         '성벽이 가득 찼습니다. 곧 새 구간이 열립니다.',
  SERVER_ERROR:      '성돌을 쌓지 못했습니다. 잠시 후 다시 시도해주세요.',
};

// ───────────────────────── 오버레이 시트 ─────────────────────────
const aboutPanel = document.getElementById('aboutPanel');
const storyPanel = document.getElementById('storyPanel');
const boardPanel = document.getElementById('boardPanel');
const stonePanel = document.getElementById('stonePanel');
const gamePanel  = document.getElementById('gamePanel');
const eventPanel = document.getElementById('eventPanel');
const sheets = [aboutPanel, storyPanel, boardPanel, stonePanel, gamePanel, eventPanel];
let lastFocus = null;

function openSheet(el) {
  if (el && !lastFocus) lastFocus = document.activeElement;
  sheets.forEach((s) => s.classList.toggle('open', s === el));
  if (el) {
    const c = el.querySelector('.close');
    if (c) setTimeout(() => c.focus(), 30);
  } else if (lastFocus) {
    lastFocus.focus?.();
    lastFocus = null;
  }
}
function closeSheets() { openSheet(null); }

sheets.forEach((s) => {
  s.addEventListener('click', (e) => {
    if (e.target === s || e.target.closest('[data-close]')) closeSheets();
  });
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheets.some((s) => s.classList.contains('open'))) closeSheets();
});

// 소개
document.getElementById('aboutBtn').addEventListener('click', () => openSheet(aboutPanel));

// 보드게임 · 이벤트 응모 탭 (칩 + 소개 패널 안의 버튼)
const PANELS = { game: gamePanel, event: eventPanel };
document.querySelectorAll('[data-panel]').forEach((el) => {
  el.addEventListener('click', () => {
    const p = PANELS[el.dataset.panel];
    if (p) openSheet(p);
  });
});

// 이벤트 응모 버튼 → 구글폼
(() => {
  const cta = document.getElementById('eventCta');
  if (!cta) return;
  if (LINKS.eventForm) {
    cta.href = LINKS.eventForm;
  } else {
    cta.removeAttribute('href');
    cta.style.pointerEvents = 'none';
    cta.style.opacity = '0.5';
    cta.textContent = '이벤트 응모 링크 준비 중';
  }
})();

// 한양도성 이야기 — 칩을 누르면 해당 섹션으로
document.querySelectorAll('.chip[data-story]').forEach((chip) => {
  chip.addEventListener('click', () => {
    openSheet(storyPanel);
    const sec = document.getElementById('story-' + chip.dataset.story);
    if (sec) {
      setTimeout(() => {
        sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
        sec.classList.remove('flash-target');
        void sec.offsetWidth;
        sec.classList.add('flash-target');
      }, 60);
    }
  });
});

// 실시간 게시판
function renderBoard() {
  const totalEl = document.getElementById('boardTotal');
  if (totalEl) totalEl.textContent = messages.length ? `(${messages.length.toLocaleString('ko-KR')})` : '';

  const list = document.getElementById('boardList');
  if (!messages.length) {
    list.replaceChildren(
      Object.assign(document.createElement('p'), {
        className: 'board-empty',
        textContent: '아직 남겨진 메시지가 없습니다. 첫 성돌을 밝혀 주세요.',
      })
    );
    return;
  }

  const items = [...messages].sort(
    (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
  );
  list.replaceChildren(
    ...items.map((m) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'board-item' + (m.mine ? ' mine' : '');

      const msg = document.createElement('span');
      msg.className = 'board-msg';
      msg.textContent = m.message;

      const meta = document.createElement('span');
      meta.className = 'board-meta';
      meta.textContent = timeAgo(m.created_at) + (m.mine ? ' · 내 성돌' : '');

      b.append(msg, meta);
      b.addEventListener('click', () => {
        closeSheets();
        panTo(m.x);
        flashMark(m);
      });
      return b;
    })
  );
}
function openBoard() { renderBoard(); openSheet(boardPanel); }
document.getElementById('boardBtn').addEventListener('click', openBoard);
document.getElementById('boardBtnTop').addEventListener('click', openBoard);

// 성돌 메시지 상세
function openStone(entry) {
  document.getElementById('stoneMsg').textContent = entry.message;
  document.getElementById('stoneMeta').textContent =
    timeAgo(entry.created_at) + (entry.mine ? ' · 내가 남긴 성돌' : '') + ' · 낙산 구간';
  openSheet(stonePanel);
}

// ───────────────────────── 최초 적재 ─────────────────────────
function hideWallLoading() {
  if (!wallLoading || wallLoading.classList.contains('gone')) return;
  wallLoading.classList.add('gone');
  setTimeout(() => wallLoading.remove(), 700);
}

async function loadWall() {
  const res = await fetch('/api/stones');
  if (!res.ok) throw new Error('LOAD_FAILED');
  const { stones, stats } = await res.json();

  total = stats?.total ?? stones.length;
  today = stats?.today ?? 0;
  renderStats();

  // 이미 쌓인 성돌은 애니메이션 없이 켜진 상태로 시작합니다
  for (const s of stones) placeStone(s, { instant: true });
  updateBoardCount();
  if (!stones.length && firstPrompt) firstPrompt.classList.remove('gone');
  draw();
  hideWallLoading();
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
          placeStone({
            slot: row.slot, message: row.message,
            x: data.x, y: data.y, created_at: row.created_at,
          });
          total += 1; today += 1; renderStats();
        })
    .subscribe();
}

// ───────────────────────── 입력창 상태 ─────────────────────────
function syncComposer() {
  const len = input.value.length;
  charCount.textContent = len + ' / ' + MAX_LEN;
  charCount.classList.toggle('near', len >= MAX_LEN - 30);
  stackBtn.disabled = input.value.trim().length === 0;
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 132) + 'px';
}
input.addEventListener('input', syncComposer);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    composer.requestSubmit();
  }
});
syncComposer();

// ───────────────────────── 제출 ─────────────────────────
composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = input.value.trim().slice(0, MAX_LEN);
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
    bumpStats();
    showToast('메시지를 성벽으로 보냈습니다', 'ok');
    launchToWall({ ...body.stone, created_at: new Date().toISOString() });
  } catch {
    showToast('연결이 불안정합니다. 잠시 후 다시 시도해주세요.');
  } finally {
    syncComposer();
  }
});

// ───────────────────────── 좌우 이동 ─────────────────────────
function panTo(xPercent) {
  const frameW = centerFrame.getBoundingClientRect().width;
  const wrapW  = scrollwrap.getBoundingClientRect().width;
  const hi = Math.max(0, frameW - wrapW);
  const want = (xPercent / 100) * frameW - wrapW / 2;
  scrollwrap.scrollTo({ left: Math.min(hi, Math.max(0, want)), behavior: 'smooth' });
}

function setInitialScroll() {
  const frameW = centerFrame.getBoundingClientRect().width;
  const wrapW  = scrollwrap.getBoundingClientRect().width;
  scrollwrap.scrollLeft = Math.max(0, (frameW - wrapW) * 0.34);
}
addEventListener('load', () => { setInitialScroll(); draw(); });
setTimeout(setInitialScroll, 50);

let down = false, startX = 0, startScroll = 0, dragged = false;
scrollwrap.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.stonemark')) return;   // 성돌 표식은 클릭이 우선
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
loadWall().catch(() => {
  hideWallLoading();
  showToast('성벽을 불러오지 못했습니다. 새로고침해주세요.');
});
subscribeLive().catch(() => {});
