// 메디보카 화면: 홈 → 학습(앞면 → 확인 또는 설명) → 끝. 백업 보내기·불러오기, 설정.
import { UNITS, PAIRS } from '../data/index.js';
import { buildIndex } from './data.js';
import {
  RULES, replay, planToday, newOrder, newSession, current, answer, isDone,
  statusOf, progress, streak, daySummary, dayKey, isSticky,
} from './engine.js';
import { makeBackup, backupName, parseBackup, mergeLogs, mergeNotes } from './backup.js';
import { esc, rich, speakable } from './text.js';
import * as store from './store.js';

const IX = buildIndex(UNITS, PAIRS);
const ORDER = newOrder(IX);
const $app = document.getElementById('app');

const DEFAULTS = { retention: 0.9, rn: false, rate: 0.85, label: '', device: '' };
const A = {
  log: [],
  states: new Map(),
  settings: { ...DEFAULTS },
  notes: {},           // 내 암기법 { id: { s, t } }
  lastBackup: 0,
  sess: null,          // 지금 세션
  view: 'home',        // home | study | end
  phase: 'front',      // front | check | explain
  pick: 0,             // 앞면에서 고른 단계
  hint: false,
  editNote: false,
  extraNew: 0,
  sheet: null,         // 홈 아래 펼친 칸: backup | settings | null
  summary: null,
};

// ───────── 시작 ─────────
async function boot() {
  await store.open();
  A.log = await store.allLog();
  A.settings = { ...DEFAULTS, ...(await store.get('settings', {})) };
  if (!A.settings.device) {
    A.settings.device = 'd' + Math.random().toString(36).slice(2, 8);
    A.settings.label = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? '폰' : '컴퓨터';
    await store.set('settings', A.settings);
  }
  A.notes = await store.get('notes', {});
  A.lastBackup = await store.get('lastBackup', 0);
  const saved = await store.get('session', null);
  if (saved && saved.day === dayKey(Date.now()) && !isDone(saved)) A.sess = saved;
  recompute();
  render();
  await receiveShared();
  if (!store.ok) toast('이 창에서는 기록을 저장할 수 없어요. 비공개 창이 아닌 보통 창으로 열어 주세요.', 6000);
}

function recompute() {
  A.states = replay(A.log, { retention: A.settings.retention });
}

const plan = (extra = A.extraNew) => planToday(IX, A.states, { now: Date.now(), retention: A.settings.retention, extraNew: extra, order: ORDER });

// ───────── 그리기 ─────────
function render() {
  const v = A.view === 'study' ? viewStudy() : A.view === 'end' ? viewEnd() : viewHome();
  $app.innerHTML = v;
  $app.dataset.view = A.view;
  const ta = $app.querySelector('textarea');
  if (ta && A.editNote) ta.focus();
}

const KIND = { part: '조각', word: '단어', abbr: '약어' };
const stars = n => '★'.repeat(n);
const partType = t => (t.startsWith('-') ? '접미사' : t.endsWith('-') ? '접두사' : t.includes('/') ? '어근' : '조각');
const koMain = x => (x.ko || []).join(' · ');

