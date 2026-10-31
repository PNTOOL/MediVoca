// 학습 엔진: 기록(복습 한 줄씩)으로 카드 상태를 다시 계산하고, 오늘 볼 카드를 고르고, 세션 순서를 정한다.
// 화면·저장과 상관없는 순수 함수만 둔다. tests/engine.test.mjs 에서 검사한다.
import { fsrs, generatorParameters, createEmptyCard } from '../vendor/ts-fsrs.mjs';

export const RULES = {
  dailyCards: 50,     // 하루 장수 (복습 + 새 단어)
  newMin: 5,          // 새 단어 최소
  newMax: 30,         // 새 단어 최대
  reviewMax: 100,     // 복습은 하루 이만큼까지 (넘치면 다음 날로 나눔)
  backlogAt: 10,      // 밀린 복습이 이보다 많으면 새 단어를 쉰다
  againGap: 5,        // 모름·헷갈림 카드는 이만큼 뒤에 다시
  masteredDays: 3,    // 다른 날 이만큼 맞히면 익힘
  longDays: 21,       // 다음 복습까지 이만큼 이상이면 오래 기억
  stickyFails: 6,     // 이보다 많이 틀리면 끈질긴 단어
  nextStageAt: 0.8,   // 지금 단계의 이만큼이 익힘이면 다음 단계를 권함
  dayStartHour: 4,    // 새벽 4시에 하루가 바뀐다 (밤늦게 공부해도 같은 날)
  secReview: 8,       // 예상 시간: 복습 한 장
  secNew: 35,         // 예상 시간: 새 단어 한 장 (설명·다시 떠올리기 평균)
  quickCards: 10,     // 3분 모드
  batch: 10,          // 새 단어 묶음 크기
};

const DAY = 86400000;
const HOUR = 3600000;

// ───────── 날짜 ─────────
export function dayKey(t) {
  const d = new Date(t - RULES.dayStartHour * HOUR);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
// 그날(dayKey 기준)이 끝나는 시각 = 다음 날 새벽 4시
export function dayEnd(t) {
  const d = new Date(t - RULES.dayStartHour * HOUR);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, RULES.dayStartHour).getTime();
}

// ───────── 버튼 → FSRS 평가 ─────────
// 1 모름 → 다시, 2 헷갈림 → 어려움, 3 알 것 같음 → 보통, 4 확실히 앎 → 쉬움.
// 3·4는 정답 확인에서 틀렸다고 하면 "다시".
export function ratingOf(e) {
  if (e.b === 1 || e.b === 2) return e.b;
  return e.ok === false ? 1 : e.b;
}
export const isCorrect = e => ratingOf(e) >= 3;
export const logKey = e => e.t + '|' + e.d + '|' + e.c;

export function makeScheduler(retention = 0.9) {
  return fsrs(generatorParameters({
    request_retention: retention,
    enable_fuzz: false,          // 다시 계산해도 같은 결과가 나오게
    enable_short_term: false,    // 같은 날 반복은 세션이 맡는다
    learning_steps: [],
    relearning_steps: [],
  }));
}

// ───────── 기록 → 카드 상태 ─────────
// 그날 처음 본 결과만 FSRS에 넣는다. 같은 날 다시 본 것은 기록만 남는다.
export function replay(log, { retention = 0.9 } = {}) {
  const f = makeScheduler(retention);
  const sorted = [...log].sort((a, b) => a.t - b.t || (logKey(a) < logKey(b) ? -1 : 1));
  const states = new Map();
  for (const e of sorted) {
    let s = states.get(e.c);
    if (!s) {
      s = { id: e.c, card: createEmptyCard(new Date(e.t)), first: e.t, firstDay: dayKey(e.t), lastDay: null, lastT: 0, goodDays: new Set(), fails: 0, n: 0, todayFirst: null, masteredDay: null };
      states.set(e.c, s);
    }
    const day = dayKey(e.t);
    const r = ratingOf(e);
    if (s.lastDay !== day) {
      s.card = f.next(s.card, new Date(e.t), r).card;
      s.lastDay = day;
      s.dayFirst = r; // 그날 처음 본 결과
      if (r >= 3) {
        s.goodDays.add(day);
        if (s.goodDays.size === RULES.masteredDays) s.masteredDay = day;
      }
    }
    if (r === 1) s.fails++;
    s.n++;
    s.lastT = e.t;
  }
  return states;
}

