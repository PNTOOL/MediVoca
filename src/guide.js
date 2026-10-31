// 공부 방법·사용법 안내. 처음 열 때 한 번 보여 주고, 그 뒤에는 홈의 "사용법"에서 연다.
// 설계안의 "앱 안내 페이지"를 따른다. "연구"는 근거 표의 연구, "앱 규칙"은 이 앱이 정한 숫자.

const METHODS = [
  ['읽지 말고 떠올리기', '단어를 보면 뜻을 먼저 떠올리고 나서 답을 봐요. 다시 읽기보다 훨씬 오래 남아요.', '연구'],
  ['몰라도 먼저 짐작하기', '처음 보는 단어도 조각으로 뜻을 짐작해 봐요. 틀려도 그냥 보는 것보다 잘 기억해요.', '연구'],
  ['틀린 단어는 그날 다시', '틀린 단어는 몇 장 뒤에 다시 나와요. 그날 안에 한 번은 맞히고 끝내요.', '연구'],
  ['잊을 때쯤 다시', '단어마다 기억을 계산해서 잊기 직전에 다시 보여 줘요. 맞힐수록 간격이 길어지고, 다른 날 3번 맞히면 "외운 단어"가 돼요.', '간격은 연구, 3번은 앱 규칙'],
  ['"안다"는 확인하기', '안다고 골랐으면 정답과 맞춰 봐요. 느낌만으로는 실제보다 안다고 생각하기 쉬워요.', '연구'],
  ['몰아서 말고 매일 조금', '시험 전에 몰아 보면 시험은 넘겨도 금방 잊어요. 매일 짧게 봐요 (보통 하루 15~20분).', '연구, 분은 앱 계산'],
  ['장기별로 묶고, 헷갈리는 짝은 따로', '같은 조각을 쓰는 단어는 묶어 배우고, dysphagia·dysphasia 같은 헷갈리는 짝은 같은 날 처음 배우지 않아요.', '묶기는 설계 원칙, 짝 떼기는 연구'],
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

// 사용법: 화면 순서대로 짧게. 첫 칸만 열어 두고 나머지는 눌러서 펼친다.
const SEC = (title, body, open = false) => `<details class="panel gsec"${open ? ' open' : ''}><summary>${title}</summary><div class="gbody">${body}</div></details>`;

export function guideHTML(first) {
  return `
  <header class="top"><h1>${first ? '메디보카에 오신 걸 환영해요' : '사용법'}</h1>${first ? '' : '<button class="btn small" data-act="home">닫기</button>'}</header>
  <section class="panel lead">
    <p><b>답을 보기 전에 먼저 떠올리고, 잊기 직전에 다시 보는 앱</b>이에요. 연구에서 암기 효과가 가장 높게 나온 두 방법이에요.</p>
    <p class="sub">궁금한 칸을 눌러 보세요.</p>
  </section>

  ${SEC('1. 첫 화면: 오늘 공부할 단어장', `
    <ul class="gl">
      <li>맨 위 칸이 <b>오늘 공부할 단어장</b>이에요. 처음에는 마지막에 공부한 단어장이 나와요.</li>
      <li><b>오늘 공부 시작</b> 또는 <b>이어서 하기</b>를 누르면 돼요. 그만둬도 하던 곳은 단어장마다 따로 기억해요.</li>
      <li>아래 <b>다른 단어장</b>에서 "고르기"를 누르면 오늘 공부할 단어장이 바뀌어요.</li>
      <li>위의 검색 칸에 영어나 한글을 쓰면 단어를 바로 찾아 볼 수 있어요.</li>
    </ul>`, true)}

  ${SEC('2. 카드 공부: 버튼 4개', `
    <p class="sub">영어 단어를 보고 뜻을 <b>먼저 떠올린 뒤</b>, 얼마나 아는지 골라요.</p>
    <ul class="howbtn">
      <li><span class="g g1">모름</span><span>전혀 안 떠올라요 → 설명을 보고, 몇 장 뒤에 다시 나와요.</span></li>
      <li><span class="g g2">헷갈림</span><span>비슷한 말과 섞여요 → 설명을 보고, 몇 장 뒤에 다시 나와요.</span></li>
      <li><span class="g g3">알 것 같음</span><span>조금 생각하면 떠올라요 → 정답을 보고 맞았는지 한 번 더 눌러요.</span></li>
      <li><span class="g g4">확실히 앎</span><span>바로 떠올라요 → 정답을 보고 맞았는지 한 번 더 눌러요.</span></li>
    </ul>
    <p class="note">안다고 눌렀는데 틀렸으면 "모름"으로 쳐요. 솔직하게 누를수록 복습 날짜가 정확해져요.</p>
    <p class="note">하루 순서: 복습 먼저 → 새 단어(조각 먼저, 그 조각으로 만든 단어 다음) → 오늘 몰랐던 단어 한 번 더. 하루는 새벽 4시에 바뀌어요.</p>
    <p class="note">카드의 <b>☆ 중요</b>를 누르면 단어 탭의 "★ 중요"에 모여요.</p>`)}

  ${SEC('3. 철자 카드: 한글 보고 영어 쓰기', `
    <ul class="gl">
      <li>외운 단어는 <b>한글 뜻을 보고 영어를 직접 쓰는 카드</b>로 복습에 섞여 나와요.</li>
      <li>앱이 채점해요. 한 글자라도 틀리면 틀린 글자를 빨갛게 보여 주고, 정답을 한 번 따라 써야 넘어가요.</li>
      <li>"힌트 보기"를 누르면 조각이 나와요. 힌트를 보고 맞히면 조금 더 빨리 다시 나와요.</li>
      <li>설정 ⚙ → 철자 카드에서 끄거나 약어·조각까지 넣을 수 있어요.</li>
    </ul>`)}

  ${SEC('4. 단어장 고르고 만들기', `
    <ul class="gl">
      <li><b>추천 단어장</b>: 앱이 정한 순서(조각 → 인체 → 계통별 → 약어). 처음이면 이걸로 시작하세요.</li>
      <li><b>학교 수업 단어장</b>: 강의계획서나 교재 목차를 보면서 단원을 수업 순서대로 눌러 만들어요.</li>
      <li><b>내 단어장</b>: 여러 개 만들 수 있어요 (예: 중간고사, 교수님 단어). 위에서부터 차례로 좁혀 가며 골라요.
        <br><span class="sub">어디서(전체 · 내가 공부한 단어 중에서 · 아직 안 본 단어) → 중요도 → 종류 → 단원 → 헷갈리는 짝. 단계마다 남은 단어 수가 보여요.</span></li>
      <li>교수님 단어를 붙여 넣으면 앱에 있는 단어를 한 번에 찾아 줘요.</li>
    </ul>`)}

  ${SEC('5. 기간과 하루 양', `
    <ul class="gl">
      <li>단어장마다 <b>몇 주 안에 끝낼지</b> 정하면 하루 새 단어 수와 시간을 계산해 줘요.</li>
      <li>단어장 화면의 <b>과정</b> 칸에서 몇 주째인지, 몇 % 봤는지 볼 수 있어요.</li>
      <li>늦어지면 "남은 단어 기간 바꾸기"로 남은 단어만 새 기간에 나눠요. 공부한 기록은 그대로예요.</li>
      <li>오늘만 더 하거나 덜 하고 싶으면 <b>오늘 양 바꾸기</b>를 눌러요.</li>
      <li><b>단원별 진도 · 순서 바꾸기</b>에서 "이 단원 먼저"를 누르면 그 단원부터 새 단어가 나와요.</li>
    </ul>`)}

  ${SEC('6. 시험', `
    <ul class="gl">
      <li><b>바로 시작</b> 3가지: 오늘 공부한 단어로 · 틀리고 헷갈린 단어로 · 철자 연습. 누르면 바로 문제가 나와요.</li>
      <li>범위나 문제 유형, 실전 모드(시간 제한)는 <b>직접 정하기</b>에서 골라요.</li>
      <li>보기는 일부러 헷갈리게 만들어요. 철자를 조금 바꾼 함정이나 한글이 비슷한 용어가 섞여 있어요.</li>
      <li>틀리거나 "헷갈렸어요"를 누르면 바로 단어 카드가 나와요. 끝나고 "내일 복습에 넣기"도 할 수 있어요.</li>
    </ul>`)}

  ${SEC('7. 단어 탭과 기록 탭', `
    <ul class="gl">
      <li><b>단어</b>: 단어 찾기, 내 단어장 관리, 단어 모음(모름 · 헷갈림 · 시험에서 틀림 · ★ 중요 · 자꾸 틀리는 단어). 모음에서 바로 다시 공부하거나 시험을 볼 수 있어요.</li>
      <li><b>기록</b>: 이번 주 공부, 달력(날짜를 누르면 그날 어떤 단어장을 몇 장 했는지), 최근 30일 그래프, 단어장별 현황.</li>
    </ul>`)}

  ${SEC('8. 폰 ↔ 컴퓨터 옮기기', `
    <ul class="gl">
      <li>가입은 없어요. 기록은 이 기기에만 저장돼요.</li>
      <li>설정 ⚙ → <b>백업 보내기</b> → 카카오톡 "나와의 채팅"에 보내요.</li>
      <li>다른 기기에서 그 파일을 <b>백업 불러오기</b>로 열면 기록이 합쳐져요. 지금 기록은 지워지지 않아요.</li>
      <li>폰을 잃어버리면 기록도 없어지니, 일주일에 한 번은 백업해 두세요.</li>
    </ul>`)}

  ${SEC('9. 컴퓨터에서 키보드로', `
    <p class="sub"><kbd>1</kbd>~<kbd>4</kbd> 버튼 4개 · 확인 화면 <kbd>Enter</kbd> 맞음, <kbd>X</kbd> 틀림 · 설명 화면 <kbd>Space</kbd> 다음 · <kbd>P</kbd> 발음 · <kbd>H</kbd> 조각 힌트 · <kbd>F</kbd> ★ 중요</p>`)}

  <details class="panel gsec"><summary>왜 이렇게 공부하나요? (연구 근거)</summary><div class="gbody">
    <ol class="methods">
      ${METHODS.map(([t, d, why]) => `<li><b>${t}</b><p>${d}</p><span class="why">${why}</span></li>`).join('')}
    </ol>
    <h3 class="st-h">하지 마세요</h3>
    <ul class="dont">${DONT.map(([t, d]) => `<li><b>${t}</b> ${d}</li>`).join('')}</ul>
    <h3 class="st-h">출처</h3>
    <p class="note">"연구"는 아래 연구에서 온 것이고, "앱 규칙"·"앱 계산"은 연구를 이 앱에 맞춰 정한 숫자예요.</p>
    <ul>${SOURCES.map(([t, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${t}</a></li>`).join('')}</ul>
  </div></details>

  <div class="checks one">${first
    ? '<button class="btn primary big" data-act="firstplan">공부 계획 정하기</button>'
    : '<button class="btn primary big" data-act="home">닫기</button>'}</div>`;
}
