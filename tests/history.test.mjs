import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayStats, weekSummary, masteredSeries, mergeHistory } from '../src/history.js';
import { replay, dayKey } from '../src/engine.js';

const T = Date.UTC(2026, 9, 31, 3); // 서울 정오
const log = [
  { t: T, c: 'w:a', b: 1, d: 'x' }, { t: T + 30000, c: 'w:a', b: 4, ok: true, d: 'x' },
  { t: T + 60000, c: 'w:b', b: 4, ok: true, d: 'x' },
  { t: T - 86400000, c: 'w:b', b: 3, ok: false, d: 'x' },
];
test('날짜별 장수·처음 본 단어·정답률·시간', () => {
  const st = dayStats(log);
  const today = st.get(dayKey(T));
  assert.equal(today.cards, 3);
  assert.equal(today.unique, 2);
  assert.equal(today.fresh, 1);           // w:b는 어제 처음 봤다
  assert.equal(today.firstOk, 1);         // w:a 첫 답은 모름, w:b는 맞음
  assert.deepEqual(today.ans, [0, 1, 0, 0, 2]);
  assert.equal(today.ms, 15000 + 30000 + 30000);
  const w = weekSummary(st, dayKey(T));
  assert.equal(w.thisWeek.cards, 4);
  assert.equal(w.thisWeek.days, 2);
});
test('익힘 추이와 기록 합치기', () => {
  const s = masteredSeries(replay(log), dayKey(T), 7);
  assert.equal(s.length, 7);
  assert.equal(s[6].day, dayKey(T));
  const a = [{ id: '1', t0: 1, label: '추천', n: 3 }];
  const r = mergeHistory(a, [{ id: '1', t0: 1, label: '추천', n: 5 }, { id: '2', t0: 2, label: '내 단어', n: 1 }, { bad: 1 }]);
  assert.equal(r.history.length, 2);
  assert.equal(r.history[0].n, 5);
  assert.equal(r.changed, 2);
});
