(() => {
  'use strict';

  const API = (window.DH_CONFIG || {}).API_URL;
  const LS = { pw: 'dh_pw', name: 'dh_name', cache: 'dh_cache', mode: 'dh_mode', sort: 'dh_sort', fx: 'dh_fx' };
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* 무시 */ } },
  };

  const state = {
    data: null,
    view: 'home',
    mode: store.get(LS.mode) || 'weight',
    basis: store.get('dh_basis') === 'cost' ? 'cost' : 'value',
    sort: store.get(LS.sort) || 'cost',
    sortDir: store.get('dh_sortdir') === 'asc' ? 'asc' : 'desc',
    fx: store.get(LS.fx) === '1',
    year: null,
    yPage: 0,
    kindSort: store.get('dh_kindsort') || null,
    openKinds: new Set(),
    openMonths: new Set(),
    openTrades: new Set(),
    kindsOpen: false,
    monthsOpen: false,
    cmpMode: store.get('dh_cmpmode') === 'sub' ? 'sub' : 'kind',
    cmpSel: (() => { try { return JSON.parse(store.get('dh_cmpsel')) || { kind: null, sub: null }; } catch { return { kind: null, sub: null }; } })(),
    form: { type: '매수', kind: '', key: '', cashAsset: '' },
  };

  /* ───────────── 숫자 표시 ───────────── */
  const num = v => { const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
  const isNum = v => v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v));
  const won = n => `${Math.round(n).toLocaleString('ko-KR')}원`;
  const signWon = n => `${n > 0 ? '+' : ''}${Math.round(n).toLocaleString('ko-KR')}원`;
  const pct = (r, digits = 2) => (r === null || !Number.isFinite(r)) ? '—' : `${r > 0 ? '+' : ''}${(r * 100).toFixed(digits)}%`;
  const cls = r => (!Number.isFinite(r) || Math.abs(r) < 1e-9) ? 'flat' : (r > 0 ? 'up' : 'down');
  function compact(n) {
    const a = Math.abs(n), s = n < 0 ? '-' : '';
    if (a >= 1e8) return `${s}${(a / 1e8).toFixed(a >= 1e9 ? 1 : 2)}억`;
    if (a >= 1e4) return `${s}${Math.round(a / 1e4).toLocaleString('ko-KR')}만`;
    return `${s}${Math.round(a).toLocaleString('ko-KR')}`;
  }
  const compactSigned = v => `${v > 0 ? '+' : ''}${compact(v)}`;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ───────────── 서버 ───────────── */
  async function api(action, extra = {}) {
    const res = await fetch(API, {
      method: 'POST',
      body: JSON.stringify({ action, password: store.get(LS.pw), ...extra }),
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`서버 응답 ${res.status}`);
    const j = await res.json();
    if (!j.ok) { const e = new Error(j.error || '요청 실패'); e.code = j.code; throw e; }
    return j;
  }

  async function load({ quiet = false } = {}) {
    const btn = $('#refreshBtn');
    btn.classList.add('spin');
    try {
      const j = await api('data');
      state.data = prepare(j.data);
      store.set(LS.cache, JSON.stringify(j.data));
      render();
      if (!quiet) toast('최신 데이터로 바꿨어요');
    } catch (e) {
      if (e.code === 'auth') { logout('비밀번호가 바뀌었거나 틀렸습니다. 다시 입력해 주세요.'); return; }
      toast(state.data ? `새로고침 실패: ${e.message}` : `불러오기 실패: ${e.message}`, true);
      if (!state.data) $('#view-home').innerHTML = `<div class="card"><p class="empty">데이터를 불러오지 못했습니다.<br>${esc(e.message)}<br><br>인터넷 연결을 확인하고 새로고침을 눌러 주세요.</p></div>`;
    } finally {
      btn.classList.remove('spin');
    }
  }

  /* ───────────── 데이터 가공 ───────────── */
  function prepare(d) {
    const rate = num(d.rate) || 1400;
    const bad = [];
    const rows = (d.holdings || []).map(h => {
      if (!isNum(h['평가금(원)']) && h['평가금(원)'] !== '') bad.push(`${h['자산']} ${h['세부종목']}`);
      return {
        asset: String(h['자산']).trim(), kind: String(h['종류'] || '').trim(), sub: String(h['세부종목'] || h['자산']).trim(),
        ticker: h['티커'], cur: h['통화'] || 'KRW', qty: num(h['수량']), avg: num(h['평단가']),
        cost: num(h['원금(원)']), price: num(h['현재가']), value: num(h['평가금(원)']), method: String(h['시세방식'] || ''),
      };
    });

    const byAsset = new Map();
    rows.forEach(r => {
      if (!byAsset.has(r.asset)) byAsset.set(r.asset, { name: r.asset, kind: r.kind, cost: 0, value: 0, rows: [] });
      const a = byAsset.get(r.asset);
      a.cost += r.cost; a.value += r.value; a.rows.push(r);
    });
    const assets = [...byAsset.values()].filter(a => a.value > 0 || a.cost > 0);
    const total = assets.reduce((s, a) => ({ cost: s.cost + a.cost, value: s.value + a.value }), { cost: 0, value: 0 });
    assets.forEach(a => {
      a.pl = a.value - a.cost;
      a.ret = a.cost > 0 ? a.pl / a.cost : null;
      a.weight = total.value > 0 ? a.value / total.value : 0;
    });

    const comp = new Map();
    (d.composition || []).forEach(c => {
      comp.set(`${num(c['연도'])}|${String(c['자산']).trim()}`, { kind: String(c['종류']).trim(), base: isNum(c['기준원금(원)']) ? num(c['기준원금(원)']) : null });
    });
    const realized = (d.realized || []).map(r => {
      const date = new Date(r['날짜']);
      const year = num(r['연도']) || date.getFullYear();
      const asset = String(r['자산']).trim();
      const c = comp.get(`${year}|${asset}`);
      return {
        date, year, month: num(r['월']) || date.getMonth() + 1, asset, sub: r['세부종목'], text: withSubName(r['세부종목'], r['내용']),
        amount: num(r['손익(원)']), kind: c ? c.kind : (byAsset.get(asset)?.kind || '기타'),
      };
    }).filter(r => !Number.isNaN(r.date.getTime()));
    const years = [...new Set([...(d.composition || []).map(c => num(c['연도'])), ...realized.map(r => r.year)])]
      .filter(Boolean).sort((a, b) => a - b);

    return {
      rate, rows, assets, comp, realized, years, bad,
      total: { ...total, pl: total.value - total.cost, ret: total.cost > 0 ? (total.value - total.cost) / total.cost : null },
      monthly: d.monthly || [], trades: (d.trades || []).slice().reverse(), index: d.index || null, updatedAt: d.updatedAt,
      household: (d.household || []).map(h => ({
        y: num(h['연도']), m: num(h['월']), nw: num(h['순자산']), inc: num(h['수입(근로·기타)']), exp: num(h['생활 지출']),
        pnl: num(h['투자손익(실현)']), flow: num(h['투자 순투입']), book: num(h['투자 장부잔액']),
      })).filter(h => h.y && h.m).sort((a, b) => a.y - b.y || a.m - b.m),
    };
  }

  const SUB_ALIASES = { 'NAVER': ['네이버'], 'TQQQ': ['나예 무매'], 'LG에너지솔루션': ['LG엔솔'], '미래에셋증권': ['미래에셋'],
    'KODEX 2차전지산업레버리지': ['2차전지'], 'TIGER 미국나스닥100레버리지(합성)': ['TIGER'] };
  function withSubName(sub, text) {
    const t = String(text || '').trim(), s = String(sub || '').trim();
    if (!s || s.startsWith('(')) return t;
    const names = [s, ...(SUB_ALIASES[s] || [])];
    return names.some(n => t.includes(n)) ? t : `${s} ${t}`;
  }

  /* ───────────── 렌더 ───────────── */
  function render() {
    const D = state.data;
    if (!D) return;
    $('#updated').textContent = D.updatedAt ? `${D.updatedAt.slice(5).replace('-', '/')} 기준 · 환율 ${D.rate.toFixed(1)}원` : '';
    const banner = $('#banner');
    if (D.bad.length) { banner.hidden = false; banner.textContent = `시세를 못 불러온 종목이 있어요: ${D.bad.join(', ')}. 잠시 후 새로고침해 주세요.`; }
    else banner.hidden = true;
    renderHome(); renderRecord(); renderYears(); renderAssets();
  }

  /* ── 포트폴리오 ── */
  function renderHome() {
    const D = state.data, T = D.total;
    const thisYear = new Date().getFullYear();
    const rzYear = D.realized.filter(r => r.year === thisYear).reduce((s, r) => s + r.amount, 0);
    $('#view-home').innerHTML = `
      <div class="pager-dots" role="tablist" aria-label="포트폴리오 화면">
        <button role="tab" data-p="0" class="on"><i></i>자산 구성</button>
        <button role="tab" data-p="1"><i></i>총 자산 ${compact(T.value)}원</button>
      </div>
      <div class="pager" id="pager">
      <div class="page">
      <div class="card plan-card">
        <div class="card-head">
          <h2 class="card-title">자산 구성</h2>
          <div class="seg" id="basisSeg" role="group" aria-label="크기 기준">
            <button data-basis="cost" class="${state.basis === 'cost' ? 'on' : ''}">원금</button>
            <button data-basis="value" class="${state.basis === 'value' ? 'on' : ''}">평가금</button>
          </div>
        </div>
        <div class="plan-tools">
          <span class="plan-tools-label">색</span>
          <div class="seg sm" id="modeSeg" role="group" aria-label="색 기준">
            <button data-mode="weight" class="${state.mode === 'weight' ? 'on' : ''}">비중</button>
            <button data-mode="return" class="${state.mode === 'return' ? 'on' : ''}">수익률</button>
          </div>
        </div>
        <div class="plan" id="plan" role="group" aria-label="자산 트리맵"></div>
        <div class="plan-legend">
          <span>크기·비중은 ${state.basis === 'cost' ? '원금' : '평가금'} 기준, 칸을 누르면 자세히</span>
          ${state.mode === 'return'
            ? `<span class="scale" aria-hidden="true">−30%<i style="background:${retColor(-0.3)}"></i><i style="background:${retColor(-0.1)}"></i><i style="background:${retColor(0)}"></i><i style="background:${retColor(0.1)}"></i><i style="background:${retColor(0.3)}"></i>+30%</span>`
            : ''}
        </div>
      </div>
      </div>
      <div class="page">
      <div class="card sum-card">
        <div class="total-label">총 자산</div>
        <div class="total-value num">${won(T.value)}</div>
        <div class="sum-chips num">
          <button class="mini sum-chip" data-stat="pl"><span>평가손익</span><b class="${cls(T.pl)}">${compactSigned(T.pl)} (${pct(T.ret, 1)})</b></button>
          <button class="mini sum-chip" data-stat="rz"><span>${thisYear}년 실현</span><b class="${cls(rzYear)}">${compactSigned(rzYear)}</b></button>
          <button class="mini sum-chip" data-stat="cost"><span>원금</span><b>${compact(T.cost)}</b></button>
          <button class="mini sum-chip" data-stat="count"><span>자산</span><b>${D.assets.length}개</b></button>
        </div>
      </div>
      ${netWorthMini()}
      </div>
      </div>`;
    $$('#view-home .mini').forEach(b => b.onclick = () => openStat(b.dataset.stat));
    const nw = $('#nwCard'); if (nw) nw.onclick = () => { state.yPage = 2; go('years'); };
    $$('#modeSeg button').forEach(b => b.onclick = () => {
      state.mode = b.dataset.mode; store.set(LS.mode, state.mode); renderHome();
    });
    $$('#basisSeg button').forEach(b => b.onclick = () => {
      state.basis = b.dataset.basis; store.set('dh_basis', state.basis); renderHome();
    });
    drawPlan();
    bindPager();
  }

  // 좌우로 넘기는 화면 (홈, 수익률 탭 공용)
  function setupPager(pager, tabs, { start = 0, onChange } = {}) {
    if (!pager) return { fit: () => {}, align: () => {} };
    const pages = [...pager.children].filter(x => x.classList.contains('page'));
    const idx = () => Math.max(0, Math.min(pages.length - 1, Math.round(pager.scrollLeft / (pager.clientWidth || 1))));
    let last = -1;
    const fit = () => {
      if (!pager.clientWidth) return; // 숨겨진 화면에서는 계산하지 않음
      if (pager.scrollTop) pager.scrollTop = 0;
      const i = idx();
      tabs.forEach((d, j) => { d.classList.toggle('on', j === i); d.setAttribute('aria-selected', String(j === i)); });
      pager.style.height = `${pages[i].offsetHeight}px`;
      if (i !== last) { const first = last < 0; last = i; if (onChange) onChange(i, first); }
    };
    let t;
    pager.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(fit, 60); }, { passive: true });
    tabs.forEach(d => d.onclick = () => pager.scrollTo({ left: Number(d.dataset.p) * pager.clientWidth, behavior: 'smooth' }));
    if ('ResizeObserver' in window) { const ro = new ResizeObserver(() => fit()); pages.forEach(pg => ro.observe(pg)); }
    const align = (i = start) => { if (!pager.clientWidth) return; pager.scrollLeft = i * pager.clientWidth; fit(); };
    requestAnimationFrame(() => align(start));
    return { fit, align };
  }
  let yPagerApi = { fit: () => {}, align: () => {} };

  let fitPager = () => {};
  function bindPager() {
    fitPager = setupPager($('#pager'), $$('#view-home .pager-dots button')).fit;
  }

  // 홈 '총 자산' 화면: 가계부 기준 순자산 미니 그래프
  function netWorthMini() {
    const D = state.data, H = D.household;
    if (!H || H.length < 2) return '';
    const W = 300, Ht = 70, xs = i => 4 + (W - 8) * i / (H.length - 1);
    const lo = Math.min(...H.map(h => h.nw)), hi = Math.max(...H.map(h => h.nw));
    const ys = v => 6 + (Ht - 12) * (1 - (v - lo) / ((hi - lo) || 1));
    const P = H.map((h, i) => [xs(i), ys(h.nw)]);
    const d = smoothPath(P), last = H.at(-1), first = H[0];
    const ch = last.nw - first.nw;
    return `
      <button class="card nw-card" id="nwCard" aria-label="우리 집 순자산, 수익률 탭에서 자세히">
        <div class="nw-top"><span class="total-label">우리 집 순자산</span><span class="nw-more">자산 성장 보기 ›</span></div>
        <div class="nw-value num">${won(last.nw)}</div>
        <div class="nw-sub num"><span class="${cls(ch)}">${ymLabel(first)}부터 ${compactSigned(ch)}</span><span>평가손익 반영 시 약 ${compact(last.nw + D.total.pl)}원</span></div>
        <svg class="nw-spark" viewBox="0 0 ${W} ${Ht}" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="nwg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--up);stop-opacity:.3"/><stop offset="1" style="stop-color:var(--up);stop-opacity:0"/></linearGradient></defs>
          <path d="${d}L${P.at(-1)[0]},${Ht}L${P[0][0]},${Ht}Z" fill="url(#nwg)"/>
          <path d="${d}" fill="none" stroke="var(--up)" stroke-width="2.2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
        </svg>
        <div class="nw-axis num"><span>${ymLabel(first)}</span><span>편한가계부 기준</span><span>${ymLabel(last)}</span></div>
      </button>`;
  }

  // 홈 요약 칸을 누르면 상세 팝업
  function openStat(type) {
    const D = state.data, T = D.total, y = new Date().getFullYear();
    const row = (name, sub, right, cl = '', w = null, col = 'var(--accent)', attr = '') => `
      <${attr ? 'button' : 'div'} class="stat-row ${attr ? 'tap' : ''}" ${attr}>
        <div class="stat-row-top"><span class="stat-row-name">${esc(name)}</span><b class="num ${cl}">${right}</b></div>
        ${sub ? `<div class="stat-row-sub num">${sub}</div>` : ''}
        ${w !== null ? `<div class="stat-meter" aria-hidden="true"><i style="width:${Math.max(1.5, Math.min(100, w * 100))}%;background:${col}"></i></div>` : ''}
      </${attr ? 'button' : 'div'}>`;
    let hero, list;
    if (type === 'pl') {
      const arr = D.assets.filter(a => a.cost > 0 && Math.abs(a.pl) >= 1).sort((a, b) => a.pl - b.pl);
      const mx = Math.max(...arr.map(a => Math.abs(a.pl)), 1);
      hero = { t: '평가손익', v: signWon(T.pl), s: `원금 ${won(T.cost)} 대비 ${pct(T.ret)}`, c: T.pl >= 0 ? 'gain' : 'loss' };
      list = arr.map(a => row(a.name, `${esc(a.kind)} · ${pct(a.ret, 1)}`, signWon(a.pl), cls(a.pl), Math.abs(a.pl) / mx, a.pl >= 0 ? 'var(--bar-up)' : 'var(--down)', `data-asset="${esc(a.name)}"`)).join('')
        || '<p class="empty">손익이 있는 자산이 없어요.</p>';
    } else if (type === 'rz') {
      const rz = D.realized.filter(r => r.year === y);
      const sum = rz.reduce((t, r) => t + r.amount, 0);
      const ks = [...groupBy(rz, r => r.kind)].map(([k, l]) => ({ k, amt: l.reduce((t, r) => t + r.amount, 0), n: l.length, g: l.filter(r => r.amount > 0).length, l: l.filter(r => r.amount < 0).length })).sort((a, b) => b.amt - a.amt);
      const mx = Math.max(...ks.map(k => Math.abs(k.amt)), 1);
      const g = rz.filter(r => r.amount > 0), l = rz.filter(r => r.amount < 0);
      hero = { t: `${y}년 실현손익`, v: signWon(sum), c: sum >= 0 ? 'gain' : 'loss',
        s: `<span class="hero-btns"><button class="hero-btn" data-rz="gain">익절 ${g.length}건 ${compactSigned(g.reduce((t, r) => t + r.amount, 0))} ›</button><button class="hero-btn" data-rz="loss">손절 ${l.length}건 ${compactSigned(l.reduce((t, r) => t + r.amount, 0))} ›</button></span>` };
      list = ks.map(k => row(k.k, `익절 ${k.g} · 손절 ${k.l} · 누르면 거래 내역`, signWon(k.amt), cls(k.amt), Math.abs(k.amt) / mx, k.amt >= 0 ? 'var(--bar-up)' : 'var(--down)', `data-rzkind="${esc(k.k)}"`)).join('')
        + `<button class="link-btn" id="goYears">수익률 탭에서 자세히 보기</button>`;
    } else if (type === 'cost') {
      const ks = [...groupBy(D.assets, a => a.kind)].map(([k, l]) => ({ k, c: l.reduce((t, a) => t + a.cost, 0), v: l.reduce((t, a) => t + a.value, 0) })).sort((a, b) => b.c - a.c);
      hero = { t: '투자원금', v: won(T.cost), s: `지금 평가금 ${won(T.value)}`, c: 'neutral' };
      list = `<div class="stack" aria-hidden="true">${ks.map((k, i) => `<i style="flex:${k.c};background:${CMP_COLORS[i % CMP_COLORS.length]};opacity:${1 - Math.floor(i / CMP_COLORS.length) * 0.45}"></i>`).join('')}</div>`
        + ks.map((k, i) => row(k.k, `평가 ${compact(k.v)}원`, `${compact(k.c)}원 <small>${(k.c / T.cost * 100).toFixed(1)}%</small>`, '', k.c / T.cost, CMP_COLORS[i % CMP_COLORS.length], `data-kind="${esc(k.k)}"`)).join('');
    } else {
      const ks = [...groupBy(D.assets, a => a.kind)];
      hero = { t: '자산 수', v: `${D.assets.length}개`, s: `${ks.length}개 종류`, c: 'neutral' };
      list = ks.map(([k, l]) => `<div class="stat-group"><div class="stat-group-name">${esc(k)}</div>
        <div class="stat-chips">${l.map(a => `<button class="stat-chip" data-asset="${esc(a.name)}">${esc(a.name)}</button>`).join('')}</div></div>`).join('');
    }
    openSheet(`
      <div class="pop-hero ${hero.c}">
        <div><div class="pop-kind">${hero.t}</div><h2 id="sheetTitle" class="num">${hero.v}</h2><div class="pop-sub num">${hero.s}</div></div>
      </div>
      <div class="pop-list">${list}</div>
      <button class="btn pop-close" data-close>닫기</button>`, 'pop');
    const g = $('#goYears'); if (g) g.onclick = () => { closeSheet(); state.year = y; renderYears(); go('years'); };
    $$('#sheetBody .stat-chip, #sheetBody .stat-row[data-asset]').forEach(b => b.onclick = () => openAsset(b.dataset.asset));
    $$('#sheetBody .stat-row[data-kind]').forEach(b => b.onclick = () => openKind(b.dataset.kind));
    $$('#sheetBody [data-rz]').forEach(b => b.onclick = () => openRzList(b.dataset.rz === 'gain' ? r => r.amount > 0 : r => r.amount < 0, b.dataset.rz === 'gain' ? '익절' : '손절'));
    $$('#sheetBody [data-rzkind]').forEach(b => b.onclick = () => openRzList(r => r.kind === b.dataset.rzkind, b.dataset.rzkind));
  }

  // 실현손익 거래 목록 (올해)
  function openRzList(filter, title) {
    const D = state.data, y = new Date().getFullYear();
    const list = D.realized.filter(r => r.year === y && filter(r)).sort((a, b) => b.date - a.date);
    const sum = list.reduce((t, r) => t + r.amount, 0);
    const bySub = [...groupBy(list, r => String(r.sub || r.asset))].map(([k, l]) => ({ k, amt: l.reduce((t, r) => t + r.amount, 0), n: l.length })).sort((a, b) => b.amt - a.amt);
    openSheet(`
      <div class="pop-hero ${sum >= 0 ? 'gain' : 'loss'}">
        <div><button class="hero-back" id="rzBack">‹ ${y}년 실현손익</button>
          <div class="pop-kind">${esc(title)}</div><h2 id="sheetTitle" class="num">${signWon(sum)}</h2><div class="pop-sub num">${list.length}건</div></div>
      </div>
      <div class="pop-list">
        ${bySub.length > 1 ? `<div class="sub-chips">${bySub.map(x => `<span class="sub-chip num">${esc(x.k)} <b class="${cls(x.amt)}">${compactSigned(x.amt)}</b></span>`).join('')}</div>` : ''}
        ${list.map(r => `<div class="trade"><span>${esc(r.text)}<br><small>${fmtDate(r.date)} · ${esc(r.kind)}</small></span><span class="num ${cls(r.amount)}">${signWon(r.amount)}</span></div>`).join('') || '<p class="empty">거래가 없어요.</p>'}
      </div>
      <button class="btn pop-close" data-close>닫기</button>`, 'pop');
    $('#rzBack').onclick = () => openStat('rz');
  }

  function drawPlan() {
    const el = $('#plan');
    if (!el || !el.clientWidth) return;
    const D = state.data;
    const W = el.clientWidth;
    const H = Math.round(Math.min(W * 1.32, 640));
    el.style.height = `${H}px`;
    // 크기 기준: 원금 또는 평가금
    const byCost = state.basis === 'cost';
    const sz = a => (byCost ? a.cost : a.value);
    const base = byCost ? D.total.cost : D.total.value;
    const wt = a => (base > 0 ? sz(a) / base : 0);
    const kindItems = [...groupBy(D.assets.filter(a => sz(a) > 0), a => a.kind)]
      .map(([k, list]) => ({ k, list, v: list.reduce((s, a) => s + sz(a), 0) }))
      .sort((a, b) => b.v - a.v);
    const rooms = squarify(kindItems, { x: 0, y: 0, w: W, h: H });
    const maxW = Math.max(...D.assets.map(wt));
    const GAP = 3;
    let html = '';
    rooms.forEach(room => {
      const showLabel = room.h > 58 && room.w > 64;
      const top = showLabel ? 20 : 0;
      const kv = room.list.reduce((s, a) => ({ c: s.c + a.cost, v: s.v + a.value }), { c: 0, v: 0 });
      const kindTip = state.mode === 'weight' ? `${((byCost ? kv.c : kv.v) / base * 100).toFixed(1)}%` : pct(kv.c > 0 ? (kv.v - kv.c) / kv.c : null, 1);
      html += `<div class="room" style="left:${room.x}px;top:${room.y}px;width:${room.w}px;height:${room.h}px">`;
      if (showLabel) html += `<div class="room-label">${esc(room.k)}<span>${kindTip}</span></div>`;
      const inner = { x: 0, y: top, w: room.w, h: room.h - top };
      squarify(room.list.filter(a => sz(a) > 0).map(a => ({ a, v: sz(a) })).sort((p, q) => q.v - p.v), inner).forEach(t => {
        const a = t.a;
        const w = Math.max(t.w - GAP, 0), h = Math.max(t.h - GAP, 0);
        const bg = state.mode === 'weight' ? weightColor(wt(a) / (maxW || 1)) : retColor(a.ret ?? 0);
        const fs = Math.max(10, Math.min(26, Math.sqrt(w * h) / 5.8));
        const label = state.mode === 'weight' ? `${(wt(a) * 100).toFixed(1)}%` : pct(a.ret, 1);
        html += `<button class="tile" data-asset="${esc(a.name)}" aria-label="${esc(a.name)} ${label}"
          style="left:${t.x + GAP / 2}px;top:${t.y + GAP / 2}px;width:${w}px;height:${h}px;background:${bg}">
          ${w > 30 && h > 20 ? `<span class="tile-name" style="font-size:${fs}px">${esc(shortName(a.name, w, fs))}</span>` : ''}
          ${w > 40 && h > 38 ? `<span class="tile-val num" style="font-size:${Math.max(10, fs * 0.7)}px">${label}</span>` : ''}
        </button>`;
      });
      html += `</div>`;
    });
    el.innerHTML = html;
    $$('.tile', el).forEach(b => b.onclick = () => openAsset(b.dataset.asset));
    fitPager();
  }

  function shortName(name, w, fs) {
    const max = Math.max(2, Math.floor(w / (fs * 0.62)));
    if (name.length <= max) return name;
    const n = name.replace(/\(.*?\)/g, '').replace(/미국나스닥100레버리지/, '나스닥').trim();
    return n.length <= max ? n : `${n.slice(0, Math.max(1, max - 1))}…`;
  }

  function mix(a, b, t) { return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`; }
  function retColor(r) {
    if (!Number.isFinite(r) || Math.abs(r) < 0.0005) return 'rgb(176,184,193)';
    const t = Math.min(Math.abs(r) / 0.3, 1);
    return r > 0 ? mix([108, 196, 145], [14, 150, 82], t) : mix([246, 145, 152], [222, 48, 66], t);
  }
  function weightColor(t) { return mix([112, 196, 148], [18, 150, 84], Math.sqrt(t)); }

  function squarify(items, rect) {
    const total = items.reduce((s, i) => s + i.v, 0);
    if (!total || rect.w <= 0 || rect.h <= 0) return [];
    const scale = (rect.w * rect.h) / total;
    let rest = items.map(i => ({ ...i, area: i.v * scale }));
    let { x, y, w, h } = rect;
    const out = [];
    const worst = (row, side) => {
      const s = row.reduce((t, r) => t + r.area, 0);
      const mx = Math.max(...row.map(r => r.area)), mn = Math.min(...row.map(r => r.area));
      return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
    };
    while (rest.length) {
      const side = Math.min(w, h);
      let row = [], best = Infinity;
      while (rest.length) {
        const cand = row.concat(rest[0]);
        const wr = worst(cand, side);
        if (row.length && wr > best) break;
        row = cand; best = wr; rest = rest.slice(1);
      }
      const s = row.reduce((t, r) => t + r.area, 0);
      if (w >= h) {
        const cw = rest.length ? s / h : w;
        let cy = y;
        row.forEach(r => { const ch = r.area / cw; out.push({ ...r, x, y: cy, w: cw, h: ch }); cy += ch; });
        x += cw; w -= cw;
      } else {
        const rh = rest.length ? s / w : h;
        let cx = x;
        row.forEach(r => { const cw = r.area / rh; out.push({ ...r, x: cx, y, w: cw, h: rh }); cx += cw; });
        y += rh; h -= rh;
      }
    }
    return out;
  }

  function groupBy(arr, fn) {
    const m = new Map();
    arr.forEach(x => { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
    return m;
  }

  /* ── 자산별 ── */
  function renderAssets() {
    const D = state.data;
    const sorters = { value: (a, b) => b.value - a.value, cost: (a, b) => b.cost - a.cost, ret: (a, b) => (b.ret ?? -9) - (a.ret ?? -9) };
    const groupSort = { value: (a, b) => b.v - a.v, cost: (a, b) => b.c - a.c, ret: (a, b) => (b.ret ?? -9) - (a.ret ?? -9) };
    if (!sorters[state.sort]) state.sort = 'cost';
    const dir = state.sortDir === 'asc' ? -1 : 1;
    const kinds = [...groupBy(D.assets, a => a.kind)].map(([k, list]) => {
      const c = list.reduce((s, a) => s + a.cost, 0), v = list.reduce((s, a) => s + a.value, 0);
      return { k, list: list.sort((a, b) => dir * sorters[state.sort](a, b)), c, v, ret: c > 0 ? (v - c) / c : null };
    }).sort((a, b) => dir * groupSort[state.sort](a, b));
    const arrow = key => state.sort === key ? `<span class="arrow" aria-hidden="true">${state.sortDir === 'asc' ? '↑' : '↓'}</span>` : '';
    const maxAbs = Math.max(0.05, ...D.assets.map(a => Math.abs(a.ret ?? 0)));

    const tot = D.total.value || 1;
    const bar = r => `<span class="bar" aria-hidden="true"><i style="width:${Math.min(100, Math.abs(r ?? 0) / maxAbs * 100)}%;background:${(r ?? 0) >= 0 ? 'var(--bar-up)' : 'var(--down)'}"></i></span>`;
    state.assetGroups = kinds;
    $('#view-assets').innerHTML = `
      <div class="sort">
        <div class="seg" role="group" aria-label="정렬">
          <button data-sort="cost" class="${state.sort === 'cost' ? 'on' : ''}" aria-label="원금 ${state.sort === 'cost' && state.sortDir === 'asc' ? '작은' : '큰'} 순">원금${arrow('cost')}</button>
          <button data-sort="value" class="${state.sort === 'value' ? 'on' : ''}" aria-label="평가금 ${state.sort === 'value' && state.sortDir === 'asc' ? '작은' : '큰'} 순">평가금${arrow('value')}</button>
          <button data-sort="ret" class="${state.sort === 'ret' ? 'on' : ''}" aria-label="수익률 ${state.sort === 'ret' && state.sortDir === 'asc' ? '낮은' : '높은'} 순">수익률${arrow('ret')}</button>
        </div>
      </div>
      <div class="card kind-list">
        ${kinds.map((g, i) => {
          const main = state.sort === 'cost' ? g.c : g.v;
          const share = main / ((state.sort === 'cost' ? D.total.cost : D.total.value) || 1);
          const col = kindColor(g.k);
          const names = g.list.flatMap(a => a.rows.filter(r => !/예수금/.test(r.sub)).map(r => r.sub));
          const subLine = names.length > 1 ? `${names[0]} 외 ${names.length - 1}개` : (names[0] || g.list.map(a => a.name).join(', '));
          return `
          <button class="kl-row" data-kind="${esc(g.k)}" style="--i:${i};--c:${col.fg};--bg:${col.bg};--p:${(share * 100).toFixed(1)}"
            aria-label="${esc(g.k)} ${state.sort === 'cost' ? '원금' : '평가금'} ${compact(main)}원, 전체의 ${(share * 100).toFixed(1)}%">
            <span class="kl-ring" aria-hidden="true"><span class="kl-icon">${esc(kindShort(g.k))}</span></span>
            <span class="kl-main">
              <span class="kl-name">${esc(g.k)}</span>
              <span class="kl-sub">${esc(subLine)}</span>
            </span>
            <span class="kl-right num">
              <span class="kl-amt">${compact(main)}원</span>
              <span class="kl-share">전체의 <b>${(share * 100).toFixed(1)}%</b></span>
            </span>
          </button>`;
        }).join('')}
      </div>
      <p class="note" style="padding:0 6px">링은 전체 ${state.sort === 'cost' ? '원금' : '평가금'} 중 비중이에요. 누르면 수익률과 종목이 나와요.</p>`;
    $$('#view-assets .seg button').forEach(b => b.onclick = () => {
      if (state.sort === b.dataset.sort) state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
      else { state.sort = b.dataset.sort; state.sortDir = 'desc'; }
      store.set(LS.sort, state.sort); store.set('dh_sortdir', state.sortDir);
      renderAssets();
    });
    $$('#view-assets .kl-row').forEach(b => b.onclick = () => openKind(b.dataset.kind));
    state.barFn = bar;
  }

  // 종류마다 고정 색 (원금 큰 순서로 배정 → 정렬을 바꿔도 색이 그대로)
  const KIND_COLORS = [
    { fg: '#3182F6', bg: 'rgba(49,130,246,.14)' }, { fg: '#12A15A', bg: 'rgba(18,161,90,.14)' },
    { fg: '#F5A524', bg: 'rgba(245,165,36,.16)' }, { fg: '#F04452', bg: 'rgba(240,68,82,.14)' },
    { fg: '#8B5CF6', bg: 'rgba(139,92,246,.15)' }, { fg: '#14B8A6', bg: 'rgba(20,184,166,.15)' },
    { fg: '#8B95A1', bg: 'rgba(139,149,161,.18)' }, { fg: '#EC4899', bg: 'rgba(236,72,153,.14)' },
  ];
  function kindColor(k) {
    const order = [...groupBy(state.data.assets, a => a.kind)].map(([n, l]) => [n, l.reduce((t, a) => t + a.cost, 0)]).sort((a, b) => b[1] - a[1]).map(x => x[0]);
    const i = order.indexOf(k);
    return KIND_COLORS[(i < 0 ? 0 : i) % KIND_COLORS.length];
  }
  function kindShort(k) {
    const m = k.match(/\(([^)]+)\)/);
    if (m) return m[1].length > 4 ? m[1].slice(0, 4) : m[1];
    return k.replace(/\s/g, '').slice(0, 2);
  }

  // 종류 타일을 누르면 가운데로 튀어나오는 팝업
  function openKind(k) {
    const D = state.data, g = (state.assetGroups || []).find(x => x.k === k);
    if (!g) return;
    const w = state.sort === 'cost' ? g.c / (D.total.cost || 1) : g.v / (D.total.value || 1);
    const bar = state.barFn;
    openSheet(`
      <div class="pop-hero ${(g.ret ?? 0) >= 0 ? 'gain' : 'loss'}">
        <div>
          <div class="pop-kind">${esc(g.k)}</div>
          <h2 id="sheetTitle" class="num">${won(g.v)}</h2>
          <div class="pop-sub num">원금 ${won(g.c)} · <b>${signWon(g.v - g.c)} (${pct(g.ret)})</b></div>
        </div>
        <span class="kt-donut big" style="--p:${(w * 100).toFixed(1)}" aria-hidden="true"><b>${(w * 100).toFixed(1)}%</b></span>
      </div>
      <div class="pop-list">
        ${g.list.map(a => `
          <button class="row" data-asset="${esc(a.name)}">
            <span>
              <span class="row-name">${esc(a.name)}</span><br>
              <span class="row-sub num">${compact(a.value)}원 · 원금 ${compact(a.cost)}원</span>
            </span>
            <span class="row-right">
              <span class="row-value num ${cls(a.ret)}">${pct(a.ret)}</span><br>
              <span class="row-sub num ${cls(a.pl)}">${signWon(a.pl)}</span>
            </span>
            ${bar(a.ret)}
          </button>`).join('')}
      </div>
      <button class="btn pop-close" data-close>닫기</button>`, 'pop');
    $$('#sheetBody .row').forEach(b => b.onclick = () => openAsset(b.dataset.asset));
  }

  function openAsset(name) {
    const D = state.data;
    const a = D.assets.find(x => x.name === name);
    if (!a) return;
    const thisYear = new Date().getFullYear();
    const rz = D.realized.filter(r => r.asset === name);
    const rzYear = rz.filter(r => r.year === thisYear).reduce((s, r) => s + r.amount, 0);
    const rzAll = rz.reduce((s, r) => s + r.amount, 0);
    const recent = rz.slice().sort((p, q) => q.date - p.date).slice(0, 6);
    // 비중: 포트폴리오에서 고른 기준(원금/평가금)을 따름
    const share = state.basis === 'cost' ? (D.total.cost > 0 ? a.cost / D.total.cost : 0) : a.weight;

    const holdings = a.rows.map(r => {
      const isCash = /예수금/.test(r.sub) || r.method.startsWith('수동');
      const unitRet = r.avg > 0 && r.price > 0 ? (r.price - r.avg) / r.avg : null;
      const money = r.cur === 'USD' ? v => `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : v => won(v);
      const unit = r.ticker === 'ETH' || r.ticker === 'BMB' ? '개' : '주';
      return `
        <div class="holding">
          <div class="holding-top"><span>${esc(r.sub)}</span><span class="num">${won(r.value)}</span></div>
          ${isCash ? (r.cur === 'USD' && r.qty ? `<div class="holding-sub num"><span>${money(r.qty)}</span></div>` : '') : `
          <div class="holding-sub num">
            <span>${r.qty.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}${unit}${r.avg ? ` · 평단 ${money(r.avg)}` : ''} · 현재 ${money(r.price)}</span>
            <span class="${cls(unitRet)}">${unitRet === null ? '' : pct(unitRet, 1)}</span>
          </div>`}
        </div>`;
    }).join('');

    openSheet(`
      <div class="kind">${esc(a.kind)}</div>
      <h2 id="sheetTitle">${esc(a.name)}</h2>
      <div class="stats num">
        <div><div class="stat-label">평가금</div><div class="stat-value">${won(a.value)}</div></div>
        <div><div class="stat-label">원금</div><div class="stat-value">${won(a.cost)}</div></div>
        <div><div class="stat-label">평가손익</div><div class="stat-value ${cls(a.pl)}">${signWon(a.pl)}</div></div>
        <div><div class="stat-label">수익률</div><div class="stat-value ${cls(a.ret)}">${pct(a.ret)}</div></div>
        <div><div class="stat-label">전체 중 비중 <em class="basis-tag">${state.basis === 'cost' ? '원금' : '평가금'} 기준</em></div><div class="stat-value">${(share * 100).toFixed(1)}%</div></div>
        <div><div class="stat-label">${thisYear}년 실현손익</div><div class="stat-value ${cls(rzYear)}">${signWon(rzYear)}</div></div>
      </div>
      <h3 class="section-title">보유 내역</h3>
      ${holdings}
      ${rz.length ? `
        <h3 class="section-title">최근 익절·손절<span class="note">누적 <span class="${cls(rzAll)}">${signWon(rzAll)}</span></span></h3>
        ${recent.map(r => `<div class="trade"><span>${esc(r.text)}<br><small>${fmtDate(r.date)}</small></span><span class="num ${cls(r.amount)}">${signWon(r.amount)}</span></div>`).join('')}` : ''}
      <div class="sheet-actions">
        <button class="btn primary" id="goRecord">이 자산 거래 기록하기</button>
      </div>`);
    $('#goRecord').onclick = () => {
      closeSheet();
      if (!['매수', '매도'].includes(state.form.type)) state.form.type = '매수';
      state.form.kind = a.kind;
      const first = a.rows.find(r => isTradable(r));
      state.form.key = first ? `${first.asset}|${first.sub}` : '';
      renderRecord();
      go('record');
    };
  }

  /* ── 월별·연도별 ── */
  function renderYears() {
    const D = state.data;
    if (!state.year) state.year = D.years.includes(new Date().getFullYear()) ? new Date().getFullYear() : (D.years.at(-1) || 'all');
    const chips = [...D.years.map(y => [y, `${y}년`]), ['all', '전체']];
    const el = $('#view-years');
    el.innerHTML = `
      <div class="pager-dots" id="yTabs" role="tablist" aria-label="수익률 화면">
        <button role="tab" data-p="0"><i></i>자산별</button>
        <button role="tab" data-p="1"><i></i>연도·월별</button>
        <button role="tab" data-p="2"><i></i>자산 성장</button>
      </div>
      <div class="year-chips" id="yChips" role="group" aria-label="연도 선택">
        ${chips.map(([y, l]) => `<button class="chip ${state.year === y ? 'on' : ''}" data-year="${y}">${l}</button>`).join('')}
      </div>
      <div id="yearBody"></div>`;
    $$('.year-chips .chip', el).forEach(b => b.onclick = () => {
      state.year = b.dataset.year === 'all' ? 'all' : Number(b.dataset.year);
      state.openKinds.clear();
      renderYears();
    });
    renderYearBody();
  }

  function renderYearBody() {
    if (state.year === 'all') renderAllYears(); else renderOneYear(state.year);
    const body = $('#yearBody');
    // 화면 순서: 자산별 → 연도·월별 → 자산 성장
    const yp = $('#yPager'); if (yp) { const pg = [...yp.children]; yp.insertBefore(pg[1], pg[0]); }
    yPagerApi = setupPager($('#yPager'), $$('#yTabs button'), {
      start: state.yPage || 0,
      onChange: (i, first) => {
        state.yPage = i;
        const chips = $('#yChips'); if (chips) chips.hidden = i === 2;
        if (!first) { const tabs = $('#yTabs'); const top = tabs.getBoundingClientRect().top + window.scrollY - 70; if (window.scrollY > top) window.scrollTo({ top, behavior: 'smooth' }); }
      },
    });
    bindCompare(body);
    bindBars(body);
    bindLines(body);
    $$('#fxSeg button', body).forEach(b => b.onclick = () => { state.fx = b.dataset.fx === '1'; store.set(LS.fx, state.fx ? '1' : '0'); keepScroll(renderYearBody); });
  }

  const keepScroll = fn => { const y = window.scrollY; fn(); window.scrollTo({ top: y }); };

  /* 누적 수익률 vs 주요 지수 */
  const SERIES = [
    { key: 'mine', label: '내 투자', color: 'var(--up)' },
    { key: 'kospi', label: '코스피', color: 'var(--c-kospi)' },
    { key: 'sp500', label: 'S&P500', color: 'var(--c-sp)', usd: true },
    { key: 'nasdaq', label: '나스닥', color: 'var(--c-nasdaq)', usd: true },
  ];

  function cumulativeSeries() {
    const D = state.data;
    if (!D.realized.length) return null;
    const first = D.realized.reduce((m, r) => (r.date < m ? r.date : m), D.realized[0].date);
    const now = new Date();
    const pts = [];
    // 시작점: 첫 기록 달의 직전 달 말일
    let cur = new Date(first.getFullYear(), first.getMonth(), 0);
    pts.push({ date: cur, label: `${String(cur.getFullYear()).slice(2)}.${cur.getMonth() + 1}` });
    let y = first.getFullYear(), m = first.getMonth();
    while (new Date(y, m, 1) <= now) {
      const end = new Date(y, m + 1, 0, 23, 59, 59);
      pts.push({ date: end > now ? now : end, label: `${String(y).slice(2)}.${m + 1}`, y, m: m + 1 });
      m++; if (m > 11) { m = 0; y++; }
    }
    const base = D.total.cost || 1;
    pts.forEach(p => {
      const cum = D.realized.filter(r => r.date <= p.date).reduce((s, r) => s + r.amount, 0);
      p.mine = cum / base;
    });
    const idx = D.index || {};
    const fxArr = idx.usdkrw || [];
    const at = (arr, date) => {
      const ds = date.toISOString().slice(0, 10);
      let v = null;
      for (const [d, x] of arr) { if (d <= ds) v = x; else break; }
      return v ?? (arr[0] ? arr[0][1] : null);
    };
    const avail = new Set(['mine']);
    SERIES.filter(s => s.key !== 'mine').forEach(s => {
      const arr = idx[s.key] || [];
      if (arr.length < 2) return;
      avail.add(s.key);
      const v0 = at(arr, pts[0].date) * (s.usd && state.fx ? at(fxArr, pts[0].date) || 1 : 1);
      pts.forEach(p => {
        const v = at(arr, p.date) * (s.usd && state.fx ? at(fxArr, p.date) || 1 : 1);
        p[s.key] = v0 ? v / v0 - 1 : null;
      });
    });
    return { pts, avail };
  }

  function cumulativeCard() {
    if (state.data.household.length > 1) return growthCard() + indexSimCard();
    return oldCumulativeCard();
  }

  const won0 = v => `${compactSigned(v)}`;
  const ymLabel = h => `${String(h.y).slice(2)}.${h.m}`;
  const monthEnd = h => new Date(h.y, h.m, 0, 23, 59, 59);

  // ① 우리 집 자산 성장: 순자산 = 시작 + 모은 돈(수입−지출) + 투자손익
  function growthCard() {
    const D = state.data, H = D.household;
    const start = H[0].nw;
    let saveCum = 0, pnlCum = 0;
    const pts = H.map((h, i) => {
      if (i > 0) { pnlCum += h.pnl; saveCum += (h.nw - H[i - 1].nw) - h.pnl; }
      return { label: ymLabel(h), nw: h.nw, save: start + saveCum, saveCum, pnlCum };
    });
    const last = pts.at(-1);
    const unreal = D.total.pl;
    const series = [
      { key: 'nw', label: '순자산', color: 'var(--up)', solid: true },
      { key: 'save', label: '투자 없이 모은 돈만', color: 'var(--ink-4)' },
    ];
    const meta = {
      nw: [['시작', compact(start)], ['늘어난 돈', won0(last.nw - start), cls(last.nw - start)], ['그중 투자', won0(last.pnlCum), cls(last.pnlCum)]],
      save: [['시작', compact(start)], ['모은 돈', won0(last.saveCum), cls(last.saveCum)], ['월평균', won0(last.saveCum / (pts.length - 1)), '']],
    };
    const tot = last.nw - start;
    const wS = Math.max(0, last.saveCum), wP = Math.abs(last.pnlCum);
    return `
      <div class="card">
        <div class="card-head"><h2 class="card-title">우리 집 자산 성장</h2><span class="card-aside">${pts[0].label} → ${last.label}</span></div>
        <div class="gw-hero num"><small>순자산</small><b>${compact(start)} → ${compact(last.nw)}</b><span class="${cls(tot)}">${won0(tot)}</span></div>
        <div class="gw-split" aria-hidden="true"><i style="flex:${wS};background:var(--accent)"></i><i style="flex:${wP};background:${last.pnlCum >= 0 ? 'var(--up)' : 'var(--down)'}"></i></div>
        <div class="gw-legend num">
          <span><i style="background:var(--accent)"></i>모은 돈 (수입 − 지출) <b>${won0(last.saveCum)}</b></span>
          <span><i style="background:${last.pnlCum >= 0 ? 'var(--up)' : 'var(--down)'}"></i>투자 손익 (실현) <b class="${cls(last.pnlCum)}">${won0(last.pnlCum)}</b></span>
        </div>
        <div class="legend">${series.map(s => `<span><i class="${s.key === 'inv' || s.key === 'save' ? 'dash' : ''}" style="border-color:${s.color}"></i>${s.label}</span>`).join('')}</div>
        ${lineChart(pts, series, { L: 46, fmt: v => compact(v), noDot: true, noZero: true, interactive: true, areaKey: 'nw', valFmt: v => `${compact(v)}원`, meta })}
        <p class="note">편한가계부 장부 기준(산 가격). 아직 안 판 종목의 평가손익 <b class="${cls(unreal)}">${won0(unreal)}원</b>은 빠져 있어요 → 반영하면 순자산 약 ${compact(last.nw + unreal)}원.</p>
      </div>`;
  }

  // ② 같은 돈을 지수에 넣었다면: 매달 투자 계좌에 넣은 돈(순투입)으로 지수 ETF를 샀다고 가정
  function indexSimCard() {
    const D = state.data, H = D.household, idx = D.index || {};
    const fx = idx.usdkrw || [];
    const at = (arr, ds) => { let v = null; for (const [d, x] of arr) { if (d <= ds) v = x; else break; } return v ?? (arr[0] ? arr[0][1] : null); };
    const ds = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const IDX = SERIES.filter(s => s.key !== 'mine' && (idx[s.key] || []).length > 1);
    // 월말 평가금 기록이 있는 달은 실제 평가금 사용
    const snap = {};
    (D.monthly || []).forEach(r => {
      const k = String(r['월']).slice(0, 7); if (String(r['종류']) === '기타') return;
      snap[k] = (snap[k] || 0) + num(r['평가금(원)']);
    });
    const myNow = D.assets.filter(a => a.kind !== '기타').reduce((t, a) => t + a.value, 0);
    const units = Object.fromEntries(IDX.map(s => [s.key, 0]));
    let inv = 0;
    const now = new Date();
    const pts = H.map((h, i) => {
      const end = monthEnd(h), d = ds(end > now ? now : end);
      inv += h.flow;
      const p = { label: ymLabel(h), inv };
      IDX.forEach(s => {
        const px = at(idx[s.key], d) * (s.usd ? at(fx, d) || 0 : 1);
        if (px > 0) { units[s.key] += h.flow / px; p[s.key] = units[s.key] * px; }
      });
      const key = `${h.y}-${String(h.m).padStart(2, '0')}`;
      const isLast = i === H.length - 1 && end >= new Date(now.getFullYear(), now.getMonth(), 1);
      p.mine = isLast ? myNow : (snap[key] ?? h.book);
      return p;
    });
    const last = pts.at(-1);
    const series = [
      { key: 'mine', label: '내 투자', color: 'var(--up)', solid: true },
      ...IDX.map(s => ({ key: s.key, label: s.label, color: s.color })),
      { key: 'inv', label: '넣은 돈', color: 'var(--ink-4)' },
    ];
    const r = v => (last.inv > 0 ? v / last.inv - 1 : null);
    const meta = {};
    series.forEach(s => {
      const v = last[s.key];
      meta[s.key] = s.key === 'inv'
        ? [['넣은 돈', compact(v)], ['기간', `${pts[0].label}~`], ['', '']]
        : [['지금', compact(v)], ['넣은 돈 대비', pct(r(v), 1), cls(r(v))], [s.key === 'mine' ? '손익' : '내 투자와 차이', won0(s.key === 'mine' ? v - last.inv : last.mine - v), cls(s.key === 'mine' ? v - last.inv : last.mine - v)]];
    });
    const rows = series.filter(s => s.key !== 'inv').map(s => ({ s, v: last[s.key] })).sort((a, b) => b.v - a.v);
    return `
      <div class="card">
        <div class="card-head"><h2 class="card-title">지수별 비교</h2></div>
        <div class="legend">${series.map(s => `<span><i class="${s.key === 'inv' || s.key === 'save' ? 'dash' : ''}" style="border-color:${s.color}"></i>${s.label}</span>`).join('')}</div>
        ${lineChart(pts, series, { L: 46, fmt: v => compact(v), noDot: true, noZero: true, interactive: true, valFmt: v => `${compact(v)}원`, meta })}
        <div class="sim-list num">
          <div class="sim-row head"><span>넣은 돈 (${pts[0].label}~)</span><b>${won(last.inv)}</b></div>
          ${rows.map(({ s, v }) => `<div class="sim-row ${s.key === 'mine' ? 'me' : ''}"><span><i style="background:${s.color}"></i>${s.key === 'mine' ? '내 투자 (지금 평가금)' : s.label}</span>
            <b>${compact(v)}원 <em class="${cls(r(v))}">${pct(r(v), 1)}</em></b></div>`).join('')}
        </div>
        <p class="note">매달 투자 계좌로 옮긴 돈(순투입)으로 그 달 말 지수 ETF(KODEX 200·SPY·QQQ)를 샀다고 가정해 원화로 계산했어요(환율 포함). 내 투자 선은 지난달까지 장부 기준(원금+실현손익)이고 마지막 점만 지금 평가금이에요. 월말 기록이 쌓이면 그 달부터는 실제 평가금으로 바뀌어요.
        ${IDX.length ? '' : '<br>지수 선은 Apps Script를 새 버전으로 바꾸면 나타나요.'}</p>
      </div>`;
  }

  function oldCumulativeCard() {
    const C = cumulativeSeries();
    if (!C) return '';
    const series = SERIES.filter(s => C.avail.has(s.key));
    const last = C.pts.at(-1);
    return `
      <div class="card">
        <div class="card-head"><h2 class="card-title">지수별 비교</h2>
          ${C.avail.size > 1 ? `<div class="seg" id="fxSeg" role="group" aria-label="환율 반영">
            <button data-fx="0" class="${state.fx ? '' : 'on'}">기본</button><button data-fx="1" class="${state.fx ? 'on' : ''}">환율</button></div>` : '<span class="card-aside">vs 주요 지수</span>'}
        </div>
        <div class="legend">${series.map(s => `<span><i class="${s.key === 'mine' ? '' : 'dash'}" style="border-color:${s.color}"></i>${s.label}</span>`).join('')}</div>
        ${lineChart(C.pts, series)}
        <div class="compare num">
          ${SERIES.map(s => `<div><small>${s.label === '내 투자' ? '내 투자' : s.label}</small><b style="color:${C.avail.has(s.key) ? s.color : 'var(--ink-4)'}">${C.avail.has(s.key) ? pct(last[s.key], 1) : '—'}</b></div>`).join('')}
        </div>
        <p class="note">내 투자 = ${C.pts[1]?.label.replace('.', '년 ')}월부터 쌓인 실현손익 ÷ 현재 투자원금. 지수는 대표 ETF(KODEX 200·SPY·QQQ) 주간 종가로 비교${state.fx ? ', 미국 지수는 원화 환산' : ''}.
        ${C.avail.size > 1 ? '' : '<br>지수 선은 Apps Script를 새 버전으로 바꾸면 나타나요.'}</p>
      </div>`;
  }

  // 부드러운 곡선(단조 3차 보간: 값이 튀지 않음)
  function smoothPath(P) {
    if (!P.length) return '';
    if (P.length < 3) return P.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
    const n = P.length, dx = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = P[i + 1][0] - P[i][0]; m[i] = (P[i + 1][1] - P[i][1]) / (dx[i] || 1); }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : 3 * (dx[i - 1] + dx[i]) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
    let d = `M${P[0][0].toFixed(1)},${P[0][1].toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += `C${(P[i][0] + h).toFixed(1)},${(P[i][1] + t[i] * h).toFixed(1)} ${(P[i + 1][0] - h).toFixed(1)},${(P[i + 1][1] - t[i + 1] * h).toFixed(1)} ${P[i + 1][0].toFixed(1)},${P[i + 1][1].toFixed(1)}`;
    }
    return d;
  }
  let chartSeq = 0;

  function lineChart(pts, series, opt = {}) {
    const W = 340, H = 210, L = opt.L || 38, R = 10, T = 12, B = 24;
    const fmt = opt.fmt || (v => `${Math.round(v * 100)}%`);
    const vals = pts.flatMap(p => series.map(s => p[s.key]).filter(v => Number.isFinite(v)));
    let lo = opt.noZero ? Math.min(...vals) : Math.min(0, ...vals), hi = opt.noZero ? Math.max(...vals) : Math.max(0, ...vals);
    const padV = (hi - lo) * 0.1 || 0.05; lo -= padV; hi += padV;
    const X = i => L + (W - L - R) * (pts.length > 1 ? i / (pts.length - 1) : 0);
    const Y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
    const ticks = [0, 1, 2, 3].map(i => lo + (hi - lo) * i / 3);
    const grid = ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="grid"/>
      <text x="${L - 8}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${fmt(v)}</text>`).join('');
    const zero = opt.noZero || lo > 0 || hi < 0 ? '' : `<line x1="${L}" x2="${W - R}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" class="zero"/>`;
    const step = Math.max(1, Math.ceil(pts.length / 6));
    const xl = pts.map((p, i) => (i % step === 0 || i === pts.length - 1) && !(i !== pts.length - 1 && pts.length - 1 - i < step / 2)
      ? `<text x="${X(i).toFixed(1)}" y="${H - 5}" text-anchor="middle">${p.label}</text>` : '').join('');
    const id = `lc${++chartSeq}`;
    const ptsArr = s => pts.map((p, i) => (Number.isFinite(p[s.key]) ? [X(i), Y(p[s.key])] : null)).filter(Boolean);
    const isMain = s => s.key === 'mine' || s.solid;
    const isRef = s => !isMain(s) && (s.key === 'inv' || s.key === 'save');
    const mainKey = opt.areaKey || (series.find(s => s.key === 'mine') || (opt.interactive ? null : series[0]) || {}).key;
    const base = Math.min(H - B, Math.max(T, opt.noZero ? H - B : Y(Math.max(lo, Math.min(0, hi)))));
    const defs = series.map(s => `<linearGradient id="${id}-${s.key}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style="stop-color:${s.color};stop-opacity:.28"/><stop offset="1" style="stop-color:${s.color};stop-opacity:0"/></linearGradient>`).join('');
    const areas = series.map(s => {
      const P = ptsArr(s); if (P.length < 2) return '';
      return `<path class="area ${s.key === mainKey ? 'on' : ''}" data-k="${s.key}" d="${smoothPath(P)}L${P.at(-1)[0].toFixed(1)},${base.toFixed(1)}L${P[0][0].toFixed(1)},${base.toFixed(1)}Z" fill="url(#${id}-${s.key})"/>`;
    }).join('');
    const lines = series.slice().reverse().map(s => {
      const d = smoothPath(ptsArr(s));
      const w = isMain(s) ? 2.6 : isRef(s) ? 1.5 : 2;
      return `<path class="ln ${isRef(s) ? 'ref' : 'draw'}" data-k="${s.key}" d="${d}" fill="none" stroke="${s.color}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round" ${isRef(s) ? 'stroke-dasharray="4 5"' : 'pathLength="1"'}/>`;
    }).join('');
    const lastP = pts.at(-1);
    const dots = series.filter(s => !isRef(s) && Number.isFinite(lastP[s.key])).map(s => {
      const cx = X(pts.length - 1).toFixed(1), cy = Y(lastP[s.key]).toFixed(1);
      return `<g class="end" data-k="${s.key}"><circle cx="${cx}" cy="${cy}" r="7" fill="${s.color}" opacity=".18"/><circle cx="${cx}" cy="${cy}" r="3.4" fill="${s.color}" stroke="var(--card)" stroke-width="1.6"/></g>`;
    }).join('');
    const svgInner = `<defs>${defs}</defs>${grid}${zero}${areas}${lines}${dots}${xl}`;
    if (!opt.interactive) return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="수익률 비교 그래프">${svgInner}</svg>`;
    const valFmt = opt.valFmt || fmt;
    const info = {
      areaKey: mainKey || null, W, L, R, n: pts.length, xs: pts.map((_, i) => +X(i).toFixed(1)), labels: pts.map(p => p.label),
      series: series.map(s => ({ key: s.key, label: s.label, color: s.color, meta: (opt.meta || {})[s.key] || null, vals: pts.map(p => p[s.key]), ys: pts.map(p => Number.isFinite(p[s.key]) ? +Y(p[s.key]).toFixed(1) : null), fmt: pts.map(p => Number.isFinite(p[s.key]) ? valFmt(p[s.key]) : '—') })),
    };
    const hits = series.map(s => `<path class="hit" data-k="${s.key}" d="${smoothPath(ptsArr(s))}" fill="none" stroke="transparent" stroke-width="22" stroke-linejoin="round"/>`).join('');
    return `<div class="line-wrap" ${opt.detail ? 'data-detail="1"' : ''} data-info='${esc(JSON.stringify(info))}'>
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="비교 그래프. 선을 누르면 이름과 금액이 나와요">${svgInner}
        <line class="guide" x1="0" x2="0" y1="${T}" y2="${H - B}" style="display:none"/>${hits}
        <circle class="pick-halo" r="9" style="display:none" cx="0" cy="0"/>
        <circle class="pick-dot" r="4.5" stroke="var(--card)" stroke-width="2" style="display:none" cx="0" cy="0"/></svg>
      <div class="line-readout num">선을 누르면 자세한 내용이 나와요</div>
    </div>`;
  }

  /* 골라서 비교: 자산 구성(종류) 또는 종목 */
  const CMP_COLORS = ['#3182F6', '#12A15A', '#F5A524', '#F04452', '#8B5CF6'];
  const CMP_MAX = 5;

  // y: 숫자(그 해만) 또는 'all'(전체 기간)
  const inYear = (r, y) => y === 'all' || r.year === y;

  function compareOptions(y = state.year) {
    const D = state.data, now = new Date().getFullYear();
    const rz = D.realized.filter(r => inYear(r, y));
    const holdingsCount = y === 'all' || y === now;
    if (state.cmpMode === 'kind') {
      const compKinds = y === 'all' ? [] : [...D.comp].filter(([k]) => k.startsWith(`${y}|`)).map(([, v]) => v.kind);
      const names = [...new Set([...(holdingsCount ? D.assets.map(a => a.kind) : []), ...compKinds, ...rz.map(r => r.kind)])];
      return names.filter(n => rz.some(r => r.kind === n) || (holdingsCount && D.assets.some(a => a.kind === n && a.cost > 0 && !/현금|기타/.test(n))));
    }
    const subs = [...new Set([...rz.map(r => String(r.sub || '')), ...(holdingsCount ? D.rows.filter(isTradable).map(r => r.sub) : [])])];
    return subs.filter(x => x && !x.startsWith('('));
  }

  function compareScore(n, y) {
    const D = state.data;
    const rz = D.realized.filter(r => inYear(r, y) && (state.cmpMode === 'kind' ? r.kind === n : String(r.sub) === n));
    const hold = state.cmpMode === 'kind' ? D.assets.filter(a => a.kind === n).reduce((t, a) => t + a.cost, 0) : D.rows.filter(r => r.sub === n).reduce((t, r) => t + r.cost, 0);
    return Math.abs(rz.reduce((t, r) => t + r.amount, 0)) + (y === 'all' || y === new Date().getFullYear() ? hold * 0.01 : 0);
  }

  function compareSelection(y = state.year) {
    const opts = compareOptions(y);
    const saved = state.cmpSel[state.cmpMode];
    const sel = Array.isArray(saved) ? saved.filter(x => opts.includes(x)) : [];
    if (sel.length) return sel;
    // 고른 게 이 연도에 없으면 손익이 큰 3개를 보여줌 (저장은 안 함)
    return opts.slice().sort((a, b) => compareScore(b, y) - compareScore(a, y)).slice(0, 3);
  }

  function compareMetrics(name, y) {
    const D = state.data;
    const isKind = state.cmpMode === 'kind';
    const rz = D.realized.filter(r => inYear(r, y) && (isKind ? r.kind === name : String(r.sub) === name));
    const rows = isKind ? D.rows.filter(r => r.kind === name) : D.rows.filter(r => r.sub === name && isTradable(r));
    const cost = rows.reduce((t, r) => t + r.cost, 0), value = rows.reduce((t, r) => t + r.value, 0);
    const avgRow = !isKind && rows.length === 1 && rows[0].avg > 0 && rows[0].price > 0 ? rows[0] : null;
    let base = null;
    if (isKind && y !== 'all') {
      const b = [...D.comp].filter(([k, v]) => k.startsWith(`${y}|`) && v.kind === name && v.base).reduce((t, [, v]) => t + v.base, 0);
      base = b || null;
    }
    const amt = rz.reduce((t, r) => t + r.amount, 0);
    return {
      amt, base, baseRet: base ? amt / base : null,
      thisYear: D.realized.filter(r => r.year === new Date().getFullYear() && (isKind ? r.kind === name : String(r.sub) === name)).reduce((t, r) => t + r.amount, 0),
      value, ret: avgRow ? (avgRow.price - avgRow.avg) / avgRow.avg : (cost > 0 ? (value - cost) / cost : null),
      rz,
    };
  }

  function monthPoints(y) {
    const D = state.data, now = new Date(), pts = [];
    if (y !== 'all') {
      pts.push({ date: new Date(y, 0, 0, 23, 59, 59), label: '시작' });
      for (let m = 0; m < 12; m++) {
        if (new Date(y, m, 1) > now) break;
        const end = new Date(y, m + 1, 0, 23, 59, 59);
        pts.push({ date: end > now ? now : end, label: `${m + 1}월` });
      }
      return pts;
    }
    const first = D.realized.reduce((m, r) => (r.date < m ? r.date : m), D.realized[0].date);
    let yy = first.getFullYear(), mm = first.getMonth();
    const start = new Date(yy, mm, 0);
    pts.push({ date: start, label: `${String(start.getFullYear()).slice(2)}.${start.getMonth() + 1}` });
    while (new Date(yy, mm, 1) <= now) {
      const end = new Date(yy, mm + 1, 0, 23, 59, 59);
      pts.push({ date: end > now ? now : end, label: `${String(yy).slice(2)}.${mm + 1}` });
      mm++; if (mm > 11) { mm = 0; yy++; }
    }
    return pts;
  }

  function compareCard(y = state.year) {
    const D = state.data;
    if (!D.realized.length) return '';
    const sel = compareSelection(y);
    const color = n => CMP_COLORS[sel.indexOf(n)] || 'var(--ink-4)';
    const M = Object.fromEntries(sel.map(n => [n, compareMetrics(n, y)]));
    const pts = monthPoints(y);
    const series = sel.map((n, i) => ({ key: `c${i}`, label: n, color: CMP_COLORS[i], solid: true }));
    pts.forEach(p => sel.forEach((n, i) => { p[`c${i}`] = M[n].rz.filter(r => r.date <= p.date).reduce((t, r) => t + r.amount, 0); }));
    const ty = new Date().getFullYear();
    const yearLabel = y === 'all' ? '전체 기간' : `${y}년`;
    return `
      <div class="card">
        <div class="card-head"><h2 class="card-title">자산별 비교</h2>
          <div class="seg" id="cmpMode" role="group" aria-label="비교 단위">
            <button data-mode="kind" class="${state.cmpMode === 'kind' ? 'on' : ''}">자산 구성</button>
            <button data-mode="sub" class="${state.cmpMode === 'sub' ? 'on' : ''}">종목</button>
          </div>
        </div>
        ${sel.length ? `
          <div class="cmp-label">${yearLabel} 누적 실현손익</div>
          ${lineChart(pts, series, { L: 46, fmt: v => compactSigned(v), noDot: true, interactive: true, detail: true, valFmt: v => `${compactSigned(v)}원`,
            meta: Object.fromEntries(sel.map((n, i) => { const m = M[n]; return [`c${i}`, y === 'all'
              ? [['누적 실현', compactSigned(m.amt), cls(m.amt)], [`${ty}년`, m.thisYear ? compactSigned(m.thisYear) : '—', cls(m.thisYear)], ['지금 수익률', m.value > 0 ? pct(m.ret, 1) : '보유 없음', cls(m.ret)]]
              : [[`${y}년 실현`, m.amt ? compactSigned(m.amt) : '—', cls(m.amt)], ['기준원금 대비', pct(m.baseRet, 1), cls(m.baseRet)], ['지금 수익률', m.value > 0 ? pct(m.ret, 1) : '보유 없음', cls(m.ret)]]]; })) })}
          <div class="pick small">
            <button class="pick-edit" id="cmpPick" aria-label="비교할 항목 바꾸기"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>변경</button>
            ${sel.map(n => `<span class="pick-chip on" style="--c:${color(n)}"><i></i>${esc(n)}</span>`).join('')}
          </div>
          <p class="note">위의 연도를 바꾸면 그 해 기준으로 비교해요.<br>지금 수익률 = 보유 중인 평가금 기준${state.cmpMode === 'sub' ? '(종목은 평단 대비)' : ''}.</p>`
        : `<p class="empty">${yearLabel}에 비교할 기록이 없어요.</p>
          <div class="pick small"><button class="pick-add" id="cmpPick">+ 비교할 자산 고르기</button></div>`}
      </div>`;
  }

  function bindCompare(el) {
    $$('#cmpMode button', el).forEach(b => b.onclick = () => { state.cmpMode = b.dataset.mode; store.set('dh_cmpmode', state.cmpMode); keepScroll(renderYearBody); });
    const btn = $('#cmpPick', el);
    if (btn) btn.onclick = openComparePicker;
  }

  // 비교할 항목 고르는 팝업
  function openComparePicker() {
    const y = state.year;
    const opts = compareOptions(y);
    let sel = compareSelection(y).slice();
    const D = state.data;
    const draw = () => {
      openSheet(`
        <div class="picker">
          <h2 id="sheetTitle">비교할 ${state.cmpMode === 'kind' ? '자산 구성' : '종목'} 고르기</h2>
          <p class="kind">${y === 'all' ? '전체 기간' : `${y}년`} · 최대 ${CMP_MAX}개 · ${sel.length}개 선택</p>
          <div class="picker-list">
            ${opts.map(n => {
              const i = sel.indexOf(n);
              const amt = D.realized.filter(r => inYear(r, y) && (state.cmpMode === 'kind' ? r.kind === n : String(r.sub) === n)).reduce((t, r) => t + r.amount, 0);
              return `<button class="picker-item ${i >= 0 ? 'on' : ''}" data-name="${esc(n)}" style="--c:${CMP_COLORS[i] || 'var(--line)'}" aria-pressed="${i >= 0}">
                <span class="check" aria-hidden="true">${i >= 0 ? '✓' : ''}</span>
                <span class="picker-name">${esc(n)}</span>
                <span class="picker-amt num ${cls(amt)}">${amt ? compactSigned(amt) : ''}</span>
              </button>`;
            }).join('')}
          </div>
          <div class="sheet-actions"><button class="btn primary" id="pickDone">${sel.length ? `${sel.length}개 비교하기` : '닫기'}</button></div>
        </div>`, 'pop');
      $$('#sheetBody .picker-item').forEach(b => b.onclick = () => {
        const n = b.dataset.name;
        if (sel.includes(n)) sel.splice(sel.indexOf(n), 1);
        else if (sel.length >= CMP_MAX) { toast(`최대 ${CMP_MAX}개까지 비교할 수 있어요`); return; }
        else sel.push(n);
        const sc = $('.picker-list').scrollTop; draw(); $('.picker-list').scrollTop = sc;
      });
      $('#pickDone').onclick = () => {
        state.cmpSel[state.cmpMode] = sel;
        store.set('dh_cmpsel', JSON.stringify(state.cmpSel));
        closeSheet();
        keepScroll(renderYearBody);
      };
    };
    draw();
  }

  // 선 그래프: 선을 누르면 그 자산 이름과 그 시점 금액 표시
  function bindLines(root) {
    $$('.line-wrap', root).forEach(wrap => {
      const svg = $('svg', wrap), ro = $('.line-readout', wrap);
      const info = JSON.parse(wrap.dataset.info || '{}');
      $$('.hit', svg).forEach(h => h.onclick = e => {
        const k = h.dataset.k, s = info.series.find(x => x.key === k);
        const r = svg.getBoundingClientRect();
        const vx = (e.clientX - r.left) / r.width * info.W;
        let i = Math.round((vx - info.L) / ((info.W - info.L - info.R) / Math.max(1, info.n - 1)));
        i = Math.max(0, Math.min(info.n - 1, i));
        const v = s.vals[i];
        $$('.ln, .end', svg).forEach(l => l.classList.toggle('dim', l.dataset.k !== k));
        $$('.area', svg).forEach(a => a.classList.toggle('on', a.dataset.k === k));
        const dot = $('.pick-dot', svg), halo = $('.pick-halo', svg), guide = $('.guide', svg);
        dot.setAttribute('cx', info.xs[i]); dot.setAttribute('cy', s.ys[i]); dot.setAttribute('fill', s.color); dot.style.display = '';
        halo.setAttribute('cx', info.xs[i]); halo.setAttribute('cy', s.ys[i]); halo.style.fill = s.color; halo.style.display = '';
        guide.setAttribute('x1', info.xs[i]); guide.setAttribute('x2', info.xs[i]); guide.style.display = '';
        ro.innerHTML = `<div class="ro-top"><i style="background:${s.color}"></i><b>${esc(s.label)}</b><span>${esc(info.labels[i])}</span><b class="${cls(v)}">${esc(s.fmt[i])}</b></div>
          ${s.meta ? `<div class="ro-cells">${s.meta.map(([l, t, c]) => `<div><small>${esc(l)}</small><b class="${c}">${esc(t)}</b></div>`).join('')}</div>` : ''}
          ${wrap.dataset.detail ? `<div class="ro-more">눌러서 거래·월별·보유 자세히 보기 ›</div>` : ''}`;
        ro.style.setProperty('--c', s.color);
        ro.classList.add('on');
        if (wrap.dataset.detail) {
          ro.classList.add('tap'); ro.setAttribute('role', 'button'); ro.tabIndex = 0;
          ro.onclick = () => openSeriesDetail(s.label, s.color);
          ro.onkeydown = ev => { if (ev.key === 'Enter') openSeriesDetail(s.label, s.color); };
        }
      });
      svg.addEventListener('click', e => {
        if (e.target.classList.contains('hit')) return;
        $$('.ln, .end', svg).forEach(l => l.classList.remove('dim'));
        $$('.area', svg).forEach(a => a.classList.toggle('on', a.dataset.k === info.areaKey));
        ['.pick-dot', '.pick-halo', '.guide'].forEach(q => { $(q, svg).style.display = 'none'; });
        ro.classList.remove('on', 'tap'); ro.onclick = null; ro.onkeydown = null; ro.removeAttribute('role'); ro.removeAttribute('tabindex');
        ro.innerHTML = '선을 누르면 자세한 내용이 나와요';
      });
    });
  }

  // 비교 그래프의 상세 카드를 누르면: 그 자산 구성/종목의 월별 손익·보유·거래 전체
  function openSeriesDetail(name, color = 'var(--accent)') {
    const D = state.data, y = state.year, isKind = state.cmpMode === 'kind';
    const m = compareMetrics(name, y);
    const list = m.rz.slice().sort((a, b) => b.date - a.date);
    const g = list.filter(r => r.amount > 0), l = list.filter(r => r.amount < 0);
    const yearLabel = y === 'all' ? '전체 기간' : `${y}년`;
    const hold = (isKind ? D.rows.filter(r => r.kind === name) : D.rows.filter(r => r.sub === name)).filter(r => r.cost > 0 || r.value > 0);
    const hCost = hold.reduce((t, r) => t + r.cost, 0), hVal = hold.reduce((t, r) => t + r.value, 0);
    // 월별 묶음 (전체 기간이면 연.월)
    const key = r => (y === 'all' ? `${String(r.year).slice(2)}.${String(r.month).padStart(2, '0')}` : `${r.month}월`);
    const months = [...groupBy(list, key)].map(([k, x]) => ({
      k, amt: x.reduce((t, r) => t + r.amount, 0), g: x.filter(r => r.amount > 0).length, l: x.filter(r => r.amount < 0).length,
      order: x[0].year * 100 + x[0].month, items: x,
    })).sort((a, b) => a.order - b.order);
    const mx = Math.max(...months.map(x => Math.abs(x.amt)), 1);
    const cells = [
      [y === 'all' ? '누적 실현' : `${y}년 실현`, m.amt ? compactSigned(m.amt) : '—', cls(m.amt)],
      [y === 'all' ? `${new Date().getFullYear()}년` : '기준원금 대비', y === 'all' ? (m.thisYear ? compactSigned(m.thisYear) : '—') : pct(m.baseRet, 1), cls(y === 'all' ? m.thisYear : m.baseRet)],
      ['지금 수익률', hVal > 0 ? pct(hCost > 0 ? (hVal - hCost) / hCost : null, 1) : '보유 없음', cls(hVal - hCost)],
    ];
    openSheet(`
      <div class="pop-hero ${m.amt >= 0 ? 'gain' : 'loss'}">
        <div><div class="pop-kind">${yearLabel} · ${isKind ? '자산 구성' : '종목'}</div>
          <div class="sd-name"><i style="background:${color}"></i>${esc(name)}</div>
          <h2 id="sheetTitle" class="num">${signWon(m.amt)}</h2>
          <div class="pop-sub num">${[g.length ? `익절 ${g.length}건 ${compactSigned(g.reduce((t, r) => t + r.amount, 0))}` : '', l.length ? `손절 ${l.length}건 ${compactSigned(l.reduce((t, r) => t + r.amount, 0))}` : ''].filter(Boolean).join(' · ') || '실현손익 기록 없음'}</div></div>
      </div>
      <div class="pop-list">
        <div class="ro-cells sd-cells num">${cells.map(([a, b, c]) => `<div><small>${esc(a)}</small><b class="${c}">${esc(b)}</b></div>`).join('')}</div>
        ${months.length ? `<h3 class="section-title">월별 실현손익 <span class="note">월을 누르면 거래 건</span></h3>
          ${months.map((x, i) => `<div class="sd-month-wrap">
            <button class="sd-month num" data-i="${i}" aria-expanded="false">
              <span class="sd-m">${esc(x.k)}</span>
              <span class="sd-bar" aria-hidden="true"><i style="width:${Math.max(2, Math.abs(x.amt) / mx * 100)}%;background:${x.amt >= 0 ? 'var(--bar-up)' : 'var(--down)'}"></i></span>
              <b class="${cls(x.amt)}">${compactSigned(x.amt)}</b>
              <small>${x.g ? `익절 ${x.g}` : ''}${x.g && x.l ? ' · ' : ''}${x.l ? `손절 ${x.l}` : ''}<span class="sd-chev" aria-hidden="true">›</span></small>
            </button>
            <div class="sd-trades" hidden>
              ${x.items.slice().sort((a, b) => b.date - a.date).map(r => `<div class="trade"><span>${esc(r.text)}<br><small>${fmtDate(r.date)}${isKind ? ` · ${esc(r.sub || r.asset)}` : ''}</small></span><span class="num ${cls(r.amount)}">${signWon(r.amount)}</span></div>`).join('')}
            </div>
          </div>`).join('')}` : '<p class="empty">이 기간에는 실현손익 기록이 없어요.</p>'}
        ${hold.length ? `<h3 class="section-title">지금 보유 <span class="note">${compact(hVal)}원 · 원금 ${compact(hCost)}원</span></h3>
          ${hold.map(r => {
            const ret = r.avg > 0 && r.price > 0 && isTradable(r) ? (r.price - r.avg) / r.avg : (r.cost > 0 ? (r.value - r.cost) / r.cost : null);
            return `<button class="stat-row tap" data-asset="${esc(r.asset)}">
              <div class="stat-row-top"><span class="stat-row-name">${esc(r.sub)}</span><b class="num">${won(r.value)}</b></div>
              <div class="stat-row-sub num">${r.qty && isTradable(r) ? `${r.qty.toLocaleString('ko-KR')}주 · ` : ''}원금 ${compact(r.cost)}원 · <span class="${cls(ret)}">${pct(ret, 1)}</span></div>
            </button>`;
          }).join('')}` : ''}
      </div>
      <button class="btn pop-close" data-close>닫기</button>`, 'pop');
    $$('#sheetBody .stat-row[data-asset]').forEach(b => b.onclick = () => openAsset(b.dataset.asset));
    $$('#sheetBody .sd-month').forEach(b => b.onclick = () => {
      const box = b.nextElementSibling, open = box.hidden;
      box.hidden = !open; b.setAttribute('aria-expanded', String(open)); b.classList.toggle('open', open);
    });
  }

  function renderOneYear(y) {
    const D = state.data;
    const list = D.realized.filter(r => r.year === y);
    const sum = list.reduce((s, r) => s + r.amount, 0);
    const gains = list.filter(r => r.amount > 0), losses = list.filter(r => r.amount < 0);
    const byMonth = byMonthOf(list);

    const compAssets = [...D.comp].filter(([k]) => k.startsWith(`${y}|`)).map(([k, v]) => ({ asset: k.split('|')[1], ...v }));
    const kindOrder = [];
    compAssets.forEach(c => { if (!kindOrder.includes(c.kind)) kindOrder.push(c.kind); });
    list.forEach(r => { if (!kindOrder.includes(r.kind)) kindOrder.push(r.kind); });
    const kinds = kindOrder.map(k => {
      const assets = [...new Set([...compAssets.filter(c => c.kind === k).map(c => c.asset), ...list.filter(r => r.kind === k).map(r => r.asset)])];
      const rows = assets.map(a => {
        const mine = list.filter(r => r.asset === a);
        const amt = mine.reduce((s, r) => s + r.amount, 0);
        const base = D.comp.get(`${y}|${a}`)?.base ?? null;
        const subs = [...groupBy(mine, r => String(r.sub || a))].map(([s, l]) => ({ s, amt: l.reduce((t, r) => t + r.amount, 0), n: l.length }))
          .sort((p, q) => q.amt - p.amt);
        return { a, amt, base, ret: base ? amt / base : null, subs };
      }).sort((p, q) => q.amt - p.amt);
      const amt = rows.reduce((s, r) => s + r.amt, 0);
      const baseRows = rows.filter(r => r.base);
      const base = baseRows.reduce((s, r) => s + r.base, 0);
      return { k, rows, amt, ret: base ? baseRows.reduce((s, r) => s + r.amt, 0) / base : null, months: byMonthOf(list.filter(r => r.kind === k)) };
    });
    const totalBase = kinds.flatMap(k => k.rows).filter(r => r.base).reduce((s, r) => s + r.base, 0);
    const totalRet = totalBase ? sum / totalBase : null;
    const activeMonths = byMonth.map((v, i) => [i + 1, v]).filter(([, v], i) => v !== 0 || kinds.some(k => k.months[i] !== 0));
    const shownKinds = kinds.filter(k => k.months.some(v => v !== 0));
    const best = activeMonths.slice().sort((a, b) => b[1] - a[1])[0], worst = activeMonths.slice().sort((a, b) => a[1] - b[1])[0];

    $('#yearBody').innerHTML = `
      <div class="pager" id="yPager"><div class="page">
      <div class="card">
        <div class="kpi-label">${y}년 실현손익</div>
        <div class="kpi-value num ${cls(sum)}">${signWon(sum)}</div>
        <div class="kpi-sub num">
          <span>익절 ${gains.length}건 <span class="up">${compactSigned(gains.reduce((s, r) => s + r.amount, 0))}</span></span>
          <span>손절 ${losses.length}건 <span class="down">${compactSigned(losses.reduce((s, r) => s + r.amount, 0))}</span></span>
          ${totalRet !== null ? `<span>기준원금 대비 <span class="${cls(totalRet)}">${pct(totalRet)}</span></span>` : ''}
        </div>
        ${barChart(byMonth.map((v, i) => [`${i + 1}월`, v]), { mode: 'month', year: y })}
      </div>

      <div class="card">
        <button class="card-head fold" id="monthsFold" aria-expanded="${state.monthsOpen}">
          <h2 class="card-title">월별 상세</h2>
          <span class="fold-right num"><span class="fold-hint">${state.monthsOpen ? '접기' : `${activeMonths.length}개월`}</span><span class="chev ${state.monthsOpen ? 'up' : ''}" aria-hidden="true"></span></span>
        </button>
        ${!activeMonths.length ? `<p class="empty">${y}년 실현손익 기록이 아직 없어요.</p>` : !state.monthsOpen ? `
        <div class="fold-preview num">
          ${best && best[1] > 0 ? `<span>가장 좋았던 달 ${best[0]}월 <b class="up">${compactSigned(best[1])}</b></span>` : ''}
          ${worst && worst[1] < 0 ? `<span>가장 아쉬운 달 ${worst[0]}월 <b class="down">${compactSigned(worst[1])}</b></span>` : ''}
        </div>` : (() => {
          const maxM = Math.max(...activeMonths.map(([, v]) => Math.abs(v)), 1);
          return activeMonths.slice().reverse().map(([m, v]) => {
            const open = state.openMonths.has(`${y}-${m}`);
            const ks = shownKinds.filter(k => k.months[m - 1] !== 0).sort((p, q) => Math.abs(q.months[m - 1]) - Math.abs(p.months[m - 1]));
            const showTrades = state.openTrades.has(`${y}-${m}`);
            const items = list.filter(r => r.month === m).sort((p, q) => q.date - p.date);
            return `
            <div class="month ${open ? 'open' : ''}">
              <button class="month-head" data-month="${m}" aria-expanded="${open}">
                <span class="month-name">${m}월</span>
                <span class="month-total num ${cls(v)}">${signWon(v)}</span>
                <span class="chev ${open ? 'up' : ''}" aria-hidden="true"></span>
              </button>
              <div class="month-bar" aria-hidden="true"><i style="width:${Math.abs(v) / maxM * 100}%;background:${v >= 0 ? 'var(--up)' : 'var(--down)'}"></i></div>
              ${open ? `
              <div class="month-kinds num">
                ${ks.map(k => `<div><span>${esc(k.k)}</span><b class="${cls(k.months[m - 1])}">${signWon(k.months[m - 1])}</b></div>`).join('')}
              </div>
              <button class="link-btn" data-trades="${m}">${showTrades ? '거래 접기' : `거래 ${items.length}건 보기`}</button>
              ${showTrades ? `<div class="month-items">${items.map(r => `<div class="trade"><span>${esc(r.text)}<br><small>${fmtDate(r.date)} · ${esc(r.kind)}</small></span><span class="num ${cls(r.amount)}">${signWon(r.amount)}</span></div>`).join('')}</div>` : ''}` : ''}
            </div>`;
          }).join('');
        })()}
      </div>

      </div><div class="page">
      ${compareCard(y)}

      <div class="card">
        <button class="card-head fold" id="kindsFold" aria-expanded="${state.kindsOpen}">
          <h2 class="card-title">종류별 비교</h2>
          <span class="fold-right num">${state.kindsOpen ? '<span class="fold-hint">접기</span>' : `<span class="${cls(sum)}">${compactSigned(sum)}원</span>`}<span class="chev ${state.kindsOpen ? 'up' : ''}" aria-hidden="true"></span></span>
        </button>
        ${state.kindsOpen ? `<p class="note" style="margin:-6px 0 8px">종류를 누르면 자산·종목별로 펼쳐져요</p>
        <div class="table-wrap">
          <table class="grid num kinds">
            <thead><tr><th>종류</th>${[['amt', '수익금'], ['ret', '수익률']].map(([k, l]) => `<th><button class="th-sort ${state.kindSort === k ? 'on' : ''}" data-sort="${k}" aria-pressed="${state.kindSort === k}">${l}<span aria-hidden="true">${state.kindSort === k ? '↓' : '↕'}</span></button></th>`).join('')}</tr></thead>
            <tbody>
              ${(state.kindSort ? kinds.slice().sort((p, q) => (q[state.kindSort] ?? -Infinity) - (p[state.kindSort] ?? -Infinity)) : kinds).map(k => `
                <tr class="kind-row" data-kind="${esc(k.k)}">
                  <td><span class="caret">${state.openKinds.has(k.k) ? '▼' : '▶'}</span>${esc(k.k)}</td>
                  <td class="${cls(k.amt)}">${signWon(k.amt)}</td>
                  <td class="${cls(k.ret)}">${pct(k.ret)}</td>
                </tr>
                ${state.openKinds.has(k.k) ? kindDetailRows(k) : ''}`).join('')}
              <tr class="total"><td>합계</td><td class="${cls(sum)}">${signWon(sum)}</td><td class="${cls(totalRet)}">${pct(totalRet)}</td></tr>
            </tbody>
          </table>
        </div>
        <p class="note">수익률 = 실현손익 ÷ 기준원금(시트의 연도별구성 탭). 기준원금이 없는 자산은 수익금만 보여요.</p>` : `
        <div class="fold-preview num">${kinds.filter(k => k.amt !== 0).sort((p, q) => Math.abs(q.amt) - Math.abs(p.amt)).slice(0, 3)
          .map(k => `<span>${esc(k.k)} <b class="${cls(k.amt)}">${compactSigned(k.amt)}</b></span>`).join('')}</div>`}
      </div>

      </div><div class="page">
      ${cumulativeCard()}
      ${monthlyEvalCard(y)}
      </div></div>`;

    $('#monthsFold').onclick = () => { state.monthsOpen = !state.monthsOpen; keepScroll(renderYearBody); };
    $('#kindsFold').onclick = () => { state.kindsOpen = !state.kindsOpen; keepScroll(renderYearBody); };
    $$('#yearBody .month-head').forEach(el => el.onclick = () => {
      const key = `${y}-${el.dataset.month}`;
      state.openMonths.has(key) ? state.openMonths.delete(key) : state.openMonths.add(key);
      keepScroll(renderYearBody);
    });
    $$('#yearBody [data-trades]').forEach(el => el.onclick = () => {
      const key = `${y}-${el.dataset.trades}`;
      state.openTrades.has(key) ? state.openTrades.delete(key) : state.openTrades.add(key);
      keepScroll(renderYearBody);
    });
    $$('#yearBody .th-sort').forEach(b => b.onclick = e => {
      e.stopPropagation();
      state.kindSort = state.kindSort === b.dataset.sort ? null : b.dataset.sort;
      store.set('dh_kindsort', state.kindSort || '');
      keepScroll(renderYearBody);
    });
    $$('#yearBody .kind-row').forEach(tr => tr.onclick = () => {
      const k = tr.dataset.kind;
      state.openKinds.has(k) ? state.openKinds.delete(k) : state.openKinds.add(k);
      keepScroll(renderYearBody);
    });
  }

  // 종류를 펼치면: 자산 → 그 안의 종목별 손익까지
  function kindDetailRows(k) {
    const subRow = (s, indent) => `<tr class="sub ${indent ? 'subsub' : ''}"><td>${esc(s.s)}<small class="cnt"> ${s.n}건</small></td><td class="${cls(s.amt)}">${signWon(s.amt)}</td><td></td></tr>`;
    if (k.rows.length === 1 && k.rows[0].a === k.k) return k.rows[0].subs.map(s => subRow(s, false)).join('');
    return k.rows.map(r => {
      const showSubs = r.subs.length > 1 || (r.subs.length === 1 && r.subs[0].s !== r.a);
      return `<tr class="sub"><td>${esc(r.a)}</td><td class="${cls(r.amt)}">${signWon(r.amt)}</td><td class="${cls(r.ret)}">${pct(r.ret)}</td></tr>
        ${showSubs ? r.subs.map(s => subRow(s, true)).join('') : ''}`;
    }).join('');
  }

  function byMonthOf(list) { return Array.from({ length: 12 }, (_, i) => list.filter(r => r.month === i + 1).reduce((s, r) => s + r.amount, 0)); }

  function monthlyEvalCard(y) {
    const rows = state.data.monthly.filter(m => String(m['월']).startsWith(String(y)));
    if (!rows.length) return `<div class="card"><div class="card-head"><h2 class="card-title">월말 평가금</h2></div><p class="note" style="margin:0">매달 말일 밤 자산별 평가금이 자동 저장돼요. 쌓이기 시작하면 여기에 달마다 나옵니다.</p></div>`;
    const months = [...groupBy(rows, r => String(r['월']).slice(0, 7))].map(([m, list]) => {
      const c = list.reduce((s, r) => s + num(r['원금(원)']), 0), v = list.reduce((s, r) => s + num(r['평가금(원)']), 0);
      return { m, c, v, ret: c ? (v - c) / c : null };
    });
    return `<div class="card"><div class="card-head"><h2 class="card-title">월말 평가금</h2></div>
      <div class="table-wrap"><table class="grid num">
        <thead><tr><th>월</th><th>원금</th><th>평가금</th><th>평가수익률</th></tr></thead>
        <tbody>${months.map(r => `<tr><td>${Number(r.m.slice(5))}월</td><td>${compact(r.c)}</td><td>${compact(r.v)}</td><td class="${cls(r.ret)}">${pct(r.ret)}</td></tr>`).join('')}</tbody>
      </table></div></div>`;
  }

  function renderAllYears() {
    const D = state.data;
    let cum = 0;
    const rows = D.years.map(y => {
      const amt = D.realized.filter(r => r.year === y).reduce((s, r) => s + r.amount, 0);
      cum += amt;
      return { y, amt, cum };
    });
    const total = rows.reduce((s, r) => s + r.amt, 0);
    $('#yearBody').innerHTML = `
      <div class="pager" id="yPager"><div class="page">
      <div class="card">
        <div class="kpi-label">전체 기간 실현손익</div>
        <div class="kpi-value num ${cls(total)}">${signWon(total)}</div>
        <div class="kpi-sub"><span>${D.realized.length}건 기록</span></div>
        ${barChart(rows.map(r => [`${r.y}`, r.amt]), { mode: 'year' })}
        <div class="table-wrap" style="margin-top:8px"><table class="grid num">
          <thead><tr><th>연도</th><th>수익금</th><th>누적</th></tr></thead>
          <tbody>${rows.map(r => `<tr><td>${r.y}년</td><td class="${cls(r.amt)}">${signWon(r.amt)}</td><td class="${cls(r.cum)}">${signWon(r.cum)}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>
      </div><div class="page">
      ${compareCard('all')}
      </div><div class="page">
      ${cumulativeCard()}
      </div></div>`;
  }

  function barChart(pairs, ctx = {}) {
    const W = 340, H = 168, padB = 22, padT = 12;
    const posMax = Math.max(0, ...pairs.map(([, v]) => v)), negMax = Math.max(0, ...pairs.map(([, v]) => -v));
    const span = H - padT - padB;
    const tot = (posMax + negMax) || 1;
    const zy = padT + span * (posMax / tot);
    const scale = span / tot;
    const bw = W / pairs.length;
    const last = pairs.map(([, v], i) => (v ? i : -1)).filter(i => i >= 0).pop() ?? 0;
    const bars = pairs.map(([l, v], i) => {
      const h = Math.max(Math.abs(v) * scale, v ? 3 : 0);
      const y = v >= 0 ? zy - h : zy;
      const x = i * bw + bw * 0.22, w = bw * 0.56;
      const col = v >= 0 ? 'var(--up)' : 'var(--down)';
      return `<g class="bar-g ${i === last ? 'sel' : ''}" data-i="${i}" data-label="${esc(l)}" data-v="${v}">
        <rect x="${i * bw}" y="0" width="${bw}" height="${H}" fill="transparent"/>
        <rect class="track" x="${x}" y="${padT}" width="${w}" height="${span}" rx="${w / 2}" fill="var(--fill)"/>
        ${v ? `<rect class="val" x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(w / 2, h / 2)}" fill="${col}"/>` : ''}
        <text x="${i * bw + bw / 2}" y="${H - 5}" text-anchor="middle">${esc(l.replace('월', ''))}</text>
      </g>`;
    }).join('');
    const [ll, lv] = pairs[last] || ['', 0];
    return `<div class="bar-wrap" data-mode="${ctx.mode || ''}" data-year="${ctx.year || ''}">
      <div class="bar-readout num"><span class="br-label">${esc(ll)}</span><b class="br-value ${cls(lv)}">${signWon(lv)}</b><span class="br-hint">한 번 더 누르면 자세히</span></div>
      <svg class="chart bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="실현손익 막대 그래프. 막대를 누르면 금액이 나와요">
        <line x1="0" x2="${W}" y1="${zy}" y2="${zy}" stroke="var(--line)" stroke-width="1"/>${bars}</svg>
    </div>`;
  }

  function bindBars(root) {
    $$('.bar-wrap', root).forEach(wrap => {
      $$('.bar-g', wrap).forEach(g => g.onclick = () => {
        if (g.classList.contains('sel') && wrap.dataset.mode) { openBarDetail(wrap.dataset.mode, Number(wrap.dataset.year), g.dataset.label); return; }
        $$('.bar-g', wrap).forEach(x => x.classList.toggle('sel', x === g));
        const v = Number(g.dataset.v);
        $('.br-label', wrap).textContent = g.dataset.label;
        const b = $('.br-value', wrap); b.textContent = signWon(v); b.className = `br-value ${cls(v)}`;
      });
    });
  }

  // 막대를 두 번 누르면: 그 달(또는 그 해)의 종류별 손익과 거래
  function openBarDetail(mode, year, label) {
    const D = state.data;
    const m = parseInt(label, 10);
    const list = (mode === 'month' ? D.realized.filter(r => r.year === year && r.month === m) : D.realized.filter(r => r.year === m))
      .sort((a, b) => b.date - a.date);
    const title = mode === 'month' ? `${year}년 ${m}월` : `${m}년`;
    const sum = list.reduce((t, r) => t + r.amount, 0);
    const g = list.filter(r => r.amount > 0), l = list.filter(r => r.amount < 0);
    const ks = [...groupBy(list, r => r.kind)].map(([k, x]) => ({ k, amt: x.reduce((t, r) => t + r.amount, 0), n: x.length, g: x.filter(r => r.amount > 0).length, l: x.filter(r => r.amount < 0).length })).sort((a, b) => b.amt - a.amt);
    const mx = Math.max(...ks.map(k => Math.abs(k.amt)), 1);
    openSheet(`
      <div class="pop-hero ${sum >= 0 ? 'gain' : 'loss'}">
        <div><div class="pop-kind">${title} 실현손익</div><h2 id="sheetTitle" class="num">${signWon(sum)}</h2>
          <div class="pop-sub num">익절 ${g.length}건 ${compactSigned(g.reduce((t, r) => t + r.amount, 0))} · 손절 ${l.length}건 ${compactSigned(l.reduce((t, r) => t + r.amount, 0))}</div></div>
      </div>
      <div class="pop-list">
        ${ks.map(k => `<div class="stat-row"><div class="stat-row-top"><span class="stat-row-name">${esc(k.k)}</span><b class="num ${cls(k.amt)}">${signWon(k.amt)}</b></div>
          <div class="stat-row-sub num">${k.n}건 (${[k.g ? `익절 ${k.g}` : '', k.l ? `손절 ${k.l}` : ''].filter(Boolean).join(' · ')})</div>
          <div class="stat-meter" aria-hidden="true"><i style="width:${Math.max(1.5, Math.abs(k.amt) / mx * 100)}%;background:${k.amt >= 0 ? 'var(--bar-up)' : 'var(--down)'}"></i></div></div>`).join('')}
        ${list.length ? `<h3 class="section-title">거래 ${list.length}건</h3>` : '<p class="empty">이 기간에는 기록이 없어요.</p>'}
        ${list.map(r => `<div class="trade"><span>${esc(r.text)}<br><small>${fmtDate(r.date)} · ${esc(r.kind)}</small></span><span class="num ${cls(r.amount)}">${signWon(r.amount)}</span></div>`).join('')}
      </div>
      <button class="btn pop-close" data-close>닫기</button>`, 'pop');
  }

  /* ── 기록 ── */
  const TYPE_HELP = {
    '매수': '주식·코인을 샀을 때. 수량과 평단이 바뀌고, 연결된 예수금에서 돈이 빠져요.',
    '매도': '팔았을 때. 실현손익(익절·손절)이 자동 계산되어 월별 수익에 들어가요.',
    '입금': '계좌에 새 돈을 넣었을 때 (예: 월급에서 ISA로 이체). 원금과 예수금이 같이 늘어서 수익으로 잘못 잡히지 않아요.',
    '출금': '계좌에서 돈을 뺐을 때. 원금과 예수금이 같이 줄어요.',
    '금액 수정': '예수금·금·현용주화처럼 직접 관리하는 금액을 지금 값으로 맞출 때.',
  };

  const isTradable = r => !/예수금/.test(r.sub) && !r.method.startsWith('수동') && r.kind !== '현금';
  const isCashRow = r => /예수금/.test(r.sub) || r.kind === '현금';
  const rowKey = r => `${r.asset}|${r.sub}`;
  const findRow = key => state.data.rows.find(r => rowKey(r) === key);

  function renderRecord() {
    const D = state.data, F = state.form;
    const el = $('#view-record');
    const types = ['매수', '매도', '입금', '출금', '금액 수정'];
    const kindsOf = rows => [...new Set(rows.map(r => r.kind))];
    const manualRows = D.rows.filter(r => r.method.startsWith('수동'));

    let body = '';
    if (F.type === '금액 수정') {
      if (!manualRows.some(r => rowKey(r) === F.key)) F.key = manualRows[0] ? rowKey(manualRows[0]) : '';
      const cur = findRow(F.key);
      const usd = cur && cur.cur === 'USD';
      body = `
        <label class="field"><span>무엇을 고칠까요?</span>
          <select id="fManual">${manualRows.map(r => `<option value="${esc(rowKey(r))}" ${rowKey(r) === F.key ? 'selected' : ''}>${esc(r.kind)} · ${esc(r.asset === r.sub ? r.asset : r.sub)}</option>`).join('')}</select>
        </label>
        <label class="field"><span>${usd ? '지금 금액 (달러)' : '지금 금액 (원)'}</span>
          <input id="fValue" type="number" inputmode="decimal" step="any" placeholder="${cur ? (usd ? cur.qty : Math.round(cur.value)) : ''}">
        </label>
        <p class="preview">${cur ? `기록된 값 ${usd ? `$${cur.qty.toLocaleString('en-US')}` : won(cur.value)}` : ''}</p>
        <p class="form-error" id="fErr" role="alert"></p>
        <button class="btn primary" id="fSubmit">금액 저장하기</button>`;
    } else if (F.type === '입금' || F.type === '출금') {
      // 돈을 넣고 뺄 수 있는 계좌 = 예수금 줄이 있는 자산
      const accts = [...new Set(D.rows.filter(isCashRow).map(r => r.asset))].map(a => ({ a, kind: D.rows.find(r => r.asset === a).kind }));
      if (!accts.some(x => x.a === F.cashAsset)) F.cashAsset = accts[0]?.a || '';
      body = `
        <label class="field"><span>어느 계좌?</span>
          <select id="fCash">${accts.map(x => `<option value="${esc(x.a)}" ${x.a === F.cashAsset ? 'selected' : ''}>${esc(x.kind)}${x.a !== x.kind && x.kind !== '현금' ? ` · ${esc(x.a)}` : ''}</option>`).join('')}</select>
        </label>
        <label class="field"><span>금액 (원)</span><input id="fKrw" type="number" inputmode="numeric" step="1" min="0"></label>
        <div class="two">
          <label class="field"><span>날짜</span><input id="fDate" type="date" value="${todayStr()}"></label>
          <label class="field"><span>메모</span><input id="fMemo" placeholder="선택"></label>
        </div>
        <p class="form-error" id="fErr" role="alert"></p>
        <button class="btn primary" id="fSubmit">${F.type} 기록하기</button>`;
    } else {
      const trad = D.rows.filter(isTradable).filter(r => F.type === '매수' || r.qty > 0);
      const kinds = kindsOf(trad);
      if (!kinds.includes(F.kind)) F.kind = kinds[0] || '';
      const inKind = trad.filter(r => r.kind === F.kind);
      if (F.key !== '__new' && !inKind.some(r => rowKey(r) === F.key)) F.key = inKind[0] ? rowKey(inKind[0]) : '__new';
      if (F.type !== '매수' && F.key === '__new') F.key = inKind[0] ? rowKey(inKind[0]) : '';
      const row = findRow(F.key);
      const curr = F.key === '__new' ? (F.newCur || 'KRW') : (row?.cur || 'KRW');
      const unit = row && (row.ticker === 'ETH' || row.ticker === 'BMB') ? '개' : '주';
      body = `
        <label class="field"><span>자산 구성</span>
          <select id="fKind">${kinds.map(k => `<option ${k === F.kind ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select>
        </label>
        <label class="field"><span>종목</span>
          <select id="fRow">
            ${inKind.map(r => `<option value="${esc(rowKey(r))}" ${rowKey(r) === F.key ? 'selected' : ''}>${esc(r.sub)}</option>`).join('')}
            ${F.type === '매수' ? `<option value="__new" ${F.key === '__new' ? 'selected' : ''}>+ 새 종목 추가</option>` : ''}
          </select>
        </label>
        ${F.key === '__new' ? `
          <div class="two">
            <label class="field"><span>종목 이름</span><input id="fNewName" placeholder="예: NAVER" value="${esc(F.newName || '')}"></label>
            <label class="field"><span>티커</span><input id="fNewTicker" placeholder="예: KRX:035420" value="${esc(F.newTicker || '')}" autocapitalize="characters"></label>
          </div>
          <label class="field"><span>통화</span>
            <select id="fNewCur"><option ${curr === 'KRW' ? 'selected' : ''}>KRW</option><option ${curr === 'USD' ? 'selected' : ''}>USD</option></select>
          </label>` : `
          <p class="preview num">${row ? `보유 ${row.qty.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}${unit}${row.avg ? ` · 평단 ${curr === 'USD' ? '$' : ''}${row.avg.toLocaleString('ko-KR')}${curr === 'USD' ? '' : '원'}` : ''} · 현재 ${curr === 'USD' ? '$' : ''}${row.price.toLocaleString('ko-KR')}${curr === 'USD' ? '' : '원'}` : ''}</p>`}
        <div class="two">
          <label class="field"><span>수량</span><input id="fQty" type="number" inputmode="decimal" step="any" min="0"></label>
          <label class="field"><span>단가 (${curr === 'USD' ? '달러' : '원'})</span><input id="fPrice" type="number" inputmode="decimal" step="any" min="0"></label>
        </div>
        <p class="preview num" id="fPreview"></p>
        <label class="field"><span>실제 원화 금액 (선택)</span>
          <input id="fKrw" type="number" inputmode="numeric" step="1" min="0" placeholder="비우면 수량 × 단가 × 환율">
        </label>
        <div class="two">
          <label class="field"><span>날짜</span><input id="fDate" type="date" value="${todayStr()}"></label>
          <label class="field"><span>메모</span><input id="fMemo" placeholder="선택"></label>
        </div>
        <p class="form-error" id="fErr" role="alert"></p>
        <button class="btn primary" id="fSubmit">${F.type} 기록하기</button>`;
    }

    el.innerHTML = `
      <div class="card">
        <div class="form">
          <div class="type-seg" role="group" aria-label="거래 종류">
            ${types.map(t => `<button data-type="${t}" class="${F.type === t ? 'on' : ''}">${t === '금액 수정' ? '금액수정' : t}</button>`).join('')}
          </div>
          <p class="help">${TYPE_HELP[F.type]}</p>
          ${body}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2 class="card-title">최근 기록</h2></div>
        ${D.trades.length ? D.trades.slice(0, 15).map(t => `
          <div class="trade">
            <span><span class="tag ${t['구분'] === '매수' ? 'buy' : t['구분'] === '매도' ? 'sell' : ''}">${esc(t['구분'])}</span>${esc(t['세부종목'] || t['자산'])}${t['수량'] ? ` ${esc(t['수량'])}주` : ''}<br>
              <small>${fmtDate(new Date(t['날짜']))}${t['입력자'] ? ` · ${esc(t['입력자'])}` : ''}${t['메모'] ? ` · ${esc(t['메모'])}` : ''}</small></span>
            <span class="num" style="text-align:right">${won(num(t['금액(원)']))}${isNum(t['실현손익(원)']) && t['실현손익(원)'] !== '' ? `<br><small class="${cls(num(t['실현손익(원)']))}">${signWon(num(t['실현손익(원)']))}</small>` : ''}</span>
          </div>`).join('') : `<p class="empty">아직 앱에서 기록한 거래가 없어요.<br>매수·매도를 기록하면 보유현황과 월별 수익이 자동으로 바뀝니다.</p>`}
      </div>`;

    $$('.type-seg button', el).forEach(b => b.onclick = () => { F.type = b.dataset.type; renderRecord(); });
    const on = (id, ev, fn) => { const x = $(id, el); if (x) x.addEventListener(ev, fn); };
    on('#fKind', 'change', e => { F.kind = e.target.value; F.key = ''; renderRecord(); });
    on('#fRow', 'change', e => { F.key = e.target.value; renderRecord(); });
    on('#fManual', 'change', e => { F.key = e.target.value; renderRecord(); });
    on('#fCash', 'change', e => { F.cashAsset = e.target.value; });
    on('#fNewCur', 'change', e => { F.newCur = e.target.value; F.newName = $('#fNewName').value; F.newTicker = $('#fNewTicker').value; renderRecord(); });
    const upd = () => {
      const p = $('#fPreview', el); if (!p) return;
      const q = num($('#fQty').value), pr = num($('#fPrice').value);
      const usd = (F.key === '__new' ? (F.newCur || 'KRW') : findRow(F.key)?.cur) === 'USD';
      p.textContent = q && pr ? `${usd ? `$${(q * pr).toLocaleString('en-US', { maximumFractionDigits: 2 })} · ` : ''}약 ${won(q * pr * (usd ? D.rate : 1))}` : '';
    };
    on('#fQty', 'input', upd); on('#fPrice', 'input', upd);
    on('#fSubmit', 'click', submitForm);
  }

  async function submitForm() {
    const F = state.form, D = state.data;
    const err = $('#fErr'); err.textContent = '';
    const btn = $('#fSubmit');
    let payload, action;
    const base = () => ({ type: F.type, by: store.get(LS.name) || '', memo: $('#fMemo').value.trim(), date: `${$('#fDate').value}T${new Date().toTimeString().slice(0, 8)}+09:00` });
    if (F.type === '금액 수정') {
      const row = findRow($('#fManual').value);
      const v = $('#fValue').value;
      if (!row) { err.textContent = '고칠 항목을 고르세요.'; return; }
      if (v === '' || !Number.isFinite(Number(v))) { err.textContent = '금액을 입력하세요.'; return; }
      action = 'manual';
      payload = { manual: row.cur === 'USD' ? { asset: row.asset, sub: row.sub, usd: Number(v) } : { asset: row.asset, sub: row.sub, value: Number(v) } };
    } else if (F.type === '입금' || F.type === '출금') {
      const t = { ...base(), asset: $('#fCash').value, amountKrw: Number($('#fKrw').value) };
      if (!(t.amountKrw > 0)) { err.textContent = '금액을 입력하세요.'; return; }
      action = 'trade'; payload = { trade: t };
    } else {
      const t = base();
      const krw = $('#fKrw').value;
      if (krw !== '') t.amountKrw = Number(krw);
      t.qty = Number($('#fQty').value); t.price = Number($('#fPrice').value);
      if (!(t.qty > 0)) { err.textContent = '수량을 입력하세요.'; return; }
      if (!(t.price > 0)) { err.textContent = '단가를 입력하세요.'; return; }
      if (F.key === '__new') {
        t.sub = $('#fNewName').value.trim(); t.ticker = $('#fNewTicker').value.trim().toUpperCase(); t.currency = $('#fNewCur').value; t.kind = F.kind;
        if (!t.sub) { err.textContent = '새 종목 이름을 입력하세요.'; return; }
        // 그 구성에 자산이 하나뿐이면(예: ISA) 그 자산 안에, 여러 개면(예: 메인투자) 새 자산으로
        const assets = [...new Set(D.rows.filter(r => r.kind === F.kind && isTradable(r)).map(r => r.asset))];
        t.asset = assets.length === 1 && assets[0] !== D.rows.find(r => r.asset === assets[0]).sub ? assets[0] : t.sub;
      } else {
        const row = findRow(F.key);
        if (!row) { err.textContent = '종목을 고르세요.'; return; }
        t.asset = row.asset; t.sub = row.sub;
        if (F.type === '매도' && t.qty > row.qty + 1e-9) { err.textContent = `보유 수량(${row.qty})보다 많이 팔 수 없어요.`; return; }
      }
      action = 'trade'; payload = { trade: t };
    }
    btn.disabled = true; btn.textContent = '저장 중…';
    try {
      const r = await api(action, payload);
      const msg = r.realized !== null && r.realized !== undefined ? `${r.message} (${r.realized >= 0 ? '익절' : '손절'} ${signWon(r.realized)})` : r.message;
      if (F.key === '__new') { F.key = ''; F.newName = ''; F.newTicker = ''; }
      await load({ quiet: true });
      toast(msg);
    } catch (e) {
      if (e.code === 'auth') { logout('비밀번호를 다시 입력해 주세요.'); return; }
      err.textContent = e.message;
      btn.disabled = false; btn.textContent = F.type === '금액 수정' ? '금액 저장하기' : `${F.type} 기록하기`;
    }
  }

  /* ───────────── 공통 UI ───────────── */
  function go(view) {
    state.view = view;
    $$('.view').forEach(v => { v.hidden = v.id !== `view-${view}`; });
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
    window.scrollTo({ top: 0 });
    if (view === 'home') drawPlan();
    if (view === 'years') yPagerApi.align(state.yPage || 0);
  }

  function openSheet(html, mode = '') {
    const s = $('#sheet');
    const wasOpen = !s.hidden && s.classList.contains('open');
    $('#sheetBody').innerHTML = html;
    $('.sheet-panel').scrollTop = 0;
    if (wasOpen && s.classList.contains('pop') !== (mode === 'pop')) s.classList.remove('open');
    s.classList.toggle('pop', mode === 'pop');
    s.hidden = false;
    $('.sheet-panel').scrollTop = 0;
    requestAnimationFrame(() => { $('.sheet-panel').scrollTop = 0; s.classList.add('open'); });
  }
  function closeSheet() {
    const s = $('#sheet');
    s.classList.remove('open');
    setTimeout(() => { s.hidden = true; }, 240);
  }

  let toastTimer;
  function toast(msg, error = false) {
    const t = $('#toast');
    t.textContent = msg; t.classList.toggle('error', error); t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), error ? 4200 : 2400);
  }

  const todayStr = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const fmtDate = d => Number.isNaN(d?.getTime?.()) ? '' : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;

  function openMenu() {
    const name = store.get(LS.name) || '';
    openSheet(`
      <h2 id="sheetTitle">설정</h2>
      <p class="kind">${name ? `${esc(name)} 님으로 사용 중` : ''}</p>
      <button class="menu-item" id="mName">이름 바꾸기</button>
      <button class="menu-item" id="mLogout">로그아웃 (이 기기에서 비밀번호 지우기)</button>
      <p class="note">숫자는 구글 시트에서 직접 고쳐도 됩니다. 고친 뒤 새로고침을 누르면 반영돼요.</p>`);
    $('#mName').onclick = () => { closeSheet(); showLogin('', true); };
    $('#mLogout').onclick = () => { closeSheet(); logout(); };
  }

  /* ───────────── 로그인 ───────────── */
  function showLogin(msg = '', keepPw = false) {
    $('#app').hidden = true; $('#login').hidden = false;
    $('#loginError').textContent = msg;
    const name = store.get(LS.name);
    $$('#nameChips .chip').forEach(c => c.classList.toggle('on', c.dataset.name === name));
    if (keepPw && store.get(LS.pw)) $('#pwInput').value = store.get(LS.pw);
  }

  function logout(msg = '') {
    store.del(LS.pw); store.del(LS.cache);
    state.data = null;
    $('#pwInput').value = '';
    showLogin(msg);
  }

  function startApp() {
    $('#login').hidden = true; $('#app').hidden = false;
    const cached = store.get(LS.cache);
    if (cached && !state.data) {
      try { state.data = prepare(JSON.parse(cached)); render(); } catch { /* 캐시 손상 무시 */ }
    }
    if (!state.data) $('#view-home').innerHTML = '<div class="skeleton"></div><div class="skeleton" style="height:380px"></div>';
    go(state.view);
    load({ quiet: true });
  }

  function bind() {
    $$('#nameChips .chip').forEach(c => c.onclick = () => {
      $$('#nameChips .chip').forEach(x => x.classList.toggle('on', x === c));
    });
    $('#loginForm').addEventListener('submit', async e => {
      e.preventDefault();
      const pw = $('#pwInput').value.trim();
      const chosen = $('#nameChips .chip.on');
      if (!chosen) { $('#loginError').textContent = '누가 보는지 골라 주세요.'; return; }
      if (!pw) { $('#loginError').textContent = '비밀번호를 입력하세요.'; return; }
      const btn = $('#loginBtn');
      btn.disabled = true; btn.textContent = '확인 중…';
      store.set(LS.pw, pw); store.set(LS.name, chosen.dataset.name);
      try {
        const j = await api('data');
        state.data = prepare(j.data);
        store.set(LS.cache, JSON.stringify(j.data));
        $('#login').hidden = true; $('#app').hidden = false;
        render(); go(state.view);
      } catch (err) {
        if (err.code === 'auth') store.del(LS.pw);
        $('#loginError').textContent = err.code === 'auth' ? '비밀번호가 틀렸습니다.' : `연결 실패: ${err.message}`;
      } finally {
        btn.disabled = false; btn.textContent = '들어가기';
      }
    });
    $$('.tab').forEach(t => t.onclick = () => go(t.dataset.view));
    $('#refreshBtn').onclick = () => load();
    $('#menuBtn').onclick = openMenu;
    $('#sheet').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });
    let rT; window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { if (state.view === 'home') drawPlan(); }, 120); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.data && store.get(LS.pw)) load({ quiet: true });
    });
  }

  bind();
  if (store.get(LS.pw) && store.get(LS.name)) startApp(); else showLogin();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      // 앱으로 돌아올 때마다 새 버전이 있는지 확인
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => { /* 오프라인 기능만 없음 */ });
    // 새 버전이 설치되면 한 번 새로고침해서 바로 적용
    let reloaded = false;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded) { reloaded = true; location.reload(); }
    });
  }
})();
