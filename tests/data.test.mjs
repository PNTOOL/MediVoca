import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNITS, PAIRS, CONFUSIONS } from '../data/index.js';
import { buildIndex, checkData } from '../src/data.js';
import { gradeSpell, gradeMeaning, speakable, rich } from '../src/text.js';

test('단어 데이터 검사 통과: 16장, 조각·단어·약어 모두 있음', () => {
  assert.deepEqual(checkData(UNITS, PAIRS, CONFUSIONS), []);
  const ix = buildIndex(UNITS, PAIRS, CONFUSIONS);
  const n = k => ix.items.filter(x => x.k === k).length;
  assert.equal(ix.units.length, 16);
  assert.ok(n('part') >= 292 && n('word') >= 351 && n('abbr') >= 84);
  assert.equal(n('part') + n('word') + n('abbr'), ix.items.length);
});

test('검사가 빈 칸·중복·없는 조각을 잡는다', () => {
  const bad = [{ unit: { id: 'x', title: 'x' }, items: [
    { id: 'w:a', k: 'word', t: 'a', ko: [], star: 3, stage: 'core', parts: ['nope/o'] },
    { id: 'w:a', k: 'word', t: 'a', ko: ['에이'], star: 3, stage: 'core' },
  ] }];
  const errs = checkData(bad, [{ t: 'p', a: 'a', b: 'b', sa: ['w:zz'] }]).join('\n');
  assert.match(errs, /한글 뜻/);
  assert.match(errs, /겹쳐요/);
  assert.match(errs, /없는 조각 nope\/o/);
  assert.match(errs, /없는 항목 w:zz/);
});

test('조각 분해와 같은 조각 단어', () => {
  const ix = buildIndex(UNITS, PAIRS, CONFUSIONS);
  const w = ix.get('w:dyspnea');
  assert.ok(w);
  assert.deepEqual(ix.partsOf(w).map(p => p.t), w.parts);
  assert.ok(ix.family.get('p:-pnea').includes('w:dyspnea'));
});

test('채점과 글자 다루기', () => {
  assert.ok(gradeSpell(['dyspnea'], 'Dyspnea ').ok);
  assert.ok(gradeSpell(['dyspnea'], 'dispnea').near);
  assert.ok(gradeMeaning(['호흡곤란'], '호흡 곤란').ok);
  assert.ok(!gradeMeaning(['호흡곤란'], '무호흡').ok);
  assert.equal(speakable('cardi/o'), 'cardio');
  assert.equal(speakable('-itis'), 'itis');
  assert.equal(rich('**a** <b>'), '<b>a</b> &lt;b&gt;');
});
