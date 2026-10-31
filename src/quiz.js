// 시험 문제 만들기와 채점. 화면과 상관없는 순수 함수. tests/quiz.test.mjs 에서 검사한다.
// 문제는 앱의 단어 데이터로 만든다 (기출을 옮기지 않는다).
import { gradeSpell, gradeMeaning, normEn, normKo, lev } from './text.js';

export const QTYPES = {
  mean: { label: '뜻 쓰기', desc: '영어 → 한글 뜻', subj: true },
  spell: { label: '철자 쓰기', desc: '한글 → 영어', subj: true },
  abbr: { label: '약어 풀이', desc: '약어 → 영어 풀이', subj: true },
  parts: { label: '조각 분해', desc: '바르게 나눈 것 고르기', subj: false },
  pick: { label: '뜻 고르기', desc: '5지선다', subj: false },
  desc: { label: '설명 보고 용어 고르기', desc: '5지선다 (상황형)', subj: false },
};

// 같은 씨앗이면 같은 시험이 나온다 (테스트·다시 풀기)
export function rng(seed) {
  let h = 2166136261 >>> 0;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => { h = (h + 0x6D2B79F5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const shuffle = (a, r) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const partKind = t => (t.startsWith('-') ? 'suf' : t.endsWith('-') ? 'pre' : 'root');

// 이 항목으로 낼 수 있는 유형
export function typesFor(x) {
  const out = [];
  if (x.k !== 'abbr') out.push('mean', 'spell', 'pick');
  if (x.k === 'abbr' && x.full) out.push('abbr', 'pick');
  if (x.k === 'word' && (x.parts || []).length >= 2) out.push('parts');
  if (x.mean && x.k !== 'part') out.push('desc');
  return out;
}

// 함정 보기 후보: 헷갈리는 짝 > 같은 조각 > 같은 장 > 나머지 (같은 종류만)
function distractors(index, x, n, r, valueOf) {
  const mates = new Set();
  for (const p of index.pairsOf.get(x.id) || []) for (const id of [...(p.w || []), ...(p.sa || []), ...(p.sb || [])]) mates.add(id);
  const myParts = new Set((x.parts || []).map(f => 'p:' + f));
  const scored = [];
  for (const y of index.items) {
    if (y.id === x.id || y.k !== x.k) continue;
    if (y.ko.some(k => x.ko.includes(k))) continue; // 뜻이 같은 말은 오답 보기로 쓰지 않는다
    let s = r() * 2;
    if (mates.has(y.id)) s += 10;
    if ((y.parts || []).some(f => myParts.has('p:' + f))) s += 4;
    if (y.unit === x.unit) s += 3;
    if (x.k === 'part' && partKind(y.t) === partKind(x.t)) s += 3;
    scored.push([s, y]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const seen = new Set([valueOf(x)]);
  const out = [];
  for (const [, y] of scored) {
    const v = valueOf(y);
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(y);
    if (out.length >= n) break;
  }
  return out;
}

function partsText(index, forms) {
  return forms.map(f => { const p = index.get('p:' + f); return `${f} ${p ? p.ko[0] : ''}`.trim(); }).join(' + ');
}

// 조각 분해 오답: 조각 하나를 같은 종류의 다른 조각으로 바꾸거나, 뜻을 바꿔 붙임
function partsDistractors(index, x, n, r) {
  const forms = x.parts;
  const correct = partsText(index, forms);
  const allParts = index.items.filter(y => y.k === 'part');
  const out = new Set();
  let guard = 0;
  while (out.size < n && guard++ < 200) {
    const i = Math.floor(r() * forms.length);
    const kind = partKind(forms[i]);
    const same = allParts.filter(p => partKind(p.t) === kind && p.t !== forms[i]);
    if (!same.length) continue;
    const pick = same[Math.floor(r() * same.length)];
    let text;
    if (r() < 0.5) {
      // 형태는 그대로 두고 뜻만 바꿈 (뜻을 아는지 확인)
      text = forms.map((f, j) => { const p = index.get('p:' + f); return `${f} ${j === i ? pick.ko[0] : (p ? p.ko[0] : '')}`.trim(); }).join(' + ');
    } else {
      const nf = forms.slice(); nf[i] = pick.t;
      text = partsText(index, nf);
    }
    if (text !== correct) out.add(text);
  }
  return [...out];
}

export function makeQuestion(index, x, type, r) {
  const q = { id: x.id, type, unit: x.unit };
  if (type === 'mean') {
    q.prompt = x.t; q.ask = '한글 뜻을 쓰세요'; q.answer = x.ko.join(' · '); q.accept = x.ko;
  } else if (type === 'spell') {
    q.prompt = x.ko.join(' · '); q.ask = x.k === 'part' ? '영어 조각(형태)을 쓰세요' : '영어로 쓰세요';
    // 뜻이 같은 다른 형태도 정답 (방광 = cyst/o, vesic/o)
    const same = index.items.filter(y => y.k === x.k && y.id !== x.id && y.ko.some(k => x.ko.includes(k))).map(y => y.t);
    q.answer = x.t; q.accept = [x.t, ...same]; q.alt = same; q.hint = `${x.t.replace(/[^a-zA-Z]/g, '').length}글자 · ${x.t[0] === '-' ? x.t[1] : x.t[0]}로 시작`;
  } else if (type === 'abbr') {
    q.prompt = x.t; q.ask = '영어 풀이(full term)를 쓰세요'; q.answer = x.full; q.accept = String(x.full).split(/\s*·\s*/); q.extra = x.ko.join(' · ');
  } else if (type === 'pick') {
    q.prompt = x.t; q.ask = '뜻으로 알맞은 것은?';
    const ds = distractors(index, x, 4, r, y => y.ko[0]);
    q.options = shuffle([x.ko[0], ...ds.map(y => y.ko[0])], r); q.answer = x.ko[0];
  } else if (type === 'desc') {
    q.prompt = x.mean; q.ask = '이 설명에 해당하는 용어는?';
    const ds = distractors(index, x, 4, r, y => y.t);
    q.options = shuffle([x.t, ...ds.map(y => y.t)], r); q.answer = x.t;
  } else if (type === 'parts') {
    q.prompt = x.t; q.ask = '조각으로 바르게 나누고 뜻을 단 것은?';
    const correct = partsText(index, x.parts);
    q.options = shuffle([correct, ...partsDistractors(index, x, 4, r)], r); q.answer = correct;
  }
  if (q.options && q.options.length < 3) return null; // 보기를 못 만들면 내지 않는다
  return q;
}

// 시험 만들기: items(범위 안 항목) 중에서 n문항, 유형은 types 중 고르게
export function buildQuiz(index, items, { types = Object.keys(QTYPES), n = 20, seed = Date.now() } = {}) {
  const r = rng(seed);
  const pool = shuffle(items, r);
  const want = types.filter(t => QTYPES[t]);
  const qs = [];
  const used = new Set();
  let ti = Math.floor(r() * want.length);
  for (let round = 0; round < 3 && qs.length < n; round++) {
    for (const x of pool) {
      if (qs.length >= n) break;
      if (used.has(x.id)) continue;
      const can = typesFor(x).filter(t => want.includes(t));
      if (!can.length) continue;
      // 유형이 한쪽으로 몰리지 않게 돌아가며 고른다
      let type = want[ti % want.length];
      if (!can.includes(type)) { if (round === 0) continue; type = can[Math.floor(r() * can.length)]; }
      const q = makeQuestion(index, x, type, r);
      if (!q) continue;
      qs.push(q); used.add(x.id); ti++;
    }
  }
  return qs;
}

// 채점. 주관식은 같은 뜻 다른 말·띄어쓰기·대소문자 차이를 인정한다.
export function grade(q, given) {
  const g = String(given == null ? '' : given).trim();
  if (!g) return { ok: false, empty: true };
  if (q.options) return { ok: g === q.answer };
  if (q.type === 'mean') return gradeMeaning(q.accept, g);
  if (q.type === 'spell') return gradeSpell(q.accept, g);
  if (q.type === 'abbr') {
    const a = normEn(g);
    if (q.accept.some(z => normEn(z) === a)) return { ok: true };
    const d = Math.min(...q.accept.map(z => lev(normEn(z), a)));
    return { ok: false, near: d <= 2 && a.length >= 8 };
  }
  return { ok: false };
}

// 결과 요약: 유형별·장별 정답률
export function summarize(qs, answers) {
  const by = (key) => {
    const m = new Map();
    qs.forEach((q, i) => { const k = q[key]; const v = m.get(k) || { n: 0, ok: 0 }; v.n++; if (answers[i] && answers[i].ok) v.ok++; m.set(k, v); });
    return m;
  };
  const ok = answers.filter(a => a && a.ok).length;
  return { n: qs.length, ok, pct: qs.length ? Math.round((ok / qs.length) * 100) : 0, byType: by('type'), byUnit: by('unit') };
}
