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

export function makeBackup(log, { device, label, now = Date.now(), notes, flags, history, plans } = {}) {
  const o = { app: APP, v: VERSION, ts: now, device, label, log: log.map(slim) };
  if (plans) o.plans = plans;
  if (notes && Object.keys(notes).length) o.notes = notes;
  if (flags && Object.keys(flags).length) o.flags = flags;
  if (history && history.length) o.history = history;
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

// ───────── 단어장(공부 계획) 옮기기 ─────────
// 단어장은 설정 안에 있다. 폰 ↔ 컴퓨터로 옮길 때 단어장마다 "마지막으로 고친 시각"(stamp)을 비교해 더 나중 것을 쓴다.
// 지운 단어장은 del { id: 지운 시각 }로 남겨서, 다른 기기에서 불러와도 다시 살아나지 않게 한다.
// 키: 'rec'(추천: scope·pace) · 'syl'(학교 수업) · 'L:목록id'(내 단어장)
const okList = l => l && typeof l === 'object' && typeof l.id === 'string' && l.id.length < 60 && typeof l.name === 'string' && Array.isArray(l.ids);
export function plansOf(s = {}) {
  return {
    lists: (s.lists || []).filter(okList),
    syl: s.syl || null,
    rec: { scope: s.scope, pace: s.pace },
    focus: s.focus || {},
    stamp: s.stamp || {},
    del: s.delLists || {},
  };
}
// settings(내 것) + 백업의 plans → 바꿀 설정 조각과 바뀐 수
export function mergePlans(s = {}, p) {
  if (!p || typeof p !== 'object') return { patch: null, changed: 0 };
  const st = { ...(s.stamp || {}) }, del = { ...(s.delLists || {}) };
  const ts = p.stamp || {}, tdel = p.del || {};
  let changed = 0;
  for (const [id, t] of Object.entries(tdel)) if (Number.isFinite(t) && !(del[id] >= t)) del[id] = t;
  const newer = k => (ts[k] || 0) > (st[k] || 0);
  const lists = [];
  const mine = new Map((s.lists || []).map(l => [l.id, l]));
  const theirs = new Map((p.lists || []).filter(okList).map(l => [l.id, l]));
  const ids = [...new Set([...mine.keys(), ...theirs.keys()])];
  for (const id of ids) {
    const k = 'L:' + id, a = mine.get(id), b = theirs.get(id);
    let pick = a && b ? (newer(k) ? b : a) : (a || b);
    const t = pick === b && b !== a ? (ts[k] || 0) : (st[k] || 0);
    if (del[id] && del[id] >= t) { if (a) changed++; continue; } // 지운 뒤에 고친 게 아니면 지운 쪽
    if (pick !== a) { changed++; st[k] = ts[k] || 0; }
    lists.push(pick);
  }
  const patch = { lists, delLists: del, stamp: st };
  if (p.syl && (newer('syl') || (!s.syl && !st.syl))) { patch.syl = p.syl; st.syl = ts.syl || 0; changed++; }
  else if (!p.syl && s.syl && newer('syl')) { patch.syl = null; st.syl = ts.syl; changed++; } // 다른 기기에서 지움
  if (p.rec && p.rec.scope && newer('rec')) { patch.scope = p.rec.scope; patch.pace = p.rec.pace; st.rec = ts.rec; changed++; }
  const focus = { ...(s.focus || {}) };
  for (const [k, v] of Object.entries(p.focus || {})) if (v && typeof v === 'object' && (!focus[k] || newer(k))) focus[k] = v;
  patch.focus = focus;
  return { patch, changed };
}
