// 메디보카 화면: 홈 → 학습(앞면 → 확인 또는 설명) → 끝. 백업 보내기·불러오기, 설정.
import { UNITS, PAIRS, CONFUSIONS } from '../data/index.js';
import { buildIndex } from './data.js';
import {
  RULES, replay, planToday, ratingOf, newOrder, newSession, current, answer, isDone,
  progress, streak, daySummary, dayKey, setSummary, focusOrder, pickNew, splitStates, spellCandidates, isSpell, spellBase, isSyl, sylUnits, makeSyl, LIST_ORDERS, MARKS, answerMarks, marksList, PACES, paceInfo, scopeSet, scopeLabel, normScope, scopeUnits, makeScope, overview,
  minutesForCards, daysBetween, scopeStars,
} from './engine.js';
import { guideHTML } from './guide.js';
import { THEMES, LOOKS, themeOf, applyLook } from './themes.js';
import { QTYPES, buildQuiz, grade, summarize, spellHard } from './quiz.js';
import { runFunnel, countIf, groupsIn, STEPS } from './funnel.js';
import { dayStats, weekSummary, masteredSeries, mergeHistory } from './history.js';
import { makeBackup, backupName, parseBackup, mergeLogs, mergeNotes, mergeFlags } from './backup.js';
import { esc, rich, speakable, normEn, normKo, gradeSpell } from './text.js';
import * as store from './store.js';

const IX = buildIndex(UNITS, PAIRS, CONFUSIONS);
const ORDERS = {};
const orderFor = scope => ORDERS[scope] || (ORDERS[scope] = newOrder(IX, scope));
const $app = document.getElementById('app');

const DEFAULTS = {
  retention: 0.9, rn: false, rate: 0.85, label: '', device: '',
  spell: 'word',                                 // 철자 카드: off | word 단어만 | wordabbr 단어+약어 | all 조각까지
  scope: 'all',                                  // 공부 범위: star3 | core | all
  pace: { mode: 'daily', cards: RULES.dailyCards }, // 공부 속도
  seenGuide: false,                              // 첫 시작(환영 → 색 → 계획 → 준비)을 마쳤는지
  theme: 'rose',                                 // 색(파스텔): rose | sky | lavender | mint | peach
  look: 'basic',                                 // 모양: basic 기본 | soft 부드러움
  lists: [],                                     // 내 단어 목록 여러 개 [{ id, name, ids, pace }]
  curList: '',                                   // 지금 쓰는 내 단어 목록 id
};
const A = {
  log: [],
  states: new Map(),
  settings: { ...DEFAULTS },
  notes: {},           // 내 암기법 { id: { s, t } }
  flags: {},           // 아주 중요 표시 { id: { on, t } } (백업에 들어감)
  sessions: {},        // 계획마다 하던 공부 { 'rec'|'syl'|'L:목록id': 세션 }
  qmarks: {},          // 시험 결과 모음 { id: { w, u, ok, last, t } } (이 기기만)
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
  A.flags = await store.get('flags', {});
  A.history = await store.get('history', []);
  A.qmarks = await store.get('qmarks', {});
  A.lastBackup = await store.get('lastBackup', 0);
  A.quizzes = await store.get('quizzes', []);
  A.sessions = await store.get('sessions', {});
  const saved = await store.get('session', null);
  if (saved && saved.day === dayKey(Date.now()) && !isDone(saved)) { A.sess = saved; if (!saved.key) saved.key = saved.mode === 'daily' ? 'rec' : 'other'; }
  A.settings.theme = themeOf(A.settings.theme).id;
  applyLook(A.settings.theme, A.settings.look);
  if (A.settings.scope === 'my') { A.settings.track = 'my'; A.settings.myPace = A.settings.pace; A.settings.scope = '321'; }
  // 예전 하나짜리 내 단어 → 목록 여러 개
  if (!(A.settings.lists || []).length && (A.settings.myList || []).length) {
    A.settings.lists = [{ id: 'L1', name: '내 단어 1', ids: A.settings.myList, pace: A.settings.myPace || { mode: 'daily', cards: 50 } }];
    A.settings.curList = 'L1';
  }
  delete A.settings.myList; delete A.settings.myPace;
  IX.myList = myIds();
  recompute();
  if (!A.settings.seenGuide && !A.log.length) { A.first = true; A.view = 'welcome'; }
  render();
  await receiveShared();
  if (!store.ok) toast('이 창에서는 기록을 저장할 수 없어요. 비공개 창이 아닌 보통 창으로 열어 주세요.', 6000);
}

// 보통 카드 상태(A.states)와 철자 카드 상태(A.spell, 's:단어id')를 나눠 둔다
function recompute() {
  const sp = splitStates(replay(A.log, { retention: A.settings.retention }));
  A.states = sp.states; A.spell = sp.spell;
}

// 내 단어 목록(여러 개). curL() = 지금 고른 목록. 엔진의 범위 'my'는 IX.myList(= 지금 목록)를 쓴다.
// 새 내 단어 목록의 기본 기간: 4주 (만들 때 바꿀 수 있다)
const DEFAULT_MY_PACE = { mode: 'goal', weeks: 4 };
const fixPace = pc => (pc && pc.mode === 'goal' && !pc.end ? { mode: 'goal', start: dayKey(Date.now()), end: (() => { const t = new Date(dayKey(Date.now()) + 'T12:00:00'); t.setDate(t.getDate() + (pc.weeks || 4) * 7); return dayKey(t.getTime() + 4 * 3600000); })() } : pc);
const curL = () => { const L = A.settings.lists || []; return L.find(l => l.id === A.settings.curList) || L[0] || null; };
const myIds = () => (curL() ? curL().ids : []);
const myName = () => (curL() ? curL().name : '내 단어');
function syncMy() { IX.myList = myIds(); IX.myOrder = curL() ? curL().order : null; delete ORDERS.my; }
function newList(name) {
  const L = A.settings.lists || (A.settings.lists = []);
  let n = L.length + 1; while (L.some(l => l.name === `내 단어 ${n}`)) n++;
  const l = { id: 'L' + Date.now().toString(36), name: name || `내 단어 ${n}`, ids: [], pace: fixPace({ ...DEFAULT_MY_PACE }) };
  L.push(l); A.settings.curList = l.id; syncMy();
  return l;
}
// 공부 계획 화면에서 목록을 바꿔 가며 기간을 고를 때, 목록마다 고른 기간을 기억했다가 저장할 때 한꺼번에 쓴다
function draftKeepMy() { const d = A.draft; if (d && d.scope === 'my' && curL()) (d.myPaces || (d.myPaces = {}))[curL().id] = d.pace; }
function draftLoadMy() { const d = A.draft; if (d && d.scope === 'my' && curL()) d.pace = { ...((d.myPaces && d.myPaces[curL().id]) || curL().pace || fixPace({ ...DEFAULT_MY_PACE })) }; }
function setMyIds(ids) { const l = curL() || newList(); l.ids = ids; syncMy(); }
const orderName = l => { const o = (l && l.order) || { mode: 'rec' }; return (LIST_ORDERS.find(z => z[0] === o.mode) || LIST_ORDERS[0])[1]; };
// 목록 고르기 줄: 목록 칩 + 새 목록 + 이름 바꾸기·지우기
function listBar() {
  const L = A.settings.lists || [];
  const c = curL();
  return `<div class="listbar"><div class="chips">${L.map(l => `<button class="chip${c && l.id === c.id ? ' on' : ''}" data-act="lsel" data-arg="${l.id}">${esc(l.name)} · ${l.ids.length}</button>`).join('')}
    <button class="chip add" data-act="lnew">+ 새 단어장</button></div>
    ${c ? `<div class="listbar-tools">순서: ${orderName(c)} · <button class="link" data-act="lren">이름 바꾸기</button> · <button class="link" data-act="ldel">단어장 지우기</button></div>` : ''}</div>`;
}
const AP = () => A.settings.track === 'syl' && A.settings.syl && sylUnits(A.settings.syl.scope).length
  ? { track: 'syl', scope: A.settings.syl.scope, pace: A.settings.syl.pace }
  : A.settings.track === 'my' && myIds().length
  ? { track: 'my', scope: 'my', pace: fixPace(curL().pace) || fixPace({ ...DEFAULT_MY_PACE }) }
  : { track: 'rec', scope: A.settings.scope, pace: A.settings.pace };
// 오늘 새 단어 양 조절(미리 더 하기 / 오늘은 적게). 그날만 쓴다.
const todayAdj = () => { const a = A.settings.todayAdj; return a && a.day === dayKey(Date.now()) ? a.n : 0; };
// 그룹 먼저·나중에 (계획마다 settings.focus[계획 키] = { first, later })
const focusOf = key => (A.settings.focus || {})[key] || { first: [], later: [] };
const planOrder = () => focusOrder(IX, orderFor(AP().scope), focusOf(trackKey()));
// 오늘 할 일: 철자 카드가 켜져 있으면 철자 카드 복습도 같이 세고(하루 장수 안), 새 철자 카드(하루 10개까지)를 복습 뒤에 붙인다
const spellMode = () => A.settings.spell || 'word';
const plan = (extra = A.extraNew + todayAdj()) => {
  const on = spellMode() !== 'off';
  const st = on && A.spell.size ? new Map([...A.states, ...A.spell]) : A.states;
  const p = planToday(IX, st, { now: Date.now(), retention: A.settings.retention, extraNew: extra, pace: AP().pace, scope: AP().scope, order: planOrder() });
  if (on) {
    const room = Math.max(0, RULES.reviewMax - p.reviews.length);
    const add = spellCandidates(IX, A.states, A.spell, spellMode(), { now: Date.now() }).slice(0, room);
    if (add.length) { p.reviews = [...p.reviews, ...add]; p.minutes += Math.round(add.length * 0.4); p.spellNew = add.length; }
  }
  return p;
};
const saveSettings = () => store.set('settings', A.settings);

// ───────── 그리기 ─────────
function render() {
  const V = { study: viewStudy, end: viewEnd, guide: () => guideHTML(false), pace: viewPace, welcome: viewWelcome, look: viewLook, ready: viewReady, stats: viewStats, qset: viewQuizSet, qrun: viewQuizRun, qres: viewQuizResult, card: viewCard, pickw: viewPick, marks: viewMarks, settings: viewSettingsPage, way: viewWay, syl: viewSyl, history: viewHistory, plan: viewPlan };
  const v = (V[A.view] || viewHome)();
  const nav = NAV_VIEWS.has(A.view) || !V[A.view];
  $app.innerHTML = v + (nav ? bottomNav() : '');
  document.body.classList.toggle('has-nav', nav);
  $app.dataset.view = A.view;
  const ta = $app.querySelector('textarea');
  if (ta && A.editNote) ta.focus();
  const qin = $app.querySelector('input.qin:not([disabled])');
  if (qin) qin.focus({ preventScroll: A.view === 'study' });
}

const KIND = { part: '조각', word: '단어', abbr: '약어' };
const stars = n => '★'.repeat(n);
const partType = t => (t.startsWith('-') ? '접미사' : t.endsWith('-') ? '접두사' : t.includes('/') ? '어근' : '조각');
const koMain = x => (x.ko || []).join(' · ');

// ───────── 아이콘 (선 아이콘, 글자색을 따른다) ─────────
const svg = (d, s = 22) => `<svg aria-hidden="true" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const IC = {
  search: svg('<circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path>', 18),
  gear: svg('<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"></path>'),
  n_home: svg('<path d="M3 11l9-7 9 7"></path><path d="M5 10v10h14V10"></path>'),
  n_qset: svg('<path d="M9 11l2 2 4-4"></path><rect x="4" y="3" width="16" height="18" rx="3"></rect>'),
  n_marks: svg('<path d="M6 3h12v18l-6-4-6 4z"></path>'),
  n_history: svg('<rect x="3" y="4" width="18" height="17" rx="3"></rect><path d="M3 9h18"></path><path d="M8 13h2"></path><path d="M14 13h2"></path><path d="M8 17h2"></path>'),
  n_stats: svg('<path d="M4 20V10"></path><path d="M10 20V4"></path><path d="M16 20v-7"></path><path d="M21 20H3"></path>'),
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
      <h1 class="hero-title">의학용어 ${n}개,<br>하루 15~20분이면 돼요</h1>
      <p class="lead-p">암기 연구에서 효과가 가장 높게 나온 방법만 골라 만들었어요. 읽지 말고 떠올리고, 잊기 직전에 다시 봐요.</p>
    </div>
    <div class="feats">
      <div class="feat"><div class="ic">${IC.bulb}</div><div><b>먼저 떠올리기</b><span>답을 보기 전에 뜻을 떠올려요. 다시 읽기보다 훨씬 오래 남아요.</span></div></div>
      <div class="feat"><div class="ic">${IC.cal}</div><div><b>잊기 직전에 다시</b><span>단어마다 기억을 계산해서 잊기 직전에 다시 보여 줘요. 맞힐수록 간격이 길어져요.</span></div></div>
      <div class="feat"><div class="ic">${IC.parts}</div><div><b>조각으로 풀기</b><span>cardi/o 심장 + -itis 염증 = 심장염. 조각을 알면 처음 보는 단어도 풀려요.</span></div></div>
    </div>
    <details class="cite"><summary>연구 근거 보기</summary><p>공부법 비교 연구(Dunlosky 외, 2013), 스스로 떠올리기와 간격 두고 복습하기 연구, 복습 계산법 FSRS를 바탕으로 했어요. 자세한 내용은 시작한 뒤 "사용법(?)"에 있어요.</p></details>
    <div class="bottom-cta">
      <button class="btn primary big" data-act="toway">시작하기</button>
      <label class="btn ghost">다른 기기에서 쓰던 기록이 있어요<input type="file" accept=".json,application/json" data-act="file" hidden></label>
    </div>
  </section>`;
}

// ───────── 첫 시작 2: 어떻게 공부할까요? ─────────
function viewWay() {
  const opt = (m, icon, t, d, extra = '') => `<button class="way" data-act="waypick" data-arg="${m}"><span class="way-ic">${icon}</span><span><b>${t}</b><small>${d}</small>${extra}</span><span class="way-go">›</span></button>`;
  return `${A.first ? stepTop(1, 'towelcome') : '<header class="top"><h1>공부 방법 바꾸기</h1><button class="btn small" data-act="home">닫기</button></header>'}
  <h1 class="hero-title" style="font-size:26px">어떻게 공부할까요?</h1>
  <p class="lead-p" style="margin:6px 0 16px">언제든 바꿀 수 있어요. 고르면 필요한 것만 물어봐요.</p>
  <div class="ways">
    ${opt('rec', '✨', '추천대로', '앱이 정한 순서로 바로 시작해요. 처음이면 이걸로!', '<em class="badge">가장 쉬움</em>')}
    ${opt('syl', '🏫', '학교 수업 순서로', '강의계획서나 교재 목차를 보면서 수업 순서대로 단원을 눌러요.')}
    ${opt('my', '✏️', '내가 단어 고르기', '단원·중요도·내 공부 기록으로 좁혀 가며 골라요.')}
  </div>`;
}

// ───────── 강의·교재 순서: 단원을 순서대로 누르기 ─────────
function viewSyl() {
  const d = A.draft;
  const sc = d.syl.scope;
  const order = sylUnits(sc);
  const stars = [...scopeStars(sc)];
  const unitCount = id => IX.items.filter(x => x.unit === id && stars.includes(x.star)).length;
  const total = order.length ? scopeSet(IX, sc).size : 0;
  const starCnt = n => IX.items.filter(x => x.star === n && (!order.length || order.includes(x.unit))).length;
  const chosen = order.map((id, i) => { const u = IX.units.find(z => z.id === id); return `<li><span class="num">${i + 1}</span><span class="nm">${esc(u.short)} <small>${unitCount(id)}개</small></span>
      <button class="icon-btn" data-act="sylmove" data-arg="${i}:-1" aria-label="위로"${i ? '' : ' disabled'}>↑</button><button class="icon-btn" data-act="sylmove" data-arg="${i}:1" aria-label="아래로"${i < order.length - 1 ? '' : ' disabled'}>↓</button><button class="icon-btn" data-act="syltap" data-arg="${id}" aria-label="빼기">✕</button></li>`; }).join('');
  const rest = IX.units.filter(u => !order.includes(u.id)).map(u => `<button class="chip" data-act="syltap" data-arg="${u.id}">+ ${esc(u.short)} <small>${unitCount(u.id)}</small></button>`).join('');
  return `${A.first ? stepTop(1, 'toway') : '<header class="top"><h1>학교 수업 순서</h1><button class="btn small" data-act="sylback">뒤로</button></header>'}
  <h1 class="hero-title" style="font-size:24px">수업 순서대로 단원을 눌러요</h1>
  <p class="lead-p" style="margin:6px 0 14px">강의계획서나 교재 목차를 보면서 첫 수업 단원부터 차례로 누르세요. 안 배우는 단원은 누르지 않으면 빠져요.</p>
  <section class="panel"><div class="row-between"><h2>공부 순서</h2><span class="sub">${order.length}개 단원</span></div>
    ${order.length ? `<ol class="syl-list">${chosen}</ol>` : '<p class="note">아래에서 첫 단원을 눌러 주세요.</p>'}
    ${rest ? `<p class="note" style="margin:12px 0 6px">${order.length ? '다음 단원을 누르세요' : '단원'}</p><div class="chips">${rest}</div>` : ''}
    <div class="row-between" style="margin-top:12px"><button class="link" data-act="sylall">추천 순서대로 모두 넣기</button>${order.length ? '<button class="link" data-act="sylclear">모두 빼기</button>' : ''}</div>
  </section>
  <section class="panel"><h2>중요도 <span class="sub">(여러 개)</span></h2>
    <div class="chips">${[3, 2, 1].map(n => `<button class="chip${stars.includes(n) ? ' on' : ''}" data-act="sylstar" data-arg="${n}">${'★'.repeat(n)} <small>${starCnt(n)}</small></button>`).join('')}</div>
  </section>
  <div class="bottom-cta pace-cta"><div class="pace-res one"><b style="color:var(--deep)">${total}개</b> 단어 · ${order.length}개 단원</div>
    <button class="btn primary big" data-act="sylnext"${order.length ? '' : ' disabled'}>${A.first ? '다음: 언제까지?' : '이 순서로 정하기'}</button></div>`;
}

