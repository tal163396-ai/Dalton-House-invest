/**
 * Dalton House 투자 앱 — 데이터 배달원 (Google Apps Script)
 *
 * 하는 일
 *  1) 앱이 비밀번호와 함께 요청하면 시트 데이터를 보내줌
 *  2) 앱에서 입력한 매수·매도·입금·출금을 시트에 기록하고 보유현황을 자동으로 고침
 *  3) 모빅(BMB) 시세를 3시간마다 갱신
 *  4) 매달 말일 자산별 원금·평가금을 '월말평가' 탭에 저장
 *  5) 가계부(수입·지출·이체) 읽기·쓰기, 매월 반복 내역 자동 입력
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
      case 'hh':        return json_({ ok: true, hh: readHH_() });
      case 'hhSave':    return json_(withLock_(() => hhSave_(req)));
      case 'hhDel':     return json_(withLock_(() => hhDel_(req)));
      case 'hhSettings':return json_(withLock_(() => hhSettings_(req)));
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
    cashLinked: Object.keys(CASH),
    holdings: applyLiveQuotes_(rowsAsObjects_('보유현황', o => !o['자산'] || o['자산'] === '합계')),
    composition: rowsAsObjects_('연도별구성', o => !o['연도']),
    realized: rowsAsObjects_('실현손익', o => !o['날짜']),
    monthly: rowsAsObjects_('월말평가', o => !o['월']),
    trades: rowsAsObjects_('거래기록', o => !o['날짜']).slice(-200),
    index: readIndex_(),
    household: SpreadsheetApp.getActive().getSheetByName('가계부월별') ? rowsAsObjects_('가계부월별', o => !o['연도']) : [],
    hhAuto: hhAutoMonths_(),
  };
}

/* ───────────────────────── 실시간 시세 (앱 새로고침 때마다) ─────────────────────────
 * 국내 주식·ETF: 네이버 증권 / 이더리움: 업비트 / 모빅: CoinGecko
 * 실패하면 시트(구글 시세) 값을 그대로 사용. 같은 종목은 60초 동안 캐시. */
function applyLiveQuotes_(rows) {
  const cache = CacheService.getScriptCache();
  const jobs = [];
  rows.forEach((o, i) => {
    const tk = String(o['티커'] || '').trim().toUpperCase();
    let m;
    if ((m = tk.match(/^KRX:(\w{6})$/))) jobs.push({ i, key: 'krx_' + m[1], urls: [
      `https://polling.finance.naver.com/api/realtime/domestic/stock/${m[1]}`,
      `https://m.stock.naver.com/api/stock/${m[1]}/basic`], parse: parseNaver_, src: '네이버' });
    else if (tk === 'ETH' && String(o['통화']).trim() === 'KRW') jobs.push({ i, key: 'upbit_eth', urls: ['https://api.upbit.com/v1/ticker?markets=KRW-ETH'],
      parse: t => { const j = JSON.parse(t); return Number(j[0].trade_price); }, src: '업비트' });
    else if (tk === 'BMB') jobs.push({ i, key: 'bmb_usd', urls: ['https://api.coingecko.com/api/v3/simple/price?ids=btcmobick&vs_currencies=usd'],
      parse: t => Number(JSON.parse(t).btcmobick.usd), src: 'CoinGecko' });
  });
  if (!jobs.length) return rows;
  const price = {};
  const need = [];
  jobs.forEach(j => { const c = cache.get(j.key); if (c) price[j.key] = { p: Number(c), src: j.src }; else if (!need.some(n => n.key === j.key)) need.push(j); });
  // 1차 주소들을 한꺼번에 요청, 실패한 것만 2차 주소로
  for (let step = 0; step < 2 && need.length; step++) {
    const batch = need.filter(j => j.urls[step] && !price[j.key]);
    if (!batch.length) break;
    let res = [];
    try { res = UrlFetchApp.fetchAll(batch.map(j => ({ url: j.urls[step], muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } }))); } catch (e) { res = []; }
    batch.forEach((j, k) => {
      try {
        const r = res[k];
        if (!r || r.getResponseCode() !== 200) return;
        const p = j.parse(r.getContentText());
        if (p > 0) { price[j.key] = { p, src: j.src }; cache.put(j.key, String(p), 60); }
      } catch (e) { /* 다음 주소로 */ }
    });
  }
  let rate = null;
  jobs.forEach(j => {
    const q = price[j.key]; if (!q) return;
    const o = rows[j.i];
    const qty = num_(o['수량']);
    const usd = String(o['통화']).trim() === 'USD';
    if (usd && rate === null) rate = rate_();
    o['현재가'] = q.p;
    o['평가금(원)'] = Math.round(qty * q.p * (usd ? rate : 1));
    o['시세출처'] = q.src + ' 실시간';
  });
  return rows;
}

