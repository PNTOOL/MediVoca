// 단어 파일(data/)을 앱이 쓰기 좋게 묶는다. 화면과 상관없는 순수 함수만 둔다.

// 조각 형태로 id를 만든다: 'cardi/o' → 'p:cardi/o'
export const partId = form => 'p:' + form;

export function buildIndex(units, pairs = [], confusions = []) {
  const items = [];
  const byId = new Map();
  const unitOf = new Map();
  for (const u of units) {
    for (const it of u.items) {
      const x = { ...it, unit: u.unit.id, order: items.length };
      items.push(x);
      byId.set(x.id, x);
      unitOf.set(x.id, u.unit);
    }
  }
  // 조각 → 그 조각을 쓰는 단어들
  const family = new Map();
  for (const x of items) {
    if (x.k !== 'word') continue;
    for (const f of x.parts || []) {
      const pid = partId(f);
      if (!family.has(pid)) family.set(pid, []);
      family.get(pid).push(x.id);
    }
  }
  // 항목 → 들어 있는 헷갈리는 짝
  const pairsOf = new Map();
  for (const p of pairs) {
    for (const id of new Set([...(p.w || []), ...(p.sa || []), ...(p.sb || [])])) {
      if (!pairsOf.has(id)) pairsOf.set(id, []);
      pairsOf.get(id).push(p);
    }
  }
  // 헷갈리는 묶음: 영어 → id, 항목 → 들어 있는 묶음
  const idOf = t => ['w:', 'p:', 'a:'].map(p => p + t).find(id => byId.has(id));
  const groups = confusions.map(g => ({ ...g, ids: g.w.map(idOf).filter(Boolean) }));
  const groupsOf = new Map();
  for (const g of groups) for (const id of g.ids) { if (!groupsOf.has(id)) groupsOf.set(id, []); groupsOf.get(id).push(g); }
  return {
    groups,
    groupsOf,
    units: units.map(u => u.unit),
    items,
    byId,
    unitOf,
    family,
    pairs,
    pairsOf,
    get: id => byId.get(id),
    partsOf: x => (x && x.k === 'word' ? (x.parts || []).map(f => byId.get(partId(f)) || { id: partId(f), t: f, ko: [], missing: true }) : []),
  };
}

// 데이터 검사: 빈 칸, 중복, 없는 조각 참조, 없는 짝 참조. 문제를 글로 돌려준다.
export function checkData(units, pairs = [], confusions = []) {
  const errors = [];
  const seen = new Map();
  const KINDS = new Set(['part', 'word', 'abbr']);
  for (const u of units) {
    if (!u.unit || !u.unit.id || !u.unit.title) errors.push('장 정보가 비었어요: ' + JSON.stringify(u.unit));
    for (const it of u.items || []) {
      const where = (u.unit && u.unit.id) + ' ' + (it.id || it.t);
      if (!it.id) errors.push(where + ': id가 없어요');
      if (!KINDS.has(it.k)) errors.push(where + ': 종류(k)가 part/word/abbr가 아니에요');
      if (!it.t || !String(it.t).trim()) errors.push(where + ': 영어(t)가 비었어요');
      if (!Array.isArray(it.ko) || !it.ko.length || it.ko.some(s => !String(s).trim())) errors.push(where + ': 한글 뜻(ko)이 비었어요');
      if (![1, 2, 3].includes(it.star)) errors.push(where + ': 중요도(star)는 1~3이어야 해요');
      if (!['core', 'ext'].includes(it.stage)) errors.push(where + ': 단계(stage)는 core/ext여야 해요');
      if (it.k === 'abbr' && !it.full) errors.push(where + ': 약어의 영어 풀이(full)가 비었어요');
      const expect = { part: 'p:', word: 'w:', abbr: 'a:' }[it.k];
      if (it.id && expect && it.id !== expect + it.t) errors.push(where + ': id는 ' + expect + it.t + ' 이어야 해요');
      if (seen.has(it.id)) errors.push(where + ': id가 겹쳐요 (' + seen.get(it.id) + ')');
      else seen.set(it.id, u.unit && u.unit.id);
    }
  }
  for (const u of units) {
    for (const it of u.items || []) {
      if (it.k !== 'word') continue;
      for (const f of it.parts || []) if (!seen.has(partId(f))) errors.push(u.unit.id + ' ' + it.id + ': 없는 조각 ' + f + ' 을 써요');
    }
  }
  pairs.forEach((p, i) => {
    if (!p.t || !p.a || !p.b) errors.push('짝 ' + (i + 1) + ': 제목·설명이 비었어요');
    for (const id of [...(p.w || []), ...(p.sa || []), ...(p.sb || [])]) if (!seen.has(id)) errors.push('짝 ' + p.t + ': 없는 항목 ' + id);
  });
  confusions.forEach(g => {
    if (!g.t || !Array.isArray(g.w) || g.w.length < 2) errors.push('헷갈리는 묶음 ' + (g.t || '?') + ': 용어가 2개 이상이어야 해요');
    for (const w of g.w || []) if (!['w:', 'p:', 'a:'].some(p => seen.has(p + w))) errors.push('헷갈리는 묶음 ' + g.t + ': 없는 용어 ' + w);
  });
  return errors;
}