// 상태: new 새 단어 → learning 배우는 중 → mastered 익힘 → long 오래 기억
export function statusOf(s) {
  if (!s) return 'new';
  if (s.goodDays.size < RULES.masteredDays) return 'learning';
  const interval = (s.card.due.getTime() - s.card.last_review.getTime()) / DAY;
  return interval >= RULES.longDays - 0.01 ? 'long' : 'mastered';
}
export const isSticky = s => !!s && s.fails > RULES.stickyFails;

export function retrievability(s, now, retention = 0.9) {
  if (!s) return 0;
  return makeScheduler(retention).get_retrievability(s.card, new Date(now), false);
}

// ───────── 새 단어 순서 ─────────
// 장 순서대로, 장 안에서는 조각 → 단어(같은 어근끼리) → 약어. 핵심(core)을 다 넣은 뒤 확장(ext).
// 단어에 들어가는 조각은 그 단어보다 먼저 온다(다른 장·확장 조각이라도).
export function newOrder(index, scope = 'all') {
  if (scope === 'my' && index.myOrder && index.myOrder.mode && index.myOrder.mode !== 'rec') return listOrder(index, index.myList || [], index.myOrder);
  if (isSyl(scope)) return listOrder(index, [...scopeSet(index, scope)], { mode: 'units', units: sylUnits(scope) });
  const keep = normScope(scope) === '321' ? null : scopeSet(index, scope);
  const out = [];
  const placed = new Set();
  const put = id => { if (!placed.has(id) && index.byId.has(id)) { placed.add(id); out.push(id); } };
  const rootKey = (w, unitParts) => {
    const ps = (w.parts || []).map(f => 'p:' + f);
    const roots = ps.filter(p => unitParts.has(p) && p.includes('/'));
    const pick = roots[0] || ps.find(p => unitParts.has(p));
    return pick ? unitParts.get(pick) : 1e9;
  };
  for (const stage of ['core', 'ext']) {
    for (const u of index.units) {
      const its = index.items.filter(x => x.unit === u.id);
      const unitParts = new Map(its.filter(x => x.k === 'part').map((x, i) => [x.id, i]));
      const parts = its.filter(x => x.k === 'part' && x.stage === stage);
      const words = its.filter(x => x.k === 'word' && x.stage === stage)
        .map((w, i) => ({ w, i, r: rootKey(w, unitParts) }))
        .sort((a, b) => a.r - b.r || a.i - b.i).map(o => o.w);
      const abbr = its.filter(x => x.k === 'abbr' && x.stage === stage);
      for (const p of parts) put(p.id);
      for (const w of words) {
        for (const f of w.parts || []) put('p:' + f);
        put(w.id);
      }
      for (const a of abbr) put(a.id);
    }
  }
  return keep ? out.filter(id => keep.has(id)) : out;
}