// ───────── 첫 시작 / 설정: 색과 모양 고르기 ─────────
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
  const S = { ...A.settings, ...AP() };
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
    <p>${S.track === 'my' ? esc(myName()) : scopeLabel(S.scope)} ${info.total.toLocaleString('ko-KR')}개를 ${fmtDate(end, { year: 'numeric', month: 'long', day: 'numeric' })}까지 끝내요</p>
    <div class="rows">
      <div><span>오늘</span><span>새 단어 ${p.fresh.length}개 · 약 ${p.minutes}분</span></div>
      <div><span>순서</span><span>${S.track === 'syl' ? sylUnits(S.scope).slice(0, 3).map(id => esc(IX.units.find(u => u.id === id).short)).join(' → ') + (sylUnits(S.scope).length > 3 ? ' → …' : '') : S.track === 'my' ? `${esc(myName())} · ${orderName(curL())}` : '조각(접두사·접미사)부터, 장별로'}</span></div>
      <div><span>복습</span><span>잊기 직전에 앱이 알아서</span></div>
    </div>
  </section>
  <section class="panel ready-color"><div class="row-between"><b>색</b><span class="sub">마음에 드는 색을 눌러 보세요</span></div>
    <div class="sws">${THEMES.map(x => `<button class="sw${x.id === S.theme ? ' on' : ''}" aria-label="${x.name}" data-act="theme" data-arg="${x.id}"><span class="ring"><span class="dot" style="background:${x.pri}"></span></span>${x.name}</button>`).join('')}</div></section>
  <p class="note center" style="margin:-2px 0 12px">글꼴 모양, 영어 설명, 발음 속도 같은 것은 나중에 설정(⚙)에서 바꿀 수 있어요.</p>
  ${tip}
  <div class="bottom-cta"><button class="btn primary big" data-act="finish">첫 공부 시작</button></div>`;
}

// 오늘 새 단어 양 조절: 계획보다 미리 더 하거나, 오늘은 적게
const ADJ = [[-999, '복습만'], [-5, '5개 적게'], [0, '계획대로'], [5, '+5'], [10, '+10'], [20, '+20']];
function adjRow(p) {
  const n = todayAdj();
  const goal = AP().pace.mode === 'goal';
  return `<div class="adj"><div class="chips">${ADJ.map(([v, l]) => `<button class="chip${n === v ? ' on' : ''}" data-act="adj" data-arg="${v}">${l}</button>`).join('')}</div>
    <p class="note">${goal ? '오늘 더 하면 남은 날의 하루 양이 줄고, 적게 하면 남은 날에 나눠져요. 끝나는 날은 그대로예요.' : '오늘만 바뀌어요. 내일은 다시 계획대로예요.'}</p>
  </div>`;
}

// 홈 단어 찾기: 영어·한글 일부로 찾아서 누르면 카드가 열린다
function hsearchHTML() {
  const q = (A.hq || '').trim().toLowerCase();
  if (!q) return '';
  const nq = normKo(q);
  const hits = [];
  for (const x of IX.items) {
    const t = x.t.toLowerCase();
    const sc = t === q ? 0 : t.startsWith(q) ? 1 : x.ko.some(k => normKo(k) === nq) ? 0 : x.ko.some(k => normKo(k).startsWith(nq)) ? 2 : t.includes(q) ? 3 : x.ko.some(k => normKo(k).includes(nq)) || (x.full || '').toLowerCase().includes(q) ? 4 : -1;
    if (sc >= 0) hits.push([sc, x]);
  }
  hits.sort((a, b) => a[0] - b[0] || a[1].t.length - b[1].t.length);
  if (!hits.length) return '<p class="hs-none">찾는 단어가 없어요.</p>';
  return `<ul class="hs-list">${hits.slice(0, 8).map(([, x]) => `<li><button data-act="opencard" data-arg="${esc(x.id)}"><b lang="en">${esc(x.t)}</b><span>${esc(x.ko.join(' · '))}</span><em>${KIND[x.k]}</em></button></li>`).join('')}</ul>${hits.length > 8 ? `<p class="hs-none">${hits.length - 8}개 더 있어요. 더 길게 써 보세요.</p>` : ''}`;
}

// 과정 정보: "16주 과정 · 3주째 · 2월 20일까지(D-112) · 하루 새 단어 15개 · 약 18분" (지금 계획 기준)
function courseInfo() {
  const ap = AP(); const pc = ap.pace;
  const info = paceInfo(IX, A.states, { pace: pc, scope: ap.scope });
  const today = dayKey(Date.now());
  const started = info.total - info.remaining;
  const out = { info, total: info.total, started, startedPct: info.total ? Math.round((started / info.total) * 100) : 0 };
  if (pc.mode === 'goal' && pc.end) {
    const allDays = Math.max(1, daysBetween(pc.start || today, pc.end));
    out.weeks = Math.max(1, Math.round(allDays / 7));
    out.weekNo = Math.min(out.weeks, Math.floor(daysBetween(pc.start || today, today) / 7) + 1);
    out.leftWeeks = Math.max(0, Math.round(info.daysLeft / 7));
    out.line = info.ended ? `${out.weeks}주 과정 · 기간이 지났어요` : `${out.weeks}주 과정 · ${out.weekNo}주째 · ${fmtDate(pc.end)}까지 (D-${info.daysLeft})`;
    out.daily = info.ended ? '하루 50장씩 복습해요' : info.reviewPhase ? '마지막 복습 기간 · 새 단어 없음' : `하루 새 단어 ${info.perDay}개 · 약 ${info.minutes}분`;
  } else {
    out.line = `기간 없이 하루 ${pc.cards || 50}장 · 다 하려면 약 ${info.weeks}주`;
    out.daily = `하루 ${pc.cards || 50}장 · 약 ${info.minutes}분`;
  }
  return out;
}

// ───────── 홈: 오늘 공부할 단어 목록 고르기 (추천 · 학교 수업 · 내 단어 A, B …) ─────────
function planDefs() {
  const out = [{ key: 'rec', track: 'rec', icon: '✨', kind: '추천', name: '추천 단어장', sub: scopeLabel(A.settings.scope) }];
  if (A.settings.syl && sylUnits(A.settings.syl.scope).length) out.push({ key: 'syl', track: 'syl', icon: '🏫', kind: '학교 수업', name: '학교 수업 단어장', sub: `${sylUnits(A.settings.syl.scope).length}개 단원` });
  for (const l of A.settings.lists || []) out.push({ key: 'L:' + l.id, track: 'my', list: l, icon: '✏️', kind: '내 단어장', name: l.name, sub: `${l.ids.length}개` });
  return out;
}
// 잠깐 다른 계획으로 바꿔서 계산하고 되돌린다 (홈 목록의 오늘 할 일·진도)
function withPlan(def, fn) {
  const t = A.settings.track, c = A.settings.curList;
  A.settings.track = def.track; if (def.list) A.settings.curList = def.list.id; syncMy();
  try { return fn(); } finally { A.settings.track = t; A.settings.curList = c; syncMy(); }
}
function viewHome() {
  const st = streak(A.log);
  const inKakao = /KAKAOTALK/i.test(navigator.userAgent);
  const dateLine = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
  const curKey = trackKey();
  const lastH = [...A.history].reverse().find(h => h.key && h.key !== 'other');
  const lastKey = lastH ? lastH.key.replace(':quick', '') : '';
  const defs = planDefs();
  const today0 = defs.find(z => z.key === curKey) || defs[0];
  const cards = planDefs().map(def => {
    if (def.key === today0.key) return '';
    if (def.list && !def.list.ids.length) return `<li><button class="pcard empty" data-act="planopen" data-arg="${esc(def.key)}"><span class="pi">${def.icon}</span><span class="pb"><span class="pk">${def.kind}</span><b>${esc(def.name)}</b><small>아직 단어가 없어요 · 눌러서 고르기</small></span><span class="go">›</span></button></li>`;
    const r = withPlan(def, () => { const p = plan(0 + (def.key === curKey ? A.extraNew + todayAdj() : 0)); const pr = progress(IX, A.states, AP().scope); return { p, pr, c: courseInfo() }; });
    let sess = def.key === (A.sess && A.sess.key) && liveSess(A.sess) ? A.sess : liveSess(A.sessions[def.key]) ? A.sessions[def.key] : null;
    if (sess && !sess.doneCards) sess = null;
    const pct = r.pr.total ? Math.round(((r.pr.mastered + r.pr.long) / r.pr.total) * 100) : 0;
    const todayN = r.p.reviews.length + r.p.fresh.length;
    const line = sess ? `<em class="badge">하던 곳 · ${sess.total}장 중 ${sess.doneCards}장 봤어요</em>` : todayN ? `오늘 복습 ${r.p.reviews.length} · 새 단어 ${r.p.fresh.length} · 약 ${r.p.minutes}분` : '<span class="ok">✓ 오늘 할 일 끝</span>';
    return `<li><button class="pcard" data-act="todaypick" data-arg="${esc(def.key)}">
      <span class="pi">${def.icon}</span>
      <span class="pb"><span class="pk">${def.kind}${def.key === lastKey ? ' · 마지막에 공부함' : ''}</span><b>${esc(def.name)}</b><small>${esc(r.c.line)}</small><small>${esc(def.sub)} · 본 단어 ${r.c.startedPct}% · 외움 ${pct}% · ${esc(r.c.daily)}</small>
        <span class="pbar"><i style="width:${pct}%"></i></span><span class="pt">${line}</span></span>
      <span class="go pick">고르기</span></button></li>`;
  }).join('');
  // 오늘 공부할 목록 (처음엔 마지막에 공부한 목록) — 여기서 바로 시작하거나 이어서
  const tp = today0.list && !today0.list.ids.length ? null : withPlan(today0, () => ({ p: plan(), pr: progress(IX, A.states, AP().scope), c: courseInfo() }));
  const tSess = liveSess(A.sess) && A.sess.key === today0.key ? A.sess : null;
  const tPct = tp && tp.pr.total ? Math.round(((tp.pr.mastered + tp.pr.long) / tp.pr.total) * 100) : 0;
  const tN = tp ? tp.p.reviews.length + tp.p.fresh.length : 0;
  const todayBox = `<section class="hero today-hero">
    <div class="th-top"><span class="th-k">오늘 공부할 단어${today0.key === lastKey ? ' · 마지막에 공부한 단어장' : ''}</span><button class="th-plan" data-act="planopen" data-arg="${esc(today0.key)}">단원·진도 ›</button></div>
    <div class="th-name"><span>${today0.icon}</span><b>${esc(today0.name)}</b></div>
    <span class="th-sub">${tp ? esc(tp.c.line) : ''}</span>
    <span class="th-sub">${esc(today0.sub)} · 본 단어 ${tp ? tp.c.startedPct : 0}% · 외움 ${tPct}% · ${tp ? esc(tp.c.daily) : ''}</span>
    ${tSess && tSess.doneCards ? `<p class="th-line">하던 곳이 있어요 · ${tSess.total}장 중 ${tSess.doneCards}장 봤어요</p><button class="btn primary big" data-act="resume">이어서 하기</button>`
      : tSess ? `<p class="th-line">오늘 할 일 ${tSess.total}장이 준비돼 있어요</p><button class="btn primary big" data-act="resume">오늘 공부 시작</button>`
      : tN ? `<div class="hero-stats"><div><b>${tp.p.reviews.length}</b><span>복습</span></div><div><b>${tp.p.fresh.length}</b><span>새 단어</span></div><div><b>${tp.p.minutes}<small>분</small></b><span>예상 시간</span></div></div><button class="btn primary big" data-act="start">오늘 공부 시작</button>`
      : `<p class="th-line">✓ 오늘 할 일 끝! 더 하려면 새 단어를 넣거나 시험을 봐요.</p><div class="hero-tools"><button class="htool" data-act="more">새 단어 ${RULES.batch}개 더</button><button class="htool" data-act="quizToday">오늘 단어 시험</button></div>`}
  </section>`;
  const days = new Set(A.log.map(e => dayKey(e.t)));
  const today = dayKey(Date.now());
  const dow = (new Date(today + 'T12:00:00').getDay() + 6) % 7;
  const week = ['월', '화', '수', '목', '금', '토', '일'].map((n, i) => { const k = addDays(today, i - dow); const cls = days.has(k) ? 'done' : k === today ? 'today' : ''; return `<div>${n}<i class="${cls}">${days.has(k) ? '✓' : ''}</i></div>`; }).join('');
  return `<header class="top home-top"><div><span class="date">${dateLine}</span><h1>무엇을 공부할까요?</h1></div>
    <div class="top-r">${st ? `<span class="pill">${IC.flame}${st}일 연속</span>` : ''}<button class="icon-round" data-act="guide" aria-label="사용법">${IC.help}</button><button class="icon-round" data-act="settings" aria-label="설정">${IC.gear}</button></div></header>
  ${inKakao ? '<div class="warn">카카오톡 안에서 열렸어요. 여기서 공부하면 기록이 따로 저장돼요. 오른쪽 위 메뉴에서 <b>다른 브라우저로 열기</b>를 눌러 주세요.</div>' : ''}
  <div class="hsearch"><span class="hs-ic">${IC.search}</span><input type="search" data-hsearch placeholder="단어 찾기 (영어·한글, 예: 빈맥, tachy)" value="${esc(A.hq || '')}" autocomplete="off"><div id="hsres">${hsearchHTML()}</div></div>
  ${todayBox}
  ${cards ? `<h2 class="sec-h" style="margin-top:4px">다른 단어장 <small>· 고르면 오늘 공부할 단어장이 바뀌어요. 하던 곳은 따로 기억해요.</small></h2>
  <ul class="plist">${cards}</ul>` : ''}
  <div class="padd">${A.settings.syl && sylUnits(A.settings.syl.scope).length ? '' : '<button class="btn" data-act="planpick" data-arg="new-syl">🏫 학교 수업 단어장 만들기</button>'}<button class="btn" data-act="planpick" data-arg="new-my">✏️ 내 단어장 만들기</button></div>
  <section class="panel"><div class="row-between"><b>이번 주</b><span class="sub">${st ? `${st}일째 이어서 하는 중` : '오늘부터 시작해요'}</span></div><div class="week">${week}</div></section>`;
}

// 홈 맨 위 "지금 공부 ▾": 누르면 계획 목록이 펼쳐지고, 하던 곳이 있는 계획에는 표시가 붙는다
function planSwitcher() {
  const ap = AP();
  const plans = [{ key: 'rec', arg: 'rec', icon: '✨', name: '추천', sub: scopeLabel(A.settings.scope), scope: A.settings.scope }];
  if (A.settings.syl && sylUnits(A.settings.syl.scope).length) plans.push({ key: 'syl', arg: 'syl', icon: '🏫', name: '강의 순서', sub: `${sylUnits(A.settings.syl.scope).length}개 단원`, scope: A.settings.syl.scope });
  for (const l of A.settings.lists || []) if (l.ids.length) plans.push({ key: 'L:' + l.id, arg: 'L:' + l.id, icon: '✏️', name: l.name, sub: `내 단어 ${l.ids.length}개`, list: l });
  const curKey = trackKey();
  const cur = plans.find(z => z.key === curKey) || plans[0];
  const pctOf = z => { let pr; if (z.list) { const keep = IX.myList; IX.myList = z.list.ids; pr = progress(IX, A.states, 'my'); IX.myList = keep; } else pr = progress(IX, A.states, z.scope); return pr.total ? Math.round(((pr.mastered + pr.long) / pr.total) * 100) : 0; };
  const resumeOf = z => liveSess(A.sessions[z.key]) || (A.sess && A.sess.key === z.key && liveSess(A.sess));
  return `<div class="plansw">
    <button class="plansw-cur" data-act="plansheet" aria-expanded="${!!A.planSheet}"><span class="sub">지금 공부</span><b>${cur.icon} ${esc(cur.name)}</b><span class="sub">${esc(cur.sub)}</span><span class="caret">${A.planSheet ? '▲' : '▼'}</span></button>
    ${A.planSheet ? `<div class="plansw-list">${plans.map(z => `<button class="${z.key === cur.key ? 'on' : ''}" data-act="planpick" data-arg="${esc(z.arg)}"><span class="pi">${z.icon}</span><span class="pn"><b>${esc(z.name)}</b><small>${esc(z.sub)} · 익힘 ${pctOf(z)}%</small></span>${resumeOf(z) ? '<em class="badge">하던 곳</em>' : ''}</button>`).join('')}
      <div class="plansw-new">${plans.some(z => z.key === 'syl') ? '' : '<button class="chip" data-act="planpick" data-arg="new-syl">+ 강의 순서 만들기</button>'}<button class="chip" data-act="planpick" data-arg="new-my">+ 새 내 단어 목록</button></div>
    </div>` : ''}
  </div>`;
}

// 화면 맨 아래 고정 메뉴 (홈 · 시험 · 단어 모음 · 현황)
const NAV = [['home', '홈', 'home'], ['qset', '시험', 'quiz'], ['marks', '단어', 'marks'], ['history', '기록', 'history']];
const NAV_VIEWS = new Set(['home', 'plan', 'qset', 'marks', 'stats', 'settings', 'history']);
function bottomNav() {
  const cur = A.view === 'stats' ? 'history' : A.view === 'plan' ? 'home' : A.view;
  return `<nav class="bnav" aria-label="메뉴">${NAV.map(([v, l, act]) => `<button class="${cur === v ? 'on' : ''}" data-act="${act}"${cur === v ? ' aria-current="page"' : ''}>${IC['n_' + v]}<span>${l}</span></button>`).join('')}</nav>`;
}
function viewSettingsPage() {
  return `<header class="top"><h1>설정</h1><button class="btn small" data-act="home">닫기</button></header>${viewSettings()}${viewBackup()}
  <section class="panel"><h2>처음부터 다시 정하기</h2><p class="note">처음 시작 화면으로 돌아가서 공부 방법과 기간을 다시 골라요. 공부 기록·내 단어 목록·아주 중요 표시는 그대로 남아요.</p>
    <button class="btn" style="width:100%;margin-top:10px" data-act="restart">처음 화면으로 돌아가기</button></section>
`;
}

// ───────── 홈 (다음부터 열면 바로 보이는 화면) ─────────
// ───────── 계획 하나 (홈에서 고른 단어 목록): 오늘 할 일 · 진도 · 그룹 먼저/나중에 ─────────
function viewPlan() {
  const S = { ...A.settings, ...AP() };
  const def = planDefs().find(z => z.key === trackKey()) || planDefs()[0];
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
    hero = A.sess.doneCards ? `<p class="big-line">하던 공부가 있어요</p><p class="sub">${A.sess.total}장 중 ${A.sess.doneCards}장 봤어요</p>
      <button class="btn primary big" data-act="resume">이어서 하기</button>` : `<p class="big-line">오늘 할 일 ${A.sess.total}장이 준비돼 있어요</p>
      <button class="btn primary big" data-act="resume">오늘 공부 시작</button>
      <button class="btn ghost" data-act="drop">하던 것 그만두고 새로 시작</button>`;
  } else if (doneToday) {
    hero = `<p class="big-line">오늘 할 일 끝!</p><p class="sub">내일 다시 만나요. 더 하고 싶으면 새 단어를 조금 더 넣을 수 있어요.</p>
      <button class="btn primary big" data-act="quizToday">오늘 공부한 단어로 시험</button>
      <div class="hero-tools">
        <button class="htool" data-act="more">새 단어 ${RULES.batch}개 더</button>
        <button class="htool" data-act="quizTodaySpell">철자 쓰기 연습</button>
        <button class="htool" data-act="pick" data-arg="study">골라서 공부</button>
      </div>`;
  } else {
    hero = `<div class="hero-stats"><div><b>${p.reviews.length}</b><span>복습</span></div><div><b>${p.fresh.length}</b><span>새 단어</span></div><div><b>${p.minutes}<small>분</small></b><span>예상 시간</span></div></div>
      ${p.backlog ? '<p class="note">밀린 복습이 많아서 오늘은 새 단어를 쉬어 가요.</p>' : ''}
      ${p.goal && p.goal.reviewPhase ? '<p class="note">목표일 전 복습만 하는 기간이에요.</p>' : ''}
      ${p.goal && p.goal.ended ? '<p class="note">목표 날짜가 지났어요. 공부 계획에서 새로 정해 보세요.</p>' : ''}
      ${p.dueTotal > p.reviews.length ? `<p class="note">남은 복습 ${p.dueTotal - p.reviews.length}장은 내일로 나눠요.</p>` : ''}
      <button class="btn primary big" data-act="start">오늘 공부 시작</button>
      <div class="hero-tools">
        <button class="htool${A.adjOpen || todayAdj() ? ' on' : ''}" data-act="adjtoggle">오늘 양 바꾸기${todayAdj() ? ' ✓' : ''}</button>
        ${p.dueTotal ? `<button class="htool" data-act="quick">3분만 · 복습 ${Math.min(RULES.quickCards, p.dueTotal)}장</button>` : ''}
        <button class="htool" data-act="pick" data-arg="study">골라서 공부</button>
      </div>
      ${A.adjOpen || todayAdj() ? adjRow(p) : ''}`;
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
  <header class="top plan-top"><button class="back-btn" data-act="home" aria-label="첫 화면으로">${IC.back}<span>처음으로</span></button>
    <div class="pt"><span class="sub">${def.icon} ${esc(def.kind)}</span><h1>${esc(def.name)}</h1></div>
    <button class="link" data-act="pace">기간·범위</button></header>
  <section class="hero">${hero}</section>
  ${courseCard(pr, pct, track)}
  ${groupPanel()}
`;
}

