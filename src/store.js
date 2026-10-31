// 기기 안 저장 (IndexedDB). log: 복습 기록 한 줄씩, kv: 설정·세션·내 암기법 같은 나머지.
// IndexedDB를 못 쓰는 환경(일부 비공개 창)에서는 메모리에만 두고 ok=false로 알린다.
import { logKey } from './engine.js';

const DB = 'medivoca';
let db = null;
const mem = { log: new Map(), kv: new Map() };
export let ok = true;

function req(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

export async function open() {
  if (db || !ok) return;
  try {
    db = await new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('log')) d.createObjectStore('log', { keyPath: 'k' });
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('blocked'));
    });
    // 브라우저가 공간이 모자랄 때 지우지 않도록 부탁
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { /* 없어도 됨 */ }
  } catch (e) {
    ok = false;
  }
}

const tx = (store, mode) => db.transaction(store, mode).objectStore(store);

export async function allLog() {
  if (!db) return [...mem.log.values()];
  const rows = await req(tx('log', 'readonly').getAll());
  return rows.map(({ k, ...e }) => e);
}

export async function addLog(entries) {
  if (!entries.length) return;
  if (!db) { for (const e of entries) mem.log.set(logKey(e), e); return; }
  await new Promise((res, rej) => {
    const t = db.transaction('log', 'readwrite');
    const s = t.objectStore('log');
    for (const e of entries) s.put({ k: logKey(e), ...e });
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
}

export async function get(key, dflt) {
  if (!db) return mem.kv.has(key) ? mem.kv.get(key) : dflt;
  const v = await req(tx('kv', 'readonly').get(key));
  return v === undefined ? dflt : v;
}

export async function set(key, val) {
  if (!db) { mem.kv.set(key, val); return; }
  await req(tx('kv', 'readwrite').put(val, key));
}