// ───────── 공부 범위 ─────────
// 범위는 중요도(★) 조합으로 정한다: '321' 전체, '32' ★★ 이상(핵심), '3' ★★★만, '1' ★만 …
// 예전 이름(star3 · core · all)도 받는다. 범위 안 단어에 필요한 조각은 별이 낮아도 함께 넣는다.
const OLD_SCOPES = { star3: '3', core: '32', all: '321' };
// 범위 문자열: '★ 숫자' 또는 '★ 숫자|단원.단원' (예: '32|m05.m06' = 근골격·심혈관의 ★★ 이상)
// 강의·교재 순서: 'syl:★숫자|단원.단원' — 단원 순서가 곧 공부 순서 (예 'syl:32|m01.m02.m06.m05')
export const isSyl = scope => String(scope || '').startsWith('syl:');
const bare = scope => (isSyl(scope) ? String(scope).slice(4) : scope);
export function sylUnits(scope) { return (String(bare(scope) || '').split('|')[1] || '').split('.').filter(Boolean); }
export function makeSyl(stars, units) { return 'syl:' + ([...stars].map(Number).sort((a, b) => b - a).join('') || '321') + '|' + units.join('.'); }
const starPart = scope => String(OLD_SCOPES[bare(scope)] || bare(scope) || '321').split('|')[0];
export function scopeStars(scope = 'all') {
  const set = new Set([...starPart(scope)].map(Number).filter(n => n >= 1 && n <= 3));
  return set.size ? set : new Set([1, 2, 3]);
}
export function scopeUnits(scope) {
  const u = String(bare(scope) || '').split('|')[1];
  const list = (u || '').split('.').filter(Boolean);
  return list.length ? new Set(list) : null;
}
export function normScope(scope) {
  if (scope === 'my') return 'my';
  if (isSyl(scope)) return makeSyl(scopeStars(scope), sylUnits(scope));
  const stars = [...scopeStars(scope)].sort((a, b) => b - a).join('');
  const units = scopeUnits(scope);
  return units ? stars + '|' + [...units].sort().join('.') : stars;
}
export function makeScope(stars, units) {
  return normScope([...stars].join('') + (units && units.length ? '|' + units.join('.') : ''));
}
export function scopeLabel(scope) {
  if (scope === 'my') return '내 단어';
  if (isSyl(scope)) { const d = starPart(scope); return `학교 수업 · ${sylUnits(scope).length}개 단원${d === '321' ? '' : ' · ' + (d === '32' ? '★★ 이상' : d === '3' ? '★★★만' : [...d].map(n => '★'.repeat(Number(n))).join('·'))}`; }
  const d = normScope(scope).split('|')[0];
  const units = scopeUnits(scope);
  const s = d === '321' ? '전체' : d === '32' ? '핵심 (★★ 이상)' : d === '3' ? '★★★만' : [...d].map(n => '★'.repeat(Number(n))).join(' · ');
  return units ? `${s} · ${units.size}개 단원` : s;
}
export const SCOPES = {
  star3: { label: '★★★만', test: x => x.star === 3 },
  core: { label: '핵심 (★★ 이상)', test: x => x.star >= 2 },
  all: { label: '전체', test: () => true },
};
// 'my' = 직접 고른 단어 (index.myList). 고른 단어에 필요한 조각도 함께 넣는다.
export function scopeSet(index, scope = 'all') {
  if (scope === 'my') {
    const set = new Set();
    for (const id of index.myList || []) {
      const x = index.byId.get(id);
      if (!x) continue;
      set.add(id);
      if (x.k === 'word') for (const f of x.parts || []) if (index.byId.has('p:' + f)) set.add('p:' + f);
    }
    return set;
  }
  const stars = scopeStars(scope);
  const units = scopeUnits(scope);
  const set = new Set();
  for (const x of index.items) {
    if (!stars.has(x.star)) continue;
    if (units && !units.has(x.unit)) continue;
    set.add(x.id);
    if (x.k === 'word') for (const f of x.parts || []) if (index.byId.has('p:' + f)) set.add('p:' + f);
  }
  return set;
}

// ───────── 공부 속도 ─────────
// pace: { mode: 'daily', cards: 30|50|80 } 하루 장수 고정
//       { mode: 'goal', start, end: 'YYYY-MM-DD' } 그 날짜까지 범위를 끝내도록 하루 새 단어 수를 계산
export const PACES = [
  { cards: 30, label: '천천히' },
  { cards: 50, label: '기본' },
  { cards: 80, label: '빠르게' },
];
export const minutesForCards = cards => Math.round(cards * 0.3);
export const minutesForNew = perDay => Math.round(perDay * 0.65 + 8);
// 하루 장수를 고정했을 때 평균 새 단어 수 (시뮬레이션 기준 대략값)
const avgNewForCards = cards => cards * 0.18;