// 계획 화면의 과정 칸: 며칠 과정·몇 주째·진행·하루 양, 남은 기간 바꾸기
function courseCard(pr, pct, track) {
  const c = courseInfo(); const ap = AP();
  const leftNow = c.leftWeeks || 4;
  const w = A.adjW || leftNow;
  const today = dayKey(Date.now());
  const endW = addDays(today, w * 7);
  const prev = paceInfo(IX, A.states, { pace: { mode: 'goal', start: today, end: endW }, scope: ap.scope });
  const doneN = pr.mastered + pr.long;
  return `<section class="panel course">
    <h2>과정</h2>
    <p class="cline">${esc(c.line)}</p>
    ${c.weeks ? `<div class="wkbar" aria-label="${c.weeks}주 중 ${c.weekNo}주째">${Array.from({ length: Math.min(c.weeks, 52) }, (_, i) => `<i class="${i + 1 < c.weekNo ? 'past' : i + 1 === c.weekNo ? 'now' : ''}"></i>`).join('')}</div>` : ''}
    <div class="sumcard" style="margin-top:10px"><div><b>${c.startedPct}%</b><span>본 단어<br>${c.started.toLocaleString('ko-KR')}/${c.total.toLocaleString('ko-KR')}</span></div><div><b>${pct}%</b><span>외운 단어<br>${doneN.toLocaleString('ko-KR')}개</span></div><div><b>${c.info.perDay != null ? c.info.perDay + '개' : (ap.pace.cards || 50) + '장'}</b><span>${c.info.perDay != null ? '하루 새 단어' : '하루 장수'}<br>약 ${c.info.minutes}분</span></div></div>
    ${track}
    <p class="note" style="margin-top:8px">안 본 단어 ${pr.new.toLocaleString('ko-KR')} · 배우는 중 ${pr.learning} · 익힘 ${pr.mastered} · 오래 기억 ${pr.long}</p>
    ${c.info.remaining ? `<details class="adjw"${A.adjW ? ' open' : ''}><summary>남은 단어 ${c.info.remaining.toLocaleString('ko-KR')}개, 기간 바꾸기</summary>
      <div class="stepper"><button class="icon-btn" data-act="adjw" data-arg="${Math.max(1, w - 1)}" aria-label="1주 줄이기">−</button><b>${w}주</b><button class="icon-btn" data-act="adjw" data-arg="${Math.min(52, w + 1)}" aria-label="1주 늘리기">+</button></div>
      <p class="note">→ 하루 새 단어 <b>${prev.perDay}개</b> · 약 ${prev.minutes}분 · ${fmtDate(endW)}까지</p>
      <button class="btn primary" style="width:100%;margin-top:8px" data-act="adjwsave" data-arg="${w}">이렇게 바꾸기</button>
      <p class="note" style="margin-top:6px">지금까지 공부한 기록은 그대로예요. 남은 단어만 새 기간에 나눠요.</p></details>` : '<p class="note">이 단어장의 단어를 다 봤어요. 이제 복습으로 기억을 굳혀요.</p>'}
  </section>`;
}

// 계획 안의 그룹(계통·단원): 진도와 "먼저 하기 / 나중에", 지금 이 그룹만
function groupPanel() {
  const ap = AP(); const key = trackKey(); const fc = focusOf(key);
  const set = scopeSet(IX, ap.scope);
  const order = planOrder();
  const unitsSeen = []; for (const id of order) { const u = IX.get(id).unit; if (!unitsSeen.includes(u) && IX.get(id).k !== 'part') unitsSeen.push(u); }
  for (const id of set) { const u = IX.get(id).unit; if (!unitsSeen.includes(u)) unitsSeen.push(u); }
  const rows = unitsSeen.map(uid => {
    const ids = [...set].filter(id => IX.get(id).unit === uid);
    const seen = ids.filter(id => A.states.has(id)).length;
    const done = ids.filter(id => { const s = A.states.get(id); return s && s.goodDays.size >= RULES.masteredDays; }).length;
    const u = IX.units.find(z => z.id === uid);
    const st = fc.first.includes(uid) ? 'first' : fc.later.includes(uid) ? 'later' : '';
    const all = seen === ids.length;
    return `<li class="${st}"><div class="gtop"><b>${esc(u.short)}</b><span class="sub">${seen}/${ids.length} 봄 · 외움 ${done}</span></div>
      <div class="gbar"><i style="width:${Math.round((done / ids.length) * 100)}%"></i><i class="seen" style="width:${Math.round(((seen - done) / ids.length) * 100)}%"></i></div>
      <div class="gbtn">${all ? '<span class="gdone">✓ 다 봤어요</span>' : `<button class="chip${st === 'first' ? ' on' : ''}" data-act="gfocus" data-arg="first:${uid}">${st === 'first' ? `먼저 ${fc.first.indexOf(uid) + 1}번째` : '이 단원 먼저'}</button><button class="chip${st === 'later' ? ' on' : ''}" data-act="gfocus" data-arg="later:${uid}">${st === 'later' ? '뒤로 미룸' : '뒤로 미루기'}</button>`}
        <button class="chip" data-act="gnow" data-arg="${uid}">지금 공부</button></div></li>`;
  }).join('');
  const firstNames = fc.first.map(u => IX.units.find(z => z.id === u).short);
  return `<section class="panel"><details class="gwrap" data-gwrap${A.gopen ? ' open' : ''}><summary><span><b>단원별 진도 · 순서 바꾸기</b><small>${unitsSeen.length}개 단원${firstNames.length ? ` · 먼저: ${esc(firstNames.join(', '))}` : ''}</small></span></summary>
    <div class="row-between" style="margin-top:8px">${fc.first.length || fc.later.length ? '<button class="link" data-act="gclear">원래 순서로</button>' : '<span></span>'}</div>
    <p class="note">"이 단원 먼저"를 누르면 그 단원부터 새 단어가 나와요. 본 단어는 건너뛰고, 다 보면 다음 단원으로 넘어가요. "뒤로 미루기"는 맨 뒤로 보내요.</p>
    <ul class="glist">${rows}</ul></details></section>`;
}

// 공부 계획 화면: 무엇을(범위) · 얼마나 빨리(하루 장수 또는 날짜)
function viewPace() {
  const d = A.draft;
  const isMy = d.scope === 'my';
  const isSy = isSyl(d.scope);
  const mode = isMy ? 'my' : isSy ? 'syl' : 'rec';
  const today = dayKey(Date.now());
  const stars = new Set(isMy ? [] : [...scopeStars(d.scope)]);
  const units = isMy || isSy ? null : scopeUnits(d.scope);
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
  // 직접 몇 주: 끝나는 날이 오늘부터 딱 N주 뒤면 그 N
  const daysTo = d.pace.mode === 'goal' && d.pace.end ? daysBetween(today, d.pace.end) : 0;
  const cw = d.cw || (custom && daysTo % 7 === 0 ? daysTo / 7 : 6);
  const cwOn = !d.exam && d.pace.mode === 'goal' && (custom || d.cw) && daysTo === cw * 7;
  const cwInfo = goalAt(addDays(today, cw * 7));
  const cwBox = `<div class="opt dur${cwOn ? ' on' : ''}" data-act="dcw" data-arg="${cw}" role="button" tabindex="0"><span class="dot"></span><span class="grow">
      <b>직접 정하기</b>
      <span class="stepper"><button class="icon-btn" data-act="dcw" data-arg="${Math.max(1, cw - 1)}" aria-label="1주 줄이기">−</button><b>${cw}주</b><button class="icon-btn" data-act="dcw" data-arg="${Math.min(52, cw + 1)}" aria-label="1주 늘리기">+</button></span>
      <small>하루 새 단어 ${cwInfo.perDay}개 · 약 ${cwInfo.minutes}분 · ${fmtDate(addDays(today, cw * 7))}까지</small></span></div>`;
  const durOpts = infos.map(({ w, end, info }) => {
    const on = d.pace.mode === 'goal' && d.pace.end === end && !d.cw;
    return `<button class="opt dur${on ? ' on' : ''}" data-act="dweeks" data-arg="${w}" aria-pressed="${on}">
      <span class="dot"></span><span class="grow"><b>${w}주${w === 16 ? ' (한 학기)' : ''}${w === rec ? ' <em class="badge">추천</em>' : ''}</b>
      <small>하루 새 단어 ${info.perDay}개 · 약 ${info.minutes}분 · ${fmtDate(end)}까지</small></span></button>`;
  }).join('');
  const cInfo = custom ? goalAt(d.pace.end) : null;
  const customBox = cwBox + `<div class="opt dur${custom && !cwOn ? ' on' : ''}" data-act="dexam" role="button" tabindex="0"><span class="dot"></span><span class="grow">
      <b>시험 날짜로 정하기</b>${custom && !cwOn ? '' : '<small>누르고 날짜를 고르세요</small>'}
      <label class="datel" style="margin-top:6px"><span class="sub">끝낼 날짜</span><input type="date" data-act="dend" min="${addDays(today, 1)}" value="${custom && !cwOn ? esc(d.pace.end) : ''}"></label>
      ${cInfo && !cwOn ? (cInfo.ended ? '<small class="warn-t">오늘보다 뒤 날짜를 골라 주세요.</small>' : `<small>하루 새 단어 ${cInfo.perDay}개 · 약 ${cInfo.minutes}분 · ${cInfo.daysLeft}일 남음</small>`) : ''}
    </span></div>`;

  const cur = d.pace.mode === 'goal' && d.pace.end ? goalAt(d.pace.end) : null;
  let sum = '';
  if (cur && !cur.ended) {
    sum = `<section class="panel">
    <p class="note">새 단어는 ${cur.newDays}일 동안 넣고, 마지막 ${cur.reviewOnly}일은 복습만 해요. 하루 시간에는 복습이 들어 있어요.</p>
    ${cur.heavy ? `<p class="note warn-t" style="margin-top:6px">하루 40분이 넘어요.${stars.has(3) && stars.size > 1 ? ' <button class="link" data-act="dstaronly">★★★만 먼저</button> 하거나' : ''} 기간을 늘려 보세요.</p>` : ''}
    </section>`;
  } else if (d.pace.mode === 'daily') {
    sum = `<p class="note center">지금은 "하루 ${d.pace.cards}장" 방식이에요. 위에서 기간을 고르면 바뀌어요.</p>`;
  }
  const disabled = !(d.pace.mode === 'daily' || (cur && !cur.ended)) || sel.total === 0;
  // 고르는 동안 늘 보이는 결과 줄 (시작 버튼 바로 위)
  const resLine = cur && !cur.ended
    ? `<div class="pace-res"><div><b>${cur.perDay}개</b><span>하루 새 단어</span></div><div><b>약 ${cur.minutes}분</b><span>하루 공부</span></div><div><b>${fmtDate(d.pace.end)}</b><span>끝나는 날</span></div></div>`
    : d.pace.mode === 'daily' ? `<div class="pace-res one">하루 ${d.pace.cards}장 · 약 ${minutesForCards(d.pace.cards)}분</div>` : '<div class="pace-res one">기간을 골라 주세요</div>';
  return `${A.first ? stepTop(2, 'toway') : '<header class="top"><h1>기간·범위</h1><button class="btn small" data-act="paceclose">닫기</button></header>'}
  ${A.first ? '<h1 class="hero-title" style="font-size:26px;margin-bottom:14px">언제까지 끝낼까요?</h1>' : ''}
  ${isMy && curL() ? `<section class="panel order-line"><div class="row-between"><b>공부 순서: ${orderName(curL())}</b><button class="link" data-act="pick" data-arg="pace">바꾸기</button></div>
    <p class="note" style="margin-top:4px">"${esc(myName())}" 단어장의 순서예요. 단어 고르는 화면 아래에서 바꿔요.</p></section>`
  : A.first ? '' : `<details class="panel order-line"><summary><b>공부 순서: 추천 순서</b></summary>
    <p class="sub" style="margin-top:6px">조각 → 인체 → 계통별(근골격 → 심혈관 → … → 피부) → 약어</p>
    <p class="note" style="margin-top:4px">의학용어 수업에서 가장 흔한 순서예요. 교재 순서로 하려면 "학교 수업 단어장"을 만드세요.</p></details>`}
  ${A.first ? `<section class="panel chosen-way"><div class="row-between"><span><span class="sub">공부 방법</span><br><b>${mode === 'rec' ? '✨ 추천대로' : mode === 'syl' ? '🏫 학교 수업 순서' : '✏️ 내가 고른 단어'}</b> · ${sel.total}개</span><button class="link" data-act="toway">바꾸기</button></div>
    ${mode === 'rec' ? `<details class="scope-more" data-scopemore${A.draft.scopeOpen ? ' open' : ''}><summary>중요도·단원 고르기 (지금: ${esc(scopeLabel(d.scope))})</summary><div class="opts" style="margin-top:8px">${starOpts}</div>
      <details class="units"${units ? ' open' : ''}><summary>단원 고르기${units ? ` (${units.size}개)` : ' (전체)'}</summary><div class="chips" style="margin-top:10px">${unitChips}</div></details></details>`
    : mode === 'syl' ? `<p class="note" style="margin-top:6px">${sylUnits(d.scope).map(id => esc(IX.units.find(u => u.id === id).short)).slice(0, 6).join(' → ')}${sylUnits(d.scope).length > 6 ? ' → …' : ''} <button class="link" data-act="tosyl">순서 고치기</button></p>`
    : `<p class="note" style="margin-top:6px">"${esc(myName())}" ${myIds().length}개 <button class="link" data-act="pick" data-arg="pace">단어 고치기</button></p>`}
  </section>`
  : `<section class="panel"><div class="row-between"><h2>① 무엇을 외울까요?</h2><span class="sub">${sel.total}개${sel.remaining < sel.total ? ` · 남은 ${sel.remaining}` : ''}</span></div>
    <div class="seg seg3" style="margin:8px 0 10px">
      <button class="${mode === 'rec' ? 'on' : ''}" data-act="dscopemode" data-arg="rec"><b>추천</b><small>중요도·단원</small></button>
      <button class="${mode === 'syl' ? 'on' : ''}" data-act="dscopemode" data-arg="syl"><b>학교 수업</b><small>목차대로</small></button>
      <button class="${mode === 'my' ? 'on' : ''}" data-act="dscopemode" data-arg="my"><b>내 단어장</b><small>${(A.settings.lists || []).length}개</small></button>
    </div>
    ${mode === 'my' ? `<p class="note">고른 단어장의 단어만 공부해요. 단어장마다 기간을 따로 정해요. 단어에 필요한 조각은 함께 들어가요.</p>
      ${listBar()}
      <button class="btn" style="width:100%;margin-top:8px" data-act="pick" data-arg="pace">${myIds().length ? `"${esc(myName())}" 단어 고치기` : '단어 고르기'}</button>`
    : mode === 'syl' ? `<p class="note">강의계획서·교재 목차 순서대로 단원을 공부해요.</p>
      <ol class="syl-mini">${sylUnits(d.scope).map(id => `<li>${esc(IX.units.find(u => u.id === id).short)}</li>`).join('')}</ol>
      <button class="btn" style="width:100%;margin-top:8px" data-act="tosyl">단원 순서·중요도 고치기</button>`
    : `<details class="scope-more" open data-scopemore><summary>${esc(scopeLabel(d.scope))} ${sel.total}개 · 중요도·단원 바꾸기</summary>
    <p class="note" style="margin-top:8px">중요도를 고르고, 필요하면 단원을 골라요. 여러 개 고를 수 있어요.</p>
    <div class="opts">${starOpts}</div>
    <details class="units"${units ? ' open' : ''}><summary>단원 고르기${units ? ` (${units.size}개)` : ' (전체)'}</summary><div class="chips" style="margin-top:10px">${unitChips}</div></details></details>`}
  </section>`}
  <section class="panel"><h2>${A.first ? '기간' : '② 며칠 안에 끝낼까요?'}</h2>
    <p class="note">고른 ${sel.remaining}개를 언제까지 다 외울지 정하면 하루 양을 계산해요.</p>
    <div class="opts">${durOpts}${customBox}</div>
  </section>
  ${sum}
  ${A.first ? '' : '<p class="note center">계획을 바꿔도 지금까지 공부한 기록은 그대로예요.</p>'}
  <div class="bottom-cta pace-cta">${resLine}<button class="btn primary big" data-act="savepace"${disabled ? ' disabled' : ''}>${A.first ? '이 계획으로 하기' : '저장'}</button></div>`;
}

// 현황 맨 위: 단어 묶음(전체 · 추천 계획 범위 · 내 단어 목록마다)별 현황
function statSets() {
  const out = [{ id: 'all', name: '전체 단어', ids: IX.items.map(x => x.id) },
    { id: 'rec', name: `추천 단어장 · ${scopeLabel(A.settings.scope)}`, ids: [...scopeSet(IX, A.settings.scope)] }];
  for (const l of A.settings.lists || []) {
    const set = new Set(l.ids);
    for (const id of l.ids) { const x = IX.get(id); if (x && x.k === 'word') for (const f of x.parts || []) if (IX.get('p:' + f)) set.add('p:' + f); }
    out.push({ id: l.id, name: `내 단어장 · ${l.name}`, ids: [...set], list: l });
  }
  return out;
}
function setPanel() {
  const sets = statSets();
  const cur = sets.find(z => z.id === A.statSet) || sets[0];
  const opts = { now: Date.now(), retention: A.settings.retention };
  const sums = new Map(sets.map(z => [z.id, setSummary(IX, A.states, A.log, z.ids, opts)]));
  const r = sums.get(cur.id);
  const pc = n => (r.total ? Math.round((n / r.total) * 100) : 0);
  const ANS = [[1, '모름', 'b1'], [2, '헷갈림', 'b2'], [3, '알 것 같음', 'b3'], [4, '확실히 앎', 'b4'], [0, '아직 안 봄', 'b0']];
  const seenN = r.last[1] + r.last[2] + r.last[3] + r.last[4];
  const maxA = Math.max(1, r.last[1], r.last[2], r.last[3], r.last[4]);
  return `<section class="panel">
    <h2>단어장별 현황</h2>
    <div class="chips" style="margin:6px 0 12px">${sets.map(z => `<button class="chip${z.id === cur.id ? ' on' : ''}" data-act="statset" data-arg="${z.id}">${esc(z.name)}</button>`).join('')}</div>
    <div class="sumcard">
      <div><b>${r.pct}%</b><span>외운 단어</span></div>
      <div><b>${r.started}</b><span>공부한 단어 / ${r.total}</span></div>
      <div><b>${r.today}</b><span>오늘 본 단어</span></div>
    </div>
    <div class="bar" aria-hidden="true" style="margin-top:12px"><i class="s-long" style="width:${pc(r.status.long)}%"></i><i class="s-mastered" style="width:${pc(r.status.mastered)}%"></i><i class="s-learning" style="width:${pc(r.status.learning)}%"></i></div>
    <ul class="legend"><li><i class="s-new"></i>새 단어 ${r.status.new}</li><li><i class="s-learning"></i>배우는 중 ${r.status.learning}</li><li><i class="s-mastered"></i>익힘 ${r.status.mastered}</li><li><i class="s-long"></i>오래 기억 ${r.status.long}</li></ul>
    <h3 class="st-h">마지막에 누른 답</h3>
    ${seenN ? `<div class="ansbars">${ANS.filter(([b]) => b).map(([b, l, c]) => `<div class="ab"><span>${l}</span><div class="abar"><i class="${c}" style="width:${Math.round((r.last[b] / maxA) * 100)}%"></i></div><b>${r.last[b]}</b></div>`).join('')}</div>
    <p class="note" style="margin-top:6px">본 단어 ${seenN}개 중 · 아직 안 본 단어 ${r.last[0]}개</p>` : '<p class="note">아직 이 묶음에서 공부한 단어가 없어요.</p>'}
    <div class="meter-row" style="margin-top:12px"><span>최근 30일 복습 정답률</span><b>${r.actual == null ? '–' : Math.round(r.actual * 100) + '%'}</b></div>
    ${r.started >= 20 ? `<div class="meter-row"><span>지금 기억하고 있을 확률</span><b>${Math.round(r.recall * 100)}%</b></div>` : '<p class="note">20개 넘게 공부하면 기억 확률도 보여 드려요.</p>'}
    <div class="mk-actions" style="margin-top:12px">
      <button class="btn" data-act="statstudy" data-arg="${cur.id}">모름·헷갈림 다시 공부</button>
      <button class="btn" data-act="statquiz" data-arg="${cur.id}">이 묶음으로 시험</button>
      <button class="btn" data-act="marks">단어 모음</button>
    </div>
    ${sets.length > 2 ? `<h3 class="st-h">묶음끼리 비교</h3><table class="cmp"><thead><tr><th>묶음</th><th>단어</th><th>익힘</th><th>모름</th><th>헷갈림</th></tr></thead><tbody>
      ${sets.map(z => { const q = sums.get(z.id); return `<tr class="${z.id === cur.id ? 'on' : ''}" data-act="statset" data-arg="${z.id}"><td>${esc(z.name)}</td><td>${q.total}</td><td>${q.pct}%</td><td>${q.last[1]}</td><td>${q.last[2]}</td></tr>`; }).join('')}
    </tbody></table>` : ''}
  </section>`;
}