function parseNaver_(text) {
  const j = JSON.parse(text);
  const d = j.datas ? j.datas[0] : j;
  return Number(String(d.closePrice || d.nv || '').replace(/,/g, ''));
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

  if (tr.nolog) return { ok: true, amountKrw, realized };
  appendByHeader_('거래기록', {
    '날짜': kstWall_(date), '자산': asset, '세부종목': sub, '구분': type, '수량': qty, '단가': price,
    '통화': cur, '금액(원)': amountKrw, '실현손익(원)': realized === null ? '' : realized,
    '입력자': tr.by || '', '메모': tr.memo || '', '연결': tr.link || '',
  });

  if (realized !== null) {
    const row = appendByHeader_('실현손익', {
      '날짜': kstWall_(date), '자산': asset, '세부종목': sub,
      '내용': `${sub} ${qty}주 매도 ${realized >= 0 ? '익절' : '손절'}`,
      '손익(원)': realized, '구분': realized >= 0 ? '익절' : '손절', '출처': tr.link ? '가계부' : '앱', '메모': tr.memo || '', '연결': tr.link || '',
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
  if (m.fix) {
    // 종목 줄 직접 고치기: 수량·평단가·원금(원) 중 보낸 것만
    const f = m.fix, done = [];
    if (f.qty !== undefined && f.qty !== '') { if (!(num_(f.qty) >= 0)) throw new Error('수량이 올바르지 않습니다'); setCell_(t, r, '수량', round_(num_(f.qty), 6)); done.push('수량'); }
    if (f.avg !== undefined && f.avg !== '') { if (!(num_(f.avg) >= 0)) throw new Error('평단가가 올바르지 않습니다'); setCell_(t, r, '평단가', round_(num_(f.avg), 4)); done.push('평단가'); }
    if (f.cost !== undefined && f.cost !== '') { if (!(num_(f.cost) >= 0)) throw new Error('원금이 올바르지 않습니다'); setCell_(t, r, '원금(원)', Math.round(num_(f.cost))); done.push('원금'); }
    if (f.cur === 'USD' || f.cur === 'KRW') { if (f.cur !== cur) { setCell_(t, r, '통화', f.cur); done.push('통화'); } }
    if (f.asset !== undefined && String(f.asset).trim() && String(f.asset).trim() !== String(m.asset).trim()) { setCell_(t, r, '자산', String(f.asset).trim().slice(0, 80)); done.push('자산 이름'); }
    if (!done.length) throw new Error('바꿀 값이 없습니다');
    return { ok: true, message: `${String(m.sub || m.asset)} ${done.join('·')} 저장했습니다` };
  }
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
  const ym = Utilities.formatDate(now, TZ, 'yyyy-MM');
  saveSnapshot_(ym);
  if (ym >= HH_AUTO_FROM) { try { saveAutoMonth_(ym); } catch (e) { /* 가계부 탭이 없으면 건너뜀 */ } }
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

/* ───────────────────────── 자동 월 마감 (2차 ②·③) ─────────────────────────
 * 2026년 10월부터는 가계부 내역으로 달마다 계산:
 *   저축(근로·기타소득) = 수입 − 지출, 생활 자산 = 투자 계좌를 뺀 가계부 자산 합,
 *   투자 순투입 = 투자 계좌로 보낸 돈 − 찾은 돈, 전세보증금 = 부동산 그룹, 대출 = 대출·마이너스 통장 그룹
 * 순자산 = 생활 자산 + 투자 앱 원금 (원금은 월말평가 / 이번 달은 지금 값) */
const HH_AUTO_FROM = '2026-10';
function hhAutoMonths_() {
  const ss = SpreadsheetApp.getActive();
  if (!ss.getSheetByName('가계부') || !ss.getSheetByName('가계부자산')) return [];
  const group = {}, inv = {};
  hhRows_('가계부자산').rows.forEach(r => { const n = String(r[1]).trim(); group[n] = String(r[0]).trim(); if (String(r[4]).trim() === '투자앱') inv[n] = true; });
  const t = table_('가계부'), c = t.col, months = {}, bal = {};
  const get = (v, h) => (h in c ? v[c[h]] : '');
  const rows = [];
  for (let r = 1; r < t.values.length; r++) {
    const v = t.values[r];
    let ts = get(v, '일시'); ts = ts instanceof Date ? Utilities.formatDate(ts, sheetTz_(), 'yyyy-MM-dd HH:mm:ss') : String(ts || '');
    if (!/^\d{4}-\d{2}/.test(ts)) continue;
    rows.push([ts.slice(0, 7), String(get(v, '구분')).trim(), num_(get(v, '금액')), String(get(v, '자산')).trim(), String(get(v, '받는자산')).trim()]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const add = (a, x) => { bal[a] = (bal[a] || 0) + x; };
  const snap = ym => {
    let life = 0, jeonse = 0, loan = 0;
    Object.keys(bal).forEach(a => {
      if (inv[a]) return;
      life += bal[a];
      if (group[a] === '부동산') jeonse += bal[a];
      if (group[a] === '대출' || group[a] === '마이너스 통장') loan -= bal[a];
    });
    months[ym].life = Math.round(life); months[ym].jeonse = Math.round(jeonse); months[ym].loan = Math.round(loan);
  };
  let cur = '';
  const now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
  rows.forEach(([ym, ty, amt, a, to]) => {
    if (ym > now) return;
    if (cur && ym !== cur && months[cur]) snap(cur);
    cur = ym;
    const m = months[ym] || (months[ym] = { inc: 0, exp: 0, flow: 0 });
    if (ty === '수입') { add(a, amt); m.inc += amt; }      // 가계부 화면의 수입·지출과 같게 (투자 계좌로 받은 수입 포함)
    else if (ty === '지출') { add(a, -amt); m.exp += amt; }
    else if (ty === '수정') add(a, amt);
    else if (ty === '이체') { add(a, -amt); add(to, amt); if (inv[to] && !inv[a]) m.flow += amt; if (inv[a] && !inv[to]) m.flow -= amt; }
  });
  if (cur && months[cur]) snap(cur);
  // 내역이 없는 달은 앞 달 잔액을 이어받음
  const out = [];
  let ym = HH_AUTO_FROM, prev = null;
  const keys = Object.keys(months).sort();
  const lastBefore = keys.filter(k => k < HH_AUTO_FROM).pop();
  if (lastBefore) prev = months[lastBefore];
  while (ym <= now) {
    const m = months[ym] || { inc: 0, exp: 0, flow: 0, life: prev ? prev.life : 0, jeonse: prev ? prev.jeonse : 0, loan: prev ? prev.loan : 0 };
    out.push({ y: Number(ym.slice(0, 4)), m: Number(ym.slice(5, 7)), inc: Math.round(m.inc), exp: Math.round(m.exp), flow: Math.round(m.flow), life: m.life, jeonse: m.jeonse, loan: m.loan });
    prev = m; ym = hhNextYm_(ym);
  }
  return out;
}

/** 말일 자동 저장: 가계부 계산값 + 투자 원금으로 '가계부월별' 한 줄 */
function saveAutoMonth_(ym) {
  const a = hhAutoMonths_().find(x => `${x.y}-${('0' + x.m).slice(-2)}` === ym);
  if (!a) return null;
  let cost = 0;
  const t = holdings_();
  for (let r = 1; r < t.values.length; r++) {
    const n = String(t.values[r][t.col['자산']]).trim();
    if (n && n !== '합계') cost += num_(t.values[r][t.col['원금(원)']]);
  }
  let pnl = 0;
  const rz = table_('실현손익');
  for (let r = 1; r < rz.values.length; r++) {
    const d = clean_(rz.values[r][rz.col['날짜']]);
    if (String(d).slice(0, 7) === ym || (d instanceof Date && Utilities.formatDate(d, TZ, 'yyyy-MM') === ym)) pnl += num_(rz.values[r][rz.col['손익(원)']]);
  }
  return saveMonth_({ y: a.y, m: a.m, nw: a.life + cost, inc: a.inc, exp: a.exp, pnl, flow: a.flow, book: Math.round(cost), jeonse: a.jeonse, loan: a.loan });
}

/* ───────────────────────── 월 마감 (가계부월별) ───────────────────────── */

const HH_HEADERS = ['연도', '월', '순자산', '수입(근로·기타)', '생활 지출', '투자손익(실현)', '투자 순투입', '투자 장부잔액', '기타 보정', '전세보증금', '대출'];

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
  if (mo.jeonse !== '' && mo.jeonse !== undefined && mo.jeonse !== null) obj['전세보증금'] = Math.round(num_(mo.jeonse));
  if (mo.loan !== '' && mo.loan !== undefined && mo.loan !== null) obj['대출'] = Math.round(num_(mo.loan));
  ensureHeaders_('가계부월별', ['전세보증금', '대출']);
  const t = table_('가계부월별');
  for (let r = 1; r < t.values.length; r++) {
    if (num_(t.values[r][t.col['연도']]) === y && num_(t.values[r][t.col['월']]) === m) {
      Object.keys(obj).forEach(h => { if (h in t.col) setCell_(t, r, h, obj[h]); });
      return { ok: true, message: `${y}년 ${m}월 마감을 수정했습니다` };
    }
  }
  appendByHeader_('가계부월별', obj);
  return { ok: true, message: `${y}년 ${m}월 마감을 저장했습니다` };
}

/** 탭에 없는 머리글을 오른쪽 끝(설명 칸 앞)에 추가 */
function ensureHeaders_(name, headers) {
  const sh = sheet_(name);
  const head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(h => String(h).trim());
  // 첫 빈 칸 = 데이터 표의 끝
  let end = head.indexOf(''); if (end < 0) end = head.length;
  headers.forEach(h => {
    if (head.indexOf(h) >= 0) return;
    sh.insertColumnBefore(end + 1);
    sh.getRange(1, end + 1).setValue(h).setFontWeight('bold');
    head.splice(end, 0, h); end++;
  });
}

/* ───────────────────────── 가계부 (편한가계부 대신) ─────────────────────────
 * 가계부        : 내역 한 줄 = 수입·지출·이체·수정(잔액 수정). 금액은 원화. 수정은 +늘림 / −줄임
 * 가계부분류    : 구분(수입/지출) · 분류 · 소분류(' | '로 구분)
 * 가계부자산    : 그룹 · 자산 · 숨김(Y) · 메모 · 연결(체크카드의 결제 계좌)   (위에서부터 화면 순서)
 * 가계부예산    : 분류 · 소분류(비우면 분류 전체) · 금액 · 월
 *                 월: 비움 = 기본예산(처음부터), '2026-11~' = 그 달부터 기본예산, '2026-09' = 그 달만
 * 가계부반복    : 매월 같은 날 자동으로 들어가는 내역 (앱을 열 때 밀린 달까지 채움)
 * 가계부메모    : 날짜별 메모
 * 일시·ID 칸은 글자 서식(구글 시트가 날짜로 바꾸지 않게) */

const HH_TABS = {
  '가계부':     ['ID', '일시', '구분', '분류', '소분류', '내용', '금액', '자산', '받는자산', '메모', '화폐', '외화금액', '반복', '입력자', '투자구분', '투자계좌', '투자종목', '투자수량', '투자단가'],
  '가계부분류': ['구분', '분류', '소분류'],
  '가계부자산': ['그룹', '자산', '숨김', '메모', '연결'],
  '가계부반복': ['ID', '주기', '일', '구분', '분류', '소분류', '내용', '금액', '자산', '받는자산', '메모', '시작', '종료', '마지막생성', '투자구분', '투자계좌', '투자종목'],
  '가계부메모': ['ID', '날짜', '내용', '입력자'],
  '가계부예산': ['분류', '소분류', '금액', '월'],
};
const HH_TEXT = { '가계부': ['ID', '일시'], '가계부반복': ['ID', '시작', '종료', '마지막생성'], '가계부메모': ['ID', '날짜'], '가계부예산': ['월'] };
const HH_KIND = { tx: '가계부', rule: '가계부반복', memo: '가계부메모' };

function readHH_() {
  if (!SpreadsheetApp.getActive().getSheetByName('가계부')) return { ready: false };
  const made = withLock_(() => { hhEnsure_(); return hhRunRules_(); });
  const read = name => hhRows_(name).rows;
  return {
    ready: true, made,
    tx: read('가계부'), cats: read('가계부분류'), assets: read('가계부자산'), rules: read('가계부반복'), memos: read('가계부메모'),
    budgets: read('가계부예산'),
  };
}

/** 탭이 없으면 만들고, 머리글이 빠졌으면 채움 */
function hhEnsure_() {
  const ss = SpreadsheetApp.getActive();
  ['거래기록', '실현손익'].forEach(n => { if (ss.getSheetByName(n)) ensureHeaders_(n, ['연결']); });
  Object.keys(HH_TABS).forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh) {
      const n = ss.insertSheet(name);
      n.getRange(1, 1, 1, HH_TABS[name].length).setValues([HH_TABS[name]]).setFontWeight('bold');
      n.setFrozenRows(1);
    } else ensureHeaders_(name, HH_TABS[name]);
  });
}

/** 탭의 내용을 HH_TABS 순서의 배열로 (빈 줄 제외). ID가 빈 줄은 ID를 만들어 채움 */
function hhRows_(name) {
  const t = table_(name), F = HH_TABS[name], rows = [], fill = [];
  for (let r = 1; r < t.values.length; r++) {
    const v = t.values[r];
    const a = F.map(h => (h in t.col ? hhVal_(v[t.col[h]], h) : ''));
    if (a.every(x => x === '' || x === null)) continue;
    if (F[0] === 'ID' && !String(a[0]).trim()) { a[0] = 'm' + Date.now().toString(36) + r; fill.push([r + 1, a[0]]); }
    rows.push(a);
  }
  if (fill.length && 'ID' in t.col) fill.forEach(([row, id]) => t.sh.getRange(row, t.col['ID'] + 1).setNumberFormat('@').setValue(id));
  return { rows };
}

function hhVal_(v, h) {
  if (v instanceof Date) {
    const f = h === '일시' ? 'yyyy-MM-dd HH:mm:ss' : (h === '시작' || h === '종료' || h === '마지막생성' || h === '월') ? 'yyyy-MM' : 'yyyy-MM-dd';
    return Utilities.formatDate(v, sheetTz_(), f);
  }
  if (typeof v === 'number' && !isFinite(v)) return '';
  if (typeof v === 'string') return v.trim();
  return v;
}

function hhHead_(sh) {
  const head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(h => String(h).trim());
  const end = head.indexOf('');
  return end < 0 ? head : head.slice(0, end);
}

function hhTextFormat_(sh, name, head, row, n) {
  (HH_TEXT[name] || []).forEach(h => { const i = head.indexOf(h); if (i >= 0) sh.getRange(row, i + 1, n, 1).setNumberFormat('@'); });
}

function hhFindRow_(sh, head, id) {
  const idc = head.indexOf('ID') + 1, last = sh.getLastRow();
  if (!idc || last < 2) return 0;
  const ids = sh.getRange(2, idc, last - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]).trim() === id) return i + 2;
  return 0;
}