export function daysBetween(fromKey, toKey) {
  const a = new Date(fromKey + 'T12:00:00'), b = new Date(toKey + 'T12:00:00');
  return Math.round((b - a) / DAY);
}
// 복습만 하는 마지막 기간: 4주 이상 남으면 12일, 2주 이상이면 7일, 그보다 짧으면 절반
export function reviewOnlyDays(daysLeft) {
  if (daysLeft >= 28) return 12;
  if (daysLeft >= 14) return 7;
  return Math.floor(daysLeft / 2);
}

export function paceInfo(index, states, { pace = { mode: 'daily', cards: RULES.dailyCards }, scope = 'all', now = Date.now() } = {}) {
  const today = dayKey(now);
  const set = scopeSet(index, scope);
  let remaining = 0, newToday = 0;
  for (const id of set) {
    const s = states.get(id);
    if (!s) remaining++;
    else if (s.firstDay === today) newToday++;
  }
  const info = { mode: pace.mode, total: set.size, remaining, newToday };
  if (pace.mode === 'goal' && pace.end) {
    const daysLeft = daysBetween(today, pace.end);
    // 복습만 하는 기간은 계획을 세운 날 기준으로 정한다 (날이 지나도 줄지 않게)
    const reviewOnly = reviewOnlyDays(daysBetween(pace.start || today, pace.end));
    const newDays = Math.max(0, daysLeft - reviewOnly);
    const start = remaining + newToday; // 오늘 아침 기준 남은 수
    info.daysLeft = daysLeft;
    info.reviewOnly = reviewOnly;
    info.newDays = newDays;
    info.ended = daysLeft <= 0;
    info.reviewPhase = !info.ended && newDays === 0;
    info.perDay = newDays > 0 ? Math.ceil(start / newDays) : 0;
    info.minutes = minutesForNew(info.perDay);
    info.heavy = info.minutes > 40;
  } else {
    const cards = pace.cards || RULES.dailyCards;
    info.cards = cards;
    info.minutes = minutesForCards(cards);
    info.weeks = Math.max(1, Math.round(remaining / avgNewForCards(cards) / 7));
  }
  return info;
}

// 헷갈리는 짝의 반대쪽 항목들
function oppositeOf(index, id) {
  const res = [];
  for (const p of index.pairsOf.get(id) || []) {
    if ((p.sa || []).includes(id)) res.push(...(p.sb || []));
    if ((p.sb || []).includes(id)) res.push(...(p.sa || []));
  }
  return res;
}

// 오늘 넣을 새 단어 n개 고르기
export function pickNew(index, states, n, { order, now = Date.now(), exclude = new Set() } = {}) {
  if (n <= 0) return [];
  order = order || newOrder(index);
  const today = dayKey(now);
  const picked = [];
  const pickedSet = new Set();
  const ready = id => states.has(id) || pickedSet.has(id);
  for (const id of order) {
    if (picked.length >= n) break;
    if (states.has(id) || exclude.has(id)) continue;
    const x = index.byId.get(id);
    // 조각을 아직 안 배웠으면 단어는 미룬다
    if (x.k === 'word' && (x.parts || []).some(f => index.byId.has('p:' + f) && !ready('p:' + f))) continue;
    // 헷갈리는 짝: 반대쪽을 오늘 처음 배웠거나 아직 배우는 중이면 미룬다
    const opp = oppositeOf(index, id);
    if (opp.some(o => pickedSet.has(o) || (states.has(o) && (statusOf(states.get(o)) === 'learning' || states.get(o).firstDay === today)))) continue;
    picked.push(id);
    pickedSet.add(id);
  }
  return picked;
}

