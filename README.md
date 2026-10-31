# 메디보카 (가칭)

간호학생용 의학용어 암기 웹앱. 하루 50장(약 15분), 먼저 떠올리고 → 맞춰 보고 → 모르는 것은 자주, 아는 것은 드물게.

- 앱 주소: https://pntool.github.io/MediVoca/
- 설계: [docs/설계안.md](docs/설계안.md) · 개발 메모: [CLAUDE.md](CLAUDE.md)
- 단어: 조각 292 · 단어 351 · 약어 84 (하랑노트에서 옮김, 형식은 [data/README.md](data/README.md))

## 설치
- 안드로이드: 크롬으로 열고 "앱 설치"
- 아이폰: 사파리로 열고 공유 → "홈 화면에 추가"
- 컴퓨터: 크롬·엣지 주소창의 설치 버튼

카톡에서 링크를 누르면 카톡 안 브라우저로 열려 기록이 따로 저장되니, 사파리나 크롬으로 연다.

## 개발
빌드 없음. 저장소 파일이 그대로 배포된다.
- `npm test` 테스트 · `npm run check` 단어 검사 · `npm run serve` 후 http://localhost:8080

복습 계산: [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) (MIT, vendor/에 포함)