/** ID가 같은 줄은 고치고, 없으면 맨 아래에 추가 */
function hhUpsert_(name, obj) {
  const sh = sheet_(name), head = hhHead_(sh);
  let row = hhFindRow_(sh, head, obj.ID), vals;
  if (row) vals = sh.getRange(row, 1, 1, head.length).getValues()[0];
  else { row = sh.getLastRow() + 1; vals = head.map(() => ''); }
  head.forEach((h, i) => { if (h in obj) vals[i] = obj[h]; });
  hhTextFormat_(sh, name, head, row, 1);
  sh.getRange(row, 1, 1, head.length).setValues([vals]);
  return HH_TABS[name].map(h => (h in obj ? obj[h] : hhVal_(vals[head.indexOf(h)], h)));
}

const hhStr_ = (v, max) => String(v === null || v === undefined ? '' : v).trim().slice(0, max || 300);
function hhId_(v) {
  const id = hhStr_(v, 40);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('ID가 올바르지 않습니다');
  return id;
}
function hhAmt_(v) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) throw new Error('금액이 올바르지 않습니다');
  return n;
}

function hhTx_(t) {
  const o = {
    'ID': hhId_(t['ID']), '일시': hhStr_(t['일시'], 19), '구분': hhStr_(t['구분'], 4),
    '분류': hhStr_(t['분류'], 60), '소분류': hhStr_(t['소분류'], 60), '내용': hhStr_(t['내용'], 200), '금액': hhAmt_(t['금액']),
    '자산': hhStr_(t['자산'], 80), '받는자산': hhStr_(t['받는자산'], 80), '메모': hhStr_(t['메모'], 2000),
    '화폐': hhStr_(t['화폐'], 5), '외화금액': t['외화금액'] === '' || t['외화금액'] === undefined ? '' : Number(t['외화금액']),
    '반복': hhStr_(t['반복'], 40), '입력자': hhStr_(t['입력자'], 20),
  };
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(o['일시'])) o['일시'] += ':00';
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(o['일시'])) throw new Error('날짜가 올바르지 않습니다');
  if (['수입', '지출', '이체', '수정'].indexOf(o['구분']) < 0) throw new Error('구분이 올바르지 않습니다');
  if (o['구분'] !== '수정' && !(o['금액'] > 0)) throw new Error('금액을 입력하세요');
  if (!o['자산']) throw new Error('자산을 고르세요');
  if (o['구분'] === '이체') {
    if (!o['받는자산']) throw new Error('입금 자산을 고르세요');
    if (o['받는자산'] === o['자산']) throw new Error('출금·입금 자산이 같습니다');
    o['분류'] = ''; o['소분류'] = '';
  } else o['받는자산'] = '';
  // 투자 앱 연결 (이체만): 입금·매수 = 투자 계좌로 보냄, 출금·매도 = 투자 계좌에서 찾음
  o['투자구분'] = o['구분'] === '이체' ? hhStr_(t['투자구분'], 4) : '';
  if (o['투자구분'] && ['입금', '출금', '매수', '매도'].indexOf(o['투자구분']) < 0) throw new Error('투자 앱 연결 구분이 올바르지 않습니다');
  o['투자계좌'] = o['투자구분'] ? hhStr_(t['투자계좌'], 80) : '';
  o['투자종목'] = o['투자구분'] ? hhStr_(t['투자종목'], 80) : '';
  const tq = o['투자구분'] === '매수' || o['투자구분'] === '매도';
  o['투자수량'] = tq ? Number(t['투자수량']) : '';
  o['투자단가'] = tq ? Number(t['투자단가']) : '';
  if (o['투자구분']) {
    if (!o['투자계좌']) throw new Error('투자 앱 계좌를 고르세요');
    if (tq && !(o['투자수량'] > 0 && o['투자단가'] > 0)) throw new Error('수량과 단가를 입력하세요');
    const inv = hhInvAssets_(), into = o['투자구분'] === '입금' || o['투자구분'] === '매수';
    if (!inv[into ? o['받는자산'] : o['자산']]) throw new Error(into ? '투자 앱 입금·매수는 투자 계좌로 보내는 이체에만 쓸 수 있습니다' : '투자 앱 출금·매도는 투자 계좌에서 찾는 이체에만 쓸 수 있습니다');
  }
  return o;
}

