// 하랑노트(cheongjin-note)의 의학용어 원본을 메디보카 단어 파일(data/)로 옮긴다.
// 한 번 쓰는 도구다. 옮긴 뒤에는 data/ 파일이 원본이고, 단어는 data/에서 고친다.
// 쓰는 법: node scripts/convert-harang.mjs <하랑노트 폴더의 subjects 경로>
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const src = process.argv[2];
if (!src) { console.error('하랑노트 subjects 폴더 경로를 넣어 주세요'); process.exit(1); }

const subjects = [];
const ctx = {
  NSA: {
    subject: o => subjects.push(o),
    more: (id, o) => {
      const s = subjects.find(x => x.id === id);
      if (o.units) s.units.push(...o.units);
      for (const k of Object.keys(o)) if (k !== 'units') s[k] = o[k];
    },
  },
};
vm.createContext(ctx);
for (const f of ['medical-terminology.js', 'medical-terminology-2.js', 'medical-terminology-en.js']) {
  vm.runInContext(fs.readFileSync(path.join(src, f), 'utf8'), ctx, { filename: f });
}
const S = subjects[0];
const EN = S.en || { parts: {}, words: {}, abbr: {} };

const split = s => String(s || '').split('·').map(x => x.trim()).filter(Boolean);
const tipOf = s => {
  if (!s) return undefined;
  const i = s.indexOf('|');
  return i < 0 ? { s: s.trim() } : { k: s.slice(0, i).trim(), s: s.slice(i + 1).trim() };
};
const stageOf = star => (star >= 2 ? 'core' : 'ext');
const clean = o => { for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === '' || (Array.isArray(o[k]) && !o[k].length)) delete o[k]; return o; };
const enOf = (tbl, key) => {
  const v = tbl[key];
  if (!v) return {};
  const [def, lay, rn] = v;
  return { def, lay: lay ? lay.split('|').map(x => x.trim()).filter(Boolean) : undefined, rn };
};

const outDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
const index = [];
S.units.forEach((u, i) => {
  const items = [];
  for (const r of u.parts || []) {
    const [t, ko, star, tip, memo] = r;
    items.push(clean({ id: 'p:' + t, k: 'part', t, ko: split(ko), star, stage: stageOf(star), tip: tipOf(tip), memo, def: EN.parts[t] }));
  }
  for (const r of u.words || []) {
    const [t, ko, parts, star, mean, tip, memo] = r;
    items.push(clean({ id: 'w:' + t, k: 'word', t, ko: split(ko), parts: String(parts || '').split('+').map(x => x.trim()).filter(Boolean), star, stage: stageOf(star), mean, tip: tipOf(tip), memo, ...enOf(EN.words, t) }));
  }
  for (const r of u.abbr || []) {
    const [t, full, ko, star, tip, memo] = r;
    items.push(clean({ id: 'a:' + t, k: 'abbr', t, full, ko: split(ko), star, stage: stageOf(star), tip: tipOf(tip), memo, ...enOf(EN.abbr, t) }));
  }
  const n = String(i + 1).padStart(2, '0');
  const file = `terms-${n}.js`;
  const body = '// ' + (i + 1) + '장 ' + u.title + ' (하랑노트 의학용어에서 옮김)\n' +
    '// 형식은 data/README.md 참고. 고친 뒤 npm run check 로 검사한다.\n' +
    'export default {\n' +
    `  unit: ${JSON.stringify({ id: u.id, n: i + 1, title: u.title, short: u.short })},\n` +
    '  items: [\n' + items.map(o => '    ' + JSON.stringify(o)).join(',\n') + '\n  ],\n};\n';
  fs.writeFileSync(path.join(outDir, file), body);
  index.push(file);
});

// 헷갈리는 짝: 설명 a·b 안에 이름이 나오는 쪽으로 나눈다
const pairs = (S.pairs || []).map(p => {
  const side = w => (p.a.includes(w) ? 'a' : p.b.includes(w) ? 'b' : null);
  const ids = w => (w.includes('/') || w.startsWith('-') || w.endsWith('-') ? 'p:' + w : 'w:' + w);
  const sa = [], sb = [];
  for (const w of p.w || []) { const s = side(w); if (s === 'a') sa.push(ids(w)); else if (s === 'b') sb.push(ids(w)); }
  return clean({ t: p.t, a: p.a, b: p.b, unit: p.u, w: (p.w || []).map(ids), sa, sb });
});
fs.writeFileSync(path.join(outDir, 'pairs.js'),
  '// 헷갈리는 짝. sa와 sb에 있는 항목은 같은 날 처음 배우지 않는다.\n' +
  'export default [\n' + pairs.map(o => '  ' + JSON.stringify(o)).join(',\n') + '\n];\n');

fs.writeFileSync(path.join(outDir, 'index.js'),
  '// 단어 파일 목록. 새 파일을 만들면 여기에 더한다.\n' +
  index.map((f, i) => `import t${i + 1} from './${f}';`).join('\n') + "\nimport pairs from './pairs.js';\n\n" +
  'export const UNITS = [' + index.map((_, i) => 't' + (i + 1)).join(', ') + '];\nexport const PAIRS = pairs;\n');
console.log('옮김:', index.length, '개 파일,', pairs.length, '개 짝');