function viewHome() {
  const p = plan();
  const pr = progress(IX, A.states, 'core');
  const st = streak(A.log);
  const resume = A.sess && !isDone(A.sess);
  const total = p.reviews.length + p.fresh.length;
  const doneToday = !resume && total === 0;
  const pct = n => (pr.total ? (n / pr.total) * 100 : 0);
  const inKakao = /KAKAOTALK/i.test(navigator.userAgent);

  let today;
  if (resume) {
    const left = A.sess.queue.length + (A.sess.finalsAdded ? 0 : A.sess.finals.length);
    today = `<p class="big-line">하던 공부가 있어요</p><p class="sub">${A.sess.doneCards} / ${A.sess.total}장 봤어요 · 남은 카드 ${left}장</p>
      <button class="btn primary big" data-act="resume">이어서 하기</button>
      <button class="btn ghost" data-act="drop">처음부터 다시 정하기</button>`;
  } else if (doneToday) {
    today = `<p class="big-line">오늘 할 일 끝! 🎉</p><p class="sub">내일 다시 만나요. 더 하고 싶으면 새 단어를 조금 더 넣을 수 있어요.</p>
      <button class="btn primary big" data-act="more">새 단어 ${RULES.batch}개 더</button>`;
  } else {
    today = `<p class="big-line">복습 <b>${p.reviews.length}</b> · 새 단어 <b>${p.fresh.length}</b> · 약 ${p.minutes}분</p>
      ${p.backlog ? '<p class="note">밀린 복습이 많아서 오늘은 새 단어를 쉬어 가요.</p>' : ''}
      ${p.dueTotal > p.reviews.length ? `<p class="note">남은 복습 ${p.dueTotal - p.reviews.length}장은 내일로 나눠요.</p>` : ''}
      <button class="btn primary big" data-act="start">오늘 공부 시작</button>
      <button class="btn ghost" data-act="quick"${p.dueTotal ? '' : ' disabled'}>3분 모드 · 복습 ${Math.min(RULES.quickCards, p.dueTotal)}장</button>`;
  }

  return `
  <header class="top"><h1>메디보카</h1><span class="streak" title="연속 공부일">🔥 ${st}일</span></header>
  ${inKakao ? '<div class="warn">카카오톡 안에서 열렸어요. 여기서 공부하면 기록이 따로 저장돼요. 오른쪽 위 메뉴에서 <b>다른 브라우저로 열기</b>를 눌러 주세요.</div>' : ''}
  <section class="panel today">${today}</section>
  <section class="panel">
    <div class="row-between"><h2>핵심 단어 진도</h2><span class="sub">${pr.mastered + pr.long} / ${pr.total} 익힘</span></div>
    <div class="bar" aria-hidden="true">
      <i class="s-long" style="width:${pct(pr.long)}%"></i><i class="s-mastered" style="width:${pct(pr.mastered)}%"></i><i class="s-learning" style="width:${pct(pr.learning)}%"></i>
    </div>
    <ul class="legend">
      <li><i class="s-new"></i>새 단어 ${pr.new}</li><li><i class="s-learning"></i>배우는 중 ${pr.learning}</li>
      <li><i class="s-mastered"></i>익힘 ${pr.mastered}</li><li><i class="s-long"></i>오래 기억 ${pr.long}</li>
    </ul>
    ${pr.suggestNext ? '<p class="note">핵심의 80%를 익혔어요! 이제 확장 단어(★)도 함께 나와요.</p>' : ''}
  </section>
  <nav class="tabs">
    <button class="tab${A.sheet === 'backup' ? ' on' : ''}" data-act="sheet" data-arg="backup">백업 · 옮기기</button>
    <button class="tab${A.sheet === 'settings' ? ' on' : ''}" data-act="sheet" data-arg="settings">설정</button>
  </nav>
  ${A.sheet === 'backup' ? viewBackup() : A.sheet === 'settings' ? viewSettings() : ''}
  <p class="foot">단어 ${IX.items.length}개 · 기록 ${A.log.length}줄 · 이 기기: ${esc(A.settings.label)}</p>`;
}

function viewBackup() {
  const last = A.lastBackup ? new Date(A.lastBackup).toLocaleDateString('ko-KR') + '에 보냄' : '아직 보낸 적 없어요';
  const isPhone = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  return `<section class="panel sheet">
    <h2>폰 ↔ 컴퓨터 기록 옮기기</h2>
    <p class="sub">마지막 백업: ${last}</p>
    <button class="btn primary" data-act="send">백업 보내기</button>
    <p class="note">${isPhone ? '공유 창에서 <b>카카오톡 → 나와의 채팅</b>을 고르세요.' : '파일이 내려받아져요. 카톡 PC 창에 끌어다 놓으세요.'}</p>
    <label class="btn">백업 불러오기<input type="file" accept=".json,application/json" data-act="file" hidden></label>
    <p class="note">불러오면 <b>합쳐져요</b>. 지금 기록은 지워지지 않고, 이미 있는 기록은 한 번만 들어가요.</p>
    <details><summary>기기별 받는 법</summary>
      <ul class="howto">
        <li><b>안드로이드</b>: 카톡에서 파일 누르기 → 공유 → <b>메디보카</b> (앱을 설치했을 때)</li>
        <li><b>아이폰</b>: 카톡에서 파일 → 공유 → <b>파일에 저장</b> → 여기 "백업 불러오기"</li>
        <li><b>컴퓨터</b>: 카톡에서 파일 저장 → 이 창에 끌어다 놓기</li>
      </ul></details>
  </section>`;
}

