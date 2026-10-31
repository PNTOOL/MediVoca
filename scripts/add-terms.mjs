// 새 단어를 장 파일(data/terms-XX.js)에 더한다. 쓰는 법: node scripts/add-terms.mjs <추가 파일.mjs> ...
// 추가 파일 형식 (한 장에 하나):
//   export default {
//     unit: 'm08',
//     parts: [['형태', '뜻·다른 뜻', 중요도]],
//     words: [['영어', '뜻·다른 뜻', '조각+조각', 중요도, '쉽게 푼 뜻', '영어 정의(선택)']],
//     abbr:  [['약어', '영어 풀이', '뜻', 중요도, '쉽게 푼 뜻(선택)']],
//   }
// 이미 있는 id는 건너뛰고, 다 더한 뒤에는 npm run check 로 검사한다.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DATA = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
const split = s => String(s || '').split('·').map(x => x.trim()).filter(Boolean);
const stage = n => (n >= 2 ? 'core' : 'ext');
const clean = o => { for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === '' || (Array.isArray(o[k]) && !o[k].length)) delete o[k]; return o; };

const files = fs.readdirSync(DATA).filter(f => /^terms-\d+\.js$/.test(f)).sort();
const loaded = {};
for (const f of files) loaded[f] = (await import(pathToFileURL(path.join(DATA, f)).href + '?t=' + Date.now())).default;
const unitFile = Object.fromEntries(files.map(f => [loaded[f].unit.id, f]));
const allIds = new Set(files.flatMap(f => loaded[f].items.map(x => x.id)));

for (const addPath of process.argv.slice(2)) {
  const add = (await import(pathToFileURL(path.resolve(addPath)).href)).default;
  const f = unitFile[add.unit];
  if (!f) throw new Error('없는 장: ' + add.unit);
  const items = loaded[f].items;
  let n = 0, skipped = [];
  const put = o => { if (allIds.has(o.id)) { skipped.push(o.id); return; } allIds.add(o.id); items.push(clean(o)); n++; };
  for (const [t, ko, star] of add.parts || []) put({ id: 'p:' + t, k: 'part', t, ko: split(ko), star, stage: stage(star) });
  for (const [t, ko, parts, star, mean, def] of add.words || []) put({ id: 'w:' + t, k: 'word', t, ko: split(ko), parts: String(parts || '').split('+').map(x => x.trim()).filter(Boolean), star, stage: stage(star), mean, def });
  for (const [t, full, ko, star, mean] of add.abbr || []) put({ id: 'a:' + t, k: 'abbr', t, full, ko: split(ko), star, stage: stage(star), mean });
  writeUnit(f, loaded[f]);
  console.log(`${add.unit}: ${n}개 더함${skipped.length ? ', 이미 있어 건너뜀: ' + skipped.join(', ') : ''}`);
}

export function writeUnit(f, data) {
  const old = fs.readFileSync(path.join(DATA, f), 'utf8');
  const head = old.split('\n').filter(l => l.startsWith('//')).slice(0, 2).join('\n');
  const body = head + '\n' +
    'export default {\n' +
    `  unit: ${JSON.stringify(data.unit)},\n` +
    '  items: [\n' + data.items.map(o => '    ' + JSON.stringify(o)).join(',\n') + '\n  ],\n};\n';
  fs.writeFileSync(path.join(DATA, f), body);
}
