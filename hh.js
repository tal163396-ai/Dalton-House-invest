/* Dalton House 가계부 (편한가계부와 같은 구성: 가계부 · 통계 · 자산 · 더보기)
 * 데이터는 구글 시트 '가계부' 탭들에 저장되고, 이 파일에는 개인 정보가 들어있지 않습니다. */
(() => {
  'use strict';
  const D = window.DH;
  const { $, $$, esc, store, sess } = D;
  const toast = (m, e) => D.toast(m, e);

  const F_TX = ['ID', '일시', '구분', '분류', '소분류', '내용', '금액', '자산', '받는자산', '메모', '화폐', '외화금액', '반복', '입력자', '투자구분', '투자계좌', '투자종목', '투자수량', '투자단가'];
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const COLORS = ['#F87171', '#FB923C', '#FBBF24', '#FDE047', '#A3E635', '#4ADE80', '#2DD4BF', '#38BDF8', '#60A5FA', '#A78BFA', '#E879F9', '#F472B6'];
  const CACHE = 'dh_hh_cache';

  /* ───────────── 작은 도우미 ───────────── */
  const pad = n => String(n).padStart(2, '0');
  const fmt = n => Math.round(n).toLocaleString('ko-KR');
  const won = n => `${fmt(n)}원`;
  const swon = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}원`;
  const ymOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const dOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => dOf(new Date());
  const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d || 1); };
  const addMonths = (ym, k) => { const d = parseD(ym + '-01'); d.setMonth(d.getMonth() + k); return ymOf(d); };
  const addDays = (ds, k) => { const d = parseD(ds); d.setDate(d.getDate() + k); return dOf(d); };
  const daysIn = ym => new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate();
  const ymLabel = ym => `${+ym.slice(0, 4)}년 ${+ym.slice(5, 7)}월`;
  const mdLabel = ds => `${+ds.slice(5, 7)}.${+ds.slice(8, 10)}`;
  const wdOf = ds => parseD(ds).getDay();
  function tmLabel(tm) {
    if (!tm || tm === '00:00:00') return '';
    const h = +tm.slice(0, 2), m = tm.slice(3, 5);
    return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${m}`;
  }
  const dateLabel = ds => `${ds.slice(2, 4)}. ${+ds.slice(5, 7)}. ${+ds.slice(8, 10)}. (${WD[wdOf(ds)]})`;
  /* ── 반복 주기 (편한가계부와 같은 목록). 서버 hhOccAfter_ 와 같은 계산 ── */
  const PERIODS = ['매일', '주중', '주말', '매주', '2주마다', '4주마다', '매월', '월말', '2개월마다', '3개월마다', '4개월마다', '6개월마다', '1년마다'];
  const PER_M = { 매월: 1, '2개월마다': 2, '3개월마다': 3, '4개월마다': 4, '6개월마다': 6, '1년마다': 12 };
  const PER_D = { 매주: 7, '2주마다': 14, '4주마다': 28 };
  const PER_PM = { 매일: 30.4, 주중: 21.7, 주말: 8.7, 매주: 4.35, '2주마다': 2.17, '4주마다': 1.09, 매월: 1, 월말: 1, '2개월마다': 1 / 2, '3개월마다': 1 / 3, '4개월마다': 1 / 4, '6개월마다': 1 / 6, '1년마다': 1 / 12 };
  const clampDay = (ym, d) => `${ym}-${pad(Math.min(d, daysIn(ym)))}`;
  const ruleAnchor = r => { const s = String(r.start || ''); if (s.length >= 10) return s.slice(0, 10); return clampDay(/^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : ymOf(new Date()), r.day || 1); };
  const ruleLast = r => { const s = String(r.last || ''); if (s.length >= 10) return s.slice(0, 10); if (/^\d{4}-\d{2}$/.test(s)) return clampDay(s, r.day || 1); return addDays(ruleAnchor(r), -1); };
  const ruleEnd = r => { const s = String(r.end || ''); return !s ? '' : s.length >= 10 ? s.slice(0, 10) : `${s.slice(0, 7)}-${pad(daysIn(s.slice(0, 7)))}`; };
  function occAfter(per, anchor, after) {
    const day = +anchor.slice(8, 10);
    if (per in PER_M) { let ym = anchor.slice(0, 7); for (let i = 0; i < 1200; i++) { const d = clampDay(ym, day); if (d > after) return d; ym = addMonths(ym, PER_M[per]); } return ''; }
    if (per === '월말') { let ym = anchor.slice(0, 7); for (let i = 0; i < 1200; i++) { const d = `${ym}-${pad(daysIn(ym))}`; if (d >= anchor && d > after) return d; ym = addMonths(ym, 1); } return ''; }
    if (per in PER_D) { if (after < anchor) return anchor; const diff = Math.round((parseD(after) - parseD(anchor)) / 864e5); return addDays(anchor, (Math.floor(diff / PER_D[per]) + 1) * PER_D[per]); }
    let d = after < anchor ? anchor : addDays(after, 1);
    for (let i = 0; i < 8; i++) { const w = wdOf(d); if (per === '매일' || (per === '주중' && w > 0 && w < 6) || (per === '주말' && (w === 0 || w === 6))) return d; d = addDays(d, 1); }
    return '';
  }
  const ruleNext = r => occAfter(r.period || '매월', ruleAnchor(r), ruleLast(r));
  function perLabel(per, anchor) {
    const d = +anchor.slice(8, 10);
    if (per === '매월' || /개월마다$/.test(per)) return `${per} ${d}일`;
    if (per === '1년마다') return `매년 ${+anchor.slice(5, 7)}월 ${d}일`;
    if (per in PER_D) return `${per} ${WD[wdOf(anchor)]}요일`;
    return per;
  }
  function compactWon(v) {
    const a = Math.abs(v), s = v < 0 ? '−' : '';
    if (a >= 1e8) return `${s}${(a / 1e8).toFixed(2)}억`;
    if (a >= 1e4) return `${s}${fmt(a / 1e4)}만`;
    return `${s}${fmt(a)}`;
  }
  const chars = s => Array.from(String(s || ''));
  const clip = (s, n) => { const c = chars(s); return c.length > n ? c.slice(0, n).join('') + '…' : c.join(''); };
  const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const ico = {
    bksp: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7z"/><path d="M12 9.5l5 5M17 9.5l-5 5"/></svg>',
    calc: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 15.5h.01M12 15.5h.01M15.5 15.5h.01M8.5 18h.01M12 18h.01M15.5 18h.01"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
    left: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    right: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    pen: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    del: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="var(--exp)"/><path d="M7.5 12h9" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>',
    drag: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 8h14M5 12h14M5 16h14"/></svg>',
    rep: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11V9a3 3 0 0 1 3-3h12l-3-3M20 13v2a3 3 0 0 1-3 3H5l3 3"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
    eye: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    chart: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6"/></svg>',
    chev: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  };

  /* ───────────── 상태 ───────────── */
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  const H = {
    ready: true, loaded: false, loading: false,
    tx: [], byId: new Map(), byYm: new Map(), bal: new Map(),
    cats: { 수입: [], 지출: [] }, assets: [], rules: [], memos: [],
    pending: new Map(),
    view: pick(sess.get('dh_hview'), ['book', 'stats', 'assets', 'more'], 'book'),
    btab: pick(sess.get('dh_hbtab'), ['daily', 'close', 'memo', 'month'], 'daily'),
    ym: /^\d{4}-\d{2}$/.test(sess.get('dh_hym') || '') ? sess.get('dh_hym') : ymOf(new Date()),
    budgets: new Map(), link: new Map(), inv: new Set(),
    budClosed: new Set((() => { try { return JSON.parse(store.get('dh_hbud_closed') || '[]'); } catch { return []; } })()),
    openMonths: new Set(), openInit: new Set(),
    st: {
      period: pick(store.get('dh_hst_p'), ['month', 'year', 'range', 'cmp'], 'month'),
      avg: store.get('dh_hst_avg') === '1',
      type: pick(store.get('dh_hst_t'), ['수입', '지출'], '지출'),
      anchor: today(), from: `${today().slice(0, 4)}-01-01`, to: today(),
    },
    active: false,
    cmp: (() => { let c = {}; try { c = JSON.parse(store.get('dh_hcmp') || '{}') || {}; } catch { c = {}; } return { type: c.type === '수입' ? '수입' : '지출', years: Array.isArray(c.years) ? c.years.map(Number) : [], cats: Array.isArray(c.cats) ? c.cats : ['__all'], avg: c.avg !== false, mode: c.mode === 'sum' ? 'sum' : 'each', trend: null, sel: null }; })(),
  };

  /* ───────────── 데이터 ───────────── */
  function toTx(a) {
    const ts = String(a[1] || '');
    const famt = a[11] === '' || a[11] === null || a[11] === undefined ? '' : Number(a[11]);
    return {
      id: String(a[0]), ts, d: ts.slice(0, 10), tm: ts.slice(11, 19), ym: ts.slice(0, 7), type: String(a[2] || ''),
      cat: String(a[3] || ''), sub: String(a[4] || ''), text: String(a[5] || ''), amt: Number(a[6]) || 0,
      asset: String(a[7] || ''), to: String(a[8] || ''), memo: String(a[9] || ''), cur: String(a[10] || ''), famt,
      rule: String(a[12] || ''), by: String(a[13] || ''),
      invType: String(a[14] || ''), invAcct: String(a[15] || ''), invSub: String(a[16] || ''),
      invQty: a[17] === '' || a[17] == null ? '' : Number(a[17]), invPrice: a[18] === '' || a[18] == null ? '' : Number(a[18]),
    };
  }
  const txArr = t => [t.id, t.ts, t.type, t.cat, t.sub, t.text, t.amt, t.asset, t.to, t.memo, t.cur, t.famt, t.rule, t.by, t.invType || '', t.invAcct || '', t.invSub || '', t.invQty ?? '', t.invPrice ?? ''];
  const txObj = t => Object.fromEntries(F_TX.map((h, i) => [h, txArr(t)[i]]));
  const ruleArr = r => [r.id, r.period || '매월', r.day, r.type, r.cat, r.sub, r.text, r.amt, r.asset, r.to, r.memo, r.start, r.end, r.last, r.invType || '', r.invAcct || '', r.invSub || ''];
  const ruleObj = r => ({ ID: r.id, 주기: r.period || '매월', 일: r.day, 구분: r.type, 분류: r.cat, 소분류: r.sub, 내용: r.text, 금액: r.amt, 자산: r.asset, 받는자산: r.to, 메모: r.memo, 시작: r.start, 종료: r.end, 마지막생성: r.last, 투자구분: r.invType || '', 투자계좌: r.invAcct || '', 투자종목: r.invSub || '' });
  const toRule = a => ({ id: String(a[0]), period: PERIODS.includes(String(a[1] || '').trim()) ? String(a[1]).trim() : '매월', day: Number(a[2]) || 1, type: String(a[3] || ''), cat: String(a[4] || ''), sub: String(a[5] || ''), text: String(a[6] || ''), amt: Number(a[7]) || 0, asset: String(a[8] || ''), to: String(a[9] || ''), memo: String(a[10] || ''), start: String(a[11] || ''), end: String(a[12] || ''), last: String(a[13] || ''), invType: String(a[14] || ''), invAcct: String(a[15] || ''), invSub: String(a[16] || '') });
  // 투자 앱 연결 표시: 'ISA 입금', 'TIGER … 3주 매수'
  const invLabel = (t, opts) => {
    if (!t.invType) return '';
    const o = opts || (D.invOptions && D.invOptions());
    let name = t.invSub || t.invAcct;
    if (o) {
      const a = (t.invType === '입금' || t.invType === '출금') ? (o.acc.find(x => x.asset === t.invAcct) || (o.manual || []).find(x => x.asset === t.invAcct && x.sub === t.invSub)) : o.items.find(x => x.asset === t.invAcct && x.sub === t.invSub);
      if (a) name = a.label;
    }
    const it = o && o.items.find(x => x.asset === t.invAcct && x.sub === t.invSub);
    return `${name} ${t.invQty ? `${t.invQty}${it ? it.unit : ''} ` : ''}${t.invType}`;
  };
  const toMemo = a => ({ id: String(a[0]), date: String(a[1] || ''), text: String(a[2] || ''), by: String(a[3] || '') });
  const catsArr = () => ['수입', '지출'].flatMap(t => H.cats[t].map(c => [t, c.name, c.subs.join(' | ')]));
  const assetsArr = () => H.assets.map(a => [a.group, a.name, a.hidden ? 'Y' : '', a.memo, a.link || '']);
  const BK = (c, s) => `${c}\u0001${s || ''}`;
  // 예산: 키(분류·소분류) → { base: [{ from: ''|'yyyy-MM', amt }] (적용 시작 달 순), months: Map(ym → amt) }
  const budgetsArr = () => {
    const out = [];
    H.budgets.forEach((e, k) => {
      const [c, sb] = k.split('\u0001');
      e.base.forEach(b => { if (b.amt > 0 || b.from) out.push([c, sb, b.amt, b.from ? `${b.from}~` : '']); });
      e.months.forEach((v, ym) => out.push([c, sb, v, ym]));
    });
    return out;
  };
  const budEntry = (k, make = false) => { let e = H.budgets.get(k); if (!e && make) H.budgets.set(k, (e = { base: [], months: new Map() })); return e; };
  function parseBudgets(rows) {
    const m = new Map();
    (rows || []).forEach(r => {
      const c = String(r[0] || '').trim(); if (!c) return;
      const k = BK(c, String(r[1] || '').trim()), amt = Math.max(0, Number(r[2]) || 0), mo = String(r[3] || '').trim();
      let e = m.get(k); if (!e) m.set(k, (e = { base: [], months: new Map() }));
      if (/^\d{4}-\d{2}$/.test(mo)) e.months.set(mo, amt);
      else e.base.push({ from: /^\d{4}-\d{2}~$/.test(mo) ? mo.slice(0, 7) : '', amt });
    });
    m.forEach(e => e.base.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)));
    return m;
  }

  function ingest(hh) {
    H.tx = (hh.tx || []).map(toTx).filter(t => /^\d{4}-\d{2}-\d{2}/.test(t.ts));
    H.cats = { 수입: [], 지출: [] };
    (hh.cats || []).forEach(r => {
      const t = String(r[0] || '').trim();
      if (H.cats[t] && String(r[1] || '').trim()) H.cats[t].push({ name: String(r[1]).trim(), subs: String(r[2] || '').split('|').map(s => s.trim()).filter(Boolean) });
    });
    H.assets = (hh.assets || []).map(r => ({ group: String(r[0] || '기타').trim() || '기타', name: String(r[1] || '').trim(), hidden: String(r[2] || '').trim().toUpperCase() === 'Y', memo: String(r[3] || ''), link: String(r[4] || '').trim() })).filter(a => a.name);
    H.budgets = parseBudgets(hh.budgets);
    H.rules = (hh.rules || []).map(toRule).filter(r => r.id);
    H.memos = (hh.memos || []).map(toMemo).filter(m => m.id);
    H.pending.forEach((t, id) => { if (!H.tx.some(x => x.id === id)) H.tx.push(t); });
    reindex();
  }

  function reindex() {
    H.tx.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : a.id < b.id ? 1 : -1));
    H.byId = new Map(H.tx.map(t => [t.id, t]));
    H.byYm = new Map();
    H.tx.forEach(t => { let l = H.byYm.get(t.ym); if (!l) H.byYm.set(t.ym, (l = [])); l.push(t); });
    const names = new Set(H.assets.map(a => a.name));
    H.link = new Map(H.assets.filter(a => a.link && a.link !== a.name && names.has(a.link)).map(a => [a.name, a.link]));
    H.inv = new Set(H.assets.filter(a => a.link === INVLINK).map(a => a.name));
    H.bal = new Map();
    H.tx.forEach(t => applyBal(H.bal, t));
  }
  // 투자 앱과 연결된 자산(투자 계좌): 가계부에는 보낸 돈·찾은 돈만 남고, 금액은 투자 앱의 원금을 그대로 씀
  const INVLINK = '투자앱';
  const invTotal = () => (D.invTotal ? D.invTotal() : null);
  const assetVal = n => (H.inv.has(n) ? (invTotal() ? invTotal().cost : 0) : (H.bal.get(n) || 0));
  // 체크카드처럼 결제 계좌가 연결된 자산은 그 계좌의 잔액으로 계산
  const eff = a => H.link.get(a) || a;
  function applyBal(m, t) {
    const add = (a, v) => { a = eff(a); m.set(a, (m.get(a) || 0) + v); };
    if (t.type === '수입') add(t.asset, t.amt);
    else if (t.type === '지출') add(t.asset, -t.amt);
    else if (t.type === '이체') { add(t.asset, -t.amt); add(t.to, t.amt); }
    else add(t.asset, t.amt);
  }
  // 이 자산 기준으로 들어오면 +, 나가면 −
  function flowFor(t, a, raw = false) {
    const A = raw ? t.asset : eff(t.asset), T = raw ? t.to : eff(t.to);
    if (t.type === '수입') return A === a ? t.amt : 0;
    if (t.type === '지출') return A === a ? -t.amt : 0;
    if (t.type === '이체') return (T === a ? t.amt : 0) - (A === a ? t.amt : 0);
    return A === a ? t.amt : 0;
  }
  const nwDelta = t => (t.type === '수입' ? t.amt : t.type === '지출' ? -t.amt : t.type === '수정' ? t.amt : 0);
  const monthTx = ym => H.byYm.get(ym) || [];
  function sums(list) {
    let inc = 0, exp = 0;
    list.forEach(t => { if (t.type === '수입') inc += t.amt; else if (t.type === '지출') exp += t.amt; });
    return { inc, exp, net: inc - exp };
  }
  const inRange = (from, to) => H.tx.filter(t => t.d >= from && t.d <= to);
  const assetNames = () => H.assets.map(a => a.name);

  let cacheT = 0;
  function saveCache() {
    clearTimeout(cacheT);
    cacheT = setTimeout(() => {
      try {
        store.set(CACHE, JSON.stringify({ tx: H.tx.filter(t => !H.pending.has(t.id)).map(txArr), cats: catsArr(), assets: assetsArr(), rules: H.rules.map(ruleArr), memos: H.memos.map(m => [m.id, m.date, m.text, m.by]), budgets: budgetsArr() }));
      } catch { /* 저장 공간 부족 등은 무시 */ }
    }, 400);
  }
  function loadCache() {
    try { const c = JSON.parse(store.get(CACHE) || 'null'); if (c && c.tx) { ingest(c); H.loaded = true; return true; } } catch { /* 손상된 캐시 무시 */ }
    return false;
  }

  async function load({ quiet = true } = {}) {
    if (H.loading) return;
    H.loading = true; D.spin(true);
    try {
      const j = await D.api('hh');
      if (!j.hh || !j.hh.ready) { H.ready = false; H.loaded = true; render(); return; }
      H.ready = true;
      ingest(j.hh); H.loaded = true; saveCache();
      const y = window.scrollY; render(); window.scrollTo({ top: y });
      refreshPages();
      if (j.hh.made) toast(`매월 반복 내역 ${j.hh.made}건을 자동으로 넣었습니다`);
      else if (!quiet) toast('가계부를 새로 불러왔습니다');
    } catch (e) {
      if (e.code === 'auth') { D.logout('비밀번호를 다시 입력하십시오.'); return; }
      toast(`가계부 불러오기 실패: ${e.message}`, true);
      if (!H.loaded) render();
    } finally { H.loading = false; D.spin(false); }
  }

  /* ───────────── 화면 틀 ───────────── */
  function setTopH() { const tb = $('.topbar'); if (tb) document.documentElement.style.setProperty('--topbar-h', `${tb.offsetHeight}px`); }

  function render() {
    if (!H.active) return;
    $$('.hh-view').forEach(v => { v.hidden = v.id !== `hh-${H.view}`; });
    $$('#hhTabs .htab').forEach(t => t.classList.toggle('active', t.dataset.hv === H.view));
    $('#hhFab').hidden = H.view !== 'book';
    renderHead();
    if (!H.loaded) { $(`#hh-${H.view}`).innerHTML = '<div class="skeleton"></div><div class="skeleton" style="height:320px"></div>'; return; }
    if (!H.ready) {
      $(`#hh-${H.view}`).innerHTML = `<div class="card"><p class="empty">구글 시트에 <b>가계부</b> 탭이 아직 없습니다.<br>보내드린 가져오기 파일을 시트에 넣은 뒤<br>새로고침하십시오.</p></div>`;
      $('#hhFab').hidden = true;
      return;
    }
    ({ book: renderBook, stats: renderStats, assets: renderAssets, more: renderMore })[H.view]();
    setTopH();
  }

  function renderHead() {
    const head = $('#hhHead');
    let title = '', nav = false, month = null;
    if (H.view === 'book') {
      nav = true;
      if (H.btab === 'month') title = `${H.ym.slice(0, 4)}년`; else { title = ymLabel(H.ym); month = H.ym; }
    } else if (H.view === 'stats') {
      const p = H.st.period, a = H.st.anchor;
      if (p === 'month') { title = ymLabel(a.slice(0, 7)); nav = true; month = a.slice(0, 7); }
      else if (p === 'year') { title = `${a.slice(0, 4)}년`; nav = true; }
      else if (p === 'week') { const [f, t] = statRange(); title = `${mdLabel(f)} ~ ${mdLabel(t)}`; nav = true; }
      else if (p === 'cmp') title = `${H.cmp.type} 비교`;
      else title = '기간 통계';
    } else title = H.view === 'assets' ? '자산' : '더보기';
    head.innerHTML = nav
      ? `<button class="hh-arrow" data-mv="-1" aria-label="이전">${ico.left}</button>
         <label class="hh-title">${title}${month ? `<input type="month" id="hhMonthPick" value="${month}" aria-label="달 고르기">` : ''}</label>
         <button class="hh-arrow" data-mv="1" aria-label="다음">${ico.right}</button>`
      : `<span class="hh-title static">${title}</span>`;
    $$('.hh-arrow', head).forEach(b => b.onclick = () => moveHead(Number(b.dataset.mv)));
    pickerOnTap(head);
    const mp = $('#hhMonthPick');
    if (mp) mp.onchange = () => { if (!/^\d{4}-\d{2}$/.test(mp.value)) return; if (H.view === 'book') setYm(mp.value); else { H.st.anchor = `${mp.value}-01`; render(); } };
  }
  function moveHead(k) {
    if (H.view === 'book') { setYm(addMonths(H.ym, H.btab === 'month' ? 12 * k : k)); return; }
    const p = H.st.period, a = H.st.anchor;
    if (p === 'month') H.st.anchor = `${addMonths(a.slice(0, 7), k)}-01`;
    else if (p === 'year') H.st.anchor = `${+a.slice(0, 4) + k}-01-01`;
    else if (p === 'week') H.st.anchor = addDays(a, 7 * k);
    window.scrollTo({ top: 0 }); render();
  }
  function setYm(ym) { H.ym = ym; sess.set('dh_hym', ym); window.scrollTo({ top: 0 }); render(); }
  function goView(v) {
    H.view = v; sess.set('dh_hview', v);
    window.scrollTo({ top: 0 }); render();
    requestAnimationFrame(() => { const y = Number(sess.get(`dh_scroll_hh_${v}`)) || 0; if (y) window.scrollTo({ top: y }); });
  }

  /* ───────────── 가계부 탭 ───────────── */
  function sumBar({ inc, exp, net }) {
    return `<div class="hh-sum num">
      <div><span>수입</span><b class="inc">${fmt(inc)}</b></div>
      <div><span>지출</span><b class="exp">${fmt(exp)}</b></div>
      <div><span>합계</span><b>${net < 0 ? '−' : ''}${fmt(Math.abs(net))}</b></div>
    </div>`;
  }
  function renderBook() {
    const tabs = [['daily', '일일'], ['close', '결산'], ['memo', '메모'], ['month', '월별']];
    const list = monthTx(H.ym);
    let body = '', sum = '';
    if (H.btab === 'month') {
      const y = H.ym.slice(0, 4);
      sum = sumBar(sums(H.tx.filter(t => t.d.startsWith(y))));
      body = monthsHtml(y);
    } else if (H.btab === 'memo') body = memoHtml(H.ym);
    else {
      sum = sumBar(sums(list));
      body = H.btab === 'daily' ? dailyHtml(list) : closeHtml(H.ym);
    }
    $('#hh-book').innerHTML = `
      <div class="hh-sticky">
        <div class="hh-tabs" role="tablist">${tabs.map(([k, n]) => `<button role="tab" data-bt="${k}" class="${H.btab === k ? 'on' : ''}" aria-selected="${H.btab === k}">${n}</button>`).join('')}</div>
        ${sum}
      </div>
      <div class="hh-body">${body}</div>`;
    $$('#hh-book [data-bt]').forEach(b => b.onclick = () => { H.btab = b.dataset.bt; sess.set('dh_hbtab', H.btab); window.scrollTo({ top: 0 }); render(); });
    bindRows($('#hh-book'));
    if (H.btab === 'close') {
      $$('#hh-book [data-bcat]').forEach(r => r.onclick = () => {
        const k = r.dataset.bcat;
        if (k.startsWith('__all__|')) {
          // 전체예산: 하나라도 접혀 있으면 모두 펼치고, 모두 펼쳐져 있으면 모두 접음
          const names = k.split('|').slice(1), allOpen = names.every(n => !H.budClosed.has(n));
          names.forEach(n => (allOpen ? H.budClosed.add(n) : H.budClosed.delete(n)));
        } else H.budClosed.has(k) ? H.budClosed.delete(k) : H.budClosed.add(k);
        store.set('dh_hbud_closed', JSON.stringify([...H.budClosed]));
        const y = window.scrollY; render(); window.scrollTo({ top: y });
      });
      const bs = $('#hhBudSet'); if (bs) bs.onclick = () => openBudgetSettings();
    }
    if (H.btab === 'month') {
      $$('#hh-book .hm-row').forEach(r => r.onclick = () => { const k = r.dataset.ym; H.openMonths.has(k) ? H.openMonths.delete(k) : H.openMonths.add(k); render(); });
      $$('#hh-book [data-goym]').forEach(b => b.onclick = e => { e.stopPropagation(); H.btab = 'daily'; sess.set('dh_hbtab', 'daily'); setYm(b.dataset.goym); });
    }
    if (H.btab === 'memo') $$('#hh-book .hm-memo').forEach(m => m.onclick = () => openMemo(H.memos.find(x => x.id === m.dataset.id)));
  }

  function emptyHtml(a, b = '') { return `<div class="card"><p class="empty">${a}${b ? `<br><span class="sub">${b}</span>` : ''}</p></div>`; }

  function rowHtml(t, { balAfter = null, forAsset = null, showDate = false, raw = false } = {}) {
    let left, cls = '', amtTxt;
    if (t.type === '이체') { left = `<span class="hr-cat">이체</span>${t.invType ? `<small class="hr-invs">투자 앱 ${esc(t.invType)}</small>` : ''}`; cls = 'tr'; }
    else if (t.type === '수정') { left = `<span class="hr-cat">잔액수정</span>${t.invType === '비용' ? `<small class="hr-invs">투자 비용</small>` : ''}`; cls = 'adj'; }
    else { left = `<span class="hr-cat">${esc(t.cat || '미분류')}</span>${t.sub ? `<small>${esc(t.sub)}</small>` : ''}`; cls = t.type === '수입' ? 'inc' : 'exp'; }
    if (forAsset) {
      const f = flowFor(t, forAsset, raw);
      amtTxt = swon(f); cls = f > 0 ? 'inc' : f < 0 ? 'exp' : '';
    } else if (t.cur && t.famt !== '') amtTxt = `${t.cur === 'USD' ? 'US$' : t.cur} ${Number(t.famt).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    else if (t.type === '수정') amtTxt = swon(t.amt);
    else amtTxt = won(t.amt);
    const where = t.type === '이체' ? `${esc(t.asset)} → ${esc(t.to)}` : esc(t.asset);
    const meta = [showDate ? `${mdLabel(t.d)}(${WD[wdOf(t.d)]})` : '', tmLabel(t.tm), where].filter(Boolean).join('&nbsp;&nbsp;') + (t.rule ? ' <i class="hr-rep">(매월)</i>' : '');
    const title = t.text || (t.type === '이체' ? '이체' : t.sub || t.cat || '');
    return `<button class="hr ${H.pending.has(t.id) ? 'pending' : ''}" data-tx="${esc(t.id)}">
      <span class="hr-l">${left}</span>
      <span class="hr-m"><span class="hr-t">${esc(title)}</span><span class="hr-s">${meta}</span></span>
      <span class="hr-r"><b class="num ${cls}">${amtTxt}</b>${balAfter !== null ? `<small class="num">${won(balAfter)}</small>` : ''}</span>
    </button>`;
  }
  function dayHead(ds, list) {
    const s = list ? sums(list) : null, w = wdOf(ds);
    return `<div class="hd-head">
      <b class="hd-d">${+ds.slice(8, 10)}</b><span class="hd-w w${w}">${WD[w]}요일</span><span class="hd-ym">${ds.slice(0, 4)}.${ds.slice(5, 7)}</span>
      <span class="hd-sp"></span>${s ? `<span class="num inc">${won(s.inc)}</span><span class="num exp">${won(s.exp)}</span>` : ''}
    </div>`;
  }
  function groupByDay(list) {
    const m = new Map();
    list.forEach(t => { let l = m.get(t.d); if (!l) m.set(t.d, (l = [])); l.push(t); });
    return m;
  }
  function dailyHtml(list) {
    if (!list.length) return emptyHtml('이 달에는 내역이 없습니다.', '오른쪽 아래 + 버튼으로 입력하십시오.');
    return [...groupByDay(list)].map(([ds, l]) => `<section class="card hd">${dayHead(ds, l)}${l.map(t => rowHtml(t)).join('')}</section>`).join('');
  }
  function bindRows(root) {
    $$('.hr[data-tx]', root).forEach(r => r.onclick = () => { const t = H.byId.get(r.dataset.tx); if (t) openForm({ tx: t }); });
  }

  function weeksOf(ym) {
    const n = daysIn(ym), out = [];
    let s = 1;
    while (s <= n) {
      const dow = parseD(`${ym}-${pad(s)}`).getDay();
      const e = Math.min(n, s + (6 - dow));
      out.push([`${ym}-${pad(s)}`, `${ym}-${pad(e)}`]);
      s = e + 1;
    }
    return out;
  }
  function monthsHtml(y) {
    const cur = ymOf(new Date());
    const months = [];
    for (let m = 12; m >= 1; m--) {
      const ym = `${y}-${pad(m)}`;
      if (ym > cur && !monthTx(ym).length) continue;
      months.push(ym);
    }
    if (!months.length) return emptyHtml('이 해에는 내역이 없습니다.');
    if (!H.openInit.has(y)) { H.openInit.add(y); H.openMonths.add(months[0]); }
    return `<div class="card hm">${months.map(ym => {
      const s = sums(monthTx(ym)), open = H.openMonths.has(ym);
      const wk = open ? `<div class="hm-weeks">${weeksOf(ym).map(([a, b]) => {
        const ws = sums(monthTx(ym).filter(t => t.d >= a && t.d <= b));
        return `<div class="hm-week"><span>${mdLabel(a)} ~ ${mdLabel(b)}</span><span class="num inc">${fmt(ws.inc)}</span><span class="num exp">${fmt(ws.exp)}</span><span class="num">${ws.net < 0 ? '−' : ''}${fmt(Math.abs(ws.net))}</span></div>`;
      }).join('')}<button class="link-btn" data-goym="${ym}">${+ym.slice(5)}월 내역 보기 ›</button></div>` : '';
      return `<div class="hm-item ${open ? 'open' : ''}"><button class="hm-row" data-ym="${ym}" aria-expanded="${open}">
        <span class="hm-m"><b>${+ym.slice(5)}월</b><small>${mdLabel(ym + '-01')} ~ ${mdLabel(`${ym}-${daysIn(ym)}`)}</small></span>
        <span class="num inc">${fmt(s.inc)}</span><span class="num exp">${fmt(s.exp)}</span><span class="num">${s.net < 0 ? '−' : ''}${fmt(Math.abs(s.net))}</span>
      </button>${wk}</div>`;
    }).join('')}</div>`;
  }

  function barRows(rows, total, color, sel) {
    const mx = Math.max(...rows.map(r => Math.abs(r.v)), 1);
    return rows.map(r => `<div class="hb-row ${sel === undefined ? '' : `tap ${sel === r.k ? 'on' : sel ? 'dim' : ''}`}" ${sel === undefined ? '' : `data-sub="${esc(r.k)}" role="button" tabindex="0" aria-pressed="${sel === r.k}"`}><div class="hb-top"><span>${esc(r.k)}${r.n ? ` <small>${r.n}건</small>` : ''}</span><b class="num">${won(r.v)}${total ? ` <small>${Math.round(r.v / total * 100)}%</small>` : ''}</b></div>
      <div class="hb-meter"><i style="width:${Math.max(1.5, Math.abs(r.v) / mx * 100)}%;background:${r.c || color}"></i></div></div>`).join('');
  }
  // 결산 = 예산 대비 지출 (편한가계부와 같은 모양) + 자산별 수입·지출
  const curYm = () => ymOf(new Date());
  // 그 달의 기본예산 (월을 비우면 가장 최근에 정한 기본예산)
  function baseOf(cat, sub, ym = null) {
    const e = H.budgets.get(BK(cat, sub)); if (!e) return 0;
    let v = 0; e.base.forEach(b => { if (ym === null || !b.from || b.from <= ym) v = b.amt; });
    return v;
  }
  function budgetOf(cat, sub, ym = curYm()) {
    const e = H.budgets.get(BK(cat, sub)); if (!e) return 0;
    return e.months.has(ym) ? e.months.get(ym) : baseOf(cat, sub, ym);
  }
  function catBudget(c, ym = curYm()) {
    const own = budgetOf(c.name, '', ym);
    return own > 0 ? own : c.subs.reduce((a, s) => a + budgetOf(c.name, s, ym), 0);
  }
  function catBase(c) {
    const own = baseOf(c.name, '');
    return own > 0 ? own : c.subs.reduce((a, s) => a + baseOf(c.name, s), 0);
  }
  function budRow(name, b, spent, { kind = 'cat', marker = null, toggle = null, open = true } = {}) {
    const pct = b > 0 ? spent / b : Infinity, over = spent > b, rem = b - spent;
    const pTxt = !Number.isFinite(pct) || pct > 9.99 ? '-' : `${Math.floor(pct * 100)}%`;
    const fill = Math.min(100, (Number.isFinite(pct) ? pct : 1) * 100);
    const tg = toggle ? `data-bcat="${esc(toggle)}" role="button" tabindex="0" aria-expanded="${open}"` : '';
    return `<div class="bud ${kind}" ${tg}>
      <div class="bud-l"><span class="bud-n"><span>${esc(name)}</span>${toggle ? `<i class="bud-chev ${open ? 'open' : ''}">${ico.chev}</i>` : ''}</span><b class="num">${won(b)}</b></div>
      <div class="bud-r">
        <div class="bud-bar ${over ? 'over' : ''}"><i style="width:${fill.toFixed(1)}%"></i>${marker !== null ? `<s style="left:${(marker * 100).toFixed(1)}%"></s>${kind === 'top' ? `<span class="bud-today" style="left:${(marker * 100).toFixed(1)}%">오늘</span>` : ''}` : ''}<em class="num ${fill >= 96 ? 'in' : ''}">${pTxt}</em></div>
        <div class="bud-v num"><span class="${over ? 'exp' : 'inc'}">${won(spent)}</span><span>${rem < 0 ? `초과 −${fmt(-rem)}원` : won(rem)}</span></div>
      </div>
    </div>`;
  }
  function closeHtml(ym) {
    const list = monthTx(ym), exp = list.filter(t => t.type === '지출');
    const byCat = new Map(), bySub = new Map();
    exp.forEach(t => { byCat.set(t.cat, (byCat.get(t.cat) || 0) + t.amt); bySub.set(BK(t.cat, t.sub), (bySub.get(BK(t.cat, t.sub)) || 0) + t.amt); });
    const total = exp.reduce((a, t) => a + t.amt, 0);
    const cur = ymOf(new Date());
    const marker = ym === cur ? new Date().getDate() / daysIn(ym) : null;
    const rows = [];
    let tb = 0;
    const togg = [];
    H.cats['지출'].forEach(c => {
      const b = catBudget(c, ym);
      if (!(b > 0)) return;
      tb += b;
      const subs = c.subs.filter(s => budgetOf(c.name, s, ym) > 0);
      const open = !H.budClosed.has(c.name);
      if (subs.length) togg.push(c.name);
      rows.push(budRow(c.name, b, byCat.get(c.name) || 0, { kind: 'cat', marker, toggle: subs.length ? c.name : null, open }));
      if (subs.length && open) subs.forEach(s => rows.push(budRow(s, budgetOf(c.name, s, ym), bySub.get(BK(c.name, s)) || 0, { kind: 'sub', marker })));
    });
    const budget = rows.length
      ? budRow('전체예산', tb, total, { kind: 'top', marker, toggle: togg.length ? `__all__|${togg.join('|')}` : null, open: togg.length > 0 && togg.every(n => !H.budClosed.has(n)) }) + rows.join('')
      : `<p class="empty">예산이 없습니다.<br><span class="sub">예산설정에서 분류별 한 달 예산을 넣으십시오.</span></p>`;
    // 자산별 수입·지출 (체크카드는 카드 이름 그대로)
    const byAsset = new Map();
    list.forEach(t => {
      if (t.type !== '수입' && t.type !== '지출') return;
      const r = byAsset.get(t.asset) || { k: t.asset, inc: 0, exp: 0 };
      if (t.type === '수입') r.inc += t.amt; else r.exp += t.amt;
      byAsset.set(t.asset, r);
    });
    const as = [...byAsset.values()].sort((a, b) => b.exp - a.exp || b.inc - a.inc);
    return `
      <section class="card hbud">
        <div class="hbud-head"><b>예산</b><button class="hbud-set" id="hhBudSet">예산설정 ${ico.chev}</button></div>
        ${budget}
      </section>
      <section class="card hbud-as">
        <div class="hbud-head"><b>자산</b><span class="num">${ym.slice(2, 4)}.${+ym.slice(5)}.1 ~ ${ym.slice(2, 4)}.${+ym.slice(5)}.${daysIn(ym)}</span></div>
        ${as.length ? `<div class="has-row head"><span>자산</span><span>수입</span><span>지출</span></div>${as.map(r => `<div class="has-row"><span>${esc(r.k)}</span><b class="num inc">${fmt(r.inc)}</b><b class="num exp">${fmt(r.exp)}</b></div>`).join('')}` : '<p class="empty">이 달에는 수입·지출이 없습니다.</p>'}
      </section>`;
  }

  function memoHtml(ym) {
    const list = H.memos.filter(m => m.date.startsWith(ym)).sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!list.length) return emptyHtml('이 달에는 메모가 없습니다.', '+ 버튼으로 메모를 남기십시오.');
    return list.map(m => {
      const [first, ...rest] = m.text.split('\n');
      return `<button class="card hm-memo" data-id="${esc(m.id)}"><span class="hm-date">${mdLabel(m.date)} (${WD[wdOf(m.date)]})${m.by ? ` · ${esc(m.by)}` : ''}</span>
        <b>${esc(first)}</b>${rest.length ? `<span class="hm-text">${esc(rest.join('\n'))}</span>` : ''}</button>`;
    }).join('');
  }

  /* ───────────── 통계 탭 ───────────── */
  function statRange() {
    const { period: p, anchor: a } = H.st;
    if (p === 'week') { const s = addDays(a, -wdOf(a)); return [s, addDays(s, 6)]; }
    if (p === 'month') { const ym = a.slice(0, 7); return [`${ym}-01`, `${ym}-${pad(daysIn(ym))}`]; }
    if (p === 'year') return [`${a.slice(0, 4)}-01-01`, `${a.slice(0, 4)}-12-31`];
    return H.st.from <= H.st.to ? [H.st.from, H.st.to] : [H.st.to, H.st.from];
  }
  function catTotals(list, type) {
    const m = new Map();
    list.filter(t => t.type === type).forEach(t => { const k = t.cat || '미분류'; m.set(k, (m.get(k) || 0) + t.amt); });
    const order = H.cats[type].map(c => c.name);
    return [...m].map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v || order.indexOf(a.k) - order.indexOf(b.k));
  }
  /* ── 연도 비교 (수입·지출, 대분류, 합계/월평균) ── */
  const YC = ['#3b82f6', '#22c55e', '#f5a524'];
  function monthsOf(y) { const n = new Date(), cy = n.getFullYear(); return y < cy ? 12 : y === cy ? n.getMonth() + 1 : 12; }
  function cmpData(type) {
    const tot = new Map(), mon = new Map(), years = new Set();
    H.tx.forEach(t => {
      if (t.type !== type) return;
      const y = +t.d.slice(0, 4), m = +t.d.slice(5, 7), c = t.cat || '미분류';
      years.add(y);
      [c, '__all'].forEach(k => { tot.set(`${y}|${k}`, (tot.get(`${y}|${k}`) || 0) + t.amt); mon.set(`${y}|${m}|${k}`, (mon.get(`${y}|${m}|${k}`) || 0) + t.amt); });
    });
    return { tot, mon, years: [...years].sort() };
  }
  function saveCmp() { store.set('dh_hcmp', JSON.stringify({ type: H.cmp.type, years: H.cmp.years, cats: H.cmp.cats, avg: H.cmp.avg, mode: H.cmp.mode })); }
  // 대분류 여러 개 고르기 창
  function pickCats(list, cur, nameOf) {
    return new Promise(res => {
      let sel = new Set(cur);
      const draw = () => {
        $('#sheetBody .sel-list').innerHTML = list.map(c => `<button class="${sel.has(c) ? 'on' : ''}" data-mc="${esc(c)}"><span>${esc(nameOf(c))}</span><b>${sel.has(c) ? '✓' : ''}</b></button>`).join('');
        $('#mcCount').textContent = `${sel.size}개 선택`;
        $$('#sheetBody [data-mc]').forEach(b => b.onclick = () => { const k = b.dataset.mc; sel.has(k) ? sel.delete(k) : sel.add(k); draw(); });
      };
      D.openSheet(`<div class="ask"><h2 id="sheetTitle">대분류 고르기</h2><p class="note ask-note" id="mcCount"></p><div class="sel-list"></div>
        <div class="sheet-actions two"><button class="btn" id="mcClr">모두 해제</button><button class="btn primary" id="mcOk">완료</button></div></div>`, 'pop');
      let done = false;
      const fin = v => { if (done) return; done = true; obs.disconnect(); res(v); };
      const sh = $('#sheet');
      const obs = new MutationObserver(() => { if (!sh.classList.contains('open') || sh.hidden) fin(null); });
      setTimeout(() => obs.observe(sh, { attributes: true, attributeFilter: ['class', 'hidden'] }), 60);
      $('#mcClr').onclick = () => { sel = new Set(); draw(); };
      $('#mcOk').onclick = () => { fin(list.filter(c => sel.has(c))); D.closeSheet(); };
      draw();
    });
  }
  function renderCmp() {
    const C = H.cmp, D0 = cmpData(C.type);
    if (!C.years.length) C.years = D0.years.slice(-3);
    C.years = C.years.filter(y => D0.years.includes(y)).sort();
    const catList = ['__all', ...(H.cats[C.type] || []).map(c => c.name)];
    C.cats = C.cats.filter(c => catList.includes(c)); if (!C.cats.length) C.cats = ['__all'];
    const cn = k => (k === '__all' ? `전체 ${C.type}` : k === '__sel' ? '선택 합산' : k);
    const keysOf = k => (k !== '__sel' ? [k] : C.cats.includes('__all') ? ['__all'] : C.cats);   // 합쳐 보기: 고른 대분류의 합 (전체가 있으면 전체만)
    const totOf = (y, k) => keysOf(k).reduce((a, x) => a + (D0.tot.get(`${y}|${x}`) || 0), 0);
    const monOf = (y, m, k) => keysOf(k).reduce((a, x) => a + (D0.mon.get(`${y}|${m}|${x}`) || 0), 0);
    const val = (y, k) => { const v = totOf(y, k); return C.avg ? v / monthsOf(y) : v; };
    const shown = C.mode === 'sum' && C.cats.length > 1 ? ['__sel'] : C.cats;
    const catSummary = C.cats.length ? `${cn(C.cats[0])}${C.cats.length > 1 ? ` 외 ${C.cats.length - 1}개` : ''}` : '고르기';
    const modeSeg = `<span class="cm-pill"><button data-mode="each" class="${C.mode !== 'sum' ? 'on' : ''}">개별</button><button data-mode="sum" class="${C.mode === 'sum' ? 'on' : ''}">합산</button></span>`;
    const pill = `<span class="cm-pill"><button data-avg="0" class="${C.avg ? '' : 'on'}">합계</button><button data-avg="1" class="${C.avg ? 'on' : ''}">월평균</button></span>`;
    let body;
    if (C.trend) {
      const k = C.trend, ys = C.years;
      const ser = ys.map(y => Array.from({ length: y === new Date().getFullYear() ? monthsOf(y) : 12 }, (_, i) => monOf(y, i + 1, k)));
      const mx = Math.max(1, ...ser.flat());
      const W = 340, Hh = 200, L = 40, R = 8, T = 12, B = 22, x = i => L + i * (W - L - R) / 11, yv = v => T + (1 - v / mx) * (Hh - T - B);
      const grid = [0, 0.5, 1].map(f => `<line x1="${L}" x2="${W - R}" y1="${yv(mx * f)}" y2="${yv(mx * f)}" class="cm-grid"/><text x="${L - 6}" y="${yv(mx * f) + 4}" text-anchor="end" class="cm-ax">${compactWon(mx * f)}</text>`).join('');
      const xs = Array.from({ length: 12 }, (_, i) => `<text x="${x(i)}" y="${Hh - 6}" text-anchor="middle" class="cm-ax">${i + 1}</text>`).join('');
      const lines = ser.map((a, j) => `<polyline points="${a.map((v, i) => `${x(i).toFixed(1)},${yv(v).toFixed(1)}`).join(' ')}" fill="none" stroke="${YC[j]}" stroke-width="2.6" stroke-linejoin="round"/>${C.sel != null && C.sel < a.length ? `<circle cx="${x(C.sel)}" cy="${yv(a[C.sel])}" r="4" fill="${YC[j]}"/>` : ''}`).join('');
      const hits = Array.from({ length: 12 }, (_, i) => `<rect x="${x(i) - 13}" y="0" width="26" height="${Hh}" fill="transparent" data-mi="${i}"/>`).join('');
      const selRow = C.sel != null ? `<div class="cm-selm"><b>${C.sel + 1}월</b>${ys.map((y, j) => `<span><i style="background:${YC[j]}"></i>${y} <b class="num">${C.sel < ser[j].length ? won(ser[j][C.sel]) : '—'}</b></span>`).join('')}</div>` : '<p class="note cm-tip">그래프를 누르면 그 달 금액이 연도별로 나옵니다.</p>';
      body = `<button class="cm-back" id="cmBack">${ico.left}<span>연도 비교로 돌아가기</span></button>
        <div class="cm-chips">${(C.mode === 'sum' && C.cats.length > 1 ? ['__sel', ...C.cats] : C.cats).map(c => `<button class="${c === k ? 'on' : ''}" data-tk="${esc(c)}">${esc(cn(c))}</button>`).join('')}</div>
        ${k === '__sel' ? `<p class="note cm-tip">${esc(C.cats.map(cn).join(' + '))}</p>` : ''}
        <div class="cm-legend">${ys.map((y, j) => `<span><i style="background:${YC[j]}"></i>${y}</span>`).join('')}</div>
        <div class="card cm-chart"><svg viewBox="0 0 ${W} ${Hh}" width="100%">${grid}${xs}${lines}${C.sel != null ? `<line x1="${x(C.sel)}" x2="${x(C.sel)}" y1="${T}" y2="${Hh - B}" class="cm-cur"/>` : ''}${hits}</svg>${selRow}</div>
        <div class="card cm-sum">${ys.map((y, j) => `<div class="cm-sr"><span><i style="background:${YC[j]}"></i>${y}${y === new Date().getFullYear() ? ` <small>(${monthsOf(y)}월까지)</small>` : ''}</span><span><b class="num">${won(totOf(y, k))}</b><small class="num">월평균 ${won(totOf(y, k) / monthsOf(y))}</small></span></div>`).join('')}</div>`;
    } else {
      const blocks = shown.map(k => {
        const vs = C.years.map(y => val(y, k)), mx = Math.max(1, ...vs);
        const n = vs.length, ch = n >= 2 && vs[n - 2] ? (vs[n - 1] - vs[n - 2]) / vs[n - 2] : null;
        const good = C.type === '수입' ? ch > 0 : ch < 0;
        return `<button class="cm-blk" data-trend="${esc(k)}"><div class="cm-bt"><b>${esc(cn(k))}${k === '__sel' ? `<small>${esc(C.cats.map(cn).join(' + '))}</small>` : ''}</b>${ch != null ? `<em class="${good ? 'good' : 'bad'}">${String(C.years[n - 2]).slice(2)}→${String(C.years[n - 1]).slice(2)} ${ch >= 0 ? '+' : '−'}${Math.abs(ch * 100).toFixed(1)}%</em>` : ''}${ico.chev}</div>
          ${C.years.map((y, j) => `<div class="cm-bar"><span>${String(y).slice(2)}</span><i style="width:${Math.max(1.5, vs[j] / mx * 100)}%;background:${YC[j]}"></i><b class="num">${fmt(vs[j])}</b></div>`).join('')}</button>`;
      }).join('');
      body = `<div class="cm-lb">연도 <small>최대 3개</small></div>
        <div class="cm-chips">${D0.years.map(y => { const j = C.years.indexOf(y); return `<button class="${j >= 0 ? 'on y' : ''}" style="${j >= 0 ? `--yc:${YC[j]}` : ''}" data-y="${y}">${y}</button>`; }).join('')}</div>
        <button class="adj-catbtn cm-catbtn" id="cmCats"><small>대분류</small><b>${esc(catSummary)}</b>${ico.chev}</button>
        <div class="cm-head"><span>보기</span>${modeSeg}</div>
        <div class="cm-head"><span>금액</span>${pill}</div>
        ${C.years.length ? `<div class="card cm-card">${blocks}</div>` : emptyHtml(`${C.type} 내역이 없습니다.`)}
        <p class="note">대분류를 누르면 월별 추이를 연도별로 겹쳐 봅니다.<br>올해는 지난 개월 수로 월평균을 냅니다.</p>`;
    }
    $('#hh-stats').innerHTML = `
      <div class="hh-sticky">
        <div class="seg hh-pseg" role="group" aria-label="기간 단위">${[['month', '월간'], ['year', '연간'], ['range', '기간'], ['cmp', '비교']].map(([k, n]) => `<button data-p="${k}" class="${H.st.period === k ? 'on' : ''}">${n}</button>`).join('')}</div>
        <div class="hh-tabs two" role="tablist"><button data-ct="수입" class="${C.type === '수입' ? 'on' : ''}">수입</button><button data-ct="지출" class="${C.type === '지출' ? 'on' : ''}">지출</button></div>
      </div>${body}`;
    const R = () => { saveCmp(); render(); };
    $$('#hh-stats [data-p]').forEach(b => b.onclick = () => { H.st.period = b.dataset.p; store.set('dh_hst_p', H.st.period); render(); });
    $$('#hh-stats [data-ct]').forEach(b => b.onclick = () => { if (C.type === b.dataset.ct) return; C.type = b.dataset.ct; C.cats = ['__all']; C.trend = null; C.sel = null; R(); });
    $$('#hh-stats [data-avg]').forEach(b => b.onclick = () => { C.avg = b.dataset.avg === '1'; R(); });
    $$('#hh-stats [data-y]').forEach(b => b.onclick = () => { const y = +b.dataset.y; if (C.years.includes(y)) { if (C.years.length > 1) C.years = C.years.filter(x => x !== y); } else if (C.years.length >= 3) { toast('연도는 3개까지 고를 수 있습니다'); return; } else C.years.push(y); R(); });
    const cb = $('#cmCats'); if (cb) cb.onclick = async () => { const v = await pickCats(catList, C.cats, cn); if (v) { C.cats = v.length ? v : ['__all']; R(); } };
    $$('#hh-stats [data-mode]').forEach(b => b.onclick = () => { C.mode = b.dataset.mode; R(); });
    $$('#hh-stats [data-trend]').forEach(b => b.onclick = () => { C.trend = b.dataset.trend; C.sel = null; window.scrollTo({ top: 0 }); render(); });
    $$('#hh-stats [data-tk]').forEach(b => b.onclick = () => { C.trend = b.dataset.tk; render(); });
    $$('#hh-stats [data-mi]').forEach(b => b.onclick = () => { const i = +b.dataset.mi; C.sel = C.sel === i ? null : i; render(); });
    const bk = $('#cmBack'); if (bk) bk.onclick = () => { C.trend = null; C.sel = null; render(); };
  }

  function renderStats() {
    if (H.st.period === 'cmp') { renderCmp(); return; }
    const [from, to] = statRange();
    const list = inRange(from, to), s = sums(list), type = H.st.type;
    const items = catTotals(list, type).map((x, i) => ({ ...x, c: COLORS[i % COLORS.length] }));
    const total = type === '수입' ? s.inc : s.exp;
    const P = [['month', '월간'], ['year', '연간'], ['range', '기간'], ['cmp', '비교']];
    const yr = H.st.period === 'year', av = yr && H.st.avg, dv = yr ? monthsOf(+from.slice(0, 4)) : 1;
    const sv = v => (av ? v / dv : v);
    $('#hh-stats').innerHTML = `
      <div class="hh-sticky">
        <div class="seg hh-pseg" role="group" aria-label="기간 단위">${P.map(([k, n]) => `<button data-p="${k}" class="${H.st.period === k ? 'on' : ''}">${n}</button>`).join('')}</div>
        ${H.st.period === 'range' ? `<div class="hh-range"><input type="date" id="stFrom" value="${H.st.from}"><span>~</span><input type="date" id="stTo" value="${H.st.to}"></div>` : ''}
        <div class="hh-tabs two" role="tablist">
          <button data-st="수입" class="${type === '수입' ? 'on' : ''}">수입 <b class="num">${av ? '월 ' : ''}${won(sv(s.inc))}</b></button>
          <button data-st="지출" class="${type === '지출' ? 'on' : ''}">지출 <b class="num">${av ? '월 ' : ''}${won(sv(s.exp))}</b></button>
        </div>
        ${yr ? `<div class="cm-head yr"><span>${av ? `월평균 · ${dv}개월로 나눔` : '연간 합계'}</span><span class="cm-pill"><button data-yavg="0" class="${av ? '' : 'on'}">합계</button><button data-yavg="1" class="${av ? 'on' : ''}">월평균</button></span></div>` : ''}
      </div>
      ${items.length ? `<div class="card hs-pie">${pieSvg(items, total)}</div>
      <div class="card hs-list">${items.map(x => `<button class="hs-row" data-cat="${esc(x.k)}">
        <span class="hs-badge num" style="background:${x.c}">${Math.round(x.v / total * 100)}%</span>
        <span class="hs-name">${esc(x.k)}</span><span class="hs-v">${av ? `<b class="num">${won(sv(x.v))}</b><small class="num">합계 ${fmt(x.v)}</small>` : `<b class="num">${won(x.v)}</b>`}</span>${ico.chev}</button>`).join('')}</div>`
      : emptyHtml(`이 기간에는 ${type} 내역이 없습니다.`)}`;
    $$('#hh-stats [data-p]').forEach(b => b.onclick = () => { H.st.period = b.dataset.p; store.set('dh_hst_p', H.st.period); render(); });
    $$('#hh-stats [data-st]').forEach(b => b.onclick = () => { H.st.type = b.dataset.st; store.set('dh_hst_t', H.st.type); render(); });
    $$('#hh-stats [data-yavg]').forEach(b => b.onclick = () => { H.st.avg = b.dataset.yavg === '1'; store.set('dh_hst_avg', H.st.avg ? '1' : '0'); render(); });
    pickerOnTap($('#hh-stats'));
    const f = $('#stFrom'), t = $('#stTo');
    if (f) f.onchange = () => { if (f.value) { H.st.from = f.value; render(); } };
    if (t) t.onchange = () => { if (t.value) { H.st.to = t.value; render(); } };
    $$('#hh-stats .hs-row').forEach(b => b.onclick = () => openCatDetail(H.st.type, b.dataset.cat, from, to));
  }

  function pieSvg(items, total) {
    const W = 380, Hh = 236, cx = W / 2, cy = Hh / 2, r = 68;
    let a0 = -Math.PI / 2;
    const paths = [], labels = [];
    items.forEach(it => {
      const fr = it.v / total, a1 = a0 + fr * Math.PI * 2;
      if (fr > 0.9999) paths.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${it.c}"/>`);
      else if (fr > 0) {
        const p = a => `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
        paths.push(`<path d="M${cx},${cy}L${p(a0)}A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}Z" fill="${it.c}"/>`);
      }
      if (fr >= 0.03 && labels.length < 10) labels.push({ am: (a0 + a1) / 2, fr, it });
      a0 = a1;
    });
    const L = labels.map(l => ({ ...l, right: Math.cos(l.am) >= 0, y: cy + (r + 22) * Math.sin(l.am) }));
    [true, false].forEach(side => {
      const arr = L.filter(l => l.right === side).sort((a, b) => a.y - b.y), gap = 31, top = 14, bot = Hh - 22;
      arr.forEach((l, i) => { l.y = Math.max(l.y, i ? arr[i - 1].y + gap : top); });
      for (let i = arr.length - 1; i >= 0; i--) { const lim = i === arr.length - 1 ? bot : arr[i + 1].y - gap; if (arr[i].y > lim) arr[i].y = lim; }
    });
    const lab = L.map(l => {
      const ex = cx + r * Math.cos(l.am), ey = cy + r * Math.sin(l.am);
      const mx = cx + (r + 10) * Math.cos(l.am), my = cy + (r + 10) * Math.sin(l.am);
      const x = l.right ? cx + r + 24 : cx - r - 24;
      return `<polyline points="${ex.toFixed(1)},${ey.toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)} ${(l.right ? x - 4 : x + 4).toFixed(1)},${(l.y - 4).toFixed(1)}" fill="none" stroke="${l.it.c}" stroke-width="1.3"/>
        <text x="${x}" y="${l.y - 6}" text-anchor="${l.right ? 'start' : 'end'}" class="pl-n">${esc(clip(l.it.k, 6))}</text>
        <text x="${x}" y="${l.y + 9}" text-anchor="${l.right ? 'start' : 'end'}" class="pl-p num">${(l.fr * 100).toFixed(1)} %</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${Hh}" class="pie" role="img" aria-label="분류별 비중">${paths.join('')}<g class="pie-sep">${pieSeps(items, total, cx, cy, r)}</g>${lab}</svg>`;
  }
  function pieSeps(items, total, cx, cy, r) {
    if (items.length < 2) return '';
    let a = -Math.PI / 2;
    return items.map(it => { const s = `<line x1="${cx}" y1="${cy}" x2="${(cx + r * Math.cos(a)).toFixed(2)}" y2="${(cy + r * Math.sin(a)).toFixed(2)}"/>`; a += it.v / total * Math.PI * 2; return s; }).join('');
  }

  function periodLabel(from, to) {
    if (from.slice(0, 7) === to.slice(0, 7) && from.endsWith('-01') && to === `${to.slice(0, 7)}-${pad(daysIn(to.slice(0, 7)))}`) return ymLabel(from.slice(0, 7));
    if (from.endsWith('-01-01') && to.endsWith('-12-31') && from.slice(0, 4) === to.slice(0, 4)) return `${from.slice(0, 4)}년`;
    return `${from.slice(2).replace(/-/g, '.')} ~ ${to.slice(2).replace(/-/g, '.')}`;
  }
  function openCatDetail(type, cat, from, to) {
    let winEnd = to.slice(0, 7), sel = null;
    const subOf = t => t.sub || '(소분류 없음)';
    const build = () => {
      const all = inRange(from, to).filter(t => t.type === type && (t.cat || '미분류') === cat);
      if (sel && !all.some(t => subOf(t) === sel)) sel = null;
      const list = sel ? all.filter(t => subOf(t) === sel) : all;
      const total = all.reduce((a, t) => a + t.amt, 0);
      const subs = new Map(); all.forEach(t => { const k = t.sub || '(소분류 없음)'; const r = subs.get(k) || { k, v: 0, n: 0 }; r.v += t.amt; r.n++; subs.set(k, r); });
      const endYm = to.slice(0, 7), months = Array.from({ length: 12 }, (_, i) => addMonths(winEnd, i - 11));
      const oneMonth = from.slice(0, 7) === endYm && from.endsWith('-01');
      const mv = months.map(ym => monthTx(ym).filter(t => t.type === type && (t.cat || '미분류') === cat && (!sel || subOf(t) === sel)).reduce((a, t) => a + t.amt, 0));
      const avg = mv.reduce((a, b) => a + b, 0) / 12;
      return `
        <section class="card">
          <div class="hcd-top"><span>${periodLabel(from, to)} · ${all.length}건</span></div>
          <div class="hcd-total num ${type === '수입' ? 'inc' : 'exp'}">${won(total)}</div>
          ${barRows([...subs.values()].sort((a, b) => b.v - a.v), total, type === '수입' ? 'var(--inc)' : 'var(--exp)', sel)}
          ${subs.size > 1 ? `<p class="note mb-note">${sel ? `<b>${esc(sel)}</b>만 보는 중 · 한 번 더 누르면 전체` : '소분류를 누르면 그 내역만 봅니다.'}</p>` : ''}
        </section>
        <section class="card">
          <div class="mb-head"><h3 class="hh-h3">${months[0].slice(2, 4)}.${+months[0].slice(5)} ~ ${months[11].slice(2, 4)}.${+months[11].slice(5)} <small>월평균 ${won(avg)}</small></h3>
            <span class="mb-nav"><button class="hh-arrow" data-mw="-1" aria-label="이전 달">${ico.left}</button><button class="hh-arrow" data-mw="1" aria-label="다음 달" ${endYm >= ymOf(new Date()) ? 'disabled' : ''}>${ico.right}</button></span></div>
          ${monthBars(months, mv, type === '수입' ? 'var(--inc)' : 'var(--exp)', oneMonth ? endYm : null, true)}
          <p class="note mb-note">${sel ? `<b>${esc(sel)}</b> 기준 · ` : ''}막대를 누르면 그 달 내역을 봅니다.</p>
        </section>
        ${[...groupByDay(list)].map(([ds, l]) => `<section class="card hd">${dayHead(ds, l)}${l.map(t => rowHtml(t)).join('')}</section>`).join('')}`;
    };
    const bindBars = pg => {
      $$('[data-mb]', pg).forEach(r => r.onclick = () => {
        const ym = r.dataset.mb; from = `${ym}-01`; to = `${ym}-${pad(daysIn(ym))}`;
        $('.hh-pbody', pg).innerHTML = build(); bindRows(pg); bindBars(pg);
      });
      $$('[data-sub]', pg).forEach(r => r.onclick = () => {
        sel = sel === r.dataset.sub ? null : r.dataset.sub;
        $('.hh-pbody', pg).innerHTML = build(); bindRows(pg); bindBars(pg);
      });
      $$('[data-mw]', pg).forEach(b => b.onclick = () => {
        // 한 달씩: 고른 달을 앞뒤로 옮기고, 막대 범위는 고른 달이 보이도록 따라감
        const cur = ymOf(new Date());
        let ym = addMonths(to.slice(0, 7), Number(b.dataset.mw)); if (ym > cur) ym = cur;
        from = `${ym}-01`; to = `${ym}-${pad(daysIn(ym))}`;
        if (ym > winEnd) winEnd = ym; else if (ym < addMonths(winEnd, -11)) winEnd = addMonths(ym, 11);
        const y = window.scrollY; $('.hh-pbody', pg).innerHTML = build(); bindRows(pg); bindBars(pg);
      });
    };
    pushPage({ title: esc(cat), body: build(), refresh: pg => { $('.hh-pbody', pg).innerHTML = build(); bindRows(pg); bindBars(pg); }, onMount: pg => { bindRows(pg); bindBars(pg); } });
  }
  function monthBars(months, vals, color, hi, tap = false) {
    const W = 336, Hh = 120, bw = W / months.length, mx = Math.max(...vals, 1);
    return `<svg viewBox="0 0 ${W} ${Hh + 18}" class="mbars" role="img" aria-label="월별 금액">${months.map((ym, i) => {
      const h = vals[i] / mx * (Hh - 16), x = i * bw + bw * 0.22;
      return `<rect x="${x.toFixed(1)}" y="${(Hh - h).toFixed(1)}" width="${(bw * 0.56).toFixed(1)}" height="${Math.max(h, vals[i] ? 1.5 : 0).toFixed(1)}" rx="3" fill="${color}" opacity="${ym === hi ? 1 : 0.42}"/>
        <text x="${(i * bw + bw / 2).toFixed(1)}" y="${Hh + 14}" text-anchor="middle" class="mb-x ${ym === hi ? 'on' : ''}">${+ym.slice(5)}</text>${tap ? `<rect class="mb-hit" data-mb="${ym}" x="${(i * bw).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${Hh + 18}" fill="transparent"/>` : ''}`;
    }).join('')}</svg>`;
  }

  /* ───────────── 자산 탭 ───────────── */
  function renderAssets() {
    let pos = 0, neg = 0;
    const vals = new Map(H.bal); H.inv.forEach(n => vals.set(n, assetVal(n)));
    vals.forEach(v => { if (v > 0) pos += v; else neg += v; });
    const groups0 = new Map();
    H.assets.filter(a => !a.hidden).forEach(a => { let g = groups0.get(a.group); if (!g) groups0.set(a.group, (g = [])); g.push(a); });
    // 현금성 자산 먼저 (현금·은행·적금·체크카드 …), 그다음 투자·부동산·대출
    const LIQ = ['현금', '은행', '적금', '체크카드', '카드'], NONLIQ = ['투자', '부동산', '대출', '마이너스 통장'];
    const rank = g => (LIQ.includes(g) ? LIQ.indexOf(g) : NONLIQ.includes(g) ? 100 + NONLIQ.indexOf(g) : 50);
    const groups = new Map([...groups0].sort((a, b) => rank(a[0]) - rank(b[0])));
    const firstNon = [...groups.keys()].find(g => rank(g) >= 100);
    const known = new Set(assetNames());
    const orphan = [...H.bal].filter(([k, v]) => !known.has(k) && Math.round(v) !== 0);
    const split = H.inv.size > 0;
    const nw = pos + neg;
    const ms = Array.from({ length: 6 }, (_, i) => addMonths(ymOf(new Date()), i - 5));
    const cum = nwByMonth();
    $('#hh-assets').innerHTML = `
      <div class="card ha-sum num">
        <div><span>자산</span><b class="inc">${fmt(pos)}</b></div>
        <div><span>부채</span><b class="exp">${fmt(-neg)}</b></div>
        <div><span>합계</span><b>${nw < 0 ? '−' : ''}${fmt(Math.abs(nw))}</b></div>
      </div>
      <button class="card ha-total" id="hhTotalBtn">
        <span class="ha-tl">순자산 추이 <em>전체통계 ›</em></span>
        <div class="ha-chart">${sparkSvg(ms.map(m => cum.get(m)), ms)}</div>
      </button>
      ${[...groups].map(([g, list]) => {
        const own = list.filter(x => !H.link.has(x.name));
        const gs = own.reduce((a, x) => a + assetVal(x.name), 0);
        const sep = g === firstNon ? '<div class="ha-sep" role="separator"><span>투자 · 부동산 · 대출</span></div>' : '';
        const cm = ymOf(new Date());
        return `${sep}<section class="card ha-group ${rank(g) >= 100 ? 'nonliq' : ''}"><div class="ha-gh"><b>${esc(g)}</b>${own.length ? `<span class="num ${gs < 0 ? 'exp' : ''}">${won(gs)}</span>` : ''}</div>
          ${list.map(a => {
            if (H.link.has(a.name)) {
              const used = monthTx(cm).filter(t => t.asset === a.name && t.type === '지출').reduce((x, t) => x + t.amt, 0);
              return `<button class="ha-row" data-asset="${esc(a.name)}"><span>${esc(a.name)}<small>${esc(H.link.get(a.name))} 연결</small></span><b class="num ha-use">이번 달 ${won(used)}</b></button>`;
            }
            if (H.inv.has(a.name)) {
              const t = invTotal();
              return `<button class="ha-row" data-asset="${esc(a.name)}"><span>${esc(a.name)}<small>${t ? `투자 앱 원금 · 지금 평가금 ${compactWon(t.value)}원` : '투자 앱 자료를 불러오는 중입니다'}</small></span><b class="num inc">${t ? won(t.cost) : '—'}</b></button>`;
            }
            const v = H.bal.get(a.name) || 0;
            return `<button class="ha-row" data-asset="${esc(a.name)}"><span>${esc(a.name)}</span><b class="num ${v < 0 ? 'exp' : v > 0 ? 'inc' : ''}">${won(v)}</b></button>`;
          }).join('')}
        </section>`;
      }).join('')}
      ${orphan.length ? `<section class="card ha-group"><div class="ha-gh"><b>목록에 없는 자산</b></div>${orphan.map(([k, v]) => `<button class="ha-row" data-asset="${esc(k)}"><span>${esc(k)}</span><b class="num ${v < 0 ? 'exp' : 'inc'}">${won(v)}</b></button>`).join('')}
        <p class="note">더보기 → 자산 설정에서 추가하면 그룹에 들어갑니다.</p></section>` : ''}
      <p class="note ha-note">숨긴 자산은 목록에서 빠지지만 합계에는 들어갑니다.${split ? '<br>투자 계좌는 투자 앱의 원금으로 합계에 들어갑니다.' : ''}</p>`;
    $$('#hh-assets .ha-row').forEach(b => b.onclick = () => openAsset(b.dataset.asset));
    $('#hhTotalBtn').onclick = () => openTotal(ymOf(new Date()));
  }
  const newAsset = () => ({ name: '', group: '현금', hidden: false, memo: '', link: '', isNew: true });
  function cumByMonth() {
    const per = new Map();
    H.tx.forEach(t => { let d = nwDelta(t); H.inv.forEach(n => { d -= flowFor(t, n); }); per.set(t.ym, (per.get(t.ym) || 0) + d); });
    const keys = [...per.keys()].sort();
    const out = new Map(); let c = 0;
    if (!keys.length) return out;
    for (let ym = keys[0], cur = ymOf(new Date()) > keys.at(-1) ? ymOf(new Date()) : keys.at(-1); ym <= cur; ym = addMonths(ym, 1)) { c += per.get(ym) || 0; out.set(ym, c); }
    return out;
  }
  // 순자산 추이 (편한가계부처럼 전체): 기록된 달 = 가계부월별 순자산, 이번 달·기록 없는 달 = 생활 자산 + 투자 앱 원금
  function nwByMonth() {
    const life = cumByMonth(), out = new Map();
    const t = invTotal(), inv = H.inv.size ? (t ? t.cost : null) : 0;
    const hist = new Map((D.household ? D.household() : []).map(h => [`${h.y}-${pad(h.m)}`, h.nw]));
    const cur = ymOf(new Date());
    new Set([...life.keys(), ...hist.keys()]).forEach(m => {
      if (m < cur && hist.has(m)) out.set(m, hist.get(m));
      else if (life.has(m) && inv !== null) out.set(m, life.get(m) + inv);
    });
    return out;
  }
  function sparkSvg(vals, ms) {
    const idx = vals.map((x, i) => (x === null || x === undefined ? null : i)).filter(i => i !== null);
    if (idx.length < 2) return '';
    const v = idx.map(i => vals[i]);
    const W = 320, Hh = 70, lo = Math.min(...v), hi = Math.max(...v), span = (hi - lo) || 1;
    const pts = v.map((x, k) => [6 + (W - 12) * k / (v.length - 1), 8 + (Hh - 16) * (1 - (x - lo) / span)]);
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let k = 1; k < pts.length; k++) { const [x0, y0] = pts[k - 1], [x1, y1] = pts[k], cx = (x0 + x1) / 2; d += ` C${cx.toFixed(1)},${y0.toFixed(1)} ${cx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`; }
    const last = pts.at(-1), diff = v.at(-1) - v.at(-2);
    const ml = m => `${Number(m.slice(5))}월`;
    return `<div class="ha-tvrow"><span class="ha-tv num">${won(v.at(-1))}</span><span class="ha-chg num ${diff >= 0 ? 'up' : 'dn'}">지난달보다 ${diff >= 0 ? '+' : '−'}${compactWon(Math.abs(diff))}원</span></div>
      <div class="ha-sw"><svg viewBox="0 0 ${W} ${Hh}" class="ha-spark" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="haG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--hh)" stop-opacity=".32"/><stop offset="1" stop-color="var(--hh)" stop-opacity="0"/></linearGradient></defs>
        <path d="${d} L${last[0].toFixed(1)},${Hh} L${pts[0][0].toFixed(1)},${Hh} Z" fill="url(#haG)"/>
        <path d="${d}" fill="none" stroke="var(--hh)" stroke-width="2.4" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      </svg>
      <span class="ha-dot" style="left:${(last[0] / W * 100).toFixed(2)}%;top:${(last[1] / Hh * 100).toFixed(2)}%"></span></div>
      ${ms ? `<div class="ha-ml"><span>${ml(ms[idx[0]])}</span><span>${ml(ms[idx.at(-1)])}</span></div>` : ''}`;
  }

  function openTotal(endYm) {
    const build = ym => {
      const cum = nwByMonth(), ms = Array.from({ length: 6 }, (_, i) => addMonths(ym, i - 5));
      const nv = ms.map(m => cum.get(m) ?? null), s = ms.map(m => sums(monthTx(m)));
      return `
        <div class="hp-nav"><button class="hh-arrow" data-tm="-1" aria-label="이전 달">${ico.left}</button><b>${ymLabel(ym)}</b><button class="hh-arrow" data-tm="1" aria-label="다음 달">${ico.right}</button></div>
        <section class="card">
          <span class="ht-l">순자산</span><div class="ht-v num">${nv.at(-1) === null ? '—' : won(nv.at(-1))}</div>
          ${lineChart(ms, nv)}
        </section>
        <section class="card">
          <h3 class="hh-h3">월별 수입 · 지출</h3>
          ${ioBars(ms, s)}
        </section>`;
    };
    let ym = endYm;
    const bindNav = pg => $$('[data-tm]', pg).forEach(b => b.onclick = () => { ym = addMonths(ym, Number(b.dataset.tm)); $('.hh-pbody', pg).innerHTML = build(ym); bindNav(pg); });
    pushPage({ title: '전체통계', body: build(ym), onMount: bindNav });
  }
  function lineChart(ms, vals) {
    const W = 336, Hh = 150, padL = 4, padR = 4, top = 14, bot = 24;
    const v = vals.filter(x => x !== null);
    if (v.length < 1) return '<p class="empty">기록이 없습니다.</p>';
    const lo = Math.min(...v), hi = Math.max(...v), span = (hi - lo) || Math.abs(hi) * 0.05 || 1;
    const y = x => top + (Hh - top - bot) * (1 - (x - lo + span * 0.1) / (span * 1.2));
    const xs = i => padL + (W - padL - padR) * (i + 0.5) / ms.length;
    const pts = vals.map((x, i) => (x === null ? null : [xs(i), y(x)])).filter(Boolean);
    return `<svg viewBox="0 0 ${W} ${Hh}" class="lchart" role="img" aria-label="순자산 추이">
      <polyline points="${pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="var(--hh)" stroke-width="2.4" stroke-linejoin="round"/>
      ${pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4" fill="var(--hh)"/>`).join('')}
      ${ms.map((m, i) => `<text x="${xs(i).toFixed(1)}" y="${Hh - 6}" text-anchor="middle" class="mb-x">${+m.slice(5)}월</text>`).join('')}
    </svg>
    <div class="ht-cols num">${ms.map((m, i) => `<span>${vals[i] === null ? '—' : compactWon(vals[i])}</span>`).join('')}</div>`;
  }
  function ioBars(ms, s) {
    const W = 336, Hh = 150, bot = 20, mx = Math.max(...s.map(x => Math.max(x.inc, x.exp)), 1), bw = W / ms.length;
    return `<svg viewBox="0 0 ${W} ${Hh}" class="mbars" role="img" aria-label="월별 수입 지출">
      ${ms.map((m, i) => {
        const hi = s[i].inc / mx * (Hh - bot - 8), he = s[i].exp / mx * (Hh - bot - 8), x = i * bw + bw * 0.18, w = bw * 0.3;
        return `<rect x="${x.toFixed(1)}" y="${(Hh - bot - hi).toFixed(1)}" width="${w.toFixed(1)}" height="${hi.toFixed(1)}" rx="2.5" fill="var(--inc)"/>
          <rect x="${(x + w + 2).toFixed(1)}" y="${(Hh - bot - he).toFixed(1)}" width="${w.toFixed(1)}" height="${he.toFixed(1)}" rx="2.5" fill="var(--exp)"/>
          <text x="${(i * bw + bw / 2).toFixed(1)}" y="${Hh - 5}" text-anchor="middle" class="mb-x">${+m.slice(5)}월</text>`;
      }).join('')}
    </svg>
    <div class="ht-cols num">${s.map(x => `<span><b class="inc">${compactWon(x.inc)}</b><b class="exp">${compactWon(x.exp)}</b></span>`).join('')}</div>`;
  }

  function openAsset(name) {
    let ym = ymOf(new Date());
    const card = H.link.get(name) || null;   // 결제 계좌가 연결된 체크카드
    const isInv = H.inv.has(name);
    const build = () => {
      const hit = t => (card ? t.asset === name || t.to === name : eff(t.asset) === name || eff(t.to) === name);
      const all = H.tx.filter(hit).slice().reverse();
      const after = new Map(); let run = 0;
      all.forEach(t => { run += flowFor(t, name, !!card); after.set(t.id, run); });
      const list = monthTx(ym).filter(hit);
      let inn = 0, out = 0; list.forEach(t => { const f = flowFor(t, name, !!card); if (f > 0) inn += f; else out -= f; });
      const endBal = (() => { let b = 0; all.forEach(t => { if (t.ym <= ym) b = after.get(t.id); }); return b; })();
      const a = H.assets.find(x => x.name === name);
      const bal = H.bal.get(name) || 0;
      const linked = H.assets.filter(x => H.link.get(x.name) === name).map(x => x.name);
      return `
        <section class="card hp-asset">
          ${isInv ? '' : `<span class="hp-ag">${esc(a ? a.group : '목록에 없는 자산')}${a && a.hidden ? ' · 숨김' : ''}</span>`}
          ${isInv ? (() => { const t = invTotal(); const pl = t ? t.value - t.cost : 0, r = t && t.cost ? pl / t.cost * 100 : 0;
              return `<div class="hp-invrow"><div class="hp-invl"><span class="hp-invlb">투자 앱 원금</span><div class="hp-bal sm num">${t ? won(t.cost) : '—'}</div></div>
                ${t ? `<div class="hp-chips"><span class="hp-chip num">평가금 ${compactWon(t.value)}</span><span class="hp-chip num ${pl < 0 ? 'neg' : 'pos'}">${pl >= 0 ? '+' : ''}${compactWon(pl)} · ${pl >= 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}%</span></div>` : ''}</div>`; })()
            : card ? `<div class="hp-bal num">${won(out - inn)}</div><p class="note">${ymLabel(ym)} 사용 금액입니다. 결제 계좌 <b>${esc(card)}</b> 잔액에서 바로 빠집니다.</p>`
            : `<div class="hp-bal num ${bal < 0 ? 'exp' : ''}">${won(bal)}</div>${linked.length ? `<p class="note">${linked.map(esc).join(', ')} 사용 금액이 이 잔액에 들어 있습니다.</p>` : ''}`}
          ${a && a.memo && !isInv ? `<button class="hp-memo" id="aMemo" aria-label="메모 보기"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="#F5C518" d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"/></svg></button>` : ''}
          ${isInv ? `<button class="hp-inv" id="aInv"><span class="hp-inv-ic">${ico.chart}</span><span class="hp-inv-t"><b>투자 화면으로</b><small>종목별 평가금 · 수익률 보기</small></span>${ico.chev}</button>`
            : `<div class="hp-btns">${card ? '' : '<button class="btn sm" id="aAdj">잔액 수정</button>'}<button class="btn sm" id="aSet">자산 설정</button></div>`}
        </section>
        <div class="hp-nav"><button class="hh-arrow" data-am="-1" aria-label="이전 달">${ico.left}</button><b>${ymLabel(ym)}</b><button class="hh-arrow" data-am="1" aria-label="다음 달">${ico.right}</button></div>
        <div class="card ha-sum num sm">
          <div><span>${isInv ? '보낸 돈' : '들어옴'}</span><b class="inc">${fmt(inn)}</b></div>
          <div><span>${isInv ? '찾은 돈' : '나감'}</span><b class="exp">${fmt(out)}</b></div>
          ${isInv ? `<div><span>순입금</span><b>${inn - out < 0 ? '−' : ''}${fmt(Math.abs(inn - out))}</b></div>` : card ? `<div><span>사용</span><b>${fmt(out - inn)}</b></div>` : `<div><span>월말 잔액</span><b>${endBal < 0 ? '−' : ''}${fmt(Math.abs(endBal))}</b></div>`}
        </div>
        ${list.length ? [...groupByDay(list)].map(([ds, l]) => `<section class="card hd">${dayHead(ds, null)}${l.map(t => rowHtml(t, { forAsset: name, raw: !!card, balAfter: card || isInv ? null : after.get(t.id) })).join('')}</section>`).join('')
          : emptyHtml('이 달에는 이 자산의 내역이 없습니다.')}`;
    };
    const bind = pg => {
      bindRows(pg);
      $$('[data-am]', pg).forEach(b => b.onclick = () => { ym = addMonths(ym, Number(b.dataset.am)); $('.hh-pbody', pg).innerHTML = build(); bind(pg); });
      const adj = $('#aAdj', pg); if (adj) adj.onclick = () => adjustBalance(name);
      const am = $('#aMemo', pg); if (am) am.onclick = () => { const a = H.assets.find(x => x.name === name); D.openSheet(`<div class="ask"><h2 id="sheetTitle">${esc(name)} 메모</h2><p class="memo-view">${esc(a ? a.memo : '')}</p><div class="sheet-actions"><button class="btn" data-close>닫기</button></div></div>`, 'pop'); };
      const iv = $('#aInv', pg); if (iv) iv.onclick = () => (D.openInvHome ? D.openInvHome() : D.setApp('inv'));
      const aSet = $('#aSet', pg); if (aSet) aSet.onclick = () => { const a = H.assets.find(x => x.name === name); openAssetEdit(a || { ...newAsset(), name, group: '기타' }); };
    };
    pushPage({ title: esc(name), body: build(), onMount: bind, refresh: pg => { $('.hh-pbody', pg).innerHTML = build(); bind(pg); } });
  }

  // 잔액 수정: 실제 잔액을 숫자판으로 받고, 차액을 '보정'(수입·지출 제외) 또는 수입·지출 내역으로 기록
  function adjustBalance(name) {
    const cur = H.bal.get(name) || 0;
    let v = String(cur), fresh = true, mode = ['rec', 'cost'].includes(store.get('dh_adj_mode')) ? store.get('dh_adj_mode') : 'adj', cat = '', sub = '', picking = false;
    let kSel = (() => { try { return JSON.parse(store.get('dh_adj_cost2') || 'null'); } catch { return null; } })(), kStep = '', memo = '';
    const kinds = invKinds;
    const val = () => (v === '' || v === '-' ? NaN : Number(v));
    const typeOf = d => (d < 0 ? '지출' : '수입');
    const defCat = ty => { const l = H.cats[ty] || []; const last = store.get(`dh_adj_cat_${ty}`); return (l.find(c => c.name === last) || l.find(c => c.name === '기타') || l[0] || {}).name || ''; };
    D.openSheet(`<div class="adj-box" id="adjBox"></div>`);
    const box = $('#adjBox');
    const k = (x, lab, cls = '') => `<button class="kp-k ${cls}" data-k="${x}">${lab}</button>`;
    const draw = () => {
      const n = val(), diff = Number.isFinite(n) ? n - cur : 0, ty = typeOf(diff);
      if (mode === 'rec' && diff && (!cat || !(H.cats[ty] || []).some(c => c.name === cat))) { cat = defCat(ty); const co = (H.cats[ty] || []).find(c => c.name === cat), ls = store.get(`dh_adj_sub_${ty}_${cat}`) || ''; sub = co && co.subs.includes(ls) ? ls : ''; }
      const catObj = (H.cats[ty] || []).find(c => c.name === cat);
      const cats = H.cats[ty] || [];
      const ks = kinds(); if (kSel && ks.length && !ks.some(x => x.kind === kSel.kind)) kSel = null;
      box.innerHTML = `<div class="adj-top"><h2 id="sheetTitle">잔액 수정</h2><span>${esc(name)} · 앱 잔액 ${won(cur)}</span></div>
        <div class="adj-amt"><small>실제 잔액</small><b>${v === '' ? '0' : v === '-' ? '−' : `${n < 0 ? '−' : ''}${fmt(Math.abs(n))}`}<span class="u">원</span></b>
          <em class="${diff > 0 ? 'p' : diff < 0 ? 'm' : ''}">${diff ? `차액 ${swon(diff)}` : '차액 없음'}</em></div>
        <div class="adj-seg" role="tablist"><button data-md="adj" class="${mode === 'adj' ? 'on' : ''}">보정<small>수입·지출 제외</small></button><button data-md="rec" class="${mode === 'rec' ? 'on' : ''}">수입·지출<small>통계·예산 반영</small></button><button data-md="cost" class="${mode === 'cost' ? 'on' : ''}">투자 비용<small>투자 손익 반영</small></button></div>
        ${mode === 'cost' ? (diff < 0 ? `<button class="adj-catbtn" id="adjKind"><small>투자 구성</small><b>${kSel ? esc(costLabel(kSel.asset, kSel.sub)) : (ks.length ? '고르기' : '투자 앱 불러오는 중')}</b>${ico.chev}</button>
          <input class="adj-memo" id="adjMemo" placeholder="내용 (예: 라오어 구독료)" value="${esc(memo)}" autocomplete="off">` : '<p class="adj-hint">구독료처럼 투자에 쓴 돈을<br>그 구성의 투자 손익(기타 비용)으로 넣습니다.<br>잔액이 줄 때만 됩니다.</p>')
        : mode === 'rec' ? (diff ? `<button class="adj-catbtn" id="adjCat"><small>${ty} 분류</small><b>${cat ? esc(cat + (sub ? ` / ${sub}` : '')) : '고르기'}</b>${ico.chev}</button>` : '<p class="adj-hint">실제 잔액을 입력하면<br>모자라면 지출, 남으면 수입으로 기록합니다.</p>') : '<p class="adj-hint">차액만큼 \'잔액수정\' 내역이 생기고,<br>수입·지출 통계에는 들어가지 않습니다.</p>'}
        ${picking === 'kind' && mode === 'cost' ? `<div class="adj-pick"><div class="adj-pick-h">${kStep ? `<button class="adj-back" id="adjKBack">‹ ${esc(kStep)}</button> 종목 고르기` : '투자 구성 고르기'}</div><div class="adj-pick-l">${costPickHtml(kSel, kStep, 'data-c')}</div></div>`
          : picking === 'cat' && mode === 'rec' && diff ? `<div class="adj-pick"><div class="adj-pick-h">${ty} 분류 고르기</div><div class="adj-pick-l">${cats.map(c => `<button class="${c.name === cat ? 'on' : ''}" data-c="${esc(c.name)}">${esc(c.name)}${c.subs.length ? ' ›' : ''}</button>`).join('') || '<p class="note">분류가 없습니다</p>'}</div></div>`
          : picking === 'sub' && mode === 'rec' && diff && catObj ? `<div class="adj-pick"><div class="adj-pick-h"><button class="adj-back" id="adjBack">‹ ${esc(cat)}</button> 소분류 고르기</div><div class="adj-pick-l"><button class="${!sub ? 'on' : ''}" data-s="">소분류 없음</button>${catObj.subs.map(x => `<button class="${x === sub ? 'on' : ''}" data-s="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>` : `<div class="kp-grid adj-kp">${k(1, 1)}${k(2, 2)}${k(3, 3)}${k('bs', ico.bksp, 'fn')}${k(4, 4)}${k(5, 5)}${k(6, 6)}${k('-', '−', 'fn')}${k(7, 7)}${k(8, 8)}${k(9, 9)}${k('00', '00')}${k('x', '취소', 'fn sm')}${k(0, 0)}${k('000', '000')}${k('ok', '저장', 'ok')}</div>`}`;
      const cb = $('#adjCat', box); if (cb) cb.onclick = () => { picking = picking ? false : 'cat'; draw(); };
      const kb = $('#adjKind', box); if (kb) kb.onclick = () => { if (!kinds().length && D.ensureInv) D.ensureInv(); picking = picking ? false : 'kind'; kStep = ''; draw(); };
      const kbb = $('#adjKBack', box); if (kbb) kbb.onclick = () => { kStep = ''; draw(); };
      $$('[data-c-k]', box).forEach(b => b.onclick = () => { const k = kinds().find(x => x.kind === b.dataset.cK); if (k && k.items.length) kStep = k.kind; else { kSel = costSel(b.dataset.cK, ''); picking = false; } draw(); });
      $$('[data-c-i]', box).forEach(b => b.onclick = () => { kSel = costSel(kStep, b.dataset.cI); picking = false; kStep = ''; draw(); });
      const mi = $('#adjMemo', box); if (mi) mi.oninput = () => { memo = mi.value; };
      const ab = $('#adjBack', box); if (ab) ab.onclick = () => { picking = 'cat'; draw(); };
      $$('[data-s]', box).forEach(b => b.onclick = () => { sub = b.dataset.s; picking = false; draw(); });
      $$('[data-md]', box).forEach(b => b.onclick = () => { mode = b.dataset.md; picking = false; store.set('dh_adj_mode', mode); if (mode === 'cost' && !kinds().length && D.ensureInv) D.ensureInv(); draw(); });
      $$('[data-c]', box).forEach(b => b.onclick = () => { if (b.dataset.c !== cat) sub = ''; cat = b.dataset.c; const co = (H.cats[typeOf(val() - cur)] || []).find(c => c.name === cat); picking = co && co.subs.length ? 'sub' : false; draw(); });
      $$('[data-k]', box).forEach(b => b.onclick = () => {
        const x = b.dataset.k;
        if (x === 'x') { D.closeSheet(); return; }
        if (x === 'ok') { save(); return; }
        if (x === 'bs') { v = v.slice(0, -1); fresh = false; draw(); return; }
        if (x === '-') { v = fresh ? '-' : v.startsWith('-') ? v.slice(1) : '-' + v; fresh = false; draw(); return; }
        if (fresh) { v = ''; fresh = false; }
        const neg = v.startsWith('-'), d = neg ? v.slice(1) : v;
        if (d.length + x.length > 13) return;
        if (d === '' || d === '0') { if (/^0+$/.test(x)) { v = (neg ? '-' : '') + '0'; draw(); return; } v = (neg ? '-' : '') + x; }
        else v += x;
        draw();
      });
    };
    async function save() {
      const n = val();
      if (!Number.isFinite(n)) { toast('실제 잔액을 입력하십시오', true); return; }
      const diff = n - cur;
      if (!diff) { toast('잔액이 같아서 바꿀 것이 없습니다'); return; }
      const d = new Date(), at = `${dOf(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`, by = store.get('dh_name') || '';
      let t;
      if (mode === 'cost') {
        if (diff > 0) { toast('투자 비용은 잔액이 줄 때만 넣을 수 있습니다', true); return; }
        if (!kSel) { toast('투자 구성을 고르십시오', true); return; }
        store.set('dh_adj_cost2', JSON.stringify(kSel));
        t = toTx([newId('n'), at, '수정', '잔액수정', '', memo.trim() || '투자 비용', diff, name, '', '', '', '', '', by, '비용', kSel.asset, kSel.sub, '', '']);
      } else if (mode === 'rec') {
        const ty = typeOf(diff);
        if (!cat) { toast('분류를 고르십시오', true); return; }
        store.set(`dh_adj_cat_${ty}`, cat); store.set(`dh_adj_sub_${ty}_${cat}`, sub);
        t = toTx([newId('n'), at, ty, cat, sub, '잔액 맞춤', Math.abs(diff), name, '', '', '', '', '', by]);
      } else t = toTx([newId('n'), at, '수정', '잔액수정', '', '잔액 수정', diff, name, '', '', '', '', '', by]);
      D.closeSheet();
      await commitTx(t, null);
    }
    draw();
  }

  /* ───────────── 더보기 탭 ───────────── */
  function renderMore() {
    const n = H.tx.length;
    $('#hh-more').innerHTML = `
      <div class="card hmo">
        <button class="hmo-row" data-go="cat-수입"><span>수입 분류 설정</span>${ico.chev}</button>
        <button class="hmo-row" data-go="cat-지출"><span>지출 분류 설정</span>${ico.chev}</button>
        <button class="hmo-row" data-go="assets"><span>자산 설정</span>${ico.chev}</button>
        <button class="hmo-row" data-go="rules"><span>반복 내역</span>${ico.chev}</button>
        <button class="hmo-row" data-go="budget"><span>예산 설정</span><small>${H.budgets.size ? `월 ${won(H.cats['지출'].reduce((a, c) => a + catBudget(c), 0))}` : '없음'}</small>${ico.chev}</button>
      </div>
      <div class="card hmo">
        <button class="hmo-row" data-go="search"><span>내역 검색</span>${ico.chev}</button>
        <button class="hmo-row" data-go="csv"><span>내역 내려받기 (CSV)</span><small>${fmt(n)}건</small>${ico.chev}</button>
        <button class="hmo-row" data-go="reload"><span>새로고침 <small class="hmo-sub">(가계부 새로 불러오기)</small></span>${ico.chev}</button>
        <button class="hmo-row" data-go="inv"><span>투자 화면으로</span>${ico.chev}</button>
      </div>
      <p class="note hmo-note">가계부는 구글 시트에 저장되어 두 사람 휴대폰에 바로 같이 보입니다.<br>
      시트에서 직접 고친 뒤 새로고침하면 앱에 반영됩니다.<br>
      예전 상태로 되돌리기: 구글 시트 → 버전 기록<br>
      매월 반복 내역은 그 날짜가 지난 뒤 앱을 열 때 자동으로 들어갑니다.</p>`;
    $$('#hh-more [data-go]').forEach(b => b.onclick = () => {
      const g = b.dataset.go;
      if (g.startsWith('cat-')) openCatSettings(g.slice(4));
      else if (g === 'assets') openAssetSettings('all');
      else if (g === 'rules') openRules();
      else if (g === 'budget') openBudgetSettings();
      else if (g === 'search') openSearch();
      else if (g === 'csv') exportCsv();
      else if (g === 'reload') load({ quiet: false });
      else if (g === 'inv') (D.openInvHome ? D.openInvHome() : D.setApp('inv'));
    });
  }

  function exportCsv() {
    const head = ['일시', '구분', '분류', '소분류', '내용', '금액', '자산', '받는자산', '메모', '화폐', '외화금액', '입력자'];
    const q = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [head.join(',')].concat(H.tx.slice().reverse().map(t => [t.ts, t.type, t.cat, t.sub, t.text, t.amt, t.asset, t.to, t.memo, t.cur, t.famt, t.by].map(q).join(',')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `가계부_${today()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`${fmt(H.tx.length)}건을 내려받았습니다`);
  }

  /* ───────────── 겹쳐 뜨는 화면 (뒤로 가기 버튼으로 닫힘) ───────────── */
  const stack = [];
  function lock(on) { document.documentElement.classList.toggle('hh-locked', on); }
  function pushPage({ title, body, actions = '', cls = '', onMount, refresh, onClose }) {
    const layer = $('#hhLayer');
    layer.hidden = false; lock(true);
    const pg = document.createElement('section');
    pg.className = `hh-page ${cls}`;
    pg.setAttribute('role', 'dialog'); pg.setAttribute('aria-modal', 'true');
    pg.innerHTML = `<header class="hh-ph"><button class="icon-btn hh-back" aria-label="뒤로">${ico.back}</button><h2>${title}</h2><div class="hh-pa">${actions}</div></header><div class="hh-pbody">${body}</div>`;
    layer.appendChild(pg);
    stack.forEach(s => s.pg && s.pg.classList.add('under'));
    const item = { pg, refresh, onClose, close: () => { pg.classList.remove('in'); setTimeout(() => pg.remove(), 220); } };
    stack.push(item);
    history.pushState({ hhp: stack.length }, '');
    $('.hh-back', pg).onclick = () => history.back();
    requestAnimationFrame(() => pg.classList.add('in'));
    if (onMount) onMount(pg);
    return pg;
  }
  function pushState(close) { stack.push({ close }); history.pushState({ hhp: stack.length }, ''); }
  function popOne() {
    const s = stack.pop();
    if (!s) return;
    s.close();
    if (s.onClose) s.onClose();
    const top = [...stack].reverse().find(x => x.pg);
    if (top) top.pg.classList.remove('under');
    if (!stack.some(x => x.pg)) { lock(false); setTimeout(() => { if (!stack.some(x => x.pg)) $('#hhLayer').hidden = true; }, 230); }
  }
  let afterPop = [];
  window.addEventListener('popstate', e => {
    const want = (e.state && e.state.hhp) || 0;
    while (stack.length > want) popOne();
    const run = afterPop; afterPop = [];
    run.forEach(fn => setTimeout(fn, 0));
  });
  function back(n = 1, then) { if (then) afterPop.push(then); if (n > 0) history.go(-n); }
  function refreshPages() { stack.forEach(s => { if (s.pg && s.refresh) s.refresh(s.pg); }); }
  function closeAllPages() { const n = stack.length; if (n) history.go(-n); }

  // 작은 입력 창 (앱의 팝업 사용)
  function askText(title, value = '', { note = '', ok = '저장', money = false, placeholder = '' } = {}) {
    return new Promise(res => {
      D.openSheet(`<div class="ask"><h2 id="sheetTitle">${esc(title)}</h2>${note ? `<p class="note ask-note">${note}</p>` : ''}
        <input id="askIn" ${money ? 'inputmode="numeric"' : ''} value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" class="ask-in">
        <div class="sheet-actions two"><button class="btn" data-close>취소</button><button class="btn primary" id="askOk">${ok}</button></div></div>`, 'pop');
      let done = false;
      const fin = v => { if (done) return; done = true; obs.disconnect(); res(v); };
      const sh = $('#sheet');
      const obs = new MutationObserver(() => { if (!sh.classList.contains('open') || sh.hidden) fin(null); });
      setTimeout(() => obs.observe(sh, { attributes: true, attributeFilter: ['class', 'hidden'] }), 60);
      const inp = $('#askIn');
      if (money) bindMoneyInput(inp, true);
      setTimeout(() => { inp.focus(); inp.select(); }, 80);
      $('#askOk').onclick = () => { const v = inp.value.trim(); fin(v); D.closeSheet(); };
      inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('#askOk').click(); } };
    });
  }
  function askConfirm(title, note = '', ok = '확인', danger = true) {
    return new Promise(res => {
      D.openSheet(`<div class="ask"><h2 id="sheetTitle">${esc(title)}</h2>${note ? `<p class="note ask-note">${note}</p>` : ''}
        <div class="sheet-actions two"><button class="btn" data-close>취소</button><button class="btn ${danger ? 'danger' : 'primary'}" id="askOk">${ok}</button></div></div>`, 'pop');
      let done = false;
      const fin = v => { if (done) return; done = true; obs.disconnect(); res(v); };
      const sh = $('#sheet');
      const obs = new MutationObserver(() => { if (!sh.classList.contains('open') || sh.hidden) fin(false); });
      setTimeout(() => obs.observe(sh, { attributes: true, attributeFilter: ['class', 'hidden'] }), 60);
      $('#askOk').onclick = () => { fin(true); D.closeSheet(); };
    });
  }
  // 반복 주기 고르기 (편한가계부 목록)
  function pickPeriod(cur, withNone) {
    return new Promise(res => {
      const list = withNone ? ['없음', ...PERIODS] : PERIODS;
      D.openSheet(`<div class="ask"><h2 id="sheetTitle">반복</h2><div class="sel-list">${list.map(p => `<button class="${p === cur ? 'on' : ''}" data-pp="${p}"><span>${p}</span>${p === cur ? '<b>✓</b>' : ''}</button>`).join('')}</div>
        <div class="sheet-actions"><button class="btn" data-close>취소</button></div></div>`, 'pop');
      let done = false;
      const fin = v => { if (done) return; done = true; obs.disconnect(); res(v); };
      const sh = $('#sheet');
      const obs = new MutationObserver(() => { if (!sh.classList.contains('open') || sh.hidden) fin(null); });
      setTimeout(() => obs.observe(sh, { attributes: true, attributeFilter: ['class', 'hidden'] }), 60);
      $$('#sheetBody [data-pp]').forEach(b => b.onclick = () => { fin(b.dataset.pp); D.closeSheet(); });
      const on = $('#sheetBody .sel-list .on'); if (on) on.scrollIntoView({ block: 'center' });
    });
  }
  // 달력 창 (편한가계부 날짜 선택 창과 같은 모양)
  function pickDate(cur, { month: mOnly = false, clear = false } = {}) {
    return new Promise(res => {
      if (mOnly) cur = cur ? `${cur.slice(0, 7)}-01` : '';
      let sel = cur || today(), ym = sel.slice(0, 7), mode = mOnly ? 'month' : 'day', yy = +ym.slice(0, 4);
      D.openSheet('<div class="cal" id="cal"></div>', 'pop');
      const box = $('#cal');
      let done = false;
      const fin = v => { if (done) return; done = true; obs.disconnect(); res(v); };
      const sh = $('#sheet');
      const obs = new MutationObserver(() => { if (!sh.classList.contains('open') || sh.hidden) fin(null); });
      setTimeout(() => obs.observe(sh, { attributes: true, attributeFilter: ['class', 'hidden'] }), 60);
      const draw = () => {
        const td = today();
        let body;
        if (mode === 'day') {
          const first = parseD(ym + '-01').getDay(), n = daysIn(ym);
          const cells = [];
          for (let i = 0; i < first; i++) cells.push('<span></span>');
          for (let d = 1; d <= n; d++) {
            const ds = `${ym}-${pad(d)}`, w = (first + d - 1) % 7;
            cells.push(`<button class="cal-d${w === 0 ? ' sun' : w === 6 ? ' sat' : ''}${ds === td ? ' td' : ''}${ds === sel ? ' on' : ''}" data-d="${ds}">${d}</button>`);
          }
          body = `<div class="cal-nav"><button class="cal-ar" data-mv="-1" aria-label="이전 달">‹</button><button class="cal-ym" id="calYm">${ymLabel(ym)}</button><button class="cal-ar" data-mv="1" aria-label="다음 달">›</button></div>
            <div class="cal-wk">${WD.map((w, i) => `<span class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</span>`).join('')}</div>
            <div class="cal-grid" id="calGrid">${cells.join('')}</div>`;
        } else {
          body = `<div class="cal-nav"><button class="cal-ar" data-yv="-1" aria-label="이전 해">‹</button><button class="cal-ym" id="calYm">${yy}년</button><button class="cal-ar" data-yv="1" aria-label="다음 해">›</button></div>
            <div class="cal-ms">${Array.from({ length: 12 }, (_, i) => { const m = `${yy}-${pad(i + 1)}`; return `<button class="cal-m${m === (mOnly ? sel.slice(0, 7) : ym) ? ' on' : ''}${m === td.slice(0, 7) ? ' td' : ''}" data-m="${m}">${i + 1}월</button>`; }).join('')}</div>`;
        }
        box.innerHTML = `<div class="cal-hd"><span>${sel.slice(0, 4)}년</span><b>${mOnly ? `${+sel.slice(5, 7)}월` : `${+sel.slice(5, 7)}월 ${+sel.slice(8, 10)}일 (${WD[wdOf(sel)]})`}</b></div>${body}
          <div class="cal-btns">${clear ? '<button class="cal-tb" id="calClr">지우기</button>' : `<button class="cal-tb" id="calToday">${mOnly ? '이번 달' : '오늘'}</button>`}<span></span><button class="cal-tb" data-close>취소</button><button class="cal-tb ok" id="calOk">확인</button></div>`;
        $$('[data-mv]', box).forEach(b => b.onclick = () => { ym = addMonths(ym, +b.dataset.mv); draw(); });
        $$('[data-yv]', box).forEach(b => b.onclick = () => { yy += +b.dataset.yv; draw(); });
        $$('[data-d]', box).forEach(b => b.onclick = () => { sel = b.dataset.d; draw(); });
        $$('[data-m]', box).forEach(b => b.onclick = () => { ym = b.dataset.m; if (mOnly) { sel = `${ym}-01`; } else mode = 'day'; draw(); });
        $('#calYm', box).onclick = () => { if (mOnly) return; if (mode === 'day') { mode = 'month'; yy = +ym.slice(0, 4); } else mode = 'day'; draw(); };
        const tb = $('#calToday', box); if (tb) tb.onclick = () => { sel = mOnly ? `${td.slice(0, 7)}-01` : td; ym = td.slice(0, 7); yy = +td.slice(0, 4); mode = mOnly ? 'month' : 'day'; draw(); };
        const cb = $('#calClr', box); if (cb) cb.onclick = () => { fin(''); D.closeSheet(); };
        $('#calOk', box).onclick = () => { fin(mOnly ? sel.slice(0, 7) : sel); D.closeSheet(); };
        const g = $('#calGrid', box);
        if (g) {
          let x0 = null, y0 = 0;
          g.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
          g.addEventListener('touchend', e => {
            if (x0 == null) return;
            const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { ym = addMonths(ym, dx < 0 ? 1 : -1); draw(); }
          });
        }
      };
      draw();
    });
  }
  // 투자 비용: 구성(kind) + 종목. 종목 미선택이면 구성 대표 자산에, 종목 이름 = 구성 이름
  const invKinds = () => ((D.invOptions && D.invOptions()) || {}).kinds || [];
  const kindOf = a => invKinds().find(k => k.asset === a || k.items.some(i => i.asset === a));
  const costLabel = (a, s) => { const k = kindOf(a); if (!k) return s || a; return s && s !== k.kind ? `${k.kind} / ${s}` : k.kind; };
  const costPickHtml = (kSel, step, attr) => {
    const ks = invKinds();
    if (!ks.length) return '<p class="empty">투자 앱 자료를 불러오는 중입니다.<br>잠시 뒤 다시 누르십시오.</p>';
    if (!step) return ks.map(x => `<button class="${kSel && kSel.kind === x.kind ? 'on' : ''}" ${attr}-k="${esc(x.kind)}">${esc(x.kind)}${x.items.length ? ' ›' : ''}</button>`).join('');
    const k = ks.find(x => x.kind === step); if (!k) return '';
    const none = kSel && kSel.kind === k.kind && kSel.sub === k.kind;
    return `<button class="${none ? 'on' : ''}" ${attr}-i="">종목 미선택</button>` + k.items.map((it, i) => `<button class="${kSel && kSel.asset === it.asset && kSel.sub === it.sub ? 'on' : ''}" ${attr}-i="${i}">${esc(it.label)}</button>`).join('');
  };
  const costSel = (kind, idx) => { const k = invKinds().find(x => x.kind === kind); if (!k) return null; const it = idx === '' ? null : k.items[Number(idx)]; return it ? { kind, asset: it.asset, sub: it.sub } : { kind, asset: k.asset, sub: k.kind }; };
  // 투자 앱 '기타 보정' 상세: 그 달 가계부에서 보정의 원인이 되는 내역 (app.js 가 부름)
  D.hhAdjItems = ym => {
    if (!H.loaded || !H.ready) return null;
    const L = monthTx(ym), inv = H.inv;
    const adj = L.filter(t => t.type === '수정' && t.invType !== '비용' && !inv.has(t.asset))
      .map(t => ({ d: t.d, text: t.text || '잔액 수정', sub: t.asset, amt: t.amt }));
    const onInv = L.filter(t => (t.type === '수입' || t.type === '지출') && inv.has(t.asset))
      .map(t => ({ d: t.d, text: `${t.type} · ${t.cat || ''}${t.text ? ` · ${t.text}` : ''}`, sub: `${t.asset}에 기록 (생활 자산은 그대로)`, amt: t.type === '수입' ? -t.amt : t.amt }));
    const unlinked = L.filter(t => t.type === '이체' && !t.invType && (inv.has(t.to) !== inv.has(t.asset)))
      .map(t => ({ d: t.d, text: t.text || '이체', sub: `${t.asset} → ${t.to} · 투자 앱 연결 안 함`, amt: inv.has(t.to) ? -t.amt : t.amt }));
    const cost = L.filter(t => t.type === '수정' && t.invType === '비용').reduce((a, t) => a + t.amt, 0);
    return { adj, onInv, unlinked, cost };
  };
  // 메모 칸: 안쪽 스크롤 없이 내용만큼 늘어남 (작은 스크롤바 대신 화면 전체로 스크롤)
  function autoGrow(ta) { if (!ta) return; ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; }
  document.addEventListener('input', ev => { if (ev.target.matches && ev.target.matches('textarea.hf-memo')) autoGrow(ev.target); });
  // 수량·단가 칸(.dec): 소수점은 그대로, 천 단위마다 콤마 (원화·달러 모두)
  document.addEventListener('input', ev => {
    const i = ev.target;
    if (!i.classList || !i.classList.contains('dec')) return;
    const pos = i.selectionStart, before = i.value.slice(0, pos).replace(/[^\d.]/g, '').length;
    let v = i.value.replace(/[^\d.]/g, '');
    const dot = v.indexOf('.');
    if (dot >= 0) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
    const [ip, fp] = v.split('.');
    const ipf = ip === '' ? (fp !== undefined ? '0' : '') : Number(ip).toLocaleString('ko-KR');
    i.value = ipf + (fp !== undefined ? `.${fp}` : '');
    let k = 0, n = 0; while (k < i.value.length && n < before) { if (/[\d.]/.test(i.value[k])) n++; k++; }
    try { i.setSelectionRange(k, k); } catch { /* 일부 브라우저 */ }
  }, true);
  // 앱 안의 모든 고르기 칸(select): 휴대폰 기본 목록(화면을 꽉 채움) 대신 작은 팝업 목록
  document.addEventListener('mousedown', ev => { if (ev.target.closest && ev.target.closest('select')) ev.preventDefault(); }, true);
  document.addEventListener('click', ev => {
    const sel = ev.target.closest && ev.target.closest('select');
    if (!sel || sel.disabled) return;
    ev.preventDefault(); sel.blur();
    const row = sel.closest('.hf-row, .field');
    const lab = sel.getAttribute('aria-label') || (row && (row.querySelector('.hf-l, span') || {}).textContent) || '고르기';
    const opts = [...sel.options];
    D.openSheet(`<div class="ask"><h2 id="sheetTitle">${esc(lab.trim())}</h2><div class="sel-list">${opts.map((o, i) => `<button class="${o.selected ? 'on' : ''}" data-si="${i}"><span>${esc(o.textContent)}</span>${o.selected ? '<b>✓</b>' : ''}</button>`).join('')}</div>
      <div class="sheet-actions"><button class="btn" data-close>취소</button></div></div>`, 'pop');
    const on = $('#sheetBody .sel-list .on'); if (on) on.scrollIntoView({ block: 'center' });
    $$('#sheetBody [data-si]').forEach(b => b.onclick = () => {
      const i = Number(b.dataset.si); D.closeSheet();
      if (sel.selectedIndex === i) return;
      sel.selectedIndex = i;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }, true);
  // 앱 안의 모든 날짜·달 칸(투자 기록 포함)은 휴대폰 기본 달력 대신 위 달력 창을 씀
  document.addEventListener('click', async ev => {
    const i = ev.target.closest && ev.target.closest('input[type="date"], input[type="month"]');
    if (!i || i.disabled || i.readOnly) return;
    ev.preventDefault();
    i.blur();
    const mo = i.type === 'month';
    const v = await pickDate(i.value, { month: mo, clear: !i.required && i.dataset.clear === '1' });
    if (v === null || v === i.value) return;
    i.value = v;
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new Event('change', { bubbles: true }));
  }, true);
  // 날짜 단추: 누르면 달력 창을 열고, 고른 날짜를 data-v 에 담음
  function bindDateBtn(btn, onPick) {
    btn.onclick = async () => { const v = await pickDate(btn.dataset.v); if (v && v !== btn.dataset.v) { btn.dataset.v = v; onPick(v); } };
  }
  function pickerOnTap(root) {
    $$('input[type="date"], input[type="time"], input[type="month"]', root).forEach(i => {
      if (i.dataset.pk) return; i.dataset.pk = '1';
      if (i.type !== 'time') return;   // 날짜·달은 아래 달력 창이 맡음
      i.addEventListener('click', () => { try { i.showPicker(); } catch { /* 지원하지 않는 브라우저는 기본 동작 */ } });
    });
  }
  function bindMoneyInput(inp, allowNeg = false) {
    inp.addEventListener('input', () => {
      const neg = allowNeg && /^\s*[-−]/.test(inp.value);
      const d = inp.value.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');
      inp.value = (neg ? '-' : '') + (d ? Number(d).toLocaleString('ko-KR') : '');
    });
  }
  const moneyVal = s => { const neg = /^\s*[-−]/.test(s); const d = String(s).replace(/[^\d]/g, ''); return d ? (neg ? -1 : 1) * Number(d) : NaN; };

  /* ───────────── 내역 입력·수정 ───────────── */
  function nowTime() { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  function lastAsset(type) { const a = store.get(`dh_hla_${type}`); return a && assetNames().includes(a) ? a : ''; }

  function openForm(opts = {}) {
    const e = opts.tx || null, rule = opts.rule || null, isRule = opts.mode === 'rule';
    const src = e || rule || opts.copy || null;
    const f = {
      id: e ? e.id : null,
      type: src ? src.type : (opts.type || store.get('dh_hlt') || '지출'),
      date: e ? e.d : (opts.date || today()),
      time: e ? e.tm.slice(0, 5) : nowTime(),
      sec: e ? e.tm.slice(6, 8) : '',
      amt: src ? Math.abs(src.amt) : 0,
      neg: src ? src.amt < 0 : false,
      cat: src ? src.cat : '', sub: src ? src.sub : '',
      asset: src ? src.asset : '', to: src ? src.to : '',
      text: src ? src.text : '', memo: src ? src.memo : '',
      cur: e ? e.cur : '', famt: e ? e.famt : '',
      rule: e ? e.rule : '',
      repeat: false, period: '없음',
      rper: rule ? (rule.period || '매월') : '매월',
      rdate: rule ? (ruleNext(rule) || ruleAnchor(rule)) : (opts.date || today()),
      day: rule ? rule.day : +(opts.date || today()).slice(8, 10),
      start: rule ? rule.start : ymOf(new Date()), end: rule ? ruleEnd(rule) : '',
      // 투자 앱 연결: null = 아직 안 고름, { type: '' } = 연결 안 함
      inv: (() => {
        const x = e || rule || opts.copy;
        if (x && x.type === '수정') return x.invType === '비용' ? { type: '비용', acct: x.invAcct, sub: x.invSub, qty: '', price: '' } : null;
        if (!x || x.type !== '이체') return null;
        if (x.invType) return { type: x.invType, acct: x.invAcct, sub: x.invSub, qty: x.invQty || '', price: x.invPrice || '' };
        return { type: '' };
      })(),
    };
    const invDir = () => (f.type !== '이체' ? '' : H.inv.has(f.to) ? 'in' : H.inv.has(f.asset) ? 'out' : '');
    const invOk = () => {
      const d = invDir();
      if (!d || !f.inv || !f.inv.type) return;
      const into = f.inv.type === '입금' || f.inv.type === '매수';
      if ((d === 'in') !== into || (isRule && (f.inv.type === '매수' || f.inv.type === '매도'))) f.inv = null;
    };
    if (!src && !isRule) f.asset = lastAsset(f.type);
    if (f.type === '수정' && !e && !opts.copy) f.type = '지출';
    const title = isRule ? (rule ? '반복 내역 수정' : '반복 내역 추가') : e ? '내역 수정' : f.type;
    const actions = rule ? `<button class="icon-btn" id="hfDel" aria-label="반복 내역 삭제">${ico.trash}</button>` : '';
    const pg = pushPage({ title, body: '<div class="hf" id="hf"></div><div class="hf-picker" id="hfPicker" hidden></div>', actions, cls: 'hf-page' });
    const root = $('#hf', pg);

    function draw() {
      const tr = f.type === '이체', adj = f.type === '수정';
      invOk();
      const dir = invDir(), io = dir && D.invOptions ? D.invOptions() : null;
      const trade = f.inv && (f.inv.type === '매수' || f.inv.type === '매도');
      const item = trade && io ? io.items.find(x => x.asset === f.inv.acct && x.sub === f.inv.sub) : null;
      const usd = item && item.cur === 'USD';
      const invTxt = !f.inv ? '계좌 고르기' : !f.inv.type ? '연결 안 함' : invLabel({ invType: f.inv.type, invAcct: f.inv.acct, invSub: f.inv.sub }, io);
      root.dataset.type = { 수입: 'in', 지출: 'out', 이체: 'tr', 수정: 'adj' }[f.type];
      $('.hh-ph h2', pg).textContent = isRule ? title : e ? '내역 수정' : f.type;
      root.innerHTML = `
        ${adj ? `<div class="hf-adj">${f.inv && f.inv.type === '비용' ? '투자 비용 내역입니다.<br>이 금액이 고른 구성의 투자 손익(기타 비용)에 들어갑니다.' : '잔액 수정 내역입니다.<br>금액 앞에 −를 붙이면 잔액이 줄어듭니다.'}</div>` : `
        <div class="hf-types" role="group" aria-label="구분">
          ${['수입', '지출', '이체'].map(t => `<button data-t="${t}" class="${f.type === t ? 'on' : ''} t-${{ 수입: 'in', 지출: 'out', 이체: 'tr' }[t]}">${t}</button>`).join('')}
        </div>`}
        ${isRule ? `
        <div class="hf-row"><span class="hf-l">날짜</span>
          <div class="hf-v hf-date"><button type="button" class="hf-dt" id="rDate"><span>${dateLabel(f.rdate)}</span></button></div>
          <button class="hf-rep on" id="rPer" aria-label="반복 주기">${ico.rep}<span>${esc(f.rper)}</span></button>
        </div>
        <div class="hf-row"><span class="hf-l">종료</span><div class="hf-v"><button type="button" class="hf-dt ${f.end ? '' : 'ph'}" id="rEnd"><span>${f.end ? `${dateLabel(f.end)}까지` : '계속 반복'}</span></button></div></div>
        <p class="hf-info">${esc(perLabel(f.rper, f.rdate))} · 다음 입력 ${(() => { const pl = rule ? ruleLast(rule) : '', b = addDays(f.rdate, -1); const nd = occAfter(f.rper, f.rdate, pl && pl > b ? pl : b); return nd ? dateLabel(nd) : '없음'; })()}${rule && rule.last ? `<br>마지막으로 들어간 날: ${dateLabel(ruleLast(rule))}` : ''}</p>`
        : `
        <div class="hf-row"><span class="hf-l">날짜</span>
          <div class="hf-v hf-date">
            <button type="button" class="hf-dt" id="hfDate" data-v="${f.date}" aria-label="날짜 ${dateLabel(f.date)}"><span>${dateLabel(f.date)}</span></button>
            <label class="hf-dt"><span>${tmLabel(f.time + ':00') || '오전 12:00'}</span><input type="time" id="hfTime" value="${f.time}" aria-label="시간"></label>
          </div>
          ${!e && !adj ? `<button class="hf-rep ${f.repeat ? 'on' : ''}" id="hfRep" aria-pressed="${f.repeat}">${ico.rep}<span>${f.repeat ? esc(f.period) : '반복'}</span></button>` : ''}
        </div>`}
        ${f.repeat && !isRule ? `<p class="hf-info">반복 ${esc(perLabel(f.period, f.date))} · 다음부터 같은 내역이 자동으로 들어갑니다.</p>` : ''}
        ${e && e.rule ? `<p class="hf-info">매월 반복 내역입니다. 여기서 고치면 이번 것만 바뀝니다. 반복 자체는 더보기 → 매월 반복 내역에서 고칩니다.</p>` : ''}
        <div class="hf-row ${kp !== null ? 'kp-on' : ''}"><span class="hf-l">금액</span><div class="hf-v"><button type="button" id="hfAmt" class="hf-amt ${kp !== null || f.amt ? '' : 'ph'}" aria-label="금액">${amtShow()}</button></div></div>
        ${f.cur && f.famt !== '' ? `<p class="hf-info">외화 ${f.cur === 'USD' ? 'US$' : f.cur} ${Number(f.famt).toLocaleString('ko-KR', { minimumFractionDigits: 2 })} 내역입니다. 앱은 원화 금액으로 계산합니다.</p>` : ''}
        ${adj ? '' : `<div class="hf-row"><span class="hf-l">${tr ? '출금' : '분류'}</span><button class="hf-v hf-pick ${(tr ? f.asset : f.cat) ? '' : 'ph'}" id="hfCat">${tr ? esc(f.asset || '출금 자산') : esc(f.cat ? `${f.cat}${f.sub ? ` / ${f.sub}` : ''}` : '분류 고르기')}</button></div>`}
        <div class="hf-row"><span class="hf-l">${tr ? '입금' : '자산'}</span><button class="hf-v hf-pick ${(tr ? f.to : f.asset) ? '' : 'ph'}" id="hfAsset">${tr ? esc(f.to || '입금 자산') : esc(f.asset || '자산 고르기')}</button></div>
        ${adj && !isRule ? `<div class="hf-row"><span class="hf-l">투자</span><button class="hf-v hf-pick ${f.inv && f.inv.type === '비용' ? '' : 'ph'}" id="hfCost">${f.inv && f.inv.type === '비용' ? esc(costLabel(f.inv.acct, f.inv.sub)) : '연결 안 함 (보정)'}</button></div>` : ''}
        ${dir ? `<div class="hf-row hf-invrow"><span class="hf-l">투자 앱</span><button class="hf-v hf-pick ${f.inv ? '' : 'ph'}" id="hfInv">${esc(invTxt)}</button></div>
          ${trade ? `<div class="hf-row"><span class="hf-l">수량</span><div class="hf-v"><input id="hfQty" class="dec" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${f.inv.qty ? Number(f.inv.qty).toLocaleString('ko-KR', { maximumFractionDigits: 8 }) : ''}"><span class="hf-unit">${item ? item.unit : ''}</span></div></div>
          <div class="hf-row"><span class="hf-l">단가</span><div class="hf-v"><input id="hfPrice" class="dec" type="text" inputmode="decimal" autocomplete="off" placeholder="${item && item.price ? Number(item.price).toLocaleString('ko-KR', { maximumFractionDigits: 4 }) : '0'}" value="${f.inv.price ? Number(f.inv.price).toLocaleString('ko-KR', { maximumFractionDigits: 4 }) : ''}"><span class="hf-unit">${usd ? '달러' : '원'}</span></div></div>` : ''}
          <p class="hf-info">${!f.inv ? `투자 계좌${dir === 'in' ? '로 보내는' : '에서 찾는'} 이체입니다. 투자 앱의 어느 계좌${dir === 'in' ? '에 들어가는지' : '에서 나오는지'} 고르십시오.<br>투자 앱에 따로 적을 거면 '연결 안 함'을 고르십시오.`
            : !f.inv.type ? '투자 앱에는 기록하지 않습니다.'
            : `${isRule ? '매달 자동으로 들어갈 때 투자 앱에도 같은 금액으로 기록됩니다.' : '저장하면 투자 앱에도 같은 금액으로 기록됩니다.'}${item && f.inv.type === '매도' ? `<br>지금 보유 ${item.qty.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}주` : ''}${trade ? `<br>금액은 투자 앱의 실제 원화 금액(원금)으로 들어갑니다.` : ''}`}</p>` : ''}
        <div class="hf-row"><span class="hf-l">내용</span><div class="hf-v"><textarea id="hfText" class="hf-text" rows="1" maxlength="200" autocomplete="off" enterkeyhint="done" placeholder="${tr ? '예: 생활비 이체' : '예: 점심'}">${esc(f.text)}</textarea></div></div>
        <div class="hf-sugg" id="hfSugg"></div>
        <textarea id="hfMemo" class="hf-memo" rows="2" placeholder="메모">${esc(f.memo)}</textarea>
        <p class="form-error" id="hfErr" role="alert"></p>
        <div class="hf-btns">
          <button class="btn hf-save" id="hfSave">저장하기</button>
          ${!e && !isRule ? '<button class="btn hf-cont" id="hfCont">계속</button>' : ''}
        </div>
        ${e && !isRule ? `<div class="hf-sub-btns"><button class="btn" id="hfDel2">${ico.trash}<span>삭제</span></button><button class="btn" id="hfCopy2">${ico.copy}<span>복사</span></button></div>` : ''}`;
      bind();
    }
    function readInputs() {
      kpCommit();
      const t = $('#hfText', root); if (t) f.text = t.value;
      const m = $('#hfMemo', root); if (m) f.memo = m.value;
      const q = $('#hfQty', root); if (q && f.inv) f.inv.qty = q.value === '' ? '' : Number(q.value.replace(/,/g, ''));
      const pr = $('#hfPrice', root); if (pr && f.inv) f.inv.price = pr.value === '' ? '' : Number(pr.value.replace(/,/g, ''));
    }
    function bind() {
      $$('.hf-types [data-t]', root).forEach(b => b.onclick = () => {
        readInputs();
        const was = f.type; f.type = b.dataset.t;
        if (was !== f.type) {
          if (f.type === '이체') { f.cat = ''; f.sub = ''; f.to = ''; }
          else if (was === '이체') { f.to = ''; f.cat = ''; f.sub = ''; }
          else { f.cat = ''; f.sub = ''; }
          if (!f.asset && !isRule && !e) f.asset = lastAsset(f.type);
        }
        draw();
        // 고르기 창이 열려 있으면 바뀐 구분에 맞게 다시 그림 (수입 → 지출 분류 등)
        if (pickerOpen && was !== f.type) {
          const k = pickerKind;
          const nk = k === 'amt' ? 'amt' : f.type === '이체' ? (k === 'to' || k === 'asset' ? 'to' : 'from') : (k === 'asset' || k === 'to' ? 'asset' : 'cat');
          openPicker(nk);
        }
      });
      const fd = $('#hfDate', root); if (fd) bindDateBtn(fd, v => { readInputs(); f.date = v; f.sec = ''; draw(); });
      const ft = $('#hfTime', root); if (ft) ft.onchange = () => { if (ft.value) { readInputs(); f.time = ft.value.slice(0, 5); f.sec = ''; draw(); } };
      const rep = $('#hfRep', root); if (rep) rep.onclick = async () => { readInputs(); const v = await pickPeriod(f.repeat ? f.period : '없음', true); if (v) { f.period = v; f.repeat = v !== '없음'; draw(); } };
      const rp = $('#rPer', root); if (rp) rp.onclick = async () => { readInputs(); const v = await pickPeriod(f.rper, false); if (v) { f.rper = v; draw(); } };
      const rd = $('#rDate', root); if (rd) rd.onclick = async () => { readInputs(); const v = await pickDate(f.rdate); if (v) { f.rdate = v; draw(); } };
      const re = $('#rEnd', root); if (re) re.onclick = async () => { readInputs(); const v = await pickDate(f.end || f.rdate, { clear: true }); if (v !== null) { f.end = v; draw(); } };
      $('#hfAmt', root).onclick = () => { readInputs(); openPicker('amt'); };
      const cat = $('#hfCat', root); if (cat) cat.onclick = () => { readInputs(); openPicker(f.type === '이체' ? 'from' : 'cat'); };
      $('#hfAsset', root).onclick = () => { readInputs(); openPicker(f.type === '이체' ? 'to' : 'asset'); };
      const iv = $('#hfInv', root); if (iv) iv.onclick = () => { readInputs(); openPicker('inv'); };
      const hc = $('#hfCost', root); if (hc) hc.onclick = () => { readInputs(); if (D.ensureInv) D.ensureInv(); openPicker('cost'); };
      const txt = $('#hfText', root);
      txt.oninput = () => sugg(txt.value);
      txt.onfocus = () => sugg(txt.value);
      txt.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); txt.blur(); } };
      txt.addEventListener('input', () => autoGrow(txt)); requestAnimationFrame(() => autoGrow(txt));
      pickerOnTap(root);
      const d2 = $('#hfDel2', root); if (d2) d2.onclick = () => doDelete();
      const c2 = $('#hfCopy2', root); if (c2) c2.onclick = () => doCopy();
      requestAnimationFrame(() => autoGrow($('#hfMemo', root)));
      $('#hfSave', root).onclick = () => submit(false);
      const c = $('#hfCont', root); if (c) c.onclick = () => submit(true);
    }
    function sugg(q) {
      const box = $('#hfSugg', root);
      q = q.trim().toLowerCase();
      const seen = new Set(), out = [];
      for (const t of H.tx) {
        if (out.length >= 6) break;
        if (t.type !== f.type || !t.text) continue;
        if (q ? !t.text.toLowerCase().includes(q) : !(f.cat && t.cat === f.cat && (!f.sub || t.sub === f.sub))) continue;
        const k = `${t.text}|${t.cat}|${t.sub}|${t.asset}|${t.to}`;
        if (seen.has(k)) continue;
        seen.add(k); out.push(t);
      }
      box.innerHTML = out.map((t, i) => `<button type="button" class="hf-chip" data-i="${i}"><b>${esc(t.text)}</b><small>${t.type === '이체' ? `${esc(t.asset)} → ${esc(t.to)}` : esc([t.sub || t.cat, t.asset].filter(Boolean).join(' · '))} · ${fmt(t.amt)}원</small></button>`).join('');
      $$('.hf-chip', box).forEach(b => b.onpointerdown = ev => {
        ev.preventDefault();
        const t = out[Number(b.dataset.i)];
        readInputs();
        f.text = t.text;
        if (!f.amt) f.amt = t.amt;
        if (f.type === '이체') { if (!f.asset) f.asset = t.asset; if (!f.to) f.to = t.to; }
        else { if (!f.cat) { f.cat = t.cat; f.sub = t.sub; } if (!f.asset) f.asset = t.asset; }
        draw();
      });
    }

    // 아래에서 올라오는 고르기 창 (분류 → 소분류, 자산)
    let pickerOpen = false, pickerKind = '';
    // 금액 숫자판 (편한가계부와 같은 모양). kp: 입력 중인 식 ('17300+2500'), null 이면 닫힘
    let kp = null, kpFresh = false, kpCalc = false;
    function kpEval(ex) {
      ex = String(ex || '').replace(/[-+*/]+$/, '');
      if (!ex || ex === '-') return 0;
      const tk = ex.match(/^-?\d+|[-+*/]|\d+/g) || [];
      const terms = []; let op = '+', cur = null;
      const flush = () => { if (cur !== null) terms.push(cur); };
      for (const t of tk) {
        if (/^[-+*/]$/.test(t)) { op = t; continue; }
        const n = Number(t);
        if (op === '*' || op === '/') cur = op === '*' ? cur * n : (n ? cur / n : cur);
        else { flush(); cur = op === '-' ? -n : n; }
      }
      flush();
      return Math.round(terms.reduce((a, b) => a + b, 0));
    }
    function kpCommit() { if (kp === null) return; const v = kpEval(kp); f.amt = Math.abs(v); f.neg = f.type === '수정' && v < 0; kp = null; kpCalc = false; }
    function amtShow() {
      if (kp === null) return f.amt ? `${f.neg ? '−' : ''}${fmt(f.amt)}<span class="u">원</span>` : '0<span class="u">원</span>';
      if (!kp) return '0<span class="u">원</span>';
      const body = kp.replace(/\d+/g, d => Number(d).toLocaleString('ko-KR')).replace(/^-/, '−').replace(/(.)([-+*/])/g, (m, a, o) => `${a} ${({ '-': '−', '+': '+', '*': '×', '/': '÷' })[o]} `);
      const ops = /\d[-+*/]/.test(kp);
      const r = ops ? kpEval(kp) : null;
      return `${body}${ops ? '' : '<span class="u">원</span>'}${ops ? `<small class="kp-res">= ${r < 0 ? '−' : ''}${fmt(Math.abs(r))}원</small>` : ''}`;
    }
    function openPicker(kind) {
      pickerKind = kind;
      const box = $('#hfPicker', pg);
      const close = () => { box.hidden = true; box.innerHTML = ''; box.classList.remove('kp'); pickerOpen = false; pg.classList.remove('picking', 'kping'); if (kp !== null) { kpCommit(); draw(); } };
      if (!pickerOpen) { pickerOpen = true; pushState(close); }
      if (kind !== 'amt' && kp !== null) { kpCommit(); draw(); }
      pg.classList.add('picking');
      pg.classList.toggle('kping', kind === 'amt');
      box.classList.toggle('kp', kind === 'amt');
      box.hidden = false;
      const done = next => {
        draw();
        if (next) { openPicker(next); return; }
        back();
        setTimeout(() => { const t = $('#hfText', root); if (t && !f.text) t.focus(); }, 260);
      };
      if (kind === 'amt') {
        if (kp === null) { kp = f.amt ? `${f.neg ? '-' : ''}${f.amt}` : ''; kpFresh = true; }
        const allowNeg = f.type === '수정';
        const k = (v, lab, cls = '') => `<button class="kp-k ${cls}" data-k="${v}">${lab}</button>`;
        const paint = () => {
          const a = $('#hfAmt', root); if (a) { a.innerHTML = amtShow(); a.classList.remove('ph'); }
          const row = a && a.closest('.hf-row'); if (row) row.classList.add('kp-on');
          $('#kpOps', box).hidden = !kpCalc; $('[data-k="calc"]', box).classList.toggle('on', kpCalc);
        };
        box.innerHTML = `<div class="pk-head"><b>금액</b><button class="icon-btn" id="pkX" aria-label="닫기">${ico.close}</button></div>
          <div class="kp-ops" id="kpOps" ${kpCalc ? '' : 'hidden'}>${k('+', '+')}${k('*', '×')}${k('/', '÷')}${k('=', '=')}</div>
          <div class="kp-grid">${k(1, 1)}${k(2, 2)}${k(3, 3)}${k('bs', ico.bksp, 'fn')}${k(4, 4)}${k(5, 5)}${k(6, 6)}${k('-', '−', 'fn')}${k(7, 7)}${k(8, 8)}${k(9, 9)}${k('calc', ico.calc, 'fn')}${k('00', '00')}${k(0, 0)}${k('000', '000')}${k('ok', '완료', 'ok')}</div>`;
        box.style.setProperty('--kc', f.type === '수입' ? 'var(--inc)' : f.type === '지출' ? 'var(--exp)' : 'var(--ink)');
        box.style.setProperty('--kt', f.type === '수입' || f.type === '지출' ? '#fff' : 'var(--bg)');
        $('#pkX', box).onclick = () => back();
        $$('[data-k]', box).forEach(b => b.onclick = () => {
          const v = b.dataset.k;
          if (v === 'ok') { kpCommit(); draw(); if (f.type === '수정') { back(); setTimeout(() => { const t = $('#hfText', root); if (t) t.focus(); }, 260); } else openPicker(f.type === '이체' ? 'from' : 'cat'); return; }
          if (v === 'calc') { kpCalc = !kpCalc; paint(); return; }
          if (v === '=') { const r = kpEval(kp); kp = r ? String(r) : ''; kpFresh = true; paint(); return; }
          if (v === 'bs') { kp = kp.slice(0, -1); kpFresh = false; paint(); return; }
          if (/^[-+*/]$/.test(v)) {
            kpFresh = false;
            if (kp === '' || kp === '-') { if (v === '-' && allowNeg) kp = '-'; paint(); return; }
            kp = /[-+*/]$/.test(kp) ? kp.slice(0, -1) + v : kp + v;
            if (v !== '-' || /[+*/]/.test(kp)) kpCalc = true;
            paint(); return;
          }
          if (kpFresh) { kp = ''; kpFresh = false; }
          const last = kp.split(/[-+*/]/).pop();
          if (last.length + v.length > 13) return;
          if (last === '0' || (last === '' && /^0+$/.test(v))) { if (v === '0' || v === '00' || v === '000') return; kp = kp.slice(0, -1); }
          kp += v; paint();
        });
        return;
      }
      if (kind === 'cost' || kind.startsWith('cost:')) {
        const step = kind.startsWith('cost:') ? kind.slice(5) : '';
        const cur = f.inv && f.inv.type === '비용' ? { kind: (kindOf(f.inv.acct) || {}).kind, asset: f.inv.acct, sub: f.inv.sub } : null;
        box.innerHTML = `<div class="pk-head">${step ? `<button class="icon-btn" id="pkB" aria-label="구성으로">${ico.left}</button>` : ''}<b>${step ? `${esc(step)} · 종목` : '투자 비용으로 넣을 구성'}</b><button class="icon-btn" id="pkX" aria-label="닫기">${ico.close}</button></div>
          <div class="pk-assets"><div class="pk-grid">${costPickHtml(cur, step, 'data-c')}</div>
            ${step ? '' : `<button class="pk-inv none ${!cur ? 'on' : ''}" data-c-none="1"><span>연결 안 함 (보정)</span><small>수입·지출에도 투자 손익에도 넣지 않음</small></button>`}</div>`;
        $('#pkX', box).onclick = () => back();
        const pb = $('#pkB', box); if (pb) pb.onclick = () => openPicker('cost');
        const nb = $('[data-c-none]', box); if (nb) nb.onclick = () => { f.inv = null; done(null); };
        $$('[data-c-k]', box).forEach(b => b.onclick = () => { const k = invKinds().find(x => x.kind === b.dataset.cK); if (k && k.items.length) openPicker(`cost:${k.kind}`); else { const sl = costSel(b.dataset.cK, ''); f.inv = { type: '비용', acct: sl.asset, sub: sl.sub, qty: '', price: '' }; done(null); } });
        $$('[data-c-i]', box).forEach(b => b.onclick = () => { const sl = costSel(step, b.dataset.cI); f.inv = { type: '비용', acct: sl.asset, sub: sl.sub, qty: '', price: '' }; done(null); });
        return;
      }
      if (kind === 'inv') {
        const dir = invDir(), o = D.invOptions ? D.invOptions() : null;
        if (!o) { box.innerHTML = `<div class="pk-head"><b>투자 앱</b><button class="icon-btn" id="pkX" aria-label="닫기">${ico.close}</button></div><p class="empty">투자 앱 자료를 불러오는 중입니다.<br>잠시 뒤 다시 누르십시오.</p>`; $('#pkX', box).onclick = () => back(); if (D.ensureInv) D.ensureInv(); return; }
        const inT = dir === 'in' ? '입금' : '출금', trT = dir === 'in' ? '매수' : '매도';
        const items = isRule ? [] : o.items.filter(x => dir === 'in' || x.qty > 0);
        const cur = f.inv || {};
        const btn = (ty, a, sb, lab, sm) => `<button class="pk-inv ${cur.type === ty && cur.acct === a && (cur.sub || '') === (sb || '') ? 'on' : ''}" data-ty="${ty}" data-a="${esc(a)}" data-s="${esc(sb)}"><span>${esc(lab)}</span>${sm ? `<small>${esc(sm)}</small>` : ''}</button>`;
        box.innerHTML = `<div class="pk-head"><b>투자 앱 ${dir === 'in' ? '(들어가는 곳)' : '(나오는 곳)'}</b><button class="icon-btn" id="pkX" aria-label="닫기">${ico.close}</button></div>
          <div class="pk-assets">
            <div class="pk-g">예수금 ${inT}</div><div class="pk-list">${o.acc.map(x => btn(inT, x.asset, x.sub, x.label, x.cur === 'USD' ? '원화 금액을 환율로 달러로 바꿔 넣습니다' : '')).join('')}</div>
            ${(o.manual || []).length ? `<div class="pk-g">원금 ${dir === 'in' ? '추가' : '빼기'} <small>금액만 직접 관리하는 항목 · 원금과 평가금이 함께 바뀜</small></div><div class="pk-list">${o.manual.map(x => btn(inT, x.asset, x.sub, x.label, `${x.kind} · 원금 ${won(x.cost)}`)).join('')}</div>` : ''}
            ${items.length ? `<div class="pk-g">바로 ${trT} <small>예수금 없이 사고파는 종목 · 수량·단가 입력</small></div><div class="pk-list">${items.map(x => btn(trT, x.asset, x.sub, x.label, `${x.kind} · 보유 ${x.qty.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}${x.unit || ''}`)).join('')}</div>` : ''}
            <div class="pk-list"><button class="pk-inv none ${f.inv && !f.inv.type ? 'on' : ''}" data-ty="" data-a="" data-s=""><span>연결 안 함</span><small>투자 앱에 따로 적거나 기록하지 않을 때</small></button></div>
          </div>`;
        $$('[data-ty]', box).forEach(b => b.onclick = () => {
          const ty = b.dataset.ty;
          const keep = f.inv && f.inv.type === ty && f.inv.acct === b.dataset.a && f.inv.sub === b.dataset.s;
          f.inv = ty ? { type: ty, acct: b.dataset.a, sub: b.dataset.s, qty: keep ? f.inv.qty : '', price: keep ? f.inv.price : '' } : { type: '' };
          done(null);
          if (ty === '매수' || ty === '매도') setTimeout(() => { const q = $('#hfQty', root); if (q && !q.value) q.focus(); }, 280);
        });
        $('#pkX', box).onclick = () => back();
        return;
      }
      if (kind === 'cat') {
        const list = H.cats[f.type] || [];
        let active = list.find(c => c.name === f.cat) || null;
        const paint = () => {
          box.innerHTML = `<div class="pk-head"><b>분류</b><button class="icon-btn" id="pkEdit" aria-label="분류 설정">${ico.pen}</button><button class="icon-btn" id="pkX" aria-label="닫기">${ico.close}</button></div>
            <div class="pk-cols">
              <div class="pk-col">${list.map((c, i) => `<button class="pk-item ${active === c ? 'on' : ''}" data-ci="${i}"><span>${esc(c.name)}</span>${c.subs.length ? ico.chev : ''}</button>`).join('') || '<p class="empty">분류가 없습니다.</p>'}</div>
              <div class="pk-col sub">${active ? active.subs.map(s => `<button class="pk-item ${f.cat === active.name && f.sub === s ? 'on' : ''}" data-s="${esc(s)}">${esc(s)}</button>`).join('') : ''}</div>
            </div>`;
          $$('[data-ci]', box).forEach(b => b.onclick = () => {
            const c = list[Number(b.dataset.ci)];
            if (!c.subs.length) { f.cat = c.name; f.sub = ''; done(!f.asset ? 'asset' : null); return; }
            active = c; paint();
          });
          $$('[data-s]', box).forEach(b => b.onclick = () => { f.cat = active.name; f.sub = b.dataset.s; done(!f.asset ? 'asset' : null); });
          $('#pkX', box).onclick = () => back();
          $('#pkEdit', box).onclick = () => back(1, () => openCatSettings(f.type));
        };
        paint();
      } else {
        const groups = new Map();
        H.assets.filter(a => !a.hidden).forEach(a => { let g = groups.get(a.group); if (!g) groups.set(a.group, (g = [])); g.push(a); });
        const cur = kind === 'to' ? f.to : f.asset;
        box.innerHTML = `<div class="pk-head"><b>${kind === 'from' ? '출금' : kind === 'to' ? '입금' : '자산'}</b><button class="icon-btn" id="pkEdit" aria-label="자산 설정">${ico.pen}</button><button class="icon-btn" id="pkX" aria-label="닫기">${ico.close}</button></div>
          <div class="pk-assets">${[...groups].map(([g, l]) => `<div class="pk-g">${esc(g)}</div><div class="pk-grid">${l.map(a => `<button class="pk-a ${a.name === cur ? 'on' : ''}" data-a="${esc(a.name)}">${esc(a.name)}</button>`).join('')}</div>`).join('') || '<p class="empty">자산이 없습니다.</p>'}</div>`;
        $$('[data-a]', box).forEach(b => b.onclick = () => {
          const a = b.dataset.a;
          if (kind === 'to') f.to = a; else f.asset = a;
          invOk();
          if (kind === 'from') done(!f.to ? 'to' : (invDir() && !f.inv ? 'inv' : null));
          else done(kind === 'to' && invDir() && !f.inv ? 'inv' : null);
        });
        $('#pkX', box).onclick = () => back();
        $('#pkEdit', box).onclick = () => back(1, () => openAssetSettings('all'));
      }
    }

    async function submit(cont) {
      readInputs();
      const err = $('#hfErr', root);
      const amount = f.neg ? -f.amt : f.amt;
      const fail = m => { err.textContent = m; };
      if (f.type === '수정' ? !amount : !(f.amt > 0)) return fail('금액을 입력하십시오.');
      if (f.type === '수정' && f.inv && f.inv.type === '비용' && amount > 0) return fail('투자 비용은 금액 앞에 −를 붙여 잔액이 줄도록 입력하십시오.');
      if (f.type === '이체') {
        if (!f.asset) return fail('출금 자산을 고르십시오.');
        if (!f.to) return fail('입금 자산을 고르십시오.');
        if (f.asset === f.to) return fail('출금·입금 자산이 같습니다.');
        if (invDir()) {
          if (!f.inv) return fail('투자 앱 계좌를 고르십시오. 기록하지 않으려면 연결 안 함을 고르십시오.');
          if (f.inv.type === '매수' || f.inv.type === '매도') {
            if (!(f.inv.qty > 0)) return fail('수량을 입력하십시오.');
            if (!(f.inv.price > 0)) return fail('단가를 입력하십시오.');
            const o = D.invOptions && D.invOptions(), it = o && o.items.find(x => x.asset === f.inv.acct && x.sub === f.inv.sub);
            const had = e && e.invType === '매도' && e.invAcct === f.inv.acct && e.invSub === f.inv.sub ? Number(e.invQty) || 0 : 0;
            if (f.inv.type === '매도' && it && f.inv.qty > it.qty + had + 1e-9) return fail(`보유 수량(${it.qty})보다 많이 팔 수 없습니다.`);
          }
        }
      } else {
        if (f.type !== '수정' && !f.cat) return fail('분류를 고르십시오.');
        if (!f.asset) return fail('자산을 고르십시오.');
      }
      const by = store.get('dh_name') || '';
      if (isRule) {
        if (f.end && f.end < f.rdate) return fail('종료 날짜가 다음 입력 날짜보다 앞입니다.');
        const li = invDir() && f.inv && f.inv.type ? f.inv : null;
        const r = { id: rule ? rule.id : newId('r'), day: f.day, type: f.type, cat: f.type === '이체' ? '' : f.cat, sub: f.type === '이체' ? '' : f.sub, text: f.text.trim(), amt: f.amt, asset: f.asset, to: f.type === '이체' ? f.to : '', memo: f.memo.trim(), start: rule ? rule.start : f.rdate, end: f.end, last: rule ? rule.last : addDays(f.rdate, -1), period: f.rper, invType: li ? li.type : '', invAcct: li ? li.acct : '', invSub: li ? li.sub : '' };
        // 날짜나 주기를 바꾸면 그 날짜부터 새로 셈 (안 바꾸면 기존 기준 그대로)
        if (!rule || f.rper !== (rule.period || '매월') || f.rdate !== (ruleNext(rule) || ruleAnchor(rule))) {
          r.start = f.rdate; r.day = +f.rdate.slice(8); r.last = addDays(f.rdate, -1);
          if (rule && rule.last) { const ol = ruleLast(rule); if (ol > r.last) r.last = ol; }   // 이미 들어간 날 이전 것은 다시 넣지 않음
        }
        const btn = $('#hfSave', root); btn.disabled = true; btn.textContent = '저장 중…';
        try {
          await D.api('hhSave', { rule: ruleObj(r) });
          const i = H.rules.findIndex(x => x.id === r.id);
          if (i >= 0) H.rules[i] = r; else H.rules.push(r);
          saveCache(); refreshPages(); render(); back(); toast('반복 내역을 저장했습니다');
          if (f.rdate <= today()) load({ quiet: true });   // 오늘까지 들어갈 것이 있으면 바로 채움
        } catch (ex) { btn.disabled = false; btn.textContent = '저장하기'; fail(ex.message); }
        return;
      }
      const sec = f.sec && e && e.d === f.date && e.tm.slice(0, 5) === f.time ? f.sec : pad(new Date().getSeconds());
      const t = toTx([f.id || newId('n'), `${f.date} ${f.time}:${sec}`, f.type, f.type === '이체' || f.type === '수정' ? (f.type === '수정' ? (e ? e.cat : '잔액수정') : '') : f.cat,
        f.type === '이체' || f.type === '수정' ? '' : f.sub, f.text.trim(), amount, f.asset, f.type === '이체' ? f.to : '', f.memo.trim(),
        e && e.amt === amount ? f.cur : '', e && e.amt === amount ? f.famt : '', f.rule, e ? (e.by || by) : by,
        ...((invDir() || (f.type === '수정' && f.inv && f.inv.type === '비용')) && f.inv && f.inv.type ? [f.inv.type, f.inv.acct, f.inv.sub, f.inv.qty === '' ? '' : f.inv.qty, f.inv.price === '' ? '' : f.inv.price] : ['', '', '', '', ''])]);
      let newRule = null;
      if (f.repeat && !e) {
        const rl = t.invType === '입금' || t.invType === '출금';
        newRule = { id: newId('r'), period: f.period, day: +f.date.slice(8), type: t.type, cat: t.cat, sub: t.sub, text: t.text, amt: t.amt, asset: t.asset, to: t.to, memo: t.memo, start: f.date, end: '', last: f.date, invType: rl ? t.invType : '', invAcct: rl ? t.invAcct : '', invSub: rl ? t.invSub : '' };
        t.rule = newRule.id;
      }
      store.set('dh_hlt', f.type);
      if (f.type !== '수정') store.set(`dh_hla_${f.type}`, f.asset);
      if (cont) {
        commitTx(t, e, newRule);
        Object.assign(f, { amt: 0, neg: false, cat: '', sub: '', text: '', memo: '', repeat: false, period: '없음', to: '', inv: null });
        draw();
        setTimeout(() => openPicker('amt'), 50);
        toast('저장했습니다. 이어서 입력하십시오');
      } else {
        back();
        commitTx(t, e, newRule);
      }
    }

    draw();
    const del = $('#hfDel', pg);
    if (del) del.onclick = () => doDelete();
    async function doDelete() {
      if (rule) {
        if (!(await askConfirm('이 반복 내역을 지울까요?', '앞으로 자동 입력만 멈추고, 이미 들어간 내역은 그대로 남습니다.', '삭제'))) return;
        try { await D.api('hhDel', { kind: 'rule', id: rule.id }); H.rules = H.rules.filter(x => x.id !== rule.id); saveCache(); refreshPages(); back(); toast('반복 내역을 지웠습니다'); }
        catch (ex) { toast(`삭제 실패: ${ex.message}`, true); }
        return;
      }
      if (!(await askConfirm('이 내역을 지울까요?', `${esc(e.text || e.cat || e.type)} · ${won(Math.abs(e.amt))}`, '삭제'))) return;
      back();
      removeTx(e);
    }
    // 복사: 같은 내용(투자 앱 연결 포함)으로 새 입력 화면을 열고, 날짜·시간만 지금으로. 저장은 직접
    function doCopy() { back(1, () => openForm({ copy: e, date: today() })); }
    if (!e && !isRule && !opts.copy) setTimeout(() => openPicker('amt'), 280);
  }

  // 화면에 먼저 반영하고 서버에 저장. 실패하면 되돌림
  async function commitTx(t, old, rule, msg) {
    H.pending.set(t.id, t);
    const i = H.tx.findIndex(x => x.id === t.id);
    if (i >= 0) H.tx[i] = t; else H.tx.push(t);
    if (rule) H.rules.push(rule);
    reindex(); rerender();
    try {
      const j = await D.api('hhSave', { tx: txObj(t), ...(rule ? { rule: ruleObj(rule) } : {}) });
      H.pending.delete(t.id);
      const saved = toTx(j.tx);
      const k = H.tx.findIndex(x => x.id === t.id);
      if (k >= 0) H.tx[k] = saved; else H.tx.push(saved);
      reindex(); rerender(); saveCache();
      const linked = t.invType || (old && old.invType);
      if (linked && D.reloadInv) D.reloadInv();
      toast(`${msg || (old ? '수정했습니다' : '저장했습니다')}${j.inv && j.inv.type === '비용' ? ` · 투자 손익에 비용 ${swon(-j.inv.amountKrw)}` : j.inv ? ` · 투자 앱 ${j.inv.type} 기록${j.inv.realized != null && j.inv.realized !== '' ? ` (${j.inv.realized >= 0 ? '익절' : '손절'} ${swon(j.inv.realized)})` : ''}` : ''}`);
    } catch (ex) {
      H.pending.delete(t.id);
      const k = H.tx.findIndex(x => x.id === t.id);
      if (old) H.tx[k] = old; else if (k >= 0) H.tx.splice(k, 1);
      if (rule) H.rules = H.rules.filter(x => x.id !== rule.id);
      reindex(); rerender();
      if (ex.code === 'auth') { D.logout('비밀번호를 다시 입력하십시오.'); return; }
      toast(`저장하지 못했습니다: ${ex.message}`, true);
      setTimeout(() => openForm(old ? { tx: old } : { copy: t, date: t.d }), 300);
    }
  }
  async function removeTx(t) {
    const i = H.tx.findIndex(x => x.id === t.id);
    if (i < 0) return;
    H.tx.splice(i, 1); reindex(); rerender();
    try { const j = await D.api('hhDel', { kind: 'tx', id: t.id }); saveCache(); if (t.invType && D.reloadInv) D.reloadInv(); toast(j && j.invUndone ? '지웠습니다 · 투자 앱 기록도 되돌렸습니다' : '지웠습니다'); }
    catch (ex) { H.tx.push(t); reindex(); rerender(); toast(`삭제 실패: ${ex.message}`, true); }
  }
  function rerender() { const y = window.scrollY; render(); window.scrollTo({ top: y }); refreshPages(); }

  /* ───────────── 메모 ───────────── */
  function openMemo(m) {
    const isNew = !m;
    const date = m ? m.date : (H.ym === ymOf(new Date()) ? today() : `${H.ym}-01`);
    const pg = pushPage({
      title: isNew ? '새 메모' : '메모', cls: 'hf-page',
      actions: isNew ? '' : `<button class="icon-btn" id="mDel" aria-label="메모 삭제">${ico.trash}</button>`,
      body: `<div class="hf">
        <div class="hf-row"><span class="hf-l">날짜</span><div class="hf-v hf-date"><button type="button" class="hf-dt" id="mDate" data-v="${date}" aria-label="날짜"><span id="mDateTxt">${dateLabel(date)}</span></button></div></div>
        <textarea id="mText" class="hf-memo big" rows="14" placeholder="첫 줄은 제목처럼 굵게 보입니다">${esc(m ? m.text : '')}</textarea>
        <p class="form-error" id="mErr" role="alert"></p>
        <div class="hf-btns"><button class="btn hf-save memo" id="mSave">저장하기</button></div></div>`,
    });
    pickerOnTap(pg);
    requestAnimationFrame(() => autoGrow($('#mText', pg)));
    const di = $('#mDate', pg);
    bindDateBtn(di, v => { $('#mDateTxt', pg).textContent = dateLabel(v); });
    $('#mSave', pg).onclick = async () => {
      const text = $('#mText', pg).value.trim();
      if (!text) { $('#mErr', pg).textContent = '내용을 입력하십시오.'; return; }
      const obj = { id: m ? m.id : newId('m'), date: di.dataset.v || date, text, by: m ? m.by : (store.get('dh_name') || '') };
      const btn = $('#mSave', pg); btn.disabled = true; btn.textContent = '저장 중…';
      try {
        await D.api('hhSave', { memo: { ID: obj.id, 날짜: obj.date, 내용: obj.text, 입력자: obj.by } });
        const i = H.memos.findIndex(x => x.id === obj.id);
        if (i >= 0) H.memos[i] = obj; else H.memos.push(obj);
        saveCache(); back(); rerender(); toast('메모를 저장했습니다');
      } catch (ex) { btn.disabled = false; btn.textContent = '저장하기'; $('#mErr', pg).textContent = ex.message; }
    };
    const del = $('#mDel', pg);
    if (del) del.onclick = async () => {
      if (!(await askConfirm('이 메모를 지울까요?', '', '삭제'))) return;
      try { await D.api('hhDel', { kind: 'memo', id: m.id }); H.memos = H.memos.filter(x => x.id !== m.id); saveCache(); back(); rerender(); toast('메모를 지웠습니다'); }
      catch (ex) { toast(`삭제 실패: ${ex.message}`, true); }
    };
    if (isNew) setTimeout(() => $('#mText', pg).focus(), 280);
  }

  /* ───────────── 검색 ───────────── */
  function openSearch() {
    const pg = pushPage({ title: '내역 검색', body: `<div class="hh-search"><input id="sQ" type="search" enterkeyhint="search" placeholder="내용, 분류, 자산, 메모, 금액" autocomplete="off"></div><div id="sRes"></div>` });
    const q = $('#sQ', pg), res = $('#sRes', pg);
    let tm;
    const run = () => {
      const s = q.value.trim().toLowerCase();
      if (!s) { res.innerHTML = '<p class="empty">찾을 말을 입력하십시오.</p>'; return; }
      const digits = s.replace(/[^\d]/g, '');
      const hit = H.tx.filter(t => [t.text, t.memo, t.cat, t.sub, t.asset, t.to].some(x => x && x.toLowerCase().includes(s)) || (digits.length >= 3 && String(Math.abs(t.amt)).includes(digits)));
      const sm = sums(hit);
      const show = hit.slice(0, 300);
      res.innerHTML = `<div class="card hs-sum num"><span>${fmt(hit.length)}건</span><span class="inc">수입 ${won(sm.inc)}</span><span class="exp">지출 ${won(sm.exp)}</span></div>
        ${show.length ? `<section class="card hd">${show.map(t => rowHtml(t, { showDate: true })).join('')}</section>` : '<p class="empty">찾은 내역이 없습니다.</p>'}
        ${hit.length > show.length ? `<p class="note">최근 ${show.length}건만 보입니다. 더 자세히 입력하십시오.</p>` : ''}`;
      bindRows(res);
    };
    q.oninput = () => { clearTimeout(tm); tm = setTimeout(run, 160); };
    run();
    setTimeout(() => q.focus(), 280);
  }

  /* ───────────── 설정: 분류 ───────────── */
  async function saveSettings(payload, okMsg) {
    try { await D.api('hhSettings', payload); saveCache(); if (okMsg) toast(okMsg); return true; }
    catch (ex) { toast(`저장하지 못했습니다: ${ex.message}`, true); load(); return false; }
  }
  function renameLocal(rn) {
    if (rn.what === 'move') {
      const hit = o => o.type === rn.type && o.cat === rn.fromCat && (rn.fromSub === null || (o.sub || '') === rn.fromSub);
      const mv = o => { if (hit(o)) { o.cat = rn.toCat; o.sub = rn.toSub; } };
      H.tx.forEach(mv); H.rules.forEach(mv);
      if (rn.type === '지출') {
        const k0 = rn.fromSub === null ? BK(rn.fromCat, '') : BK(rn.fromCat, rn.fromSub);
        if (H.budgets.has(k0)) { const e = H.budgets.get(k0); H.budgets.delete(k0); H.budgets.set(BK(rn.toCat, rn.toSub), e); }
        if (rn.fromSub === null) [...H.budgets.keys()].filter(k => k.startsWith(rn.fromCat + '\u0001')).forEach(k => H.budgets.delete(k));
      }
      reindex(); return;
    }
    const fix = o => {
      if (rn.what === 'asset') { if (o.asset === rn.from) o.asset = rn.to; if (o.to === rn.from) o.to = rn.to; }
      else if (o.type === rn.type) {
        if (rn.what === 'cat' && o.cat === rn.from) o.cat = rn.to;
        if (rn.what === 'sub' && o.cat === rn.cat && o.sub === rn.from) o.sub = rn.to;
      }
    };
    H.tx.forEach(fix); H.rules.forEach(fix);
    if (rn.what === 'asset') H.assets.forEach(a => { if (a.link === rn.from) a.link = rn.to; });
    if (rn.type === '지출' && (rn.what === 'cat' || rn.what === 'sub')) {
      H.budgets = new Map([...H.budgets].map(([k, v]) => {
        const [c, sb] = k.split('\u0001');
        if (rn.what === 'cat' && c === rn.from) return [BK(rn.to, sb), v];
        if (rn.what === 'sub' && c === rn.cat && sb === rn.from) return [BK(c, rn.to), v];
        return [k, v];
      }));
    }
    reindex();
  }
  function listEditor(pg, { items, label, sub, onOpen, onRename, onDelete, onMove }) {
    const body = $('.hh-pbody', pg);
    body.innerHTML = `<div class="card se-list">${items.map((it, i) => `<div class="se-row" data-i="${i}">
      <button class="se-del" data-del="${i}" aria-label="${esc(label(it))} 삭제">${ico.del}</button>
      <button class="se-name" data-open="${i}" ${onOpen ? '' : 'tabindex="-1"'}><span>${esc(label(it))}</span>${sub ? `<small>${esc(sub(it))}</small>` : ''}</button>
      <button class="se-ed" data-ren="${i}" aria-label="이름 바꾸기">${ico.pen}</button>
      <span class="se-drag" data-drag="${i}" aria-label="끌어서 순서 바꾸기">${ico.drag}</span>
    </div>`).join('') || '<p class="empty">항목이 없습니다. 오른쪽 위 + 로 추가하십시오.</p>'}</div>
    <p class="note">≡ 를 끌어서 순서를 바꿉니다.<br>이름을 바꾸면 지난 내역의 이름도 함께 바뀝니다.</p>`;
    $$('[data-open]', body).forEach(b => b.onclick = () => onOpen && onOpen(Number(b.dataset.open)));
    $$('[data-ren]', body).forEach(b => b.onclick = () => onRename(Number(b.dataset.ren)));
    $$('[data-del]', body).forEach(b => b.onclick = () => onDelete(Number(b.dataset.del)));
    dragSort($('.se-list', body), onMove);
  }
  // 손가락으로 ≡ 를 끌어 순서 바꾸기
  function dragSort(list, onMove) {
    if (!list) return;
    $$('.se-drag', list).forEach(h => {
      h.onpointerdown = ev => {
        ev.preventDefault();
        const row = h.closest('.se-row'), rows = $$('.se-row', list), from = rows.indexOf(row);
        const rh = row.offsetHeight, startY = ev.clientY;
        let to = from;
        row.classList.add('dragging');
        h.setPointerCapture(ev.pointerId);
        const move = e2 => {
          const dy = e2.clientY - startY;
          row.style.transform = `translateY(${dy}px)`;
          to = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / rh)));
          rows.forEach((r, i) => {
            if (r === row) return;
            let sh = 0;
            if (from < to && i > from && i <= to) sh = -rh;
            if (from > to && i < from && i >= to) sh = rh;
            r.style.transform = sh ? `translateY(${sh}px)` : '';
          });
        };
        const up = () => {
          h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
          rows.forEach(r => { r.style.transform = ''; }); row.classList.remove('dragging');
          if (to !== from) onMove(from, to);
        };
        h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
      };
    });
  }
  const moveItem = (arr, a, b) => { const [x] = arr.splice(a, 1); arr.splice(b, 0, x); };

  function openCatSettings(type) {
    const pg = pushPage({ title: `${type} 분류`, actions: `<button class="icon-btn" id="cAdd" aria-label="분류 추가">${ico.plus}</button>`, body: '', refresh: p => draw(p) });
    const used = name => H.tx.some(t => t.type === type && t.cat === name);
    function draw(p = pg) {
      const list = H.cats[type];
      listEditor(p, {
        items: list, label: c => `${c.name} (${c.subs.length})`, sub: c => c.subs.join(', '),
        onOpen: i => openSubSettings(type, list[i]),
        onRename: i => openCatEdit(type, list[i]),
        onDelete: async i => {
          const c = list[i];
          if (!(await askConfirm(`'${c.name}' 분류를 지울까요?`, used(c.name) ? '이 분류로 적힌 지난 내역은 그대로 남습니다. 새로 입력할 때 목록에서만 빠집니다.' : '', '삭제'))) return;
          list.splice(i, 1); draw(); saveSettings({ cats: catsArr() }, '분류를 지웠습니다');
        },
        onMove: (a, b) => { moveItem(list, a, b); draw(); saveSettings({ cats: catsArr() }); },
      });
    }
    draw();
    $('#cAdd', pg).onclick = async () => {
      const v = await askText(`${type} 분류 추가`, '', { placeholder: '예: 🍜 식비', ok: '추가' });
      if (!v) return;
      if (H.cats[type].some(x => x.name === v)) { toast('같은 이름의 분류가 있습니다', true); return; }
      H.cats[type].push({ name: v, subs: [] }); draw(); saveSettings({ cats: catsArr() }, '분류를 추가했습니다');
    };
  }
  function openSubSettings(type, cat) {
    const pg = pushPage({ title: esc(cat.name), actions: `<button class="icon-btn" id="sRen" aria-label="분류 수정">${ico.pen}</button><button class="icon-btn" id="sAdd" aria-label="소분류 추가">${ico.plus}</button>`, body: '', refresh: p => { $('.hh-ph h2', p).textContent = cat.name; draw(p); } });
    function draw(p = pg) {
      listEditor(p, {
        items: cat.subs, label: s => s, sub: null, onOpen: null,
        onRename: i => openSubEdit(type, cat, cat.subs[i]),
        onDelete: async i => {
          if (!(await askConfirm(`'${cat.subs[i]}' 소분류를 지울까요?`, '지난 내역은 그대로 남습니다.', '삭제'))) return;
          cat.subs.splice(i, 1); draw(); saveSettings({ cats: catsArr() }, '소분류를 지웠습니다');
        },
        onMove: (a, b) => { moveItem(cat.subs, a, b); draw(); saveSettings({ cats: catsArr() }); },
      });
    }
    draw();
    $('#sRen', pg).onclick = () => openCatEdit(type, cat);
    $('#sAdd', pg).onclick = async () => {
      const v = await askText('소분류 추가', '', { ok: '추가' });
      if (!v) return;
      if (cat.subs.includes(v)) { toast('같은 이름이 있습니다', true); return; }
      cat.subs.push(v); draw(); saveSettings({ cats: catsArr() }, '소분류를 추가했습니다');
    };
  }  // 분류 고르기 시트 (분류수정 → 소분류로, 소분류 수정 → 분류)
  function pickCat(type, title, exclude, cur) {
    return new Promise(res => {
      const list = H.cats[type].filter(c => c.name !== exclude);
      D.openSheet(`<div class="ask"><h2 id="sheetTitle">${esc(title)}</h2><div class="ae-gl">${list.map(c => `<button class="ae-gi ${c.name === cur ? 'on' : ''}" data-pc="${esc(c.name)}">${esc(c.name)}</button>`).join('')}</div></div>`, 'pop');
      let done = false; const fin = v => { if (done) return; done = true; obs.disconnect(); res(v); };
      const sh = $('#sheet'); const obs = new MutationObserver(() => { if (!sh.classList.contains('open') || sh.hidden) fin(null); });
      setTimeout(() => obs.observe(sh, { attributes: true, attributeFilter: ['class', 'hidden'] }), 60);
      $$('#sheet [data-pc]').forEach(b => b.onclick = () => { fin(H.cats[type].find(c => c.name === b.dataset.pc)); D.closeSheet(); });
    });
  }
  // 분류수정 (편한가계부처럼: 이름 고치기 + '소분류로')
  function openCatEdit(type, cat) {
    const pg = pushPage({
      title: '분류수정', cls: 'hf-page ce-page',
      actions: `<button class="ce-sw" id="ceToSub">소분류로</button>`,
      body: `<div class="hf"><div class="hf-row ce-one"><div class="hf-v"><input id="ceName" value="${esc(cat.name)}" maxlength="60" autocomplete="off"></div></div>
        <p class="form-error" id="ceErr" role="alert"></p>
        <div class="hf-btns"><button class="btn hf-save memo" id="ceSave">저장하기</button></div></div>`,
    });
    const err = $('#ceErr', pg);
    $('#ceSave', pg).onclick = async () => {
      const v = $('#ceName', pg).value.trim();
      if (!v) { err.textContent = '이름을 입력하십시오.'; return; }
      if (v === cat.name) { back(); return; }
      if (H.cats[type].some(x => x !== cat && x.name === v)) { err.textContent = '같은 이름의 분류가 있습니다.'; return; }
      const rn = { what: 'cat', type, from: cat.name, to: v };
      cat.name = v; renameLocal(rn); rerender(); back(); refreshPages();
      saveSettings({ renames: [rn], cats: catsArr(), budgets: budgetsArr() }, '분류를 고쳤습니다');
    };
    $('#ceToSub', pg).onclick = async () => {
      if (cat.subs.length) { toast('소분류가 있는 분류는 소분류로 옮길 수 없습니다.\n먼저 소분류를 지우거나 옮기십시오.', true); return; }
      const to = await pickCat(type, '어느 분류의 소분류로 옮길까요?', cat.name);
      if (!to) return;
      const name = cat.name;
      if (to.subs.includes(name)) { toast(`'${to.name}'에 같은 이름의 소분류가 있습니다`, true); return; }
      if (!(await askConfirm(`'${name}'을 '${to.name}'의 소분류로 옮길까요?`, '지난 내역도 함께 옮겨집니다.', '옮기기', false))) return;
      const rn = { what: 'move', type, fromCat: name, fromSub: null, toCat: to.name, toSub: name };
      to.subs.push(name); H.cats[type].splice(H.cats[type].indexOf(cat), 1);
      renameLocal(rn); rerender();
      back(stack.length && stack.at(-2)?.pg?.querySelector('#sRen') ? 2 : 1, () => refreshPages());
      saveSettings({ renames: [rn], cats: catsArr(), budgets: budgetsArr() }, '소분류로 옮겼습니다');
    };
    setTimeout(() => $('#ceName', pg).focus(), 280);
  }
  // 소분류 수정 (분류 바꾸기 + 이름 고치기 + '대분류로')
  function openSubEdit(type, cat, sub) {
    let parent = cat;
    const pg = pushPage({
      title: '소분류 수정', cls: 'hf-page ce-page',
      actions: `<button class="ce-sw" id="ceToCat">대분류로</button>`,
      body: `<div class="hf">
        <button class="hf-row ae-g" id="cePar" type="button"><span class="hf-l">분류</span><span class="hf-v" id="ceParV">${esc(cat.name)}</span>${ico.chev}</button>
        <div class="hf-row"><span class="hf-l">소분류</span><div class="hf-v"><input id="ceSub" value="${esc(sub)}" maxlength="60" autocomplete="off"></div></div>
        <p class="form-error" id="ceErr" role="alert"></p>
        <div class="hf-btns"><button class="btn hf-save memo" id="ceSave">저장하기</button></div></div>`,
    });
    const err = $('#ceErr', pg);
    $('#cePar', pg).onclick = async () => { const c = await pickCat(type, '분류', null, parent.name); if (c) { parent = c; $('#ceParV', pg).textContent = c.name; } };
    $('#ceSave', pg).onclick = async () => {
      const v = $('#ceSub', pg).value.trim();
      if (!v) { err.textContent = '소분류 이름을 입력하십시오.'; return; }
      if (parent === cat && v === sub) { back(); return; }
      if (parent.subs.some(x => x === v && !(parent === cat && x === sub))) { err.textContent = '같은 이름의 소분류가 있습니다.'; return; }
      let rn;
      if (parent === cat) { rn = { what: 'sub', type, cat: cat.name, from: sub, to: v }; cat.subs[cat.subs.indexOf(sub)] = v; }
      else { rn = { what: 'move', type, fromCat: cat.name, fromSub: sub, toCat: parent.name, toSub: v }; cat.subs.splice(cat.subs.indexOf(sub), 1); parent.subs.push(v); }
      renameLocal(rn); rerender(); back(); refreshPages();
      saveSettings({ renames: [rn], cats: catsArr(), budgets: budgetsArr() }, parent === cat ? '소분류를 고쳤습니다' : `'${parent.name}'으로 옮겼습니다`);
    };
    $('#ceToCat', pg).onclick = async () => {
      if (H.cats[type].some(x => x.name === sub)) { toast('같은 이름의 대분류가 있습니다', true); return; }
      if (!(await askConfirm(`'${sub}'을 대분류로 올릴까요?`, '지난 내역도 새 대분류로 옮겨집니다.', '올리기', false))) return;
      const rn = { what: 'move', type, fromCat: cat.name, fromSub: sub, toCat: sub, toSub: '' };
      cat.subs.splice(cat.subs.indexOf(sub), 1);
      H.cats[type].splice(H.cats[type].indexOf(cat) + 1, 0, { name: sub, subs: [] });
      renameLocal(rn); rerender(); back(); refreshPages();
      saveSettings({ renames: [rn], cats: catsArr(), budgets: budgetsArr() }, '대분류로 올렸습니다');
    };
  }


  /* ───────────── 설정: 자산 ───────────── */
  // 오른쪽 위 ⋯ (자산 탭에서만): 추가 · 표시/숨김 · 삭제 · 순서 변경
  function assetMenu() {
    const old = $('.hh-drop'); if (old) { old.remove(); return; }
    const m = document.createElement('div');
    m.className = 'hh-drop';
    m.innerHTML = `<div class="hh-drop-p" role="menu">
      <button role="menuitem" data-am="add">추가</button><button role="menuitem" data-am="hide">표시/숨김</button>
      <button role="menuitem" data-am="del">삭제</button><button role="menuitem" data-am="order">순서 변경</button></div>`;
    document.body.appendChild(m);
    m.onclick = e => {
      const b = e.target.closest('[data-am]'); m.remove();
      if (!b) return;
      if (b.dataset.am === 'add') openAssetEdit(newAsset()); else openAssetSettings(b.dataset.am);
    };
  }
  function openAssetSettings(mode = 'hide') {
    const T = { hide: '표시/숨김', del: '삭제', order: '순서 변경', all: '자산 설정' };
    const NOTE = {
      hide: '눈 아이콘으로 표시·숨김을 바꿉니다. 숨긴 자산은 목록과 입력 화면에 나오지 않지만 합계에는 들어갑니다.',
      del: '⊖ 를 누르면 지웁니다. 내역이 있는 자산은 지울 수 없으니 숨기십시오.',
      order: '≡ 를 끌어 같은 그룹 안에서 순서를 바꿉니다.',
      all: '눈 아이콘 = 표시·숨김, ⊖ = 삭제, ≡ 를 끌면 순서를 바꿉니다.',
    };
    const pg = pushPage({ title: T[mode] || '자산 편집', cls: `se-mode-${mode}`, body: '', refresh: p => draw(p) });
    let saveT = 0;
    const saveLater = () => { clearTimeout(saveT); saveT = setTimeout(() => saveSettings({ assets: assetsArr() }), 600); };
    function draw(p = pg) {
      const groups = [...new Set(H.assets.map(a => a.group))];
      $('.hh-pbody', p).innerHTML = groups.map(g => `<h3 class="se-gh">${esc(g)}</h3><div class="card se-list" data-g="${esc(g)}">${H.assets.filter(a => a.group === g).map(a => `
        <div class="se-row eye ${a.hidden ? 'hid' : ''}">
          <button class="se-del" data-del="${esc(a.name)}" aria-label="${esc(a.name)} 삭제">${ico.del}</button>
          <button class="se-name" data-edit="${esc(a.name)}"><span>${esc(a.name)}</span><small class="num">${H.inv.has(a.name) ? '투자 앱 원금 연동' : H.link.has(a.name) ? `${esc(H.link.get(a.name))} 연결` : won(H.bal.get(a.name) || 0)}${a.hidden ? ' · 숨김' : ''}</small></button>
          <button class="se-ed se-eye ${a.hidden ? '' : 'on'}" data-eye="${esc(a.name)}" aria-pressed="${!a.hidden}" aria-label="${esc(a.name)} ${a.hidden ? '보이기' : '숨기기'}">${a.hidden ? ico.eyeOff : ico.eye}</button>
          <span class="se-drag" aria-label="끌어서 순서 바꾸기">${ico.drag}</span>
        </div>`).join('')}</div>`).join('')
;
      $$('[data-edit]', p).forEach(b => b.onclick = () => openAssetEdit(H.assets.find(a => a.name === b.dataset.edit)));
      $$('[data-eye]', p).forEach(b => b.onclick = () => {
        const a = H.assets.find(x => x.name === b.dataset.eye); if (!a) return;
        a.hidden = !a.hidden; draw(); rerender(); saveLater();
      });
      $$('[data-del]', p).forEach(b => b.onclick = () => deleteAsset(H.assets.find(x => x.name === b.dataset.del)));
      $$('.se-list[data-g]', p).forEach(list => dragSort(list, (a, b) => {
        const g = list.dataset.g, idx = H.assets.map((x, i) => (x.group === g ? i : -1)).filter(i => i >= 0);
        const item = H.assets[idx[a]];
        H.assets.splice(idx[a], 1);
        const idx2 = H.assets.map((x, i) => (x.group === g ? i : -1)).filter(i => i >= 0);
        const at = b >= idx2.length ? idx2.at(-1) + 1 : idx2[b];
        H.assets.splice(at, 0, item);
        draw(); rerender(); saveSettings({ assets: assetsArr() });
      }));
    }
    draw();
  }
  async function deleteAsset(a, after) {
    if (!a) return false;
    if (H.tx.some(t => t.asset === a.name || t.to === a.name)) { toast('내역이 있는 자산은 지울 수 없습니다.\n눈 아이콘으로 숨기십시오.', true); return false; }
    if (!(await askConfirm(`'${a.name}' 자산을 지울까요?`, '', '삭제'))) return false;
    H.assets.splice(H.assets.indexOf(a), 1);
    H.assets.forEach(x => { if (x.link === a.name) x.link = ''; });
    reindex();
    const ok = await saveSettings({ assets: assetsArr() }, '자산을 지웠습니다');
    rerender();
    if (ok && after) after();
    return ok;
  }
  const BASE_GROUPS = ['현금', '은행', '카드', '투자', '부동산', '대출', '적금', '기타', '체크카드', '마이너스 통장'];
  const isCheckG = g => g === '체크카드';
  const isDebtG = g => g === '대출' || g === '마이너스 통장';
  function openAssetEdit(a) {
    const isNew = !!a.isNew;
    const groups = [...new Set([...BASE_GROUPS, ...H.assets.map(x => x.group)])];
    const curBal = isNew ? 0 : Math.round(H.bal.get(a.name) || 0);
    let group = a.group || '현금';
    let invOn = a.link === INVLINK;
    const payOpts = () => H.assets.filter(x => x.name !== a.name && !x.link && !isCheckG(x.group) && x.group !== '카드');
    const pg = pushPage({
      title: isNew ? '자산 추가' : '자산 설정', cls: 'hf-page ae-page',
      actions: !isNew ? `<button class="icon-btn" id="eDel" aria-label="자산 삭제">${ico.trash}</button>` : '',
      body: `<div class="hf ae">
        <button class="hf-row ae-g" id="eGroupBtn" type="button"><span class="hf-l">그룹</span><span class="hf-v" id="eGroupV">${esc(group)}</span>${ico.chev}</button>
        <div class="hf-row"><span class="hf-l">이름</span><div class="hf-v"><input id="eName" value="${esc(a.name)}" maxlength="80" autocomplete="off"></div></div>
        <div id="eDyn"></div>
        <div class="hf-row ae-memo"><span class="hf-l">메모</span><div class="hf-v"><input id="eMemo" value="${esc(a.memo || '')}" maxlength="200" autocomplete="off"></div></div>
        <p class="form-error" id="eErr" role="alert"></p>
        <div class="hf-btns"><button class="btn hf-save memo" id="eSave">저장하기</button></div></div>`,
    });
    let balTxt = isNew ? '' : String(curBal), pay = a.link && a.link !== INVLINK ? a.link : '';
    function dyn() {
      const box = $('#eDyn', pg);
      const check = isCheckG(group), invG = group === '투자', inv = invG && invOn;
      const amt = isNew && !check && !inv;   // 이미 있는 자산의 잔액은 자산 화면의 잔액 수정에서
      box.innerHTML = `
        ${amt ? `<div class="hf-row"><span class="hf-l">금액</span><div class="hf-v"><input id="eBal" inputmode="numeric" placeholder="0" autocomplete="off" value="${balTxt === '' ? '' : Number(balTxt).toLocaleString('ko-KR')}"><span class="hf-unit">원</span></div></div>
          ${isDebtG(group) ? `<p class="hf-info ae-hint">금액 앞에 '−'를 붙여야 부채에 합산됩니다.<br>'−'가 없으면 자산에 합산됩니다.</p>` : ''}
          ${!isNew ? '<p class="hf-info ae-hint">금액을 바꾸면 차액만큼 잔액수정 내역이 들어갑니다.</p>' : ''}` : ''}
        ${check ? `<div class="hf-row"><span class="hf-l">결제</span><div class="hf-v"><select id="ePay" class="hf-sel wide"><option value="">선택 안 함</option>${payOpts().map(x => `<option ${x.name === pay ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div></div>
          <p class="hf-info ae-hint">쓴 금액은 결제 통장 잔액에서 바로 빠집니다.<br>잔액을 따로 쌓고 싶으면 그룹을 은행으로 바꾸십시오.</p>` : ''}
        ${invG ? `<label class="hf-switch"><span>투자 앱 원금으로 보기</span><input type="checkbox" id="eInv" ${invOn ? 'checked' : ''}><i></i></label>
          <p class="hf-info ae-hint">켜면 금액을 투자 앱의 원금으로 보여 주고, 가계부에는 보낸 돈·찾은 돈만 적습니다.</p>` : ''}`;
      const bal = $('#eBal', pg);
      if (bal) { bindMoneyInput(bal, true); bal.addEventListener('input', () => { balTxt = String(moneyVal(bal.value) || ''); }); }
      const ps = $('#ePay', pg); if (ps) ps.onchange = () => { pay = ps.value; };
      const iv = $('#eInv', pg); if (iv) iv.onchange = () => { invOn = iv.checked; dyn(); };
    }
    dyn();
    $('#eGroupBtn', pg).onclick = () => {
      D.openSheet(`<div class="ask"><h2 id="sheetTitle">자산그룹</h2><div class="ae-gl">${groups.map(g => `<button class="ae-gi ${g === group ? 'on' : ''}" data-g="${esc(g)}">${esc(g)}</button>`).join('')}</div></div>`, 'pop');
      $$('.ae-gi').forEach(b => b.onclick = () => { group = b.dataset.g; $('#eGroupV', pg).textContent = group; D.closeSheet(); dyn(); });
    };
    $('#eSave', pg).onclick = async () => {
      const name = $('#eName', pg).value.trim(), memo = $('#eMemo', pg).value.trim();
      const link = isCheckG(group) ? pay : group === '투자' && invOn ? INVLINK : '';
      const hidden = !!a.hidden;
      const err = $('#eErr', pg);
      if (!name) { err.textContent = '이름을 입력하십시오.'; return; }
      if (H.assets.some(x => x.name === name && x !== a)) { err.textContent = '같은 이름의 자산이 있습니다.'; return; }
      const balEl = $('#eBal', pg);
      const target = balEl ? moneyVal(balEl.value) : NaN;
      const payload = {};
      if (isNew) {
        const lastIdx = H.assets.map(x => x.group).lastIndexOf(group);
        const item = { group, name, hidden: false, memo, link };
        if (lastIdx >= 0) H.assets.splice(lastIdx + 1, 0, item); else H.assets.push(item);
      } else {
        if (name !== a.name) { payload.renames = [{ what: 'asset', from: a.name, to: name }]; renameLocal(payload.renames[0]); }
        if (group !== a.group) {
          H.assets.splice(H.assets.indexOf(a), 1);
          const lastIdx = H.assets.map(x => x.group).lastIndexOf(group);
          if (lastIdx >= 0) H.assets.splice(lastIdx + 1, 0, a); else H.assets.push(a);
        }
        Object.assign(a, { name, group, hidden, memo, link });
      }
      reindex();
      payload.assets = assetsArr();
      const btn = $('#eSave', pg); btn.disabled = true; btn.textContent = '저장 중…';
      const ok = await saveSettings(payload, isNew ? '자산을 추가했습니다' : '자산 설정을 저장했습니다');
      if (!ok) { btn.disabled = false; btn.textContent = '저장하기'; return; }
      back(); rerender();
      const diff = Number.isFinite(target) ? Math.round(target) - (isNew ? 0 : curBal) : 0;
      if (diff) {
        const d = new Date();
        commitTx(toTx([newId('n'), `${dOf(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`, '수정', '잔액수정', '', isNew ? '시작 잔액' : '잔액 수정', diff, name, '', '', '', '', '', store.get('dh_name') || '']), null);
      }
    };
    const del = $('#eDel', pg);
    if (del) del.onclick = () => deleteAsset(a, () => back());
    if (isNew) setTimeout(() => $('#eName', pg).focus(), 280);
  }

  /* ───────────── 설정: 예산 ───────────── */
  const budIco = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="15" height="8" rx="1.5"/><path d="M6 15h6M14 4l6 6-6 6"/><path d="M9 11l7-7"/></svg>';
  const budBanner = html => `<div class="bs-ban"><span class="bs-ban-ic">${budIco}</span><p>${html}</p></div>`;
  function openBudgetSettings() {
    const open = new Set();
    const pg = pushPage({ title: '예산설정', cls: 'bs-page', body: '', refresh: p => draw(p) });
    function draw(p = pg) {
      const list = H.cats['지출'];
      $('.hh-pbody', p).innerHTML = budBanner('추가된 예산은<br><b>가계부탭 - 결산</b>에서 확인하실 수 있습니다.') + `
        <div class="bs-list">${list.map((c, i) => {
          const has = c.subs.length > 0, on = open.has(c.name);
          return `<div class="bs-row"><button class="bs-name" ${has ? `data-bo="${i}" aria-expanded="${on}"` : `data-bc="${i}"`}><span>${esc(c.name)}</span>${has ? `<i class="bs-chev ${on ? 'open' : ''}">${ico.chev}</i>` : ''}</button>
            <button class="bs-amt num" data-bc="${i}">${won(catBase(c))}${ico.chev}</button></div>
            ${has && on ? `<div class="bs-subs">${c.subs.map((sb, j) => `<button class="bs-sub" data-bc="${i}" data-bsub="${j}"><span>${esc(sb)}</span><span class="num">${won(baseOf(c.name, sb))}</span>${ico.chev}</button>`).join('')}</div>` : ''}`;
        }).join('')}</div>`;
      $$('[data-bo]', p).forEach(b => b.onclick = () => { const n = list[Number(b.dataset.bo)].name; if (open.has(n)) open.delete(n); else open.add(n); draw(); });
      $$('[data-bc]', p).forEach(b => b.onclick = () => { const c = list[Number(b.dataset.bc)]; openBudgetEdit(c, b.dataset.bsub !== undefined ? c.subs[Number(b.dataset.bsub)] : ''); });
    }
    draw();
  }
  function openBudgetEdit(c, sub = '') {
    const key = BK(c.name, sub), cur = curYm();
    let year = Number(cur.slice(0, 4));
    const isCat = !sub;
    const pg = pushPage({
      title: esc(sub || c.name), cls: 'bs-page bs-ed',
      actions: `<span class="bs-yn"><button class="hh-arrow" data-y="-1" aria-label="이전 해">${ico.left}</button><b id="bYear"></b><button class="hh-arrow" data-y="1" aria-label="다음 해">${ico.right}</button></span><button class="icon-btn" id="bDel" aria-label="예산 삭제">${ico.trash}</button>`,
      body: '', refresh: p => draw(p),
    });
    const save = async (msg, prev) => { if (!(await saveSettings({ budgets: budgetsArr() }, msg))) { H.budgets = prev; } draw(); rerender(); refreshPages(); };
    const snap = () => new Map([...H.budgets].map(([k, e]) => [k, { base: e.base.map(b => ({ ...b })), months: new Map(e.months) }]));
    function draw(p = pg) {
      $('#bYear', p).textContent = `${year}년`;
      const base = baseOf(c.name, sub);
      const months = Array.from({ length: 12 }, (_, i) => `${year}-${pad(12 - i)}`);
      const shown = ym => (isCat ? catBudget(c, ym) : budgetOf(c.name, sub, ym));
      $('.hh-pbody', p).innerHTML = budBanner('기본 예산을 바꾸면 다음 달부터 적용됩니다.<br>월을 누르면 그 달만 예산을 정할 수 있습니다.<br>대분류 예산이 0원이면 소분류 예산의 합으로 표시됩니다.') + `
        <button class="bs-base" id="bBase"><b>기본예산</b><b class="num">${won(isCat && !base ? catBase(c) : base)}</b></button>
        <div class="bs-months">${months.map(ym => {
          const e = H.budgets.get(key), own = e && e.months.has(ym);
          return `<button class="bs-m" data-m="${ym}"><span class="bs-chip ${ym === cur ? 'cur' : ''} ${own ? 'own' : ''}">${+ym.slice(5)}월</span><span class="num">${won(shown(ym))}</span></button>`;
        }).join('')}</div>`;
      $('#bBase', p).onclick = async () => {
        const v = await askText('기본예산', base ? String(base) : '', { money: true, ok: '저장', note: H.budgets.get(key)?.base.length ? '다음달부터 적용됩니다. 이번 달까지는 지금 예산이 그대로 남습니다.' : '처음 정하는 기본예산은 모든 달에 적용됩니다.' });
        if (v === null) return;
        const amt = Math.max(0, moneyVal(v) || 0), prev = snap(), e = budEntry(key, true);
        if (!e.base.length) e.base.push({ from: '', amt });
        else {
          const nx = addMonths(cur, 1);
          e.base = e.base.filter(b => !b.from || b.from <= cur);
          e.base.push({ from: nx, amt });
        }
        await save('기본예산을 저장했습니다', prev);
      };
      $$('[data-m]', p).forEach(b => b.onclick = async () => {
        const ym = b.dataset.m, e0 = H.budgets.get(key);
        const v = await askText(`${ym.slice(0, 4)}년 ${+ym.slice(5)}월 예산`, e0 && e0.months.has(ym) ? String(e0.months.get(ym)) : String(budgetOf(c.name, sub, ym) || ''), { money: true, ok: '저장', note: '이 달만 바뀝니다. 비우고 저장하면 기본예산으로 돌아갑니다.' });
        if (v === null) return;
        const prev = snap(), e = budEntry(key, true);
        if (v.trim() === '') e.months.delete(ym); else e.months.set(ym, Math.max(0, moneyVal(v) || 0));
        await save(`${+ym.slice(5)}월 예산을 저장했습니다`, prev);
      });
    }
    $$('[data-y]', pg).forEach(b => b.onclick = () => { year += Number(b.dataset.y); draw(); });
    $('#bDel', pg).onclick = async () => {
      if (!H.budgets.has(key)) { toast('지울 예산이 없습니다.'); return; }
      if (!(await askConfirm(`'${sub || c.name}' 예산을 지울까요?`, '기본예산과 월별 예산이 모두 지워집니다.', '삭제'))) return;
      const prev = snap(); H.budgets.delete(key);
      await save('예산을 지웠습니다', prev);
    };
    draw();
  }

  /* ───────────── 설정: 매월 반복 ───────────── */
  function openRules() {
    const pg = pushPage({ title: '반복 내역', actions: `<button class="icon-btn" id="rAdd" aria-label="반복 내역 추가">${ico.plus}</button>`, body: '', refresh: p => draw(p) });
    function draw(p = pg) {
      const td = today();
      const nx = new Map(H.rules.map(r => [r.id, ruleNext(r)]));
      const isEnded = r => { const e = ruleEnd(r), n = nx.get(r.id); return e && (!n || n > e) && e < td; };
      const act = H.rules.filter(r => !isEnded(r)).sort((a, b) => (nx.get(a.id) || '9').localeCompare(nx.get(b.id) || '9'));
      const ended = H.rules.filter(isEnded);
      const row = r => `<button class="hr rl" data-rule="${esc(r.id)}">
        <span class="hr-l"><span class="hr-cat">${esc(perLabel(r.period || '매월', ruleAnchor(r)))}</span>${r.type === '이체' ? '<small>이체</small>' : `<small>${esc(r.cat)}</small>`}</span>
        <span class="hr-m"><span class="hr-t">${esc(r.text || r.sub || r.cat)}</span><span class="hr-s">${r.type === '이체' ? `${esc(r.asset)} → ${esc(r.to)}` : esc(r.asset)}${!isEnded(r) && nx.get(r.id) ? ` · 다음 ${mdLabel(nx.get(r.id))}` : ''}${ruleEnd(r) ? ` · ${mdLabel(ruleEnd(r))}까지` : ''}</span></span>
        <span class="hr-r"><b class="num ${r.type === '수입' ? 'inc' : r.type === '지출' ? 'exp' : 'tr'}">${won(r.amt)}</b></span></button>`;
      const tot = act.filter(r => r.type === '지출').reduce((a, r) => a + r.amt * (PER_PM[r.period || '매월'] || 1), 0);
      $('.hh-pbody', p).innerHTML = `
        <div class="card hs-sum num"><span>${act.length}개</span><span class="exp">월 지출 ${act.some(r => (r.period || '매월') !== '매월') ? '약 ' : ''}${won(tot)}</span></div>
        ${act.length ? `<section class="card hd">${act.map(row).join('')}</section>` : '<p class="empty">반복 내역이 없습니다.</p>'}
        ${ended.length ? `<h3 class="se-gh">끝난 반복</h3><section class="card hd">${ended.map(row).join('')}</section>` : ''}
        <p class="note">그 날짜가 지난 뒤 앱을 처음 열 때 자동으로 들어갑니다.<br>이미 들어간 내역은 각각 고칠 수 있습니다.</p>`;
      $$('[data-rule]', p).forEach(b => b.onclick = () => openForm({ mode: 'rule', rule: H.rules.find(r => r.id === b.dataset.rule) }));
    }
    draw();
    $('#rAdd', pg).onclick = () => openForm({ mode: 'rule' });
  }

  /* ───────────── 시작·전환 ───────────── */
  function enter() {
    H.active = true;
    if (D.ensureInv) D.ensureInv();
    if (!H.loaded) loadCache();
    render();
    requestAnimationFrame(() => { setTopH(); const y = Number(sess.get(`dh_scroll_hh_${H.view}`)) || 0; if (y) window.scrollTo({ top: y }); });
    load();
  }
  function leave() { H.active = false; closeAllPages(); $('#hhFab').hidden = true; }
  function bindOnce() {
    $$('#hhTabs .htab').forEach(t => t.onclick = () => goView(t.dataset.hv));
    $('#hhFab').onclick = () => { if (H.btab === 'memo') openMemo(null); else openForm({ date: H.ym === ymOf(new Date()) ? today() : `${H.ym}-01` }); };
    $('#hhSearchBtn').onclick = () => openSearch();
    window.addEventListener('resize', setTopH);
  }
  bindOnce();

  window.HH = {
    enter, leave, load, render,
    menu() { if (!H.active || H.view !== 'assets' || stack.length) return false; assetMenu(); return true; },
    invUpdated() { if (H.active && H.view === 'assets') { const y = window.scrollY; render(); window.scrollTo({ top: y }); } refreshPages(); },
    scrollKey: () => `dh_scroll_hh_${H.view}`,
    clear() { H.loaded = false; H.tx = []; reindex(); store.del(CACHE); },
  };
})();
