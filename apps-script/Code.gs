/**
 * Dalton House 투자 앱 — 데이터 배달원 (Google Apps Script)
 *
 * 하는 일
 *  1) 앱이 비밀번호와 함께 요청하면 시트 데이터를 보내줌
 *  2) 앱에서 입력한 매수·매도·입금·출금을 시트에 기록하고 보유현황을 자동으로 고침
 *  3) 모빅(BMB) 시세를 3시간마다 갱신
 *  4) 매달 말일 자산별 원금·평가금을 '월말평가' 탭에 저장
 *
 * 설치: 시트 상단 메뉴 [Dalton House] → [① 처음 설정] 을 한 번 누르면 끝.
 * 이 파일에는 비밀번호가 들어있지 않습니다 (스크립트 속성에 암호화해 저장).
 */

const TZ = 'Asia/Seoul';

/**
 * 매매할 때 돈이 어디서 나가고 어디로 들어오는지.
 *  internal : 같은 자산 안의 예수금 줄 (원금은 그대로, 예수금만 늘고 줆)
 *  shared   : 다른 자산(메인 계좌 예수금)과 공유 (원금도 같이 이동)
 *  목록에 없는 자산 : 예수금 연결 없음 (매수 = 새 돈 투입)
 */
const CASH = {
  'ISA':        { mode: 'internal', sub: 'ISA 예수금' },
  'TQQQ(나예)': { mode: 'internal', sub: '달러 예수금' },
  'ETHU':       { mode: 'shared', asset: '예수금', sub: '메인 계좌 원화 예수금' },
  'QLD':        { mode: 'shared', asset: '예수금', sub: '메인 계좌 원화 예수금' },
  'SOXL':       { mode: 'shared', asset: '예수금', sub: '메인 계좌 원화 예수금' },
};

const HCOL = ['자산', '종류', '세부종목', '티커', '통화', '수량', '평단가', '원금(원)', '현재가', '직접평가(원)', '평가금(원)'];

/* ───────────────────────── 시트 메뉴 ───────────────────────── */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Dalton House')
    .addItem('① 처음 설정 (비밀번호·자동실행)', '처음설정')
    .addSeparator()
    .addItem('모빅 시세 지금 업데이트', '모빅시세_메뉴')
    .addItem('이번 달 월말기록 지금 저장', '이번달기록_메뉴')
    .addItem('지수 비교 탭 만들기', '지수탭_메뉴')
    .addItem('비밀번호 바꾸기', '비밀번호설정')
    .addToUi();
}

function 처음설정() {
  const ui = SpreadsheetApp.getUi();
  if (!비밀번호설정()) return;

  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('모빅시세업데이트').timeBased().everyHours(3).create();
  ScriptApp.newTrigger('월말기록저장').timeBased().everyDays(1).atHour(23).create();

  let mobick = '';
  try { mobick = `모빅 시세: $${모빅시세업데이트()}`; } catch (e) { mobick = `모빅 시세 실패: ${e.message}`; }

  const tzNote = Session.getScriptTimeZone() === TZ ? '' :
    `\n\n※ 스크립트 시간대가 ${Session.getScriptTimeZone()} 입니다. Apps Script ▸ 프로젝트 설정에서 (GMT+09:00) 서울로 바꿔 주세요.`;
  ui.alert('설정 완료',
    `비밀번호 저장, 자동실행 2개(모빅 3시간마다 / 월말기록 매일 밤 확인) 등록 완료.\n${mobick}\n\n이제 Apps Script에서 [배포 → 새 배포]를 진행하세요.${tzNote}`,
    ui.ButtonSet.OK);
}

function 비밀번호설정() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('앱 비밀번호', '앱에서 사용할 비밀번호를 입력하세요 (4자 이상).\n두 분이 같은 비밀번호를 씁니다.', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return false;
  const pw = res.getResponseText().trim();
  if (pw.length < 4) { ui.alert('4자 이상으로 입력해 주세요.'); return false; }
  PropertiesService.getScriptProperties().setProperty('PW_HASH', hash_(pw));
  ui.alert('비밀번호를 저장했습니다.');
  return true;
}

