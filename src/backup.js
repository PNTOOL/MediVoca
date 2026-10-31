// 백업 파일: 만들기, 이름 짓기, 읽기, 합치기. 화면과 상관없는 순수 함수.
import { logKey } from './engine.js';

export const APP = 'medivoca';
export const VERSION = 1;

// 기록 한 줄이 맞는 모양인지
export function validEntry(e) {
  return e && typeof e === 'object'
    && Number.isFinite(e.t) && e.t > 1.5e12 && e.t < 4e12
    && typeof e.c === 'string' && e.c.length > 0 && e.c.length < 200
    && [1, 2, 3, 4].includes(e.b)
    && (e.ok === undefined || typeof e.ok === 'boolean')
    && typeof e.d === 'string';
}

// 필요한 칸만 남긴다
const slim = e => {
  const o = { t: e.t, c: e.c, b: e.b, d: e.d };
  if (e.b >= 3) o.ok = e.ok !== false;
  return o;
};

export function makeBackup(log, { device, label, now = Date.now(), notes, flags } = {}) {
  const o = { app: APP, v: VERSION, ts: now, device, label, log: log.map(slim) };
  if (notes && Object.keys(notes).length) o.notes = notes;
  if (flags && Object.keys(flags).length) o.flags = flags;
  return o;
}

export function backupName(label, now = Date.now()) {
  const d = new Date(now);
  const mmdd = String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  const safe = String(label || '기기').replace(/[\\/:*?"<>|\s]+/g, '');
  return `메디보카-백업-${mmdd}-${safe}.json`;
}

// 파일 글자 → 백업. 문제가 있으면 쉬운 말로 된 Error를 던진다.
export function parseBackup(text) {
  let o;
  try { o = JSON.parse(text); } catch (e) { throw new Error('백업 파일을 읽지 못했어요. 메디보카에서 보낸 .json 파일인지 확인해 주세요.'); }
  if (!o || o.app !== APP) throw new Error('메디보카 백업 파일이 아니에요.');
  if (!Array.isArray(o.log)) throw new Error('백업 파일에 기록이 없어요.');
  if (o.v > VERSION) throw new Error('더 새 버전 앱에서 만든 백업이에요. 앱을 새로 고친 뒤 다시 불러와 주세요.');
  const good = o.log.filter(validEntry).map(slim);
  return { ...o, log: good, skipped: o.log.length - good.length };
}

// 합치기: 덮어쓰지 않는다. 같은 줄(시각·기기·카드가 같음)은 한 번만.
export function mergeLogs(mine, theirs) {
  const seen = new Set(mine.map(logKey));
  const added = [];
  for (const e of theirs) {
    const k = logKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    added.push(e);
  }
  return { log: mine.concat(added), added };
}

// 내 암기법·메모 합치기: 더 나중에 고친 쪽을 쓴다
export function mergeNotes(mine = {}, theirs = {}) {
  const out = { ...mine };
  let changed = 0;
  for (const [id, v] of Object.entries(theirs || {})) {
    if (!v || typeof v !== 'object' || typeof v.s !== 'string' || !Number.isFinite(v.t)) continue;
    if (!out[id] || out[id].t < v.t) { out[id] = { s: v.s.slice(0, 2000), t: v.t }; changed++; }
  }
  return { notes: out, changed };
}

// '아주 중요' 표시 합치기: { id: { on, t } }. 끈 것도 남겨서 더 나중에 바꾼 쪽을 쓴다
export function mergeFlags(mine = {}, theirs = {}) {
  const out = { ...mine };
  let changed = 0;
  for (const [id, v] of Object.entries(theirs || {})) {
    if (!v || typeof v !== 'object' || typeof v.on !== 'boolean' || !Number.isFinite(v.t) || id.length > 200) continue;
    if (!out[id] || out[id].t < v.t) { out[id] = { on: v.on, t: v.t }; changed++; }
  }
  return { flags: out, changed };
}