/** 가계부자산 중 '연결'이 투자앱인 자산 이름 */
let HH_INV_ = null;
function hhInvAssets_() {
  if (HH_INV_) return HH_INV_;
  HH_INV_ = {};
  hhRows_('가계부자산').rows.forEach(r => { if (String(r[4]).trim() === '투자앱') HH_INV_[String(r[1]).trim()] = true; });
  return HH_INV_;
}

/** 내역 한 줄 → 투자 앱 거래 (없으면 null) */
function hhLinkSpec_(o) {
  const ty = String(o['투자구분'] || '').trim();
  if (!ty || String(o['구분']).trim() !== '이체') return null;
  const ts = String(o['일시'] || '').replace(' ', 'T') + '+09:00';
  const spec = { type: ty, asset: String(o['투자계좌']).trim(), sub: String(o['투자종목'] || o['투자계좌']).trim(), amountKrw: Math.round(num_(o['금액'])), date: ts, by: o['입력자'] || '' };
  if (ty === '매수' || ty === '매도') { spec.qty = num_(o['투자수량']); spec.price = num_(o['투자단가']); }
  spec.memo = `가계부: ${String(o['내용'] || '').trim() || (ty === '입금' || ty === '매수' ? '투자 계좌로 이체' : '투자 계좌에서 찾음')}`;
  return spec;
}
const hhSpecKey_ = s => (s ? [s.type, s.asset, s.sub, s.amountKrw, s.qty || '', s.price || ''].join('|') : '');

