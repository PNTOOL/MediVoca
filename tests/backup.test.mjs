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
