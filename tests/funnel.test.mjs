import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNITS, PAIRS, CONFUSIONS } from '../data/index.js';
import { buildIndex } from '../src/data.js';
import { replay, answerMarks } from '../src/engine.js';
import { runFunnel, countIf, groupsIn } from '../src/funnel.js';

const IX = buildIndex(UNITS, PAIRS, CONFUSIONS);
const T = Date.UTC(2026, 9, 31, 3);
const w = IX.items.filter(x => x.k === 'word');
const log = [
  { t: T, c: w[0].id, b: 1, d: 'x' }, { t: T + 1, c: w[1].id, b: 2, d: 'x' },
  { t: T + 2, c: w[2].id, b: 4, ok: true, d: 'x' }, { t: T + 3, c: w[3].id, b: 3, ok: true, d: 'x' },
];
const ctx = { states: replay(log), marks: answerMarks(log), listIds: [w[5].id, w[6].id] };
const base = { src: 'all', ans: '', star: '', kind: '', units: [], conf: 'off', grp: -1, mates: false };

test('단계마다 줄어든다', () => {
  const r = runFunnel(IX, ctx, { ...base, star: '3', kind: 'w' });
  const n = r.sets.map(s => s.length);
  for (let i = 1; i < n.length; i++) assert.ok(n[i] <= n[i - 1]);
  assert.ok(r.result.every(x => x.star === 3 && x.k === 'word'));
});
test('공부한 단어 중에서: 마지막 답 여러 개', () => {
  assert.equal(runFunnel(IX, ctx, { ...base, src: 'studied' }).result.length, 4);
  assert.deepEqual(runFunnel(IX, ctx, { ...base, src: 'studied', ans: '12' }).result.map(x => x.id).sort(), [w[0].id, w[1].id].sort());
  assert.equal(runFunnel(IX, ctx, { ...base, src: 'new' }).result.length, IX.items.length - 4);
  assert.equal(runFunnel(IX, ctx, { ...base, src: 'list' }).result.length, 2);
});
test('칩 미리 보기 수와 헷갈리는 묶음', () => {
  assert.equal(countIf(IX, ctx, base, 1, { star: '3' }), IX.items.filter(x => x.star === 3).length);
  const has = runFunnel(IX, ctx, { ...base, conf: 'has' }).result;
  assert.ok(has.length > 0 && has.every(x => IX.groupsOf.has(x.id)));
  const g = groupsIn(IX, has)[0];
  const one = runFunnel(IX, ctx, { ...base, conf: 'grp', grp: g.i }).result;
  assert.equal(one.length, g.n);
  const id = one[0].id;
  const mates = runFunnel(IX, ctx, { ...base, src: 'list', conf: 'off', mates: true });
  assert.ok(mates.result.length >= 2);
  assert.ok(id);
});