/** 내역 ID에 연결된 투자 앱 거래를 되돌리고 기록을 지움 */
function hhUndoLink_(id) {
  const lt = table_('거래기록');
  if (!('연결' in lt.col)) return false;
  let r = -1;
  for (let i = lt.values.length - 1; i >= 1; i--) if (String(lt.values[i][lt.col['연결']]).trim() === id) { r = i; break; }
  if (r < 0) return false;
  const v = h => lt.values[r][lt.col[h]];
  const type = String(v('구분')).trim(), asset = String(v('자산')).trim(), sub = String(v('세부종목')).trim();
  const amt = Math.round(num_(v('금액(원)'))), qty = num_(v('수량')), price = num_(v('단가'));
  if (type === '입금' || type === '출금') {
    recordTrade_({ type: type === '입금' ? '출금' : '입금', asset, sub, amountKrw: amt, nolog: true });
  } else {
    const t = holdings_(), rate = rate_(), cash = CASH[asset] || { mode: 'none' };
    const h = findRow_(t, asset, sub);
    if (h < 0) throw new Error(`되돌릴 종목 '${asset} / ${sub}'을 보유현황에서 찾지 못했습니다`);
    const cur = String(t.values[h][t.col['통화']]).trim() || 'KRW';
    const Q = num_(t.values[h][t.col['수량']]), A = num_(t.values[h][t.col['평단가']]), C = num_(t.values[h][t.col['원금(원)']]);
    const cashRow = resolveCash_(t, cash);
    if (type === '매수') {
      const nq = round_(Q - qty, 8);
      if (nq < -1e-9) throw new Error('되돌릴 수량이 보유 수량보다 많습니다');
      setCell_(t, h, '수량', Math.max(0, nq));
      if (nq > 1e-9 && A > 0) setCell_(t, h, '평단가', round_((Q * A - qty * price) / nq, 4));
      if (cash.mode !== 'internal') setCell_(t, h, '원금(원)', Math.round(C - amt));
      moveCash_(t, cash, cashRow, qty * price, amt, cur, rate);
    } else {
      const realized = num_(v('실현손익(원)'));
      setCell_(t, h, '수량', round_(Q + qty, 8));
      if (cash.mode !== 'internal') setCell_(t, h, '원금(원)', Math.round(C + (amt - realized)));
      moveCash_(t, cash, cashRow, -qty * price, -amt, cur, rate);
      const rt = table_('실현손익');
      if ('연결' in rt.col) for (let i = rt.values.length - 1; i >= 1; i--) if (String(rt.values[i][rt.col['연결']]).trim() === id) { rt.sh.deleteRow(i + 1); break; }
    }
  }
  lt.sh.deleteRow(r + 1);
  return true;
}

