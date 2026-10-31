// 공부 기록: 날짜별로 얼마나, 얼마나 잘, 어떤 목록을 공부했는지. 화면과 상관없는 순수 함수.
// 기록 한 줄(log)만으로 날짜별 장수·정답률·시간을 계산하고, 공부 한 번 요약(sessions)은 "무엇을" 공부했는지 알려 준다.
import { dayKey, ratingOf, isCorrect } from './engine.js';

const GAP = 120 * 1000;   // 2분 넘게 쉬면 그 사이는 공부 시간에서 뺀다
const FIRST = 15 * 1000;  // 한 번 이어서 공부할 때 첫 카드에 드는 시간(대략)

// 날짜별 요약 { day: { cards, unique, fresh, firstOk, firstN, ms, ans:[0,모름,헷갈림,알것같음,확실히앎] } }
export function dayStats(log) {
  const sorted = [...log].sort((a, b) => a.t - b.t);
  const seenEver = new Set();
  const out = new Map();
  const lastT = new Map();
  for (const e of sorted) {
    const d = dayKey(e.t);
    let s = out.get(d);
    if (!s) { s = { day: d, cards: 0, unique: 0, fresh: 0, firstOk: 0, firstN: 0, ms: 0, ans: [0, 0, 0, 0, 0], _u: new Set() }; out.set(d, s); }
    s.cards++;
    s.ans[ratingOf(e)]++;
    if (!s._u.has(e.c)) { s._u.add(e.c); s.unique++; s.firstN++; if (isCorrect(e)) s.firstOk++; }
    if (!seenEver.has(e.c)) { seenEver.add(e.c); s.fresh++; }
    const prev = lastT.get(d);
    s.ms += prev != null && e.t - prev <= GAP ? e.t - prev : FIRST;
    lastT.set(d, e.t);
  }
  for (const s of out.values()) delete s._u;
  return out;
}

// 이번 주(월~일)와 지난주 비교, 최근 n일 평균
export function weekSummary(stats, today) {
  const t = new Date(today + 'T12:00:00');
  const dow = (t.getDay() + 6) % 7;
  const day = off => { const x = new Date(t); x.setDate(x.getDate() + off); return dayKey(x.getTime()); };
  const sum = (from, to) => {
    let days = 0, cards = 0, ms = 0, ok = 0, n = 0, fresh = 0;
    for (let i = from; i <= to; i++) { const s = stats.get(day(i)); if (!s) continue; days++; cards += s.cards; ms += s.ms; ok += s.firstOk; n += s.firstN; fresh += s.fresh; }
    return { days, cards, minutes: Math.round(ms / 60000), fresh, acc: n ? ok / n : null };
  };
  return { thisWeek: sum(-dow, 0), lastWeek: sum(-dow - 7, -dow - 1), last30: sum(-29, 0) };
}

// 익힌 단어 수가 날마다 얼마나 늘었는지 (states의 masteredDay로)
export function masteredSeries(states, today, days = 30) {
  const t = new Date(today + 'T12:00:00');
  const keys = Array.from({ length: days }, (_, i) => { const x = new Date(t); x.setDate(x.getDate() - (days - 1 - i)); return dayKey(x.getTime()); });
  const md = [...states.values()].map(s => s.masteredDay).filter(Boolean).sort();
  let j = 0;
  return keys.map(k => { while (j < md.length && md[j] <= k) j++; return { day: k, n: j }; });
}

// 공부 한 번 요약 합치기(백업): id가 같으면 더 많이 한 쪽
export function mergeHistory(mine = [], theirs = []) {
  const by = new Map(mine.map(h => [h.id, h]));
  let changed = 0;
  for (const h of theirs || []) {
    if (!h || typeof h.id !== 'string' || !Number.isFinite(h.t0) || typeof h.label !== 'string') continue;
    const cur = by.get(h.id);
    if (!cur || (h.n || 0) > (cur.n || 0)) { by.set(h.id, { id: h.id, t0: h.t0, t1: h.t1 || h.t0, label: h.label.slice(0, 80), key: String(h.key || ''), n: h.n || 0, fresh: h.fresh || 0, ok: h.ok || 0, first: h.first || 0 }); changed++; }
  }
  return { history: [...by.values()].sort((a, b) => a.t0 - b.t0), changed };
}
