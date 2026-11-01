// 아주 작은 Apps Script 흉내 (테스트 전용) — 실제 구글 서비스 없이 Code.gs 를 Node 에서 돌림
const crypto = require('crypto');
function makeGas(sheetsData) {
  const sheets = {};
  const pad = n => String(n).padStart(2, '0');
  function mk(name, values) {
    const v = values;
    const ncol = () => Math.max(0, ...v.map(r => r.length));
    const sh = {
      name, fmt: {},
      getName: () => name,
      getDataRange() { return { getValues: () => v.map(r => { const a = r.slice(); while (a.length < ncol()) a.push(''); return a; }) }; },
      getLastRow() { for (let i = v.length - 1; i >= 0; i--) if (v[i].some(x => x !== '' && x !== null && x !== undefined)) return i + 1; return 0; },
      getLastColumn() { return ncol(); },
      getMaxRows() { return Math.max(1000, v.length); },
      getRange(r, c, nr = 1, nc = 1) {
        const ensure = () => { while (v.length < r + nr - 1) v.push([]); for (let i = 0; i < nr; i++) { const row = v[r - 1 + i]; while (row.length < c + nc - 1) row.push(''); } };
        const rg = {
          getValues() { ensure(); return Array.from({ length: nr }, (_, i) => v[r - 1 + i].slice(c - 1, c - 1 + nc)); },
          setValues(a) { ensure(); if (a.length !== nr || a[0].length !== nc) throw new Error(`setValues 크기 불일치 ${a.length}x${a[0].length} vs ${nr}x${nc}`);
            a.forEach((row, i) => row.forEach((x, j) => { v[r - 1 + i][c - 1 + j] = conv(x, c + j); })); return rg; },
          setValue(x) { ensure(); v[r - 1][c - 1] = conv(x, c); return rg; },
          setNumberFormat(f) { for (let j = 0; j < nc; j++) for (let i = 0; i < nr; i++) sh.fmt[`${r + i}:${c + j}`] = f; return rg; },
          setFontWeight() { return rg; }, setFormula(f) { ensure(); v[r - 1][c - 1] = f; return rg; },
          copyTo() { return rg; },
          clearContent() { ensure(); for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) v[r - 1 + i][c - 1 + j] = ''; return rg; },
        };
        // 글자 서식이 아닌 칸에 날짜 모양 글자를 넣으면 구글 시트처럼 날짜로 바뀜
        function conv(x, col) {
          return x;
        }
        return rg;
      },
      deleteRow(r) { v.splice(r - 1, 1); },
      insertRowBefore(r) { v.splice(r - 1, 0, []); },
      getLastColumn() { return Math.max(...v.map(x => x.length), 1); },
      insertColumnBefore(c) { v.forEach(row => { while (row.length < c - 1) row.push(''); row.splice(c - 1, 0, ''); }); },
      setFrozenRows() {},
    };
    sheets[name] = sh; return sh;
  }
  Object.keys(sheetsData).forEach(n => mk(n, sheetsData[n]));
  const kst = d => new Date(d.getTime() + 9 * 3600e3);
  const G = {
    SpreadsheetApp: {
      getActive: () => ({ getSheetByName: n => sheets[n] || null, insertSheet: n => mk(n, []), getSpreadsheetTimeZone: () => 'Asia/Seoul' }),
      flush() {},
    },
    Utilities: {
      formatDate(d, tz, f) { const k = kst(d); const Y = k.getUTCFullYear(), M = pad(k.getUTCMonth() + 1), D = pad(k.getUTCDate()), h = pad(k.getUTCHours()), m = pad(k.getUTCMinutes()), s = pad(k.getUTCSeconds());
        return f.replace("'T'", 'T').replace('yyyy', Y).replace('MM', M).replace('dd', D).replace('HH', h).replace('mm', m).replace('ss', s).replace(/^d$/, String(k.getUTCDate())); },
      sleep() {}, parseDate: s => new Date(s),
      computeDigest: (alg, s) => [...crypto.createHash('sha256').update(s, 'utf8').digest()].map(b => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 1 }, Charset: { UTF_8: 1 },
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock() { return true; }, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k === 'PW_HASH' ? G.__pw : (G.__props || {})[k] || null), setProperty: (k, v) => { (G.__props = G.__props || {})[k] = v; G.__setN = (G.__setN || 0) + 1; }, deleteProperty: k => { if (G.__props) delete G.__props[k]; } }) },
    ContentService: { createTextOutput: s => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 1 } },
    Session: { getScriptTimeZone: () => 'Asia/Seoul' },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    UrlFetchApp: { fetchAll: () => [] },
    Logger: { log() {} },
  };
  return { G, sheets };
}
function loadCode(G, code, now) {
  const RealDate = Date;
  const fixed = now ? new RealDate(now) : null;
  class FakeDate extends RealDate { constructor(...a) { if (a.length === 0 && fixed) super(fixed.getTime()); else super(...a); } static now() { return fixed ? fixed.getTime() : RealDate.now(); } }
  const names = Object.keys(G);
  const fn = new Function(...names, 'Date', code + '\nreturn { doPost, readHH_, hash_ };');
  return fn(...names.map(n => G[n]), FakeDate);
}
module.exports = { makeGas, loadCode };
