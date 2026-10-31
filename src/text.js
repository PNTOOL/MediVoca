// 글자 다루기. 하랑노트 app.js의 plain · normEn · normKo · lev · gradeWr를 가져와 다듬었다.
export const plain = s => String(s == null ? '' : s).replace(/\*\*/g, '');
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// **굵게** → <b>, 줄바꿈 → <br>
export const rich = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');

export const normEn = s => String(s || '').toLowerCase().replace(/[\s\-\/\.'’,()]/g, '');
export const normKo = s => String(s || '').replace(/\([^)]*\)/g, '').replace(/[\s·,.\-~()]/g, '');

export function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let p = [];
  for (let j = 0; j <= n; j++) p[j] = j;
  for (let i = 1; i <= m; i++) {
    const q = [i];
    for (let j = 1; j <= n; j++) q[j] = Math.min(p[j] + 1, q[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    p = q;
  }
  return p[n];
}

// 철자 쓰기 채점 (3차 철자 카드에서 쓴다). near = 한 글자만 틀림
export function gradeSpell(answers, input) {
  const a = normEn(input);
  if (!a) return { ok: false };
  if (answers.some(z => normEn(z) === a)) return { ok: true };
  const d = Math.min(...answers.map(z => lev(normEn(z), a)));
  return { ok: false, near: d === 1 && a.length >= 4 };
}

// 뜻 쓰기 채점: 같은 뜻 다른 말 모두 인정, 앞뒤 한두 글자 차이는 맞음
export function gradeMeaning(answers, input) {
  const a = normKo(input);
  if (!a) return { ok: false };
  return {
    ok: answers.some(z => {
      const b = normKo(z);
      return b && (b === a || (b.length >= 2 && a.includes(b) && a.length - b.length <= 2) || (a.length >= 2 && b.includes(a) && b.length - a.length <= 1));
    }),
  };
}

// 조각 형태를 발음하기 좋게: 'cardi/o' → 'cardio', '-itis' → 'itis'
export const speakable = t => String(t).replace(/\/(?=[a-z])/g, '').replace(/\//g, ' ').replace(/^-|-$/g, '');
