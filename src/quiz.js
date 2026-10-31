// 시험 문제 만들기와 채점. 화면과 상관없는 순수 함수. tests/quiz.test.mjs 에서 검사한다.
// 문제는 앱의 단어 데이터로 만든다 (기출을 옮기지 않는다).
import { gradeSpell, gradeMeaning, normEn, normKo, lev } from './text.js';

export const QTYPES = {
  ko2en: { label: '한국어 → 영어 고르기', desc: '철자까지 정확히 · 4지선다', subj: false },
  mean: { label: '뜻 쓰기', desc: '영어 → 한글 뜻', subj: true },
  spell: { label: '철자 쓰기', desc: '한글 → 영어', subj: true },
  abbr: { label: '약어 풀이', desc: '약어 → 영어 풀이', subj: true },
  parts: { label: '조각 분해', desc: '바르게 나눈 것 고르기 · 4지선다', subj: false },
  pick: { label: '영어 → 뜻 고르기', desc: '헷갈리는 한국어 · 4지선다', subj: false },
  desc: { label: '설명 보고 용어 고르기', desc: '4지선다 (상황형)', subj: false },
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
  if (x.k !== 'abbr') out.push('ko2en', 'mean', 'spell', 'pick');
  if (x.k === 'abbr' && x.full) out.push('abbr', 'pick');
  if (x.k === 'word' && (x.parts || []).length >= 2) out.push('parts');
  if (x.mean && x.k !== 'part') out.push('desc');
  return out;
}

// 한국어가 얼마나 비슷한가: 끝 글자가 같을수록, 같은 글자가 많을수록 (객혈·토혈, 무뇨·핍뇨)
export function koSim(a, b) {
  const x = normKo(a), y = normKo(b);
  if (!x || !y || x === y) return 0;
  let suf = 0;
  while (suf < Math.min(x.length, y.length) && x[x.length - 1 - suf] === y[y.length - 1 - suf]) suf++;
  const sx = new Set(x), common = [...new Set(y)].filter(c => sx.has(c)).length;
  return suf * 2 + common;
}
const koSimItem = (x, y) => Math.max(...x.ko.flatMap(a => y.ko.map(b => koSim(a, b))));

