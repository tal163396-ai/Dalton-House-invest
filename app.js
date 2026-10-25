(() => {
  'use strict';

  const API = (window.DH_CONFIG || {}).API_URL;
  const LS = { pw: 'dh_pw', name: 'dh_name', cache: 'dh_cache', mode: 'dh_mode', sort: 'dh_sort' };
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
    sort: store.get(LS.sort) || 'value',
    year: null,
    openKinds: new Set(),
    form: { type: '매수', asset: '', sub: '' },
    busy: false,
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
      if (!state.data) $('#view-home').innerHTML = `<p class="empty">데이터를 불러오지 못했습니다.<br>${esc(e.message)}<br><br>인터넷 연결을 확인하고 새로고침을 눌러 주세요.</p>`;
    } finally {
      btn.classList.remove('spin');
    }
  }

  /* ───────────── 데이터 가공 ───────────── */
  function prepare(d) {
    const rate = num(d.rate) || 1400;
    const bad = [];
    const rows = (d.holdings || []).map(h => {
      const value = num(h['평가금(원)']);
      if (!isNum(h['평가금(원)']) && h['평가금(원)'] !== '') bad.push(`${h['자산']} ${h['세부종목']}`);
      return {
        asset: String(h['자산']).trim(), kind: String(h['종류'] || '').trim(), sub: String(h['세부종목'] || h['자산']).trim(),
        ticker: h['티커'], cur: h['통화'] || 'KRW', qty: num(h['수량']), avg: num(h['평단가']),
        cost: num(h['원금(원)']), price: num(h['현재가']), manual: isNum(h['직접평가(원)']) && h['직접평가(원)'] !== '',
        value, method: String(h['시세방식'] || ''),
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
      const y = num(c['연도']);
      comp.set(`${y}|${String(c['자산']).trim()}`, { kind: String(c['종류']).trim(), base: isNum(c['기준원금(원)']) ? num(c['기준원금(원)']) : null });
    });
    const realized = (d.realized || []).map(r => {
      const date = new Date(r['날짜']);
      const year = num(r['연도']) || date.getFullYear();
      const asset = String(r['자산']).trim();
      const c = comp.get(`${year}|${asset}`);
      return {
        date, year, month: num(r['월']) || date.getMonth() + 1, asset, sub: r['세부종목'], text: r['내용'],
        amount: num(r['손익(원)']), kind: c ? c.kind : (byAsset.get(asset)?.kind || '기타'),
      };
    }).filter(r => !Number.isNaN(r.date.getTime()));
    const years = [...new Set([...(d.composition || []).map(c => num(c['연도'])), ...realized.map(r => r.year)])]
      .filter(Boolean).sort((a, b) => a - b);

    return {
      raw: d, rate, rows, assets, total: { ...total, pl: total.value - total.cost, ret: total.cost > 0 ? (total.value - total.cost) / total.cost : null },
      comp, realized, years, bad, monthly: d.monthly || [], trades: (d.trades || []).slice().reverse(),
      updatedAt: d.updatedAt,
    };
  }

  /* ───────────── 렌더 ───────────── */
  function render() {
    const D = state.data;
    if (!D) return;
    $('#updated').textContent = D.updatedAt ? `${D.updatedAt.slice(5).replace('-', '/')} 기준 · 환율 ${D.rate.toFixed(1)}` : '';
    const banner = $('#banner');
    if (D.bad.length) { banner.hidden = false; banner.textContent = `시세를 못 불러온 종목이 있어요: ${D.bad.join(', ')}. 잠시 후 새로고침해 주세요.`; }
    else banner.hidden = true;
    renderHome(); renderAssets(); renderYears(); renderRecord();
  }

  /* 홈 — 총액 + 평면도 */
  function renderHome() {
    const D = state.data, T = D.total;
    $('#view-home').innerHTML = `
      <div class="total">
        <div class="total-label">총 평가금</div>
        <div class="total-value num">${won(T.value)}</div>
        <div class="total-sub num">
          <span>원금 <b>${won(T.cost)}</b></span>
          <span class="${cls(T.pl)}">${signWon(T.pl)} (${pct(T.ret)})</span>
        </div>
      </div>
      <div class="plan-head">
        <h2 class="plan-title">우리 집 자산 배치</h2>
        <div class="seg" role="group" aria-label="표시 방식">
          <button data-mode="weight" class="${state.mode === 'weight' ? 'on' : ''}">비중</button>
          <button data-mode="return" class="${state.mode === 'return' ? 'on' : ''}">수익률</button>
        </div>
      </div>
      <div class="plan" id="plan" role="group" aria-label="자산 트리맵"></div>
      <div class="plan-legend">
        <span>방은 종류, 칸 크기는 평가금</span>
        ${state.mode === 'return'
          ? `<span class="scale" aria-hidden="true">−30%<i style="background:${retColor(-0.3)}"></i><i style="background:${retColor(-0.1)}"></i><i style="background:${retColor(0)}"></i><i style="background:${retColor(0.1)}"></i><i style="background:${retColor(0.3)}"></i>+30%</span>`
          : `<span>칸을 누르면 자세히</span>`}
      </div>`;
    $$('#view-home .seg button').forEach(b => b.onclick = () => {
      state.mode = b.dataset.mode; store.set(LS.mode, state.mode); renderHome();
    });
    drawPlan();
  }

  function drawPlan() {
    const el = $('#plan');
    if (!el) return;
    const D = state.data;
    const W = el.clientWidth || 340;
    const H = Math.round(Math.min(W * 1.1, 560));
    el.style.height = `${H + 6}px`;
    const kinds = groupBy(D.assets.filter(a => a.value > 0), a => a.kind);
    const kindItems = [...kinds].map(([k, list]) => ({ k, list, v: list.reduce((s, a) => s + a.value, 0) }))
      .sort((a, b) => b.v - a.v);
    const rooms = squarify(kindItems, { x: 0, y: 0, w: W, h: H });
    const maxW = Math.max(...D.assets.map(a => a.weight));
    let html = '';
    const GAP = 2;
    rooms.forEach(room => {
      const showLabel = room.h > 52 && room.w > 58;
      const top = showLabel ? 17 : 0;
      const kv = room.list.reduce((s, a) => ({ c: s.c + a.cost, v: s.v + a.value }), { c: 0, v: 0 });
      const kindTip = state.mode === 'weight' ? `${(kv.v / D.total.value * 100).toFixed(1)}%` : pct(kv.c > 0 ? (kv.v - kv.c) / kv.c : null, 1);
      html += `<div class="room" style="left:${room.x}px;top:${room.y}px;width:${room.w}px;height:${room.h}px">`;
      if (showLabel) html += `<div class="room-label">${esc(room.k)} <span style="font-weight:500">${kindTip}</span></div>`;
      const inner = { x: GAP / 2, y: top + GAP / 2, w: room.w - GAP, h: room.h - top - GAP };
      const tiles = squarify(room.list.map(a => ({ a, v: a.value })).sort((p, q) => q.v - p.v), inner);
      tiles.forEach(t => {
        const a = t.a;
        const w = Math.max(t.w - GAP, 0), h = Math.max(t.h - GAP, 0);
        const bg = state.mode === 'weight' ? weightColor(a.weight / (maxW || 1)) : retColor(a.ret ?? 0);
        const fs = Math.max(10, Math.min(22, Math.sqrt(w * h) / 6.2));
        const label = state.mode === 'weight' ? `${(a.weight * 100).toFixed(1)}%` : pct(a.ret, 1);
        const showName = w > 30 && h > 20;
        const showVal = w > 40 && h > 36;
        html += `<button class="tile" data-asset="${esc(a.name)}" aria-label="${esc(a.name)} ${label}"
          style="left:${t.x + GAP / 2}px;top:${t.y + GAP / 2}px;width:${w}px;height:${h}px;background:${bg}">
          ${showName ? `<span class="tile-name" style="font-size:${fs}px">${esc(shortName(a.name, w, fs))}</span>` : ''}
          ${showVal ? `<span class="tile-val num" style="font-size:${Math.max(10, fs * 0.72)}px">${label}</span>` : ''}
        </button>`;
      });
      html += `</div>`;
    });
    el.innerHTML = html;
    $$('.tile', el).forEach(b => b.onclick = () => openAsset(b.dataset.asset));
  }

  function shortName(name, w, fs) {
    const max = Math.max(2, Math.floor(w / (fs * 0.62)));
    if (name.length <= max) return name;
    const m = name.match(/^(TIGER|KODEX)\s/);
    const n = m ? name.replace(/\(.*?\)/g, '').trim() : name;
    return n.length <= max ? n : `${n.slice(0, Math.max(1, max - 1))}…`;
  }

  function mix(a, b, t) { return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`; }
  function retColor(r) {
    if (!Number.isFinite(r) || Math.abs(r) < 0.0005) return 'rgb(70,78,90)';
    const t = Math.min(Math.abs(r) / 0.3, 1);
    return r > 0 ? mix([60, 92, 74], [34, 168, 92], 0.25 + 0.75 * t) : mix([96, 60, 60], [214, 58, 46], 0.25 + 0.75 * t);
  }
  function weightColor(t) { return mix([44, 104, 78], [40, 150, 100], Math.sqrt(t)); }

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

  /* 자산별 */
  function renderAssets() {
    const D = state.data;
    const sorters = { value: (a, b) => b.value - a.value, ret: (a, b) => (b.ret ?? -9) - (a.ret ?? -9) };
    const kinds = [...groupBy(D.assets, a => a.kind)].map(([k, list]) => {
      const c = list.reduce((s, a) => s + a.cost, 0), v = list.reduce((s, a) => s + a.value, 0);
      return { k, list: list.sort(sorters[state.sort]), c, v, ret: c > 0 ? (v - c) / c : null };
    }).sort(state.sort === 'value' ? (a, b) => b.v - a.v : (a, b) => (b.ret ?? -9) - (a.ret ?? -9));
    const maxAbs = Math.max(0.05, ...D.assets.map(a => Math.abs(a.ret ?? 0)));

    $('#view-assets').innerHTML = `
      <div class="sort">
        <div class="seg" role="group" aria-label="정렬">
          <button data-sort="value" class="${state.sort === 'value' ? 'on' : ''}">평가금순</button>
          <button data-sort="ret" class="${state.sort === 'ret' ? 'on' : ''}">수익률순</button>
        </div>
      </div>
      ${kinds.map(g => `
        <div class="group">
          <div class="group-head">
            <span class="group-name">${esc(g.k)}</span>
            <span class="group-meta num">${compact(g.v)} · <span class="${cls(g.ret)}">${pct(g.ret)}</span></span>
          </div>
          ${g.list.map(a => `
            <button class="row" data-asset="${esc(a.name)}">
              <span>
                <span class="row-name">${esc(a.name)}</span><br>
                <span class="row-sub num">원금 ${compact(a.cost)} → 평가 ${compact(a.value)}</span>
              </span>
              <span class="row-right">
                <span class="row-value num ${cls(a.ret)}">${pct(a.ret)}</span><br>
                <span class="row-sub num ${cls(a.pl)}">${signWon(a.pl)}</span>
              </span>
              <span class="bar" aria-hidden="true"><i style="width:${Math.min(100, Math.abs(a.ret ?? 0) / maxAbs * 100)}%;background:${(a.ret ?? 0) >= 0 ? 'var(--up)' : 'var(--down)'}"></i></span>
            </button>`).join('')}
        </div>`).join('')}`;
    $$('#view-assets .seg button').forEach(b => b.onclick = () => { state.sort = b.dataset.sort; store.set(LS.sort, state.sort); renderAssets(); });
    $$('#view-assets .row').forEach(b => b.onclick = () => openAsset(b.dataset.asset));
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

    const holdings = a.rows.map(r => {
      const isCash = /예수금/.test(r.sub) || r.method.startsWith('수동');
      const unitRet = r.avg > 0 && r.price > 0 ? (r.price - r.avg) / r.avg : null;
      const money = r.cur === 'USD' ? v => `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : v => won(v);
      return `
        <div class="holding">
          <div class="holding-top"><span>${esc(r.sub)}</span><span class="num">${won(r.value)}</span></div>
          ${isCash ? (r.cur === 'USD' && r.qty ? `<div class="holding-sub num"><span>${money(r.qty)}</span><span></span></div>` : '') : `
          <div class="holding-sub num">
            <span>${r.qty.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}${r.ticker === 'ETH' || r.ticker === 'BMB' ? '개' : '주'}${r.avg ? ` · 평단 ${money(r.avg)}` : ''} · 현재 ${money(r.price)}</span>
            <span class="${cls(unitRet)}">${unitRet === null ? '' : `평단 대비 ${pct(unitRet, 1)}`}</span>
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
        <div><div class="stat-label">전체 자산 중 비중</div><div class="stat-value">${(a.weight * 100).toFixed(1)}%</div></div>
        <div><div class="stat-label">${thisYear}년 실현손익</div><div class="stat-value ${cls(rzYear)}">${signWon(rzYear)}</div></div>
      </div>
      <h3 class="section-title">보유 내역</h3>
      ${holdings}
      ${rz.length ? `
        <h3 class="section-title">최근 익절·손절 <span class="note">누적 <span class="${cls(rzAll)}">${signWon(rzAll)}</span></span></h3>
        ${recent.map(r => `<div class="trade"><span>${esc(r.text)}<br><small>${fmtDate(r.date)}</small></span><span class="num ${cls(r.amount)}">${signWon(r.amount)}</span></div>`).join('')}` : ''}
      <div class="sheet-actions">
        <button class="btn primary" id="goRecord">이 자산 거래 기록하기</button>
      </div>`);
    $('#goRecord').onclick = () => {
      closeSheet();
      state.form.asset = name; state.form.sub = '';
      if (!['매수', '매도'].includes(state.form.type)) state.form.type = '매수';
      go('record');
    };
  }

  /* 월별·연도별 */
  function renderYears() {
    const D = state.data;
    if (!state.year) state.year = D.years.includes(new Date().getFullYear()) ? new Date().getFullYear() : (D.years.at(-1) || 'all');
    const chips = [...D.years.map(y => [y, `${y}`]), ['all', '전체']];
    const el = $('#view-years');
    el.innerHTML = `
      <div class="year-chips" role="group" aria-label="연도 선택">
        ${chips.map(([y, l]) => `<button class="chip ${state.year === y ? 'on' : ''}" data-year="${y}">${l}</button>`).join('')}
      </div>
      <div id="yearBody"></div>`;
    $$('.year-chips .chip', el).forEach(b => b.onclick = () => {
      state.year = b.dataset.year === 'all' ? 'all' : Number(b.dataset.year);
      state.openKinds.clear();
      renderYears();
    });
    if (state.year === 'all') renderAllYears(); else renderOneYear(state.year);
  }

  function renderOneYear(y) {
    const D = state.data;
    const list = D.realized.filter(r => r.year === y);
    const sum = list.reduce((s, r) => s + r.amount, 0);
    const gains = list.filter(r => r.amount > 0), losses = list.filter(r => r.amount < 0);
    const byMonth = Array.from({ length: 12 }, (_, i) => list.filter(r => r.month === i + 1).reduce((s, r) => s + r.amount, 0));

    // 그 해 구성에 있는 자산·종류 (손익 없는 자산도 표시)
    const compAssets = [...D.comp].filter(([k]) => k.startsWith(`${y}|`)).map(([k, v]) => ({ asset: k.split('|')[1], ...v }));
    const kindOrder = [];
    compAssets.forEach(c => { if (!kindOrder.includes(c.kind)) kindOrder.push(c.kind); });
    list.forEach(r => { if (!kindOrder.includes(r.kind)) kindOrder.push(r.kind); });
    const kinds = kindOrder.map(k => {
      const assets = [...new Set([...compAssets.filter(c => c.kind === k).map(c => c.asset), ...list.filter(r => r.kind === k).map(r => r.asset)])];
      const rows = assets.map(a => {
        const amt = list.filter(r => r.asset === a).reduce((s, r) => s + r.amount, 0);
        const base = D.comp.get(`${y}|${a}`)?.base ?? null;
        return { a, amt, base, ret: base ? amt / base : null, months: byMonthOf(list.filter(r => r.asset === a)) };
      }).sort((p, q) => q.amt - p.amt);
      const amt = rows.reduce((s, r) => s + r.amt, 0);
      const baseRows = rows.filter(r => r.base);
      const base = baseRows.reduce((s, r) => s + r.base, 0);
      return { k, rows, amt, ret: base ? baseRows.reduce((s, r) => s + r.amt, 0) / base : null, months: byMonthOf(list.filter(r => r.kind === k)) };
    });
    const totalBase = kinds.flatMap(k => k.rows).filter(r => r.base).reduce((s, r) => s + r.base, 0);
    const totalRet = totalBase ? sum / totalBase : null;
    const activeMonths = byMonth.map((v, i) => [i + 1, v]).filter(([, v], i) => v !== 0 || kinds.some(k => k.months[i] !== 0));

    $('#yearBody').innerHTML = `
      <div class="kpi">
        <div class="kpi-label">${y}년 실현손익</div>
        <div class="kpi-value num ${cls(sum)}">${signWon(sum)}</div>
        <div class="kpi-sub num">
          <span>익절 ${gains.length}건 <span class="up">${signWon(gains.reduce((s, r) => s + r.amount, 0))}</span></span>
          <span>손절 ${losses.length}건 <span class="down">${signWon(losses.reduce((s, r) => s + r.amount, 0))}</span></span>
          ${totalRet !== null ? `<span>기준원금 대비 <span class="${cls(totalRet)}">${pct(totalRet)}</span></span>` : ''}
        </div>
      </div>
      ${monthChart(byMonth)}
      <h3 class="section-title">종류별</h3>
      <div class="table-wrap">
        <table class="grid num kinds">
          <thead><tr><th>종류 / 자산</th><th>수익금</th><th>수익률</th></tr></thead>
          <tbody>
            ${kinds.map(k => `
              <tr class="kind-row" data-kind="${esc(k.k)}">
                <td><span class="caret">${state.openKinds.has(k.k) ? '▾' : '▸'}</span>${esc(k.k)}</td>
                <td class="${cls(k.amt)}">${signWon(k.amt)}</td>
                <td class="${cls(k.ret)}">${pct(k.ret)}</td>
              </tr>
              ${state.openKinds.has(k.k) ? k.rows.map(r => `
                <tr class="sub"><td>${esc(r.a)}</td><td class="${cls(r.amt)}">${signWon(r.amt)}</td><td class="${cls(r.ret)}">${pct(r.ret)}</td></tr>`).join('') : ''}`).join('')}
            <tr class="total"><td>합계</td><td class="${cls(sum)}">${signWon(sum)}</td><td class="${cls(totalRet)}">${pct(totalRet)}</td></tr>
          </tbody>
        </table>
      </div>
      <p class="note">수익률 = 실현손익 ÷ 기준원금(연도별구성 탭). 합계는 그 해 전체 실현손익을 기준원금 합계로 나눈 값이고, 기준원금이 없는 자산은 수익금만 표시합니다.</p>

      <h3 class="section-title">월별 × 종류</h3>
      ${activeMonths.length ? `
      <div class="table-wrap">
        <table class="grid num">
          <thead><tr><th>월</th><th>합계</th>${kinds.filter(k => k.amt !== 0).map(k => `<th>${esc(k.k)}</th>`).join('')}</tr></thead>
          <tbody>
            ${activeMonths.map(([m, v]) => `<tr><td>${m}월</td><td class="${cls(v)}">${compactSigned(v)}</td>${kinds.filter(k => k.amt !== 0).map(k => `<td class="${cls(k.months[m - 1])}">${k.months[m - 1] ? compactSigned(k.months[m - 1]) : ''}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>` : `<p class="empty">${y}년 실현손익 기록이 아직 없어요.</p>`}
      ${monthlyEvalSection(y)}`;

    $$('#yearBody .kind-row').forEach(tr => tr.onclick = () => {
      const k = tr.dataset.kind;
      state.openKinds.has(k) ? state.openKinds.delete(k) : state.openKinds.add(k);
      renderOneYear(y);
    });
  }

  function byMonthOf(list) { return Array.from({ length: 12 }, (_, i) => list.filter(r => r.month === i + 1).reduce((s, r) => s + r.amount, 0)); }
  const compactSigned = v => `${v > 0 ? '+' : ''}${compact(v)}`;

  function monthlyEvalSection(y) {
    const rows = state.data.monthly.filter(m => String(m['월']).startsWith(String(y)));
    if (!rows.length) return `<h3 class="section-title">월말 평가금</h3><p class="note">매달 말일 밤에 자산별 평가금이 자동으로 저장됩니다. 저장이 시작되면 여기에 월별 추이가 나와요.</p>`;
    const months = [...groupBy(rows, r => String(r['월']).slice(0, 7))].map(([m, list]) => {
      const c = list.reduce((s, r) => s + num(r['원금(원)']), 0), v = list.reduce((s, r) => s + num(r['평가금(원)']), 0);
      return { m, c, v, ret: c ? (v - c) / c : null };
    });
    return `<h3 class="section-title">월말 평가금</h3>
      <div class="table-wrap"><table class="grid num">
        <thead><tr><th>월</th><th>원금</th><th>평가금</th><th>평가수익률</th></tr></thead>
        <tbody>${months.map(r => `<tr><td>${r.m.slice(5)}월</td><td>${compact(r.c)}</td><td>${compact(r.v)}</td><td class="${cls(r.ret)}">${pct(r.ret)}</td></tr>`).join('')}</tbody>
      </table></div>`;
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
      <div class="kpi">
        <div class="kpi-label">전체 기간 실현손익</div>
        <div class="kpi-value num ${cls(total)}">${signWon(total)}</div>
        <div class="kpi-sub"><span>${D.realized.length}건 기록</span></div>
      </div>
      ${barChart(rows.map(r => [`${r.y}`, r.amt]))}
      <h3 class="section-title">연도별</h3>
      <div class="table-wrap"><table class="grid num">
        <thead><tr><th>연도</th><th>수익금</th><th>누적</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${r.y}</td><td class="${cls(r.amt)}">${signWon(r.amt)}</td><td class="${cls(r.cum)}">${signWon(r.cum)}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="note">연도를 누르면 그 해의 자산 구성과 월별 수익이 나와요.</p>`;
  }

  function monthChart(vals) { return barChart(vals.map((v, i) => [`${i + 1}`, v])); }

  function barChart(pairs) {
    const W = 340, H = 150, padB = 16, padT = 8;
    const max = Math.max(1, ...pairs.map(([, v]) => Math.abs(v)));
    const hasNeg = pairs.some(([, v]) => v < 0), hasPos = pairs.some(([, v]) => v > 0);
    const zeroY = hasNeg && hasPos ? padT + (H - padT - padB) / 2 : (hasNeg ? padT : H - padB);
    const span = hasNeg && hasPos ? (H - padT - padB) / 2 : (H - padT - padB);
    const bw = W / pairs.length;
    const bars = pairs.map(([l, v], i) => {
      const h = Math.abs(v) / max * span;
      const y = v >= 0 ? zeroY - h : zeroY;
      return `<rect x="${i * bw + bw * 0.18}" y="${y}" width="${bw * 0.64}" height="${Math.max(h, v ? 1 : 0)}" rx="1.5" fill="${v >= 0 ? 'var(--up)' : 'var(--down)'}"><title>${l}: ${signWon(v)}</title></rect>
        <text x="${i * bw + bw / 2}" y="${H - 3}" text-anchor="middle">${l}</text>`;
    }).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="실현손익 막대 그래프">
      <line x1="0" x2="${W}" y1="${zeroY}" y2="${zeroY}" stroke="var(--wall)" stroke-width="1"/>${bars}</svg>`;
  }

  /* 기록 */
  function renderRecord() {
    const D = state.data, F = state.form;
    const el = $('#view-record');
    const types = ['매수', '매도', '입금', '출금', '금액 수정'];
    const assetNames = [...new Set(D.rows.map(r => r.asset))];
    const tradable = assetNames.filter(a => D.rows.some(r => r.asset === a && !r.method.startsWith('수동')));
    const cashAssets = assetNames.filter(a => D.rows.some(r => r.asset === a && (/예수금/.test(r.sub) || r.kind === '현금')));
    const manualRows = D.rows.filter(r => r.method.startsWith('수동'));

    let body = '';
    if (F.type === '금액 수정') {
      const key = F.sub || (manualRows[0] ? `${manualRows[0].asset}|${manualRows[0].sub}` : '');
      const cur = manualRows.find(r => `${r.asset}|${r.sub}` === key);
      const usd = cur && cur.cur === 'USD';
      body = `
        <label class="field"><span>무엇을 고칠까요?</span>
          <select id="fManual">${manualRows.map(r => `<option value="${esc(r.asset)}|${esc(r.sub)}" ${`${r.asset}|${r.sub}` === key ? 'selected' : ''}>${esc(r.asset === r.sub ? r.asset : `${r.asset} / ${r.sub}`)}</option>`).join('')}</select>
        </label>
        <label class="field"><span>${usd ? '현재 금액 (달러)' : '현재 금액 (원)'}</span>
          <input id="fValue" type="number" inputmode="decimal" step="any" placeholder="${cur ? (usd ? cur.qty : Math.round(cur.value)) : ''}">
        </label>
        <p class="preview">${cur ? `지금 기록된 값: ${usd ? `$${cur.qty.toLocaleString('en-US')}` : won(cur.value)}` : ''}</p>
        <p class="form-error" id="fErr" role="alert"></p>
        <button class="btn primary" id="fSubmit">금액 저장하기</button>`;
    } else {
      const isMoney = F.type === '입금' || F.type === '출금';
      const assetList = isMoney ? cashAssets : tradable;
      if (!assetList.includes(F.asset)) F.asset = assetList[0] || '';
      const subs = D.rows.filter(r => r.asset === F.asset && !/예수금/.test(r.sub) && !r.method.startsWith('수동'));
      if (!isMoney && F.sub !== '__new' && !subs.some(s => s.sub === F.sub)) F.sub = subs[0]?.sub || '__new';
      const subRow = subs.find(s => s.sub === F.sub);
      const curr = F.sub === '__new' ? (F.newCur || 'KRW') : (subRow?.cur || 'KRW');
      body = `
        <label class="field"><span>자산</span>
          <select id="fAsset">${assetList.map(a => `<option ${a === F.asset ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
        </label>
        ${isMoney ? '' : `
        <label class="field"><span>종목</span>
          <select id="fSub">
            ${subs.map(s => `<option ${s.sub === F.sub ? 'selected' : ''}>${esc(s.sub)}</option>`).join('')}
            ${F.type === '매수' ? `<option value="__new" ${F.sub === '__new' ? 'selected' : ''}>새 종목 추가</option>` : ''}
          </select>
        </label>
        ${F.sub === '__new' ? `
          <div class="two">
            <label class="field"><span>종목 이름</span><input id="fNewName" placeholder="예: NAVER" value="${esc(F.newName || '')}"></label>
            <label class="field"><span>티커</span><input id="fNewTicker" placeholder="예: KRX:035420" value="${esc(F.newTicker || '')}" autocapitalize="characters"></label>
          </div>
          <label class="field"><span>통화</span>
            <select id="fNewCur"><option ${curr === 'KRW' ? 'selected' : ''}>KRW</option><option ${curr === 'USD' ? 'selected' : ''}>USD</option></select>
          </label>` : ''}
        <div class="two">
          <label class="field"><span>수량</span><input id="fQty" type="number" inputmode="decimal" step="any" min="0"></label>
          <label class="field"><span>단가 (${curr === 'USD' ? '달러' : '원'})</span><input id="fPrice" type="number" inputmode="decimal" step="any" min="0" placeholder="${subRow && subRow.price ? subRow.price : ''}"></label>
        </div>
        <p class="preview num" id="fPreview"></p>`}
        <label class="field"><span>${isMoney ? '금액 (원)' : '실제 원화 금액 (선택)'}</span>
          <input id="fKrw" type="number" inputmode="numeric" step="1" min="0" placeholder="${isMoney ? '' : '비우면 수량 × 단가 × 환율'}">
        </label>
        <div class="two">
          <label class="field"><span>날짜</span><input id="fDate" type="date" value="${todayStr()}"></label>
          <label class="field"><span>메모</span><input id="fMemo" placeholder="선택"></label>
        </div>
        <p class="form-error" id="fErr" role="alert"></p>
        <button class="btn primary" id="fSubmit">${F.type} 기록하기</button>`;
    }

    el.innerHTML = `
      <div class="form">
        <div class="type-seg" role="group" aria-label="거래 종류">
          ${types.map(t => `<button data-type="${t}" class="${F.type === t ? 'on' : ''}">${t === '금액 수정' ? '금액수정' : t}</button>`).join('')}
        </div>
        ${body}
      </div>
      <div class="recent">
        <h3 class="section-title">최근 기록</h3>
        ${D.trades.length ? D.trades.slice(0, 15).map(t => `
          <div class="trade">
            <span><span class="tag ${t['구분'] === '매수' ? 'buy' : t['구분'] === '매도' ? 'sell' : ''}">${esc(t['구분'])}</span>${esc(t['세부종목'] || t['자산'])}${t['수량'] ? ` ${esc(t['수량'])}주` : ''}<br>
              <small>${fmtDate(new Date(t['날짜']))}${t['입력자'] ? ` · ${esc(t['입력자'])}` : ''}${t['메모'] ? ` · ${esc(t['메모'])}` : ''}</small></span>
            <span class="num" style="text-align:right">${won(num(t['금액(원)']))}${isNum(t['실현손익(원)']) && t['실현손익(원)'] !== '' ? `<br><small class="${cls(num(t['실현손익(원)']))}">${signWon(num(t['실현손익(원)']))}</small>` : ''}</span>
          </div>`).join('') : `<p class="empty">아직 앱에서 기록한 거래가 없어요.<br>매수·매도할 때마다 여기 남기면 보유현황과 월별 수익이 자동으로 바뀝니다.</p>`}
      </div>`;

    $$('.type-seg button', el).forEach(b => b.onclick = () => { F.type = b.dataset.type; F.sub = ''; renderRecord(); });
    const on = (id, ev, fn) => { const x = $(id, el); if (x) x.addEventListener(ev, fn); };
    on('#fAsset', 'change', e => { F.asset = e.target.value; F.sub = ''; renderRecord(); });
    on('#fSub', 'change', e => { F.sub = e.target.value; renderRecord(); });
    on('#fManual', 'change', e => { F.sub = e.target.value; renderRecord(); });
    on('#fNewCur', 'change', e => { F.newCur = e.target.value; F.newName = $('#fNewName').value; F.newTicker = $('#fNewTicker').value; renderRecord(); });
    const upd = () => {
      const p = $('#fPreview', el); if (!p) return;
      const q = num($('#fQty').value), pr = num($('#fPrice').value);
      const usd = (F.sub === '__new' ? (F.newCur || 'KRW') : (D.rows.find(r => r.asset === F.asset && r.sub === F.sub)?.cur)) === 'USD';
      p.textContent = q && pr ? `${usd ? `$${(q * pr).toLocaleString('en-US', { maximumFractionDigits: 2 })} → ` : ''}약 ${won(q * pr * (usd ? D.rate : 1))}` : '';
    };
    on('#fQty', 'input', upd); on('#fPrice', 'input', upd);
    on('#fSubmit', 'click', submitForm);
  }

  async function submitForm() {
    const F = state.form, D = state.data;
    const err = $('#fErr'); err.textContent = '';
    const btn = $('#fSubmit');
    let payload, action;
    if (F.type === '금액 수정') {
      const [asset, sub] = ($('#fManual').value || '').split('|');
      const v = $('#fValue').value;
      if (v === '' || !Number.isFinite(Number(v))) { err.textContent = '금액을 입력하세요.'; return; }
      const row = D.rows.find(r => r.asset === asset && r.sub === sub);
      action = 'manual';
      payload = { manual: row && row.cur === 'USD' ? { asset, sub, usd: Number(v) } : { asset, sub, value: Number(v) } };
    } else {
      const isMoney = F.type === '입금' || F.type === '출금';
      const t = { type: F.type, asset: F.asset, by: store.get(LS.name) || '', memo: $('#fMemo').value.trim(), date: `${$('#fDate').value}T${new Date().toTimeString().slice(0, 8)}+09:00` };
      const krw = $('#fKrw').value;
      if (krw !== '') t.amountKrw = Number(krw);
      if (isMoney) {
        if (!(t.amountKrw > 0)) { err.textContent = '금액을 입력하세요.'; return; }
      } else {
        t.qty = Number($('#fQty').value); t.price = Number($('#fPrice').value);
        if (!(t.qty > 0)) { err.textContent = '수량을 입력하세요.'; return; }
        if (!(t.price > 0)) { err.textContent = '단가를 입력하세요.'; return; }
        if (F.sub === '__new') {
          t.sub = $('#fNewName').value.trim(); t.ticker = $('#fNewTicker').value.trim().toUpperCase(); t.currency = $('#fNewCur').value;
          if (!t.sub) { err.textContent = '새 종목 이름을 입력하세요.'; return; }
        } else t.sub = F.sub;
        if (F.type === '매도') {
          const row = D.rows.find(r => r.asset === F.asset && r.sub === t.sub);
          if (row && t.qty > row.qty + 1e-9) { err.textContent = `보유 수량(${row.qty})보다 많이 팔 수 없어요.`; return; }
        }
      }
      action = 'trade';
      payload = { trade: t };
    }
    btn.disabled = true; btn.textContent = '저장 중…';
    try {
      const r = await api(action, payload);
      const msg = r.realized !== null && r.realized !== undefined ? `${r.message} (${r.realized >= 0 ? '익절' : '손절'} ${signWon(r.realized)})` : r.message;
      F.sub = F.type === '금액 수정' ? F.sub : '';
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
  }

  function openSheet(html) {
    const s = $('#sheet');
    $('#sheetBody').innerHTML = html;
    s.hidden = false;
    requestAnimationFrame(() => s.classList.add('open'));
    const focusable = $('#sheetBody button, #sheetBody [href]');
    if (focusable) focusable.focus({ preventScroll: true });
  }
  function closeSheet() {
    const s = $('#sheet');
    s.classList.remove('open');
    setTimeout(() => { s.hidden = true; }, 230);
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
      <p class="note" style="margin-top:14px">숫자는 구글 시트에서 직접 고쳐도 됩니다. 고친 뒤 새로고침을 누르면 반영돼요.</p>`);
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
    setTimeout(() => $('#pwInput').focus(), 50);
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
    if (!state.data) $('#view-home').innerHTML = '<div class="skeleton"></div><div class="skeleton" style="height:340px"></div>';
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
        render();
        startApp();
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
    navigator.serviceWorker.register('sw.js').catch(() => { /* 오프라인 기능만 없음 */ });
  }
})();