function 모빅시세_메뉴() {
  const ui = SpreadsheetApp.getUi();
  try { ui.alert(`모빅 시세 $${모빅시세업데이트()} 로 갱신했습니다.`); }
  catch (e) { ui.alert(`실패: ${e.message}`); }
}

function 이번달기록_메뉴() {
  const month = Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
  const n = saveSnapshot_(month);
  SpreadsheetApp.getUi().alert(`${month} 월말평가 ${n}줄을 저장했습니다. (같은 달 기록은 덮어씀)`);
}

/* ───────────────────────── 앱 연결 (웹앱) ───────────────────────── */

function doGet() {
  return json_({ ok: true, message: 'Dalton House API 작동 중' });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e && e.postData ? e.postData.contents : ''); }
  catch (err) { return json_({ ok: false, error: '요청 형식 오류' }); }

  const saved = PropertiesService.getScriptProperties().getProperty('PW_HASH');
  if (!saved) return json_({ ok: false, code: 'setup', error: '시트 메뉴 [Dalton House → 처음 설정]을 먼저 해주세요' });
  if (!req.password || hash_(String(req.password)) !== saved) {
    Utilities.sleep(800);
    return json_({ ok: false, code: 'auth', error: '비밀번호가 틀렸습니다' });
  }

  try {
    switch (req.action) {
      case 'data':   return json_({ ok: true, data: readAll_() });
      case 'trade':  return json_(withLock_(() => recordTrade_(req.trade)));
      case 'manual': return json_(withLock_(() => setManual_(req.manual)));
      case 'month':  return json_(withLock_(() => saveMonth_(req.month)));
      default:       return json_({ ok: false, error: '알 수 없는 요청' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

/* ───────────────────────── 데이터 읽기 ───────────────────────── */

function readAll_() {
  return {
    updatedAt: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'),
    rate: rate_(),
    holdings: rowsAsObjects_('보유현황', o => !o['자산'] || o['자산'] === '합계'),
    composition: rowsAsObjects_('연도별구성', o => !o['연도']),
    realized: rowsAsObjects_('실현손익', o => !o['날짜']),
    monthly: rowsAsObjects_('월말평가', o => !o['월']),
    trades: rowsAsObjects_('거래기록', o => !o['날짜']).slice(-200),
    index: readIndex_(),
    household: SpreadsheetApp.getActive().getSheetByName('가계부월별') ? rowsAsObjects_('가계부월별', o => !o['연도']) : [],
  };
}

/* ───────────────────────── 지수 비교 (누적 수익률 그래프용) ───────────────────────── */

// 지수는 구글 시세가 안정적으로 주는 대표 ETF로 대신함
const INDEX_SERIES = [
  { key: 'kospi',  label: '코스피(KODEX 200)', formula: '=GOOGLEFINANCE("KRX:069500","close",DATE(2023,11,1),TODAY(),"WEEKLY")' },
  { key: 'sp500',  label: 'S&P500(SPY)',       formula: '=GOOGLEFINANCE("SPY","close",DATE(2023,11,1),TODAY(),"WEEKLY")' },
  { key: 'nasdaq', label: '나스닥(QQQ)',        formula: '=GOOGLEFINANCE("QQQ","close",DATE(2023,11,1),TODAY(),"WEEKLY")' },
  { key: 'usdkrw', label: '환율(USD/KRW)',      formula: '=GOOGLEFINANCE("CURRENCY:USDKRW","price",DATE(2023,11,1),TODAY(),"WEEKLY")' },
];

function ensureIndexSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName('지수');
  if (sh) {
    // 예전 버전(2025-08부터)이면 2023-11부터로 수식 교체
    if (String(sh.getRange(2, 1).getFormula()).indexOf('DATE(2023,11,1)') < 0) {
      INDEX_SERIES.forEach((s, i) => sh.getRange(2, i * 2 + 1).setFormula(s.formula));
      sh.getRange(1, 10).setValue('자동으로 채워지는 탭입니다. 고치지 마세요. (2023-11부터 주간 종가)');
    }
    return sh;
  }
  sh = ss.insertSheet('지수');
  INDEX_SERIES.forEach((s, i) => {
    sh.getRange(1, i * 2 + 1).setValue(s.label).setFontWeight('bold');
    sh.getRange(2, i * 2 + 1).setFormula(s.formula);
  });
  sh.getRange(1, 10).setValue('자동으로 채워지는 탭입니다. 고치지 마세요. (2023-11부터 주간 종가)');
  return sh;
}

function readIndex_() {
  let sh;
  try { sh = ensureIndexSheet_(); } catch (e) { return null; }
  const v = sh.getDataRange().getValues();
  const out = {};
  INDEX_SERIES.forEach((s, i) => {
    const c = i * 2, pts = [];
    for (let r = 1; r < v.length; r++) {
      const d = v[r][c], x = v[r][c + 1];
      if (d instanceof Date && typeof x === 'number' && isFinite(x)) pts.push([Utilities.formatDate(d, sheetTz_(), 'yyyy-MM-dd'), x]);
    }
    out[s.key] = pts;
  });
  return out;
}

function 지수탭_메뉴() {
  ensureIndexSheet_();
  SpreadsheetApp.getUi().alert('지수 탭을 만들었습니다. 몇 초 뒤 숫자가 채워집니다.');
}

/* ───────────────────────── 거래 기록 ───────────────────────── */

/**
 * trade = { date?, asset, sub, type: 매수|매도|입금|출금, qty, price, amountKrw?,
 *           ticker?, currency?, kind?, memo?, by? }
 *  - price 는 그 종목의 통화 기준 (미국 주식은 달러)
 *  - amountKrw 를 주면 원화 금액으로 그대로 사용, 없으면 수량×단가×환율
 */
function recordTrade_(tr) {
  if (!tr) throw new Error('거래 정보가 없습니다');
  const type = String(tr.type || '').trim();
  const asset = String(tr.asset || '').trim();
  const sub = String(tr.sub || tr.asset || '').trim();
  if (!asset) throw new Error('자산을 선택하세요');
  if (['매수', '매도', '입금', '출금'].indexOf(type) < 0) throw new Error('구분은 매수/매도/입금/출금 중 하나여야 합니다');
  const date = tr.date ? new Date(tr.date) : new Date();
  if (isNaN(date.getTime())) throw new Error('날짜 형식이 올바르지 않습니다');

  let t = holdings_();
  const rate = rate_();
  const cash = CASH[asset] || { mode: 'none' };
  let realized = null, amountKrw = 0, qty = '', price = '', cur = 'KRW';

  if (type === '매수' || type === '매도') {
    qty = num_(tr.qty); price = num_(tr.price);
    if (!(qty > 0) || !(price > 0)) throw new Error('수량과 단가를 입력하세요');

    let r = findRow_(t, asset, sub);
    if (r < 0) {
      if (type === '매도') throw new Error(`보유현황에 '${asset} / ${sub}' 줄이 없습니다`);
      r = addHolding_(t, asset, sub, tr);
      t = holdings_();
    }
    cur = String(t.values[r][t.col['통화']]).trim() || 'KRW';
    const fx = cur === 'USD' ? rate : 1;
    amountKrw = num_(tr.amountKrw) > 0 ? Math.round(num_(tr.amountKrw)) : Math.round(qty * price * fx);

    const cashRow = resolveCash_(t, cash);
    const oldQty = num_(t.values[r][t.col['수량']]);
    const oldAvg = num_(t.values[r][t.col['평단가']]);
    const oldCost = num_(t.values[r][t.col['원금(원)']]);

    if (type === '매수') {
      setCell_(t, r, '수량', round_(oldQty + qty, 8));
      if (oldAvg > 0 || oldQty === 0) setCell_(t, r, '평단가', round_((oldQty * oldAvg + qty * price) / (oldQty + qty), 4));
      if (cash.mode !== 'internal') setCell_(t, r, '원금(원)', Math.round(oldCost + amountKrw));
      moveCash_(t, cash, cashRow, -qty * price, -amountKrw, cur, rate);
    } else {
      if (qty > oldQty + 1e-9) throw new Error(`보유 수량(${oldQty})보다 많이 팔 수 없습니다`);
      if (cash.mode === 'internal') {
        if (!(oldAvg > 0)) throw new Error('평단가가 없어 손익을 계산할 수 없습니다. 보유현황에 평단가를 입력해 주세요');
        realized = Math.round((price - oldAvg) * qty * fx);
      } else {
        const basis = oldQty > 0 ? oldCost * qty / oldQty : 0;
        realized = Math.round(amountKrw - basis);
        setCell_(t, r, '원금(원)', Math.round(oldCost - basis));
      }
      setCell_(t, r, '수량', round_(oldQty - qty, 8));
      moveCash_(t, cash, cashRow, qty * price, amountKrw, cur, rate);
    }
  } else {
    amountKrw = Math.round(num_(tr.amountKrw));
    if (!(amountKrw > 0)) throw new Error('금액(원)을 입력하세요');
    const sign = type === '입금' ? 1 : -1;
    if (cash.mode === 'internal' || cash.mode === 'shared') {
      const cashRow = resolveCash_(t, cash);
      moveCash_(t, cash, cashRow, null, sign * amountKrw, 'KRW', rate);
      // internal: 그 자산 안의 예수금 + 원금 증가 / shared: 메인 예수금(값·원금)만 증가
      if (cash.mode === 'internal') addCost_(t, cashRow, sign * amountKrw);
    } else {
      const r = findRow_(t, asset, sub) >= 0 ? findRow_(t, asset, sub) : findFirstRow_(t, asset);
      if (r < 0) throw new Error(`보유현황에 '${asset}' 줄이 없습니다`);
      addCost_(t, r, sign * amountKrw);
      if (String(t.values[r][t.col['직접평가(원)']]) !== '') {
        setCell_(t, r, '직접평가(원)', Math.round(num_(t.values[r][t.col['직접평가(원)']]) + sign * amountKrw));
      }
    }
  }

  appendByHeader_('거래기록', {
    '날짜': kstWall_(date), '자산': asset, '세부종목': sub, '구분': type, '수량': qty, '단가': price,
    '통화': cur, '금액(원)': amountKrw, '실현손익(원)': realized === null ? '' : realized,
    '입력자': tr.by || '', '메모': tr.memo || '',
  });

  if (realized !== null) {
    const row = appendByHeader_('실현손익', {
      '날짜': kstWall_(date), '자산': asset, '세부종목': sub,
      '내용': `${sub} ${qty}주 매도 ${realized >= 0 ? '익절' : '손절'}`,
      '손익(원)': realized, '구분': realized >= 0 ? '익절' : '손절', '출처': '앱', '메모': tr.memo || '',
    });
    const rt = table_('실현손익');
    const A = colLetter_(rt.col['날짜'] + 1);
    if ('연도' in rt.col) rt.sh.getRange(row, rt.col['연도'] + 1).setFormula(`=YEAR(${A}${row})`);
    if ('월' in rt.col) rt.sh.getRange(row, rt.col['월'] + 1).setFormula(`=MONTH(${A}${row})`);
  }

  return { ok: true, message: `${asset} ${type} 기록 완료`, amountKrw, realized };
}

/** 수동 값 갱신: manual = { asset, sub, value(원) } 또는 달러 예수금이면 { usd } */
function setManual_(m) {
  if (!m) throw new Error('값이 없습니다');
  const t = holdings_();
  const r = findRow_(t, String(m.asset || '').trim(), String(m.sub || m.asset || '').trim());
  if (r < 0) throw new Error('보유현황에서 해당 줄을 찾지 못했습니다');
  const cur = String(t.values[r][t.col['통화']]).trim();
  if (cur === 'USD' && m.usd !== undefined) {
    setCell_(t, r, '수량', round_(num_(m.usd), 2));
  } else {
    const v = Math.round(num_(m.value));
    setCell_(t, r, '직접평가(원)', v);
    if (String(t.values[r][t.col['종류']]).trim() === '현금') setCell_(t, r, '원금(원)', v);
  }
  return { ok: true, message: '저장했습니다' };
}

/* ───────────────────────── 보유현황 도우미 ───────────────────────── */

function holdings_() {
  const t = table_('보유현황');
  HCOL.forEach(h => { if (!(h in t.col)) throw new Error(`보유현황에 '${h}' 열이 없습니다`); });
  return t;
}

function findRow_(t, asset, sub) {
  for (let r = 1; r < t.values.length; r++) {
    if (String(t.values[r][t.col['자산']]).trim() === asset &&
        String(t.values[r][t.col['세부종목']]).trim() === sub) return r;
  }
  return -1;
}

function findFirstRow_(t, asset) {
  for (let r = 1; r < t.values.length; r++) {
    if (String(t.values[r][t.col['자산']]).trim() === asset) return r;
  }
  return -1;
}

function resolveCash_(t, cash) {
  if (cash.mode === 'none') return -1;
  const owner = cash.mode === 'internal' ? null : cash.asset;
  for (let r = 1; r < t.values.length; r++) {
    const a = String(t.values[r][t.col['자산']]).trim();
    const s = String(t.values[r][t.col['세부종목']]).trim();
    if (s === cash.sub && (owner === null || a === owner)) return r;
  }
  throw new Error(`예수금 줄 '${cash.sub}'을 보유현황에서 찾지 못했습니다`);
}

/** 예수금 줄에 돈을 더하거나 뺌. foreignAmt = 종목 통화 기준 금액, krwAmt = 원화 금액 */
function moveCash_(t, cash, r, foreignAmt, krwAmt, tradeCur, rate) {
  if (cash.mode === 'none' || r < 0) return;
  const cashCur = String(t.values[r][t.col['통화']]).trim();
  if (cashCur === 'USD') {
    const usd = (tradeCur === 'USD' && foreignAmt !== null) ? foreignAmt : krwAmt / rate;
    setCell_(t, r, '수량', round_(num_(t.values[r][t.col['수량']]) + usd, 2));
  } else {
    setCell_(t, r, '직접평가(원)', Math.round(num_(t.values[r][t.col['직접평가(원)']]) + krwAmt));
    if (cash.mode === 'shared') addCost_(t, r, krwAmt);
  }
}

function addCost_(t, r, amt) {
  if (r < 0) return;
  setCell_(t, r, '원금(원)', Math.round(num_(t.values[r][t.col['원금(원)']]) + amt));
}

/** 보유현황에 없는 종목을 처음 매수할 때 새 줄을 '합계' 바로 위에 추가 */
function addHolding_(t, asset, sub, tr) {
  const sh = t.sh;
  let kind = String(tr.kind || '').trim();
  const first = findFirstRow_(t, asset);
  if (!kind && first >= 0) kind = t.values[first][t.col['종류']];
  if (!kind) throw new Error('새 자산은 종류를 함께 입력해야 합니다');

  const ticker = String(tr.ticker || '').trim();
  const cur = String(tr.currency || '').trim() ||
    (ticker && !/^KRX:/i.test(ticker) && /^[A-Z.]+$/.test(ticker) ? 'USD' : 'KRW');

  let totalIdx = -1;
  for (let i = 1; i < t.values.length; i++) if (String(t.values[i][t.col['자산']]).trim() === '합계') { totalIdx = i; break; }
  const lastCol = sh.getLastColumn();
  let row;
  if (totalIdx > 0) { row = totalIdx + 1; sh.insertRowBefore(row); }
  else { row = sh.getLastRow() + 1; }

  const C = h => t.col[h] + 1;
  sh.getRange(2, 1, 1, lastCol).copyTo(sh.getRange(row, 1, 1, lastCol), { formatOnly: true });
  const k = C('평가금(원)');
  sh.getRange(2, k, 1, 3).copyTo(sh.getRange(row, k, 1, 3)); // 평가금·평가손익·수익률 수식 복사
  const set = (h, v) => sh.getRange(row, C(h)).setValue(v);
  set('자산', asset); set('종류', kind); set('세부종목', sub); set('티커', ticker);
  set('통화', cur); set('수량', 0); set('평단가', ''); set('원금(원)', 0); set('직접평가(원)', '');
  if (ticker) sh.getRange(row, C('현재가')).setFormula(`=GOOGLEFINANCE("${ticker}","price")`);
  else set('현재가', '');
  if ('시세방식' in t.col) set('시세방식', ticker ? '자동(구글)' : '수동');

  if (totalIdx > 0) {
    const tr2 = row + 1;
    ['원금(원)', '평가금(원)', '평가손익(원)'].forEach(h => {
      if (!(h in t.col)) return;
      const L = colLetter_(C(h));
      sh.getRange(tr2, C(h)).setFormula(`=SUM(${L}2:${L}${row})`);
    });
  }
  return row - 1;
}

/* ───────────────────────── 모빅 시세 ───────────────────────── */

function 모빅시세업데이트() {
  let usd = null, src = '';
  try {
    const r = UrlFetchApp.fetch('https://api.coingecko.com/api/v3/simple/price?ids=btcmobick&vs_currencies=usd', { muteHttpExceptions: true });
    if (r.getResponseCode() === 200) { usd = Number(JSON.parse(r.getContentText()).btcmobick.usd); src = 'CoinGecko'; }
  } catch (e) { /* 아래 엘뱅크로 */ }
  if (!(usd > 0)) {
    try {
      const r = UrlFetchApp.fetch('https://api.lbkex.com/v2/ticker/24hr.do?symbol=bmb_usdt', { muteHttpExceptions: true });
      const j = JSON.parse(r.getContentText());
      const d = Array.isArray(j.data) ? j.data[0] : j.data;
      usd = Number(d && (d.ticker ? d.ticker.latest : d.latest)); src = 'LBank';
    } catch (e) { /* 실패 */ }
  }
  if (!(usd > 0)) throw new Error('CoinGecko·엘뱅크 모두 응답이 없습니다');

  const t = holdings_();
  let n = 0;
  for (let r = 1; r < t.values.length; r++) {
    if (String(t.values[r][t.col['티커']]).trim().toUpperCase() === 'BMB') { setCell_(t, r, '현재가', usd); n++; }
  }
  Logger.log(`모빅 $${usd} (${src}) → ${n}줄 갱신`);
  return usd;
}

/* ───────────────────────── 월말 기록 ───────────────────────── */

/** 자동실행: 매일 밤 실행되고, 그날이 말일일 때만 저장 */
function 월말기록저장() {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
  if (Utilities.formatDate(now, TZ, 'MM') === Utilities.formatDate(tomorrow, TZ, 'MM')) return;
  try { 모빅시세업데이트(); } catch (e) { /* 시세 실패해도 기록은 진행 */ }
  SpreadsheetApp.flush();
  saveSnapshot_(Utilities.formatDate(now, TZ, 'yyyy-MM'));
}

function saveSnapshot_(month) {
  const t = holdings_();
  const agg = {}, order = [];
  for (let r = 1; r < t.values.length; r++) {
    const a = String(t.values[r][t.col['자산']]).trim();
    if (!a || a === '합계') continue;
    if (!agg[a]) { agg[a] = { kind: t.values[r][t.col['종류']], cost: 0, val: 0 }; order.push(a); }
    agg[a].cost += num_(t.values[r][t.col['원금(원)']]);
    agg[a].val += num_(t.values[r][t.col['평가금(원)']]);
  }

  const mt = table_('월말평가');
  for (let r = mt.values.length - 1; r >= 1; r--) {
    if (String(clean_(mt.values[r][mt.col['월']])).slice(0, 7) === month) mt.sh.deleteRow(r + 1);
  }
  const stamp = kstWall_(new Date());
  order.forEach(a => appendByHeader_('월말평가', {
    '월': "'" + month, '자산': a, '종류': agg[a].kind,
    '원금(원)': Math.round(agg[a].cost), '평가금(원)': Math.round(agg[a].val),
    '평가손익(원)': Math.round(agg[a].val - agg[a].cost), '저장시각': stamp,
  }));
  return order.length;
}

/* ───────────────────────── 월 마감 (가계부월별) ───────────────────────── */

const HH_HEADERS = ['연도', '월', '순자산', '수입(근로·기타)', '생활 지출', '투자손익(실현)', '투자 순투입', '투자 장부잔액', '기타 보정'];

/** month = { y, m, nw, inc, exp, pnl, flow, book } → 같은 달이 있으면 덮어쓰고, 없으면 아래에 추가 */
function saveMonth_(mo) {
  if (!mo) throw new Error('값이 없습니다');
  const y = Math.round(num_(mo.y)), m = Math.round(num_(mo.m));
  if (!(y > 2000) || !(m >= 1 && m <= 12)) throw new Error('연도·월이 올바르지 않습니다');
  if (!(num_(mo.nw) > 0)) throw new Error('누적잔액을 입력하세요');
  const ss = SpreadsheetApp.getActive();
  if (!ss.getSheetByName('가계부월별')) {
    const sh = ss.insertSheet('가계부월별');
    sh.getRange(1, 1, 1, HH_HEADERS.length).setValues([HH_HEADERS]).setFontWeight('bold');
  }
  const obj = {
    '연도': y, '월': m, '순자산': Math.round(num_(mo.nw)), '수입(근로·기타)': Math.round(num_(mo.inc)), '생활 지출': Math.round(num_(mo.exp)),
    '투자손익(실현)': Math.round(num_(mo.pnl)), '투자 순투입': Math.round(num_(mo.flow)), '투자 장부잔액': Math.round(num_(mo.book)),
  };
  const t = table_('가계부월별');
  for (let r = 1; r < t.values.length; r++) {
    if (num_(t.values[r][t.col['연도']]) === y && num_(t.values[r][t.col['월']]) === m) {
      Object.keys(obj).forEach(h => { if (h in t.col) setCell_(t, r, h, obj[h]); });
      return { ok: true, message: `${y}년 ${m}월 마감을 고쳤어요` };
    }
  }
  appendByHeader_('가계부월별', obj);
  return { ok: true, message: `${y}년 ${m}월 마감을 저장했어요` };
}

/* ───────────────────────── 공통 도우미 ───────────────────────── */

function sheet_(name) {
  const s = SpreadsheetApp.getActive().getSheetByName(name);
  if (!s) throw new Error(`'${name}' 탭이 없습니다`);
  return s;
}

function table_(name) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  const headers = values[0].map(h => String(h).trim());
  const col = {};
  headers.forEach((h, i) => { if (h && !(h in col)) col[h] = i; });
  return { sh, values, headers, col };
}

function rowsAsObjects_(name, skip) {
  const t = table_(name), out = [];
  for (let r = 1; r < t.values.length; r++) {
    const row = t.values[r];
    if (row.every(v => v === '' || v === null)) continue;
    const o = {};
    t.headers.forEach((h, i) => { if (h) o[h] = clean_(row[i]); });
    if (skip && skip(o)) continue;
    out.push(o);
  }
  return out;
}

function appendByHeader_(name, obj) {
  const t = table_(name);
  const lastData = lastDataRow_(t);
  const row = lastData + 1;
  const values = t.headers.map(h => (h in obj ? obj[h] : ''));
  t.sh.getRange(row, 1, 1, values.length).setValues([values]);
  return row;
}

function lastDataRow_(t) {
  for (let r = t.values.length - 1; r >= 1; r--) {
    if (!t.values[r].every(v => v === '' || v === null)) return r + 1;
  }
  return 1;
}

function setCell_(t, r, header, value) {
  t.sh.getRange(r + 1, t.col[header] + 1).setValue(value);
  t.values[r][t.col[header]] = value;
}

function rate_() {
  const v = sheet_('설정').getDataRange().getValues();
  for (let r = 0; r < v.length; r++) if (String(v[r][0]).indexOf('환율') === 0) return num_(v[r][1]) || 1400;
  return 1400;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { const res = fn(); SpreadsheetApp.flush(); return res; }
  finally { lock.releaseLock(); }
}

// 시트에 적힌 날짜를 그대로 보내기 위해 시트의 시간대로 변환 (시트 시간대가 서울이 아니어도 날짜가 밀리지 않음)
let SHEET_TZ_ = null;
function sheetTz_() {
  if (!SHEET_TZ_) { try { SHEET_TZ_ = SpreadsheetApp.getActive().getSpreadsheetTimeZone() || TZ; } catch (e) { SHEET_TZ_ = TZ; } }
  return SHEET_TZ_;
}
// 시트에 쓸 날짜: 한국 시각 그대로 보이도록 (시트 시간대와 무관하게)
function kstWall_(d) {
  return Utilities.parseDate(Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm:ss'), sheetTz_(), 'yyyy-MM-dd HH:mm:ss');
}
function clean_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, sheetTz_(), "yyyy-MM-dd'T'HH:mm:ss");
  if (typeof v === 'number' && !isFinite(v)) return null;
  return v;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'dalton:' + s, Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function num_(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function round_(x, d) { const p = Math.pow(10, d); return Math.round(x * p) / p; }
function colLetter_(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