function viewSettings() {
  const s = A.settings;
  const chip = (act, val, cur, label) => `<button class="chip${cur ? ' on' : ''}" data-act="${act}" data-arg="${val}">${label}</button>`;
  return `<section class="panel sheet">
    <h2>설정</h2>
    <div class="set"><span>목표 기억률</span><div>
      ${chip('ret', 0.85, s.retention === 0.85, '85% 여유')}${chip('ret', 0.9, s.retention === 0.9, '90% 기본')}${chip('ret', 0.95, s.retention === 0.95, '95% 시험 주간')}
    </div><p class="note">높일수록 더 자주 복습해요.</p></div>
    <div class="set"><span>RN 영어 설명</span><div>${chip('rn', 1, s.rn, '켜기')}${chip('rn', 0, !s.rn, '끄기')}</div></div>
    <div class="set"><span>발음 속도</span><div>${chip('rate', 0.7, s.rate === 0.7, '느리게')}${chip('rate', 0.85, s.rate === 0.85, '보통')}${chip('rate', 1, s.rate === 1, '빠르게')}</div></div>
    <div class="set"><span>이 기기 이름</span><div>${chip('label', '폰', s.label === '폰', '폰')}${chip('label', '태블릿', s.label === '태블릿', '태블릿')}${chip('label', '컴퓨터', s.label === '컴퓨터', '컴퓨터')}${chip('label', '노트북', s.label === '노트북', '노트북')}</div>
      <p class="note">백업 파일 이름에 붙어요.</p></div>
  </section>`;
}