// ───────── 오늘 할 일 ─────────
export function planToday(index, states, { now = Date.now(), retention = 0.9, pace, scope = 'all', extraNew = 0, order } = {}) {
  pace = pace || { mode: 'daily', cards: RULES.dailyCards };
  const goal = pace.mode === 'goal' && pace.end ? paceInfo(index, states, { pace, scope, now }) : null;
  const dailyCards = goal ? RULES.dailyCards : (pace.cards || RULES.dailyCards);
  const newMax = Math.round(dailyCards * RULES.newMax / RULES.dailyCards);
  const today = dayKey(now);
  const end = dayEnd(now);
  const f = makeScheduler(retention);
  let reviewedToday = 0, newToday = 0;
  const due = [];
  for (const s of states.values()) {
    if (s.firstDay === today) { newToday++; continue; }
    if (s.lastDay === today) { reviewedToday++; continue; }
    if (s.card.due.getTime() < end) due.push(s);
  }
  // 잊을 위험이 큰 것부터
  due.sort((a, b) => f.get_retrievability(a.card, new Date(now), false) - f.get_retrievability(b.card, new Date(now), false) || a.card.due - b.card.due);
  const reviewRoom = Math.max(0, RULES.reviewMax - reviewedToday);
  const reviews = due.slice(0, reviewRoom).map(s => s.id);
  const reviewsTotal = reviewedToday + due.length;
  // 날짜 목표가 있으면 계산한 수를 따르고(밀려도 쉬지 않음), 없으면 하루 장수에서 복습을 뺀 나머지
  // 밀린 복습 = 어제까지 봤어야 했는데 못 본 카드 (빠진 날이 있을 때). 10장 넘게 밀리면 새 단어를 쉰다.
  const dayStart = end - DAY;
  const overdue = due.filter(s => s.card.due.getTime() < dayStart).length;
  const backlog = !goal && overdue > RULES.backlogAt;
  const newQuota = goal ? (goal.ended ? Math.min(newMax, Math.max(RULES.newMin, dailyCards - reviewsTotal)) : goal.perDay)
    : backlog ? 0 : Math.min(newMax, Math.max(RULES.newMin, dailyCards - reviewsTotal));
  const newLeft = Math.max(0, Math.max(0, newQuota - newToday) + extraNew);
  const fresh = pickNew(index, states, newLeft, { order: order || newOrder(index, scope), now });
  return {
    day: today,
    reviews,
    fresh,
    backlog,
    overdue,
    dueTotal: due.length,
    reviewedToday,
    newToday,
    newQuota,
    goal,
    minutes: Math.max(1, Math.round((reviews.length * RULES.secReview + fresh.length * RULES.secNew) / 60)),
  };
}

// ───────── 세션 (오늘 공부 한 번) ─────────
// queue: 앞에서부터 보여 줄 카드. 모름·헷갈림·틀림은 againGap장 뒤에 다시 넣는다.
// 그날 처음 "모름"(또는 틀림)이었던 카드는 맨 끝에 한 번 더 본다.
export function newSession(plan, { now = Date.now(), mode = 'daily' } = {}) {
  return {
    day: plan.day,
    mode,
    started: now,
    queue: [...plan.reviews.map(c => ({ c, kind: 'review' })), ...plan.fresh.map(c => ({ c, kind: 'new' }))],
    total: plan.reviews.length + plan.fresh.length,
    first: {},       // 카드 → 처음 본 평가
    finals: [],      // 끝에 한 번 더 볼 카드
    finalsAdded: false,
    shown: 0,        // 보여 준 횟수 (다시 본 것 포함)
    doneCards: 0,    // 처음 본 카드 수 (진행 막대)
  };
}

export function current(sess) {
  if (!sess.queue.length && !sess.finalsAdded) {
    sess.finalsAdded = true;
    sess.queue = sess.finals.map(c => ({ c, kind: 'final' }));
  }
  return sess.queue[0] || null;
}

// 답하기: b 버튼(1~4), ok 정답 확인(3·4일 때). 돌려주는 값은 기록 한 줄.
export function answer(sess, b, ok, { now = Date.now(), device = '' } = {}) {
  const cur = current(sess);
  if (!cur) return null;
  const e = { t: now, c: cur.c, b, d: device };
  if (b >= 3) e.ok = !!ok;
  const r = ratingOf(e);
  sess.queue.shift();
  sess.shown++;
  if (!(cur.c in sess.first)) {
    sess.first[cur.c] = r;
    sess.doneCards++;
    if (r === 1) sess.finals.push(cur.c);
  }
  if (r <= 2) {
    const at = Math.min(RULES.againGap, sess.queue.length);
    sess.queue.splice(at, 0, { c: cur.c, kind: 'again' });
  }
  return e;
}

