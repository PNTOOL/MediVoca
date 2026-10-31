// 공부 방법·사용법 안내. 처음 열 때 한 번 보여 주고, 그 뒤에는 홈의 "사용법"에서 연다.
// 설계안의 "앱 안내 페이지"를 따른다. "연구"는 근거 표의 연구, "앱 규칙"은 이 앱이 정한 숫자.

const METHODS = [
  ['읽지 말고 떠올리기', '단어를 보면 뜻을 먼저 떠올리고 나서 답을 봐요. 다시 읽기보다 훨씬 오래 남아요.', '연구'],
  ['몰라도 먼저 짐작하기', '처음 보는 단어도 조각으로 뜻을 짐작해 봐요. 틀려도 그냥 보는 것보다 잘 기억해요.', '연구'],
  ['틀린 단어는 그날 다시', '틀린 단어는 몇 장 뒤에 다시 나와요. 그날 안에 한 번은 맞히고 끝내요.', '연구'],
  ['잊을 때쯤 다시', '1일 → 3일 → 8일 → 3주처럼 간격을 늘려 다시 봐요. 다른 날 3번 맞히면 "익힘"이에요.', '간격은 연구, 날짜와 3번은 앱 규칙'],
  ['"안다"는 확인하기', '안다고 골랐으면 정답과 맞춰 봐요. 느낌만으로는 실제보다 안다고 생각하기 쉬워요.', '연구'],
  ['몰아서 말고 매일 조금', '시험 전에 몰아 보면 시험은 넘겨도 금방 잊어요. 매일 짧게 봐요 (기본 약 15분).', '연구, 15분은 앱 계산'],
  ['장기별로 묶고, 헷갈리는 짝은 따로', '같은 조각을 쓰는 단어는 묶어 배우고, dysphagia·dysphasia 같은 짝은 같은 날 처음 배우지 않아요.', '묶기는 설계 원칙, 짝 떼기는 연구'],
  ['억지 연상은 보조로', '말장난 암기법은 조각으로 풀리지 않는 단어에만 써요.', '연구'],
];

const DONT = [
  ['형광펜 긋고 다시 읽기만 하기', '효과가 낮아요.'],
  ['한 번 맞혔다고 카드 빼기', '스스로 빼면 효과가 사라져요. 빼는 건 앱에 맡겨요.'],
  ['하루에 수백 개 몰아 넣기', '며칠 뒤 복습이 한꺼번에 몰려 와 포기하기 쉬워요.'],
];

const SOURCES = [
  ['Dunlosky 등 (2013): 10가지 공부법 비교, 연습 시험과 나눠 보기만 "높음"', 'https://www.psychologicalscience.org/news/releases/which-study-strategies-make-the-grade.html'],
  ['Kornell 등 (2009): 답을 보기 전에 떠올리려다 틀려도 더 잘 기억', 'https://www.scientificamerican.com/article/the-pluses-of-getting-it-wrong/'],
  ['Rawson · Dunlosky: 연속 재학습 (맞힐 때까지, 다른 날 다시)', 'https://www.retrievalpractice.org/archive/2018/successive-relearning'],
  ['Weaver · Kelemen (1997): 시간이 지난 뒤 단서만 보고 판단하면 정확', 'https://www.psychologicalscience.org/journals/psychological-science/j.1467-9280.1997.tb00445.x/'],
  ['FSRS: 목표 기억률로 복습 날짜를 정하는 방법 (Anki 설명서)', 'https://docs.ankiweb.net/faqs/what-spaced-repetition-algorithm'],
];

export function guideHTML(first) {
  return `
  <header class="top"><h1>${first ? '메디보카에 오신 걸 환영해요' : '사용법'}</h1>${first ? '' : '<button class="btn small" data-act="home">닫기</button>'}</header>
  <section class="panel lead">
    <p>이 앱은 연구에서 암기 효과가 가장 높게 나온 두 방법,
    <b>스스로 떠올리기</b>와 <b>간격을 두고 다시 보기</b>로 만들었어요.</p>
    <p class="sub">다시 읽기·밑줄·요약은 효과가 낮아서 "그냥 훑어보기" 화면은 없어요. 카드는 항상 떠올리기부터 시작해요.</p>
  </section>

  <section class="panel">
    <h2>버튼 쓰는 법</h2>
    <p class="sub">영어 단어를 보고 뜻을 <b>먼저 떠올린 뒤</b>, 얼마나 아는지 골라요.</p>
    <ul class="howbtn">
      <li><span class="g g1">모름</span><span>설명을 보여 주고, 5장 뒤에 다시 나와요. 끝에 한 번 더 봐요.</span></li>
      <li><span class="g g2">헷갈림</span><span>설명을 보여 주고, 5장 뒤에 다시 나와요.</span></li>
      <li><span class="g g3">알 것 같음</span><span>정답을 보고 <b>맞았어요 / 틀렸어요</b>를 눌러요. 약 3일 뒤 다시.</span></li>
      <li><span class="g g4">확실히 앎</span><span>정답과 조각 뜻까지 확인해요. 약 1~2주 뒤 다시.</span></li>
    </ul>
    <p class="note">안다고 골랐는데 틀렸으면 "모름"과 똑같이 처리돼요. 솔직하게 누를수록 복습 날짜가 정확해져요.</p>
  </section>

  <section class="panel">
    <h2>하루 흐름</h2>
    <ol class="flow">
      <li><b>복습 먼저</b>: 오늘 잊을 위험이 큰 단어부터</li>
      <li><b>새 단어</b>: 조각을 먼저, 그 조각으로 만든 단어를 이어서</li>
      <li><b>마무리</b>: 오늘 몰랐던 단어를 한 번 더</li>
    </ol>
    <p class="note">중간에 나가도 하던 곳이 저장돼요. 하루는 새벽 4시에 바뀌어요.</p>
  </section>

  <section class="panel">
    <h2>공부 방법 8가지</h2>
    <ol class="methods">
      ${METHODS.map(([t, d, why]) => `<li><b>${t}</b><p>${d}</p><span class="why">${why}</span></li>`).join('')}
    </ol>
  </section>

  <section class="panel">
    <h2>하지 마세요</h2>
    <ul class="dont">${DONT.map(([t, d]) => `<li><b>${t}</b> ${d}</li>`).join('')}</ul>
  </section>

  <section class="panel">
    <h2>폰과 컴퓨터</h2>
    <p class="sub">가입은 없어요. 기록은 이 기기에만 저장되고, 홈의 <b>백업 · 옮기기</b>로 카톡 "나와의 채팅"에 보내 다른 기기에서 합쳐요.</p>
    <p class="sub">컴퓨터에서는 키보드로: <kbd>1</kbd>~<kbd>4</kbd> 단계, 확인 화면 <kbd>Enter</kbd> 맞음 · <kbd>X</kbd> 틀림, 설명 화면 <kbd>Space</kbd> 다음, <kbd>P</kbd> 발음, <kbd>H</kbd> 조각 힌트.</p>
  </section>

  <details class="panel sources"><summary>근거 출처 보기</summary>
    <p class="note">"연구"는 아래 연구에서 온 것이고, "앱 규칙"·"앱 계산"은 연구를 이 앱에 맞춰 정한 숫자예요.</p>
    <ul>${SOURCES.map(([t, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${t}</a></li>`).join('')}</ul>
  </details>

  <div class="checks one">${first
    ? '<button class="btn primary big" data-act="firstplan">공부 계획 정하기</button>'
    : '<button class="btn primary big" data-act="home">닫기</button>'}</div>`;
}
