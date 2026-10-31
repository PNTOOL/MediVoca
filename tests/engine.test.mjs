import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNITS, PAIRS, CONFUSIONS } from '../data/index.js';
import { buildIndex } from '../src/data.js';
import {
  RULES, dayKey, dayEnd, ratingOf, replay, statusOf, newOrder, pickNew, planToday,
  newSession, current, answer, isDone, progress, streak, daySummary, isSticky,
} from '../src/engine.js';

const IX = buildIndex(UNITS, PAIRS, CONFUSIONS);
const DAY = 86400000;
const T0 = new Date(2026, 10, 2, 10, 0).getTime(); // 2026-11-02 10:00 (서울)
const ev = (t, c, b, ok) => (b >= 3 ? { t, c, b, ok, d: 'A' } : { t, c, b, d: 'A' });

test('하루는 새벽 4시에 바뀐다', () => {
  const late = new Date(2026, 10, 3, 2, 0).getTime(); // 11/3 02:00 → 아직 11/2
  assert.equal(dayKey(late), '2026-11-02');
  assert.equal(dayKey(new Date(2026, 10, 3, 4, 0).getTime()), '2026-11-03');
  assert.equal(dayEnd(T0), new Date(2026, 10, 3, 4, 0).getTime());
});

test('버튼 4단계 → FSRS, 3·4에서 틀리면 다시', () => {
  assert.equal(ratingOf({ b: 1 }), 1);
  assert.equal(ratingOf({ b: 2 }), 2);
  assert.equal(ratingOf({ b: 3, ok: true }), 3);
  assert.equal(ratingOf({ b: 4, ok: true }), 4);
  assert.equal(ratingOf({ b: 3, ok: false }), 1);
  assert.equal(ratingOf({ b: 4, ok: false }), 1);
});

test('처음 다시 보는 날: 모름 1일, 알 것 같음 3일, 확실히 앎 8일 안팎', () => {
  const days = b => {
    const s = replay([ev(T0, 'w:x', b, true)]).get('w:x');
    return Math.round((s.card.due - T0) / DAY);
  };
  assert.equal(days(1), 1);
  assert.ok(days(2) >= 1 && days(2) <= 2);
  assert.ok(days(3) >= 3 && days(3) <= 4);
  assert.ok(days(4) >= 7 && days(4) <= 16);
});

test('같은 날 다시 본 것은 FSRS에 한 번만 들어간다', () => {
  const a = replay([ev(T0, 'w:x', 1)]).get('w:x');
  const b = replay([ev(T0, 'w:x', 1), ev(T0 + 60000, 'w:x', 3, true), ev(T0 + 120000, 'w:x', 3, true)]).get('w:x');
  assert.equal(a.card.due.getTime(), b.card.due.getTime());
  assert.equal(b.n, 3);
  assert.equal(b.goodDays.size, 0); // 그날 처음이 모름이면 맞힌 날이 아니다
});

test('다른 날 3번 맞히면 익힘, 간격 21일 이상이면 오래 기억', () => {
  const log = [];
  let t = T0;
  const st = () => replay(log).get('w:x');
  log.push(ev(t, 'w:x', 1));
  assert.equal(statusOf(st()), 'learning');
  for (let i = 0; i < 3; i++) { t = st().card.due.getTime(); log.push(ev(t, 'w:x', 3, true)); }
  assert.ok(['mastered', 'long'].includes(statusOf(st())));
  while (statusOf(st()) !== 'long') { t = st().card.due.getTime(); log.push(ev(t, 'w:x', 3, true)); }
  const s = st();
  assert.ok((s.card.due - s.card.last_review) / DAY >= 21);
  assert.equal(statusOf(undefined), 'new');
});

test('모름 뒤 계속 맞히면 1 → 3 → 8 → 약 3주 → 약 7주', () => {
  const log = [ev(T0, 'w:x', 1)];
  const gaps = [];
  for (let i = 0; i < 4; i++) {
    const s = replay(log).get('w:x');
    gaps.push(Math.round((s.card.due - s.card.last_review) / DAY));
    log.push(ev(s.card.due.getTime(), 'w:x', 3, true));
  }
  assert.deepEqual(gaps.slice(0, 3), [1, 3, 8]);
  assert.ok(gaps[3] >= 18 && gaps[3] <= 25);
});