// ───────── 학습 화면 ─────────
// 설명 화면에서는 방금 답한 카드를 보여 준다 (답하면 큐에서 빠지므로 따로 들고 있는다)
const shown = () => (A.phase === 'explain' && A.held ? A.held : A.sess ? current(A.sess) : null);
function viewStudy() {
  const cur = shown();
  if (!cur) return '';
  const x = IX.get(cur.c);
  if (!x) return '';
  const s = A.sess;
  const pct = s.total ? Math.min(100, (s.doneCards / s.total) * 100) : 100;
  const isNew = cur.kind === 'new';
  const tag = cur.kind === 'again' ? '<span class="tag again">다시</span>' : cur.kind === 'final' ? '<span class="tag again">한 번 더</span>' : isNew ? '<span class="tag new">새 단어</span>' : '<span class="tag">복습</span>';
  const unit = IX.unitOf.get(x.id);
  const hint = x.k === 'word' && (x.parts || []).length
    ? x.parts.map(esc).join(' <span class="plus">·</span> ')
    : x.k === 'part' ? partType(x.t) : x.k === 'abbr' ? '약어' : '조각으로 나뉘지 않는 단어';

  const face = `<section class="face">
    <div class="meta">${tag}<span>${KIND[x.k]} · ${stars(x.star)} · ${esc(unit.short)}</span></div>
    <div class="word" lang="en">${esc(x.t)}</div>
    <div class="face-tools">
      <button class="icon-btn" data-act="say" title="발음 듣기 (P)" aria-label="발음 듣기">🔊</button>
      ${A.phase === 'front' ? `<button class="icon-btn" data-act="hint" title="조각 힌트 (H)">${A.hint ? hint : '조각 힌트'}</button>` : ''}
    </div>
    ${A.phase === 'front' && isNew ? '<p class="note center">처음 보는 단어예요. 조각으로 뜻을 짐작해 보고 고르세요.</p>' : ''}
  </section>`;

  let side = '', actions = '';
  if (A.phase === 'front') {
    actions = `<div class="grades">
      <button class="g g1" data-act="grade" data-arg="1"><b>모름</b><small>1</small></button>
      <button class="g g2" data-act="grade" data-arg="2"><b>헷갈림</b><small>2</small></button>
      <button class="g g3" data-act="grade" data-arg="3"><b>알 것 같음</b><small>3</small></button>
      <button class="g g4" data-act="grade" data-arg="4"><b>확실히 앎</b><small>4</small></button>
    </div>`;
  } else if (A.phase === 'check') {
    side = `<section class="answer">
      <p class="q">떠올린 뜻이 맞았나요?</p>
      ${answerBlock(x, A.pick === 4)}
    </section>`;
    actions = `<div class="checks">
      <button class="btn no" data-act="check" data-arg="0">틀렸어요 <small>X</small></button>
      <button class="btn yes" data-act="check" data-arg="1">맞았어요 <small>Enter</small></button>
    </div>`;
  } else {
    side = `<section class="answer explain">${answerBlock(x, true)}${explainBlock(x)}</section>`;
    actions = `<div class="checks one"><button class="btn primary big" data-act="next">알겠어요 <small>Space</small></button></div>`;
  }
  return `<div class="studybar"><div class="progress"><i style="width:${pct}%"></i></div>
    <div class="studyhead"><span>${Math.min(s.doneCards + (cur.c in s.first ? 0 : 1), s.total)} / ${s.total}</span>
    <button class="close" data-act="home" aria-label="그만하고 홈으로">✕</button></div></div>
    <div class="study ${A.phase}">${face}${side}</div>
    <footer class="actions">${actions}</footer>`;
}

function partChips(x) {
  if (x.k !== 'word' || !(x.parts || []).length) return '';
  return '<div class="parts">' + IX.partsOf(x).map(p =>
    `<span class="pchip"><b lang="en">${esc(p.t)}</b> ${esc((p.ko || [])[0] || '')}</span>`).join('<span class="plus">+</span>') + '</div>';
}

function answerBlock(x, withParts) {
  return `<div class="ko">${esc(koMain(x))}</div>
    ${x.k === 'abbr' && x.full ? `<div class="full" lang="en">${esc(x.full)}</div>` : ''}
    ${x.k === 'part' ? `<div class="sub">${partType(x.t)}</div>` : ''}
    ${withParts ? partChips(x) : ''}`;
}

