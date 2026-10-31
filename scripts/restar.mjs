// 중요도(★) 다시 매기기: 전체 1,500개를 ★★★ 400 · ★★ 600 · ★ 500으로 맞춘다 (설계안).
// - 조각: 그 조각을 쓰는 단어 수(+ 원래 ★)로 순위를 매겨 ★★★ 162 · ★★ 124 · ★ 74
// - 단어·약어: 원래 ★을 두고, 아래 목록만 손으로 올리거나 내린다 (임상에서 매일 쓰는지 기준)
// 쓰는 법: node scripts/restar.mjs  (한 번 쓰고 나면 data/가 원본)
import { UNITS, PAIRS } from '../data/index.js';
import { buildIndex } from '../src/data.js';
import { writeUnit } from './add-terms.mjs';

const UP_WORD = ['atrial fibrillation', 'coronary artery disease', 'ischemia', 'thrombosis', 'atherosclerosis', 'pulmonary edema', 'tuberculosis', 'pleural effusion', 'atelectasis', 'tachypnea', 'orthopnea', 'gastroesophageal reflux disease', 'peptic ulcer', 'cirrhosis', 'pancreatitis', 'cholecystitis', 'hematoma', 'thrombocytopenia', 'urinary retention', 'urinary incontinence', 'hemodialysis', 'catheterization', 'acute kidney injury', 'cesarean section', 'ectopic pregnancy', 'epilepsy', 'aphasia', 'depression', 'insulin', 'glucose', 'diabetic ketoacidosis', 'necrosis', 'cellulitis', 'pruritus', 'erythema', 'ecchymosis', 'palpation', 'auscultation', 'postoperative', 'bowel obstruction', 'gastrointestinal bleeding', 'neutropenia', 'fetal heart rate', 'contraindication'];
const DOWN_WORD = ['oncology', 'carcinogen', 'sarcoma', 'adenocarcinoma', 'hyperthermia', 'hypocalcemia', 'intercostal', 'transdermal', 'pancytopenia', 'radiography', 'laryngoscope', 'geriatrics', 'umbilical region', 'epithelium', 'mucous membrane', 'lithotomy position', 'orthopedics', 'arthroscopy', 'septicemia', 'immunodeficiency', 'mitral stenosis', 'bronchoscopy', 'stomatitis', 'enteritis', 'uremia', 'ophthalmoscope', 'otoscope', 'presbycusis'];
const UP_ABBR3 = ['HR', 'RR', 'BT', 'SpO2', 'WBC', 'Hb', 'O2', 'ICU', 'UTI', 'CHF', 'GCS', 'mg', 'mL', 'CXR'];
const UP_ABBR2 = ['PR', 'Sx', 'Fx', 'Op', 'EEG', 'OR', 'DKA', 'PEG', 'MAP', 'PMH', 'NKDA', 'BPH', 'mEq'];

const IX = buildIndex(UNITS, PAIRS);
const set = (id, star) => { const x = IX.get(id); if (!x) throw new Error('없음: ' + id); x.star = star; };
for (const t of UP_WORD) { if (IX.get('w:' + t).star !== 2) throw new Error('★★가 아님: ' + t); set('w:' + t, 3); }
for (const t of DOWN_WORD) { if (IX.get('w:' + t).star !== 2) throw new Error('★★가 아님: ' + t); set('w:' + t, 1); }
for (const t of UP_ABBR3) { if (IX.get('a:' + t).star !== 2) throw new Error('★★가 아님: ' + t); set('a:' + t, 3); }
for (const t of UP_ABBR2) { if (IX.get('a:' + t).star !== 1) throw new Error('★이 아님: ' + t); set('a:' + t, 2); }

const parts = IX.items.filter(x => x.k === 'part')
  .map(p => ({ p, score: (IX.family.get(p.id) || []).length + p.star * 3 }))
  .sort((a, b) => b.score - a.score || a.p.order - b.p.order);
parts.forEach(({ p }, i) => { p.star = i < 162 ? 3 : i < 286 ? 2 : 1; });

// 원래 장 파일에 그대로 반영 (stage도 ★에 맞춤)
const byId = new Map(IX.items.map(x => [x.id, x]));
UNITS.forEach((u, i) => {
  for (const it of u.items) { const x = byId.get(it.id); it.star = x.star; it.stage = x.star >= 2 ? 'core' : 'ext'; }
  writeUnit(`terms-${String(i + 1).padStart(2, '0')}.js`, u);
});
const c = { 1: 0, 2: 0, 3: 0 };
for (const u of UNITS) for (const it of u.items) c[it.star]++;
console.log('★★★', c[3], '· ★★', c[2], '· ★', c[1]);
