// Code.gs 자동 점검: 가짜 시트(fixture.js) 위에서 Code.gs 를 그대로 돌려 계산이 맞는지 확인합니다.
// 실행: node tests/run.js        (Node 18 이상, 다른 설치 필요 없음)
// 코드를 고친 뒤 배포 전에 꼭 돌리고, "모두 통과"가 나와야 배포합니다.
const fs = require('fs'), path = require('path');
const { makeGas, loadCode } = require('./gas-mock.js');
const fixture = require('./fixture.js');
const CODE = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
const NOW = '2026-11-02T00:00:00Z';   // 한국 시각 11/2 09:00

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name} ${extra}`); } };
const near = (a, b, tol = 1) => Math.abs(Number(a) - Number(b)) <= tol;

function fresh() {
  const { G, sheets } = makeGas(fixture());
  const C = loadCode(G, CODE, NOW);
  G.__pw = C.hash_('pw');
  const call = body => JSON.parse(C.doPost({ postData: { contents: JSON.stringify({ password: 'pw', ...body }) } }).s);
  const row = (asset, sub) => {
    const v = sheets['보유현황'].getDataRange().getValues(), h = v[0];
    const r = v.find(x => x[h.indexOf('자산')] === asset && (!sub || x[h.indexOf('세부종목')] === sub));
    if (!r) return null;
    const o = {}; h.forEach((k, i) => { o[k] = r[i]; }); return o;
  };
  const total = asset => sheets['보유현황'].getDataRange().getValues().filter(x => x[0] === asset).reduce((t, x) => t + (Number(x[7]) || 0), 0);
  const lastTrade = () => call({ action: 'data' }).data.trades.slice(-1)[0];
  const sig = T => ({ type: T['구분'], asset: T['자산'], sub: T['세부종목'], amt: T['금액(원)'] });
  call({ action: 'data' });   // 앱처럼 먼저 불러오기 (한 번만 하는 이름 바꾸기·달러 변환 실행)
  return { G, sheets, call, row, total, lastTrade, sig };
}
const test = (name, fn) => { const before = fail; try { fn(); } catch (e) { fail++; console.log(`  ✗ ${name}: 오류 ${e.message}`); } console.log(`${fail === before ? '✓' : '✗'} ${name}`); };

test('불러오기 · 메인 예수금 이름 바꾸기 · 달러 변환', () => {
  const t = fresh();
  const m = t.row('예수금', '메인 계좌 예수금');
  ok(m, '이름이 메인 계좌 예수금으로 바뀜');
  ok(m && m['통화'] === 'USD' && near(m['수량'], 3000000 / 1400, 0.01), '달러로 변환', JSON.stringify(m && [m['통화'], m['수량']]));
  ok(m && m['원금(원)'] === 3000000, '원금은 그대로');
  const d = t.call({ action: 'data' }).data;
  ok(d.cashMap && d.cashMap.ETHU && d.cashMap.ETHU.sub === '메인 계좌 예수금', '예수금 연결 정보(cashMap)');
  ok(d.cashMap.ISA && d.cashMap.ISA.mode === 'internal', 'ISA 는 계좌 안 예수금');
});

test('메인 계좌 종목 매수·매도 (달러 예수금에서 빠지고 들어옴)', () => {
  const t = fresh();
  const q0 = t.row('예수금', '메인 계좌 예수금')['수량'], c0 = t.row('예수금', '메인 계좌 예수금')['원금(원)'];
  let r = t.call({ action: 'trade', trade: { type: '매수', asset: 'SOXL', sub: 'SOXL', qty: 10, price: 50, date: '2026-11-02T09:00:00+09:00' } });
  ok(r.ok, '매수 저장', r.error);
  ok(near(t.row('예수금', '메인 계좌 예수금')['수량'], q0 - 500, 0.01), '달러 예수금 $500 감소');
  ok(t.row('예수금', '메인 계좌 예수금')['원금(원)'] === c0 - 700000, '예수금 원금 70만 감소');
  ok(t.row('SOXL')['원금(원)'] === 2800000 + 700000 && t.row('SOXL')['수량'] === 30, 'SOXL 원금·수량 증가');
  r = t.call({ action: 'trade', trade: { type: '매도', asset: 'SOXL', sub: 'SOXL', qty: 10, price: 60, date: '2026-11-02T10:00:00+09:00' } });
  ok(r.ok, '매도 저장', r.error);
  ok(near(t.row('예수금', '메인 계좌 예수금')['수량'], q0 - 500 + 600, 0.01), '달러 예수금 $600 증가');
  ok(r.realized === Math.round(840000 - 3500000 / 3), '실현손익 = 판 금액 − 평균 원금', String(r.realized));
});

test('ISA 안에서 매수 (예수금 원금 → 종목 원금, 합계 그대로)', () => {
  const t = fresh();
  const tot0 = t.total('ISA');
  const r = t.call({ action: 'trade', trade: { type: '매수', asset: 'ISA', sub: 'KODEX 테스트', qty: 100, price: 1000, date: '2026-11-02T09:00:00+09:00' } });
  ok(r.ok, '매수 저장', r.error);
  ok(t.row('ISA', 'ISA 예수금')['직접평가(원)'] === 400000 && t.row('ISA', 'ISA 예수금')['원금(원)'] === 400000, '예수금 금액·원금 10만 감소');
  ok(t.row('ISA', 'KODEX 테스트')['원금(원)'] === 1100000, '종목 원금 10만 증가');
  ok(t.total('ISA') === tot0, 'ISA 원금 합계 그대로');
});

test('최근 기록 삭제 → 보유현황 되돌림', () => {
  const t = fresh();
  t.call({ action: 'trade', trade: { type: '매수', asset: 'SOXL', sub: 'SOXL', qty: 5, price: 50, date: '2026-11-02T09:00:00+09:00' } });
  const T = t.lastTrade();
  const r = t.call({ action: 'tradeDel', r: T._r, sig: t.sig(T) });
  ok(r.ok, '삭제', r.error);
  ok(t.row('SOXL')['수량'] === 20 && t.row('SOXL')['원금(원)'] === 2800000, 'SOXL 원래대로');
  ok(t.row('예수금', '메인 계좌 예수금')['원금(원)'] === 3000000, '예수금 원래대로');
});

test('11월 1일 이전 기록 잠금 (투자 앱)', () => {
  const t = fresh();
  t.call({ action: 'trade', trade: { type: '매수', asset: 'SOXL', sub: 'SOXL', qty: 1, price: 50, date: '2026-10-20T09:00:00+09:00' } });
  const T = t.lastTrade();
  const r = t.call({ action: 'tradeDel', r: T._r, sig: t.sig(T) });
  ok(!r.ok && /11월 1일 이전/.test(r.error || ''), '예전 기록 삭제 막힘', r.error);
});

test('11월 1일 이전 가계부 투자 연결 잠금', () => {
  const t = fresh();
  const tx = { ID: 'tL1', '일시': '2026-10-20 10:00', '구분': '이체', '내용': '잠금 시험', '금액': 100000, '자산': '현금', '받는자산': '투자 계좌', '투자구분': '입금', '투자계좌': 'ISA', '투자종목': 'ISA 예수금', '입력자': '준환' };
  ok(t.call({ action: 'hhSave', tx }).ok, '새로 저장');
  ok(t.call({ action: 'hhSave', tx: { ...tx, '내용': '내용만 바꿈' } }).ok, '내용만 고치기는 됨');
  let r = t.call({ action: 'hhSave', tx: { ...tx, '금액': 200000 } });
  ok(!r.ok && /11월 1일 이전/.test(r.error || ''), '금액 바꾸기 막힘', r.error);
  r = t.call({ action: 'hhDel', kind: 'tx', id: 'tL1' });
  ok(!r.ok, '삭제 막힘');
  ok(t.call({ action: 'hhDel', kind: 'tx', id: 't2' }).ok, "'이미 반영됨' 내역은 삭제 됨");
});

test('예수금 금액 수정 (원금만 맞춤 / 기타 손익)', () => {
  const t = fresh();
  let r = t.call({ action: 'manual', manual: { asset: 'ISA', sub: 'ISA 예수금', value: 450000, pnl: false } });
  ok(r.ok && t.row('ISA', 'ISA 예수금')['원금(원)'] === 450000, 'ISA 예수금 원금만 맞춤', r.error);
  r = t.call({ action: 'manual', manual: { asset: 'ISA', sub: 'ISA 예수금', value: 460000, pnl: true } });
  ok(r.ok && /기타 손익/.test(r.message || ''), '차액을 기타 손익으로', r.message);
  r = t.call({ action: 'manual', manual: { asset: '예수금', sub: '메인 계좌 예수금', usd: 2000 } });
  ok(r.ok && t.row('예수금', '메인 계좌 예수금')['수량'] === 2000 && t.row('예수금', '메인 계좌 예수금')['원금(원)'] === 3000000, '달러 예수금은 금액만, 원금 그대로');
});

test('새 종목을 메인 계좌 돈으로 매수', () => {
  const t = fresh();
  const r = t.call({ action: 'trade', trade: { type: '매수', asset: '새 계좌', sub: '새 종목', ticker: 'KRX:000003', kind: '테스트', qty: 10, price: 10000, date: '2026-11-02T09:00:00+09:00', cashLink: { asset: '예수금', sub: '메인 계좌 예수금' } } });
  ok(r.ok, '저장', r.error);
  ok(t.row('새 계좌', '새 종목') && t.row('새 계좌', '새 종목')['원금(원)'] === 100000, '새 줄 생김');
  ok(t.row('예수금', '메인 계좌 예수금')['원금(원)'] === 2900000, '메인 예수금 원금 10만 감소');
  ok(/새 계좌/.test(t.G.__props.CASH_LINKS || ''), '예수금 연결 기억');
});

test('티커 없는 새 종목 · 시세 못 불러온 새 종목', () => {
  const t = fresh();
  let r = t.call({ action: 'trade', trade: { type: '매수', asset: 'ISA', sub: '티커없음', kind: '준환 리딩(ISA)', qty: 2, price: 5000, date: '2026-11-03T09:00:00+09:00' } });
  ok(r.ok && t.row('ISA', '티커없음')['현재가'] === 5000, '티커 없으면 거래 단가를 현재가로', JSON.stringify(t.row('ISA', '티커없음')));
  ok(!r.warn, '티커 없으면 경고 없음');
  // 가짜 시트는 GOOGLEFINANCE 를 계산하지 않음 → 시세를 못 불러온 경우와 같음
  r = t.call({ action: 'trade', trade: { type: '매수', asset: '시세없음', sub: '시세없음', ticker: 'ZZZZ', currency: 'USD', kind: '메인투자', qty: 1, price: 10, date: '2026-11-03T09:00:00+09:00' } });
  ok(r.ok && /티커 'ZZZZ'/.test(r.warn || ''), '시세 없으면 저장은 되고 경고', r.warn || r.error);
});

test('종목·자산·분류 삭제', () => {
  const t = fresh();
  let p = t.call({ action: 'holdDel', dry: true, scope: 'sub', asset: 'ISA', sub: 'ISA 예수금' });
  ok(p.ok && p.blockers.length && /쓰고 있어/.test(p.blockers[0]), '종목이 남은 계좌의 예수금만 지우기 막힘', JSON.stringify(p.blockers));
  p = t.call({ action: 'holdDel', dry: true, scope: 'asset', asset: '예수금' });
  ok(p.blockers.length > 0, '공용 예수금 지우기 막힘');
  p = t.call({ action: 'holdDel', dry: true, scope: 'kind', kind: '현금' });
  ok(p.blockers.some(b => /현금/.test(b)), "'현금' 분류 막힘");
  p = t.call({ action: 'holdDel', dry: true, scope: 'sub', asset: 'QLD', sub: 'QLD' });
  ok(p.ok && !p.blockers.length && p.rows.length === 1 && p.cost === 1100000, '미리보기', JSON.stringify(p));
  let r = t.call({ action: 'holdDel', scope: 'sub', asset: 'QLD', sub: 'QLD' });
  ok(r.ok && !t.row('QLD'), '종목 삭제', r.error);
  r = t.call({ action: 'holdDel', scope: 'asset', asset: 'ISA' });
  ok(r.ok && !t.row('ISA'), '자산(종목+예수금) 통째 삭제', r.error);
  t.call({ action: 'trade', trade: { type: '매수', asset: '새 계좌', sub: '새 종목', kind: '테스트분류', qty: 1, price: 1000, date: '2026-11-03T09:00:00+09:00', cashLink: { asset: '예수금', sub: '메인 계좌 예수금' } } });
  r = t.call({ action: 'holdDel', scope: 'kind', kind: '테스트분류' });
  ok(r.ok && !t.row('새 계좌') && !/새 계좌/.test(t.G.__props.CASH_LINKS || ''), '분류 삭제 + 예수금 연결 정리', r.error);
});

console.log(`\n${fail ? `✗ 실패 ${fail}건` : '모두 통과'} (확인 ${pass + fail}건)`);
process.exit(fail ? 1 : 0);
