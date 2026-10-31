// 메디보카 화면: 홈 → 학습(앞면 → 확인 또는 설명) → 끝. 백업 보내기·불러오기, 설정.
import { UNITS, PAIRS } from '../data/index.js';
import { buildIndex } from './data.js';
import {
  RULES, replay, planToday, newOrder, newSession, current, answer, isDone,
  progress, streak, daySummary, dayKey, PACES, paceInfo, scopeSet, scopeLabel, normScope, scopeUnits, makeScope, overview,
  minutesForCards, daysBetween,
} from './engine.js';
import { guideHTML } from './guide.js';
import { THEMES, LOOKS, themeOf, applyLook } from './themes.js';
import { makeBackup, backupName, parseBackup, mergeLogs, mergeNotes } from './backup.js';
import { esc, rich, speakable } from './text.js';
import * as store from './store.js';

const IX = buildIndex(UNITS, PAIRS);
const ORDERS = {};
const orderFor = scope => ORDERS[scope] || (ORDERS[scope] = newOrder(IX, scope));
const $app = document.getElementById('app');

const DEFAULTS = {
  retention: 0.9, rn: false, rate: 0.85, label: '', device: '',
  scope: 'all',                                  // 공부 범위: star3 | core | all
  pace: { mode: 'daily', cards: RULES.dailyCards }, // 공부 속도
  seenGuide: false,                              // 첫 시작(환영 → 색 → 계획 → 준비)을 마쳤는지
  theme: 'burgundy',                             // 색: burgundy | glacier | lavender | sage | sunset
  look: 'basic',                                 // 모양: basic 기본 | soft 부드러움
};
const A = {
  log: [],
  states: new Map(),
  settings: { ...DEFAULTS },
  notes: {},           // 내 암기법 { id: { s, t } }
  lastBackup: 0,
  sess: null,          // 지금 세션
  view: 'home',        // home | study | end | guide | pace | welcome | look | ready
  first: false,        // 처음 실행: 환영 → 색 → 계획 → 준비 끝 → 홈
  draftLook: null,     // 색·모양 화면에서 고르는 중인 값
  draft: null,         // 계획 화면에서 고르는 중인 값
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
  applyLook(A.settings.theme, A.settings.look);
  recompute();
  if (!A.settings.seenGuide && !A.log.length) { A.first = true; A.view = 'welcome'; }
  render();
  await receiveShared();
  if (!store.ok) toast('이 창에서는 기록을 저장할 수 없어요. 비공개 창이 아닌 보통 창으로 열어 주세요.', 6000);
}

function recompute() {
  A.states = replay(A.log, { retention: A.settings.retention });
}

const plan = (extra = A.extraNew) => planToday(IX, A.states, {
  now: Date.now(), retention: A.settings.retention, extraNew: extra,
  pace: A.settings.pace, scope: A.settings.scope, order: orderFor(A.settings.scope),
});
const saveSettings = () => store.set('settings', A.settings);

// ───────── 그리기 ─────────
function render() {
  const V = { study: viewStudy, end: viewEnd, guide: () => guideHTML(false), pace: viewPace, welcome: viewWelcome, look: viewLook, ready: viewReady, stats: viewStats };
  const v = (V[A.view] || viewHome)();
  $app.innerHTML = v;
  $app.dataset.view = A.view;
  const ta = $app.querySelector('textarea');
  if (ta && A.editNote) ta.focus();
}

const KIND = { part: '조각', word: '단어', abbr: '약어' };
const stars = n => '★'.repeat(n);
const partType = t => (t.startsWith('-') ? '접미사' : t.endsWith('-') ? '접두사' : t.includes('/') ? '어근' : '조각');
const koMain = x => (x.ko || []).join(' · ');