function explainBlock(x) {
  const out = [];
  if (x.mean) out.push(`<div class="blk"><h3>쉽게 풀면</h3><p>${rich(x.mean)}</p></div>`);
  const mine = A.notes[x.id];
  if (A.editNote) {
    out.push(`<div class="blk"><h3>내 암기법</h3><textarea rows="3" data-note="${esc(x.id)}" placeholder="나만의 암기법을 써 보세요">${esc(mine ? mine.s : '')}</textarea>
      <button class="btn small" data-act="savenote">저장</button></div>`);
  } else if (mine && mine.s) {
    out.push(`<div class="blk mine"><h3>내 암기법 <button class="link" data-act="editnote">고치기</button></h3><p>${rich(mine.s)}</p></div>`);
  }
  if (x.tip) out.push(`<div class="blk"><h3>암기 요령${x.tip.k ? ' · ' + esc(x.tip.k) : ''}</h3><p>${rich(x.tip.s)}</p></div>`);
  if (x.memo) out.push(`<div class="blk"><h3>메모</h3><p>${rich(x.memo)}</p></div>`);
  if (!mine && !A.editNote) out.push('<button class="link add-note" data-act="editnote">+ 내 암기법 쓰기</button>');

  // 같은 조각 단어 (이미 배운 것만)
  const fam = [];
  const seen = new Set([x.id]);
  const parts = x.k === 'part' ? [x.id] : x.k === 'word' ? (x.parts || []).map(f => 'p:' + f) : [];
  for (const pid of parts) for (const wid of IX.family.get(pid) || []) {
    if (seen.has(wid) || !A.states.has(wid)) continue;
    seen.add(wid);
    fam.push(IX.get(wid));
  }
  if (fam.length) {
    out.push(`<div class="blk"><h3>같은 조각 단어</h3><ul class="fam">${fam.slice(0, 6).map(w => `<li><b lang="en">${esc(w.t)}</b> ${esc(w.ko[0])}</li>`).join('')}</ul></div>`);
  } else if (x.k === 'part' && (IX.family.get(x.id) || []).length) {
    out.push(`<div class="blk"><h3>같은 조각 단어</h3><p class="sub">이 조각으로 만든 단어 ${IX.family.get(x.id).length}개를 곧 배워요.</p></div>`);
  }
  // 헷갈리는 짝
  for (const p of IX.pairsOf.get(x.id) || []) {
    out.push(`<div class="blk pair"><h3>헷갈리는 짝 · ${esc(p.t)}</h3><p>${rich(p.a)}</p><p>${rich(p.b)}</p></div>`);
  }
  // RN 영어
  if (A.settings.rn && x.def) {
    const lay = (x.lay || []).map(esc).join(' · ');
    out.push(`<div class="blk en" lang="en"><h3>RN 영어</h3><p><b>${esc(x.def)}</b></p>${lay ? `<p>${lay}</p>` : ''}${x.rn ? `<p lang="ko" class="sub">RN 팁: ${rich(x.rn)}</p>` : ''}</div>`);
  }
  return out.join('');
}

// ───────── 끝 화면 ─────────
function viewEnd() {
  const s = A.summary || daySummary(IX, A.log, A.states, { now: Date.now() });
  const sticky = s.sticky.map(id => IX.get(id)).filter(Boolean);
  return `<header class="top"><h1>오늘 공부 끝</h1></header>
  <section class="panel stats">
    <div><b>${s.cards}</b><span>본 장수</span></div>
    <div><b>${Math.round(s.ratio * 100)}%</b><span>처음에 맞힌 비율</span></div>
    <div><b>${s.fresh}</b><span>새 단어</span></div>
    <div><b>${s.mastered.length}</b><span>새로 익힘</span></div>
  </section>
  <section class="panel"><p>내일 예정 복습 <b>${s.tomorrow}</b>장</p>
    ${s.mastered.length ? `<p class="sub">새로 익힌 단어: ${s.mastered.slice(0, 12).map(id => esc(IX.get(id).t)).join(', ')}${s.mastered.length > 12 ? ' …' : ''}</p>` : ''}
  </section>
  ${sticky.length ? `<section class="panel"><h2>끈질긴 단어</h2><p class="sub">여러 번 틀린 단어예요. 내 암기법을 만들어 보거나 조각부터 다시 봐요.</p>
    <ul class="fam">${sticky.map(w => `<li><b lang="en">${esc(w.t)}</b> ${esc(w.ko[0])}</li>`).join('')}</ul>
    <button class="btn" data-act="sticky">끈질긴 단어 다시 보기</button></section>` : ''}
  <div class="checks one"><button class="btn primary big" data-act="home">끝내기</button></div>`;
}

// ───────── 동작 ─────────
async function saveSession() {
  await store.set('session', A.sess && !isDone(A.sess) ? A.sess : null);
}

function startSession(p, mode = 'daily') {
  A.sess = newSession(p, { now: Date.now(), mode });
  if (!A.sess.total) { toast('지금 볼 카드가 없어요'); A.sess = null; return; }
  A.view = 'study';
  A.phase = 'front';
  A.hint = false;
  saveSession();
  render();
  window.scrollTo(0, 0);
}