/** 내역 저장 전후 비교: 연결이 바뀌었으면 예전 것을 되돌리고 새로 기록 */
function hhSyncLink_(id, oldSpec, newSpec) {
  if (hhSpecKey_(oldSpec) === hhSpecKey_(newSpec)) return null;
  const undone = oldSpec ? hhUndoLink_(id) : false;
  if (!newSpec) return null;
  try { return recordTrade_(Object.assign({}, newSpec, { link: id })); }
  catch (e) {
    if (undone) { try { recordTrade_(Object.assign({}, oldSpec, { link: id })); } catch (e2) { /* 되살리기 실패 */ } }
    throw new Error(`투자 앱 기록 실패: ${e.message}`);
  }
}

function hhTxRowObj_(id) {
  const sh = sheet_('가계부'), head = hhHead_(sh), row = hhFindRow_(sh, head, id);
  if (!row) return null;
  const vals = sh.getRange(row, 1, 1, head.length).getValues()[0], o = {};
  head.forEach((h, i) => { o[h] = hhVal_(vals[i], h); });
  return o;
}

function hhRule_(t) {
  const o = hhTx_(Object.assign({}, t, { '일시': '2000-01-01 00:00:00' }));
  delete o['일시']; delete o['반복']; delete o['입력자']; delete o['화폐']; delete o['외화금액']; delete o['투자수량']; delete o['투자단가'];
  if (o['투자구분'] === '매수' || o['투자구분'] === '매도') throw new Error('반복 내역은 투자 앱 입금·출금만 연결할 수 있습니다');
  o['주기'] = '매월';
  o['일'] = Math.min(31, Math.max(1, Math.round(Number(t['일'])) || 1));
  ['시작', '종료', '마지막생성'].forEach(h => {
    o[h] = hhStr_(t[h], 7);
    if (o[h] && !/^\d{4}-\d{2}$/.test(o[h])) throw new Error(`${h} 달이 올바르지 않습니다`);
  });
  if (!o['시작']) throw new Error('시작 달이 없습니다');
  return o;
}

