// 색 테마 5가지와 모양 2가지. 실제 색 값은 app.css의 [data-theme]에 있다(여기의 pri는 고르는 동그라미 색).
export const THEMES = [
  { id: 'rose', name: '로즈', pri: '#e8a3b6', mood: '연한 장밋빛. 부드럽고 따뜻해요' },
  { id: 'sky', name: '스카이', pri: '#94c3e8', mood: '맑은 하늘색. 깔끔하고 시원해요' },
  { id: 'lavender', name: '라벤더', pri: '#b3a2e8', mood: '은은한 보랏빛. 차분하고 세련된 느낌' },
  { id: 'mint', name: '민트', pri: '#8fd1b3', mood: '산뜻한 민트. 눈이 편해서 오래 봐도 좋아요' },
  { id: 'peach', name: '피치', pri: '#f4ab86', mood: '복숭아빛 코랄. 기운이 나는 색' },
];
// 예전 테마 이름 → 새 이름
const OLD = { burgundy: 'rose', glacier: 'sky', sage: 'mint', sunset: 'peach' };
export const LOOKS = [
  { id: 'basic', name: '기본', desc: '또렷한 카드와 테두리' },
  { id: 'soft', name: '부드러움', desc: '둥근 버튼과 은은한 그림자' },
];
export const themeOf = id => THEMES.find(t => t.id === (OLD[id] || id)) || THEMES[0];

// <html>에 붙여 화면 색과 모양을 바꾼다. 다음에 열 때 깜빡이지 않게 localStorage에도 적어 둔다.
export function applyLook(theme, look) {
  const t = themeOf(theme);
  const l = LOOKS.some(x => x.id === look) ? look : 'basic';
  document.documentElement.dataset.theme = t.id;
  document.documentElement.dataset.look = l;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t.pri);
  try { localStorage.setItem('medivoca-look', JSON.stringify({ theme: t.id, look: l })); } catch (e) { /* 없어도 됨 */ }
}