// 함정 보기 후보: 헷갈리는 묶음·짝 > 한국어가 비슷 > 같은 조각 > 같은 장 (같은 종류만, 뜻이 같은 말은 뺌)
function distractors(index, x, n, r, valueOf) {
  const mates = new Set();
  for (const p of index.pairsOf.get(x.id) || []) for (const id of [...(p.w || []), ...(p.sa || []), ...(p.sb || [])]) mates.add(id);
  const group = new Set((index.groupsOf && index.groupsOf.get(x.id) || []).flatMap(g => g.ids));
  const myParts = new Set((x.parts || []).map(f => 'p:' + f));
  const scored = [];
  for (const y of index.items) {
    if (y.id === x.id || y.k !== x.k) continue;
    if (y.ko.some(k => x.ko.includes(k))) continue; // 뜻이 같은 말은 오답 보기로 쓰지 않는다
    let s = r() * 2;
    if (group.has(y.id)) s += 14;
    if (mates.has(y.id)) s += 10;
    s += Math.min(8, koSimItem(x, y) * 1.5);
    if ((y.parts || []).some(f => myParts.has('p:' + f))) s += 4;
    if (y.unit === x.unit) s += 2;
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

// 철자 함정: 학생들이 실제로 자주 틀리는 방식으로 한 군데만 바꾼다
const VOW = 'aeiou';
export function misspellings(t, x) {
  const out = new Set();   // 자주 틀리는 방식 (먼저 쓴다)
  const weak = new Set();  // 글자 바꾸기·모음 바꾸기 (모자랄 때)
  const words = t.split(/(\s+)/);
  // 여러 낱말이면 가장 긴 낱말을 바꾼다
  let wi = 0; words.forEach((w, i) => { if (w.trim() && w.length > (words[wi] || '').length) wi = i; });
  const w = words[wi];
  let target = out;
  const put = nw => { if (nw && nw !== w) { const c = words.slice(); c[wi] = nw; target.add(c.join('')); } };
  const L = w.toLowerCase();
  for (let i = 1; i < w.length; i++) {
    const a = L[i - 1], b = L[i];
    if (a === b && /[a-z]/.test(a)) put(w.slice(0, i) + w.slice(i + 1));                    // 겹자음 빼기 hemorrhage → hemorhage
  }
  for (let i = 2; i < w.length - 1; i++) {
    const c = L[i];
    if ('lrmnptsc'.includes(c) && VOW.includes(L[i - 1]) && VOW.includes(L[i + 1]) && L[i + 1] !== c) put(w.slice(0, i + 1) + w[i] + w.slice(i + 1)); // 겹자음 더하기 anuria → annuria
  }
  for (let i = 1; i < w.length; i++) {
    if (L[i] === 'y') put(w.slice(0, i) + 'i' + w.slice(i + 1));                              // y → i  dysphagia → disphagia
    else if (L[i] === 'i' && i < w.length - 2) put(w.slice(0, i) + 'y' + w.slice(i + 1));      // i → y
  }
  if (L.includes('ph')) put(w.replace(/ph/i, 'f'));                                              // ph → f
  if (L.includes('th')) put(w.replace(/th/i, 't'));                                              // th → t  ophthalmology → ophtalmology
  if (/rh/.test(L)) put(w.replace(/rh/, 'r'));                                                   // rh → r  hemorrhage → hemorrage
  if (/^p[nst]/.test(L)) put(w.slice(1));                                                        // 소리 안 나는 p 빼기 pneumonia → neumonia
  if (/ch/.test(L.slice(1))) put(w.slice(0, 1) + w.slice(1).replace(/ch/, 'c'));                 // ch → c  cholecyst → colecyst
  for (const [from, to] of [['uria', 'urea'], ['emia', 'imia'], ['itis', 'ites'], ['osis', 'asis'], ['ectomy', 'ectemy'], ['scopy', 'scapy'], ['plasty', 'plasti'], ['algia', 'algea'], ['pathy', 'phathy']]) {
    if (L.endsWith(from)) put(w.slice(0, w.length - from.length) + to);                        // 접미사 모음 바꾸기
  }
  target = weak;
  for (let i = 2; i < w.length - 2; i++) {
    const a = L[i], b = L[i + 1];
    if (/[a-z]/.test(a) && /[a-z]/.test(b) && a !== b && !(VOW.includes(a) && VOW.includes(b))) put(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2)); // 이웃 글자 바꾸기 sclerosis → scelrosis
  }
  // 비슷한 모음 바꾸기 (다른 규칙으로 못 만들 때도 함정이 생기게)
  const SIM = { e: 'i', i: 'e', a: 'e', o: 'u', u: 'o' };
  for (let i = 1; i < w.length; i++) if (SIM[L[i]] && /[a-z/]/.test(L[i - 1] || '')) put(w.slice(0, i) + SIM[L[i]] + w.slice(i + 1));
  // 비슷한 자음 바꾸기 (b↔p, d↔t, c↔k, g↔k, s↔z)
  const CON = { b: 'p', p: 'b', d: 't', t: 'd', c: 'k', k: 'c', g: 'k', s: 'z' };
  for (let i = 1; i < w.length; i++) if (CON[L[i]] && !(L[i] === 's' && L[i - 1] === 's')) put(w.slice(0, i) + CON[L[i]] + w.slice(i + 1));
  // 결합모음 규칙 어기기: 모음 앞 o를 남김 (gastr + itis → gastroitis)
  target = out;
  if (x && x.parts) {
    for (let i = 0; i < x.parts.length - 1; i++) {
      const root = x.parts[i], next = x.parts[i + 1];
      if (!root.endsWith('/o') && !root.endsWith('/i')) continue;
      const base = root.split('/')[0].replace(/-/g, '');
      const nx = next.replace(/^-/, '').split('/')[0];
      if (!VOW.includes(nx[0])) continue;
      const k = L.indexOf(base + nx.slice(0, 2));
      if (k >= 0) put(w.slice(0, k + base.length) + root.split('/')[1] + w.slice(k + base.length));
    }
  }
  return { strong: [...out], weak: [...weak].filter(m => !out.has(m)), all: [...out, ...weak] };
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

// 진짜 용어와 맞는 다른 철자는 철자 함정으로 쓰지 않는다
let REAL = null;
const realSet = index => REAL && REAL.index === index ? REAL.set : (REAL = { index, set: new Set(index.items.flatMap(y => [y.t, y.full].filter(Boolean)).map(normEn)) }).set;

export function makeQuestion(index, x, type, r) {
  const q = { id: x.id, type, unit: x.unit };
  if (type === 'ko2en') {
    // 한국어 → 영어: 헷갈리는 진짜 용어 최대 2개 + 철자 함정 (1개 이상)
    q.prompt = x.ko.join(' · '); q.ask = '알맞은 영어 의학용어는? (철자까지)';
    const real = distractors(index, x, 3, r, y => normEn(y.t)).filter(y => {
      const grp = (index.groupsOf && index.groupsOf.get(x.id) || []).some(g => g.ids.includes(y.id));
      return grp || koSimItem(x, y) >= 3 || (y.parts || []).some(f => (x.parts || []).includes(f));
    }).slice(0, 2).map(y => y.t);
    const reals = realSet(index);
    const ms = misspellings(x.t, x);
    const ok = m => !reals.has(normEn(m));
    const traps = [...shuffle(ms.strong.filter(ok), r), ...shuffle(ms.weak.filter(ok), r)];
    const opts = [x.t, ...real];
    for (const m of traps) { if (opts.length >= 4) break; if (!opts.some(o => normEn(o) === normEn(m))) opts.push(m); }
    if (opts.length < 4) for (const y of distractors(index, x, 6, r, z => normEn(z.t))) { if (opts.length >= 4) break; if (!opts.includes(y.t)) opts.push(y.t); }
    q.options = shuffle(opts.slice(0, 4), r); q.answer = x.t; q.traps = opts.filter(o => o !== x.t && !reals.has(normEn(o)));
  } else if (type === 'mean') {
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
    const ds = distractors(index, x, 3, r, y => y.ko[0]);
    q.options = shuffle([x.ko[0], ...ds.map(y => y.ko[0])], r); q.answer = x.ko[0];
  } else if (type === 'desc') {
    q.prompt = x.mean; q.ask = '이 설명에 해당하는 용어는?';
    const ds = distractors(index, x, 3, r, y => y.t);
    q.options = shuffle([x.t, ...ds.map(y => y.t)], r); q.answer = x.t;
  } else if (type === 'parts') {
    q.prompt = x.t; q.ask = '조각으로 바르게 나누고 뜻을 단 것은?';
    const correct = partsText(index, x.parts);
    q.options = shuffle([correct, ...partsDistractors(index, x, 3, r)], r); q.answer = correct;
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
  const used = new Set();      // 문제로 낸 단어
  const usedPair = new Set();  // 단어|유형
  let ti = Math.floor(r() * want.length);
  // 처음 세 바퀴는 단어마다 한 문제. 단어가 문항 수보다 적으면 같은 단어를 다른 유형으로 한 번 더 낸다.
  for (let round = 0; round < 6 && qs.length < n; round++) {
    const again = round >= 3;
    for (const x of pool) {
      if (qs.length >= n) break;
      if (!again && used.has(x.id)) continue;
      const can = typesFor(x).filter(t => want.includes(t) && !usedPair.has(x.id + '|' + t));
      if (!can.length) continue;
      // 유형이 한쪽으로 몰리지 않게 돌아가며 고른다
      let type = want[ti % want.length];
      if (!can.includes(type)) { if (round === 0) continue; type = can[Math.floor(r() * can.length)]; }
      const q = makeQuestion(index, x, type, r);
      if (!q) continue;
      qs.push(q); used.add(x.id); usedPair.add(x.id + '|' + type); ti++;
    }
  }
  if (qs.length > pool.length) { // 같은 단어 문제가 붙어 나오지 않게 섞는다
    const later = qs.splice(pool.length);
    for (const q of later) qs.splice(Math.floor(r() * (qs.length + 1)), 0, q);
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

// 철자가 까다로운 단어: 소리와 글자가 다른 곳(rrh, phth, 첫 pn·ps, 소리 없는 글자), 겹자음, y 모음, 아주 긴 단어
export function spellHard(t) {
  const w = String(t || '').toLowerCase().replace(/[^a-z]/g, '');
  if (w.length < 5) return false;
  let s = 0;
  if (/rrh|phth|rhyth/.test(w)) s += 2;
  if (/^(pn|ps|pt|gn|kn|mn)/.test(w) || /[^aeiou]pn|mn$|gm/.test(w)) s += 2;
  if (/rh|ph|ch(?=[^aeiou])/.test(w)) s += 1;
  if (/([bcdfgklmnprstz])\1/.test(w)) s += 1;
  if (/ae|oe|eu|ei|ie/.test(w)) s += 1;
  if (/[^aeiou]y[^aeiou]|y[^aeiouy]{2}/.test(w)) s += 1;
  if (w.length >= 12) s += 1;
  return s >= 2;
}