export function isDone(sess) {
  return !current(sess);
}

// ───────── 요약 ─────────
export function progress(index, states, scope = 'core') {
  const res = { new: 0, learning: 0, mastered: 0, long: 0, total: 0 };
  const set = scopeSet(index, scope);
  for (const x of index.items) {
    if (!set.has(x.id)) continue;
    res.total++;
    res[statusOf(states.get(x.id))]++;
  }
  res.doneRatio = res.total ? (res.mastered + res.long) / res.total : 0;
  res.suggestNext = res.doneRatio >= RULES.nextStageAt;
  return res;
}

export function streak(log, now = Date.now()) {
  const days = new Set(log.map(e => dayKey(e.t)));
  let n = 0;
  let t = now;
  if (!days.has(dayKey(t))) t -= DAY; // 오늘 아직 안 했으면 어제부터 센다
  while (days.has(dayKey(t))) { n++; t -= DAY; }
  return n;
}

export function daySummary(index, log, states, { now = Date.now(), retention = 0.9 } = {}) {
  const today = dayKey(now);
  const todays = log.filter(e => dayKey(e.t) === today);
  const firstOf = new Map();
  for (const e of [...todays].sort((a, b) => a.t - b.t)) if (!firstOf.has(e.c)) firstOf.set(e.c, e);
  const firsts = [...firstOf.values()];
  const correct = firsts.filter(isCorrect).length;
  const tomorrowEnd = dayEnd(now) + DAY;
  let tomorrow = 0;
  for (const s of states.values()) if (s.card.due.getTime() < tomorrowEnd) tomorrow++;
  const mastered = [...states.values()].filter(s => s.masteredDay === today).map(s => s.id);
  const sticky = [...firstOf.keys()].filter(c => isSticky(states.get(c)));
  return {
    cards: firsts.length,
    shown: todays.length,
    correct,
    ratio: firsts.length ? correct / firsts.length : 0,
    fresh: [...states.values()].filter(s => s.firstDay === today).length,
    mastered,
    tomorrow,
    sticky,
  };
}

// ───────── 현황 ─────────
// 얼마나 공부했는지(상태별·★별·장별), 얼마나 기억하는지(실제 기억률, 지금 기억 예상), 앞으로 7일 복습
export function overview(index, log, states, { now = Date.now(), retention = 0.9, days = 30 } = {}) {
  const f = makeScheduler(retention);
  const blank = () => ({ new: 0, learning: 0, mastered: 0, long: 0, total: 0 });
  const all = blank();
  const byStar = { 3: blank(), 2: blank(), 1: blank() };
  const byUnit = new Map(index.units.map(u => [u.id, { unit: u, ...blank() }]));
  let rSum = 0, rN = 0;
  for (const x of index.items) {
    const s = states.get(x.id);
    const st = statusOf(s);
    for (const g of [all, byStar[x.star], byUnit.get(x.unit)]) { if (!g) continue; g[st]++; g.total++; }
    if (s) { rSum += f.get_retrievability(s.card, new Date(now), false); rN++; }
  }
  // 실제 기억률: 최근 days일 동안 "복습"(처음 본 날이 아닌 날의 그날 첫 답)에서 맞힌 비율
  const since = now - days * DAY;
  const firstOfDay = new Map();
  for (const e of [...log].sort((a, b) => a.t - b.t)) {
    const k = e.c + '|' + dayKey(e.t);
    if (!firstOfDay.has(k)) firstOfDay.set(k, e);
  }
  let rev = 0, revOk = 0;
  for (const e of firstOfDay.values()) {
    const s = states.get(e.c);
    if (e.t < since || !s || s.firstDay === dayKey(e.t)) continue;
    rev++;
    if (isCorrect(e)) revOk++;
  }
  // 앞으로 7일 복습 예상 (오늘 포함, 오늘 것은 아직 안 본 것만)
  const today = dayKey(now);
  const end0 = dayEnd(now);
  const ahead = Array.from({ length: 7 }, (_, i) => ({ day: dayKey(end0 + (i - 1) * DAY + HOUR), n: 0 }));
  for (const s of states.values()) {
    const due = s.card.due.getTime();
    if (due < end0) { if (s.lastDay !== today) ahead[0].n++; continue; }
    const i = Math.floor((due - end0) / DAY) + 1;
    if (i < 7) ahead[i].n++;
  }
  const studyDays = new Set(log.map(e => dayKey(e.t))).size;
  const sticky = [...states.values()].filter(isSticky).sort((a, b) => b.fails - a.fails).map(s => s.id);
  return {
    all, byStar, byUnit: [...byUnit.values()],
    started: rN,
    recall: rN ? rSum / rN : null,            // 지금 기억하고 있을 확률(공부한 단어 평균)
    actual: rev ? revOk / rev : null,          // 최근 실제 기억률
    reviews: rev,
    ahead, studyDays, total: log.length, sticky,
  };
}