async function record(b, ok) {
  if (A.busy) return;
  A.busy = true;
  try { await recordNow(b, ok); } finally { A.busy = false; }
}
async function recordNow(b, ok) {
  const e = answer(A.sess, b, ok, { now: Date.now(), device: A.settings.device });
  if (!e) return;
  A.log.push(e);
  await store.addLog([e]);
  recompute();
  await saveSession();
}

function nextCard() {
  A.held = null;
  A.phase = 'front';
  A.pick = 0;
  A.hint = false;
  A.editNote = false;
  if (isDone(A.sess)) {
    A.summary = daySummary(IX, A.log, A.states, { now: Date.now(), retention: A.settings.retention });
    A.sess = null;
    saveSession();
    A.view = 'end';
  }
  render();
  window.scrollTo(0, 0);
}

let speaking = 0;
function sayEn(t) {
  try {
    if (!('speechSynthesis' in window)) { toast('이 기기에서는 발음 듣기를 쓸 수 없어요'); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(speakable(t));
    u.lang = 'en-US';
    u.rate = A.settings.rate;
    const v = (speechSynthesis.getVoices() || []).find(z => /^en[-_]US/i.test(z.lang)) || (speechSynthesis.getVoices() || []).find(z => /^en[-_]/i.test(z.lang));
    if (v) u.voice = v;
    speaking++;
    speechSynthesis.speak(u);
  } catch (e) { /* 발음은 없어도 공부할 수 있다 */ }
}

const ACT = {
  start: () => startSession(plan(), 'daily'),
  more: () => { A.extraNew += RULES.batch; startSession(plan(), 'daily'); },
  quick: () => {
    const p = plan(0);
    startSession({ ...p, reviews: p.reviews.slice(0, RULES.quickCards), fresh: [] }, 'quick');
  },
  resume: () => { A.view = 'study'; A.phase = 'front'; render(); },
  drop: async () => { A.sess = null; await saveSession(); render(); },
  home: () => {
    A.view = 'home'; A.phase = 'front'; A.summary = null; A.editNote = false;
    render();
    if (A.sess && !isDone(A.sess)) toast('하던 곳이 저장됐어요');
  },
  sticky: () => {
    const ids = (A.summary ? A.summary.sticky : []);
    startSession({ day: dayKey(Date.now()), reviews: ids, fresh: [] }, 'sticky');
  },
  hint: () => { A.hint = !A.hint; render(); },
  say: () => { const c = shown(); if (c) sayEn(IX.get(c.c).t); },
  grade: async b => {
    b = Number(b);
    if (A.phase !== 'front' || A.busy) return;
    if (b >= 3) { A.pick = b; A.phase = 'check'; render(); return; }
    A.held = { ...current(A.sess) };
    await record(b);
    A.phase = 'explain';
    render();
  },
  check: async ok => {
    if (A.phase !== 'check' || A.busy) return;
    A.held = { ...current(A.sess) };
    await record(A.pick, ok === '1');
    if (ok === '1') nextCard();
    else { A.phase = 'explain'; render(); }
  },
  next: () => nextCard(),
  editnote: () => { A.editNote = true; render(); },
  savenote: async () => {
    const ta = $app.querySelector('textarea[data-note]');
    if (!ta) return;
    const s = ta.value.trim();
    if (s) A.notes[ta.dataset.note] = { s, t: Date.now() };
    else delete A.notes[ta.dataset.note];
    await store.set('notes', A.notes);
    A.editNote = false;
    render();
    toast('내 암기법을 저장했어요');
  },
  sheet: k => { A.sheet = A.sheet === k ? null : k; render(); },
  ret: async v => { A.settings.retention = Number(v); await store.set('settings', A.settings); recompute(); render(); },
  rn: async v => { A.settings.rn = v === '1'; await store.set('settings', A.settings); render(); },
  rate: async v => { A.settings.rate = Number(v); await store.set('settings', A.settings); render(); sayEn('dyspnea'); },
  label: async v => { A.settings.label = v; await store.set('settings', A.settings); render(); },
  send: () => sendBackup(),
};


// ───────── 백업 ─────────
async function sendBackup() {
  const now = Date.now();
  const data = makeBackup(A.log, { device: A.settings.device, label: A.settings.label, now, notes: A.notes });
  const name = backupName(A.settings.label, now);
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  let file = null;
  try { file = new File([blob], name, { type: 'application/json' }); } catch (e) { /* 옛 브라우저 */ }
  const done = async how => { A.lastBackup = now; await store.set('lastBackup', now); render(); toast(how); };
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return done('백업을 보냈어요');
    } catch (e) {
      if (e && e.name === 'AbortError') return; // 공유 창을 닫음
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  done('백업 파일을 내려받았어요: ' + name);
}

async function importText(text) {
  let o;
  try { o = parseBackup(text); } catch (e) { toast(e.message, 5000); return; }
  const { log, added } = mergeLogs(A.log, o.log);
  await store.addLog(added);
  A.log = log;
  const nm = mergeNotes(A.notes, o.notes);
  if (nm.changed) { A.notes = nm.notes; await store.set('notes', A.notes); }
  recompute();
  render();
  const from = o.label ? `(${o.label}에서 보냄) ` : '';
  toast(added.length || nm.changed
    ? `${from}기록 ${added.length}줄을 합쳤어요${nm.changed ? ` · 내 암기법 ${nm.changed}개` : ''}`
    : `${from}새로 합칠 기록이 없어요. 이미 다 있어요.`, 4000);
}

async function importFile(f) {
  if (!f) return;
  if (f.size > 20 * 1024 * 1024) { toast('파일이 너무 커요. 메디보카 백업 파일인지 확인해 주세요.'); return; }
  importText(await f.text());
}

// 안드로이드 공유로 받은 파일 (서비스 워커가 잠시 맡아 둔 것)
async function receiveShared() {
  const q = new URLSearchParams(location.search);
  if (!q.has('shared')) return;
  history.replaceState(null, '', location.pathname);
  try {
    const c = await caches.open('medivoca-share');
    const r = await c.match('shared-backup');
    if (!r) { toast('받은 파일을 찾지 못했어요. "백업 불러오기"로 다시 열어 주세요.'); return; }
    await c.delete('shared-backup');
    importText(await r.text());
  } catch (e) { toast('받은 파일을 열지 못했어요'); }
}

// ───────── 알림 ─────────
let toastTimer = 0;
function toast(msg, ms = 2500) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), ms);
}

