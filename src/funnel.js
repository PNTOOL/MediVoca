// 단어 고르기: 위에서부터 한 단계씩 좁혀 간다. 단계마다 남은 단어 수를 보여 줄 수 있게 순수 함수로.
// f = { src, ans, star, kind, units, conf, grp, mates }
//   src   'all' 전체 | 'studied' 내가 공부한 단어 중에서 | 'new' 아직 안 본 단어 | 'list' 지금 목록 안에서
//   ans   공부한 단어 중에서 고를 때 마지막 답 '1234' 중 일부 + 'w' 틀린 적 있음 (빈 글자 = 전부)
//   star  '321' 중 일부 (빈 글자 = 전부) · kind 'pwa' 중 일부 (조각·단어·약어) · units 단원 id 배열 (빈 배열 = 전부)
//   conf  'off' 거르지 않음 | 'has' 헷갈리는 짝이 있는 단어만 | 'grp' 묶음 하나(grp = 묶음 번호)
//   mates true면 남은 단어의 헷갈리는 짝도 같이 넣는다
// ctx = { states, marks (id → { last }), listIds }
export const KIND_KEY = { part: 'p', word: 'w', abbr: 'a' };

export const STEPS = [
  { key: 'src', name: '어디서' },
  { key: 'star', name: '중요도' },
  { key: 'kind', name: '종류' },
  { key: 'units', name: '계통' },
  { key: 'conf', name: '헷갈리는 짝' },
];

function stepSrc(xs, f, ctx) {
  if (f.src === 'new') return xs.filter(x => !ctx.states.has(x.id));
  if (f.src === 'list') { const set = new Set(ctx.listIds || []); return xs.filter(x => set.has(x.id)); }
  if (f.src === 'studied') {
    const ans = f.ans || '';
    return xs.filter(x => {
      const s = ctx.states.get(x.id);
      if (!s) return false;
      if (!ans) return true;
      const m = ctx.marks.get(x.id);
      if (m && ans.includes(String(m.last))) return true;
      return ans.includes('w') && s.fails > 0;
    });
  }
  return xs;
}
const stepStar = (xs, f) => (f.star ? xs.filter(x => f.star.includes(String(x.star))) : xs);
const stepKind = (xs, f) => (f.kind ? xs.filter(x => f.kind.includes(KIND_KEY[x.k])) : xs);
const stepUnits = (xs, f) => (f.units && f.units.length ? xs.filter(x => f.units.includes(x.unit)) : xs);
function stepConf(xs, f, ctx, index) {
  let out = xs;
  if (f.conf === 'has') out = xs.filter(x => index.groupsOf.has(x.id));
  else if (f.conf === 'grp' && index.groups[f.grp]) { const g = new Set(index.groups[f.grp].ids); out = xs.filter(x => g.has(x.id)); }
  if (f.mates) {
    const ids = new Set(out.map(x => x.id));
    for (const x of out) for (const g of index.groupsOf.get(x.id) || []) for (const id of g.ids) ids.add(id);
    out = index.items.filter(x => ids.has(x.id));
  }
  return out;
}
const FNS = [stepSrc, stepStar, stepKind, stepUnits, stepConf];

// 단계마다 남은 단어 목록. sets[0] = 전체, sets[i+1] = i번째 단계 뒤
export function runFunnel(index, ctx, f) {
  const sets = [index.items];
  FNS.forEach((fn, i) => sets.push(fn(sets[i], f, ctx, index)));
  return { sets, result: sets[sets.length - 1] };
}

// 한 단계에서 다른 값을 고르면 몇 개가 남는지 (칩에 미리 보여 줄 수)
export function countIf(index, ctx, f, stepIndex, patch) {
  const { sets } = runFunnel(index, ctx, f);
  return FNS[stepIndex](sets[stepIndex], { ...f, ...patch }, ctx, index).length;
}

// 지금 남은 단어가 들어 있는 헷갈리는 용어 묶음과 그 안의 남은 수
export function groupsIn(index, xs) {
  const ids = new Set(xs.map(x => x.id));
  return index.groups.map((g, i) => ({ i, t: g.t, n: g.ids.filter(id => ids.has(id)).length, all: g.ids.length })).filter(g => g.n > 0);
}