// 내가 누른 답별 목록: 카드마다 마지막 답(1 모름·틀림, 2 헷갈림, 3 알 것 같음, 4 확실히 앎)과 답별 횟수
export const MARKS = [
  { b: 1, name: '모름', sub: '모름 + 확인에서 틀림' },
  { b: 2, name: '헷갈림', sub: '' },
  { b: 3, name: '알 것 같음', sub: '정답 확인에서 맞음' },
  { b: 4, name: '확실히 앎', sub: '정답 확인에서 맞음' },
];
export function answerMarks(log) {
  const out = new Map();
  for (const e of [...log].sort((a, b) => a.t - b.t)) {
    const r = ratingOf(e);
    let m = out.get(e.c);
    if (!m) { m = { id: e.c, last: r, lastT: e.t, n: [0, 0, 0, 0, 0] }; out.set(e.c, m); }
    m.n[r]++; m.last = r; m.lastT = e.t;
  }
  return out;
}
// mode 'last' = 마지막에 누른 답이 b, 'ever' = 한 번이라도 b. 최근 순.
export function marksList(marks, b, mode = 'last') {
  return [...marks.values()].filter(m => (mode === 'ever' ? m.n[b] > 0 : m.last === b)).sort((x, y) => y.lastT - x.lastT);
}

// ───────── 내 단어 목록의 공부 순서 ─────────
// mode: 'rec' 추천 순서 | 'added' 넣은 순서(교재·교수님 목록을 붙여 넣은 순서 그대로) | 'units' 단원 순서 직접(units = 단원 id 순서) | 'star' ★ 높은 것부터
// 어느 순서든 단어 바로 앞에 아직 안 나온 그 단어의 조각을 넣는다.
export const LIST_ORDERS = [
  ['rec', '추천 순서', '조각 → 인체 → 계통별 → 약어'],
  ['added', '넣은 순서', '교재·교수님 목록을 붙여 넣은 순서 그대로'],
  ['units', '단원 순서 직접', '교재 목차대로 단원 순서를 바꿔요'],
  ['star', '★ 높은 것부터', '자주 나오는 단어 먼저'],
];
export function listOrder(index, ids, { mode = 'rec', units = null } = {}) {
  const chosen = ids.filter(id => index.byId.has(id));
  const set = new Set(chosen);
  for (const id of chosen) { const x = index.byId.get(id); if (x.k === 'word') for (const f of x.parts || []) if (index.byId.has('p:' + f)) set.add('p:' + f); }
  const rec = newOrder(index, 'all').filter(id => set.has(id));
  const recPos = new Map(rec.map((id, i) => [id, i]));
  let seq;
  if (mode === 'added') seq = chosen;
  else if (mode === 'units') {
    const pos = new Map((units || index.units.map(u => u.id)).map((u, i) => [u, i]));
    const up = id => pos.has(index.byId.get(id).unit) ? pos.get(index.byId.get(id).unit) : 999;
    seq = [...rec].sort((a, b) => up(a) - up(b) || recPos.get(a) - recPos.get(b));
  } else if (mode === 'star') {
    seq = [...rec].sort((a, b) => index.byId.get(b).star - index.byId.get(a).star || recPos.get(a) - recPos.get(b));
  } else seq = rec;
  const out = [], placed = new Set();
  const put = id => { if (!placed.has(id) && set.has(id)) { placed.add(id); out.push(id); } };
  for (const id of seq) {
    const x = index.byId.get(id);
    if (x.k === 'word') for (const f of x.parts || []) put('p:' + f);
    put(id);
  }
  for (const id of rec) put(id);
  return out;
}

