// 단어 데이터 검사: node scripts/check-data.mjs (또는 npm run check)
import { UNITS, PAIRS } from '../data/index.js';
import { checkData } from '../src/data.js';

const errors = checkData(UNITS, PAIRS);
const n = UNITS.reduce((a, u) => a + u.items.length, 0);
const by = k => UNITS.reduce((a, u) => a + u.items.filter(x => x.k === k).length, 0);
console.log(`단어 데이터: ${UNITS.length}개 장, 조각 ${by('part')} · 단어 ${by('word')} · 약어 ${by('abbr')} (= ${n}), 헷갈리는 짝 ${PAIRS.length}`);
if (errors.length) {
  console.log('고칠 것 ' + errors.length + '개:');
  for (const e of errors) console.log(' - ' + e);
  process.exit(1);
}
console.log('문제 없음');
