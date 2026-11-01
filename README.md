# Dalton House

준환·나예 가족 투자 자산 현황 + 가계부 앱 (휴대폰 홈 화면에 설치해서 사용).

- 앱 주소: https://tal163396-ai.github.io/Dalton-House-invest/
- 데이터: 구글 시트 (이 저장소에는 자산 데이터가 없습니다)
- 고치는 방법·계산 규칙·배포 순서: **[MAINTENANCE.md](MAINTENANCE.md)**
- 자동 점검: `node tests/run.js`

| 파일 | 역할 |
|---|---|
| `index.html`, `app.css`, `app.js` | 앱 화면 (투자) |
| `hh.js` | 앱 화면 (가계부) |
| `config.js` | 구글 Apps Script 웹앱 주소 |
| `manifest.webmanifest`, `sw.js`, `icons/` | 홈 화면 설치용 |
| `apps-script/Code.gs` | 구글 시트에 붙여 넣는 서버 코드 |
| `tests/` | Code.gs 자동 점검 (가짜 데이터) |