// ───────── 아이콘 (선 아이콘, 글자색을 따른다) ─────────
const svg = (d, s = 22) => `<svg aria-hidden="true" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const IC = {
  back: svg('<path d="M15 18l-6-6 6-6"></path>'),
  bulb: svg('<path d="M9 18h6"></path><path d="M10 22h4"></path><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V17h6v-.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z"></path>'),
  cal: svg('<rect x="3" y="4" width="18" height="17" rx="3"></rect><path d="M3 9h18"></path><path d="M8 2v4"></path><path d="M16 2v4"></path>'),
  parts: svg('<rect x="3" y="3" width="8" height="8" rx="2"></rect><rect x="13" y="13" width="8" height="8" rx="2"></rect><path d="M11 7h4a2 2 0 0 1 2 2v4"></path>'),
  help: svg('<circle cx="12" cy="12" r="9"></circle><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"></path><path d="M12 17h.01"></path>'),
  flame: svg('<path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-5 5-5 8 0 4 3 7 7 7z"></path>', 16),
  phone: svg('<rect x="6" y="2" width="12" height="20" rx="3"></rect><path d="M12 18h.01"></path>'),
  sound: svg('<path d="M11 5L6 9H2v6h4l5 4z"></path><path d="M15.5 8.5a5 5 0 0 1 0 7"></path><path d="M19 5a10 10 0 0 1 0 14"></path>', 20),
};
const steps = n => `<div class="steps" aria-label="3단계 중 ${n}단계">${[1, 2, 3].map(i => `<i class="${i < n ? 'done' : i === n ? 'now' : ''}"></i>`).join('')}</div>`;
const stepTop = (n, backAct) => `<header class="top"><button class="back" data-act="${backAct}" aria-label="뒤로">${IC.back}</button>${steps(n)}<span style="width:34px"></span></header>`;
const fmtDate = (key, opt = { month: 'long', day: 'numeric' }) => new Date(key + 'T12:00:00').toLocaleDateString('ko-KR', opt);
const addDays = (key, n) => { const t = new Date(key + 'T12:00:00'); t.setDate(t.getDate() + n); return dayKey(t.getTime() + 4 * 3600000); };
const isStandalone = () => { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; } };

// ───────── 첫 시작 1: 환영 ─────────
function viewWelcome() {
  const n = IX.items.length.toLocaleString('ko-KR');
  return `<section class="welcome">
    <div class="brand"><div class="brand-mark" aria-hidden="true"><b>M</b><i></i></div><span>메디보카</span></div>
    <div>
      <h1 class="hero-title">의학용어 ${n}개,<br>하루 15분이면 돼요</h1>
      <p class="lead-p">암기 연구에서 효과가 가장 높게 나온 방법만 골라 만들었어요. 읽지 말고 떠올리고, 잊기 직전에 다시 봐요.</p>
    </div>
    <div class="feats">
      <div class="feat"><div class="ic">${IC.bulb}</div><div><b>먼저 떠올리기</b><span>답을 보기 전에 뜻을 떠올려요. 다시 읽기보다 훨씬 오래 남아요.</span></div></div>
      <div class="feat"><div class="ic">${IC.cal}</div><div><b>잊기 직전에 다시</b><span>단어마다 기억 상태를 계산해 1일 → 3일 → 8일 → 3주 간격으로 다시 보여 줘요.</span></div></div>
      <div class="feat"><div class="ic">${IC.parts}</div><div><b>조각으로 풀기</b><span>cardi/o 심장 + -itis 염증 = 심장염. 조각을 알면 처음 보는 단어도 풀려요.</span></div></div>
    </div>
    <p class="cite">근거: Dunlosky 외(2013) 공부법 비교 · 연속 재학습 연구 · FSRS 복습 계산 — 자세히는 시작 뒤 "사용법"에서</p>
    <div class="bottom-cta">
      <button class="btn primary big" data-act="tolook">시작하기</button>
      <label class="btn ghost">다른 기기에서 쓰던 기록이 있어요<input type="file" accept=".json,application/json" data-act="file" hidden></label>
    </div>
  </section>`;
}

// ───────── 첫 시작 2 / 설정: 색과 모양 고르기 ─────────
function viewLook() {
  const d = A.draftLook;
  const t = themeOf(d.theme);
  return `${A.first ? stepTop(1, 'towelcome') : `<header class="top"><h1>색과 모양</h1><button class="btn small" data-act="home">닫기</button></header>`}
  ${A.first ? '<h1 class="hero-title" style="font-size:26px">마음에 드는 색을 골라요</h1><p class="lead-p" style="margin:6px 0 16px">매일 보는 앱이니까 내 취향대로. 설정에서 언제든 바꿀 수 있어요.</p>' : ''}
  <div class="preview" aria-label="미리 보기">
    <div class="row-between"><b style="font-size:18px">오늘 할 일</b><span class="pill">${IC.flame}12일 연속</span></div>
    <div class="sumcard"><div><b>32</b><span>복습</span></div><div><b>18</b><span>새 단어</span></div><div><b>15분</b><span>예상</span></div></div>
    <span class="btn primary" style="min-height:50px">오늘 공부 시작</span>
    <div class="grades"><span class="g g1" style="min-height:56px;font-size:13px">모름</span><span class="g g2" style="min-height:56px;font-size:13px">헷갈림</span><span class="g g3" style="min-height:56px;font-size:13px">알 것 같음</span><span class="g g4" style="min-height:56px;font-size:13px">확실히 앎</span></div>
  </div>
  <div class="swatches" role="radiogroup" aria-label="색 테마">
    ${THEMES.map(x => `<button class="sw${x.id === t.id ? ' on' : ''}" role="radio" aria-checked="${x.id === t.id}" data-act="dtheme" data-arg="${x.id}"><span class="ring"><span class="dot" style="background:${x.pri}"></span></span>${x.name}</button>`).join('')}
  </div>
  <p class="mood">${esc(t.mood)}</p>
  <h2 style="font-size:15px;margin:16px 0 8px">모양</h2>
  <div class="seg" role="radiogroup" aria-label="모양">
    ${LOOKS.map(l => `<button class="${l.id === d.look ? 'on' : ''}" role="radio" aria-checked="${l.id === d.look}" data-act="dlook" data-arg="${l.id}"><b class="${l.id === 'soft' ? 'soft-demo' : ''}">${l.name}</b><small>${l.desc}</small></button>`).join('')}
  </div>
  <div class="bottom-cta"><button class="btn primary big" data-act="savelook">${A.first ? '이 색으로 할게요' : '저장'}</button></div>`;
}

// ───────── 첫 시작 4: 준비 끝 ─────────
function viewReady() {
  const S = A.settings;
  const today = dayKey(Date.now());
  const info = paceInfo(IX, A.states, { pace: S.pace, scope: S.scope });
  const p = plan();
  const end = S.pace.mode === 'goal' ? S.pace.end : addDays(today, info.weeks * 7);
  const iOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const android = /Android/i.test(navigator.userAgent);
  const tip = isStandalone() ? '' : `<div class="tip">${IC.phone}<p><b>${iOS || android ? '홈 화면에 추가' : '앱으로 설치'}</b>하면 앱처럼 열리고 인터넷 없이도 돼요.
    ${iOS ? '사파리 아래 공유 버튼 → "홈 화면에 추가"' : android ? '크롬 오른쪽 위 메뉴 ⋮ → "앱 설치"' : '크롬·엣지 주소창 오른쪽의 설치 버튼'}</p></div>`;
  return `${stepTop(3, 'topace')}
  <h1 class="hero-title" style="font-size:26px;margin-bottom:14px">준비됐어요</h1>
  <section class="readycard">
    <div class="big">매일 약 ${info.minutes}분</div>
    <p>${fmtDate(end, { year: 'numeric', month: 'long', day: 'numeric' })}까지 ${scopeLabel(S.scope)} ${info.total}개를 모두 넣어요</p>
    <div class="rows">
      <div><span>오늘</span><span>새 단어 ${p.fresh.length}개 · 약 ${p.minutes}분</span></div>
      <div><span>순서</span><span>조각(접두사·접미사)부터, 장별로</span></div>
      <div><span>복습</span><span>잊기 직전에 앱이 알아서</span></div>
    </div>
  </section>
  <section class="panel" style="padding:4px 16px">
    <label class="toggle-row"><span><b style="font-size:15px">RN 영어 설명도 보기</b><br><span class="sub">영어 정의와 환자가 쓰는 말 (NCLEX 대비)</span></span>
      <input type="checkbox" data-act="rnbox"${S.rn ? ' checked' : ''}></label>
    <div class="set" style="grid-template-columns:auto 1fr;align-items:center"><span>이 기기</span><div style="justify-content:flex-end">
      ${['폰', '태블릿', '컴퓨터'].map(x => `<button class="chip${S.label === x ? ' on' : ''}" data-act="label" data-arg="${x}">${x}</button>`).join('')}</div></div>
  </section>
  ${tip}
  <div class="bottom-cta"><button class="btn primary big" data-act="finish">첫 공부 시작</button></div>`;
}

// ───────── 홈 (다음부터 열면 바로 보이는 화면) ─────────
function viewHome() {
  const S = A.settings;
  const p = plan();
  const st = streak(A.log);
  const resume = A.sess && !isDone(A.sess);
  const total = p.reviews.length + p.fresh.length;
  const doneToday = !resume && total === 0;
  const inKakao = /KAKAOTALK/i.test(navigator.userAgent);
  const now = new Date();
  const dateLine = now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });

  let hero;
  if (resume) {
    const left = A.sess.queue.length + (A.sess.finalsAdded ? 0 : A.sess.finals.length);
    hero = `<p class="big-line">하던 공부가 있어요</p><p class="sub">${A.sess.doneCards} / ${A.sess.total}장 봤어요 · 남은 카드 ${left}장</p>
      <button class="btn primary big" data-act="resume">이어서 하기</button>
      <button class="btn ghost" data-act="drop">처음부터 다시 정하기</button>`;
  } else if (doneToday) {
    hero = `<p class="big-line">오늘 할 일 끝!</p><p class="sub">내일 다시 만나요. 더 하고 싶으면 새 단어를 조금 더 넣을 수 있어요.</p>
      <button class="btn primary big" data-act="more">새 단어 ${RULES.batch}개 더</button>`;
  } else {
    hero = `<div class="hero-stats"><div><b>${p.reviews.length}</b><span>복습</span></div><div><b>${p.fresh.length}</b><span>새 단어</span></div><div><b>${p.minutes}<small>분</small></b><span>예상 시간</span></div></div>
      ${p.backlog ? '<p class="note">밀린 복습이 많아서 오늘은 새 단어를 쉬어 가요.</p>' : ''}
      ${p.goal && p.goal.reviewPhase ? '<p class="note">목표일 전 복습만 하는 기간이에요.</p>' : ''}
      ${p.goal && p.goal.ended ? '<p class="note">목표 날짜가 지났어요. 공부 계획에서 새로 정해 보세요.</p>' : ''}
      ${p.dueTotal > p.reviews.length ? `<p class="note">남은 복습 ${p.dueTotal - p.reviews.length}장은 내일로 나눠요.</p>` : ''}
      <button class="btn primary big" data-act="start">오늘 공부 시작</button>
      ${p.dueTotal ? `<button class="btn ghost" data-act="quick" style="margin-top:-6px">3분만 하기 · 복습 ${Math.min(RULES.quickCards, p.dueTotal)}장</button>` : ''}`;
  }

  // 계획 진도
  const info = paceInfo(IX, A.states, { pace: S.pace, scope: S.scope });
  const pr = progress(IX, A.states, S.scope);
  const done = pr.mastered + pr.long;
  const pct = pr.total ? Math.round((done / pr.total) * 100) : 0;
  const speed = S.pace.mode === 'goal'
    ? (info.ended ? `${fmtDate(S.pace.end)}까지 (지남)` : `${fmtDate(S.pace.end)}까지 · D-${info.daysLeft} · 하루 새 단어 ${info.perDay}개`)
    : `하루 ${S.pace.cards}장 · 약 ${info.minutes}분`;
  // 계획 대비: 처음 정한 하루 양보다 지금 필요한 양이 많으면 늦은 것
  let track = '';
  if (S.pace.mode === 'goal' && S.pace.perDay0 && !info.ended && !info.reviewPhase && info.remaining) {
    if (info.perDay > S.pace.perDay0) track = `<p class="note warn-t" style="margin-top:6px">계획보다 늦어요. 날짜를 맞추려면 하루 ${info.perDay}개씩 해야 해요.</p>`;
    else if (info.perDay < S.pace.perDay0) track = '<p class="note" style="margin-top:6px">계획보다 빨라요. 잘하고 있어요!</p>';
  }

  // 이번 주 (월~일)
  const days = new Set(A.log.map(e => dayKey(e.t)));
  const today = dayKey(Date.now());
  const dow = (new Date(today + 'T12:00:00').getDay() + 6) % 7;
  const week = ['월', '화', '수', '목', '금', '토', '일'].map((n, i) => {
    const k = addDays(today, i - dow);
    const cls = days.has(k) ? 'done' : k === today ? 'today' : '';
    return `<div>${n}<i class="${cls}">${days.has(k) ? '✓' : ''}</i></div>`;
  }).join('');

  return `
  <header class="top home-top"><div><span class="date">${dateLine}</span><h1>오늘 할 일</h1></div>
    <div class="top-r">${st ? `<span class="pill">${IC.flame}${st}일 연속</span>` : ''}<button class="icon-round" data-act="guide" aria-label="사용법">${IC.help}</button></div></header>
  ${inKakao ? '<div class="warn">카카오톡 안에서 열렸어요. 여기서 공부하면 기록이 따로 저장돼요. 오른쪽 위 메뉴에서 <b>다른 브라우저로 열기</b>를 눌러 주세요.</div>' : ''}
  <section class="hero">${hero}</section>
  <section class="panel">
    <div class="plan-row">
      <button class="ring" data-act="stats" aria-label="현황 보기" style="background:conic-gradient(var(--pri) 0 ${pct}%, var(--tint) ${pct}% 100%)"><span>${pct}%</span></button>
      <div class="txt">
        <div class="row-between"><b>공부 계획</b><button class="link" data-act="pace">바꾸기</button></div>
        <span>${scopeLabel(S.scope)} ${pr.total}개 중 <b>${done}개 익힘</b></span>
        <span class="sub">${speed}</span>
      </div>
    </div>
    ${track}
    <p class="note" style="margin-top:10px">새 단어 ${pr.new} · 배우는 중 ${pr.learning} · 익힘 ${pr.mastered} · 오래 기억 ${pr.long}</p>
    ${pr.suggestNext && S.scope !== 'all' ? '<p class="note">이 범위의 80%를 익혔어요! 공부 계획에서 범위를 넓혀 보세요.</p>' : ''}
  </section>
  <section class="panel"><div class="row-between"><b>이번 주</b><span class="sub">${st ? `${st}일째 이어서 하는 중` : '오늘부터 시작해요'}</span></div><div class="week">${week}</div></section>
  <nav class="tabs">
    <button class="tab" data-act="stats">현황</button>
    <button class="tab${A.sheet === 'backup' ? ' on' : ''}" data-act="sheet" data-arg="backup">옮기기</button>
    <button class="tab${A.sheet === 'settings' ? ' on' : ''}" data-act="sheet" data-arg="settings">설정</button>
  </nav>
  ${A.sheet === 'backup' ? viewBackup() : A.sheet === 'settings' ? viewSettings() : ''}
  <p class="foot">단어 ${IX.items.length}개 · 기록 ${A.log.length}줄 · 이 기기: ${esc(S.label)}</p>`;
}

// 공부 계획 화면: 무엇을(범위) · 얼마나 빨리(하루 장수 또는 날짜)
function viewPace() {
  const d = A.draft;
  const today = dayKey(Date.now());
  const stars = new Set([...normScope(d.scope).split('|')[0]].map(Number));
  const units = scopeUnits(d.scope);
  const STAR = [[3, '자주 나옴', '국시·시험에 자주, 매일 쓰는 말'], [2, '중요', '수업에서 꼭 배우는 말'], [1, '확장', '알아 두면 좋은 말']];
  const starOpts = STAR.map(([n, name, desc]) => {
    const cnt = IX.items.filter(x => x.star === n && (!units || units.has(x.unit))).length;
    return `<button class="opt check${stars.has(n) ? ' on' : ''}" data-act="dstar" data-arg="${n}" aria-pressed="${stars.has(n)}">
      <span class="dot box"></span><span><b><span class="stars">${'★'.repeat(n)}</span> ${name} · ${cnt}개</b><small>${desc}</small></span></button>`;
  }).join('');
  const unitChips = `<button class="chip${units ? '' : ' on'}" data-act="dunitall">전체 단원</button>` +
    IX.units.map(u => `<button class="chip${units && units.has(u.id) ? ' on' : ''}" data-act="dunit" data-arg="${u.id}">${u.n}. ${esc(u.short)}</button>`).join('');
  const sel = paceInfo(IX, A.states, { scope: d.scope });

  // 며칠 안에: 4·8·12·16주 → 하루 새 단어·시간·끝나는 날
  const goalAt = end => paceInfo(IX, A.states, { pace: { mode: 'goal', start: today, end }, scope: d.scope });
  const WEEKS = [4, 8, 12, 16];
  const infos = WEEKS.map(w => ({ w, end: addDays(today, w * 7), info: goalAt(addDays(today, w * 7)) }));
  const rec = (infos.find(o => o.info.minutes <= 18) || infos[infos.length - 1]).w;
  const isWeek = d.pace.mode === 'goal' && infos.some(o => o.end === d.pace.end);
  const custom = d.pace.mode === 'goal' && d.pace.end && !isWeek;
  const durOpts = infos.map(({ w, end, info }) => {
    const on = d.pace.mode === 'goal' && d.pace.end === end;
    return `<button class="opt dur${on ? ' on' : ''}" data-act="dweeks" data-arg="${w}" aria-pressed="${on}">
      <span class="dot"></span><span class="grow"><b>${w}주${w === 16 ? ' (한 학기)' : ''}${w === rec ? ' <em class="badge">추천</em>' : ''}</b>
      <small>하루 새 단어 ${info.perDay}개 · 약 ${info.minutes}분 · ${fmtDate(end)}까지</small></span></button>`;
  }).join('');
  const cInfo = custom ? goalAt(d.pace.end) : null;
  const customBox = `<div class="opt dur${custom ? ' on' : ''}" style="cursor:default"><span class="dot"></span><span class="grow">
      <b>시험 날짜로 정하기</b>
      <label class="datel" style="margin-top:6px"><span class="sub">끝낼 날짜</span><input type="date" data-act="dend" min="${addDays(today, 1)}" value="${custom ? esc(d.pace.end) : ''}"></label>
      ${cInfo ? (cInfo.ended ? '<small class="warn-t">오늘보다 뒤 날짜를 골라 주세요.</small>' : `<small>하루 새 단어 ${cInfo.perDay}개 · 약 ${cInfo.minutes}분 · ${cInfo.daysLeft}일 남음</small>`) : ''}
    </span></div>`;

  const cur = d.pace.mode === 'goal' && d.pace.end ? goalAt(d.pace.end) : null;
  let sum = '';
  if (cur && !cur.ended) {
    sum = `<section class="panel"><div class="sumcard">
      <div><b>${cur.perDay}개</b><span>하루 새 단어</span></div>
      <div><b>약 ${cur.minutes}분</b><span>하루 공부</span></div>
      <div><b>${fmtDate(d.pace.end)}</b><span>다 끝나는 날</span></div>
    </div>
    <p class="note" style="margin-top:10px">새 단어는 ${cur.newDays}일 동안 넣고, 마지막 ${cur.reviewOnly}일은 복습만 해요. 하루 시간에는 복습이 들어 있어요.</p>
    ${cur.heavy ? `<p class="note warn-t" style="margin-top:6px">하루 40분이 넘어요.${stars.has(3) && stars.size > 1 ? ' <button class="link" data-act="dstaronly">★★★만 먼저</button> 하거나' : ''} 기간을 늘려 보세요.</p>` : ''}
    </section>`;
  } else if (d.pace.mode === 'daily') {
    sum = `<p class="note center">지금은 "하루 ${d.pace.cards}장" 방식이에요. 위에서 기간을 고르면 바뀌어요.</p>`;
  }
  const disabled = !(d.pace.mode === 'daily' || (cur && !cur.ended)) || sel.total === 0;
  return `${A.first ? stepTop(2, 'tolook') : '<header class="top"><h1>공부 계획</h1><button class="btn small" data-act="home">닫기</button></header>'}
  ${A.first ? '<h1 class="hero-title" style="font-size:26px;margin-bottom:14px">공부 계획을 세워요</h1>' : ''}
  <section class="panel order-line"><b>공부 순서: 추천 순서</b>
    <p class="sub" style="margin-top:2px">조각 → 인체 → 계통별(근골격 → 심혈관 → … → 피부) → 약어</p>
    <p class="note" style="margin-top:4px">의학용어 수업에서 가장 흔한 순서예요. 교재 순서로 바꾸는 기능은 곧 더해요.</p></section>
  <section class="panel"><div class="row-between"><h2>① 무엇을 외울까요?</h2><span class="sub">${sel.total}개${sel.remaining < sel.total ? ` · 남은 ${sel.remaining}` : ''}</span></div>
    <p class="note">중요도를 고르고, 필요하면 단원을 골라요. 여러 개 고를 수 있어요.</p>
    <div class="opts">${starOpts}</div>
    <details class="units"${units ? ' open' : ''}><summary>단원 고르기${units ? ` (${units.size}개)` : ' (전체)'}</summary><div class="chips" style="margin-top:10px">${unitChips}</div></details>
  </section>
  <section class="panel"><h2>② 며칠 안에 끝낼까요?</h2>
    <p class="note">고른 ${sel.remaining}개를 언제까지 다 외울지 정하면 하루 양을 계산해요.</p>
    <div class="opts">${durOpts}${customBox}</div>
  </section>
  ${sum}
  ${A.first ? '' : '<p class="note center">계획을 바꿔도 지금까지 공부한 기록은 그대로예요.</p>'}
  <div class="bottom-cta"><button class="btn primary big" data-act="savepace"${disabled ? ' disabled' : ''}>${A.first ? '이 계획으로 하기' : '저장'}</button></div>`;
}

// 현황: 얼마나 공부했고, 얼마나 기억하는지
function viewStats() {
  const o = overview(IX, A.log, A.states, { now: Date.now(), retention: A.settings.retention });
  const pctOf = (n, t) => (t ? Math.round((n / t) * 100) : 0);
  const bar = g => `<div class="bar" aria-hidden="true"><i class="s-long" style="width:${pctOf(g.long, g.total)}%"></i><i class="s-mastered" style="width:${pctOf(g.mastered, g.total)}%"></i><i class="s-learning" style="width:${pctOf(g.learning, g.total)}%"></i></div>`;
  const done = g => g.mastered + g.long;
  const goal = Math.round(A.settings.retention * 100);
  const actual = o.actual == null ? null : Math.round(o.actual * 100);
  const recall = o.recall == null ? null : Math.round(o.recall * 100);
  const maxAhead = Math.max(1, ...o.ahead.map(a => a.n));
  const wd = ['일', '월', '화', '수', '목', '금', '토'];
  return `<header class="top"><h1>현황</h1><button class="btn small" data-act="home">닫기</button></header>
  <section class="panel">
    <h2>얼마나 공부했나</h2>
    <div class="sumcard">
      <div><b>${o.started}</b><span>공부한 단어</span></div>
      <div><b>${done(o.all)}</b><span>익힘 이상</span></div>
      <div><b>${o.studyDays}일</b><span>공부한 날</span></div>
    </div>
    ${bar(o.all)}
    <ul class="legend">
      <li><i class="s-new"></i>새 단어 ${o.all.new}</li><li><i class="s-learning"></i>배우는 중 ${o.all.learning}</li>
      <li><i class="s-mastered"></i>익힘 ${o.all.mastered}</li><li><i class="s-long"></i>오래 기억 ${o.all.long}</li>
    </ul>
    <p class="note" style="margin-top:8px">익힘 = 다른 날 3번 맞힘 · 오래 기억 = 다음 복습까지 3주 이상</p>
  </section>
  <section class="panel">
    <h2>얼마나 기억하나</h2>
    <div class="meter-row"><span>최근 30일 실제 기억률</span><b>${actual == null ? '–' : actual + '%'}</b></div>
    <div class="meter"><i style="width:${actual || 0}%"></i><em style="left:${goal}%" title="목표 ${goal}%"></em></div>
    <p class="note">복습 ${o.reviews}번 중 처음에 맞힌 비율이에요. 목표는 ${goal}%${actual == null ? '. 복습이 쌓이면 보여요.' : actual >= goal - 3 ? '. 잘 지키고 있어요.' : '. 조금 낮아요. 매일 복습을 거르지 않는 게 가장 좋아요.'}</p>
    <div class="meter-row" style="margin-top:12px"><span>지금 기억하고 있을 확률</span><b>${recall == null ? '–' : recall + '%'}</b></div>
    <div class="meter"><i style="width:${recall || 0}%"></i></div>
    <p class="note">공부한 단어 ${o.started}개를 지금 시험 보면 평균 이만큼 맞힐 거라는 앱의 계산이에요.</p>
  </section>
  <section class="panel">
    <h2>중요도별</h2>
    ${[3, 2, 1].map(n => { const g = o.byStar[n]; return `<div class="row-stat"><div class="row-between"><span><span class="stars">${'★'.repeat(n)}</span> ${n === 3 ? '자주 나옴' : n === 2 ? '중요' : '확장'}</span><span class="sub">${done(g)} / ${g.total} 익힘 · 시작 ${g.total - g.new}</span></div>${bar(g)}</div>`; }).join('')}
  </section>
  <section class="panel">
    <h2>앞으로 7일 복습</h2>
    <div class="ahead">${o.ahead.map((a, i) => `<div><span class="n">${a.n}</span><i style="height:${Math.round((a.n / maxAhead) * 64)}px"></i><span>${i === 0 ? '오늘' : wd[new Date(a.day + 'T12:00:00').getDay()]}</span></div>`).join('')}</div>
  </section>
  <section class="panel">
    <h2>장별</h2>
    ${o.byUnit.map(g => `<div class="row-stat"><div class="row-between"><span>${g.unit.n}. ${esc(g.unit.short)}</span><span class="sub">${done(g)} / ${g.total}</span></div>${bar(g)}</div>`).join('')}
  </section>
  ${o.sticky.length ? `<section class="panel"><h2>끈질긴 단어</h2><p class="note">여러 번 틀린 단어예요. 내 암기법을 만들어 보세요.</p>
    <ul class="fam" style="margin-top:6px">${o.sticky.slice(0, 12).map(id => { const w = IX.get(id); return w ? `<li><b lang="en">${esc(w.t)}</b> ${esc(w.ko[0])}</li>` : ''; }).join('')}</ul></section>` : ''}
  <div class="bottom-cta"><button class="btn primary big" data-act="home">닫기</button></div>`;
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
    <div class="set"><span>색</span><div>
      ${THEMES.map(x => `<button class="sw${x.id === s.theme ? ' on' : ''}" aria-label="${x.name}" data-act="theme" data-arg="${x.id}"><span class="ring"><span class="dot" style="background:${x.pri}"></span></span>${x.name}</button>`).join('')}
    </div></div>
    <div class="set"><span>모양</span><div>${LOOKS.map(l => chip('look', l.id, s.look === l.id, l.name)).join('')}</div></div>
    <div class="set"><span>공부 계획</span><div><button class="chip" data-act="pace">범위·속도 바꾸기</button></div></div>
    <div class="set"><span>목표 기억률</span><div>
      ${chip('ret', 0.85, s.retention === 0.85, '85% 여유')}${chip('ret', 0.9, s.retention === 0.9, '90% 기본')}${chip('ret', 0.95, s.retention === 0.95, '95% 시험 주간')}
    </div><p class="note">높일수록 더 자주 복습해요.</p></div>
    <div class="set"><span>RN 영어 설명</span><div>${chip('rn', 1, s.rn, '켜기')}${chip('rn', 0, !s.rn, '끄기')}</div></div>
    <div class="set"><span>발음 속도</span><div>${chip('rate', 0.7, s.rate === 0.7, '느리게')}${chip('rate', 0.85, s.rate === 0.85, '보통')}${chip('rate', 1, s.rate === 1, '빠르게')}</div></div>
    <div class="set"><span>이 기기 이름</span><div>${['폰', '태블릿', '컴퓨터', '노트북'].map(x => chip('label', x, s.label === x, x)).join('')}</div>
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
      <button class="icon-btn" data-act="say" title="발음 듣기 (P)" aria-label="발음 듣기">${IC.sound}</button>
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
    if (A.view === 'look') applyLook(A.settings.theme, A.settings.look);
    A.view = 'home'; A.phase = 'front'; A.summary = null; A.editNote = false; A.draft = null;
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
  guide: () => { A.view = 'guide'; render(); window.scrollTo(0, 0); },
  // 첫 시작 흐름
  towelcome: () => go('welcome'),
  tolook: () => { A.draftLook = { theme: A.settings.theme, look: A.settings.look }; go('look'); },
  topace: () => ACT.pace(),
  dtheme: id => { A.draftLook.theme = id; applyLook(id, A.draftLook.look); render(); },
  dlook: id => { A.draftLook.look = id; applyLook(A.draftLook.theme, id); render(); },
  savelook: async () => {
    A.settings.theme = A.draftLook.theme;
    A.settings.look = A.draftLook.look;
    await saveSettings();
    if (A.first) ACT.pace();
    else { go('home'); toast('색과 모양을 바꿨어요'); }
  },
  finish: async () => {
    A.settings.seenGuide = true;
    await saveSettings();
    A.first = false;
    startSession(plan(), 'daily');
  },
  theme: async id => { A.settings.theme = id; applyLook(id, A.settings.look); await saveSettings(); render(); },
  look: async id => { A.settings.look = id; applyLook(A.settings.theme, id); await saveSettings(); render(); },
  pace: () => {
    A.draft = { scope: A.settings.scope, pace: { ...A.settings.pace } };
    if (A.first && A.draft.pace.mode !== 'goal') A.draft.pace = { mode: 'goal', end: addDays(dayKey(Date.now()), 16 * 7) };
    go('pace');
  },
  dscope: k => { A.draft.scope = normScope(k); render(); },
  dstar: n => {
    const on = new Set([...normScope(A.draft.scope).split('|')[0]].map(Number));
    const units = scopeUnits(A.draft.scope);
    n = Number(n);
    if (on.has(n)) { if (on.size === 1) { toast('하나는 골라야 해요'); return; } on.delete(n); } else on.add(n);
    A.draft.scope = makeScope([...on], units ? [...units] : null);
    render();
  },
  dstaronly: () => { const units = scopeUnits(A.draft.scope); A.draft.scope = makeScope([3], units ? [...units] : null); render(); },
  dunit: id => {
    const stars = [...normScope(A.draft.scope).split('|')[0]].map(Number);
    const units = new Set(scopeUnits(A.draft.scope) || []);
    if (units.has(id)) units.delete(id); else units.add(id);
    A.draft.scope = makeScope(stars, units.size && units.size < IX.units.length ? [...units] : null);
    render();
  },
  dunitall: () => { A.draft.scope = makeScope([...normScope(A.draft.scope).split('|')[0]].map(Number), null); render(); },
  stats: () => go('stats'),
  dpace: n => { A.draft.pace = { mode: 'daily', cards: Number(n) }; render(); },
  dgoal: () => { if (A.draft.pace.mode !== 'goal') A.draft.pace = { mode: 'goal', end: '' }; render(); },
  dweeks: n => {
    const t = new Date(dayKey(Date.now()) + 'T12:00:00');
    t.setDate(t.getDate() + Number(n) * 7);
    A.draft.pace = { mode: 'goal', end: dayKey(t.getTime() + 4 * 3600000) };
    render();
  },
  savepace: async () => {
    const d = A.draft;
    if (d.pace.mode === 'goal') {
      d.pace.start = dayKey(Date.now());
      d.pace.perDay0 = paceInfo(IX, A.states, { pace: d.pace, scope: d.scope }).perDay;
    }
    A.settings.scope = d.scope;
    A.settings.pace = d.pace;
    await saveSettings();
    A.draft = null;
    if (A.first) { go('ready'); return; }
    go('home');
    toast('공부 계획을 정했어요');
  },
  sheet: k => { A.sheet = A.sheet === k ? null : k; render(); },
  ret: async v => { A.settings.retention = Number(v); await store.set('settings', A.settings); recompute(); render(); },
  rn: async v => { A.settings.rn = v === '1'; await store.set('settings', A.settings); render(); },
  rate: async v => { A.settings.rate = Number(v); await store.set('settings', A.settings); render(); sayEn('dyspnea'); },
  label: async v => { A.settings.label = v; await store.set('settings', A.settings); render(); },
  send: () => sendBackup(),
};


function go(view) {
  if (view === 'home' && A.view === 'look' && A.draftLook) applyLook(A.settings.theme, A.settings.look); // 저장 안 하고 닫으면 원래 색으로
  A.view = view;
  render();
  window.scrollTo(0, 0);
}

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
  if (A.view === 'welcome') ACT.tolook(); else render();
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
  if (e.target.matches('input[type=checkbox][data-act=rnbox]')) { A.settings.rn = e.target.checked; saveSettings(); }
  if (e.target.matches('input[type=date][data-act=dend]') && A.draft) {
    A.draft.pace = { mode: 'goal', end: e.target.value };
    render();
  }
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