// ───────── 입력 ─────────
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t || t.tagName === 'INPUT' || t.disabled) return;
  const f = ACT[t.dataset.act];
  if (f) { e.preventDefault(); f(t.dataset.arg); }
});
document.addEventListener('change', e => {
  if (e.target.matches('input[type=file][data-act=file]')) { importFile(e.target.files[0]); e.target.value = ''; }
});
document.addEventListener('keydown', e => {
  if (A.view !== 'study' || e.target.closest('textarea, input') || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const go = (act, arg) => { e.preventDefault(); ACT[act](arg); };
  if (k === 'p') return go('say');
  if (A.phase === 'front') {
    if (['1', '2', '3', '4'].includes(k)) return go('grade', k);
    if (k === 'h') return go('hint');
  } else if (A.phase === 'check') {
    if (k === 'enter' || k === 'o') return go('check', '1');
    if (k === 'x' || k === 'backspace') return go('check', '0');
  } else if (A.phase === 'explain') {
    if (k === ' ' || k === 'enter') return go('next');
  }
  if (k === 'escape') go('home');
});
// 컴퓨터: 창에 끌어다 놓기
window.addEventListener('dragover', e => { if ([...(e.dataTransfer.types || [])].includes('Files')) { e.preventDefault(); document.body.classList.add('drop'); } });
window.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('drop'); });
window.addEventListener('drop', e => {
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  document.body.classList.remove('drop');
  importFile(e.dataTransfer.files[0]);
});
// 다른 탭에서 돌아오면 날짜가 바뀌었을 수 있다
document.addEventListener('visibilitychange', () => { if (!document.hidden && A.view === 'home') render(); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

boot();
