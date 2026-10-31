import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBackup, backupName, parseBackup, mergeLogs, mergeNotes } from '../src/backup.js';
import { replay } from '../src/engine.js';

const T = new Date(2026, 9, 31, 21, 0).getTime();
const A = [{ t: T, c: 'w:a', b: 1, d: 'phone' }, { t: T + 1000, c: 'w:b', b: 3, ok: true, d: 'phone' }];
const B = [{ t: T + 500, c: 'w:a', b: 4, ok: false, d: 'pc' }, { t: T + 1000, c: 'w:b', b: 3, ok: true, d: 'phone' }];

test('파일 이름: 메디보카-백업-MMDD-기기.json', () => {
  assert.equal(backupName('폰', T), '메디보카-백업-1031-폰.json');
  assert.equal(backupName('내 컴퓨터', T), '메디보카-백업-1031-내컴퓨터.json');
});

test('보내고 다시 읽으면 기록이 그대로다', () => {
  const o = parseBackup(JSON.stringify(makeBackup(A, { device: 'phone', label: '폰', now: T })));
  assert.deepEqual(o.log, A);
  assert.equal(o.skipped, 0);
});

test('다른 앱 파일이나 깨진 파일은 쉬운 말로 거절한다', () => {
  assert.throws(() => parseBackup('{not json'), /읽지 못했어요/);
  assert.throws(() => parseBackup(JSON.stringify({ app: 'cheongjin-note', log: [] })), /메디보카 백업 파일이 아니에요/);
  assert.throws(() => parseBackup(JSON.stringify({ app: 'medivoca', v: 99, log: [] })), /새 버전/);
});

test('이상한 줄은 빼고 읽는다', () => {
  const o = parseBackup(JSON.stringify({ app: 'medivoca', v: 1, log: [...A, { t: 'x', c: 1 }, { t: T, c: 'w:z', b: 7, d: 'a' }] }));
  assert.equal(o.log.length, 2);
  assert.equal(o.skipped, 2);
});

test('합치기는 덮어쓰지 않고, 같은 줄은 한 번만', () => {
  const { log, added } = mergeLogs(A, B);
  assert.equal(log.length, 3);
  assert.equal(added.length, 1);
  // 옛 파일을 다시 불러와도 그대로
  assert.equal(mergeLogs(log, A).added.length, 0);
  // 어느 쪽에서 합쳐도 카드 상태가 같다
  const x = replay(mergeLogs(A, B).log), y = replay(mergeLogs(B, A).log);
  assert.equal(x.get('w:a').card.due.getTime(), y.get('w:a').card.due.getTime());
});

test('내 암기법은 더 나중에 고친 쪽을 쓴다', () => {
  const r = mergeNotes({ 'w:a': { s: '옛것', t: 1 } }, { 'w:a': { s: '새것', t: 2 }, 'w:b': { s: 'b', t: 1 }, bad: 3 });
  assert.equal(r.notes['w:a'].s, '새것');
  assert.equal(r.notes['w:b'].s, 'b');
  assert.equal(r.changed, 2);
  assert.ok(!('bad' in r.notes));
});

import { mergeFlags } from '../src/backup.js';
test('중요 표시 합치기: 나중에 바꾼 쪽', () => {
  const r = mergeFlags({ 'w:a': { on: true, t: 5 }, 'w:b': { on: true, t: 1 } }, { 'w:a': { on: false, t: 3 }, 'w:b': { on: false, t: 9 }, 'w:c': { on: true, t: 2 }, bad: { on: 1, t: 1 } });
  assert.deepEqual(r.flags, { 'w:a': { on: true, t: 5 }, 'w:b': { on: false, t: 9 }, 'w:c': { on: true, t: 2 } });
  assert.equal(r.changed, 2);
});

import { plansOf, mergePlans } from '../src/backup.js';
test('단어장 옮기기: 없는 단어장은 더하고, 같은 단어장은 나중에 고친 쪽', () => {
  const phone = { lists: [{ id: 'a', name: 'A폰', ids: ['x'] }, { id: 'b', name: 'B', ids: [] }], stamp: { 'L:a': 200, 'L:b': 100 } };
  const pc = { lists: [{ id: 'a', name: 'A컴', ids: [] }], stamp: { 'L:a': 100 } };
  const { patch, changed } = mergePlans(pc, plansOf(phone));
  assert.equal(changed, 2);
  assert.deepEqual(patch.lists.map(l => l.name), ['A폰', 'B']);
  // 컴퓨터 쪽이 더 나중이면 그대로
  const r2 = mergePlans({ ...pc, stamp: { 'L:a': 300 } }, plansOf(phone));
  assert.equal(r2.patch.lists.find(l => l.id === 'a').name, 'A컴');
});
test('단어장 옮기기: 지운 단어장은 다른 기기에서 불러와도 살아나지 않는다', () => {
  const pc = { lists: [], delLists: { a: 500 } };
  const phone = { lists: [{ id: 'a', name: 'A', ids: [] }], stamp: { 'L:a': 200 } };
  assert.equal(mergePlans(pc, plansOf(phone)).patch.lists.length, 0);
  // 반대로 폰에서 지운 걸 컴퓨터가 받으면 컴퓨터에서도 지워진다
  const r = mergePlans(phone, plansOf(pc));
  assert.equal(r.patch.lists.length, 0);
  assert.equal(r.changed, 1);
  // 지운 뒤에 다시 고쳤으면 남긴다
  assert.equal(mergePlans({ lists: [{ id: 'a', name: 'A', ids: [] }], stamp: { 'L:a': 900 } }, plansOf(pc)).patch.lists.length, 1);
});
test('학교 수업·추천 기간도 나중에 고친 쪽', () => {
  const a = { scope: '321', pace: { mode: 'goal', weeks: 16 }, stamp: { rec: 100 } };
  const b = { scope: '32', pace: { mode: 'goal', weeks: 8 }, syl: { scope: 'syl:32|m01', pace: {} }, stamp: { rec: 200, syl: 50 } };
  const { patch } = mergePlans(a, plansOf(b));
  assert.equal(patch.scope, '32');
  assert.equal(patch.syl.scope, 'syl:32|m01');
});
test('학교 수업 단어장을 지우면 다른 기기의 옛 것으로 살아나지 않는다', () => {
  const del = { syl: null, stamp: { syl: 500 } };
  const old = { syl: { scope: 'syl:32|m01', pace: {} }, stamp: { syl: 100 } };
  assert.equal(mergePlans(del, plansOf(old)).patch.syl, undefined);
  assert.equal(mergePlans(old, plansOf(del)).patch.syl, null);
});