// ───────── 단어 묶음 하나의 현황 (전체·추천 범위·내 단어 목록마다) ─────────
// 상태별 수, 마지막에 누른 답별 수(1 모름·틀림 2 헷갈림 3 알 것 같음 4 확실히 앎, 0 아직 안 봄),
// 최근 days일 복습 정답률, 오늘 본 수, 지금 기억 확률 평균
export function setSummary(index, states, log, ids, { now = Date.now(), retention = 0.9, days = 30 } = {}) {
  const set = ids instanceof Set ? ids : new Set(ids);
  const f = makeScheduler(retention);
  const st = { new: 0, learning: 0, mastered: 0, long: 0 };
  const last = [0, 0, 0, 0, 0];
  let total = 0, rSum = 0, rN = 0;
  const lastAns = new Map();
  for (const e of [...log].sort((a, b) => a.t - b.t)) if (set.has(e.c)) lastAns.set(e.c, ratingOf(e));
  for (const id of set) {
    if (!index.byId.has(id)) continue;
    total++;
    const s = states.get(id);
    st[statusOf(s)]++;
    last[lastAns.get(id) || 0]++;
    if (s) { rSum += f.get_retrievability(s.card, new Date(now), false); rN++; }
  }
  const today = dayKey(now), since = now - days * DAY;
  const seen = new Set();
  let rev = 0, ok = 0;
  const todayIds = new Set();
  for (const e of [...log].sort((a, b) => a.t - b.t)) {
    if (!set.has(e.c)) continue;
    const d = dayKey(e.t);
    if (d === today) todayIds.add(e.c);
    const k = e.c + '|' + d;
    if (seen.has(k)) continue;
    seen.add(k);
    const s = states.get(e.c);
    if (e.t < since || !s || s.firstDay === d) continue;
    rev++; if (isCorrect(e)) ok++;
  }
  return {
    total, status: st, last, started: rN,
    done: st.mastered + st.long,
    pct: total ? Math.round(((st.mastered + st.long) / total) * 100) : 0,
    recall: rN ? rSum / rN : null,
    actual: rev ? ok / rev : null, reviews: rev,
    today: todayIds.size,
  };
}

// ───────── 그룹(계통) 먼저·나중에 ─────────
// focus = { first: [단원 id 순서], later: [단원 id] }. 원래 순서에서 first 단원을 맨 앞으로, later 단원을 맨 뒤로.
// 이미 배운 단어는 pickNew가 건너뛰므로, 먼저 한 그룹을 다 하면 다음 그룹으로 자연스럽게 넘어간다.
// 단어를 앞으로 당겨도 그 단어의 조각이 바로 앞에 오도록 다시 놓는다.
export function focusOrder(index, order, focus) {
  const first = (focus && focus.first) || [], later = (focus && focus.later) || [];
  if (!first.length && !later.length) return order;
  const bucket = id => { const u = index.byId.get(id).unit; const f = first.indexOf(u); return f >= 0 ? f : later.includes(u) ? 1000 + later.indexOf(u) : 500; };
  const pos = new Map(order.map((id, i) => [id, i]));
  const seq = [...order].sort((a, b) => bucket(a) - bucket(b) || pos.get(a) - pos.get(b));
  const keep = new Set(order);
  const out = [], placed = new Set();
  const put = id => { if (!placed.has(id) && keep.has(id)) { placed.add(id); out.push(id); } };
  for (const id of seq) {
    const x = index.byId.get(id);
    if (x.k === 'word') for (const f of x.parts || []) put('p:' + f);
    put(id);
  }
  return out;
}