// ───────── 기록 탭: 언제 얼마나, 무엇을, 얼마나 잘 ─────────
function viewHistory() {
  const today = dayKey(Date.now());
  const st = dayStats(A.log);
  const w = weekSummary(st, today);
  const streakN = streak(A.log);
  const pc = x => (x == null ? '–' : Math.round(x * 100) + '%');
  const diff = (a, b, unit) => (b ? (a > b ? `<em class="up">▲ 지난주보다 ${a - b}${unit}</em>` : a < b ? `<em class="down">▼ 지난주보다 ${b - a}${unit}</em>` : '<em>지난주와 같아요</em>') : '');
  // 달력
  const month = A.calMonth || today.slice(0, 7);
  const [yy, mm] = month.split('-').map(Number);
  const first = new Date(yy, mm - 1, 1);
  const daysIn = new Date(yy, mm, 0).getDate();
  const pad = (first.getDay() + 6) % 7;
  const lvl = n => (!n ? 0 : n <= 20 ? 1 : n <= 50 ? 2 : n <= 100 ? 3 : 4);
  const sel = A.calDay || today;
  const cells = [...Array(pad).fill('<span></span>'), ...Array.from({ length: daysIn }, (_, i) => {
    const k = `${month}-${String(i + 1).padStart(2, '0')}`; const s = st.get(k);
    return `<button class="cd l${lvl(s && s.cards)}${k === sel ? ' sel' : ''}${k === today ? ' today' : ''}" data-act="calday" data-arg="${k}"${k > today ? ' disabled' : ''} aria-label="${i + 1}일 ${s ? s.cards + '장' : '공부 안 함'}">${i + 1}</button>`;
  })].join('');
  const prevM = (() => { const d = new Date(yy, mm - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
  const nextM = (() => { const d = new Date(yy, mm, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
  // 고른 날
  const ds = st.get(sel);
  const sess = A.history.filter(h => dayKey(h.t0) === sel).sort((a, b) => a.t0 - b.t0);
  const qz = (A.quizzes || []).filter(q => dayKey(q.t) === sel);
  const hm = t => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const dayBox = ds ? `<div class="sumcard"><div><b>${ds.cards}</b><span>본 카드</span></div><div><b>${ds.fresh}</b><span>새 단어</span></div><div><b>${Math.max(1, Math.round(ds.ms / 60000))}분</b><span>공부 시간</span></div></div>
    <p class="note" style="margin-top:8px">처음에 맞힌 비율 ${pc(ds.firstN ? ds.firstOk / ds.firstN : null)} · 모름 ${ds.ans[1]} · 헷갈림 ${ds.ans[2]} · 알 것 같음 ${ds.ans[3]} · 확실히 앎 ${ds.ans[4]}</p>
    ${sess.length ? `<ul class="sesslist">${sess.map(h => `<li><span class="tm">${hm(h.t0)}~${hm(h.t1)}</span><b>${esc(h.label)}</b><span>${h.n}장${h.fresh ? ` · 새 ${h.fresh}` : ''} · 정답 ${pc(h.first ? h.ok / h.first : null)}</span></li>`).join('')}</ul>` : '<p class="note">이 날 무엇을 공부했는지는 기록이 없어요 (예전 기록이거나 다른 기기).</p>'}`
    : '<p class="note">이 날은 공부하지 않았어요.</p>';
  const qBox = qz.length ? `<ul class="sesslist">${qz.map(q => `<li><span class="tm">${hm(q.t)}</span><b>시험 · ${q.mode === 'exam' ? '실전' : '연습'} ${q.n}문항</b><span>${q.pct}점</span></li>`).join('')}</ul>` : '';
  // 최근 30일 그래프: 막대 = 본 카드, 선 = 익힌 단어
  const series = masteredSeries(A.states, today, 30);
  const maxC = Math.max(10, ...series.map(z => (st.get(z.day) || { cards: 0 }).cards));
  const maxM = Math.max(5, ...series.map(z => z.n));
  const W = 300, H = 110;
  const bars = series.map((z, i) => { const c = (st.get(z.day) || { cards: 0 }).cards; const h = Math.round((c / maxC) * (H - 20)); return `<rect x="${i * 10 + 1}" y="${H - h}" width="8" height="${h}" rx="2" class="gb"><title>${z.day} ${c}장</title></rect>`; }).join('');
  const line = series.map((z, i) => `${i * 10 + 5},${H - Math.round((z.n / maxM) * (H - 20)) - 2}`).join(' ');
  const graph = `<svg viewBox="0 0 ${W} ${H}" class="hgraph" role="img" aria-label="최근 30일 본 카드와 익힌 단어">${bars}<polyline points="${line}" class="gl" fill="none"/></svg>
    <div class="glegend"><span><i class="gb"></i>날마다 본 카드 (가장 많은 날 ${maxC}장)</span><span><i class="gl"></i>익힌 단어 누적 (${series[series.length - 1].n}개)</span></div>`;
  return `<header class="top"><h1>공부 기록</h1>${streakN ? `<span class="pill">${IC.flame}${streakN}일 연속</span>` : ''}</header>
  <section class="panel"><h2>이번 주</h2>
    <div class="sumcard"><div><b>${w.thisWeek.days}<small>/7일</small></b><span>공부한 날</span></div><div><b>${w.thisWeek.cards}</b><span>본 카드</span></div><div><b>${w.thisWeek.minutes}분</b><span>공부 시간</span></div></div>
    <div class="wkcmp">${diff(w.thisWeek.cards, w.lastWeek.cards, '장')}<span>정답률 ${pc(w.thisWeek.acc)}</span><span>새 단어 ${w.thisWeek.fresh}개</span></div>
    <p class="note" style="margin-top:6px">최근 30일: ${w.last30.days}일 공부 · 하루 평균 ${w.last30.days ? Math.round(w.last30.cards / w.last30.days) : 0}장 · ${w.last30.days ? Math.round(w.last30.minutes / w.last30.days) : 0}분</p>
  </section>
  <section class="panel"><div class="row-between"><button class="icon-btn" data-act="calmonth" data-arg="${prevM}" aria-label="지난달">‹</button><h2>${yy}년 ${mm}월</h2><button class="icon-btn" data-act="calmonth" data-arg="${nextM}" aria-label="다음 달"${nextM > today.slice(0, 7) ? ' disabled' : ''}>›</button></div>
    <div class="cal"><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span><span>일</span>${cells}</div>
    <div class="cal-legend">적게 <i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i> 많이 · 날짜를 누르면 그날 한 일이 보여요</div>
  </section>
  <section class="panel"><h2>${fmtDate(sel, { month: 'long', day: 'numeric', weekday: 'short' })}${sel === today ? ' (오늘)' : ''}</h2>${dayBox}${qBox}</section>
  <section class="panel"><h2>최근 30일 진도</h2>${graph}</section>
  ${setPanel()}
  <button class="btn" style="width:100%" data-act="stats">자세한 현황 (중요도별·장별·앞으로 7일 복습)</button>`;
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
  return `<header class="top"><h1>자세한 현황</h1><button class="btn small" data-act="history">기록으로</button></header>
  <h2 class="sec-h">전체 단어 기준</h2>
  <section class="panel">
    <h2>얼마나 공부했나</h2>
    <div class="sumcard">
      <div><b>${o.started}</b><span>공부한 단어</span></div>
      <div><b>${done(o.all)}</b><span>외운 단어</span></div>
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
  ${(A.quizzes || []).length ? `<section class="panel"><h2>시험 기록</h2><ul class="qlog">${A.quizzes.slice(-5).reverse().map(r => `<li><span>${new Date(r.t).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })} · ${r.mode === 'exam' ? '실전' : '연습'} ${r.n}문항</span><b>${r.pct}점</b></li>`).join('')}</ul></section>` : ''}
  ${o.sticky.length ? `<section class="panel"><h2>자꾸 틀리는 단어</h2><p class="note">여러 번 틀린 단어예요. 내 암기법을 만들어 보세요.</p>
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
    <div class="set"><span>색</span><div>
      ${THEMES.map(x => `<button class="sw${x.id === s.theme ? ' on' : ''}" aria-label="${x.name}" data-act="theme" data-arg="${x.id}"><span class="ring"><span class="dot" style="background:${x.pri}"></span></span>${x.name}</button>`).join('')}
    </div></div>
    <div class="set"><span>모양</span><div>${LOOKS.map(l => chip('look', l.id, s.look === l.id, l.name)).join('')}</div></div>
    <div class="set"><span>공부 계획</span><div><button class="chip" data-act="toway">공부 방법 바꾸기</button><button class="chip" data-act="pace">범위·기간 바꾸기</button></div></div>
    <div class="set"><span>목표 기억률</span><div>
      ${chip('ret', 0.85, s.retention === 0.85, '85% 여유')}${chip('ret', 0.9, s.retention === 0.9, '90% 기본')}${chip('ret', 0.95, s.retention === 0.95, '95% 시험 주간')}
    </div><p class="note">높일수록 더 자주 복습해요.</p></div>
    <div class="set"><span>철자 카드</span><div>${chip('spell', 'off', spellMode() === 'off', '끄기')}${chip('spell', 'word', spellMode() === 'word', '단어만')}${chip('spell', 'wordabbr', spellMode() === 'wordabbr', '단어+약어')}${chip('spell', 'all', spellMode() === 'all', '조각까지')}</div>
      <p class="note">익힘이 된 단어는 한글을 보고 영어를 직접 쓰는 카드가 복습에 섞여 나와요 (하루 새 철자 카드 10개까지).</p></div>
    <div class="set"><span>영어 설명 (NCLEX 대비)</span><div>${chip('rn', 1, s.rn, '켜기')}${chip('rn', 0, !s.rn, '끄기')}</div></div>
    <div class="set"><span>발음 속도</span><div>${chip('rate', 0.7, s.rate === 0.7, '느리게')}${chip('rate', 0.85, s.rate === 0.85, '보통')}${chip('rate', 1, s.rate === 1, '빠르게')}</div></div>
    <div class="set"><span>이 기기 이름</span><div>${['폰', '태블릿', '컴퓨터', '노트북'].map(x => chip('label', x, s.label === x, x)).join('')}</div>
      <p class="note">백업 파일 이름에 붙어요.</p></div>
  </section>`;
}

// ───────── 학습 화면 ─────────
// 설명 화면에서는 방금 답한 카드를 보여 준다 (답하면 큐에서 빠지므로 따로 들고 있는다)
const shown = () => ((A.phase === 'explain' || A.phase === 'spellfb') && A.held ? A.held : A.sess ? current(A.sess) : null);
function viewStudy() {
  const cur = shown();
  if (!cur) return '';
  if (isSpell(cur.c)) return viewSpell(cur);
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
      <button class="icon-btn flagbtn${isFlag(x.id) ? ' on' : ''}" data-act="flag" data-arg="${esc(x.id)}" title="중요 표시 (F)">${isFlag(x.id) ? '★ 중요' : '☆ 중요'}</button>
    </div>
    ${A.phase === 'front' && isNew ? '<p class="note center">처음 보는 단어예요. 조각으로 뜻을 짐작해 보고 고르세요.</p>' : ''}
  </section>`;

  let side = '', actions = '';
  if (A.phase === 'front') {
    const coach = A.settings.coachSeen ? '' : `<div class="coach-row" aria-hidden="true"><span>전혀 안 떠올라요</span><span>비슷한 말과 섞여요</span><span>조금 생각하면 떠올라요</span><span>바로 떠올라요</span></div>
      <p class="coach-ok">3·4를 누르면 정답을 보고 맞았는지 한 번 더 물어요 · <button class="link" data-act="coachok">알겠어요</button></p>`;
    actions = `${coach}<div class="grades">
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
    actions = `<div class="checks one"><button class="btn primary big" data-act="next">다음 <small>Space</small></button></div>`;
  }
  return `<div class="studybar"><div class="progress"><i style="width:${pct}%"></i></div>
    <div class="studyhead"><span>${Math.min(s.doneCards + (cur.c in s.first ? 0 : 1), s.total)} / ${s.total}</span>${s.label ? `<span class="studying" title="지금 공부 중">${esc(s.label)}</span>` : ''}
    <button class="close" data-act="toplan" aria-label="그만하기 (하던 곳은 기억해요)">✕</button></div></div>
    <div class="study ${A.phase}">${face}${side}</div>
    <footer class="actions">${actions}</footer>`;
}

// ───────── 철자 카드: 한글 뜻을 보고 영어를 직접 쓴다 (앱이 채점) ─────────
// 정확히 맞음 → 보통(3), 힌트 보고 맞음 → 어려움(2), 틀림(한 글자라도) → 다시(1). 틀리면 정답을 한 번 따라 써야 넘어간다.
function spellDiff(given, target) {
  const a = normEn(given), b = target;
  const bn = normEn(b);
  // 정답 글자 중 쓴 글자와 맞춘(최장 공통 부분열) 것은 그대로, 빠지거나 틀린 것은 표시
  const m = a.length, n = bn.length, L = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = a[i] === bn[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const keep = new Set(); let i = 0, j = 0;
  while (i < m && j < n) { if (a[i] === bn[j]) { keep.add(j); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++; }
  let k = 0; let out = '';
  for (const ch of b) { if (/[\s\-\/\.'’,()]/.test(ch)) { out += esc(ch); continue; } out += keep.has(k) ? esc(ch) : `<mark>${esc(ch)}</mark>`; k++; }
  return out;
}
function viewSpell(cur) {
  const x = IX.get(spellBase(cur.c));
  if (!x) return '';
  const s = A.sess;
  const pct = s.total ? Math.min(100, (s.doneCards / s.total) * 100) : 100;
  const unit = IX.unitOf.get(x.id);
  const ask = x.k === 'abbr' ? '약어로 쓰세요' : x.k === 'part' ? '조각(어근·접두사·접미사)으로 쓰세요' : '영어로 쓰세요';
  const hint = x.k === 'word' && (x.parts || []).length ? x.parts.map(esc).join(' + ') : `${esc(x.t[0])}${'·'.repeat(Math.max(0, normEn(x.t).length - 1))} (${normEn(x.t).length}글자)`;
  const R = A.spellRes;
  const tag = cur.kind === 'again' || cur.kind === 'final' ? '<span class="tag again">다시</span>' : '<span class="tag spell">철자</span>';
  let body, actions;
  if (A.phase !== 'spellfb') {
    body = `<section class="face spellface">
      <div class="meta">${tag}<span>${KIND[x.k]} · ${stars(x.star)} · ${esc(unit.short)}</span></div>
      <div class="ko-big">${esc(koMain(x))}</div>
      ${x.mean ? `<p class="sub center">${rich(x.mean)}</p>` : ''}
      <p class="note center">${ask}</p>
      <input class="qin spellin" data-spell type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" lang="en" enterkeyhint="done" placeholder="여기에 쓰세요">
      <div class="face-tools"><button class="icon-btn" data-act="spellhint">${A.hint ? hint : '힌트 보기'}</button></div>
    </section>`;
    actions = `<div class="checks"><button class="btn no" data-act="spellgive">모르겠어요</button><button class="btn yes" data-act="spellcheck">확인 <small>Enter</small></button></div>`;
  } else {
    const ok = R && R.ok;
    body = `<section class="face spellface">
      <div class="meta">${tag}<span>${esc(koMain(x))}</span></div>
      <p class="spellres ${ok ? 'good' : 'bad'}">${ok ? (R.hint ? '맞았어요 (힌트 봄)' : '맞았어요!') : R.given ? (R.near ? '아까워요, 한 글자 달라요' : '틀렸어요') : '정답이에요'}</p>
      <div class="word" lang="en">${ok ? esc(x.t) : spellDiff(R.given || '', x.t)}</div>
      ${!ok && R.given ? `<p class="sub center">내가 쓴 것: <s lang="en">${esc(R.given)}</s></p>` : ''}
      <div class="face-tools"><button class="icon-btn" data-act="sayid" data-arg="${esc(x.id)}" aria-label="발음 듣기">${IC.sound}</button></div>
      ${partChips(x)}
      ${ok ? '' : `<p class="note center">정답을 한 번 따라 써 보세요</p><input class="qin spellin" data-spellre type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" lang="en" placeholder="${esc(x.t)}">`}
    </section>`;
    actions = `<div class="checks one"><button class="btn primary big" data-act="spellnext" ${ok || A.spellRetyped ? '' : 'disabled'} id="spellnext">${ok || A.spellRetyped ? '다음' : '따라 쓰면 넘어가요'} <small>Enter</small></button></div>`;
  }
  return `<div class="studybar"><div class="progress"><i style="width:${pct}%"></i></div>
    <div class="studyhead"><span>${Math.min(s.doneCards + (cur.c in s.first ? 0 : 1), s.total)} / ${s.total}</span>${s.label ? `<span class="studying">${esc(s.label)}</span>` : ''}
    <button class="close" data-act="toplan" aria-label="그만하기 (하던 곳은 기억해요)">✕</button></div></div>
    <div class="study ${A.phase === 'spellfb' ? 'explain' : 'front'}">${body}</div>
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
  // 헷갈리는 묶음 (한국어·영어가 비슷한 것끼리)
  out.push(groupBlock(x));
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

function groupBlock(x) {
  return (IX.groupsOf.get(x.id) || []).map(g => `<div class="blk group"><h3>헷갈리는 짝 · ${esc(g.t)}</h3>
    <ul class="gtable">${g.ids.map(id => { const y = IX.get(id); return `<li class="${id === x.id ? 'me' : ''}"><b lang="en">${esc(y.t)}</b><span>${esc(y.ko.join(' · '))}</span></li>`; }).join('')}</ul>
    ${g.tip ? `<p class="note">${esc(g.tip)}</p>` : ''}</div>`).join('');
}

// 단어 카드 (시험 중·결과에서 열어 보기)
function cardHTML(x) {
  return `<section class="face" style="min-height:0;padding:16px 18px">
      <div class="meta">${KIND[x.k]} · ${stars(x.star)} · ${esc(IX.unitOf.get(x.id).short)}</div>
      <div class="word" lang="en" style="font-size:32px">${esc(x.t)}</div>
      <div class="face-tools"><button class="icon-btn" data-act="sayid" data-arg="${esc(x.id)}" aria-label="발음 듣기">${IC.sound}</button><button class="icon-btn flagbtn${isFlag(x.id) ? ' on' : ''}" data-act="flag" data-arg="${esc(x.id)}" title="중요 표시 (F)">${isFlag(x.id) ? '★ 중요' : '☆ 중요'}</button></div>
    </section>
    <section class="answer explain">${answerBlock(x, true)}${explainBlock(x)}</section>`;
}
function viewCard() {
  const x = IX.get(A.cardId);
  return `<header class="top"><h1>단어 카드</h1><button class="btn small" data-act="cardclose">닫기</button></header>
  <div class="study explain">${cardHTML(x)}</div>
  <div class="bottom-cta"><button class="btn" data-act="cardreview"${A.cardQueued && A.cardQueued.has(x.id) ? ' disabled' : ''}>${A.cardQueued && A.cardQueued.has(x.id) ? '복습에 넣었어요' : '이 단어 내일 복습에 넣기'}</button>
  <button class="btn primary big" data-act="cardclose">돌아가기</button></div>`;
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
  ${sticky.length ? `<section class="panel"><h2>자꾸 틀리는 단어</h2><p class="sub">여러 번 틀린 단어예요. 내 암기법을 만들어 보거나 조각부터 다시 봐요.</p>
    <ul class="fam">${sticky.map(w => `<li><b lang="en">${esc(w.t)}</b> ${esc(w.ko[0])}</li>`).join('')}</ul>
    <button class="btn" data-act="sticky">자꾸 틀리는 단어 다시 보기</button></section>` : ''}
  <section class="panel endquiz"><h2>오늘 단어로 문제 풀기</h2><p class="note">방금 공부한 단어로 확인해 봐요. 문제 종류는 다음 화면에서 고를 수 있어요.</p>
    <div class="pk-two" style="margin-top:10px"><button class="btn" data-act="quizTodaySpell">철자 쓰기 연습</button><button class="btn primary" data-act="quizToday">오늘 단어 시험</button></div></section>
  <div class="checks one"><button class="btn big" data-act="toplan">끝내기</button></div>`;
}

// ───────── 동작 ─────────
// 하던 공부는 계획마다 따로 기억한다 (kv 'sessions' { 계획 키: 세션 }). 계획을 바꿨다 돌아와도 그 자리부터.
const trackKey = () => { const ap = AP(); return ap.track === 'my' ? 'L:' + (curL() ? curL().id : '') : ap.track; };
const liveSess = x => x && x.day === dayKey(Date.now()) && !isDone(x);
async function saveSession() {
  const live = liveSess(A.sess);
  if (A.sess && A.sess.key) { if (live) A.sessions[A.sess.key] = A.sess; else delete A.sessions[A.sess.key]; }
  for (const k of Object.keys(A.sessions)) if (!liveSess(A.sessions[k])) delete A.sessions[k];
  await store.set('sessions', A.sessions);
  await store.set('session', live ? A.sess : null);
}
// 계획을 바꿀 때: 지금 하던 것은 넣어 두고, 바꾼 계획에서 하던 것을 꺼낸다
async function switchSess() {
  if (A.sess && A.sess.key && liveSess(A.sess)) A.sessions[A.sess.key] = A.sess;
  const k = trackKey();
  A.sess = liveSess(A.sessions[k]) ? A.sessions[k] : null;
  await saveSession();
}

// 지금 무엇을 공부하는지 카드 위에 보여 줄 이름
function planLabel() { const ap = AP(); return ap.track === 'my' ? `내 단어장 · ${myName()}` : ap.track === 'syl' ? `학교 수업 · ${sylUnits(ap.scope).length}개 단원` : `추천 · ${scopeLabel(ap.scope)}`; }
function startSession(p, mode = 'daily', label) {
  if (A.view !== 'study' && A.view !== 'end') A.returnTo = A.view;
  if (A.sess && A.sess.key && liveSess(A.sess)) A.sessions[A.sess.key] = A.sess; // 하던 것은 넣어 둔다
  A.sess = newSession(p, { now: Date.now(), mode });
  if (A.sess) A.sess.key = mode === 'daily' || mode === 'quick' ? trackKey() + (mode === 'quick' ? ':quick' : '') : 'other';
  if (A.sess) A.sess.label = label || (mode === 'quick' ? `3분 복습 · ${planLabel()}` : mode === 'sticky' ? '자꾸 틀리는 단어 다시 보기' : mode === 'pick' ? '골라서 공부' : planLabel());
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
  const cur = current(A.sess);
  const wasFirst = cur && !(cur.c in A.sess.first);
  const wasNew = cur && !A.states.has(cur.c);
  const e = answer(A.sess, b, ok, { now: Date.now(), device: A.settings.device });
  if (!e) return;
  A.log.push(e);
  await store.addLog([e]);
  recompute();
  await noteHistory(e, wasFirst, wasNew);
  await saveSession();
}
// 공부 한 번 요약(무엇을, 언제, 몇 장): 기록 탭에서 "어떤 목록을 언제 공부했는지" 보여 준다
async function noteHistory(e, wasFirst, wasNew) {
  const S = A.sess;
  if (!S.hid) S.hid = `${e.t}|${A.settings.device}`;
  let h = A.history.find(z => z.id === S.hid);
  if (!h) { h = { id: S.hid, t0: e.t, t1: e.t, label: S.label || '공부', key: S.key || '', n: 0, fresh: 0, ok: 0, first: 0 }; A.history.push(h); }
  h.t1 = e.t; h.n++;
  if (wasNew) h.fresh++;
  if (wasFirst) { h.first++; if (ratingOf(e) >= 3) h.ok++; }
  if (A.history.length > 2000) A.history = A.history.slice(-2000);
  await store.set('history', A.history);
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
// 발음: 브라우저 음성(speechSynthesis). 안드로이드 크롬은 cancel() 바로 뒤 speak()를 버리거나,
// 처음엔 음성 목록이 비어 있고, 영어 음성이 없는 폰(삼성 TTS 한국어만 등)에서는 소리가 안 난다. 그래서
// ① 음성 목록을 미리 받아 두고 ② 말하는 중일 때만 멈춘 뒤 잠깐 있다가 말하고 ③ 1.5초 안에 시작을 못 하면 안내한다.
let VOICES = [];
function loadVoices() { try { VOICES = speechSynthesis.getVoices() || []; } catch (e) { VOICES = []; } }
if ('speechSynthesis' in window) { loadVoices(); try { speechSynthesis.addEventListener('voiceschanged', loadVoices); } catch (e) { /* 예전 브라우저 */ } }
const pickVoice = () => {
  const en = VOICES.filter(z => /^en[-_]/i.test(z.lang));
  return en.find(z => /^en[-_]US/i.test(z.lang) && z.localService) || en.find(z => /^en[-_]US/i.test(z.lang)) || en.find(z => z.localService) || en[0] || null;
};
let sayHelpShown = false;
function sayHelp(why) {
  if (sayHelpShown) return; sayHelpShown = true;
  const kakao = /KAKAOTALK/i.test(navigator.userAgent);
  toast(kakao ? '카카오톡 안에서는 발음이 안 나올 수 있어요. 크롬으로 열어 주세요.'
    : why === 'novoice' ? '폰에 영어 음성이 없어요. 설정 → 일반 → 텍스트 음성 변환에서 "Google 음성 인식 및 합성"과 영어(미국) 음성을 받아 주세요.'
    : '소리가 안 나면 미디어 볼륨을 올리고, 설정 → 텍스트 음성 변환(TTS) 엔진을 Google로 바꿔 보세요.', 7000);
}
function sayEn(t) {
  try {
    if (!('speechSynthesis' in window)) { toast('이 브라우저에서는 발음 듣기를 쓸 수 없어요. 크롬이나 사파리로 열어 주세요.'); return; }
    const ss = window.speechSynthesis;
    if (!VOICES.length) loadVoices();
    const u = new SpeechSynthesisUtterance(speakable(t));
    u.lang = 'en-US';
    u.rate = A.settings.rate;
    const v = pickVoice();
    if (v) u.voice = v;
    speaking++;
    let started = false;
    u.onstart = () => { started = true; };
    u.onerror = e => { if (e && (e.error === 'canceled' || e.error === 'interrupted')) return; sayHelp(e && e.error === 'language-unavailable' ? 'novoice' : ''); };
    const go = () => { try { ss.resume(); } catch (e) { /* 없어도 됨 */ } ss.speak(u); };
    if (ss.speaking || ss.pending) { ss.cancel(); setTimeout(go, 80); } else go();
    setTimeout(() => { if (!started && !ss.speaking) sayHelp(VOICES.length && !pickVoice() ? 'novoice' : ''); }, 1500);
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
  drop: async () => { if (A.sess && A.sess.key) delete A.sessions[A.sess.key]; A.sess = null; await saveSession(); render(); },
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
  toway: () => go('way'),
  // 어떻게 공부할까요 → 고른 방법에 필요한 화면으로
  waypick: m => {
    ACT.pace(true);
    const d = A.draft;
    d.mode = m;
    const g16 = pc => (A.first && pc.mode !== 'goal' ? { mode: 'goal', end: addDays(dayKey(Date.now()), 16 * 7) } : { ...pc });
    d.rec.pace = g16(d.rec.pace); d.syl.pace = g16(d.syl.pace); d.my.pace = g16(d.my.pace);
    if (m === 'rec') { d.scope = d.rec.scope; d.pace = { ...d.rec.pace }; go('pace'); }
    else if (m === 'syl') { if (!sylUnits(d.syl.scope).length) d.syl.scope = makeSyl([3, 2, 1], IX.units.map(u => u.id)); d.scope = d.syl.scope; d.pace = { ...d.syl.pace }; d.sylFrom = 'way'; go('syl'); }
    else { d.scope = 'my'; d.pace = { ...d.my.pace }; if (!curL()) newList(); ACT.pick('pace'); }
  },
  syltap: id => {
    const d = A.draft; const o = sylUnits(d.syl.scope);
    const next = o.includes(id) ? o.filter(z => z !== id) : [...o, id];
    d.syl.scope = makeSyl(scopeStars(d.syl.scope), next); render();
  },
  sylmove: arg => {
    const [i, dir] = arg.split(':').map(Number); const d = A.draft; const o = sylUnits(d.syl.scope); const j = i + dir;
    if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; d.syl.scope = makeSyl(scopeStars(d.syl.scope), o); render();
  },
  sylstar: n => {
    const d = A.draft; const st = new Set(scopeStars(d.syl.scope)); n = Number(n);
    if (st.has(n)) { if (st.size === 1) { toast('하나는 골라야 해요'); return; } st.delete(n); } else st.add(n);
    d.syl.scope = makeSyl(st, sylUnits(d.syl.scope)); render();
  },
  sylall: () => { const d = A.draft; d.syl.scope = makeSyl(scopeStars(d.syl.scope), IX.units.map(u => u.id)); render(); },
  sylclear: () => { const d = A.draft; d.syl.scope = makeSyl(scopeStars(d.syl.scope), []); render(); },
  sylnext: () => { const d = A.draft; if (!isSyl(d.scope)) d.pace = { ...d.syl.pace }; d.mode = 'syl'; d.scope = d.syl.scope; go('pace'); },
  sylback: () => go('pace'),
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
  paceclose: () => go(['plan', 'home', 'settings', 'marks'].includes(A.paceFrom) ? A.paceFrom : 'plan'),
  pace: keep => {
    if (A.view !== 'pace' && A.view !== 'pickw' && A.view !== 'syl') A.paceFrom = A.view;
    const ap = AP();
    const sylDefault = { scope: makeSyl([3, 2, 1], []), pace: { mode: 'goal', end: addDays(dayKey(Date.now()), 16 * 7) } };
    A.draft = { mode: ap.track, scope: ap.scope, pace: { ...ap.pace },
      rec: { scope: A.settings.scope, pace: { ...A.settings.pace } }, my: { pace: { ...((curL() && curL().pace) || fixPace({ ...DEFAULT_MY_PACE })) } },
      syl: { ...(A.settings.syl || sylDefault), pace: { ...((A.settings.syl || sylDefault).pace) } } };
    if (keep === true) { if (A.first && A.draft.pace.mode !== 'goal') A.draft.pace = { mode: 'goal', end: addDays(dayKey(Date.now()), 16 * 7) }; return; }
    if (A.first && A.draft.pace.mode !== 'goal') A.draft.pace = { mode: 'goal', end: addDays(dayKey(Date.now()), 16 * 7) };
    go('pace');
  },
  dscope: k => { A.draft.scope = normScope(k); render(); },
  lsel: async id => { draftKeepMy(); A.settings.curList = id; syncMy(); draftLoadMy(); await saveSettings(); if (A.view === 'home') await switchSess(); render(); },
  lnew: async () => {
    const name = (prompt('새 단어장 이름 (예: 중간고사, 교수님 단어)', '') || '').trim();
    draftKeepMy();
    newList(name.slice(0, 20) || undefined);
    draftLoadMy();
    await saveSettings();
    const back = A.view === 'pace' ? 'pace' : A.view === 'qset' ? 'qset' : A.view;
    ACT.pick(back);
  },
  lren: async () => {
    const l = curL(); if (!l) return;
    const name = (prompt('단어장 이름', l.name) || '').trim();
    if (!name) return;
    l.name = name.slice(0, 20); await saveSettings(); render();
  },
  ldel: async () => {
    const l = curL(); if (!l) return;
    if (!confirm(`"${l.name}" 단어장을 지울까요? 공부 기록은 그대로 남아요.`)) return;
    A.settings.lists = A.settings.lists.filter(z => z.id !== l.id);
    A.settings.curList = A.settings.lists[0] ? A.settings.lists[0].id : '';
    if (!A.settings.lists.length && A.settings.track === 'my') A.settings.track = 'rec';
    syncMy(); await saveSettings(); render(); toast('단어장을 지웠어요');
  },
  track: async t => { if (A.settings.track === t) return; A.settings.track = t; await saveSettings(); await switchSess(); render(); toast(`${planLabel()}로 공부해요${A.sess ? ' · 하던 곳부터' : ''}`); },
  // 홈 "지금 공부 ▾": 계획 고르기 (추천 · 강의 순서 · 내 단어 목록마다)
  planpick: async arg => {
    A.planSheet = false;
    if (arg === 'new-syl') { ACT.pace(); ACT.dscopemode('syl'); return; }
    if (arg === 'new-my') {
      const name = (prompt('새 단어장 이름 (예: 중간고사, 교수님 단어)', '') || '').trim();
      ACT.pace(); A.draft.scope = 'my'; A.draft.pace = fixPace({ ...DEFAULT_MY_PACE }); draftKeepMy(); newList(name.slice(0, 20) || undefined); draftLoadMy(); await saveSettings(); ACT.pick('pace'); return;
    }
    if (arg.startsWith('L:')) { A.settings.curList = arg.slice(2); A.settings.track = 'my'; syncMy(); }
    else A.settings.track = arg;
    await saveSettings(); await switchSess(); render();
    toast(`${planLabel()}${A.sess ? ' · 하던 곳부터 이어서' : ''}`);
  },
  plansheet: () => { A.planSheet = !A.planSheet; render(); },
  // 홈에서 단어 목록 하나 고르기 → 그 계획 화면 (하던 곳 기억)
  // 홈에서 오늘 공부할 목록 바꾸기 (화면은 그대로, 위 칸이 바뀐다)
  todaypick: async key => {
    if (key.startsWith('L:')) { A.settings.curList = key.slice(2); A.settings.track = 'my'; syncMy(); } else A.settings.track = key;
    await saveSettings(); await switchSess(); A.extraNew = 0; render(); window.scrollTo({ top: 0, behavior: 'smooth' });
    toast(`오늘은 "${planDefs().find(z => z.key === key).name}"${A.sess ? ' · 하던 곳부터' : ''}`);
  },
  planopen: async key => {
    A.adjW = 0;
    if (key.startsWith('L:')) { A.settings.curList = key.slice(2); A.settings.track = 'my'; syncMy(); if (!myIds().length) { await saveSettings(); ACT.pace(); A.draft.scope = 'my'; A.draft.pace = { ...(curL().pace || fixPace({ ...DEFAULT_MY_PACE })) }; ACT.pick('pace'); return; } }
    else A.settings.track = key;
    await saveSettings(); await switchSess();
    A.view = 'plan'; A.adjOpen = false; render(); window.scrollTo(0, 0);
  },
  // 공부를 닫으면 시작한 화면으로 (계획 화면에서 시작했으면 계획 화면, 단어 모음이면 단어 모음)
  toplan: () => { const to = A.returnTo; A.view = ['plan', 'home', 'marks', 'history', 'qset'].includes(to) ? to : 'plan'; A.phase = 'front'; A.summary = null; render(); window.scrollTo(0, 0); },
  gfocus: async arg => {
    const [kind, uid] = arg.split(':'); const key = trackKey();
    const fc = A.settings.focus || (A.settings.focus = {});
    const f = fc[key] || (fc[key] = { first: [], later: [] });
    const other = kind === 'first' ? 'later' : 'first';
    f[other] = f[other].filter(z => z !== uid);
    f[kind] = f[kind].includes(uid) ? f[kind].filter(z => z !== uid) : [...f[kind], uid];
    await saveSettings(); render();
    toast(kind === 'first' ? (f.first.includes(uid) ? '이 단원부터 새 단어가 나와요' : '먼저 하기를 뺐어요') : (f.later.includes(uid) ? '이 단원은 맨 뒤로 미뤘어요' : '나중에를 뺐어요'));
  },
  adjw: n => { A.adjW = Number(n); render(); },
  // 남은 단어를 n주에: 오늘부터 새 기간 (계획마다)
  adjwsave: async n => {
    n = Number(n); const today = dayKey(Date.now());
    const pc = { mode: 'goal', start: today, end: addDays(today, n * 7) };
    pc.perDay0 = paceInfo(IX, A.states, { pace: pc, scope: AP().scope }).perDay;
    const tr = AP().track;
    if (tr === 'my') curL().pace = pc; else if (tr === 'syl') A.settings.syl.pace = pc; else A.settings.pace = pc;
    A.adjW = 0; await saveSettings(); render();
    toast(`남은 단어를 ${n}주에 나눠요 · 하루 새 단어 ${pc.perDay0}개`);
  },
  gclear: async () => { const fc = A.settings.focus || {}; delete fc[trackKey()]; A.settings.focus = fc; await saveSettings(); render(); },
  gnow: uid => {
    const ap = AP(); const set = scopeSet(IX, ap.scope);
    const order = planOrder().filter(id => IX.get(id).unit === uid || IX.get(id).k === 'part');
    const fresh = pickNew(IX, A.states, RULES.batch * 2, { order: order.filter(id => set.has(id)) }).filter(id => IX.get(id).unit === uid || IX.get(id).k === 'part');
    const p = plan();
    const reviews = p.reviews.filter(id => IX.get(id).unit === uid);
    if (!fresh.length && !reviews.length) { toast('이 단원은 오늘 볼 카드가 없어요. 다 봤거나 아직 복습할 때가 아니에요.'); return; }
    startSession({ day: dayKey(Date.now()), reviews, fresh }, 'pick', `${planLabel()} · ${IX.units.find(u => u.id === uid).short}만`);
  },
  adj: async v => { A.settings.todayAdj = { day: dayKey(Date.now()), n: Number(v) }; await saveSettings(); render(); },
  dcw: n => { n = Math.max(1, Math.min(52, Number(n))); A.draft.cw = n; A.draft.exam = false; A.draft.pace = { mode: 'goal', end: addDays(dayKey(Date.now()), n * 7) }; render(); },
  dexam: () => {
    const d = A.draft;
    const isCustom = d.pace.mode === 'goal' && d.pace.end && ![4, 8, 12, 16].some(w => d.pace.end === addDays(dayKey(Date.now()), w * 7));
    d.cw = 0; d.exam = true;
    if (!isCustom) d.pace = { mode: 'goal', end: addDays(dayKey(Date.now()), 6 * 7) };
    render();
    const inp = $app.querySelector('input[type=date][data-act=dend]');
    if (inp) { inp.focus(); try { inp.showPicker && inp.showPicker(); } catch (e) { /* 일부 브라우저는 막음 */ } }
  },
  dstar: n => {
    const on = new Set([...normScope(A.draft.scope).split('|')[0]].map(Number));
    const units = scopeUnits(A.draft.scope);
    n = Number(n);
    if (on.has(n)) { if (on.size === 1) { toast('하나는 골라야 해요'); return; } on.delete(n); } else on.add(n);
    A.draft.scope = makeScope([...on], units ? [...units] : null);
    render();
  },
  // ① 추천 범위 ↔ 내 단어: 계획이 두 개라서 기간도 따로 기억한다
  // ① 추천 · 강의 순서 · 내 단어: 계획이 셋이라 기간도 따로 기억한다
  dscopemode: m => {
    const d = A.draft;
    const cur = d.scope === 'my' ? 'my' : isSyl(d.scope) ? 'syl' : 'rec';
    if (m === cur) return;
    if (cur === 'my') d.my = { pace: d.pace }; else if (cur === 'syl') d.syl = { scope: d.scope, pace: d.pace }; else d.rec = { scope: d.scope, pace: d.pace };
    if (m === 'my') { d.scope = 'my'; d.pace = { ...d.my.pace }; if (!myIds().length) { if (!curL()) newList(); ACT.pick('pace'); return; } }
    else if (m === 'syl') { d.scope = d.syl.scope; d.pace = { ...d.syl.pace }; if (!sylUnits(d.scope).length) { ACT.tosyl(); return; } }
    else { d.scope = d.rec.scope; d.pace = { ...d.rec.pace }; }
    render();
  },
  tosyl: () => { const d = A.draft; if (isSyl(d.scope)) d.syl.scope = d.scope; go('syl'); },
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
    A.draft.pace = { mode: 'goal', end: dayKey(t.getTime() + 4 * 3600000) }; A.draft.cw = 0; A.draft.exam = false;
    render();
  },
  savepace: async () => {
    const d = A.draft;
    if (d.pace.mode === 'goal') {
      d.pace.start = dayKey(Date.now());
      d.pace.perDay0 = paceInfo(IX, A.states, { pace: d.pace, scope: d.scope }).perDay;
    }
    for (const [id, pc] of Object.entries(d.myPaces || {})) { const l = (A.settings.lists || []).find(z => z.id === id); if (l && pc.mode === 'goal') { pc.start = pc.start || dayKey(Date.now()); } if (l) l.pace = pc; }
    if (d.scope === 'my') { if (curL()) curL().pace = d.pace; A.settings.track = 'my'; }
    else if (isSyl(d.scope)) { A.settings.syl = { scope: d.scope, pace: d.pace }; A.settings.track = 'syl'; }
    else { A.settings.scope = d.scope; A.settings.pace = d.pace; A.settings.track = 'rec'; }
    await saveSettings();
    await switchSess();
    A.draft = null;
    if (A.first) { go('ready'); return; }
    go('plan');
    toast('공부 계획을 정했어요');
  },
  sheet: () => go('settings'),
  restart: () => {
    if (!confirm('처음 화면으로 갈까요? 공부 기록은 그대로 남아요.')) return;
    A.first = true; A.draft = null; go('welcome');
  },
  history: () => go('history'),
  lstudy: async id => { A.settings.curList = id; A.settings.track = 'my'; syncMy(); await saveSettings(); await switchSess(); go('plan'); toast(`${planLabel()}${A.sess ? ' · 하던 곳부터 이어서' : ''}`); },
  ledit: async id => { A.settings.curList = id; syncMy(); await saveSettings(); ACT.pick('marks'); },
  calmonth: m => { A.calMonth = m; render(); },
  calday: d => { A.calDay = d; render(); },
  settings: () => go('settings'),
  statset: id => { A.statSet = id; render(); },
  statstudy: id => {
    const z = statSets().find(q => q.id === id); if (!z) return;
    const marks = answerMarks(A.log); const set = new Set(z.ids);
    const ids = [...marks.values()].filter(m => set.has(m.id) && (m.last === 1 || m.last === 2)).map(m => m.id);
    if (!ids.length) { toast('모름·헷갈림으로 남은 단어가 없어요'); return; }
    startSession({ day: dayKey(Date.now()), reviews: ids, fresh: [] }, 'sticky', `${z.name} · 모름·헷갈림`);
  },
  statquiz: id => {
    const z = statSets().find(q => q.id === id); if (!z) return;
    const ids = z.ids.filter(i => A.states.has(i));
    A.qcfg = { ...(A.qcfg || QDEFAULT()), ranges: ['ids'], ids: ids.length >= 3 ? ids : z.ids, idsLabel: z.name }; delete A.qcfg.range;
    go('qset');
  },
  spellhint: () => { A.hint = true; render(); const i = $app.querySelector('input[data-spell]'); if (i) i.focus(); },
  spellcheck: async () => {
    if (A.phase !== 'front' || A.busy) return;
    const cur = current(A.sess); if (!cur || !isSpell(cur.c)) return;
    const inp = $app.querySelector('input[data-spell]'); const given = inp ? inp.value.trim() : '';
    if (!given) { toast('철자를 써 주세요. 모르면 "모르겠어요"'); return; }
    const x = IX.get(spellBase(cur.c));
    const g = gradeSpell([x.t], given);
    A.spellRes = { given, ok: g.ok, near: g.near, hint: A.hint };
    A.held = { ...cur }; A.spellRetyped = false;
    await record(g.ok ? (A.hint ? 2 : 3) : 1, g.ok && !A.hint ? true : undefined);
    A.phase = 'spellfb'; render();
  },
  spellgive: async () => {
    if (A.phase !== 'front' || A.busy) return;
    const cur = current(A.sess); if (!cur || !isSpell(cur.c)) return;
    A.spellRes = { given: '', ok: false, near: false, hint: A.hint };
    A.held = { ...cur }; A.spellRetyped = false;
    await record(1);
    A.phase = 'spellfb'; render();
  },
  spellnext: () => { if (A.phase === 'spellfb' && (A.spellRes.ok || A.spellRetyped)) { A.spellRes = null; nextCard(); } },
  coachok: async () => { A.settings.coachSeen = true; await saveSettings(); render(); },
  adjtoggle: () => { A.adjOpen = !A.adjOpen; render(); },
  ret: async v => { A.settings.retention = Number(v); await store.set('settings', A.settings); recompute(); render(); },
  spell: async v => { A.settings.spell = v; await saveSettings(); render(); },
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

// ───────── 시험 모드: 설정 → 풀기 → 결과 ─────────
const QUIZ_MAX_LOG = 30;
// 시험 범위: 여러 개를 골라 합친다(cfg.ranges). 각 범위 → 단어 id 묶음
const QRANGES = [
  { g: '오늘', k: 'today', name: '오늘 공부한 단어' },
  { g: '공부 기록', k: 'learned', name: '공부한 단어 전부' },
  { g: '공부 기록', k: 'b1', name: '모름', d: '마지막에 모름·틀림' },
  { g: '공부 기록', k: 'b2', name: '헷갈림', d: '마지막에 헷갈림' },
  { g: '공부 기록', k: 'fails', name: '틀린 적 있음' },
  { g: '시험 기록', k: 'qw', name: '시험에서 틀림' },
  { g: '시험 기록', k: 'qu', name: '시험에서 헷갈렸어요' },
  { g: '철자', k: 'ws', name: '철자에서 틀림', d: '시험 철자 쓰기 + 철자 카드' },
  { g: '철자', k: 'hard', name: '철자가 까다로운 단어', d: 'rrh·phth·pn 같은 단어' },
  { g: '표시·단어장', k: 'flag', name: '★ 중요' },
  { g: '표시·단어장', k: 'my', name: '내 단어장' },
  { g: '표시·단어장', k: 'plan', name: '지금 단어장 전체' },
  { g: '직접', k: 'units', name: '단원 고르기' },
  { g: '직접', k: 'ids', name: '직접 고른 단어' },
];
function rangeIds(k, cfg) {
  const today = dayKey(Date.now());
  const ids = xs => new Set(xs);
  switch (k) {
    case 'today': return ids(A.log.filter(e => dayKey(e.t) === today).map(e => e.c));
    case 'learned': return ids(A.states.keys());
    case 'b1': case 'b2': return ids(marksList(answerMarks(A.log), Number(k[1]), 'last').map(m => m.id));
    case 'fails': return ids([...A.states.values()].filter(s => s.fails > 0).map(s => s.id));
    case 'qw': return ids(Object.entries(A.qmarks).filter(([, v]) => v.last === 'w').map(([id]) => id));
    case 'qu': return ids(Object.entries(A.qmarks).filter(([, v]) => v.last === 'u').map(([id]) => id));
    case 'ws': return ids([...Object.entries(A.qmarks).filter(([, v]) => v.ws > 0).map(([id]) => id), ...[...A.spell.values()].filter(s => s.fails > 0).map(s => spellBase(s.id))]);
    case 'hard': return ids(IX.items.filter(x => x.k !== 'abbr' && spellHard(x.t) && (cfg.hardAll || A.states.has(x.id))).map(x => x.id));
    case 'flag': return ids(Object.keys(A.flags).filter(isFlag));
    case 'my': return ids(myIds());
    case 'plan': return scopeSet(IX, AP().scope);
    case 'units': return ids(IX.items.filter(x => (cfg.units || []).includes(x.unit)).map(x => x.id));
    case 'ids': return ids(cfg.ids || []);
    case 'wrong': return ids([...A.states.values()].filter(s => s.fails >= 2).map(s => s.id));
  }
  return new Set();
}
const qRanges = cfg => cfg.ranges || (cfg.range ? [cfg.range] : []);
const quizPool = cfg => {
  const all = new Set();
  for (const k of qRanges(cfg)) for (const id of rangeIds(k, cfg)) all.add(id);
  return IX.items.filter(x => all.has(x.id));
};
// 문제 유형 묶음(빠르게 고르기)
const QPRESETS = [
  ['mix', '섞어서 (추천)', ['ko2en', 'pick', 'abbr', 'desc']],
  ['spell', '철자 쓰기만', ['spell']],
  ['write', '쓰기만 (주관식)', ['mean', 'spell', 'abbr']],
  ['mcq', '객관식만', ['ko2en', 'parts', 'pick', 'desc']],
  ['all', '모두', Object.keys(QTYPES)],
];
const QQUICK = [
  { k: 'today', icon: '☀️', name: '오늘 공부한 단어로', desc: '10문제 · 섞어서', empty: '오늘 공부한 단어가 아직 없어요', ranges: ['today'], n: 10 },
  { k: 'weak', icon: '🔁', name: '틀리고 헷갈린 단어로', desc: '20문제 · 섞어서', empty: '아직 틀리거나 헷갈린 단어가 없어요', ranges: ['b1', 'b2', 'qw', 'qu'], n: 20 },
  { k: 'spell', icon: '✍️', name: '철자 연습', desc: '10문제 · 직접 쓰기', empty: '공부한 단어가 더 쌓이면 할 수 있어요', ranges: ['ws', 'hard'], n: 10, types: ['spell'] },
];
const QDEFAULT = () => ({ ranges: [A.states.size >= 10 ? 'learned' : 'plan'], units: [], types: ['ko2en', 'pick', 'abbr', 'desc'], n: 20, mode: 'practice' });

function viewQuizSet() {
  const c = A.qcfg;
  const rs = qRanges(c);
  const groups = [...new Set(QRANGES.map(r => r.g))];
  const rangeOpts = groups.map(g => `<div class="qr-g"><span>${g}</span><div class="chips">${QRANGES.filter(r => r.g === g && (r.k !== 'ids' || c.ids)).map(r => {
    const n = r.k === 'units' && !(c.units || []).length ? '' : ` · ${rangeIds(r.k, c).size}`;
    const name = r.k === 'my' && myIds().length ? `내 단어: ${esc(myName())}` : r.k === 'ids' && c.idsLabel ? esc(c.idsLabel) : r.name;
    return `<button class="chip${rs.includes(r.k) ? ' on' : ''}" data-act="qrange" data-arg="${r.k}" aria-pressed="${rs.includes(r.k)}"${r.d ? ` title="${esc(r.d)}"` : ''}>${name}${n}</button>`;
  }).join('')}</div></div>`).join('');
  const myBtn = rs.includes('my') ? `${listBar()}<button class="btn" style="width:100%;margin-top:6px" data-act="pick" data-arg="qset">${myIds().length ? `"${esc(myName())}" 단어 고치기` : '단어 고르기'}</button>` : '';
  const unitChips = rs.includes('units') ? `<p class="note" style="margin-top:10px">단원</p><div class="chips">${IX.units.map(u => `<button class="chip${c.units.includes(u.id) ? ' on' : ''}" data-act="qunit" data-arg="${u.id}">${u.n}. ${esc(u.short)}</button>`).join('')}</div>` : '';
  const hardNote = rs.includes('hard') ? `<label class="toggle-row" style="margin-top:8px"><span class="sub">아직 안 배운 단어도 넣기</span><input type="checkbox" data-qhardall${c.hardAll ? ' checked' : ''}></label>` : '';
  const presetOn = QPRESETS.find(([, , t]) => t.length === c.types.length && t.every(z => c.types.includes(z)));
  const presets = `<div class="chips" style="margin-bottom:10px">${QPRESETS.map(([k, l, t]) => `<button class="chip${presetOn && presetOn[0] === k ? ' on' : ''}" data-act="qpreset" data-arg="${k}">${l}</button>`).join('')}</div>`;
  const typeOpts = Object.entries(QTYPES).map(([k, t]) => `<button class="opt check${c.types.includes(k) ? ' on' : ''}" data-act="qtype" data-arg="${k}" aria-pressed="${c.types.includes(k)}">
    <span class="dot box"></span><span class="grow"><b>${t.label}</b><small>${t.desc}${t.subj ? ' · 주관식' : ''}</small></span></button>`).join('');
  const pool = quizPool(c).length;
  const recent = (A.quizzes || []).slice(-5).reverse();
  // 바로 시작: 자주 쓰는 3가지
  const quick = QQUICK.map(q => { const n = quizPool({ ...QDEFAULT(), ranges: q.ranges }).length; return `<button class="qq" data-act="qquick" data-arg="${q.k}"${n < 3 ? ' disabled' : ''}>
      <span class="qq-ic">${q.icon}</span><span class="qq-b"><b>${q.name}</b><small>${n < 3 ? q.empty : `${q.desc} · 단어 ${n.toLocaleString('ko-KR')}개`}</small></span><span class="qq-go">${n < 3 ? '' : '시작 ›'}</span></button>`; }).join('');
  const custom = A.qcustom || !!c.ids;
  return `<header class="top"><h1>시험</h1></header>
  <section class="panel"><h2>바로 시작</h2><p class="note">누르면 바로 시작해요. 한 문제씩 바로 채점하는 연습 방식이에요.</p><div class="qqs">${quick}</div></section>
  <details class="qcustom" data-qcustom${custom ? ' open' : ''}><summary>직접 정하기 <small>범위 · 문제 유형 · 문항 수 · 실전 모드</small></summary>
  <section class="panel"><div class="row-between"><h2>어떤 단어로?</h2><span class="sub">여러 개 고르면 합쳐요 · ${pool}개</span></div>
    <div class="qr">${rangeOpts}</div>${unitChips}${myBtn}${hardNote}
    <button class="btn" style="width:100%;margin-top:10px" data-act="pick" data-arg="quiz">단어 직접 골라서 시험</button></section>
  <section class="panel"><h2>어떤 문제로?</h2>${presets}
    <details class="qtypes"${presetOn ? '' : ' open'}><summary>문제 유형 하나씩 고르기</summary><div class="opts" style="margin-top:8px">${typeOpts}</div></details></section>
  <section class="panel"><h2>문항 수</h2><div class="chips">${[10, 20, 35, 50].map(n => `<button class="chip${c.n === n ? ' on' : ''}" data-act="qn" data-arg="${n}">${n}문항</button>`).join('')}</div>
    <h2 style="margin-top:14px">방식</h2>
    <div class="seg">
      <button class="${c.mode === 'practice' ? 'on' : ''}" data-act="qmode" data-arg="practice"><b>연습</b><small>한 문제씩 바로 채점</small></button>
      <button class="${c.mode === 'exam' ? 'on' : ''}" data-act="qmode" data-arg="exam"><b>실전</b><small>제한 시간 · 끝나고 채점</small></button>
    </div>
    ${c.mode === 'exam' ? `<p class="note" style="margin-top:8px">제한 시간 ${Math.ceil(Math.min(c.n, pool) * 40 / 60)}분 (문항당 40초)</p>` : ''}
  </section>
  <div class="bottom-cta"><button class="btn primary big" data-act="qstart"${pool < 3 || !c.types.length ? ' disabled' : ''}>${pool < 3 ? '범위에 단어가 너무 적어요' : `이대로 시작 · ${Math.min(c.n, pool)}문항`}</button></div>
  </details>
  ${recent.length ? `<section class="panel"><h2>지난 시험</h2><ul class="qlog">${recent.map(r => `<li><span>${new Date(r.t).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })} · ${r.mode === 'exam' ? '실전' : '연습'} ${r.n}문항</span><b>${r.pct}점</b></li>`).join('')}</ul></section>` : ''}`;
}

const qCur = () => A.q.qs[A.q.i];
const circled = i => '①②③④⑤'[i] || (i + 1) + '.';

function viewQuizRun() {
  const Q = A.q, q = qCur();
  const x = IX.get(q.id);
  const fb = Q.phase === 'fb' ? Q.answers[Q.i] : null;
  const t = QTYPES[q.type];
  let body;
  if (q.options) {
    body = `<div class="qopts">${q.options.map((o, i) => {
      let cls = '';
      if (fb) cls = o === q.answer ? ' right' : o === fb.given ? ' wrong' : ' dim';
      return `<button class="qopt${cls}" data-act="qpick" data-arg="${i}"${fb ? ' disabled' : ''}><span class="no">${circled(i)}</span><span lang="${q.type === 'desc' || q.type === 'ko2en' ? 'en' : 'ko'}">${esc(o)}</span></button>`;
    }).join('')}</div>`;
  } else {
    const en = q.type !== 'mean';
    body = `<form class="qform" data-act="qsubmit">
      <input class="qin" type="text" ${en ? 'lang="en" autocapitalize="off"' : ''} autocomplete="off" autocorrect="off" spellcheck="false" placeholder="${en ? '영어로 쓰기' : '한글로 쓰기'}" value="${fb ? esc(fb.given) : ''}"${fb ? ' disabled' : ''}>
      ${fb ? '' : `<div class="row-between">${q.hint ? `<button type="button" class="link" data-act="qhint">${Q.hint ? esc(q.hint) : '힌트 보기'}</button>` : '<span></span>'}<button type="submit" class="btn primary">제출</button></div>`}
    </form>`;
  }
  let fbBox = '';
  if (fb) {
    const traps = (q.traps || []).filter(o => o !== q.answer);
    const showCard = !fb.ok || fb.unsure || Q.showCard;
    fbBox = `<section class="qfb ${fb.ok && !fb.unsure ? 'ok' : 'no'}">
      <b class="verdict">${fb.ok ? (fb.unsure ? '맞혔지만 헷갈렸어요 → 다시 볼 단어에 넣었어요' : '정답이에요') : fb.empty ? '모르고 넘어갔어요' : fb.near ? '아까워요, 한두 글자 차이예요' : '틀렸어요'}</b>
      <p><span class="sub">정답</span> <b lang="en">${esc(q.answer)}</b>${q.alt && q.alt.length ? ` <span class="sub">(${esc(q.alt.join(', '))}도 정답)</span>` : ''}</p>
      ${traps.length ? `<p class="sub">철자 함정: <span lang="en">${traps.map(esc).join(', ')}</span></p>` : ''}
      ${fb.ok && !fb.unsure ? `<div class="qfb-btns"><button class="btn small" data-act="qunsure">헷갈렸어요</button><button class="btn small" data-act="qcard">${Q.showCard ? '카드 접기' : '단어 카드 보기'}</button></div>` : ''}
    </section>
    ${showCard ? `<div class="study explain qcardbox">${cardHTML(x)}</div>` : ''}`;
  }
  const pct = Math.round((Q.i / Q.qs.length) * 100);
  return `<div class="studybar"><div class="progress"><i style="width:${pct}%"></i></div>
    <div class="studyhead"><span>${Q.i + 1} / ${Q.qs.length}${Q.mode === 'exam' ? ` · <b id="qtimer">${fmtLeft()}</b>` : ''}</span>
    <button class="close" data-act="qquit" aria-label="시험 그만두기">✕</button></div></div>
  <section class="answer qcard">
    <div class="meta" style="justify-content:flex-start"><span class="tag">${t.label}</span><span>${esc(IX.unitOf.get(q.id).short)}</span></div>
    <p class="q">${esc(q.ask)}</p>
    <div class="qprompt ${q.type === 'desc' || q.type === 'spell' ? 'ko-prompt' : ''}" ${q.type === 'desc' || q.type === 'spell' ? '' : 'lang="en"'}>${esc(q.prompt)}</div>
    ${q.extra && fb ? `<p class="sub">${esc(q.extra)}</p>` : ''}
    ${body}
  </section>
  ${fbBox}
  ${fb ? `<div class="bottom-cta"><button class="btn primary big" data-act="qnext">${Q.i + 1 < Q.qs.length ? '다음 문제' : '결과 보기'} <small>Enter</small></button></div>` : ''}`;
}

function fmtLeft() {
  const s = Math.max(0, Math.round((A.q.deadline - Date.now()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function viewQuizResult() {
  const Q = A.q;
  const s = summarize(Q.qs, Q.answers);
  const wrong = Q.qs.map((q, i) => ({ q, a: Q.answers[i] })).filter(o => !(o.a && o.a.ok) || (o.a && o.a.unsure));
  const row = (label, v) => `<div class="row-stat"><div class="row-between"><span>${label}</span><span class="sub">${v.ok} / ${v.n}</span></div><div class="bar"><i class="s-long" style="width:${Math.round((v.ok / v.n) * 100)}%"></i></div></div>`;
  const mins = Math.max(1, Math.round((Q.ended - Q.started) / 60000));
  return `<header class="top"><h1>시험 결과</h1></header>
  <section class="panel qscore"><b>${s.pct}<small>점</small></b><span>${s.ok} / ${s.n} 맞힘 · ${mins}분 · ${Q.mode === 'exam' ? '실전' : '연습'}${Q.timeout ? ' · 시간 종료' : ''}</span></section>
  <section class="panel"><h2>유형별</h2>${[...s.byType].map(([k, v]) => row(QTYPES[k].label, v)).join('')}</section>
  <section class="panel"><h2>단원별</h2>${[...s.byUnit].map(([k, v]) => row(esc(IX.units.find(u => u.id === k).short), v)).join('')}</section>
  ${wrong.length ? `<section class="panel"><h2>다시 볼 단어 ${wrong.length}개</h2><p class="note">틀렸거나 헷갈린 단어예요. 누르면 단어 카드가 열려요.</p><ul class="qwrong">${wrong.map(({ q, a }) => {
    const x = IX.get(q.id);
    return `<li><button class="qw" data-act="opencard" data-arg="${esc(x.id)}"><b lang="en">${esc(x.t)}</b> <span>${esc(x.ko.join(' · '))}</span><small>${a && a.ok ? '헷갈림' : '틀림'} · ${esc(QTYPES[q.type].label)} · 내 답: ${a && a.given ? esc(a.given) : '(없음)'} → 정답: ${esc(q.answer)}</small></button></li>`;
  }).join('')}</ul></section>` : '<section class="panel"><p class="big-line">모두 맞혔어요!</p></section>'}
  <section class="panel"><h2>모든 문제</h2><div class="chips">${Q.qs.map((q, i) => { const a = Q.answers[i]; const x = IX.get(q.id); return `<button class="chip ${a && a.ok && !a.unsure ? '' : 'bad'}" data-act="opencard" data-arg="${esc(x.id)}" lang="en">${esc(x.t)}</button>`; }).join('')}</div></section>
  <div class="bottom-cta">
    ${wrong.length ? `<button class="btn primary big" data-act="qtoreview"${Q.reviewed ? ' disabled' : ''}>${Q.reviewed ? '복습에 넣었어요' : `다시 볼 ${wrong.length}개 내일 복습에 넣기`}</button>
    <button class="btn" data-act="qretry">틀린 문제만 다시 풀기</button>` : ''}
    <button class="btn ghost" data-act="home">끝내기</button>
  </div>`;
}

let qTimer = 0;
function startQuiz(items, cfg) {
  const qs = buildQuiz(IX, items, { types: cfg.types, n: cfg.n, seed: Date.now() });
  if (!qs.length) { toast('문제를 만들 수 없어요. 범위나 유형을 바꿔 보세요'); return; }
  const now = Date.now();
  A.q = { qs, i: 0, answers: [], phase: 'ask', mode: cfg.mode, started: now, deadline: now + qs.length * 40000, hint: false, cfg };
  clearInterval(qTimer);
  if (cfg.mode === 'exam') {
    qTimer = setInterval(() => {
      if (A.view !== 'qrun') { clearInterval(qTimer); return; }
      const el = document.getElementById('qtimer');
      if (el) el.textContent = fmtLeft();
      if (Date.now() >= A.q.deadline) { A.q.timeout = true; finishQuiz(); }
    }, 1000);
  }
  go('qrun');
}

async function finishQuiz() {
  clearInterval(qTimer);
  const Q = A.q;
  Q.ended = Date.now();
  const s = summarize(Q.qs, Q.answers);
  A.quizzes = [...(A.quizzes || []), { t: Q.ended, n: s.n, ok: s.ok, pct: s.pct, mode: Q.mode }].slice(-QUIZ_MAX_LOG);
  await store.set('quizzes', A.quizzes);
  // 시험 결과를 단어별로 모은다(단어 모음의 "시험에서 틀림·헷갈렸어요")
  Q.qs.forEach((q, i) => {
    const a = Q.answers[i];
    const m = A.qmarks[q.id] || (A.qmarks[q.id] = { w: 0, u: 0, ok: 0, last: '', t: 0 });
    const r = !a || !a.ok ? 'w' : a.unsure ? 'u' : 'ok';
    m[r]++; m.last = r; m.t = Q.ended;
    if (q.type === 'spell' && r === 'w') m.ws = (m.ws || 0) + 1;
  });
  await store.set('qmarks', A.qmarks);
  go('qres');
}

function answerQuiz(given) {
  const Q = A.q;
  if (Q.phase !== 'ask') return;
  const res = grade(qCur(), given);
  Q.answers[Q.i] = { given, ...res };
  Q.hint = false;
  Q.showCard = false;
  if (Q.mode === 'exam') { nextQuestion(); return; }
  Q.phase = 'fb';
  render();
}
function nextQuestion() {
  const Q = A.q;
  if (Q.i + 1 >= Q.qs.length) { finishQuiz(); return; }
  Q.i++; Q.phase = 'ask';
  render();
  window.scrollTo(0, 0);
}

Object.assign(ACT, {
  quiz: () => {
    A.qcfg = A.qcfg || QDEFAULT();
    go('qset');
  },
  qrange: k => {
    const c = A.qcfg; const rs = qRanges(c);
    c.ranges = rs.includes(k) ? rs.filter(z => z !== k) : [...rs, k]; delete c.range;
    render();
  },
  qpreset: k => { const p = QPRESETS.find(z => z[0] === k); if (p) { A.qcfg.types = [...p[2]]; render(); } },
  // 바로 시작 (설정 화면 거치지 않고)
  qquick: k => {
    const q = QQUICK.find(z => z.k === k); if (!q) return;
    const cfg = { ...QDEFAULT(), ranges: q.ranges, n: q.n, types: q.types || QDEFAULT().types, mode: 'practice' };
    const pool = quizPool(cfg);
    if (pool.length < 3) { toast(q.empty); return; }
    A.qcfg = cfg; startQuiz(pool, cfg);
  },
  quizTodaySpell: () => { const cfg = { ...QDEFAULT(), ranges: ['today'], n: 10, types: ['spell'] }; const pool = quizPool(cfg); if (pool.length < 3) { toast('오늘 공부한 단어가 너무 적어요'); return; } A.qcfg = cfg; startQuiz(pool, cfg); },
  quizToday: () => ACT.qquick('today'),
  qunit: id => { const u = A.qcfg.units; A.qcfg.units = u.includes(id) ? u.filter(z => z !== id) : [...u, id]; render(); },
  qtype: k => { const t = A.qcfg.types; A.qcfg.types = t.includes(k) ? t.filter(z => z !== k) : [...t, k]; render(); },
  qn: n => { A.qcfg.n = Number(n); render(); },
  qmode: m => { A.qcfg.mode = m; render(); },
  qstart: () => startQuiz(quizPool(A.qcfg), A.qcfg),
  qpick: i => answerQuiz(qCur().options[Number(i)]),
  qhint: () => { A.q.hint = true; render(); },
  qnext: () => nextQuestion(),
  qunsure: () => { const a = A.q.answers[A.q.i]; if (a) a.unsure = true; render(); },
  qcard: () => { A.q.showCard = !A.q.showCard; render(); },
  opencard: id => { A.cardId = id; A.cardBack = A.view; go('card'); },
  cardclose: () => go(A.cardBack || 'home'),
  sayid: id => { const x = IX.get(id); if (x) sayEn(x.t); },
  cardreview: async () => {
    const id = A.cardId;
    const e = { t: Date.now(), c: id, b: 1, d: A.settings.device };
    A.log.push(e); await store.addLog([e]); recompute();
    (A.cardQueued = A.cardQueued || new Set()).add(id);
    render(); toast('내일 복습에 넣었어요');
  },
  qquit: () => { clearInterval(qTimer); A.q = null; go('home'); toast('시험을 그만뒀어요'); },
  qtoreview: async () => {
    const Q = A.q;
    if (Q.reviewed) return;
    const now = Date.now();
    const ids = [...new Set(Q.qs.filter((q, i) => !(Q.answers[i] && Q.answers[i].ok) || Q.answers[i].unsure).map(q => q.id))];
    const entries = ids.map((c, i) => ({ t: now + i, c, b: 1, d: A.settings.device }));
    A.log.push(...entries);
    await store.addLog(entries);
    recompute();
    Q.reviewed = true;
    render();
    toast(`틀린 ${ids.length}개를 복습에 넣었어요`);
  },
  qretry: () => {
    const Q = A.q;
    const ids = new Set(Q.qs.filter((q, i) => !(Q.answers[i] && Q.answers[i].ok) || Q.answers[i].unsure).map(q => q.id));
    startQuiz(IX.items.filter(x => ids.has(x.id)), { ...Q.cfg, n: ids.size });
  },
});
document.addEventListener('submit', e => {
  if (!e.target.matches('form[data-act=qsubmit]')) return;
  e.preventDefault();
  const v = e.target.querySelector('input').value;
  answerQuiz(v);
});
document.addEventListener('keydown', e => {
  if (A.view !== 'qrun' || !A.q || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (A.q.phase === 'fb' && (k === 'Enter' || k === ' ')) { e.preventDefault(); nextQuestion(); return; }
  if (A.q.phase === 'ask' && qCur().options && /^[1-5]$/.test(k) && !e.target.closest('input')) { e.preventDefault(); ACT.qpick(Number(k) - 1); }
});

// ───────── 단어 고르기: 위에서부터 한 단계씩 좁혀 가기 (src/funnel.js) ─────────
// ① 어디서 → ② 중요도 → ③ 종류 → ④ 계통 → ⑤ 헷갈리는 용어 → 결과(처음엔 전부 체크, 빼고 싶은 것만 풀기)
const PK_BASE = () => ({ src: 'all', ans: '', star: '', kind: '', units: [], conf: 'off', grp: -1, mates: false });
function pkCtx() { if (!A.pk._ctx) A.pk._ctx = { states: A.states, marks: answerMarks(A.log), listIds: A.pk.study ? [] : myIds() }; return A.pk._ctx; }
function pkRun() { return runFunnel(IX, pkCtx(), A.pk.f); }
function pkSelected() {
  const k = A.pk; const ids = new Set(pkRun().result.map(x => x.id));
  for (const id of k.extra) ids.add(id);
  for (const id of k.excl) ids.delete(id);
  return ids;
}
function pkVisible() {
  const k = A.pk; const q = (k.q || '').trim().toLowerCase();
  const res = pkRun().result.slice();
  const have = new Set(res.map(x => x.id));
  for (const id of k.extra) if (!have.has(id)) { const x = IX.get(id); if (x) res.push(x); }
  if (!q) return res;
  const nq = normKo(q);
  return res.filter(x => x.t.toLowerCase().includes(q) || x.ko.some(z => normKo(z).includes(nq)) || (x.full || '').toLowerCase().includes(q));
}
function pkCountText() {
  const sel = pkSelected();
  const c = { part: 0, word: 0, abbr: 0 };
  for (const id of sel) { const x = IX.get(id); if (x) c[x.k]++; }
  return `<b>${sel.size}개</b> 골랐어요 <small>(조각 ${c.part} · 단어 ${c.word} · 약어 ${c.abbr})</small>`;
}
function pkListHTML() {
  const k = A.pk;
  const list = pkVisible();
  if (!list.length) return `<p class="note center" style="padding:16px">남은 단어가 없어요. 위에서 고른 것을 조금 풀어 보세요.</p>`;
  const byUnit = new Map();
  for (const x of list) { if (!byUnit.has(x.unit)) byUnit.set(x.unit, []); byUnit.get(x.unit).push(x); }
  const big = list.length > 120 && !k.q;
  return `<div class="row-between pk-bulk"><span class="sub">${k.q ? `찾은 단어 ${list.length}개` : `남은 단어 ${list.length}개 · 처음엔 모두 체크돼 있어요`}</span>
      <span><button class="link" data-act="pkall" data-arg="1">모두 체크</button> · <button class="link" data-act="pkall" data-arg="0">모두 해제</button></span></div>` +
    [...byUnit].map(([uid, xs]) => {
      const u = IX.units.find(z => z.id === uid);
      const on = xs.filter(x => !k.excl.has(x.id)).length;
      return `<details class="pk-unit"${!big || k.open.has(uid) ? ' open' : ''} data-unit="${uid}">
        <summary><span><b>${u.n}. ${esc(u.short)}</b> <span class="sub">${on} / ${xs.length}</span></span>
          <button class="chip${on === xs.length ? ' on' : ''}" data-act="pkunit" data-arg="${uid}">${on === xs.length ? '모두 해제' : '모두 체크'}</button></summary>
        <ul class="pk-list">${xs.map(x => `<li><label><input type="checkbox" data-pk="${esc(x.id)}"${k.excl.has(x.id) ? '' : ' checked'}>
          <b lang="en">${esc(x.t)}</b><span>${esc(x.ko.join(' · '))}</span><em>${'★'.repeat(x.star)}</em></label></li>`).join('')}</ul>
      </details>`;
    }).join('');
}
function viewPick() {
  const k = A.pk, f = k.f, ctx = pkCtx();
  const { sets } = pkRun();
  const n = i => sets[i].length;
  const cnt = (step, patch) => countIf(IX, ctx, f, step, patch);
  const studiedN = cnt(0, { src: 'studied', ans: '' });
  const listMode = !k.study && myIds().length;
  // ① 어디서
  const src = [['all', '전체 단어', '1,500개 모두에서'], ['studied', '내가 공부한 단어 중에서 선택', '공부할 때 누른 답으로 골라요'], ['new', '아직 안 본 단어만', '새로 배울 단어'], ...(listMode ? [['list', `지금 목록 "${esc(myName())}" 안에서`, '목록에서 뺄 단어를 고를 때']] : [])];
  const srcOpts = src.map(([v, l, d]) => {
    const c = cnt(0, { src: v, ans: v === 'studied' ? f.ans : '' }); const dis = v === 'studied' && !studiedN;
    return `<button class="opt${f.src === v ? ' on' : ''}" data-act="pksrc" data-arg="${v}"${dis ? ' disabled' : ''}><span class="dot"></span><span class="grow"><b>${l} <span class="cnt">${dis ? 0 : c}</span></b><small>${dis ? '공부를 시작하면 쓸 수 있어요' : d}</small></span></button>`;
  }).join('');
  const ANS = [['1', '모름'], ['2', '헷갈림'], ['3', '알 것 같음'], ['4', '확실히 앎'], ['w', '틀린 적 있음']];
  const ansRow = f.src === 'studied' ? `<div class="sub-step"><p class="note">마지막에 누른 답 (여러 개 고르기, 안 고르면 공부한 단어 전부)</p>
    <div class="chips">${ANS.map(([v, l]) => `<button class="chip${f.ans.includes(v) ? ' on' : ''}" data-act="pkans" data-arg="${v}">${l} <span class="cnt">${cnt(0, { ans: v })}</span></button>`).join('')}</div></div>` : '';
  const multi = (step, key, items) => items.map(([v, l]) => { const c = cnt(step, { [key]: v }); const on = (f[key] || '').includes(v); return `<button class="chip${on ? ' on' : ''}" data-act="pkmulti" data-arg="${key}:${v}"${c || on ? '' : ' disabled'}>${l} <span class="cnt">${c}</span></button>`; }).join('');
  const unitChips = IX.units.map(u => { const c = cnt(3, { units: [u.id] }); const on = f.units.includes(u.id); return `<button class="chip${on ? ' on' : ''}" data-act="pkunitf" data-arg="${u.id}"${c || on ? '' : ' disabled'}>${esc(u.short)} <span class="cnt">${c}</span></button>`; }).join('');
  const grps = groupsIn(IX, sets[4]);
  const confOpts = [['off', '거르지 않음', n(4)], ['has', '헷갈리는 짝이 있는 단어만', cnt(4, { conf: 'has', mates: false })], ['grp', '묶음 하나 골라 보기', grps.length + '묶음']]
    .map(([v, l, c]) => `<button class="opt${f.conf === v ? ' on' : ''}" data-act="pkconf" data-arg="${v}"><span class="dot"></span><span class="grow"><b>${l} <span class="cnt">${c}</span></b></span></button>`).join('');
  const grpSel = f.conf === 'grp' ? `<select class="pk-grp" data-pkgrp><option value="-1">묶음을 고르세요</option>${grps.map(g => `<option value="${g.i}"${f.grp === g.i ? ' selected' : ''}>${esc(g.t)} (${g.n})</option>`).join('')}</select>` : '';
  const matesN = cnt(4, { mates: true });
  const step = (no, title, body, hint = '') => `<section class="panel fstep"><div class="row-between"><h2><span class="sn">${no}</span>${title}</h2><span class="left">남은 <b>${n(no)}</b>개</span></div>${hint}${body}</section>`;
  const title = k.quiz ? '골라서 시험' : k.study ? '골라서 공부' : `${esc(myName())} · 단어 고르기`;
  const btns = k.study
    ? `<div class="pk-two"><button class="btn" data-act="pkaddmy">내 단어에 더하기</button>${k.quiz ? '<button class="btn primary big" data-act="pkquiz">이 단어로 시험</button>' : '<button class="btn primary big" data-act="pkstudy">지금 공부</button>'}</div>`
    : listMode ? `<div class="pk-two"><button class="btn" data-act="pksave" data-arg="add">단어장에 더하기</button><button class="btn primary big" data-act="pksave" data-arg="replace">이걸로 바꾸기</button></div>`
    : `<button class="btn primary big" data-act="pksave" data-arg="replace">이 단어로 단어장 만들기</button>`;
  return `<header class="top"><h1>${title}</h1><button class="btn small" data-act="pkcancel">취소</button></header>
  <div class="fbar" aria-label="단계마다 남은 단어">${[0, 1, 2, 3, 4, 5].map(i => `<span><b>${n(i)}</b><small>${i ? STEPS[i - 1].name : '전체'}</small></span>`).join('<i>›</i>')}</div>
  <p class="note" style="margin:2px 2px 10px">위에서부터 차례로 고르면 단어가 좁혀져요. 안 고른 단계는 건너뛰어요.${listMode ? ` 지금 "${esc(myName())}"에는 ${myIds().length}개가 있어요.` : ''}</p>
  ${step(1, '어디서 고를까요?', `<div class="opts">${srcOpts}</div>${ansRow}`)}
  ${step(2, '중요도', `<div class="chips">${multi(1, 'star', [['3', '★★★'], ['2', '★★'], ['1', '★']])}</div>`, '<p class="note">여러 개 고르기 · 안 고르면 전부</p>')}
  ${step(3, '종류', `<div class="chips">${multi(2, 'kind', [['p', '조각'], ['w', '단어'], ['a', '약어']])}</div>`, '<p class="note">여러 개 고르기 · 안 고르면 전부</p>')}
  ${step(4, '계통 (단원)', `<div class="chips">${unitChips}</div>`, '<p class="note">여러 개 고르기 · 안 고르면 전부</p>')}
  ${step(5, '헷갈리는 짝', `<div class="opts">${confOpts}</div>${grpSel}
    <label class="toggle-row" style="margin-top:8px"><span><b style="font-size:14.5px">헷갈리는 짝도 같이 넣기</b><br><span class="sub">남은 단어와 헷갈리기 쉬운 용어를 함께 넣어 비교하며 외워요 (${matesN}개가 돼요)</span></span><input type="checkbox" data-pkmates${f.mates ? ' checked' : ''}></label>`,
    '<p class="note">지금 남은 단어 중에서, 앱이 모아 둔 서로 헷갈리기 쉬운 용어(예: 피가 나오는 곳)만 남겨요.</p>')}
  <section class="panel"><div class="row-between"><h2>결과</h2><span class="left">골라 둔 <b id="pkn">${pkSelected().size}</b>개</span></div>
    <input class="pk-search" type="search" placeholder="결과 안에서 찾기 (예: cardi, 심장)" value="${esc(k.q || '')}" data-pksearch style="margin-top:8px">
    <details class="pk-paste"><summary>단어 붙여넣기 (교수님 단어 등)</summary>
      <textarea rows="4" data-pkpaste placeholder="영어나 한글 단어를 줄바꿈이나 쉼표로 나눠 붙여 넣으세요"></textarea>
      <button class="btn small" data-act="pkpaste">찾아서 넣기</button>
      ${k.pasteMsg ? `<p class="note">${k.pasteMsg}</p>` : ''}
    </details>
  </section>
  <div id="pklist">${pkListHTML()}</div>
  ${k.study ? '' : orderPanel(k)}
  <div class="bottom-cta pk-save"><p class="pk-count-line" id="pkcount">${pkCountText()}</p>${btns}</div>`;
}
// 이 목록의 공부 순서(교재 순서는 '넣은 순서'나 '단원 순서 직접'으로)
function orderPanel(k) {
  const o = k.order || { mode: 'rec' };
  const unitsOrd = o.units || IX.units.map(u => u.id);
  return `<section class="panel"><h2>이 단어장의 공부 순서</h2>
    <p class="note">교재 순서로 하려면 단원 순서를 교재 목차대로 바꾸거나, 교재·교수님 단어를 순서대로 붙여 넣고 "넣은 순서"를 고르세요.</p>
    <div class="opts" style="margin-top:8px">${LIST_ORDERS.map(([m, l, d]) => `<button class="opt${o.mode === m ? ' on' : ''}" data-act="pkord" data-arg="${m}"><span class="dot"></span><span class="grow"><b>${l}</b><small>${d}</small></span></button>`).join('')}</div>
    ${o.mode === 'units' ? `<ol class="unit-order">${unitsOrd.map((id, i) => { const u = IX.units.find(z => z.id === id); return `<li><span>${i + 1}. ${esc(u.short)}</span>
      <button class="icon-btn" data-act="pkup" data-arg="${i}" aria-label="위로"${i ? '' : ' disabled'}>↑</button><button class="icon-btn" data-act="pkdown" data-arg="${i}" aria-label="아래로"${i < unitsOrd.length - 1 ? '' : ' disabled'}>↓</button></li>`; }).join('')}</ol>` : ''}
  </section>`;
}
function pkRefreshList() {
  const el = document.getElementById('pklist');
  if (el) el.innerHTML = pkListHTML();
  pkRefreshCount();
}
function pkRefreshCount() {
  const c = document.getElementById('pkcount'); if (c) c.innerHTML = pkCountText();
  const m = document.getElementById('pkn'); if (m) m.textContent = pkSelected().size;
}
Object.assign(ACT, {
  // back = 돌아갈 화면. 'study'면 골라서 바로 공부(빈 선택에서 시작)
  pick: back => {
    if (back === 'quiz') { ACT.pick('study'); A.pk.quiz = true; A.pk.back = 'qset'; render(); return; }
    const study = back === 'study';
    if (!study && !curL()) newList();
    A.pk = { f: PK_BASE(), excl: new Set(), extra: new Set(), q: '', open: new Set(), study,
      order: !study && curL() ? { ...(curL().order || { mode: 'rec' }) } : { mode: 'rec' }, back: study ? 'home' : back || A.view };
    go('pickw');
  },
  pkstudy: () => {
    const ids = [...pkSelected()];
    if (!ids.length) { toast('공부할 단어를 골라 주세요'); return; }
    // 단어에 필요한 조각 중 아직 안 배운 것도 함께, 조각 → 단어 순서로
    const set = new Set(ids);
    for (const id of ids) { const x = IX.get(id); if (x && x.k === 'word') for (const f of x.parts || []) { const pid = 'p:' + f; if (IX.get(pid) && !A.states.has(pid)) set.add(pid); } }
    const rank = new Map(orderFor('321').map((id, i) => [id, i]));
    const all = [...set].sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9));
    const reviews = all.filter(id => A.states.has(id));
    let fresh = all.filter(id => !A.states.has(id));
    const MAXNEW = 40;
    if (fresh.length > MAXNEW) { toast(`새 단어는 한 번에 ${MAXNEW}개까지 넣었어요. 나머지는 다음에 다시 골라 주세요.`, 4000); fresh = fresh.slice(0, MAXNEW); }
    A.pk = null;
    startSession({ day: dayKey(Date.now()), reviews, fresh }, 'pick', `골라서 공부 · ${all.length}개`);
  },
  pkquiz: () => {
    const ids = [...pkSelected()];
    if (ids.length < 3) { toast('3개 이상 골라 주세요'); return; }
    A.qcfg = { ...(A.qcfg || QDEFAULT()), ranges: ['ids'], ids, idsLabel: `직접 고른 ${ids.length}개` }; delete A.qcfg.range;
    A.pk = null; go('qset');
  },
  pkaddmy: async () => {
    if (!curL()) newList();
    const set = new Set(myIds()); const before = set.size;
    for (const id of pkSelected()) set.add(id);
    setMyIds([...set]);
    await saveSettings();
    toast(`"${myName()}"에 ${set.size - before}개를 더했어요 (모두 ${set.size}개)`);
  },
  // 단계 고르기: 바꾸면 결과 체크는 처음부터(모두 체크)
  pksrc: v => { const f = A.pk.f; f.src = v; if (v !== 'studied') f.ans = ''; A.pk.excl.clear(); render(); },
  pkans: v => { const f = A.pk.f; f.ans = f.ans.includes(v) ? f.ans.replace(v, '') : f.ans + v; A.pk.excl.clear(); render(); },
  pkmulti: arg => { const [key, v] = arg.split(':'); const f = A.pk.f; f[key] = (f[key] || '').includes(v) ? f[key].replace(v, '') : (f[key] || '') + v; A.pk.excl.clear(); render(); },
  pkunitf: id => { const f = A.pk.f; f.units = f.units.includes(id) ? f.units.filter(z => z !== id) : [...f.units, id]; A.pk.excl.clear(); render(); },
  pkconf: v => { const f = A.pk.f; f.conf = v; if (v !== 'grp') f.grp = -1; A.pk.excl.clear(); render(); },
  pkall: on => { for (const x of pkVisible()) { if (on === '1') A.pk.excl.delete(x.id); else A.pk.excl.add(x.id); } pkRefreshList(); },
  pkunit: uid => {
    const xs = pkVisible().filter(x => x.unit === uid);
    const all = xs.every(x => !A.pk.excl.has(x.id));
    for (const x of xs) { if (all) A.pk.excl.add(x.id); else A.pk.excl.delete(x.id); }
    pkRefreshList();
  },
  pkpaste: () => {
    const ta = $app.querySelector('textarea[data-pkpaste]');
    const words = (ta ? ta.value : '').split(/[\n,;·]+/).map(z => z.trim()).filter(Boolean);
    const byT = new Map(IX.items.map(x => [normEn(x.t), x]));
    const byKo = new Map(); for (const x of IX.items) for (const k of x.ko) if (!byKo.has(normKo(k))) byKo.set(normKo(k), x);
    const miss = [];
    let found = 0;
    for (const w of words) {
      const x = byT.get(normEn(w)) || byKo.get(normKo(w));
      if (x) { A.pk.extra.add(x.id); A.pk.excl.delete(x.id); found++; } else miss.push(w);
    }
    A.pk.pasteMsg = `${found}개를 찾아서 결과에 넣었어요.${miss.length ? ` 앱에 없는 단어 ${miss.length}개: ${esc(miss.slice(0, 10).join(', '))}${miss.length > 10 ? ' …' : ''}` : ''}`;
    render();
  },
  pkcancel: () => { if (A.first && A.pk.back === 'pace' && !myIds().length) { go('way'); return; } go(A.pk.back || 'home'); },
  pkord: m => { A.pk.order = { ...A.pk.order, mode: m }; if (m === 'units' && !A.pk.order.units) A.pk.order.units = IX.units.map(u => u.id); render(); },
  pkup: i => { const u = A.pk.order.units; i = Number(i); if (i > 0) [u[i - 1], u[i]] = [u[i], u[i - 1]]; render(); },
  pkdown: i => { const u = A.pk.order.units; i = Number(i); if (i < u.length - 1) [u[i + 1], u[i]] = [u[i], u[i + 1]]; render(); },
  pksave: async how => {
    const pick = [...pkSelected()];
    if (!pick.length && how !== 'replace') { toast('고른 단어가 없어요'); return; }
    if (curL()) curL().order = A.pk.order;
    if (how === 'add') { const set = new Set(myIds()); for (const id of pick) set.add(id); setMyIds([...set]); }
    else setMyIds(pick);
    await saveSettings();
    if (A.pk.back === 'pace' && A.draft) A.draft.scope = myIds().length ? 'my' : A.draft.scope;
    if (A.qcfg && A.pk.back === 'qset') { const rs = qRanges(A.qcfg); A.qcfg.ranges = rs.includes('my') ? rs : [...rs, 'my']; delete A.qcfg.range; }
    go(A.pk.back || 'home');
    toast(`"${myName()}"에 ${myIds().length}개를 저장했어요`);
  },
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (e.target.matches('input[data-spell]')) { e.preventDefault(); ACT.spellcheck(); }
  else if (e.target.matches('input[data-spellre]')) { e.preventDefault(); if (A.spellRetyped) ACT.spellnext(); }
});
document.addEventListener('input', e => {
  if (e.target.matches('input[data-spellre]') && A.held) {
    const x = IX.get(spellBase(A.held.c));
    const okNow = x && normEn(e.target.value) === normEn(x.t);
    if (okNow !== !!A.spellRetyped) { A.spellRetyped = okNow; const b = document.getElementById('spellnext'); if (b) { b.disabled = !okNow; b.innerHTML = okNow ? '다음 <small>Enter</small>' : '따라 쓰면 넘어가요 <small>Enter</small>'; } }
    return;
  }
  if (e.target.matches('input[data-hsearch]')) { A.hq = e.target.value; const el = document.getElementById('hsres'); if (el) el.innerHTML = hsearchHTML(); return; }
  if (e.target.matches('input[data-pksearch]') && A.pk) { A.pk.q = e.target.value; pkRefreshList(); }
});
document.addEventListener('change', e => {
  if (e.target.matches('input[data-qhardall]') && A.qcfg) { A.qcfg.hardAll = e.target.checked; render(); }
  if (e.target.matches('select[data-pkgrp]') && A.pk) { A.pk.f.grp = Number(e.target.value); A.pk.excl.clear(); render(); }
  if (e.target.matches('input[data-pkmates]') && A.pk) { A.pk.f.mates = e.target.checked; A.pk.excl.clear(); render(); }
});
document.addEventListener('change', e => {
  const id = e.target.dataset && e.target.dataset.pk;
  if (id && A.pk) { if (e.target.checked) A.pk.excl.delete(id); else A.pk.excl.add(id); pkRefreshCount(); }
});
document.addEventListener('toggle', e => {
  if (e.target.matches && e.target.matches('details[data-qcustom]')) A.qcustom = e.target.open;
  if (e.target.matches && e.target.matches('details[data-gwrap]')) A.gopen = e.target.open;
  if (e.target.matches && e.target.matches('details[data-scopemore]') && A.draft) A.draft.scopeOpen = e.target.open;
  if (e.target.matches && e.target.matches('details.pk-unit') && A.pk) { const u = e.target.dataset.unit; if (e.target.open) A.pk.open.add(u); else A.pk.open.delete(u); }
}, true);

// ───────── 단어 모음: 여러 기준으로 단어를 모아 보기 ─────────
// 내가 표시(아주 중요·내 단어) · 공부할 때 누른 답 · 시험 결과 · 끈질긴 단어
const isFlag = id => !!(A.flags[id] && A.flags[id].on);
const COLS = [
  { k: 'flag', g: '내가 표시', name: '중요', icon: '★' },
  { k: 'my', g: '내가 표시', name: '내 단어장' },
  { k: 'b1', g: '공부할 때 누른 답', name: '모름', sub: '모름 + 확인에서 틀림', cls: 'b1' },
  { k: 'b2', g: '공부할 때 누른 답', name: '헷갈림', cls: 'b2' },
  { k: 'b3', g: '공부할 때 누른 답', name: '알 것 같음', cls: 'b3' },
  { k: 'b4', g: '공부할 때 누른 답', name: '확실히 앎', cls: 'b4' },
  { k: 'qw', g: '시험', name: '시험에서 틀림' },
  { k: 'qu', g: '시험', name: '시험에서 헷갈렸어요', sub: '맞혔지만 헷갈렸어요를 누름' },
  { k: 'sticky', g: '자동', name: '자꾸 틀리는 단어', sub: '7번 이상 틀린 단어' },
];
const fmtDay = t => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };
// 모음 하나 → [{ id, t: 최근 시각, n: 정렬용 횟수, info }]
function colItems(k, mode, marks) {
  if (k === 'flag') return Object.entries(A.flags).filter(([, v]) => v.on).map(([id, v]) => ({ id, t: v.t, n: 0, info: `표시 ${fmtDay(v.t)}` }));
  if (k === 'my') return myIds().map((id, i) => ({ id, t: i, n: 0, info: '' }));
  if (k[0] === 'b') {
    const b = Number(k[1]);
    return marksList(marks, b, mode).map(m => ({ id: m.id, t: m.lastT, n: m.n[b],
      info: [1, 2, 3, 4].filter(z => m.n[z]).map(z => `${MARKS[z - 1].name} ${m.n[z]}`).join(' · ') + ` · 마지막 ${fmtDay(m.lastT)}` }));
  }
  if (k === 'qw' || k === 'qu') {
    const f = k === 'qw' ? 'w' : 'u';
    return Object.entries(A.qmarks).filter(([, v]) => (mode === 'ever' ? v[f] > 0 : v.last === f))
      .map(([id, v]) => ({ id, t: v.t, n: v[f], info: `시험 틀림 ${v.w || 0} · 헷갈림 ${v.u || 0} · 맞힘 ${v.ok || 0} · 마지막 ${fmtDay(v.t)}` }));
  }
  if (k === 'sticky') return [...A.states.values()].filter(s => s.fails > 6).map(s => ({ id: s.id, t: s.lastT, n: s.fails, info: `틀림 ${s.fails}번` }));
  return [];
}
function colFiltered(k, marks) {
  const c = A.mk;
  let xs = colItems(k, c.mode, marks).filter(z => IX.get(z.id));
  if (c.unit) xs = xs.filter(z => IX.get(z.id).unit === c.unit);
  if (c.kind) xs = xs.filter(z => IX.get(z.id).k === c.kind);
  const by = { recent: (a, b) => b.t - a.t, many: (a, b) => b.n - a.n || b.t - a.t, abc: (a, b) => IX.get(a.id).t.localeCompare(IX.get(b.id).t) };
  return xs.sort(by[c.sort] || by.recent);
}
function viewMarks() {
  const c = A.mk;
  const marks = answerMarks(A.log);
  const counts = Object.fromEntries(COLS.map(z => [z.k, colFiltered(z.k, marks).length]));
  // 단어가 있는 모음만 보여 준다. 고른 모음이 비었으면 단어가 있는 첫 모음으로
  if (!counts[c.col] && !c.picked) { const first = COLS.find(z => z.k !== 'my' && counts[z.k]); if (first) c.col = first.k; }
  const shown = COLS.filter(z => z.k !== 'my' && (counts[z.k] || (c.picked && z.k === c.col)));
  const cur = COLS.find(z => z.k === c.col) || COLS[0];
  const groups = [...new Set(shown.map(z => z.g))];
  const tiles = !shown.length ? '<p class="note" style="padding:4px 2px 8px">공부를 시작하면 모름·헷갈림, 시험에서 틀린 단어, ★ 중요 단어가 여기에 모여요.</p>' : groups.map(g => `<div class="mk-g"><span>${g}</span><div class="mk-tiles">${shown.filter(z => z.g === g).map(z =>
    `<button class="mk-tab ${z.cls || 'plain'}${c.col === z.k ? ' on' : ''}" data-act="mkcol" data-arg="${z.k}"><b>${counts[z.k]}</b><span>${z.icon ? z.icon + ' ' : ''}${z.name}</span></button>`).join('')}</div></div>`).join('');
  const list = colFiltered(cur.k, marks);
  const hasMode = cur.k[0] === 'b' || cur.k === 'qw' || cur.k === 'qu';
  const sel = (key, opts) => `<select data-mksel="${key}">${opts.map(([v, l]) => `<option value="${v}"${c[key] === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  const rows = list.map(z => { const x = IX.get(z.id); const f = isFlag(x.id); return `<li>
      <button class="mk-row" data-act="opencard" data-arg="${esc(x.id)}"><b lang="en">${esc(x.t)}</b><span>${esc(x.ko.join(' · '))}</span>${z.info ? `<small>${z.info}</small>` : ''}</button>
      <button class="mk-flag${f ? ' on' : ''}" data-act="flag" data-arg="${esc(x.id)}" aria-label="중요 ${f ? '빼기' : '표시'}">${f ? '★' : '☆'}</button></li>`; }).join('');
  const empty = { flag: '단어 카드에서 ☆를 누르면 여기에 모여요.', my: '"내 단어 고르기"에서 단어를 골라 보세요.', qw: '시험에서 틀린 단어가 여기에 모여요.', qu: '시험에서 "헷갈렸어요"를 누른 단어가 여기에 모여요.' }[cur.k] || '아직 없어요.';
  const lists = A.settings.lists || [];
  const listCards = lists.map(l => { const keep = IX.myList; IX.myList = l.ids; const pr = progress(IX, A.states, 'my'); IX.myList = keep; const pct = pr.total ? Math.round(((pr.mastered + pr.long) / pr.total) * 100) : 0;
    return `<li><span class="ln"><b>${esc(l.name)}</b><small>${l.ids.length}개 · 익힘 ${pct}% · ${orderName(l)}</small></span><button class="chip" data-act="lstudy" data-arg="${l.id}">공부</button><button class="chip" data-act="ledit" data-arg="${l.id}">고치기</button></li>`; }).join('');
  return `<header class="top"><h1>단어</h1></header>
  <div class="hsearch"><span class="hs-ic">${IC.search}</span><input type="search" data-hsearch placeholder="단어 찾기 (영어·한글)" value="${esc(A.hq || '')}" autocomplete="off"><div id="hsres">${hsearchHTML()}</div></div>
  <section class="panel"><div class="row-between"><h2>내 단어장</h2><button class="link" data-act="planpick" data-arg="new-my">+ 새 단어장</button></div>
    ${lists.length ? `<ul class="mylists">${listCards}</ul>` : '<p class="note">아직 내 단어장이 없어요. "+ 새 단어장"으로 만들어 보세요.</p>'}</section>
  <h2 class="sec-h">단어 모음</h2>
  <section class="mk-head">${tiles}</section>
  <section class="panel"${shown.length ? '' : ' hidden'}>
    <div class="row-between"><h2>${cur.icon ? cur.icon + ' ' : ''}${cur.name} ${list.length}개</h2>${cur.sub ? `<span class="sub">${cur.sub}</span>` : ''}</div>
    ${hasMode ? `<div class="seg" style="margin:10px 0">
      <button class="${c.mode === 'last' ? 'on' : ''}" data-act="mkmode" data-arg="last"><b>마지막 결과</b><small>지금 상태</small></button>
      <button class="${c.mode === 'ever' ? 'on' : ''}" data-act="mkmode" data-arg="ever"><b>한 번이라도</b><small>지금까지 전부</small></button></div>` : ''}
    <div class="mk-filters">
      ${sel('unit', [['', '모든 계통'], ...IX.units.map(u => [u.id, `${u.n}. ${u.short}`])])}
      ${sel('kind', [['', '모든 종류'], ['part', '조각'], ['word', '단어'], ['abbr', '약어']])}
      ${sel('sort', [['recent', '최근 순'], ['many', '많이 누른 순'], ['abc', '알파벳 순']])}
    </div>
    ${cur.k === 'my' ? listBar() : ''}
    ${list.length ? `<div class="mk-actions">
      <button class="btn primary" data-act="mkstudy">카드로 다시 공부</button>
      <button class="btn" data-act="mkquiz">이 단어로 시험</button>
      ${cur.k === 'my' ? '<button class="btn" data-act="pick" data-arg="marks">단어 고치기</button>' : '<button class="btn" data-act="mkmy">내 단어장에 넣기</button>'}
    </div>
    <ul class="mk-list">${rows}</ul>`
    : `<p class="note center" style="padding:16px">${empty}</p>${cur.k === 'my' ? '<button class="btn" style="width:100%" data-act="pick" data-arg="marks">내 단어 고르기</button>' : ''}`}
  </section>`;
}
const mkIds = () => colFiltered(A.mk.col, answerMarks(A.log)).map(z => z.id);
const mkName = () => (COLS.find(z => z.k === A.mk.col) || COLS[0]).name;
async function setFlag(id, on) {
  A.flags[id] = { on, t: Date.now() };
  await store.set('flags', A.flags);
}
Object.assign(ACT, {
  marks: () => { A.mk = A.mk || { col: 'flag', mode: 'last', unit: '', kind: '', sort: 'recent' }; go('marks'); },
  mkcol: k => { A.mk.col = k; A.mk.picked = true; render(); },
  mkmode: m => { A.mk.mode = m; render(); },
  flag: async id => {
    const on = !isFlag(id);
    await setFlag(id, on);
    render();
    toast(on ? '★ 중요 단어에 넣었어요' : '중요 표시를 뺐어요');
  },
  mkstudy: () => startSession({ day: dayKey(Date.now()), reviews: mkIds(), fresh: [] }, 'sticky', `단어 모음 · ${mkName()}`),
  mkquiz: () => {
    A.qcfg = { ...(A.qcfg || QDEFAULT()), ranges: ['ids'], ids: mkIds(), idsLabel: mkName() }; delete A.qcfg.range;
    go('qset');
  },
  mkmy: async () => {
    if (!curL()) newList();
    const set = new Set(myIds()); const before = set.size;
    for (const id of mkIds()) set.add(id);
    setMyIds([...set]);
    await saveSettings();
    toast(`"${myName()}"에 ${set.size - before}개를 더했어요 (모두 ${set.size}개)`);
  },
});
document.addEventListener('change', e => {
  const key = e.target.dataset && e.target.dataset.mksel;
  if (key && A.mk) { A.mk[key] = e.target.value; render(); }
});

// ───────── 백업 ─────────
async function sendBackup() {
  const now = Date.now();
  const data = makeBackup(A.log, { device: A.settings.device, label: A.settings.label, now, notes: A.notes, flags: A.flags, history: A.history });
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
  const fm = mergeFlags(A.flags, o.flags);
  if (fm.changed) { A.flags = fm.flags; await store.set('flags', A.flags); }
  const hm = mergeHistory(A.history, o.history);
  if (hm.changed) { A.history = hm.history; await store.set('history', A.history); }
  recompute();
  if (A.view === 'welcome') go('way'); else render();
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
  if (e.target.matches('input[type=date][data-act=dend]') && A.draft && e.target.value) {
    A.draft.pace = { mode: 'goal', end: e.target.value }; A.draft.exam = true; A.draft.cw = 0;
    render();
  }
});
document.addEventListener('keydown', e => {
  if (A.view !== 'study' || e.target.closest('textarea, input') || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const go = (act, arg) => { e.preventDefault(); ACT[act](arg); };
  const sc = shown();
  if (sc && isSpell(sc.c)) { if (A.phase === 'spellfb' && (k === 'enter' || k === ' ')) return go('spellnext'); if (k === 'p' && A.phase === 'spellfb') return go('sayid', spellBase(sc.c)); return; }
  if (k === 'p') return go('say');
  if (k === 'f') { const c = shown(); if (c) return go('flag', c.c); }
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