test('기록 순서가 섞여도 결과가 같다 (두 기기 합치기)', () => {
  const log = [ev(T0, 'w:a', 1), ev(T0 + DAY, 'w:a', 3, true), ev(T0 + 2 * DAY, 'w:b', 4, true)];
  const x = replay(log), y = replay([...log].reverse());
  for (const id of ['w:a', 'w:b']) assert.equal(x.get(id).card.due.getTime(), y.get(id).card.due.getTime());
});

test('6번 넘게 틀리면 끈질긴 단어', () => {
  const log = [];
  for (let i = 0; i < 7; i++) log.push(ev(T0 + i * DAY, 'w:x', 1));
  assert.ok(isSticky(replay(log).get('w:x')));
  assert.ok(!isSticky(replay(log.slice(0, 6)).get('w:x')));
});

test('새 단어 순서: 모든 항목, 조각이 단어보다 먼저, 핵심이 확장보다 먼저', () => {
  const order = newOrder(IX);
  assert.equal(order.length, IX.items.length);
  assert.equal(new Set(order).size, IX.items.length);
  const pos = new Map(order.map((id, i) => [id, i]));
  for (const x of IX.items) if (x.k === 'word') for (const f of x.parts || []) assert.ok(pos.get('p:' + f) < pos.get(x.id), x.id + ' 앞에 ' + f);
  const lastCoreWord = Math.max(...IX.items.filter(x => x.stage === 'core').map(x => pos.get(x.id)));
  const firstExtNotNeeded = order.findIndex(id => IX.get(id).stage === 'ext' && IX.get(id).k !== 'part');
  assert.ok(firstExtNotNeeded > lastCoreWord);
});

test('헷갈리는 짝은 같은 날 처음 배우지 않는다', () => {
  const order = newOrder(IX);
  const picked = pickNew(IX, new Map(), IX.items.length, { order, now: T0 });
  for (const p of PAIRS) {
    const a = (p.sa || []).some(id => picked.includes(id));
    const b = (p.sb || []).some(id => picked.includes(id));
    assert.ok(!(a && b), p.t);
  }
  // 한쪽이 익힘이 되면 다른 쪽이 나온다
  const hyper = 'p:hyper-', hypo = 'p:hypo-';
  const one = pickNew(IX, new Map(), IX.items.length, { order, now: T0 });
  assert.ok(one.includes(hyper) !== one.includes(hypo));
});

test('조각을 안 배운 단어는 새 단어로 나오지 않는다', () => {
  const picked = pickNew(IX, new Map(), 60, { now: T0 });
  const set = new Set(picked);
  for (const id of picked) {
    const x = IX.get(id);
    if (x.k === 'word') for (const f of x.parts || []) assert.ok(set.has('p:' + f), id + ' ← ' + f);
  }
});

test('하루 50장: 처음엔 새 단어 30개(최대), 복습이 많아도 최소 5개, 빠진 날이 있으면 새 단어를 쉰다', () => {
  const p0 = planToday(IX, new Map(), { now: T0 });
  assert.equal(p0.reviews.length, 0);
  assert.equal(p0.fresh.length, RULES.newMax);

  const mk = (n, ago = 1) => { const log = []; IX.items.slice(0, n).forEach((x, i) => log.push(ev(T0 - ago * DAY + i, x.id, 1))); return replay(log); };
  const p1 = planToday(IX, mk(40), { now: T0 });
  assert.equal(p1.reviews.length, 40);
  assert.equal(p1.fresh.length, 10);

  const p2 = planToday(IX, mk(48), { now: T0 });
  assert.equal(p2.fresh.length, RULES.newMin); // 최소 5

  const p3 = planToday(IX, mk(70), { now: T0 });  // 매일 했는데 오늘 복습이 70장 → 그래도 새 단어 5개
  assert.ok(!p3.backlog);
  assert.equal(p3.fresh.length, RULES.newMin);

  const p4 = planToday(IX, mk(120, 3), { now: T0 }); // 이틀 빠져서 밀림 → 새 단어 쉬고 복습은 100장까지
  assert.ok(p4.backlog);
  assert.equal(p4.fresh.length, 0);
  assert.equal(p4.reviews.length, RULES.reviewMax);
});

