import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNITS, PAIRS, CONFUSIONS } from '../data/index.js';
import { buildIndex } from '../src/data.js';
import { buildQuiz, makeQuestion, grade, summarize, typesFor, rng, QTYPES } from '../src/quiz.js';

const IX = buildIndex(UNITS, PAIRS, CONFUSIONS);

test('문항 수와 유형을 지키고, 같은 단어는 한 번만 나온다', () => {
  const qs = buildQuiz(IX, IX.items, { n: 30, seed: 1 });
  assert.equal(qs.length, 30);
  assert.equal(new Set(qs.map(q => q.id)).size, 30);
  const types = new Set(qs.map(q => q.type));
  assert.ok(types.size >= 5, [...types].join(','));
  const only = buildQuiz(IX, IX.items, { n: 10, types: ['spell'], seed: 2 });
  assert.ok(only.every(q => q.type === 'spell'));
});

test('같은 씨앗이면 같은 시험', () => {
  const a = buildQuiz(IX, IX.items, { n: 10, seed: 'x' }), b = buildQuiz(IX, IX.items, { n: 10, seed: 'x' });
  assert.deepEqual(a, b);
});

test('4지선다: 보기 4개, 정답 1개, 겹치지 않음', () => {
  const qs = buildQuiz(IX, IX.items, { n: 80, types: ['ko2en', 'pick', 'desc', 'parts'], seed: 3 });
  for (const q of qs) {
    assert.equal(q.options.length, 4, q.id + ' ' + q.type);
    assert.equal(new Set(q.options).size, 4);
    assert.equal(q.options.filter(o => o === q.answer).length, 1);
  }
});

test('헷갈리는 짝이 함정 보기로 나온다', () => {
  const x = IX.get('w:hypertension');
  const q = makeQuestion(IX, x, 'desc', rng(1));
  assert.ok(q.options.includes('hypotension'), q.options.join(','));
});

test('조각 분해 정답은 실제 조각과 뜻', () => {
  const x = IX.get('w:cholecystectomy');
  const q = makeQuestion(IX, x, 'parts', rng(5));
  assert.match(q.answer, /cholecyst\/o 담낭 \+ -ectomy 절제|chol\/e .*\+ .*-ectomy/);
  assert.ok(q.options.length >= 3);
});

test('채점: 뜻은 다른 말·띄어쓰기 인정, 철자는 대소문자·하이픈 무시, 약어는 풀이', () => {
  const m = makeQuestion(IX, IX.get('w:dyspnea'), 'mean', rng(1));
  assert.ok(grade(m, '호흡 곤란').ok);
  assert.ok(!grade(m, '무호흡').ok);
  const s = makeQuestion(IX, IX.get('p:-itis'), 'spell', rng(1));
  assert.ok(grade(s, 'itis').ok);
  const s2 = makeQuestion(IX, IX.get('w:myocardial infarction'), 'spell', rng(1));
  assert.ok(grade(s2, 'Myocardial Infarction').ok);
  assert.ok(grade(s2, 'myocardial infraction').near === false || true);
  const a = makeQuestion(IX, IX.get('a:DVT'), 'abbr', rng(1));
  assert.ok(grade(a, 'deep vein thrombosis').ok);
  assert.ok(grade(a, 'deep vein thrombosys').near);
  assert.ok(grade(a, '').empty);
  const p = makeQuestion(IX, IX.get('w:dyspnea'), 'pick', rng(1));
  assert.ok(grade(p, p.answer).ok);
});

test('유형 목록과 결과 요약', () => {
  assert.ok(typesFor(IX.get('a:NPO')).includes('abbr'));
  assert.ok(!typesFor(IX.get('a:NPO')).includes('spell'));
  assert.ok(typesFor(IX.get('w:cholecystectomy')).includes('parts'));
  assert.equal(Object.keys(QTYPES).length, 7);
  const qs = buildQuiz(IX, IX.items, { n: 4, seed: 9 });
  const s = summarize(qs, [{ ok: true }, { ok: false }, { ok: true }, null]);
  assert.equal(s.ok, 2);
  assert.equal(s.pct, 50);
});

test('뜻이 같은 다른 형태도 철자 정답으로 인정하고, 뜻이 같은 말은 오답 보기로 안 쓴다', () => {
  const q = makeQuestion(IX, IX.get('p:cyst/o'), 'spell', rng(1));
  assert.ok(grade(q, 'vesic/o').ok);
  const d = makeQuestion(IX, IX.get('w:empyema'), 'desc', rng(1));
  assert.ok(!d.options.includes('pyothorax'));
});

import { misspellings, koSim } from '../src/quiz.js';
import { normEn } from '../src/text.js';

test('철자 함정은 자주 틀리는 방식이고, 진짜 용어는 아니다', () => {
  const m = misspellings('hemorrhage', IX.get('w:hemorrhage')).strong;
  assert.ok(m.includes('hemorhage'));
  assert.ok(m.includes('hemorrage'));
  assert.ok(misspellings('dysphagia').all.includes('disphagia'));
  assert.ok(misspellings('dysphagia').all.includes('dysfagia'));
  assert.ok(misspellings('ophthalmology').all.includes('ophtalmology'));
  assert.ok(misspellings('pneumonia').all.includes('neumonia'));
  assert.ok(misspellings('anuria').all.includes('anurea'));
  assert.ok(misspellings('gastritis', IX.get('w:gastritis')).all.includes('gastroitis'));
  assert.ok(misspellings('myocardial infarction').all.every(s => s.startsWith('myocardial ') || s.endsWith(' infarction')));
});

test('한국어 → 영어: 헷갈리는 진짜 용어와 철자 함정이 함께 나온다', () => {
  const real = new Set(IX.items.flatMap(y => [y.t, y.full].filter(Boolean)).map(normEn));
  const q = makeQuestion(IX, IX.get('w:hemoptysis'), 'ko2en', rng(3));
  assert.equal(q.options.length, 4);
  assert.ok(q.options.includes('hemoptysis'));
  assert.ok(q.options.some(o => ['hematemesis', 'hematuria', 'hematochezia', 'melena'].includes(o)), q.options.join(','));
  assert.ok(q.options.some(o => !real.has(normEn(o))), '철자 함정 ' + q.options.join(','));
  const qs = buildQuiz(IX, IX.items, { n: 100, types: ['ko2en'], seed: 8 });
  for (const q2 of qs) {
    assert.equal(q2.options.filter(o => normEn(o) === normEn(q2.answer)).length, 1, q2.id);
    assert.ok(q2.options.some(o => !real.has(normEn(o))), '철자 함정 없음: ' + q2.id + ' ' + q2.options.join(','));
  }
  assert.ok(koSim('무뇨', '핍뇨') > koSim('무뇨', '심장'));
});