function hhMemo_(t) {
  const o = { 'ID': hhId_(t['ID']), '날짜': hhStr_(t['날짜'], 10), '내용': hhStr_(t['내용'], 5000), '입력자': hhStr_(t['입력자'], 20) };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o['날짜'])) throw new Error('날짜가 올바르지 않습니다');
  if (!o['내용']) throw new Error('메모 내용이 없습니다');
  return o;
}

/** req = { tx?, rule?, memo? } — 반복 내역을 새로 만들 때는 tx와 rule을 함께 보냄 */
function hhSave_(req) {
  hhEnsure_();
  const out = { ok: true };
  if (req.rule) out.rule = hhUpsert_('가계부반복', hhRule_(req.rule));
  if (req.tx) {
    const o = hhTx_(req.tx), prev = hhTxRowObj_(o.ID);
    const r = hhSyncLink_(o.ID, prev && hhLinkSpec_(prev), hhLinkSpec_(o));   // 투자 앱 먼저 (실패하면 내역도 저장 안 함)
    out.tx = hhUpsert_('가계부', o);
    if (r) out.inv = { type: o['투자구분'], amountKrw: r.amountKrw, realized: r.realized };
  }
  if (req.memo) out.memo = hhUpsert_('가계부메모', hhMemo_(req.memo));
  return out;
}

/** req = { kind: 'tx'|'rule'|'memo', id } */
function hhDel_(req) {
  const name = HH_KIND[req.kind];
  if (!name) throw new Error('삭제할 종류가 올바르지 않습니다');
  const id = hhId_(req.id), sh = sheet_(name);
  const row = hhFindRow_(sh, hhHead_(sh), id);
  if (!row) return { ok: true, message: '이미 지워진 내역입니다' };
  let undone = false;
  if (req.kind === 'tx') { const prev = hhTxRowObj_(id); if (prev && hhLinkSpec_(prev)) undone = hhUndoLink_(id); }
  sh.deleteRow(row);
  return { ok: true, invUndone: undone };
}

/** req = { renames?: [{what:'asset'|'cat'|'sub', type, cat, from, to}], cats?: [[구분,분류,소분류]], assets?: [[그룹,자산,숨김,메모,연결]], budgets?: [[분류,소분류,금액,월]] } */
function hhSettings_(req) {
  hhEnsure_();
  (req.renames || []).forEach(hhRename_);
  if (req.cats) hhRewrite_('가계부분류', req.cats.map(r => [hhStr_(r[0], 4), hhStr_(r[1], 60), hhStr_(r[2], 2000)]).filter(r => r[1]));
  if (req.assets) hhRewrite_('가계부자산', req.assets.map(r => [hhStr_(r[0], 30), hhStr_(r[1], 80), r[2] ? 'Y' : '', hhStr_(r[3], 200), hhStr_(r[4], 80)]).filter(r => r[1]));
  if (req.budgets) hhRewrite_('가계부예산', req.budgets.map(r => {
    const m = String(r[3] || '').trim();
    return [hhStr_(r[0], 60), hhStr_(r[1], 60), Math.max(0, Math.round(Number(r[2])) || 0), /^\d{4}-\d{2}~?$/.test(m) ? m : ''];
  }).filter(r => r[0] && (r[2] > 0 || r[3])));
  return { ok: true };
}

function hhRewrite_(name, rows) {
  const sh = sheet_(name), head = hhHead_(sh), F = HH_TABS[name];
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, head.length).clearContent();
  if (!rows.length) return;
  (HH_TEXT[name] || []).forEach(h => { const i = head.indexOf(h); if (i >= 0) sh.getRange(2, i + 1, rows.length, 1).setNumberFormat('@'); });
  const vals = rows.map(r => head.map(h => { const i = F.indexOf(h); return i >= 0 ? r[i] : ''; }));
  sh.getRange(2, 1, vals.length, head.length).setValues(vals);
}

/** 이름 바꾸기: 지난 내역·반복 내역에 적힌 이름도 함께 바꿈 */
function hhRename_(rn) {
  if (rn.what === 'move') return hhMove_(rn);
  const from = hhStr_(rn.from, 80), to = hhStr_(rn.to, 80);
  if (!from || !to || from === to) return;
  ['가계부', '가계부반복'].forEach(name => {
    const t = table_(name), c = t.col, changed = {};
    const get = (v, h) => (h in c ? String(v[c[h]]).trim() : '');
    for (let r = 1; r < t.values.length; r++) {
      const v = t.values[r];
      if (rn.what === 'asset') {
        ['자산', '받는자산'].forEach(h => { if (get(v, h) === from) { v[c[h]] = to; changed[h] = true; } });
      } else if (get(v, '구분') === rn.type) {
        if (rn.what === 'cat' && get(v, '분류') === from) { v[c['분류']] = to; changed['분류'] = true; }
        if (rn.what === 'sub' && get(v, '분류') === rn.cat && get(v, '소분류') === from) { v[c['소분류']] = to; changed['소분류'] = true; }
      }
    }
    Object.keys(changed).forEach(h => {
      const col = c[h];
      t.sh.getRange(2, col + 1, t.values.length - 1, 1).setValues(t.values.slice(1).map(v => [v[col]]));
    });
  });
}

