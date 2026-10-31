// 색 테마 5가지와 모양 2가지. 실제 색 값은 app.css의 [data-theme]에 있다(여기의 pri는 고르는 동그라미 색).
export const THEMES = [
  { id: 'burgundy', name: '버건디', pri: '#7b2d43', mood: '깊고 차분한 와인빛. 올해 가장 눈에 띄는 색' },
  { id: 'glacier', name: '글래시어', pri: '#2f6690', mood: '맑은 얼음빛 하늘색. 깔끔하고 시원해요' },
  { id: 'lavender', name: '라벤더', pri: '#6a58b3', mood: '은은한 보랏빛. 부드럽고 세련된 느낌' },
  { id: 'sage', name: '세이지', pri: '#4c6b55', mood: '차분한 회녹색. 눈이 편해서 오래 봐도 좋아요' },
  { id: 'sunset', name: '선셋', pri: '#b4501c', mood: '따뜻한 노을빛 오렌지. 기운이 나는 색' },
];
export const LOOKS = [
  { id: 'basic', name: '기본', desc: '또렷한 카드와 테두리' },
  { id: 'soft', name: '부드러움', desc: '둥근 버튼과 손글씨 제목' },
];
export const themeOf = id => THEMES.find(t => t.id === id) || THEMES[0];

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
