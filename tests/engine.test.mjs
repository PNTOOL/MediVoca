import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNITS, PAIRS } from '../data/index.js';
import { buildIndex } from '../src/data.js';
import {
  RULES, dayKey, dayEnd, ratingOf, replay, statusOf, newOrder, pickNew, planToday,
  newSession, current, answer, isDone, progress, streak, daySummary, isSticky,
} from '../src/engine.js';

const IX = buildIndex(UNITS, PAIRS);
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

test('새 단어 순서: 727개 모두, 조각이 단어보다 먼저, 핵심이 확장보다 먼저', () => {
  const order = newOrder(IX);
  assert.equal(order.length, 727);
  assert.equal(new Set(order).size, 727);
  const pos = new Map(order.map((id, i) => [id, i]));
  for (const x of IX.items) if (x.k === 'word') for (const f of x.parts || []) assert.ok(pos.get('p:' + f) < pos.get(x.id), x.id + ' 앞에 ' + f);
  const lastCoreWord = Math.max(...IX.items.filter(x => x.stage === 'core').map(x => pos.get(x.id)));
  const firstExtNotNeeded = order.findIndex(id => IX.get(id).stage === 'ext' && IX.get(id).k !== 'part');
  assert.ok(firstExtNotNeeded > lastCoreWord);
});

test('헷갈리는 짝은 같은 날 처음 배우지 않는다', () => {
  const order = newOrder(IX);
  const picked = pickNew(IX, new Map(), 727, { order, now: T0 });
  for (const p of PAIRS) {
    const a = (p.sa || []).some(id => picked.includes(id));
    const b = (p.sb || []).some(id => picked.includes(id));
    assert.ok(!(a && b), p.t);
  }
  // 한쪽이 익힘이 되면 다른 쪽이 나온다
  const hyper = 'p:hyper-', hypo = 'p:hypo-';
  const one = pickNew(IX, new Map(), 727, { order, now: T0 });
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

test('하루 50장: 처음엔 새 단어 30개(최대), 복습이 많으면 새 단어가 줄고, 50장을 넘으면 쉰다', () => {
  const p0 = planToday(IX, new Map(), { now: T0 });
  assert.equal(p0.reviews.length, 0);
  assert.equal(p0.fresh.length, RULES.newMax);

  const mk = n => { const log = []; IX.items.slice(0, n).forEach((x, i) => log.push(ev(T0 - DAY + i, x.id, 1))); return replay(log); };
  const p1 = planToday(IX, mk(40), { now: T0 });
  assert.equal(p1.reviews.length, 40);
  assert.equal(p1.fresh.length, 10);

  const p2 = planToday(IX, mk(48), { now: T0 });
  assert.equal(p2.fresh.length, RULES.newMin); // 최소 5

  const p3 = planToday(IX, mk(120), { now: T0 });
  assert.ok(p3.backlog);
  assert.equal(p3.fresh.length, 0);
  assert.equal(p3.reviews.length, RULES.reviewMax);
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