/** 분류 옮기기: { what:'move', type, fromCat, fromSub(null = 그 분류 전체), toCat, toSub }
 *  소분류 → 다른 분류, 소분류 → 대분류로, 대분류 → 다른 분류의 소분류로 */
function hhMove_(rn) {
  const type = hhStr_(rn.type, 4), fc = hhStr_(rn.fromCat, 60), tc = hhStr_(rn.toCat, 60), ts = hhStr_(rn.toSub, 60);
  const fs = rn.fromSub === null || rn.fromSub === undefined ? null : hhStr_(rn.fromSub, 60);
  if (!type || !fc || !tc) return;
  ['가계부', '가계부반복'].forEach(name => {
    const t = table_(name), c = t.col;
    if (!('분류' in c) || !('소분류' in c)) return;
    const get = (v, h) => (h in c ? String(v[c[h]]).trim() : '');
    let n = 0;
    for (let r = 1; r < t.values.length; r++) {
      const v = t.values[r];
      if (get(v, '구분') !== type || get(v, '분류') !== fc) continue;
      if (fs !== null && get(v, '소분류') !== fs) continue;
      v[c['분류']] = tc; v[c['소분류']] = ts; n++;
    }
    if (!n) return;
    ['분류', '소분류'].forEach(h => { const col = c[h]; t.sh.getRange(2, col + 1, t.values.length - 1, 1).setValues(t.values.slice(1).map(v => [v[col]])); });
  });
}

/** 반복 내역: 마지막으로 만든 달 다음 달부터 이번 달(오늘 날짜까지)까지 채움 */
function hhRunRules_() {
  const rt = table_('가계부반복'), c = rt.col;
  if (rt.values.length < 2) return 0;
  const now = new Date();
  const ym = Utilities.formatDate(now, TZ, 'yyyy-MM'), today = Number(Utilities.formatDate(now, TZ, 'd'));
  const add = [], done = [];
  for (let r = 1; r < rt.values.length; r++) {
    const v = rt.values[r], g = h => (h in c ? hhVal_(v[c[h]], h) : '');
    const id = String(g('ID')).trim();
    if (!id || (g('주기') && g('주기') !== '매월')) continue;
    const start = String(g('시작')).slice(0, 7), end = String(g('종료')).slice(0, 7), last = String(g('마지막생성')).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(start)) continue;
    let m = /^\d{4}-\d{2}$/.test(last) ? hhNextYm_(last) : start, made = '', guard = 0;
    if (m < start) m = start;
    while (m <= ym && (!end || m <= end) && guard++ < 36) {
      const day = Math.min(Math.max(1, Math.round(num_(g('일'))) || 1), hhDays_(m));
      if (m === ym && day > today) break;
      add.push({
        'ID': `${id}-${m.replace('-', '')}`, '일시': `${m}-${('0' + day).slice(-2)} 00:00:00`, '구분': g('구분'),
        '분류': g('분류'), '소분류': g('소분류'), '내용': g('내용'), '금액': num_(g('금액')), '자산': g('자산'),
        '받는자산': g('받는자산'), '메모': g('메모'), '반복': id, '입력자': '자동',
        '투자구분': g('구분') === '이체' ? g('투자구분') : '', '투자계좌': g('투자계좌'), '투자종목': g('투자종목'),
      });
      made = m; m = hhNextYm_(m);
    }
    if (made) done.push([r + 1, made]);
  }
  let n = 0;
  if (add.length) {
    const sh = sheet_('가계부'), head = hhHead_(sh), idc = head.indexOf('ID') + 1, last = sh.getLastRow();
    const have = {};
    if (idc && last > 1) sh.getRange(2, idc, last - 1, 1).getValues().forEach(x => { have[String(x[0]).trim()] = true; });
    const fresh = add.filter(o => !have[o.ID]);
    const rows = fresh.map(o => head.map(h => (h in o ? o[h] : '')));
    if (rows.length) {
      hhTextFormat_(sh, '가계부', head, last + 1, rows.length);
      sh.getRange(last + 1, 1, rows.length, head.length).setValues(rows);
      n = rows.length;
      // 투자 앱 연결된 반복 이체 (예: 매월 ISA 입금)
      fresh.forEach(o => { const sp = hhLinkSpec_(o); if (sp) { try { recordTrade_(Object.assign({}, sp, { link: o.ID })); } catch (e) { /* 투자 앱 기록 실패는 내역 생성을 막지 않음 */ } } });
    }
  }
  done.forEach(([row, m]) => rt.sh.getRange(row, c['마지막생성'] + 1).setNumberFormat('@').setValue(m));
  return n;
}

function hhNextYm_(ym) {
  let y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) + 1;
  if (m > 12) { m = 1; y++; }
  return `${y}-${('0' + m).slice(-2)}`;
}
function hhDays_(ym) { return new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate(); }

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