test('오늘 이미 본 만큼은 빼고 남은 할 일만 나온다', () => {
  const p = planToday(IX, new Map(), { now: T0 });
  const log = p.fresh.slice(0, 12).map((c, i) => ev(T0 + i * 1000, c, 3, true));
  const p2 = planToday(IX, replay(log), { now: T0 + 3600000 });
  assert.equal(p2.fresh.length, RULES.newMax - 12);
  assert.equal(p2.newToday, 12);
});

test('세션: 모름은 5장 뒤에 다시, 맞힐 때까지, 끝에 한 번 더', () => {
  const plan = { day: dayKey(T0), reviews: [], fresh: ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'] };
  const s = newSession(plan, { now: T0 });
  assert.equal(current(s).c, 'c0');
  answer(s, 1, undefined, { now: T0 });               // c0 모름
  assert.equal(s.queue[5].c, 'c0');
  assert.equal(s.queue[5].kind, 'again');
  const order = [];
  let guard = 0;
  while (!isDone(s) && guard++ < 50) {
    const c = current(s);
    order.push(c.c + ':' + c.kind);
    answer(s, 3, true, { now: T0 });                   // 나머지는 모두 맞힘
  }
  assert.deepEqual(order, ['c1:new', 'c2:new', 'c3:new', 'c4:new', 'c5:new', 'c0:again', 'c6:new', 'c7:new', 'c0:final']);
  assert.equal(s.doneCards, 8);
});

test('세션: 헷갈림은 다시 나오지만 끝에 한 번 더는 없다, 안다고 했는데 틀리면 모름과 같다', () => {
  const s = newSession({ day: 'd', reviews: ['a'], fresh: ['b'] });
  const e1 = answer(s, 2);                 // a 헷갈림
  assert.equal(e1.b, 2);
  const e2 = answer(s, 4, false);          // b 확실히 앎 → 틀림
  assert.equal(e2.ok, false);
  assert.deepEqual(s.queue.map(q => q.c), ['a', 'b']);
  answer(s, 3, true); answer(s, 3, true);
  assert.deepEqual(s.queue.map(q => q.c), []);
  assert.equal(current(s).c, 'b');         // b만 끝에 한 번 더
  assert.equal(current(s).kind, 'final');
  answer(s, 3, true);
  assert.ok(isDone(s));
});

test('세션: 카드가 하나뿐이면 바로 다시 나온다', () => {
  const s = newSession({ day: 'd', reviews: [], fresh: ['a'] });
  answer(s, 1);
  assert.equal(current(s).c, 'a');
  assert.equal(current(s).kind, 'again');
});

test('진도는 익힘 이상만 세고, 연속 공부일을 센다', () => {
  const pr = progress(IX, new Map());
  assert.equal(pr.new, pr.total);
  assert.equal(pr.doneRatio, 0);
  const log = [ev(T0 - 2 * DAY, 'w:x', 3, true), ev(T0 - DAY, 'w:x', 3, true), ev(T0, 'w:x', 3, true)];
  assert.equal(streak(log, T0), 3);
  assert.equal(streak(log.slice(0, 2), T0), 2); // 오늘 아직 안 함 → 어제까지
  assert.equal(streak(log.slice(0, 1), T0), 0);
});

test('오늘 요약: 맞힌 비율은 처음 본 결과로, 다시 본 것은 장수에 안 센다', () => {
  const log = [ev(T0, 'w:a', 1), ev(T0 + 1, 'w:b', 3, true), ev(T0 + 2, 'w:a', 3, true)];
  const sum = daySummary(IX, log, replay(log), { now: T0 + 10 });
  assert.equal(sum.cards, 2);
  assert.equal(sum.shown, 3);
  assert.equal(sum.correct, 1);
  assert.equal(sum.fresh, 2);
  assert.ok(sum.tomorrow >= 1); // 모름은 내일 다시
});

// ───────── 공부 계획 ─────────
import { scopeSet, paceInfo, daysBetween, reviewOnlyDays } from '../src/engine.js';

test('범위: ★★★만 < 핵심 < 전체, 필요한 조각은 함께 들어간다', () => {
  const s3 = scopeSet(IX, 'star3'), core = scopeSet(IX, 'core'), all = scopeSet(IX, 'all');
  assert.ok(s3.size < core.size && core.size < all.size);
  assert.equal(all.size, IX.items.length);
  for (const id of s3) { const x = IX.get(id); if (x.k === 'word') for (const f of x.parts || []) assert.ok(s3.has('p:' + f)); }
  const order = newOrder(IX, 'star3');
  assert.equal(order.length, s3.size);
  const p = planToday(IX, new Map(), { now: T0, scope: 'star3' });
  for (const id of p.fresh) assert.ok(s3.has(id));
});

test('하루 장수 30/80: 새 단어 최대가 같이 바뀐다', () => {
  assert.equal(planToday(IX, new Map(), { now: T0, pace: { mode: 'daily', cards: 30 } }).fresh.length, 18);
  assert.equal(planToday(IX, new Map(), { now: T0, pace: { mode: 'daily', cards: 80 } }).fresh.length, 48);
});

test('날짜까지 끝내기: 남은 수 ÷ 새 단어 넣는 날, 마지막은 복습만', () => {
  assert.equal(daysBetween('2026-11-02', '2026-12-28'), 56);
  assert.equal(reviewOnlyDays(56), 12);
  assert.equal(reviewOnlyDays(14), 7);
  const pace = { mode: 'goal', end: '2026-12-28' }; // 8주
  const info = paceInfo(IX, new Map(), { pace, scope: 'all', now: T0 });
  assert.equal(info.newDays, 44);
  assert.equal(info.perDay, Math.ceil(IX.items.length / 44));
  const p = planToday(IX, new Map(), { now: T0, pace, scope: 'all' });
  assert.equal(p.fresh.length, info.perDay);
  // 밀린 복습이 많아도 쉬지 않는다
  const log = []; IX.items.slice(0, 120).forEach((x, i) => log.push(ev(T0 - DAY + i, x.id, 1)));
  assert.ok(planToday(IX, replay(log), { now: T0, pace, scope: 'all' }).fresh.length > 0);
  // 복습만 하는 기간
  const late = paceInfo(IX, new Map(), { pace: { mode: 'goal', end: '2026-11-08' }, now: T0 });
  assert.equal(late.daysLeft, 6);
  assert.equal(late.perDay, Math.ceil(IX.items.length / 3));
  // 10일 계획(11/2~11/12)은 마지막 5일이 복습만: 11/9에는 새 단어 없음
  const ten = { mode: 'goal', start: '2026-11-02', end: '2026-11-12' };
  assert.equal(paceInfo(IX, new Map(), { pace: ten, now: T0 }).newDays, 5);
  const nov9 = T0 + 7 * DAY;
  assert.ok(paceInfo(IX, new Map(), { pace: ten, now: nov9 }).reviewPhase);
  assert.equal(planToday(IX, new Map(), { now: nov9, pace: ten }).fresh.length, 0);
  // 날짜가 지나면 기본(하루 50장)으로
  const over = planToday(IX, new Map(), { now: T0, pace: { mode: 'goal', end: '2026-11-01' } });
  assert.ok(over.goal.ended);
  assert.equal(over.fresh.length, RULES.newMax);
});

test('오늘 이미 넣은 새 단어를 빼도 하루 목표 수는 그대로다', () => {
  const pace = { mode: 'goal', end: '2026-12-28' };
  const p = planToday(IX, new Map(), { now: T0, pace });
  const log = p.fresh.slice(0, 5).map((c, i) => ev(T0 + i, c, 3, true));
  const p2 = planToday(IX, replay(log), { now: T0 + 1000, pace });
  assert.equal(p2.goal.perDay, p.goal.perDay);
  assert.equal(p2.fresh.length, p.fresh.length - 5);
});

// ───────── 중요도 범위와 현황 ─────────
import { scopeStars, scopeLabel, normScope, overview } from '../src/engine.js';

test('범위는 ★ 조합으로 고른다', () => {
  assert.deepEqual([...scopeStars('star3')], [3]);
  assert.equal(normScope('core'), '32');
  assert.equal(normScope('13'), '31');
  assert.equal(scopeLabel('321'), '전체');
  assert.equal(scopeLabel('31'), '★★★ · ★');
  const only1 = scopeSet(IX, '1');
  for (const id of only1) { const x = IX.get(id); assert.ok(x.star === 1 || x.k === 'part', id); }
  assert.equal(scopeSet(IX, '32').size, scopeSet(IX, 'core').size);
  const p = planToday(IX, new Map(), { now: T0, scope: '1' });
  for (const id of p.fresh) assert.ok(only1.has(id));
});

test('현황: 상태별·★별·장별 수, 실제 기억률, 앞으로 7일 복습', () => {
  const log = [ev(T0, 'w:dyspnea', 1), ev(T0 + DAY, 'w:dyspnea', 3, true), ev(T0 + DAY, 'w:apnea', 3, true), ev(T0 + 2 * DAY, 'w:apnea', 1)];
  const st = replay(log);
  const o = overview(IX, log, st, { now: T0 + 2 * DAY + 1000 });
  assert.equal(o.all.total, IX.items.length);
  assert.equal(o.all.learning, 2);
  assert.equal(o.byStar[3].total + o.byStar[2].total + o.byStar[1].total, IX.items.length);
  assert.equal(o.byUnit.length, IX.units.length);
  // 복습은 dyspnea 2일째(맞음), apnea 3일째(틀림) → 50%
  assert.equal(o.reviews, 2);
  assert.equal(o.actual, 0.5);
  assert.ok(o.recall > 0 && o.recall <= 1);
  assert.equal(o.ahead.length, 7);
  assert.equal(o.studyDays, 3);
});

test('범위에 단원을 더할 수 있다 (★ + 단원)', async () => {
  const { scopeUnits, makeScope } = await import('../src/engine.js');
  const sc = makeScope([3, 2], ['m06', 'm05']);
  assert.equal(sc, '32|m05.m06');
  assert.deepEqual([...scopeUnits(sc)], ['m05', 'm06']);
  assert.equal(scopeLabel(sc), '핵심 (★★ 이상) · 2개 단원');
  const set = scopeSet(IX, sc);
  for (const id of set) { const x = IX.get(id); assert.ok(['m05', 'm06'].includes(x.unit) || x.k === 'part', id); assert.ok(x.star >= 2 || x.k === 'part'); }
  const p = planToday(IX, new Map(), { now: T0, scope: sc });
  for (const id of p.fresh) assert.ok(set.has(id));
  assert.equal(normScope('321'), '321');
});

test('내 단어(my): 고른 단어와 필요한 조각만', () => {
  const ix = buildIndex(UNITS, PAIRS, CONFUSIONS);
  ix.myList = ['w:dyspnea', 'a:NPO'];
  const set = scopeSet(ix, 'my');
  assert.ok(set.has('w:dyspnea') && set.has('a:NPO') && set.has('p:dys-') && set.has('p:-pnea'));
  assert.equal(normScope('my'), 'my');
  assert.equal(scopeLabel('my'), '내 단어');
  const p = planToday(ix, new Map(), { now: T0, scope: 'my', order: newOrder(ix, 'my') });
  assert.deepEqual(new Set(p.fresh), set);
});

import { answerMarks, marksList } from '../src/engine.js';
test('답별 목록: 마지막 답과 한 번이라도', () => {
  const log = [
    { t: 1, c: 'w:a', b: 1, d: 'x' }, { t: 2, c: 'w:a', b: 4, ok: true, d: 'x' },
    { t: 3, c: 'w:b', b: 3, ok: false, d: 'x' }, { t: 4, c: 'w:c', b: 2, d: 'x' },
  ];
  const m = answerMarks(log);
  assert.equal(m.get('w:a').last, 4);
  assert.equal(m.get('w:b').last, 1); // 알 것 같음인데 틀림 → 모름
  assert.deepEqual(marksList(m, 1).map(z => z.id), ['w:b']);
  assert.deepEqual(marksList(m, 1, 'ever').map(z => z.id), ['w:b', 'w:a']);
  assert.deepEqual(marksList(m, 2).map(z => z.id), ['w:c']);
});

import { listOrder } from '../src/engine.js';
test('내 단어 목록 순서: 넣은 순서·단원 순서·조각은 단어 앞', () => {
  const ix = buildIndex(UNITS, PAIRS, CONFUSIONS);
  const w = ix.items.filter(x => x.k === 'word' && (x.parts || []).length >= 2);
  const a = w[w.length - 1], b = w[0];
  const added = listOrder(ix, [a.id, b.id], { mode: 'added' });
  assert.ok(added.indexOf(a.id) < added.indexOf(b.id));
  for (const f of a.parts) if (ix.byId.has('p:' + f)) assert.ok(added.indexOf('p:' + f) < added.indexOf(a.id));
  const units = [...ix.units.map(u => u.id)].reverse();
  const byUnit = listOrder(ix, [a.id, b.id], { mode: 'units', units });
  assert.ok(byUnit.indexOf(a.id) < byUnit.indexOf(b.id));
  ix.myList = [a.id, b.id]; ix.myOrder = { mode: 'added' };
  assert.deepEqual(newOrder(ix, 'my'), added);
});

import { setSummary } from '../src/engine.js';
test('묶음 현황: 상태·마지막 답·오늘', () => {
  const ix = buildIndex(UNITS, PAIRS, CONFUSIONS);
  const ids = ix.items.slice(0, 5).map(x => x.id);
  const now = Date.UTC(2026, 9, 31, 3);
  const log = [
    { t: now - 1000, c: ids[0], b: 1, d: 'x' },
    { t: now - 900, c: ids[1], b: 2, d: 'x' },
    { t: now - 800, c: ids[2], b: 4, ok: true, d: 'x' },
    { t: now - 700, c: ids[3], b: 3, ok: false, d: 'x' },
  ];
  const states = replay(log);
  const r = setSummary(ix, states, log, ids, { now });
  assert.equal(r.total, 5);
  assert.deepEqual(r.last, [1, 2, 1, 0, 1]);
  assert.equal(r.status.new, 1);
  assert.equal(r.today, 4);
});

import { makeSyl, isSyl, sylUnits } from '../src/engine.js';
test('강의 순서: 단원 순서대로 새 단어, 범위·이름', () => {
  const ix = buildIndex(UNITS, PAIRS, CONFUSIONS);
  const sc = makeSyl([3, 2], ['m06', 'm05']);
  assert.ok(isSyl(sc));
  assert.equal(normScope(sc), sc);
  assert.deepEqual(sylUnits(sc), ['m06', 'm05']);
  assert.match(scopeLabel(sc), /학교 수업 · 2개 단원/);
  const set = scopeSet(ix, sc);
  for (const id of set) { const x = ix.byId.get(id); if (x.k !== 'part') assert.ok(['m06', 'm05'].includes(x.unit) && x.star >= 2); }
  const order = newOrder(ix, sc);
  const firstM5 = order.findIndex(id => ix.byId.get(id).unit === 'm05' && ix.byId.get(id).k !== 'part');
  const lastM6 = order.map(id => ix.byId.get(id)).map((x, i) => (x.unit === 'm06' && x.k !== 'part' ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  assert.ok(lastM6 < firstM5, '심혈관(m06)을 다 넣은 뒤 근골격(m05)');
  const p = planToday(ix, new Map(), { now: Date.UTC(2026, 9, 31, 3), scope: sc, order });
  assert.ok(p.fresh.length > 0);
});

import { focusOrder } from '../src/engine.js';
test('그룹 먼저·나중에: 고른 단원이 앞으로, 조각은 단어 앞에', () => {
  const ix = buildIndex(UNITS, PAIRS, CONFUSIONS);
  const order = newOrder(ix, '321');
  const fo = focusOrder(ix, order, { first: ['m08'], later: ['m01'] });
  assert.equal(fo.length, order.length);
  const firstWord = fo.find(id => ix.byId.get(id).k === 'word');
  assert.equal(ix.byId.get(firstWord).unit, 'm08');
  const w = ix.byId.get(firstWord);
  for (const f of w.parts) if (ix.byId.has('p:' + f)) assert.ok(fo.indexOf('p:' + f) < fo.indexOf(firstWord));
  const lastWord = [...fo].reverse().find(id => ix.byId.get(id).k !== 'part');
  assert.equal(ix.byId.get(lastWord).unit, 'm01');
  const p = planToday(ix, new Map(), { now: Date.UTC(2026, 9, 31, 3), scope: '321', order: fo, extraNew: 10 });
  assert.ok(p.fresh.some(id => ix.byId.get(id).unit === 'm08' && ix.byId.get(id).k === 'word'));
});
