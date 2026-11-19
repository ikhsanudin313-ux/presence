/* ============================================================
   NOOR PRESENCE — JavaScript.html  (SPA, 0 ms navigasi)
   Prinsip gas-instant-ux:
    1. SPA: semua halaman ada di shell; navigasi = tampil/sembunyi.
    2. Optimistic UI + localStorage: aksi → UI berubah seketika,
       sinkron ke server di latar belakang (+ antrean offline).
    3. Data di-cache di memori & localStorage (stale-while-revalidate).
    4. Batch: 1 panggilan bootstrap untuk semua data; laporan dihitung lokal.
   Prinsip gas-spa-iframe: tanpa window.location/window.open/?page=.
   ============================================================ */
(function () {
'use strict';

/* ---------- Util dasar ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n, w) => String(n).padStart(w || 2, '0');
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const uid = () => { try { const a = new Uint8Array(8); crypto.getRandomValues(a); return Array.from(a, b => pad(b.toString(16))).join(''); } catch (e) { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); } };
const debounce = (fn, ms) => { let t; return function () { const a = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(null, a), ms); }; };
const HARI = ['Ahad', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const dObj = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const fmtTgl = (s, short) => { const d = dObj(s); if (!d) return s || '-'; return (short ? '' : HARI[d.getDay()] + ', ') + d.getDate() + ' ' + (short ? BULAN[d.getMonth()].slice(0, 3) : BULAN[d.getMonth()]) + ' ' + d.getFullYear(); };
const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const nowStr = () => { const d = new Date(); return todayStr() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
const hijri = d => { try { return new Intl.DateTimeFormat('id-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' }).format(d).replace(/\s?(AH|H)$/i, '') + ' H'; } catch (e) { return ''; } };
const fmtPct = v => (Math.round(v * 10) / 10).toFixed(1) + '%';
const initials = n => String(n || '?').replace(/^(H\.|Ust\.|Ustadz|Dr\.|dr\.|Ir\.|Hj\.)\s*/i, '').split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* kuota penuh/diblokir */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* abaikan */ } }
};

/* ---------- Peran & identitas kartu ---------- */
const ROLE_LABEL = { master: 'Master Admin', penerobos: 'Admin Penerobos', pembina: 'Pembina' };
let CUR_ROLE = '';
const isMaster = () => CUR_ROLE === 'master';
const canAdd = () => CUR_ROLE === 'master' || CUR_ROLE === 'penerobos';
const canScan = () => CUR_ROLE === 'master' || CUR_ROLE === 'penerobos';
const cfgOrg = c => (c.CardOrg || c.AppName || 'Absensi Pengajian');
const tingkatOf = p => (p && p.Tingkat) || 'Daerah';

/* ---------- State ---------- */
const ST = {
  token: null, user: null, config: { AppName: 'Absensi Pengajian', Target: 85 }, links: null,
  P: [], J: [], K: [], B: [], D: [], PC: [], pById: {}, pByKode: {}, jById: {}, kMap: {}, act: [], done: [], noOf: {},
  page: 'dashboard', queue: store.get('np_q') || [], inflight: 0, flushing: false, lastSync: null,
  pg: { page: 1, size: 10, sel: new Set(), cur: null },
  sc: { jadwalId: null, last: null, bad: [], cam: null, camOn: false, lastCode: '', lastAt: 0, sound: true },
  lap: { from: '', to: '', kel: '', dap: '', lvl: '' },
  jd: { q: '', st: '' }, charts: {}
};

/* ---------- API (fetch → Google Apps Script /exec) ---------- */
function call(action, payload) {
  return new Promise((resolve, reject) => {
    const url = (window.APP_CONFIG && window.APP_CONFIG.GAS_URL) || '';
    if (!/^https:\/\/script\.google(usercontent)?\.com\/.+\/exec/.test(url)) { const e = new Error('GAS_URL belum diisi di js/config.js.'); e.net = true; return reject(e); }
    ST.inflight++; setSync('busy');
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 30000);
    fetch(url, {
      method: 'POST', redirect: 'follow', signal: ctl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },          // WAJIB text/plain → tanpa preflight CORS
      body: JSON.stringify({ action, payload: payload || {}, token: ST.token || '' })
    })
      .then(res => res.text())
      .then(txt => { let r; try { r = JSON.parse(txt); } catch (x) { throw Object.assign(new Error('Respons server tidak valid. Pastikan deployment Apps Script versi terbaru & akses "Anyone".'), { net: true }); } return r; })
      .then(r => {
        clearTimeout(timer); ST.inflight--; settleSync();
        if (r && r.ok) return resolve(r);
        if (r && r.auth) { forceLogout(r.msg); const e = new Error(r.msg); e.auth = true; return reject(e); }
        const e = new Error((r && r.msg) || 'Terjadi kesalahan.'); e.code = r && r.code; e.res = r; reject(e);
      })
      .catch(err => {
        clearTimeout(timer); ST.inflight--; settleSync(true);
        const e = new Error(err.name === 'AbortError' ? 'Server terlalu lama merespons.' : (err.message === 'Failed to fetch' ? 'Tidak ada koneksi ke server.' : err.message) || 'Jaringan bermasalah.'); e.net = true; reject(e);
      });
  });
}
function setSync(state) {
  const p = $('#syncPill'); if (!p) return;
  p.classList.toggle('busy', state === 'busy'); p.classList.toggle('off', state === 'off');
  $('#syncTxt').textContent = state === 'busy' ? 'Menyinkronkan…' : state === 'off' ? 'Offline — ' + ST.queue.length + ' antrean' : 'Tersinkron ke Google Sheets';
}
function settleSync(failed) { if (ST.inflight > 0) return; setSync(failed || ST.queue.length ? 'off' : 'ok'); if (!failed && !ST.queue.length) ST.lastSync = new Date(); }

/* ---------- Data: pack/unpack, index, persist ---------- */
const unpack = t => t.r.map(r => { const o = {}; t.c.forEach((c, i) => { o[c] = r[i]; }); return o; });
const cmpJ = (a, b) => (a.Tanggal + a.Mulai).localeCompare(b.Tanggal + b.Mulai);
function ingest(boot) {
  ST.P = unpack(boot.pengurus); ST.J = unpack(boot.jadwal); ST.K = unpack(boot.kehadiran); ST.B = boot.bimbingan ? unpack(boot.bimbingan) : []; ST.D = boot.pendamping ? unpack(boot.pendamping) : []; ST.PC = boot.kartuPdp ? unpack(boot.kartuPdp) : [];
  ST.config = boot.config || ST.config; ST.links = boot.links || null; ST.user = boot.user || ST.user;
  index();
}
function index() {
  ST.pById = {}; ST.pByKode = {}; ST.act = []; ST.jById = {}; ST.kMap = {};
  ST.P.forEach(p => { ST.pById[p.ID] = p; ST.pByKode[String(p.Kode).toUpperCase()] = p; if (p.Aktif !== false) ST.act.push(p); });
  ST.J.forEach(j => { ST.jById[j.ID] = j; });
  ST.K.forEach(k => { ST.kMap[k.JadwalID + '|' + k.PengurusID] = k; });
  const hasRec = {}; ST.K.forEach(k => { hasRec[k.JadwalID] = 1; });
  /* sesi dihitung di laporan bila sudah Selesai ATAU sudah ada presensi tercatat (sesi berlangsung) */
  ST.done = ST.J.filter(j => j.Status === 'Selesai' || hasRec[j.ID]).sort(cmpJ);
  ST.noOf = {}; ST.J.slice().sort(cmpJ).forEach((j, i) => { ST.noOf[j.ID] = i + 1; });
  persistSoon();
}
const persistSoon = debounce(() => store.set('np_d', { P: ST.P, J: ST.J, K: ST.K, B: ST.B, D: ST.D, PC: ST.PC, config: ST.config, links: ST.links, t: Date.now() }), 400);
const saveQueue = () => store.set('np_q', ST.queue);

/* ---------- Statistik ---------- */
function sessCounts(j) {
  let h = 0, i = 0, s = 0, a = 0, rec = 0; const closed = j.Status === 'Selesai';
  ST.act.forEach(p => {
    const k = ST.kMap[j.ID + '|' + p.ID];
    if (k) { rec++; if (k.Status === 'Hadir') h++; else if (k.Status === 'Izin') i++; else if (k.Status === 'Sakit') s++; else a++; }
    else if (closed) a++;
  });
  return { h, i, s, a, n: ST.act.length, wait: closed ? 0 : ST.act.length - rec };
}
function pStats(pid, sessions) {
  let h = 0, i = 0, s = 0, a = 0;
  sessions.forEach(j => { const k = ST.kMap[j.ID + '|' + pid]; const st = k ? k.Status : 'Alpa'; if (st === 'Hadir') h++; else if (st === 'Izin') i++; else if (st === 'Sakit') s++; else a++; });
  const n = sessions.length; return { h, i, s, a, n, pct: n ? h / n * 100 : 0 };
}
const avgAll = () => mean(ST.done.map(j => { const c = sessCounts(j); return c.n ? c.h / c.n * 100 : 0; }));
function pickLive() {
  const open = ST.J.filter(j => j.Status !== 'Selesai').sort(cmpJ);
  return open.filter(j => j.Status === 'Berlangsung')[0] || open.filter(j => j.Tanggal >= todayStr())[0] || open[0] || null;
}
const chipHTML = st => { const m = { Hadir: 'H', Izin: 'I', Sakit: 'S', Alpa: 'A' }; return '<span class="chip c-' + (m[st] || 'N') + '">' + esc(st) + '</span>'; };
const stLetter = st => ({ Hadir: 'H', Izin: 'I', Sakit: 'S', Alpa: 'A' }[st] || '·');

/* ---------- UI helper ---------- */
function toast(msg, type) {
  const t = document.createElement('div');
  t.className = 'toast ' + (type || 'ok');
  t.innerHTML = '<i class="bi ' + (type === 'err' ? 'bi-x-octagon-fill' : type === 'warn' ? 'bi-exclamation-triangle-fill' : 'bi-check-circle-fill') + '"></i><div>' + esc(msg) + '</div>';
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, type === 'err' ? 5000 : 2800);
}
function openModal(html, onMount) {
  $('#modalBox').innerHTML = html; $('#modalBg').classList.add('on');
  if (onMount) onMount($('#modalBox'));
  const f = $('#modalBox input:not([type=hidden]):not([type=file]),#modalBox select,#modalBox textarea'); if (f && matchMedia('(pointer:fine)').matches) f.focus();
}
function closeModal() { $('#modalBg').classList.remove('on'); $('#modalBox').innerHTML = ''; }
function confirmBox(title, msg, okLabel, danger) {
  return new Promise(res => {
    openModal('<div class="modal-h"><h3>' + esc(title) + '</h3><button class="btn btn-ghost btn-ic btn-sm" data-act="modalClose" aria-label="Tutup"><i class="bi bi-x-lg"></i></button></div>' +
      '<div class="modal-b"><p class="ink2">' + msg + '</p></div>' +
      '<div class="modal-f"><button class="btn btn-2" id="cbNo">Batal</button><button class="btn ' + (danger ? 'btn-danger' : 'btn-pri') + '" id="cbYes">' + esc(okLabel || 'Ya, lanjut') + '</button></div>');
    $('#cbNo').onclick = () => { closeModal(); res(false); };
    $('#cbYes').onclick = () => { closeModal(); res(true); };
  });
}
function avatarHTML(p, cls) {
  const src = p && p.FotoID ? '<img loading="lazy" alt="" src="https://lh3.googleusercontent.com/d/' + esc(p.FotoID) + '=w240">' : '';
  return '<div class="' + (cls || 'avatar') + '">' + esc(initials(p && p.Nama)) + src + '</div>';
}
document.addEventListener('error', e => { if (e.target && e.target.tagName === 'IMG') e.target.style.display = 'none'; }, true);
function mkChart(id, cfg) {
  if (ST.charts[id]) { ST.charts[id].destroy(); delete ST.charts[id]; }
  const c = document.getElementById(id); if (!c || typeof Chart === 'undefined') return;
  Chart.defaults.font.family = cssv('--font'); Chart.defaults.color = cssv('--ink2');
  ST.charts[id] = new Chart(c, cfg);
}
const loaded = {};
function loadScript(url) {
  if (loaded[url]) return loaded[url];
  return (loaded[url] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = url; s.onload = res; s.onerror = () => { delete loaded[url]; rej(new Error('Gagal memuat pustaka.')); }; document.head.appendChild(s); }));
}

/* ---------- Aset pihak ketiga: dimuat ASINKRON (tidak memblokir tampilan) ---------- */
function loadCss(u) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = u; document.head.appendChild(l); }
function loadAssets() {
  loadCss('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
  loadCss('https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css');
  loadScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js').then(() => { if (ST.token && (ST.page === 'dashboard' || ST.page === 'laporan')) RENDER[ST.page](); }).catch(() => {});
}

/* ---------- Tema (mode gelap) ---------- */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t); store.set('np_theme', t);
  const ic = $('#themeIc'); if (ic) ic.className = 'bi ' + (t === 'dark' ? 'bi-sun' : 'bi-moon-stars');
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t === 'dark' ? '#0B1220' : '#059669';
}
const toggleTheme = () => { applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); if (['dashboard', 'laporan'].indexOf(ST.page) >= 0) RENDER[ST.page](); };

/* ============================================================
   AUTENTIKASI & SESI
   ============================================================ */
function saveSession() { store.set('np_s', { token: ST.token, user: ST.user }); }
function forceLogout(msg) {
  ST.token = null; store.del('np_s'); stopCam(); showLogin();
  if (msg) $('#lgErr').textContent = msg;
}
function showLogin() { $('#splash').classList.add('hide'); window.__npReady = true; $('#app').classList.add('hide'); $('#login').classList.remove('hide'); $('#lgBtn').disabled = false; $('#lgBtn').innerHTML = '<i class="bi bi-box-arrow-in-right"></i> Masuk'; setTimeout(() => { const u = $('#lgUser'); if (u && !u.value) u.focus(); }, 50); }
async function doLogin(e) {
  e.preventDefault();
  const username = $('#lgUser').value.trim(), password = $('#lgPass').value;
  $('#lgErr').textContent = '';
  if (!username || !password) { $('#lgErr').textContent = 'Isi nama pengguna dan kata sandi.'; return; }
  const b = $('#lgBtn'); b.disabled = true; b.innerHTML = '<span class="spin"></span> Memproses…';
  try {
    const r = await call('login', { username, password });
    ST.token = r.token; ST.user = r.user; ingest(r.boot); saveSession(); $('#lgPass').value = '';
    enterApp(); toast('Selamat datang, ' + ST.user.nama + '!');
    flushQueue();
  } catch (err) { $('#lgErr').textContent = err.message; b.disabled = false; b.innerHTML = '<i class="bi bi-box-arrow-in-right"></i> Masuk'; }
}
async function doLogout() {
  const t = ST.token; stopCam(); ST.token = null; store.del('np_s');
  try { fetch(window.APP_CONFIG.GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'logout', payload: {}, token: t }), keepalive: true }).catch(() => {}); } catch (e) { }
  showLogin();
}

/* ============================================================
   NAVIGASI SPA (tanpa reload, tanpa URL)
   ============================================================ */
const MENU = [
  { id: 'dashboard', ic: 'bi-grid-1x2', l: 'Dashboard & Analitik', s: 'Dashboard' },
  { id: 'pengurus', ic: 'bi-person-vcard', l: 'Data Pengurus & ID Card', s: 'Pengurus', roles: ['master', 'penerobos', 'pembina'] },
  { id: 'scan', ic: 'bi-upc-scan', l: 'Scan Barcode & Presensi', s: 'Scan', roles: ['master', 'penerobos'] },
  { id: 'laporan', ic: 'bi-file-earmark-bar-graph', l: 'Laporan & Rekapitulasi', s: 'Laporan' },
  { id: 'jadwal', ic: 'bi-calendar-event', l: 'Jadwal Pengajian', s: 'Jadwal' },
  { id: 'bimbingan', ic: 'bi-chat-heart', l: 'Bimbingan & Pembinaan', s: 'Bimbingan', roles: ['master', 'pembina'] },
  { id: 'pengaturan', ic: 'bi-gear', l: 'Pengaturan', s: 'Pengaturan' }
];
const allowed = id => { const m = MENU.filter(x => x.id === id)[0]; return !!m && (!m.roles || m.roles.indexOf(ST.user.peran) >= 0); };
function buildNav() {
  const items = MENU.filter(m => !m.roles || m.roles.indexOf(ST.user.peran) >= 0);
  $('#navSide').innerHTML = items.map(m => '<a data-go="' + m.id + '" role="button" tabindex="0"><i class="bi ' + m.ic + '"></i><span>' + m.l + '</span></a>').join('');
  const bottom = ['dashboard', 'jadwal', 'scan', 'laporan', 'bimbingan'].filter(id => items.some(m => m.id === id)).slice(0, 4);
  const more = items.filter(m => bottom.indexOf(m.id) < 0);
  $('#navBottom').innerHTML = bottom.map(id => { const m = items.filter(x => x.id === id)[0]; return '<a data-go="' + id + '" role="button" class="' + (id === 'scan' ? 'mid' : '') + '"><i class="bi ' + m.ic + '"></i><span>' + m.s + '</span></a>'; }).join('') +
    '<a data-act="moreMenu" role="button"><i class="bi bi-three-dots"></i><span>Lainnya</span></a>';
  $('#mSheet').innerHTML = '<div class="grab"></div>' + more.map(m => '<a data-go="' + m.id + '"><i class="bi ' + m.ic + '"></i>' + m.l + '</a>').join('') +
    '<a data-act="theme"><i class="bi bi-moon-stars"></i>Mode gelap / terang</a><a data-act="resync"><i class="bi bi-arrow-repeat"></i>Sinkronkan ulang</a><a data-act="logout"><i class="bi bi-box-arrow-left"></i>Keluar</a>';
}
function navigate(id) {
  if (!allowed(id)) id = 'dashboard';
  if (ST.page === 'scan' && id !== 'scan') stopCam();
  ST.page = id;
  $$('.page').forEach(p => p.classList.toggle('on', p.id === 'page-' + id));
  $$('[data-go]').forEach(a => a.classList.toggle('on', a.dataset.go === id));
  closeSheet();
  try { RENDER[id](); } catch (e) { toast('Gagal menampilkan halaman: ' + e.message, 'err'); }
  window.scrollTo(0, 0);
}
function closeSheet() { $('#mSheet').classList.remove('on'); $('#sheetBg').classList.remove('on'); }
function applyBrand() {
  const c = ST.config || {}, src = c.LogoData || (c.LogoID ? 'https://lh3.googleusercontent.com/d/' + c.LogoID + '=w160' : '');
  $$('.brand-mark').forEach(m => {
    if (!m.dataset.def) m.dataset.def = m.innerHTML;
    if (src) { m.classList.add('has-img'); m.innerHTML = '<img alt="" src="' + esc(src) + '">'; } else { m.classList.remove('has-img'); m.innerHTML = m.dataset.def; }
  });
}
function enterApp() {
  $('#splash').classList.add('hide'); window.__npReady = true;
  $('#login').classList.add('hide'); $('#app').classList.remove('hide');
  $$('.appname').forEach(e => { e.textContent = ST.config.AppName || 'Absensi Pengajian'; }); applyBrand(); document.title = (ST.config.AppName || 'Absensi Pengajian') + ' — Absensi Pengajian';
  CUR_ROLE = ST.user.peran; $('.btn-scan-t').classList.toggle('hide', !canScan()); $('#uName').textContent = ST.user.nama; $('#uRole').textContent = ROLE_LABEL[ST.user.peran] || ST.user.peran;
  $('#uAv').textContent = initials(ST.user.nama);
  $('#topSearchWrap').classList.toggle('hide', !(isMaster() || ST.user.peran === 'pembina'));
  buildNav(); settleSync(); navigate(ST.page && allowed(ST.page) ? ST.page : 'dashboard');
}
async function refresh(silent) {
  if (!ST.token) return;
  if (ST.queue.length || ST.inflight) { await flushQueue(); if (ST.queue.length) { if (!silent) toast('Masih ada antrean yang belum terkirim.', 'warn'); return; } }
  try {
    const r = await call('bootstrap'); ingest(r.boot);
    if (ST.page === 'scan') rScanLive(); else if (!document.querySelector('.modal-bg.on')) RENDER[ST.page]();
    if (!silent) toast('Data disinkronkan.');
  } catch (e) { if (!silent && !e.auth) toast(e.net ? 'Offline — memakai data tersimpan.' : e.message, 'warn'); }
}

/* ============================================================
   ANTREAN OFFLINE (scan & presensi tidak boleh hilang)
   ============================================================ */
async function flushQueue() {
  if (ST.flushing || !ST.token) return; ST.flushing = true;
  try {
    while (ST.queue.length) {
      const it = ST.queue[0];
      try {
        const r = await call(it.a, it.p);
        if (it.a === 'pendamping.add' && r.rec) { const d = ST.D.find(x => x.JadwalID === it.p.jadwalId && x.Kode === it.p.kode); if (d) { Object.assign(d, r.rec); delete d._pending; } } else applyServerRec(r); ST.queue.shift(); saveQueue();
      } catch (e) {
        if (e.net || e.auth) break;
        if (e.code === 'DUP') { ST.queue.shift(); saveQueue(); continue; }
        ST.queue.shift(); saveQueue(); toast('Antrean dilewati: ' + e.message, 'warn');
      }
    }
  } finally { ST.flushing = false; settleSync(ST.queue.length > 0); }
}
function enqueue(a, p) { ST.queue.push({ a, p, t: Date.now() }); saveQueue(); setSync('off'); }
function applyServerRec(r) {
  const recs = r.recs || (r.rec ? [r.rec] : []);
  recs.forEach(rec => {
    const key = rec.JadwalID + '|' + rec.PengurusID;
    const idx = ST.K.findIndex(k => k.JadwalID === rec.JadwalID && k.PengurusID === rec.PengurusID);
    if (idx >= 0) ST.K[idx] = rec; else ST.K.push(rec);
    ST.kMap[key] = rec;
  });
  persistSoon();
}

/* ============================================================
   HALAMAN: DASHBOARD
   ============================================================ */
const RENDER = {};
function statCard(label, icon, tone, val, unit, foot) {
  return '<div class="card stat hov"><div class="l"><span>' + label + '</span><span class="ic ' + tone + '"><i class="bi ' + icon + '"></i></span></div><div class="v">' + val + (unit ? ' <small>' + unit + '</small>' : '') + '</div><div class="f">' + (foot || '') + '</div></div>';
}
RENDER.dashboard = function () {
  const el = $('#page-dashboard'), done = ST.done, last = done[done.length - 1], live = pickLive(), tgt = ST.config.Target;
  const avg = avgAll(), lc = last ? sessCounts(last) : { h: 0, i: 0, s: 0, a: 0, n: ST.act.length }, lp = lc.n ? lc.h / lc.n * 100 : 0;
  const now = new Date();
  const feed = ST.K.slice().sort((a, b) => String(b.Waktu).localeCompare(String(a.Waktu))).slice(0, 6);
  el.innerHTML =
    '<div class="ph"><div><span class="tag"><i class="bi bi-broadcast"></i> ' + (live && live.Status === 'Berlangsung' ? 'Kajian Aktif' : 'Ringkasan') + '</span>' +
    '<h1 style="margin-top:.5rem">Assalamu\'alaikum, <em>' + esc(ST.user.nama) + '</em></h1>' +
    '<p>' + (live ? '<i class="bi bi-calendar-event"></i> ' + esc(live.Tema) + (live.Tempat ? ' — ' + esc(live.Tempat) : '') : 'Belum ada jadwal pengajian mendatang.') + '</p>' +
    '<p class="mono mute" style="margin-top:.25rem">' + fmtTgl(todayStr()) + (hijri(now) ? ' · ' + hijri(now) : '') + '</p></div>' +
    '<div class="acts">' + (canScan() ? '<button class="btn btn-pri" data-act="goScan"><i class="bi bi-upc-scan"></i> Presensi Cepat</button>' : '<button class="btn btn-pri" data-go="bimbingan"><i class="bi bi-chat-heart"></i> Bimbingan</button>') + '</div></div>' +
    '<div class="grid g4">' +
    statCard('Total Pengurus', 'bi-people-fill', 'g', ST.act.length, 'Orang', '<span class="chip c-H nodot">' + ST.P.length + ' terdaftar</span>') +
    statCard('Rata-rata Kehadiran', 'bi-graph-up-arrow', 'y', fmtPct(avg), '', '<span class="mute">Target ≥' + tgt + '%</span> <span class="chip ' + (avg >= tgt ? 'c-H' : 'c-I') + '">' + (avg >= tgt ? 'Sangat Baik' : 'Perlu Ditingkatkan') + '</span>') +
    statCard('Pengajian Terlaksana', 'bi-journal-bookmark-fill', 'b', done.length, 'Sesi', '<span class="mute">' + ST.J.filter(j => j.Status !== 'Selesai').length + ' mendatang</span>') +
    statCard('Sesi Terakhir', 'bi-person-check-fill', 'g', fmtPct(lp), '', '<span class="mono">H:' + lc.h + ' I:' + lc.i + ' S:' + lc.s + ' A:' + lc.a + '</span>') +
    '</div>' +
    '<div class="grid g-8-4" style="margin-top:1rem"><div class="card card-p"><div class="card-h"><div><h3>Tren Tingkat Kehadiran Pengurus</h3><p>' + Math.min(8, done.length) + ' pengajian terakhir (target minimum: ' + tgt + '%)</p></div><div class="legend"><span><i style="background:var(--pri)"></i>≥ target</span><span><i style="background:var(--gold)"></i>&lt; target</span></div></div>' +
    (done.length ? '<div class="chart-box"><canvas id="chTrend"></canvas></div>' : '<div class="empty"><i class="bi bi-bar-chart"></i>Belum ada sesi yang selesai.</div>') + '</div>' +
    '<div class="card card-p"><div class="card-h"><div><h3>Komposisi Sesi</h3><p>' + (last ? 'Sesi ' + ST.noOf[last.ID] + ' · ' + fmtTgl(last.Tanggal, true) : 'Belum ada data') + '</p></div></div>' +
    '<div class="chart-box" style="height:200px"><canvas id="chDonut"></canvas></div>' +
    '<div class="legend" style="margin-top:.75rem"><span><i style="background:var(--pri)"></i>Hadir ' + lc.h + '</span><span><i style="background:var(--gold)"></i>Izin ' + lc.i + '</span><span><i style="background:var(--blue)"></i>Sakit ' + lc.s + '</span><span><i style="background:var(--rose)"></i>Alpa ' + lc.a + '</span></div></div></div>' +
    '<div class="grid g-8-4" style="margin-top:1rem">' +
    '<div class="card card-p banner"><span class="tag">PENGAJIAN ' + (live && live.Status === 'Berlangsung' ? 'BERLANGSUNG' : 'TERDEKAT BERIKUTNYA') + '</span>' +
    (live ? '<h3>' + esc(live.Tema) + '</h3><p><i class="bi bi-clock"></i> ' + fmtTgl(live.Tanggal) + ' • ' + esc(live.Mulai) + (live.Selesai ? '–' + esc(live.Selesai) : '') + ' WIB' + (live.Pemateri ? '<br><i class="bi bi-person"></i> ' + esc(live.Pemateri) : '') + '</p>' +
      '<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:1rem">' + (canScan() ? '<button class="btn btn-w" data-act="openScan" data-id="' + live.ID + '"><i class="bi bi-person-check"></i> Buka Presensi Sesi Ini</button>' : '<button class="btn btn-w" data-go="jadwal"><i class="bi bi-calendar-event"></i> Lihat Jadwal</button>') + '</div>'
      : '<h3>Belum ada jadwal</h3><p>Tambahkan jadwal pengajian untuk mulai mencatat kehadiran.</p><div style="margin-top:1rem"><button class="btn btn-w" data-go="jadwal"><i class="bi bi-calendar-plus"></i> ' + (canScan() ? 'Kelola Jadwal' : 'Lihat Jadwal') + '</button></div>') + '</div>' +
    '<div class="card card-p"><div class="card-h"><div><h3>Aktivitas Scan Terbaru</h3><p>Pembaruan langsung dari Google Sheets</p></div></div><div class="feed">' +
    (feed.length ? feed.map(k => { const p = ST.pById[k.PengurusID]; return '<div class="feed-i"><span class="ic ' + ({ Hadir: 'g', Izin: 'y', Sakit: 'b', Alpa: 'r' }[k.Status] || 'g') + '"><i class="bi ' + (k.Metode === 'Scan' ? 'bi-upc-scan' : 'bi-pencil') + '"></i></span><div style="flex:1;min-width:0"><b>' + esc(p ? p.Nama : '—') + '</b><small>' + esc(p ? p.Dapukan : '') + '</small></div><div class="tr"><span class="mono mute">' + esc(String(k.Waktu).slice(11, 19) || '') + '</span><br>' + chipHTML(k.Status) + '</div></div>'; }).join('') : '<div class="empty"><i class="bi bi-inbox"></i>Belum ada aktivitas.</div>') + '</div></div></div>' +
    '<div class="card card-p" style="margin-top:1rem;display:flex;gap:1rem;flex-wrap:wrap;align-items:center;justify-content:space-between"><div style="display:flex;gap:.875rem;align-items:center"><span class="ic g" style="width:44px;height:44px;border-radius:12px;font-size:1.3rem"><i class="bi bi-table"></i></span><div><b>Status Sinkronisasi Google Sheets</b><div class="help">Terakhir: <span class="mono">' + (ST.lastSync ? ST.lastSync.toLocaleTimeString('id-ID') : 'dari cache lokal') + '</span> · Cache server & batch-lock aktif</div></div></div><button class="btn btn-2 btn-sm" data-act="resync"><i class="bi bi-arrow-repeat"></i> Paksa Sinkronisasi Ulang</button></div>';
  if (done.length) {
    const s = done.slice(-8), vals = s.map(j => { const c = sessCounts(j); return c.n ? Math.round(c.h / c.n * 1000) / 10 : 0; });
    mkChart('chTrend', { type: 'bar', data: { labels: s.map((j, i) => 'Sesi ' + ST.noOf[j.ID]), datasets: [
      { type: 'bar', label: '% Hadir', data: vals, backgroundColor: vals.map(v => v >= tgt ? cssv('--pri') : cssv('--gold')), borderRadius: 6, maxBarThickness: 44 },
      { type: 'line', label: 'Target', data: s.map(() => tgt), borderColor: cssv('--gold'), borderDash: [6, 4], pointRadius: 0, borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.dataset.label + ': ' + c.parsed.y + '%' } } }, scales: { y: { min: Math.max(0, Math.floor((Math.min.apply(null, vals) - 10) / 10) * 10), max: 100, ticks: { callback: v => v + '%' }, grid: { color: cssv('--line') } }, x: { grid: { display: false } } } } });
  }
  mkChart('chDonut', { type: 'doughnut', data: { labels: ['Hadir', 'Izin', 'Sakit', 'Alpa'], datasets: [{ data: [lc.h, lc.i, lc.s, lc.a], backgroundColor: [cssv('--pri'), cssv('--gold'), cssv('--blue'), cssv('--rose')], borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '72%', plugins: { legend: { display: false } } }, plugins: [{ id: 'ctr', afterDraw(ch) { const c = ch.ctx, a = ch.chartArea; c.save(); c.textAlign = 'center'; c.fillStyle = cssv('--ink'); c.font = '700 24px ' + cssv('--font'); c.fillText(fmtPct(lp), (a.left + a.right) / 2, (a.top + a.bottom) / 2 + 4); c.fillStyle = cssv('--mute'); c.font = '600 10px ' + cssv('--font'); c.fillText('KEHADIRAN', (a.left + a.right) / 2, (a.top + a.bottom) / 2 + 22); c.restore(); } }] });
};

/* ============================================================
   HALAMAN: PENGURUS & ID CARD
   ============================================================ */
function pgFiltered() {
  const q = ($('#fgQ').value || '').toLowerCase().trim(), kel = $('#fgKel').value, dap = $('#fgDap').value, st = $('#fgSt').value;
  return ST.P.filter(p => {
    if (kel && p.Kelompok !== kel) return false;
    if (dap && p.Dapukan !== dap) return false;
    if (st === '1' && p.Aktif === false) return false;
    if (st === '0' && p.Aktif !== false) return false;
    if (q && (p.Nama + ' ' + p.Kode + ' ' + p.Dapukan + ' ' + p.Kelompok + ' ' + (p.Desa || '') + ' ' + p.Alamat).toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).sort((a, b) => String(a.Kode).localeCompare(String(b.Kode)));
}
const uniq = (arr, k) => Array.from(new Set(arr.map(x => x[k]).filter(Boolean))).sort();
RENDER.pengurus = function () {
  ['addPengurus', 'printSelected', 'backCards', 'jpgSelected', 'delSelected', 'pdpCards'].forEach(a => { const b = $('[data-act=' + a + ']'); if (b) b.classList.toggle('hide', a === 'addPengurus' ? !canAdd() : !isMaster()); });
  const kel = uniq(ST.P, 'Kelompok'), dap = uniq(ST.P, 'Dapukan');
  const sel = (id, def, list) => { const cur = $(id).value; $(id).innerHTML = '<option value="">' + def + '</option>' + list.map(x => '<option>' + esc(x) + '</option>').join(''); $(id).value = list.indexOf(cur) >= 0 ? cur : ''; };
  sel('#fgKel', 'Semua Kelompok', kel); sel('#fgDap', 'Semua Dapukan', dap);
  const avg = mean(ST.act.map(p => pStats(p.ID, ST.done).pct));
  $('#pgStats').innerHTML =
    statCard('Total Pengurus', 'bi-people-fill', 'g', ST.P.length, '', '<span class="chip c-H nodot">' + ST.act.length + ' aktif</span>') +
    statCard('ID Card Tersedia', 'bi-person-vcard', 'b', ST.P.length, '', '<span class="mute">Barcode Code128 otomatis</span>') +
    statCard('Jumlah Kelompok', 'bi-diagram-3', 'y', kel.length, '', '<span class="mute">' + dap.length + ' dapukan</span>') +
    statCard('Rata-rata Presensi', 'bi-check2-square', 'g', fmtPct(avg), '', '<span class="chip ' + (avg >= ST.config.Target ? 'c-H' : 'c-I') + '">' + (avg >= ST.config.Target ? 'Disiplin Tinggi' : 'Perlu Perhatian') + '</span>');
  rPgTable();
};
function rPgTable() {
  const list = pgFiltered(), size = ST.pg.size, pages = Math.max(1, Math.ceil(list.length / size));
  if (ST.pg.page > pages) ST.pg.page = pages;
  const from = (ST.pg.page - 1) * size, rows = list.slice(from, from + size);
  if (!ST.pg.cur || !ST.pById[ST.pg.cur]) ST.pg.cur = list[0] ? list[0].ID : null;
  const allSel = list.length && list.every(p => ST.pg.sel.has(p.ID));
  const ed = isMaster();
  $('#fgInfo').textContent = 'Menampilkan ' + list.length + ' pengurus' + (ed ? ' · ' + ST.pg.sel.size + ' dipilih untuk cetak' : CUR_ROLE === 'penerobos' ? ' · Anda dapat menambah pengurus baru' : ' · mode lihat saja');
  $('#pgTable').innerHTML =
    '<thead><tr>' + (ed ? '<th style="width:44px"><input type="checkbox" data-chg="selAll" ' + (allSel ? 'checked' : '') + ' aria-label="Pilih semua"></th>' : '') + '<th>Pengurus</th><th>ID Barcode</th><th>Dapukan &amp; Kelompok</th><th>Kontak</th><th>Kehadiran</th>' + (ed ? '<th style="width:120px"></th>' : '') + '</tr></thead><tbody>' +
    (rows.length ? rows.map(p => {
      const s = pStats(p.ID, ST.done);
      return '<tr class="clk ' + (ST.pg.cur === p.ID ? 'sel' : '') + '" data-act="pickPengurus" data-id="' + p.ID + '">' +
        (ed ? '<td class="first" style="width:44px"><input type="checkbox" data-chg="selRow" data-id="' + p.ID + '" ' + (ST.pg.sel.has(p.ID) ? 'checked' : '') + ' aria-label="Pilih ' + esc(p.Nama) + '"></td>' : '') +
        '<td class="first"><div class="who">' + avatarHTML(p) + '<div style="min-width:0"><b>' + esc(p.Nama) + '</b><small>' + (p.Aktif === false ? '<span class="chip c-A nodot" style="padding:0 .4rem">Nonaktif</span> ' : '') + esc((p.TempatLahir ? p.TempatLahir + ', ' : '') + (dObj(p.TanggalLahir) ? fmtTgl(p.TanggalLahir, true) + ' · ' + umurOf(p.TanggalLahir) + ' th' : '')) + '</small></div></div></td>' +
        '<td data-l="Barcode"><span class="mono chip c-S nodot" style="padding:.1rem .5rem">' + esc(p.Kode) + '</span></td>' +
        '<td data-l="Dapukan"><div style="text-align:inherit"><b style="font-weight:600">' + esc(p.Dapukan) + '</b><small class="mute" style="display:block">Kelompok ' + esc(p.Kelompok) + (p.Desa ? ' · ' + esc(p.Desa) : '') + '</small></div></td>' +
        '<td data-l="Kontak" class="mono">' + esc(p.NoHP || '—') + '</td>' +
        '<td data-l="Kehadiran"><span class="mono" style="font-weight:600;color:' + (s.pct >= ST.config.Target ? 'var(--pri-d)' : 'var(--gold-d)') + '">' + fmtPct(s.pct) + '</span></td>' +
        (ed ? '<td data-l="Aksi" style="white-space:nowrap"><button class="btn btn-ghost btn-sm btn-ic" data-act="editPengurus" data-id="' + p.ID + '" aria-label="Ubah"><i class="bi bi-pencil"></i></button><button class="btn btn-ghost btn-sm btn-ic" data-act="printCard" data-id="' + p.ID + '" aria-label="Cetak kartu"><i class="bi bi-printer"></i></button></td>' : '') + '</tr>';
    }).join('') : '<tr><td colspan="' + (ed ? 7 : 5) + '"><div class="empty"><i class="bi bi-person-x"></i>Tidak ada pengurus yang cocok.</div></td></tr>') + '</tbody>';
  $('#pgInfo').textContent = list.length ? 'Menampilkan ' + (from + 1) + '–' + (from + rows.length) + ' dari ' + list.length + ' pengurus' : '';
  const pb = (n, l, on, dis) => '<button data-act="pgPage" data-n="' + n + '" class="' + (on ? 'on' : '') + '" ' + (dis ? 'disabled' : '') + '>' + l + '</button>';
  let nav = pb(ST.pg.page - 1, '<i class="bi bi-chevron-left"></i>', false, ST.pg.page <= 1);
  for (let i = 1; i <= pages; i++) { if (i === 1 || i === pages || Math.abs(i - ST.pg.page) <= 1) nav += pb(i, i, i === ST.pg.page); else if (Math.abs(i - ST.pg.page) === 2) nav += '<button disabled>…</button>'; }
  nav += pb(ST.pg.page + 1, '<i class="bi bi-chevron-right"></i>', false, ST.pg.page >= pages);
  $('#pgNav').innerHTML = nav; rPgPreview();
}
const umurOf = s => { const d = dObj(s); if (!d) return ''; const n = new Date(); let u = n.getFullYear() - d.getFullYear(); if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) u--; return u >= 0 && u < 130 ? u : ''; };
const ttlText = p => { const t = [p.TempatLahir, tglLahir(p.TanggalLahir)].filter(Boolean).join(', '), u = umurOf(p.TanggalLahir); return (t || '—') + (u !== '' ? ' (' + u + ' th)' : ''); };
const tglLahir = s => { const d = dObj(s); return d ? d.getDate() + ' ' + BULAN[d.getMonth()] + ' ' + d.getFullYear() : ''; };
const PF_CUT = 8, PF_RING = 3, PF_PAD = 4, PF_MAXW = 98, PF_MAXH = 86;      // bingkai foto: emas 3px + putih 4px
function fitPf(img) {                                                       // bingkai mengikuti rasio foto (tanpa potong)
  const w = img.naturalWidth || 3, h = img.naturalHeight || 4, sc = Math.min(PF_MAXW / w, PF_MAXH / h);
  img.style.width = Math.round(w * sc) + 'px'; img.style.height = Math.round(h * sc) + 'px'; img.style.visibility = 'visible';
}
window.fitPf = fitPf;
const SILH = '<svg viewBox="0 0 64 86" width="64" height="86" aria-hidden="true"><rect width="64" height="86" fill="#E2EAE6"/><circle cx="32" cy="32" r="14" fill="#94A9A0"/><path d="M6 86c2-22 14-30 26-30s24 8 26 30z" fill="#94A9A0"/></svg>';
function cardHTML(p, cfg) {
  cfg = cfg || ST.config;
  const pdp = !!p._pdp, hasImg = !pdp && !!p.FotoID;
  const ttl = ttlText(p);
  const moon = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M15.5 3.2a9 9 0 1 0 5.3 13.9A7.5 7.5 0 0 1 15.5 3.2z" fill="#FBBF24"/><path d="M18.6 4.6l.7 1.6 1.7.2-1.3 1.1.4 1.7-1.5-.9-1.5.9.4-1.7-1.3-1.1 1.7-.2z" fill="#FBBF24"/></svg>';
  const logoSrc = cfg.LogoData || (cfg.LogoID ? 'https://lh3.googleusercontent.com/d/' + esc(cfg.LogoID) + '=w160' : '');
  const title = pdp ? 'ID CARD PENDAMPING' : 'ID CARD PENGURUS ' + tingkatOf(p).toUpperCase();
  const photo = hasImg ? '<img alt="" style="visibility:hidden" onload="fitPf(this)" src="https://lh3.googleusercontent.com/d/' + esc(p.FotoID) + '=w480">'
    : pdp ? SILH : '<div class="phd">' + esc(initials(p.Nama)) + '</div>';
  const rows = pdp ? pdpRows(p)
    : [['TTL', ttl], ['Kelompok', p.Kelompok]].concat(p.Desa ? [['Desa', p.Desa]] : [], [['Alamat', p.Alamat || '—']]);
  return '<div class="idc"><div class="idc-top"></div><div class="idc-wave"></div><div class="idc-in">' +
    '<div class="idc-logo ' + (logoSrc ? 'has' : '') + '">' + (logoSrc ? '<img alt="" src="' + logoSrc + '">' : moon) + '</div><div class="idc-org">' + esc(cfgOrg(cfg)).toUpperCase() + '</div><div class="idc-sl">' + title + '</div>' +
    '<div class="idc-hx"><div class="pf"><div class="pi">' + photo + '</div></div></div>' +
    '<div class="idc-n">' + (pdp ? pdpTitle(p) : esc(p.Nama)) + '</div>' + (pdp ? '' : '<div class="idc-d">' + esc(p.Dapukan) + '</div>') +
    '<div class="idc-i' + (pdp ? ' pd' : '') + '">' + rows.map(r => '<span class="l">' + r[0] + '</span><span>:</span><b' + (pdp && !r[1] ? ' class="ln"' : '') + '>' + esc(r[1]) + '</b>').join('') + '</div>' +
    '<div class="idc-b"><svg class="bc" data-code="' + esc(p.Kode) + '"></svg><div>' + esc(p.Kode) + '</div></div></div></div>';
}

/* ---------- Unduh ID Card sebagai JPG (digambar di <canvas>, tanpa pustaka luar) ---------- */
const IMGC = {};
function imgFromSrc(src) { return new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('Gambar gagal dimuat')); i.src = src; }); }
async function imgFromId(id) {
  if (!IMGC[id]) { const r = await call('file.data', { id }); IMGC[id] = r.data; }
  return imgFromSrc(IMGC[id]);
}
function chamfer(ctx, x, y, w, h, c) { ctx.beginPath(); ctx.moveTo(x + c, y); ctx.lineTo(x + w - c, y); ctx.lineTo(x + w, y + c); ctx.lineTo(x + w, y + h - c); ctx.lineTo(x + w - c, y + h); ctx.lineTo(x + c, y + h); ctx.lineTo(x, y + h - c); ctx.lineTo(x, y + c); ctx.closePath(); }
function wrapText(ctx, text, maxW, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean), lines = []; let cur = '';
  words.forEach(w => { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; } });
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; let l = lines[maxLines - 1]; while (l.length > 1 && ctx.measureText(l + '…').width > maxW) l = l.slice(0, -1); lines[maxLines - 1] = l + '…'; }
  return lines;
}
async function drawCardCanvas(p, cfg) {
  cfg = cfg || ST.config; const S = 6, W = 216, H = 344, pdp = !!p._pdp, FF = '"Plus Jakarta Sans", system-ui, "Segoe UI", Roboto, sans-serif';
  try { await Promise.all(['800 9px', '700 8px', '600 7px'].map(f => document.fonts.load(f + ' "Plus Jakarta Sans"')).concat([document.fonts.load('600 7px "JetBrains Mono"')])); } catch (e) { }
  const [photo, logo] = await Promise.all([
    (!pdp && p.FotoID) ? imgFromId(p.FotoID).catch(() => null) : null,
    cfg.LogoData ? imgFromSrc(cfg.LogoData).catch(() => null) : (cfg.LogoID ? imgFromId(cfg.LogoID).catch(() => null) : null)
  ]);
  const cv = document.createElement('canvas'); cv.width = W * S; cv.height = H * S; const x = cv.getContext('2d'); x.scale(S, S);
  const txt = (t, cx, cy, font, color, align) => { x.font = font; x.fillStyle = color; x.textAlign = align || 'center'; x.textBaseline = 'middle'; x.fillText(t, cx, cy); };
  x.save(); x.beginPath(); x.roundRect(0, 0, W, H, 14); x.clip();
  let g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#FFFFFF'); g.addColorStop(1, '#EEF3F0'); x.fillStyle = g; x.fillRect(0, 0, W, H);
  g = x.createLinearGradient(-16, 0, 232, 128); g.addColorStop(0, '#166534'); g.addColorStop(.55, '#14532D'); g.addColorStop(1, '#064E3B'); x.fillStyle = g;
  x.beginPath(); x.moveTo(-16, 0); x.lineTo(232, 0); x.lineTo(232, 128 - 56.3); x.ellipse(108, 128 - 56.3, 124, 56.3, 0, 0, Math.PI, false); x.closePath(); x.fill();
  x.save(); x.clip(); x.fillStyle = 'rgba(255,255,255,.08)'; for (let yy = 10; yy < 128; yy += 20) for (let xx = -6; xx < 232; xx += 20) { x.beginPath(); x.arc(xx, yy, 1.2, 0, 7); x.fill(); } x.restore();
  g = x.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#B45309'); g.addColorStop(.5, '#F59E0B'); g.addColorStop(1, '#B45309'); x.fillStyle = g; x.fillRect(0, H - 5, W, 5);
  x.restore();
  x.strokeStyle = '#E2E8F0'; x.lineWidth = .5; x.beginPath(); x.roundRect(.25, .25, W - .5, H - .5, 14); x.stroke();
  x.beginPath(); x.arc(108, 23, 14, 0, 7); x.fillStyle = logo ? '#fff' : 'rgba(0,0,0,.14)'; x.fill(); x.lineWidth = 2; x.strokeStyle = '#F59E0B'; x.stroke();
  if (logo) { x.save(); x.beginPath(); x.arc(108, 23, 13, 0, 7); x.clip(); const sc = Math.min(26 / logo.width, 26 / logo.height); x.drawImage(logo, 108 - logo.width * sc / 2, 23 - logo.height * sc / 2, logo.width * sc, logo.height * sc); x.restore(); }
  else { x.fillStyle = '#FBBF24'; x.beginPath(); x.arc(107, 23, 6.5, 0, 7); x.fill(); x.fillStyle = '#14532D'; x.beginPath(); x.arc(110, 21, 5.6, 0, 7); x.fill(); }
  let org = cfgOrg(cfg).toUpperCase(); x.font = '800 9px ' + FF; while (org.length > 3 && x.measureText(org).width > 190) org = org.slice(0, -1);
  txt(org, 108, 45.5, '800 9px ' + FF, '#FBBF24');
  txt(pdp ? 'ID CARD PENDAMPING' : 'ID CARD PENGURUS ' + tingkatOf(p).toUpperCase(), 108, 56, '600 6.5px ' + FF, '#FFFFFF');
  let iw = 64, ih = 86; if (photo) { const sc = Math.min(PF_MAXW / photo.width, PF_MAXH / photo.height); iw = Math.round(photo.width * sc); ih = Math.round(photo.height * sc); }
  const fw = iw + 2 * (PF_RING + PF_PAD), fh = ih + 2 * (PF_RING + PF_PAD), fx = 108 - fw / 2, fy = 66.5 + (100 - fh) / 2;
  g = x.createLinearGradient(fx, fy, fx + fw, fy + fh); g.addColorStop(0, '#F59E0B'); g.addColorStop(.5, '#FBBF24'); g.addColorStop(1, '#D97706'); x.fillStyle = g; chamfer(x, fx, fy, fw, fh, PF_CUT); x.fill();
  x.fillStyle = '#fff'; chamfer(x, fx + PF_RING, fy + PF_RING, fw - 2 * PF_RING, fh - 2 * PF_RING, PF_CUT - PF_RING * .586); x.fill();
  const ix = fx + PF_RING + PF_PAD, iy = fy + PF_RING + PF_PAD;
  if (photo) x.drawImage(photo, ix, iy, iw, ih);
  else if (pdp) { x.fillStyle = '#E2EAE6'; x.fillRect(ix, iy, iw, ih); x.fillStyle = '#94A9A0'; x.beginPath(); x.arc(ix + iw / 2, iy + 32, 14, 0, 7); x.fill(); x.beginPath(); x.moveTo(ix + 6, iy + ih); x.bezierCurveTo(ix + 8, iy + 64, ix + 20, iy + 56, ix + iw / 2, iy + 56); x.bezierCurveTo(ix + iw - 20, iy + 56, ix + iw - 8, iy + 64, ix + iw - 6, iy + ih); x.fill(); }
  else { x.fillStyle = '#065F46'; x.fillRect(ix, iy, iw, ih); txt(initials(p.Nama), ix + iw / 2, iy + ih / 2, '700 26px ' + FF, '#fff'); }
  const nm = pdp ? pdpTitle(p) : String(p.Nama || '').toUpperCase(); x.font = '800 12px ' + FF;
  const nl = wrapText(x, nm, 192, 2), ny = 179.5 - (nl.length - 1) * 6.9;
  nl.forEach((l, i) => txt(l, 108, ny + i * 13.8, '800 12px ' + FF, '#B45309'));
  const dy = ny + (nl.length - 1) * 13.8 + 14;
  x.font = '700 8px ' + FF; let dp = pdp ? '' : String(p.Dapukan || ''); while (dp.length > 3 && x.measureText(dp).width > 192) dp = dp.slice(0, -1);
  if (!pdp) txt(dp, 108, dy, '700 8px ' + FF, '#0F172A');
  const ttl = ttlText(p);
  const rows = pdp ? pdpRows(p) : [['TTL', ttl], ['Kelompok', p.Kelompok || '']].concat(p.Desa ? [['Desa', p.Desa]] : [], [['Alamat', p.Alamat || '—']]);
  x.font = (pdp ? '600 8px ' : '600 7.3px ') + FF; const lw = Math.max.apply(null, rows.map(r => x.measureText(r[0]).width)), vx = 16 + lw + 4 + 5 + 4;
  let ry = pdp ? dy + 10 : dy + 12;
  rows.forEach(r => {
    x.textAlign = 'left'; x.textBaseline = 'top'; x.font = (pdp ? '600 8px ' : '600 7.3px ') + FF; x.fillStyle = '#334155'; x.fillText(r[0], 16, ry); x.fillText(':', 16 + lw + 4, ry);
    if (pdp && !r[1]) { x.strokeStyle = '#94A3B8'; x.setLineDash([1, 1.6]); x.lineWidth = .6; x.beginPath(); x.moveTo(vx, ry + 9.5); x.lineTo(200, ry + 9.5); x.stroke(); x.setLineDash([]); ry += 25; }
    else { x.fillStyle = '#0F172A'; const ls = wrapText(x, r[1], 200 - vx, 2); ls.forEach((l, i) => x.fillText(l, vx, ry + i * 9.86)); ry += pdp ? 25 : ls.length * 9.86 + 2; }
  });
  const bc = code128(String(p.Kode)), bw = 169, k = bw / bc.w, bx = (W - bw) / 2, by = 292; x.fillStyle = '#000';
  const re = /M(\d+) 0h(\d+)/g; let m; while ((m = re.exec(bc.d))) x.fillRect(bx + (+m[1]) * k, by, (+m[2]) * k, 28);
  txt(String(p.Kode), 108, 329, '600 6.5px "JetBrains Mono", ui-monospace, Consolas, monospace', '#0F172A');
  return cv;
}
function saveCanvasJpg(cv, name) {
  return new Promise(res => cv.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); res(); }, 1200); }, 'image/jpeg', .95));
}

/* ---------- Kartu BELAKANG (sama untuk semua orang) ---------- */
const BACK_RULES = ['Kartu ini adalah identitas pengurus dan wajib dibawa setiap pengajian.', 'Tunjukkan kartu atau pindai barcode pada petugas untuk mencatat kehadiran.', 'Kartu bersifat pribadi, tidak boleh dipinjamkan atau digandakan.', 'Jaga kartu dari air, lipatan, dan goresan agar barcode tetap terbaca.', 'Jika kartu hilang atau rusak, segera lapor ke admin untuk dicetak ulang.'];
function backHTML(cfg) {
  cfg = cfg || ST.config;
  const moon = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M15.5 3.2a9 9 0 1 0 5.3 13.9A7.5 7.5 0 0 1 15.5 3.2z" fill="#FBBF24"/><path d="M18.6 4.6l.7 1.6 1.7.2-1.3 1.1.4 1.7-1.5-.9-1.5.9.4-1.7-1.3-1.1 1.7-.2z" fill="#FBBF24"/></svg>';
  const logoSrc = cfg.LogoData || (cfg.LogoID ? 'https://lh3.googleusercontent.com/d/' + esc(cfg.LogoID) + '=w160' : '');
  return '<div class="idc"><div class="idc-top"></div><div class="idc-wave"></div><div class="idc-in">' +
    '<div class="idc-logo ' + (logoSrc ? 'has' : '') + '">' + (logoSrc ? '<img alt="" src="' + logoSrc + '">' : moon) + '</div><div class="idc-org">' + esc(cfgOrg(cfg)).toUpperCase() + '</div><div class="idc-sl">KETENTUAN KARTU</div>' +
    '<div class="idb-t">KETENTUAN PENGGUNAAN</div><ol class="idb-l">' + BACK_RULES.map(r => '<li>' + esc(r) + '</li>').join('') + '</ol>' +
    '<div class="idb-f"><b>Jika kartu ini ditemukan</b>mohon dikembalikan kepada pengurus ' + esc(cfgOrg(cfg)) + '. Terima kasih.</div></div></div>';
}
async function drawBackCanvas(cfg) {
  cfg = cfg || ST.config; const S = 6, W = 216, H = 344, FF = '"Plus Jakarta Sans", system-ui, "Segoe UI", Roboto, sans-serif';
  try { await Promise.all(['800 9px', '700 8px', '600 7px'].map(f => document.fonts.load(f + ' "Plus Jakarta Sans"'))); } catch (e) { }
  const logo = cfg.LogoData ? await imgFromSrc(cfg.LogoData).catch(() => null) : (cfg.LogoID ? await imgFromId(cfg.LogoID).catch(() => null) : null);
  const cv = document.createElement('canvas'); cv.width = W * S; cv.height = H * S; const x = cv.getContext('2d'); x.scale(S, S);
  const txt = (t, cx, cy, font, color) => { x.font = font; x.fillStyle = color; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(t, cx, cy); };
  x.save(); x.beginPath(); x.roundRect(0, 0, W, H, 14); x.clip();
  let g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#FFFFFF'); g.addColorStop(1, '#EEF3F0'); x.fillStyle = g; x.fillRect(0, 0, W, H);
  g = x.createLinearGradient(-16, 0, 232, 128); g.addColorStop(0, '#166534'); g.addColorStop(.55, '#14532D'); g.addColorStop(1, '#064E3B'); x.fillStyle = g;
  x.beginPath(); x.moveTo(-16, 0); x.lineTo(232, 0); x.lineTo(232, 128 - 56.3); x.ellipse(108, 128 - 56.3, 124, 56.3, 0, 0, Math.PI, false); x.closePath(); x.fill();
  g = x.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#B45309'); g.addColorStop(.5, '#F59E0B'); g.addColorStop(1, '#B45309'); x.fillStyle = g; x.fillRect(0, H - 5, W, 5);
  x.restore();
  x.strokeStyle = '#E2E8F0'; x.lineWidth = .5; x.beginPath(); x.roundRect(.25, .25, W - .5, H - .5, 14); x.stroke();
  x.beginPath(); x.arc(108, 23, 14, 0, 7); x.fillStyle = logo ? '#fff' : 'rgba(0,0,0,.14)'; x.fill(); x.lineWidth = 2; x.strokeStyle = '#F59E0B'; x.stroke();
  if (logo) { x.save(); x.beginPath(); x.arc(108, 23, 13, 0, 7); x.clip(); const sc = Math.min(26 / logo.width, 26 / logo.height); x.drawImage(logo, 108 - logo.width * sc / 2, 23 - logo.height * sc / 2, logo.width * sc, logo.height * sc); x.restore(); }
  else { x.fillStyle = '#FBBF24'; x.beginPath(); x.arc(107, 23, 6.5, 0, 7); x.fill(); x.fillStyle = '#14532D'; x.beginPath(); x.arc(110, 21, 5.6, 0, 7); x.fill(); }
  let org = cfgOrg(cfg).toUpperCase(); x.font = '800 9px ' + FF; while (org.length > 3 && x.measureText(org).width > 190) org = org.slice(0, -1);
  txt(org, 108, 45.5, '800 9px ' + FF, '#FBBF24'); txt('KETENTUAN KARTU', 108, 56, '600 6.5px ' + FF, '#FFFFFF');
  txt('KETENTUAN PENGGUNAAN', 108, 139, '800 8.5px ' + FF, '#14532D');
  let y = 151; x.textAlign = 'left'; x.textBaseline = 'top';
  BACK_RULES.forEach((r, i) => {
    x.fillStyle = '#F59E0B'; x.beginPath(); x.arc(21.5, y + 5, 4.5, 0, 7); x.fill(); txt(String(i + 1), 21.5, y + 5.3, '800 6px ' + FF, '#fff');
    x.textAlign = 'left'; x.textBaseline = 'top'; x.font = '500 7.2px ' + FF; x.fillStyle = '#1E293B';
    const ls = wrapText(x, r, 170, 4); ls.forEach((l, k) => x.fillText(l, 31, y + k * 9.9)); y += ls.length * 9.9 + 5.5;
  });
  x.strokeStyle = '#CBD5E1'; x.setLineDash([2, 2]); x.lineWidth = .6; x.beginPath(); x.moveTo(12, 296); x.lineTo(204, 296); x.stroke(); x.setLineDash([]);
  txt('Jika kartu ini ditemukan', 108, 305, '800 7.4px ' + FF, '#B45309');
  x.font = '500 6.6px ' + FF; wrapText(x, 'mohon dikembalikan kepada pengurus ' + cfgOrg(cfg) + '. Terima kasih.', 190, 2).forEach((l, i) => txt(l, 108, 315 + i * 9, '500 6.6px ' + FF, '#334155'));
  return cv;
}
function backCardsForm() {
  openModal('<div class="modal-h"><h3>Kartu Belakang</h3><button class="btn btn-ghost btn-ic btn-sm" data-act="modalClose" aria-label="Tutup"><i class="bi bi-x-lg"></i></button></div><div class="modal-b">' +
    '<p class="ink2" style="margin-bottom:1rem">Sisi belakang sama untuk semua kartu. Cetak di sisi balik kertas yang sudah berisi kartu depan (cetak bolak-balik), atau unduh sebagai JPG.</p>' +
    '<div class="fld"><label for="bkN">Jumlah kartu per lembar</label><input class="input" id="bkN" type="number" min="1" max="10" value="10"><div class="help">10 kartu = 1 lembar A4 penuh. Isi sesuai jumlah kartu depan pada lembar tersebut.</div></div>' +
    '<div id="bkPv" style="display:flex;justify-content:center;margin-top:.5rem"></div></div>' +
    '<div class="modal-f"><button type="button" class="btn btn-2" data-act="modalClose">Tutup</button><button type="button" class="btn btn-gold" id="bkJpg"><i class="bi bi-file-earmark-image"></i> Unduh JPG</button><button type="button" class="btn btn-pri" id="bkPrint"><i class="bi bi-printer"></i> Cetak</button></div>',
    box => {
      $('#bkPv', box).innerHTML = backHTML();
      $('#bkPrint', box).onclick = () => { const n = Math.max(1, Math.min(10, +$('#bkN', box).value || 10)); closeModal(); doPrint('<div class="pcards">' + Array.from({ length: n }, () => '<div class="pcell">' + backHTML() + '</div>').join('') + '</div>'); };
      $('#bkJpg', box).onclick = async () => { try { toast('Menyiapkan JPG…'); await saveCanvasJpg(await drawBackCanvas(), 'IDCard_Belakang.jpg'); } catch (e) { toast('Gagal membuat JPG: ' + e.message, 'err'); } };
    });
}
const safeName = t => String(t || 'kartu').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 40) || 'kartu';
async function downloadCards(list) {
  if (!list.length) { toast('Pilih pengurus terlebih dahulu (centang di tabel).', 'warn'); return; }
  toast('Menyiapkan ' + list.length + ' kartu JPG…');
  try { for (let i = 0; i < list.length; i++) { const cv = await drawCardCanvas(list[i]); await saveCanvasJpg(cv, 'IDCard_' + (list[i]._pdp ? list[i].Kode : safeName(list[i].Nama) + '_' + list[i].Kode) + '.jpg'); if (i < list.length - 1) await sleep(500); } toast(list.length + ' kartu JPG diunduh.'); }
  catch (e) { toast('Gagal membuat JPG: ' + e.message, 'err'); }
}
/* Barcode Code-128 (subset B) dibuat sendiri → tanpa pustaka CDN, tampil & tercetak andal */
const C128 = '212222,222122,222221,121223,121322,131222,122213,122312,132212,221213,221312,231212,112232,122132,122231,113222,123122,123221,223211,221132,221231,213212,223112,312131,311222,321122,321221,312212,322112,322211,212123,212321,232121,111323,131123,131321,112313,132113,132311,211313,231113,231311,112133,112331,132131,113123,113321,133121,313121,211331,231131,213113,213311,213131,311123,311321,331121,312113,312311,332111,314111,221411,431111,111224,111422,121124,121421,141122,141221,112214,112412,122114,122411,142112,142211,241211,221114,413111,241112,134111,111242,121142,121241,114212,124112,124211,411212,421112,421211,212141,214121,412121,111143,111341,131141,114113,114311,411113,411311,113141,114131,311141,411131,211412,211214,211232,2331112'.split(',');
function code128(text) {
  const codes = [104]; let sum = 104;
  for (let i = 0; i < text.length; i++) { const v = text.charCodeAt(i) - 32; if (v < 0 || v > 94) throw new Error('Karakter tidak didukung'); codes.push(v); sum += v * (i + 1); }
  codes.push(sum % 103, 106);
  let x = 10, d = '';                       // 10 modul zona tenang di kiri
  codes.forEach(c => { const p = C128[c]; for (let k = 0; k < p.length; k++) { const w = +p[k]; if (k % 2 === 0) d += 'M' + x + ' 0h' + w + 'v1h-' + w + 'z'; x += w; } });
  return { w: x + 10, d };
}
function drawBarcodes(root) {
  $$('svg.bc', root).forEach(s => {
    try {
      const b = code128(String(s.dataset.code || ''));
      s.setAttribute('viewBox', '0 0 ' + b.w + ' 1'); s.setAttribute('preserveAspectRatio', 'none');
      s.setAttribute('shape-rendering', 'crispEdges'); s.innerHTML = '<path d="' + b.d + '" fill="#000"/>';
    } catch (e) { /* kode tidak valid */ }
  });
}
function rPgPreview() {
  const p = ST.pById[ST.pg.cur], box = $('#pgPreview');
  if (!p) { box.innerHTML = '<div class="empty"><i class="bi bi-person-vcard"></i>Pilih pengurus untuk melihat pratinjau kartu.</div>'; return; }
  box.innerHTML = '<div class="card-h"><div><h3>Pratinjau Kartu</h3><p>54 × 86 mm (CR80 potret)</p></div></div>' + cardHTML(p) + (CUR_ROLE === 'penerobos' ? '<div class="pv-acts"><button class="btn btn-gold" data-act="cardJpg" data-id="' + p.ID + '"><i class="bi bi-file-earmark-image"></i> Unduh JPG</button></div>' : !isMaster() ? '<div class="pv-acts"><button class="btn btn-gold" data-act="cardJpg" data-id="' + p.ID + '"><i class="bi bi-file-earmark-image"></i> Unduh JPG</button><button class="btn btn-pri" data-act="bimbinganFor" data-id="' + p.ID + '"><i class="bi bi-chat-heart"></i> Kirim Bimbingan</button></div>' : '') +
    (!isMaster() ? '' : '<div class="pv-acts"><div class="row c2"><button class="btn btn-pri" data-act="printCard" data-id="' + p.ID + '"><i class="bi bi-printer"></i> Cetak</button><button class="btn btn-gold" data-act="cardJpg" data-id="' + p.ID + '"><i class="bi bi-file-earmark-image"></i> Unduh JPG</button></div><button class="btn btn-2" data-act="backCards"><i class="bi bi-credit-card-2-back"></i> Kartu Belakang</button>' +
    '<div class="row c2"><button class="btn btn-2" data-act="editPengurus" data-id="' + p.ID + '"><i class="bi bi-pencil"></i> Ubah</button><button class="btn btn-2" data-act="regenKode" data-id="' + p.ID + '"><i class="bi bi-arrow-repeat"></i> Barcode Baru</button></div>' +
    '<div class="row c2"><button class="btn btn-2" data-act="togglePengurus" data-id="' + p.ID + '"><i class="bi bi-' + (p.Aktif === false ? 'toggle-off' : 'toggle-on') + '"></i> ' + (p.Aktif === false ? 'Aktifkan' : 'Nonaktifkan') + '</button><button class="btn btn-danger" data-act="delPengurus" data-id="' + p.ID + '"><i class="bi bi-trash"></i> Hapus</button></div></div>');
  drawBarcodes(box);
}
/* Kode barcode = KTP- + INISIAL nama + 3 angka (KTP-BS001). Server tetap penentu akhir. */
function initialsOf(nama) {
  let t = String(nama || '').split(',')[0].split(/\s+/).filter(Boolean);
  while (t.length > 1 && /^(h|hj|ust|ustadz|ustadzah|kh|k\.h|dr|ir|prof|drs|dra|sdr|bpk|ibu)\.?$/i.test(t[0])) t.shift();
  while (t.length > 1 && /^[A-Za-z]{1,3}\.[A-Za-z.]*$/.test(t[t.length - 1])) t.pop();
  t = t.map(x => x.replace(/[^A-Za-z]/g, '')).filter(Boolean);
  let ini = (t.length >= 2 ? t.slice(0, 3).map(x => x[0]).join('') : (t[0] || 'XX').slice(0, 3)).toUpperCase();
  return ini.length < 2 ? ini + 'X' : ini;
}
function nextKodeLocal(nama) {
  const pref = 'KTP-' + initialsOf(nama), used = {}; let max = 0; const re = new RegExp('^' + pref + '(\\d+)$');
  ST.P.forEach(p => { const k = String(p.Kode || '').toUpperCase(); used[k] = 1; const m = re.exec(k); if (m) max = Math.max(max, +m[1]); });
  let n = max + 1; while (used[pref + pad(n, 3)]) n++; return pref + pad(n, 3);
}
/* Kompres foto di browser — UTUH (tidak dipotong), sisi terpanjang maks 480 px */
function compressPhoto(file) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const sc = Math.min(1, 480 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * sc)); c.height = Math.max(1, Math.round(img.height * sc));
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Gambar tidak dapat dibaca.')); };
    img.src = url;
  });
}
function pengurusForm(id) {
  const p = id ? ST.pById[id] : null, v = k => esc(p ? p[k] || '' : '');
  let photo = null;
  openModal('<div class="modal-h"><h3>' + (p ? 'Ubah Pengurus' : 'Tambah Pengurus Baru') + '</h3><button class="btn btn-ghost btn-ic btn-sm" data-act="modalClose" aria-label="Tutup"><i class="bi bi-x-lg"></i></button></div>' +
    '<form id="fPg" novalidate><div class="modal-b">' +
    '<div class="upl fld"><div id="fPhotoPv">' + (p ? avatarHTML(p, 'big-av') : '<div class="big-av"><i class="bi bi-camera"></i></div>') + '</div><div><label class="btn btn-2 btn-sm" for="fPhoto"><i class="bi bi-image"></i> Pilih Foto</label><input type="file" id="fPhoto" accept="image/*" class="sr"><div class="help" style="margin-top:.375rem">Foto tampil utuh &amp; di tengah pada ID Card (tidak dipotong).</div></div></div>' +
    '<div class="fld"><label for="fNama">Nama lengkap *</label><input class="input" id="fNama" value="' + v('Nama') + '" maxlength="80" required></div>' +
    '<div class="row c2"><div class="fld"><label for="fTmp">Tempat lahir</label><input class="input" id="fTmp" value="' + v('TempatLahir') + '" maxlength="60"></div><div class="fld"><label for="fTgl">Tanggal lahir</label><input class="input" id="fTgl" type="date" value="' + v('TanggalLahir') + '"><div class="help" id="fUmur"></div></div></div>' +
    '<div class="fld"><label for="fKel">Kelompok *</label><input class="input" id="fKel" list="dlKel" value="' + v('Kelompok') + '" maxlength="40" required></div>' +
    '<div class="fld"><label for="fDesa">Desa</label><input class="input" id="fDesa" list="dlDesa" value="' + v('Desa') + '" maxlength="40" placeholder="Contoh: Desa Sukamaju"></div>' +
    '<div class="fld"><label for="fDap">Dapukan *</label><input class="input" id="fDap" list="dlDap" value="' + v('Dapukan') + '" maxlength="60" required></div>' +
    '<div class="fld"><label for="fTk">Tingkat pengurus *</label><select class="select" id="fTk">' + ['Daerah', 'Desa', 'Kelompok'].map(t => '<option ' + (tingkatOf(p) === t ? 'selected' : '') + '>' + t + '</option>').join('') + '</select><div class="help">Menentukan tulisan di ID Card: “ID CARD PENGURUS …”.</div></div>' +
    '<datalist id="dlKel">' + uniq(ST.P, 'Kelompok').map(x => '<option value="' + esc(x) + '">').join('') + '</datalist><datalist id="dlDesa">' + uniq(ST.P, 'Desa').map(x => '<option value="' + esc(x) + '">').join('') + '</datalist><datalist id="dlDap">' + uniq(ST.P, 'Dapukan').map(x => '<option value="' + esc(x) + '">').join('') + '</datalist>' +
    '<div class="fld"><label for="fAlm">Alamat</label><textarea class="textarea" id="fAlm" maxlength="200">' + v('Alamat') + '</textarea></div>' +
    '<div class="row c2"><div class="fld"><label for="fHp">No. HP / WA</label><input class="input" id="fHp" inputmode="tel" value="' + v('NoHP') + '" maxlength="20"></div><div class="fld"><label for="fAkt">Status</label><select class="select" id="fAkt"><option value="1">Aktif</option><option value="0" ' + (p && p.Aktif === false ? 'selected' : '') + '>Nonaktif</option></select></div></div>' +
    '<div class="err" id="fErr" role="alert"></div></div>' +
    '<div class="modal-f"><button type="button" class="btn btn-2" data-act="modalClose">Batal</button><button type="submit" class="btn btn-pri"><i class="bi bi-check2"></i> Simpan</button></div></form>',
    box => {
      const tg = $('#fTgl', box), up = () => { const u = umurOf(tg.value); $('#fUmur', box).textContent = u !== '' ? 'Umur: ' + u + ' tahun' : ''; }; tg.oninput = tg.onchange = up; up();
      $('#fPhoto', box).onchange = async e => {
        const f = e.target.files[0]; if (!f) return;
        try { photo = await compressPhoto(f); $('#fPhotoPv', box).innerHTML = '<div class="big-av" style="border-radius:50%"><img alt="" src="' + photo + '"></div>'; } catch (er) { $('#fErr', box).textContent = er.message; }
      };
      $('#fPg', box).onsubmit = ev => {
        ev.preventDefault();
        const rec = { ID: p ? p.ID : '', Nama: $('#fNama').value.trim(), TempatLahir: $('#fTmp').value.trim(), TanggalLahir: $('#fTgl').value, Kelompok: $('#fKel').value.trim(), Desa: $('#fDesa').value.trim(), Tingkat: $('#fTk').value, Alamat: $('#fAlm').value.trim(), Dapukan: $('#fDap').value.trim(), NoHP: $('#fHp').value.trim(), Aktif: $('#fAkt').value === '1' };
        if (!rec.Nama || !rec.Kelompok || !rec.Dapukan) { $('#fErr').textContent = 'Nama, kelompok, dan dapukan wajib diisi.'; return; }
        savePengurus(rec, photo);
      };
    });
}
async function savePengurus(rec, photo) {
  const isNew = !rec.ID; let prev = null, local;
  if (isNew) { local = Object.assign({}, rec, { ID: uid(), Kode: nextKodeLocal(rec.Nama), FotoID: '', DibuatPada: nowStr() }); ST.P.push(local); }
  else { local = ST.pById[rec.ID]; prev = Object.assign({}, local); Object.assign(local, rec); }
  index(); ST.pg.cur = local.ID; closeModal(); RENDER.pengurus(); toast(isNew ? 'Pengurus ditambahkan.' : 'Perubahan disimpan.');
  const oldFoto = prev ? prev.FotoID : '';
  try {
    const r = await call('pengurus.save', { rec: Object.assign({}, local, { Aktif: local.Aktif !== false }) });
    Object.assign(local, r.rec); if (photo) local.FotoID = oldFoto;
    index(); if (ST.page === 'pengurus') RENDER.pengurus();
  } catch (e) {
    if (isNew) ST.P = ST.P.filter(x => x.ID !== local.ID); else Object.assign(local, prev);
    index(); if (ST.page === 'pengurus') RENDER.pengurus(); toast('Gagal menyimpan: ' + e.message, 'err'); return;
  }
  if (photo) {
    try { const ph = await call('pengurus.photo', { id: local.ID, data: photo }); local.FotoID = ph.fotoId; index(); if (ST.page === 'pengurus') RENDER.pengurus(); }
    catch (e) { toast('Data tersimpan, tetapi foto gagal diunggah: ' + e.message, 'warn'); }
  }
}
async function togglePengurus(id) {
  const p = ST.pById[id]; if (!p) return; const was = p.Aktif !== false; p.Aktif = !was; index(); RENDER.pengurus();
  try { await call('pengurus.save', { rec: Object.assign({}, p, { Aktif: p.Aktif }) }); toast(p.Aktif ? 'Pengurus diaktifkan.' : 'Pengurus dinonaktifkan.'); }
  catch (e) { p.Aktif = was; index(); RENDER.pengurus(); toast('Gagal: ' + e.message, 'err'); }
}
function purgeLocal(ids) { const set = new Set(ids); ST.P = ST.P.filter(p => !set.has(p.ID)); ST.K = ST.K.filter(k => !set.has(k.PengurusID)); ids.forEach(i => ST.pg.sel.delete(i)); if (set.has(ST.pg.cur)) ST.pg.cur = null; index(); if (ST.page === 'pengurus') RENDER.pengurus(); }
async function delPengurus(id) {
  const p = ST.pById[id]; if (!p) return;
  if (!await confirmBox('Hapus pengurus?', 'Hapus <b>' + esc(p.Nama) + '</b> secara permanen?', 'Hapus', true)) return;
  try { await call('pengurus.delete', { id }); purgeLocal([id]); toast('Pengurus dihapus.'); }
  catch (e) {
    if (e.code !== 'HASRIWAYAT') { toast(e.message, 'err'); return; }
    if (!await confirmBox('Hapus beserta riwayat?', '<b>' + esc(p.Nama) + '</b> sudah punya riwayat kehadiran. Jika dihapus, <b>seluruh riwayat kehadirannya ikut terhapus</b> dan persentase laporan berubah. Alternatif yang lebih aman: Nonaktifkan.', 'Hapus Semuanya', true)) return;
    try { await call('pengurus.delete', { id, force: true }); purgeLocal([id]); toast('Pengurus & riwayatnya dihapus.'); } catch (x) { toast(x.message, 'err'); }
  }
}
async function delSelected() {
  const ids = [...ST.pg.sel].filter(i => ST.pById[i]); if (!ids.length) { toast('Centang pengurus yang akan dihapus.', 'warn'); return; }
  if (!await confirmBox('Hapus ' + ids.length + ' pengurus?', 'Data yang dipilih akan dihapus permanen. Pengurus yang punya riwayat kehadiran ditanyakan terpisah.', 'Hapus', true)) return;
  try {
    const r = await call('pengurus.deleteMany', { ids, force: false }); purgeLocal(r.ids || []);
    let msg = (r.deleted || 0) + ' pengurus dihapus.';
    if (r.blocked && r.blocked.length) {
      const names = r.blocked.map(i => (ST.pById[i] || {}).Nama).filter(Boolean).slice(0, 5).join(', ');
      if (await confirmBox('Hapus juga yang punya riwayat?', r.blocked.length + ' pengurus punya riwayat kehadiran (' + esc(names) + (r.blocked.length > 5 ? ', …' : '') + '). Hapus beserta <b>seluruh riwayatnya</b>?', 'Hapus Semuanya', true)) {
        const r2 = await call('pengurus.deleteMany', { ids: r.blocked, force: true }); purgeLocal(r2.ids || []); msg += ' + ' + (r2.deleted || 0) + ' beserta riwayat.';
      }
    }
    toast(msg);
  } catch (e) { toast('Gagal menghapus: ' + e.message, 'err'); }
}
async function regenKode(id) {
  const p = ST.pById[id]; if (!p) return;
  if (!await confirmBox('Buat barcode baru?', 'Barcode lama <b>' + esc(p.Kode) + '</b> tidak akan berlaku lagi. Kartu fisik perlu dicetak ulang.', 'Buat Barcode Baru')) return;
  try { const r = await call('pengurus.regen', { id }); p.Kode = r.kode; index(); RENDER.pengurus(); toast('Barcode baru: ' + r.kode); }
  catch (e) { toast(e.message, 'err'); }
}
/* Cetak (jendela cetak browser → "Simpan sebagai PDF" tersedia) */
async function doPrint(html) {
  const pa = $('#printArea'); pa.innerHTML = html; drawBarcodes(pa);
  const imgs = $$('img', pa); await Promise.race([Promise.all(imgs.map(i => i.complete ? 1 : new Promise(r => { i.onload = i.onerror = r; }))), sleep(2500)]);
  const clear = () => { pa.innerHTML = ''; window.removeEventListener('afterprint', clear); };
  window.addEventListener('afterprint', clear);
  try { window.print(); } catch (e) { toast('Pencetakan diblokir oleh browser/iframe.', 'err'); clear(); }
}
function printCards(list) {
  if (!list.length) { toast('Pilih pengurus terlebih dahulu (centang di tabel).', 'warn'); return; }
  let html = ''; for (let i = 0; i < list.length; i += 10) html += '<div class="pcards">' + list.slice(i, i + 10).map(p => '<div class="pcell">' + cardHTML(p) + '</div>').join('') + '</div>';
  doPrint(html);
}
async function exportXlsx(sheets, filename) {
  try {
    await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
    const wb = XLSX.utils.book_new();
    sheets.forEach(s => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name));
    XLSX.writeFile(wb, filename); toast('Berkas Excel diunduh.');
  } catch (e) { toast('Ekspor gagal: ' + e.message, 'err'); }
}

/* ============================================================
   PENDAMPING: kartu umum PDP-001… ; saat dipindai muncul isian data
   ============================================================ */
const isPdpCode = c => /^PDP-\d{3,5}$/.test(String(c).toUpperCase());
const pdpCard = (n, o) => Object.assign({ _pdp: true, Kode: 'PDP-' + pad(n, 3), Nama: 'Pendamping', Jenis: 'Kelompok', Kel: '', Des: '' }, o || {});
const pdpTitle = p => 'PENDAMPING ' + String(p.Jenis === 'Desa' ? 'DESA' : 'KELOMPOK');
const pdpRows = p => p.Jenis === 'Desa' ? [['Desa', p.Des || '']] : [['Kelompok', p.Kel || ''], ['Desa', p.Des || '']];
function nextPdpNo() { let m = 0; ST.D.concat(ST.PC).forEach(d => { const x = /^PDP-(\d+)$/.exec(d.Kode || ''); if (x) m = Math.max(m, +x[1]); }); return m + 1; }
function pdpCardsForm() {
  openModal('<div class="modal-h"><h3>Kartu Pendamping</h3><button class="btn btn-ghost btn-ic btn-sm" data-act="modalClose" aria-label="Tutup"><i class="bi bi-x-lg"></i></button></div><div class="modal-b">' +
    '<p class="ink2" style="margin-bottom:1rem">Kartu tanpa nama orang. Pilih jenisnya dan isi nama kelompok / desa yang akan tercetak. Saat dipindai pada sesi pengajian, aplikasi meminta pendamping mengisi <b>Nama, Kelompok, Desa, dan Dapukan</b>.</p>' +
    '<div class="fld"><label for="pdJ">Jenis pendamping</label><select class="select" id="pdJ"><option value="Kelompok">Pendamping Kelompok</option><option value="Desa">Pendamping Desa</option></select></div>' +
    '<div class="fld" id="pdKw"><label for="pdKel">Nama kelompok</label><input class="input" id="pdKel" maxlength="40" placeholder="Contoh: Tumbang Titi"></div>' +
    '<div class="fld"><label for="pdDes">Nama desa</label><input class="input" id="pdDes" maxlength="40" placeholder="Contoh: Desa Sukamaju"></div>' +
    '<div class="row c2"><div class="fld"><label for="pdN">Jumlah kartu</label><input class="input" id="pdN" type="number" min="1" max="30" value="5"></div><div class="fld"><label for="pdS">Mulai dari nomor</label><input class="input" id="pdS" type="number" min="1" max="9999" value="' + nextPdpNo() + '"></div></div>' +
    '<div id="pdPv" style="display:flex;justify-content:center;margin-top:.5rem"></div></div>' +
    '<div class="modal-f"><button type="button" class="btn btn-2" data-act="modalClose">Tutup</button><button type="button" class="btn btn-gold" id="pdJpg"><i class="bi bi-file-earmark-image"></i> Unduh JPG</button><button type="button" class="btn btn-pri" id="pdPrint"><i class="bi bi-printer"></i> Cetak</button></div>',
    box => {
      const list = () => { const n = Math.max(1, Math.min(30, +$('#pdN', box).value || 1)), s0 = Math.max(1, Math.min(9999, +$('#pdS', box).value || 1)); const o = { Jenis: $('#pdJ', box).value, Kel: $('#pdKel', box).value.trim(), Des: $('#pdDes', box).value.trim() }; return Array.from({ length: n }, (_, i) => pdpCard(s0 + i, o)); };
      const pv = () => { $('#pdPv', box).innerHTML = cardHTML(list()[0]); drawBarcodes($('#pdPv', box)); };
      const jn = () => { $('#pdKw', box).style.display = $('#pdJ', box).value === 'Desa' ? 'none' : ''; pv(); };
      $('#pdN', box).oninput = $('#pdS', box).oninput = $('#pdKel', box).oninput = $('#pdDes', box).oninput = pv; $('#pdJ', box).onchange = jn; pv();
      const savePc = async l => {
        try { const r = await call('pendamping.kartu', { cards: l.map(c => ({ kode: c.Kode, jenis: c.Jenis, kelompok: c.Kel, desa: c.Des })) }); (r.cards || []).forEach(c => { const i = ST.PC.findIndex(x => x.Kode === c.Kode); if (i >= 0) ST.PC[i] = c; else ST.PC.push(c); }); persistSoon(); }
        catch (e) { toast('Data kartu belum tersimpan di server (' + e.message + '). Kelompok/desa tidak akan terisi otomatis saat dipindai.', 'warn'); }
      };
      $('#pdPrint', box).onclick = async () => { const l = list(); await savePc(l); let html = ''; for (let i = 0; i < l.length; i += 10) html += '<div class="pcards">' + l.slice(i, i + 10).map(p => '<div class="pcell">' + cardHTML(p) + '</div>').join('') + '</div>'; closeModal(); doPrint(html); };
      $('#pdJpg', box).onclick = async () => { const l = list(); await savePc(l); downloadCards(l); };
    });
}
function pdpScanForm(code, j) {
  const pc = ST.PC.find(x => x.Kode === code);
  const all = ST.P.concat(ST.D), dl = (id, k) => '<datalist id="' + id + '">' + uniq(all, k).map(x => '<option value="' + esc(x) + '">').join('') + '</datalist>';
  openModal('<div class="modal-h"><h3>Data Pendamping</h3><button class="btn btn-ghost btn-ic btn-sm" data-act="modalClose" aria-label="Tutup"><i class="bi bi-x-lg"></i></button></div><form id="fPdp" novalidate><div class="modal-b">' +
    '<p class="ink2" style="margin-bottom:1rem">Kartu <b class="mono">' + esc(code) + '</b>' + (pc ? ' (' + esc(pdpTitle(pc).toLowerCase()) + ')' : '') + ' terbaca. Kelompok dan desa terisi otomatis dari kartu; isi nama dan dapukan untuk sesi <b>' + esc(j.Tema) + '</b>.</p>' +
    '<div class="fld"><label for="pdNama">Nama *</label><input class="input" id="pdNama" maxlength="80" autocomplete="off" required></div>' +
    '<div class="fld"><label for="pdKel">Kelompok</label><input class="input" id="pdKel" list="dlKel2" maxlength="40" value="' + esc(pc ? pc.Kelompok : '') + '"></div>' +
    '<div class="fld"><label for="pdDesa">Desa</label><input class="input" id="pdDesa" list="dlDesa2" maxlength="40" value="' + esc(pc ? pc.Desa : '') + '"></div>' +
    '<div class="fld"><label for="pdDap">Dapukan</label><input class="input" id="pdDap" list="dlDap2" maxlength="60" placeholder="Contoh: Pendamping"></div>' +
    dl('dlKel2', 'Kelompok') + dl('dlDesa2', 'Desa') + dl('dlDap2', 'Dapukan') +
    '<div class="err" id="pdErr" role="alert"></div></div><div class="modal-f"><button type="button" class="btn btn-2" data-act="modalClose">Batal</button><button type="submit" class="btn btn-pri"><i class="bi bi-check2"></i> Catat Hadir</button></div></form>',
    box => {
      setTimeout(() => { const i = $('#pdNama', box); if (i) i.focus(); }, 60);
      $('#fPdp', box).onsubmit = ev => {
        ev.preventDefault(); const nama = $('#pdNama', box).value.trim(); if (nama.length < 2) { $('#pdErr', box).textContent = 'Nama wajib diisi.'; return; }
        const rec = { ID: 'tmp' + uid(), JadwalID: j.ID, Kode: code, Waktu: nowStr(), Nama: nama, Kelompok: $('#pdKel', box).value.trim(), Desa: $('#pdDesa', box).value.trim(), Dapukan: $('#pdDap', box).value.trim(), Oleh: ST.user.username, _pending: true };
        const payload = { jadwalId: j.ID, kode: code, nama: rec.Nama, kelompok: rec.Kelompok, desa: rec.Desa, dapukan: rec.Dapukan };
        ST.D.push(rec); closeModal(); beep('ok'); toast('Pendamping dicatat: ' + nama); persistSoon(); if (ST.page === 'scan') rScanLive();
        if (j.Status === 'Terjadwal') setStatusJadwal(j.ID, 'Berlangsung', true);
        call('pendamping.add', payload)
          .then(r => { Object.assign(rec, r.rec); delete rec._pending; persistSoon(); if (ST.page === 'scan') rScanLive(); })
          .catch(e => { if (e.net) { enqueue('pendamping.add', payload); return; } ST.D = ST.D.filter(d => d !== rec); beep('bad'); toast(e.message, 'err'); if (ST.page === 'scan') rScanLive(); });
      };
    });
}
async function pdpDelete(id) {
  const d = ST.D.find(x => x.ID === id); if (!d) return;
  if (!await confirmBox('Hapus catatan pendamping?', 'Hapus <b>' + esc(d.Nama) + '</b> dari sesi ini?', 'Hapus', true)) return;
  ST.D = ST.D.filter(x => x !== d); if (ST.page === 'scan') rScanLive(); persistSoon();
  try { await call('pendamping.delete', { id }); } catch (e) { ST.D.push(d); if (ST.page === 'scan') rScanLive(); toast(e.message, 'err'); }
}

/* ============================================================
   HALAMAN: JADWAL
   ============================================================ */
const statusChipJ = j => j.Status === 'Selesai' ? '<span class="chip c-N">Selesai</span>' : j.Status === 'Berlangsung' ? '<span class="chip c-H">Berlangsung</span>' : '<span class="chip c-S">Terjadwal</span>';
function printPresensi(jid) {
  const j = ST.jById[jid]; if (!j) return;
  const ppl = ST.act.slice().sort((a, b) => String(a.Kelompok).localeCompare(String(b.Kelompok)) || a.Nama.localeCompare(b.Nama));
  const c = { Hadir: 0, Izin: 0, Sakit: 0, Alpa: 0, Belum: 0 };
  const rowsH = ppl.map((p, i) => { const k = ST.kMap[j.ID + '|' + p.ID]; if (k) c[k.Status] = (c[k.Status] || 0) + 1; else c.Belum++;
    return '<tr><td class="c">' + (i + 1) + '</td><td>' + esc(p.Nama) + '</td><td>' + esc(p.Kelompok) + '</td><td>' + esc(p.Dapukan) + '</td><td class="c">' + (k ? esc(k.Status) : '') + '</td><td class="c">' + (k ? esc(String(k.Waktu).slice(11, 16)) : '') + '</td><td>' + (k ? esc(k.Keterangan || '') : '') + '</td><td style="width:22mm"></td></tr>'; }).join('');
  const pd = ST.D.filter(d => d.JadwalID === j.ID);
  doPrint('<div class="prep"><h1>Daftar Hadir Pengajian Pengurus — ' + esc(ST.config.AppName) + '</h1><p><b>' + esc(j.Tema) + '</b> · ' + esc(fmtTgl(j.Tanggal)) + ' · ' + esc(j.Mulai) + (j.Selesai ? '–' + esc(j.Selesai) : '') + ' WIB' + (j.Tempat ? ' · ' + esc(j.Tempat) : '') + (j.Pemateri ? ' · Pemateri: ' + esc(j.Pemateri) : '') + '</p>' +
    '<p>Hadir ' + c.Hadir + ' · Izin ' + c.Izin + ' · Sakit ' + c.Sakit + ' · Alpa ' + c.Alpa + ' · Belum tercatat ' + c.Belum + ' · Pendamping ' + pd.length + ' · Dicetak ' + esc(fmtTgl(todayStr())) + '</p>' +
    '<table><thead><tr><th>No</th><th>Nama</th><th>Kelompok</th><th>Dapukan</th><th>Status</th><th>Jam</th><th>Keterangan</th><th>Paraf</th></tr></thead><tbody>' + rowsH + '</tbody></table>' +
    (pd.length ? '<h1 style="font-size:12pt;margin:6mm 0 2mm">Pendamping Hadir (' + pd.length + ')</h1><table><thead><tr><th>No</th><th>Nama</th><th>Kelompok</th><th>Desa</th><th>Dapukan</th><th>Jam</th><th>Paraf</th></tr></thead><tbody>' + pd.map((d, i) => '<tr><td class="c">' + (i + 1) + '</td><td>' + esc(d.Nama) + '</td><td>' + esc(d.Kelompok) + '</td><td>' + esc(d.Desa) + '</td><td>' + esc(d.Dapukan) + '</td><td class="c">' + esc(String(d.Waktu).slice(11, 16)) + '</td><td style="width:22mm"></td></tr>').join('') + '</tbody></table>' : '') + '</div>');
}
RENDER.jadwal = function () {
  const el = $('#page-jadwal'), master = ST.user.peran === 'master', live = pickLive();
  let list = ST.J.slice(); const q = ST.jd.q.toLowerCase();
  if (ST.jd.st) list = list.filter(j => j.Status === ST.jd.st);
  if (q) list = list.filter(j => (j.Tema + ' ' + j.Pemateri + ' ' + j.Tempat + ' ' + j.Kategori).toLowerCase().indexOf(q) >= 0);
  const open = list.filter(j => j.Status !== 'Selesai').sort(cmpJ), closed = list.filter(j => j.Status === 'Selesai').sort(cmpJ).reverse(); list = open.concat(closed);
  el.innerHTML =
    '<div class="ph"><div><span class="tag"><i class="bi bi-calendar-event"></i> Modul Jadwal &amp; Agenda</span><h1 style="margin-top:.5rem">Manajemen <em>Jadwal Pengajian</em></h1><p>Kelola agenda pengajian rutin pengurus, pemateri, dan lokasi.</p></div>' +
    '<div class="acts"><button class="btn btn-2" data-act="exportJadwal"><i class="bi bi-file-earmark-spreadsheet"></i> Ekspor</button>' + (canScan() ? '<button class="btn btn-pri" data-act="addJadwal"><i class="bi bi-plus-lg"></i> Tambah Jadwal</button>' : '') + '</div></div>' +
    '<div class="grid g4">' + statCard('Total Sesi', 'bi-calendar3', 'g', ST.J.length, 'Pertemuan', '<span class="mute">' + ST.done.length + ' terlaksana</span>') +
    statCard('Sedang / Terdekat', 'bi-alarm', 'y', live ? fmtTgl(live.Tanggal, true) : '—', '', live ? '<span class="mute">Sesi ke-' + ST.noOf[live.ID] + '</span>' : '') +
    statCard('Mendatang', 'bi-hourglass-split', 'b', ST.J.filter(j => j.Status !== 'Selesai').length, 'Sesi', '') +
    statCard('Kehadiran Rata-rata', 'bi-graph-up', 'g', fmtPct(avgAll()), '', '<span class="mute">Target ≥' + ST.config.Target + '%</span>') + '</div>' +
    '<div class="card card-p" style="margin:1rem 0"><div class="filters f2"><div class="input-ic"><i class="bi bi-search"></i><input class="input" id="jdQ" placeholder="Cari tema, pemateri, lokasi…" value="' + esc(ST.jd.q) + '"></div><select class="select" id="jdSt"><option value="">Semua Status</option>' + ['Terjadwal', 'Berlangsung', 'Selesai'].map(s => '<option ' + (ST.jd.st === s ? 'selected' : '') + '>' + s + '</option>').join('') + '</select></div></div>' +
    '<div class="grid g2">' + (list.length ? list.map(j => {
      const c = sessCounts(j), isLive = j.Status === 'Berlangsung', isNext = live && live.ID === j.ID && !isLive;
      return '<div class="card ses hov ' + (isLive ? 'live' : isNext ? 'next' : '') + '"><div class="ses-top"><div class="ses-no"><small>SESI</small><b>' + ST.noOf[j.ID] + '</b></div><div style="flex:1;min-width:0"><div style="display:flex;justify-content:space-between;gap:.5rem;flex-wrap:wrap">' + statusChipJ(j) + '<span class="mono mute">' + fmtTgl(j.Tanggal) + '</span></div><h4 style="margin-top:.375rem">' + esc(j.Tema) + '</h4></div></div>' +
        '<div class="ses-meta"><span><i class="bi bi-clock"></i>' + esc(j.Mulai) + (j.Selesai ? '–' + esc(j.Selesai) : '') + ' WIB</span>' + (j.Tempat ? '<span><i class="bi bi-geo-alt"></i>' + esc(j.Tempat) + '</span>' : '') + (j.Pemateri ? '<span><i class="bi bi-person"></i>' + esc(j.Pemateri) + '</span>' : '') + '<span><i class="bi bi-tag"></i>' + esc(j.Kategori) + '</span></div>' +
        (j.Status === 'Selesai' || c.h + c.i + c.s ? '<div><div class="bar" style="margin-bottom:.375rem"><i style="width:' + (c.n ? c.h / c.n * 100 : 0) + '%"></i></div><div class="mini"><span class="chip c-H nodot">H ' + c.h + '</span><span class="chip c-I nodot">I ' + c.i + '</span><span class="chip c-S nodot">S ' + c.s + '</span><span class="chip c-A nodot">A ' + c.a + '</span><span class="mute">' + fmtPct(c.n ? c.h / c.n * 100 : 0) + '</span></div></div>' : '') +
        '<div class="ses-bot"><div style="display:flex;gap:.375rem;flex-wrap:wrap">' + '<button class="btn btn-2 btn-sm" data-act="printPres" data-id="' + j.ID + '"><i class="bi bi-printer"></i> Cetak Absensi</button>' + (j.Status !== 'Selesai' && canScan() ? '<button class="btn btn-pri btn-sm" data-act="openScan" data-id="' + j.ID + '"><i class="bi bi-upc-scan"></i> Buka Terminal Scan</button>' : '<button class="btn btn-2 btn-sm" data-act="viewPresensi" data-id="' + j.ID + '"><i class="bi bi-eye"></i> Lihat Presensi</button>' + (j.Status === 'Selesai' && canScan() ? '<button class="btn btn-2 btn-sm" data-act="statusJadwal" data-id="' + j.ID + '" data-s="Berlangsung"><i class="bi bi-unlock"></i> Buka Kembali</button>' : '')) + '</div>' +
        '<div style="display:flex;gap:.25rem">' + (canScan() ? '<button class="btn btn-ghost btn-sm btn-ic" data-act="editJadwal" data-id="' + j.ID + '" aria-label="Ubah"><i class="bi bi-pencil"></i></button>' : '') + (master ? '<button class="btn btn-ghost btn-sm btn-ic" data-act="delJadwal" data-id="' + j.ID + '" aria-label="Hapus"><i class="bi bi-trash"></i></button>' : '') + '</div></div></div>';
    }).join('') : '<div class="card card-p empty" style="grid-column:1/-1"><i class="bi bi-calendar-x"></i>Belum ada jadwal. Klik “Tambah Jadwal”.</div>') + '</div>';
  $('#jdQ').oninput = debounce(e => { ST.jd.q = e.target.value; RENDER.jadwal(); const i = $('#jdQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 200);
  $('#jdSt').onchange = e => { ST.jd.st = e.target.value; RENDER.jadwal(); };
};
function jadwalForm(id) {
  const j = id ? ST.jById[id] : null, v = k => esc(j ? j[k] || '' : '');
  const nextSun = (() => { const d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7)); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); })();
  openModal('<div class="modal-h"><h3>' + (j ? 'Ubah Jadwal Kajian' : 'Tambah Jadwal Kajian') + '</h3><button class="btn btn-ghost btn-ic btn-sm" data-act="modalClose" aria-label="Tutup"><i class="bi bi-x-lg"></i></button></div>' +
    '<form id="fJd" novalidate><div class="modal-b">' +
    '<div class="fld"><label for="jTema">Judul / tema kajian *</label><input class="input" id="jTema" value="' + v('Tema') + '" maxlength="140" required></div>' +
    '<div class="row c2"><div class="fld"><label for="jTgl">Tanggal *</label><input class="input" id="jTgl" type="date" value="' + (j ? j.Tanggal : nextSun) + '" required></div><div class="fld"><label for="jKat">Kategori</label><input class="input" id="jKat" list="dlKat" value="' + (j ? v('Kategori') : 'Kajian Rutin Ahad Pagi') + '" maxlength="60"><datalist id="dlKat">' + uniq(ST.J, 'Kategori').map(x => '<option value="' + esc(x) + '">').join('') + '</datalist></div></div>' +
    '<div class="row c2"><div class="fld"><label for="jMul">Mulai *</label><input class="input" id="jMul" type="time" value="' + (j ? j.Mulai : '06:00') + '" required></div><div class="fld"><label for="jSel">Selesai</label><input class="input" id="jSel" type="time" value="' + (j ? j.Selesai : '08:30') + '"></div></div>' +
    '<div class="row c2"><div class="fld"><label for="jTmp">Lokasi</label><input class="input" id="jTmp" value="' + (j ? v('Tempat') : 'Aula Utama') + '" maxlength="100"></div><div class="fld"><label for="jPem">Pemateri</label><input class="input" id="jPem" list="dlPem" value="' + v('Pemateri') + '" maxlength="80"><datalist id="dlPem">' + uniq(ST.J, 'Pemateri').map(x => '<option value="' + esc(x) + '">').join('') + '</datalist></div></div>' +
    (j ? '<div class="fld"><label for="jSt">Status</label><select class="select" id="jSt">' + ['Terjadwal', 'Berlangsung', 'Selesai'].map(s => '<option ' + (j.Status === s ? 'selected' : '') + '>' + s + '</option>').join('') + '</select></div>' : '') +
    '<div class="err" id="fErr" role="alert"></div></div><div class="modal-f"><button type="button" class="btn btn-2" data-act="modalClose">Batal</button><button type="submit" class="btn btn-pri"><i class="bi bi-check2"></i> Simpan &amp; Jadwalkan</button></div></form>',
    box => {
      $('#fJd', box).onsubmit = ev => {
        ev.preventDefault();
        const rec = { ID: j ? j.ID : '', Tema: $('#jTema').value.trim(), Tanggal: $('#jTgl').value, Mulai: $('#jMul').value, Selesai: $('#jSel').value, Tempat: $('#jTmp').value.trim(), Pemateri: $('#jPem').value.trim(), Kategori: $('#jKat').value.trim(), Status: j ? $('#jSt').value : 'Terjadwal' };
        if (!rec.Tema || !rec.Tanggal || !rec.Mulai) { $('#fErr').textContent = 'Tema, tanggal, dan jam mulai wajib diisi.'; return; }
        saveJadwal(rec);
      };
    });
}
async function saveJadwal(rec) {
  const isNew = !rec.ID; let local, prev = null;
  if (isNew) { local = Object.assign({}, rec, { ID: uid() }); ST.J.push(local); } else { local = ST.jById[rec.ID]; prev = Object.assign({}, local); Object.assign(local, rec); }
  index(); closeModal(); RENDER[ST.page === 'scan' ? 'scan' : 'jadwal'](); toast(isNew ? 'Jadwal ditambahkan.' : 'Jadwal diperbarui.');
  try { const r = await call('jadwal.save', { rec: local }); Object.assign(local, r.rec); index(); if (ST.page === 'jadwal') RENDER.jadwal(); }
  catch (e) { if (isNew) ST.J = ST.J.filter(x => x.ID !== local.ID); else Object.assign(local, prev); index(); RENDER[ST.page] && RENDER[ST.page](); toast('Gagal menyimpan: ' + e.message, 'err'); }
}
async function setStatusJadwal(id, status, quiet) {
  const j = ST.jById[id]; if (!j) return; const prev = j.Status; j.Status = status; index();
  if (ST.page === 'jadwal') RENDER.jadwal(); else if (ST.page === 'scan') rScanLive(); else if (ST.page === 'dashboard') RENDER.dashboard();
  try { await call('jadwal.status', { id, status }); if (!quiet) toast('Status sesi: ' + status); }
  catch (e) { j.Status = prev; index(); RENDER[ST.page](); toast('Gagal mengubah status: ' + e.message, 'err'); }
}
async function delJadwal(id) {
  const j = ST.jById[id]; if (!j) return;
  if (!await confirmBox('Hapus jadwal?', 'Jadwal <b>' + esc(j.Tema) + '</b> beserta seluruh catatan kehadirannya akan dihapus permanen.', 'Hapus', true)) return;
  const bj = ST.J.slice(), bk = ST.K.slice(); ST.J = ST.J.filter(x => x.ID !== id); ST.K = ST.K.filter(k => k.JadwalID !== id); index(); RENDER.jadwal();
  try { await call('jadwal.delete', { id }); toast('Jadwal dihapus.'); } catch (e) { ST.J = bj; ST.K = bk; index(); RENDER.jadwal(); toast(e.message, 'err'); }
}
function viewPresensi(id) {
  const j = ST.jById[id]; if (!j) return;
  const g = { Hadir: [], Izin: [], Sakit: [], Alpa: [] };
  ST.act.forEach(p => { const k = ST.kMap[id + '|' + p.ID]; g[k ? k.Status : 'Alpa'].push({ p, k }); });
  openModal('<div class="modal-h"><h3>Presensi Sesi ' + ST.noOf[id] + '</h3><button class="btn btn-ghost btn-ic btn-sm" data-act="modalClose" aria-label="Tutup"><i class="bi bi-x-lg"></i></button></div><div class="modal-b"><p class="ink2" style="margin-bottom:1rem"><b>' + esc(j.Tema) + '</b><br>' + fmtTgl(j.Tanggal) + '</p>' +
    Object.keys(g).map(k => '<div style="margin-bottom:1rem"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem">' + chipHTML(k) + '<span class="mono mute">' + g[k].length + ' orang</span></div>' +
      (g[k].length ? '<div style="display:flex;flex-wrap:wrap;gap:.375rem">' + g[k].map(x => '<span class="pill-btn" title="' + esc(x.k && x.k.Keterangan || '') + '">' + esc(x.p.Nama) + '</span>').join('') + '</div>' : '<div class="help">—</div>') + '</div>').join('') + '</div>');
}

/* ============================================================
   HALAMAN: SCAN BARCODE & PRESENSI
   ============================================================ */
function scanSessions() { return ST.J.filter(j => j.Status !== 'Selesai').sort(cmpJ); }
RENDER.scan = function () {
  const el = $('#page-scan'), list = scanSessions();
  if (!ST.sc.jadwalId || !ST.jById[ST.sc.jadwalId] || ST.jById[ST.sc.jadwalId].Status === 'Selesai') { const l = pickLive(); ST.sc.jadwalId = l ? l.ID : (list[0] ? list[0].ID : null); }
  if (!ST.sc.jadwalId) {
    el.innerHTML = '<div class="ph"><div><h1>Scan Barcode &amp; <em>Presensi</em></h1></div></div><div class="card card-p empty"><i class="bi bi-calendar-plus"></i>Belum ada sesi aktif. Buat jadwal pengajian terlebih dahulu.<div style="margin-top:1rem"><button class="btn btn-pri" data-go="jadwal"><i class="bi bi-calendar-plus"></i> Kelola Jadwal</button></div></div>'; return;
  }
  el.innerHTML =
    '<div class="card card-p" id="scHead" style="margin-bottom:1rem"></div>' +
    '<div class="grid g-s1" id="scMain">' +
    '<div class="card card-p"><div class="card-h"><div><h3><i class="bi bi-upc-scan" style="color:var(--pri)"></i> Terminal Pemindai</h3><p>Kamera ponsel atau scanner USB/Bluetooth (Code-128)</p></div><div style="display:flex;gap:.375rem"><button class="btn btn-2 btn-sm btn-ic" data-act="scanSound" aria-label="Suara" id="scSndBtn"><i class="bi bi-volume-up"></i></button></div></div>' +
    '<div class="vf" id="scVf"><div id="camReader" style="position:absolute;inset:0"></div><i class="corner tl"></i><i class="corner tr2"></i><i class="corner bl"></i><i class="corner br"></i><i class="laser"></i><div class="vf-msg" id="scVfMsg"><i class="bi bi-camera-video"></i><div style="margin-bottom:.75rem">Kamera belum aktif</div><button class="btn btn-pri btn-sm" data-act="scanStart"><i class="bi bi-camera-video"></i> Aktifkan Kamera</button></div></div>' +
    '<div class="help" style="margin:.5rem 0 1rem">Arahkan kartu ID tegak lurus, jarak 10–15 cm. Setelah berbunyi “beep”, kehadiran langsung tercatat.</div>' +
    '<div class="fld" style="margin-bottom:0"><label for="scIn"><i class="bi bi-keyboard"></i> Mode scanner fisik / ketik kode</label><div style="display:flex;gap:.5rem"><input class="input mono" id="scIn" placeholder="Scan barcode atau ketik KTP-BS001 lalu Enter" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="done"><button class="btn btn-pri" data-act="scanSubmit"><i class="bi bi-check2"></i><span class="sr">Proses</span></button></div></div></div>' +
    '<div style="display:flex;flex-direction:column;gap:1rem"><div class="res" id="scRes"></div><div class="card card-p" id="scCount"></div><div class="card card-p" id="scPdp"></div></div></div>' +
    '<div class="grid g-s2" style="margin-top:1rem">' +
    '<div class="card card-p"><div class="card-h"><div><h3>Presensi Manual &amp; Keterangan</h3><p>Untuk kartu tertinggal, rusak, atau izin/sakit</p></div></div>' +
    '<form id="mnForm" novalidate><div class="fld"><label for="mnP">Cari nama / kode pengurus *</label><input class="input" id="mnP" list="dlMn" placeholder="Ketik minimal 2 huruf…" autocomplete="off"><datalist id="dlMn"></datalist></div>' +
    '<div class="fld"><span class="lbl">Status kehadiran</span><div class="seg"><label><input type="radio" name="mnS" value="Hadir" checked><span class="H">Hadir</span></label><label><input type="radio" name="mnS" value="Izin"><span class="I">Izin</span></label><label><input type="radio" name="mnS" value="Sakit"><span class="S">Sakit</span></label><label><input type="radio" name="mnS" value="Alpa"><span class="A">Alpa</span></label></div></div>' +
    '<div class="fld"><label for="mnK">Keterangan (opsional)</label><textarea class="textarea" id="mnK" maxlength="200" style="min-height:4rem" placeholder="Contoh: ID card tertinggal di rumah"></textarea></div>' +
    '<div class="err" id="mnErr" role="alert"></div><button class="btn btn-pri btn-block" type="submit"><i class="bi bi-cloud-check"></i> Simpan Manual &amp; Sinkron</button></form></div>' +
    '<div class="card card-p"><div class="card-h"><div><h3>Live Log Presensi Sesi Ini</h3><p>Auto-refresh · gabungan scan &amp; manual</p></div></div><div class="tbl-wrap cards"><table class="t rt" id="scLog"></table></div></div></div>';
  $('#mnForm').onsubmit = manualSubmit;
  $('#mnP').oninput = debounce(fillMn, 120);
  $('#scIn').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); scanSubmit(); } };
  $('#scSndBtn').innerHTML = '<i class="bi ' + (ST.sc.sound ? 'bi-volume-up' : 'bi-volume-mute') + '"></i>';
  rScanLive(); renderScanResult(); fillMn();
  if (matchMedia('(pointer:fine)').matches) $('#scIn').focus();
};
function fillMn() {
  const q = ($('#mnP').value || '').toLowerCase(), dl = $('#dlMn'); if (!dl) return;
  const m = ST.act.filter(p => !q || (p.Nama + ' ' + p.Kode).toLowerCase().indexOf(q) >= 0).slice(0, 12);
  dl.innerHTML = m.map(p => '<option value="' + esc(p.Nama + ' · ' + p.Kode) + '">').join('');
}
function rScanLive() {
  const j = ST.jById[ST.sc.jadwalId]; if (!j || !$('#scHead')) return;
  const c = sessCounts(j), pct = c.n ? c.h / c.n * 100 : 0, list = scanSessions();
  $('#scHead').innerHTML =
    '<div style="display:flex;flex-wrap:wrap;gap:1rem;justify-content:space-between;align-items:flex-start"><div style="min-width:0;flex:1 1 280px"><div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">' + statusChipJ(j) + '<span class="mono mute">Sesi ke-' + ST.noOf[j.ID] + '</span></div>' +
    '<h1 style="font-size:1.375rem;line-height:1.875rem;font-weight:600;letter-spacing:-.015em;margin:.375rem 0">' + esc(j.Tema) + '</h1><div class="ses-meta"><span><i class="bi bi-calendar3"></i>' + fmtTgl(j.Tanggal) + '</span><span><i class="bi bi-clock"></i>' + esc(j.Mulai) + (j.Selesai ? '–' + esc(j.Selesai) : '') + ' WIB</span>' + (j.Tempat ? '<span><i class="bi bi-geo-alt"></i>' + esc(j.Tempat) + '</span>' : '') + '</div></div>' +
    '<div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center"><select class="select" id="scSel" style="width:auto;min-width:200px">' + list.map(x => '<option value="' + x.ID + '" ' + (x.ID === j.ID ? 'selected' : '') + '>Sesi ' + ST.noOf[x.ID] + ' · ' + fmtTgl(x.Tanggal, true) + '</option>').join('') + '</select>' +
    (j.Status === 'Terjadwal' ? '<button class="btn btn-pri" data-act="statusJadwal" data-id="' + j.ID + '" data-s="Berlangsung"><i class="bi bi-play-circle"></i> Buka Sesi</button>' : '') +
    '<button class="btn btn-2" data-act="printPres" data-id="' + j.ID + '"><i class="bi bi-printer"></i> Cetak Absensi</button><button class="btn btn-danger" data-act="closeSesi" data-id="' + j.ID + '"><i class="bi bi-lock"></i> Tutup Sesi</button></div></div>' +
    '<div class="prog" style="margin-top:1rem"><div><span class="mono" style="font-size:1.5rem;font-weight:600">' + fmtPct(pct) + '</span> <span class="help">progres hadir</span></div><div class="bar"><i style="width:' + pct + '%"></i></div><span class="chip c-H">Hadir ' + c.h + '</span><span class="chip c-I">Izin ' + c.i + '</span><span class="chip c-S">Sakit ' + c.s + '</span><span class="chip c-N">Menunggu ' + c.wait + '</span></div>';
  $('#scSel').onchange = e => { ST.sc.jadwalId = e.target.value; ST.sc.last = null; ST.sc.bad = []; rScanLive(); renderScanResult(); };
  $('#scCount').innerHTML = '<div class="card-h" style="margin-bottom:.5rem"><div><h3>Ringkasan Sesi</h3><p>' + c.n + ' pengurus aktif</p></div></div><div class="dist"><div><b>' + c.h + '</b>Hadir</div><div><b style="color:var(--gold-d)">' + c.i + '</b>Izin</div><div><b style="color:var(--blue-d)">' + c.s + '</b>Sakit</div><div><b style="color:var(--rose-d)">' + c.wait + '</b>Belum hadir</div></div><div class="help" style="margin-top:.75rem"><i class="bi bi-info-circle"></i> Saat sesi ditutup, pengurus tanpa catatan dihitung <b>Alpa</b> di laporan.</div>';
  const pd = ST.D.filter(d => d.JadwalID === j.ID).sort((a, b) => String(b.Waktu).localeCompare(String(a.Waktu)));
  $('#scPdp').innerHTML = '<div class="card-h" style="margin-bottom:.5rem"><div><h3><i class="bi bi-person-raised-hand" style="color:var(--gold-d)"></i> Pendamping Hadir</h3><p>' + pd.length + ' orang · kartu PDP-…</p></div></div>' +
    (pd.length ? '<div class="bim-l">' + pd.map(d => '<div class="bim-i"><div style="min-width:0"><b>' + esc(d.Nama) + '</b>' + (d._pending ? ' <i class="bi bi-cloud-arrow-up mute"></i>' : '') + '<small class="mute" style="display:block">' + [d.Dapukan, d.Kelompok, d.Desa].filter(Boolean).map(esc).join(' · ') + ' · ' + esc(String(d.Waktu).slice(11, 16)) + '</small></div><button class="btn btn-ghost btn-sm btn-ic" data-act="pdpDel" data-id="' + d.ID + '" aria-label="Hapus"><i class="bi bi-trash"></i></button></div>').join('') + '</div>' : '<div class="help">Belum ada. Pindai kartu pendamping (PDP-001, …) untuk mengisi datanya.</div>');
  // Live log
  const rows = ST.K.filter(k => k.JadwalID === j.ID).sort((a, b) => String(b.Waktu).localeCompare(String(a.Waktu))).slice(0, 40);
  const bad = ST.sc.bad.map(b => '<tr style="background:var(--rose-t)"><td class="first mono" data-l="Waktu">' + esc(b.t) + '</td><td data-l="Pengurus"><b style="color:var(--rose-d)"><i class="bi bi-exclamation-triangle"></i> Tidak dikenal</b></td><td data-l="Kode" class="mono">' + esc(b.code) + '</td><td data-l="Status"><span class="chip c-A">Invalid</span></td><td data-l="Metode" class="mono">Scan</td><td></td></tr>').join('');
  $('#scLog').innerHTML = '<thead><tr><th>Waktu</th><th>Pengurus</th><th>Kode</th><th>Status</th><th>Metode</th><th></th></tr></thead><tbody>' + bad +
    (rows.length ? rows.map(k => { const p = ST.pById[k.PengurusID] || {}; return '<tr><td class="first mono" data-l="Waktu">' + esc(String(k.Waktu).slice(11, 19)) + (k._pending ? ' <i class="bi bi-cloud-arrow-up mute" title="Menunggu sinkron"></i>' : '') + '</td><td data-l="Pengurus"><div class="who" style="justify-content:flex-end">' + avatarHTML(p) + '<div style="text-align:left"><b>' + esc(p.Nama || '—') + '</b><small>' + esc(p.Dapukan || '') + '</small></div></div></td><td data-l="Kode" class="mono">' + esc(p.Kode || '') + '</td><td data-l="Status">' + chipHTML(k.Status) + '</td><td data-l="Metode" class="mono">' + esc(k.Metode) + '</td><td><button class="btn btn-ghost btn-sm btn-ic" data-act="scanUndo" data-id="' + esc(k.PengurusID) + '" aria-label="Batalkan"><i class="bi bi-arrow-counterclockwise"></i></button></td></tr>'; }).join('') : (bad ? '' : '<tr><td colspan="6"><div class="empty"><i class="bi bi-hourglass-split"></i>Menunggu scan barcode pengurus…</div></td></tr>')) + '</tbody>';
}
function renderScanResult() {
  const el = $('#scRes'); if (!el) return; const r = ST.sc.last;
  if (!r) { el.className = 'res'; el.innerHTML = '<div class="res-h" style="color:var(--ink2)"><i class="bi bi-upc-scan"></i> Siap memindai</div><div class="help" style="margin-top:.25rem">Hasil pemindaian terakhir tampil di sini.</div>'; return; }
  const p = r.p; el.className = 'res ' + r.type;
  const title = { ok: 'SCAN PRESENSI BERHASIL', dup: 'SUDAH TERCATAT HADIR', bad: 'KARTU TIDAK TERDAFTAR / RUSAK' }[r.type], ic = { ok: 'bi-check-circle-fill', dup: 'bi-exclamation-triangle-fill', bad: 'bi-x-octagon-fill' }[r.type];
  el.innerHTML = '<div class="res-h"><i class="bi ' + ic + '"></i> ' + title + '<span class="mono" style="margin-left:auto;font-weight:500">' + esc(r.time) + '</span></div>' +
    (p ? '<div class="res-b">' + avatarHTML(p, 'big-av') + '<div style="min-width:0"><div class="mono mute">' + esc(p.Kode) + '</div><b style="font-size:1.0625rem;line-height:1.4rem;display:block">' + esc(p.Nama) + '</b><span class="ink2" style="font-size:.8125rem">' + esc(p.Dapukan) + ' · Kelompok ' + esc(p.Kelompok) + '</span></div></div>' + (r.type === 'dup' && r.first ? '<div class="help" style="margin-top:.5rem">Tercatat pertama pukul <b class="mono">' + esc(String(r.first).slice(11, 19)) + '</b>. Scan ganda ditolak.</div>' : '') :
      '<div style="margin-top:.5rem"><div class="mono" style="color:var(--rose-d);font-weight:600;word-break:break-all">' + esc(r.code) + '</div><div class="help" style="margin-top:.25rem">' + esc(r.msg || 'Kode tidak cocok dengan data pengurus aktif. Bersihkan kartu atau gunakan presensi manual.') + '</div></div>');
}
/* Bunyi umpan balik (WebAudio, tanpa berkas) */
let AC = null;
function beep(kind) {
  if (!ST.sc.sound) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const seq = kind === 'ok' ? [[880, 0, .12]] : kind === 'dup' ? [[520, 0, .1], [520, .16, .1]] : [[220, 0, .12], [220, .18, .12], [220, .36, .12]];
    seq.forEach(s => { const o = AC.createOscillator(), g = AC.createGain(); o.frequency.value = s[0]; o.type = 'sine'; g.gain.value = .15; o.connect(g); g.connect(AC.destination); o.start(AC.currentTime + s[1]); o.stop(AC.currentTime + s[1] + s[2]); });
    if (navigator.vibrate) navigator.vibrate(kind === 'ok' ? 40 : [60, 40, 60]);
  } catch (e) { /* audio belum diizinkan */ }
}
function scanSubmit() { const i = $('#scIn'); if (!i) return; const v = i.value; i.value = ''; if (v.trim()) doScan(v, 'Scan'); if (matchMedia('(pointer:fine)').matches) i.focus(); }
/* INTI: scan optimistik — UI langsung, server menyusul */
function doScan(raw, metode) {
  const code = String(raw).trim().toUpperCase(), j = ST.jById[ST.sc.jadwalId], time = nowStr().slice(11, 19);
  if (!j) { toast('Pilih sesi terlebih dahulu.', 'warn'); return; }
  if (j.Status === 'Selesai') { toast('Sesi sudah ditutup.', 'warn'); return; }
  if (isPdpCode(code) && !ST.pByKode[code]) {
    if (ST.D.some(d => d.JadwalID === j.ID && d.Kode === code)) { beep('dup'); toast('Kartu pendamping ' + code + ' sudah dipakai di sesi ini.', 'warn'); return; }
    beep('ok'); pdpScanForm(code, j); return;
  }
  const p = ST.pByKode[code];
  if (!p || p.Aktif === false) {
    ST.sc.last = { type: 'bad', code, time, msg: p ? 'Pengurus tidak aktif.' : '' }; ST.sc.bad.unshift({ t: time, code }); ST.sc.bad = ST.sc.bad.slice(0, 5);
    beep('bad'); renderScanResult(); rScanLive(); return;
  }
  const key = j.ID + '|' + p.ID, ex = ST.kMap[key];
  if (ex && ex.Status === 'Hadir') { ST.sc.last = { type: 'dup', p, time, first: ex.Waktu }; beep('dup'); renderScanResult(); return; }
  const prev = ex ? Object.assign({}, ex) : null;
  const rec = { ID: 'tmp' + uid(), JadwalID: j.ID, PengurusID: p.ID, Status: 'Hadir', Metode: metode, Keterangan: '', Waktu: nowStr(), Oleh: ST.user.username, _pending: true };
  if (ex) { Object.assign(ex, rec, { ID: ex.ID }); } else { ST.K.push(rec); }
  index(); ST.sc.last = { type: 'ok', p, time }; beep('ok'); renderScanResult(); rScanLive();
  if (j.Status === 'Terjadwal') setStatusJadwal(j.ID, 'Berlangsung', true);
  const payload = { jadwalId: j.ID, kode: code, metode };
  call('absen.scan', payload).then(r => { delete (ST.kMap[key] || {})._pending; applyServerRec(r); index(); if (ST.page === 'scan') rScanLive(); })
    .catch(e => {
      if (e.net) { enqueue('absen.scan', payload); return; }       // offline: tetap optimistik, kirim nanti
      if (e.code === 'DUP') { if (e.res && e.res.rec) applyServerRec({ rec: e.res.rec }); index(); if (ST.page === 'scan') rScanLive(); return; }
      if (prev) Object.assign(ST.kMap[key], prev); else ST.K = ST.K.filter(k => !(k.JadwalID === j.ID && k.PengurusID === p.ID));
      index(); ST.sc.last = { type: 'bad', code, time, msg: e.message }; renderScanResult(); if (ST.page === 'scan') rScanLive(); beep('bad'); toast(e.message, 'err');
    });
}
function manualSubmit(ev) {
  ev.preventDefault();
  const j = ST.jById[ST.sc.jadwalId], v = $('#mnP').value.trim(), err = $('#mnErr'); err.textContent = '';
  const m = /·\s*([A-Za-z0-9-]+)\s*$/.exec(v), code = (m ? m[1] : v).toUpperCase();
  const p = ST.pByKode[code] || ST.act.filter(x => x.Nama.toLowerCase() === v.toLowerCase())[0];
  if (!j) { err.textContent = 'Pilih sesi terlebih dahulu.'; return; }
  if (!p) { err.textContent = 'Pengurus tidak ditemukan. Pilih dari daftar saran.'; return; }
  const status = $('input[name=mnS]:checked').value, ket = $('#mnK').value.trim(), key = j.ID + '|' + p.ID, ex = ST.kMap[key], prev = ex ? Object.assign({}, ex) : null;
  const rec = { ID: 'tmp' + uid(), JadwalID: j.ID, PengurusID: p.ID, Status: status, Metode: 'Manual', Keterangan: ket, Waktu: nowStr(), Oleh: ST.user.username, _pending: true };
  if (ex) Object.assign(ex, rec, { ID: ex.ID }); else ST.K.push(rec);
  index(); rScanLive(); $('#mnP').value = ''; $('#mnK').value = ''; toast(p.Nama + ' → ' + status);
  const payload = { jadwalId: j.ID, items: [{ pengurusId: p.ID, status, keterangan: ket }] };
  call('absen.manual', payload).then(r => { delete (ST.kMap[key] || {})._pending; applyServerRec(r); index(); if (ST.page === 'scan') rScanLive(); })
    .catch(e => {
      if (e.net) { enqueue('absen.manual', payload); return; }
      if (prev) Object.assign(ST.kMap[key], prev); else ST.K = ST.K.filter(k => !(k.JadwalID === j.ID && k.PengurusID === p.ID));
      index(); if (ST.page === 'scan') rScanLive(); toast('Gagal menyimpan: ' + e.message, 'err');
    });
}
async function scanUndo(pid) {
  const jid = ST.sc.jadwalId, key = jid + '|' + pid, rec = ST.kMap[key]; if (!rec) return;
  ST.K = ST.K.filter(k => k !== rec); index(); rScanLive(); ST.sc.last = null; renderScanResult();
  try { await call('absen.undo', { jadwalId: jid, pengurusId: pid }); toast('Catatan dibatalkan.'); }
  catch (e) { if (e.net) { toast('Offline — pembatalan belum terkirim.', 'warn'); } ST.K.push(rec); index(); rScanLive(); }
}
async function closeSesi(id) {
  const j = ST.jById[id], c = sessCounts(j);
  if (!await confirmBox('Tutup sesi ini?', '<b>' + c.wait + '</b> pengurus belum tercatat dan akan dihitung <b>Alpa</b> pada laporan. Sesi bisa dibuka kembali dari menu Jadwal.', 'Tutup Sesi', true)) return;
  stopCam(); await setStatusJadwal(id, 'Selesai'); ST.sc.jadwalId = null; RENDER.scan();
}
/* Kamera: jalur utama = getUserMedia + BarcodeDetector bawaan browser (cepat, andal di Chrome Android).
   Cadangan = Html5Qrcode (dimuat malas) untuk browser tanpa BarcodeDetector. */
function camError(e) {
  const n = e && e.name || '';
  if (n === 'NotAllowedError' || n === 'PermissionDeniedError') return 'Izin kamera ditolak. Ketuk ikon gembok di bilah alamat → Izin → Kamera → Izinkan, lalu muat ulang halaman.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Kamera tidak ditemukan di perangkat ini.';
  if (n === 'NotReadableError' || n === 'AbortError') return 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi itu lalu coba lagi.';
  if (n === 'SecurityError') return 'Kamera hanya bisa dipakai lewat alamat HTTPS.';
  return (e && e.message) || 'Kamera tidak dapat dibuka.';
}
async function nativeSupported() {
  try { if (!('BarcodeDetector' in window)) return false; const f = await window.BarcodeDetector.getSupportedFormats(); return f.indexOf('code_128') >= 0; } catch (e) { return false; }
}
function onCamCode(txt) { const now = Date.now(); if (txt === ST.sc.lastCode && now - ST.sc.lastAt < 2500) return; ST.sc.lastCode = txt; ST.sc.lastAt = now; doScan(txt, 'Scan'); }
async function startCam() {
  const vf = $('#scVf'), msg = $('#scVfMsg'); if (!vf) return;
  msg.classList.remove('hide'); msg.innerHTML = '<span class="spin"></span><div style="margin-top:.5rem">Membuka kamera…</div>';
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('Browser tidak mendukung kamera atau halaman bukan HTTPS.'), { name: 'SecurityError' });
    if (await nativeSupported()) await startNativeCam(); else await startLibCam();
    ST.sc.camOn = true; vf.classList.add('run'); msg.classList.add('hide');
  } catch (e) {
    await stopCam(true); msg.classList.remove('hide'); ST.sc.camOn = false;
    msg.innerHTML = '<i class="bi bi-camera-video-off"></i><div style="margin-bottom:.5rem"><b>Kamera tidak dapat dibuka</b></div><div class="help" style="color:#94A3B8;margin-bottom:.75rem">' + esc(camError(e)) + '</div><button class="btn btn-pri btn-sm" data-act="scanStart"><i class="bi bi-arrow-repeat"></i> Coba Lagi</button>';
  }
}
async function startNativeCam() {
  const holder = $('#camReader'); holder.innerHTML = '';
  const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  const v = document.createElement('video');
  v.setAttribute('playsinline', ''); v.setAttribute('muted', ''); v.setAttribute('autoplay', ''); v.muted = true; v.playsInline = true;
  v.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000';
  holder.appendChild(v); v.srcObject = stream; ST.sc.stream = stream;
  try { await v.play(); } catch (e) { stream.getTracks().forEach(t => t.stop()); ST.sc.stream = null; throw e; }
  const det = new window.BarcodeDetector({ formats: ['code_128', 'qr_code'] }); const token = ST.sc.loop = {};
  const tick = async () => {
    if (ST.sc.loop !== token) return;
    try { if (v.readyState >= 2 && v.videoWidth) { const r = await det.detect(v); if (r && r.length && ST.sc.loop === token) onCamCode(String(r[0].rawValue || '').trim()); } } catch (e) { /* frame gagal, lanjut */ }
    if (ST.sc.loop === token) setTimeout(tick, 140);
  };
  tick();
  setTimeout(() => { if (ST.sc.loop === token && !v.videoWidth) { const m = $('#scVfMsg'); if (m) { m.classList.remove('hide'); m.innerHTML = '<i class="bi bi-camera-video-off"></i><div class="help" style="color:#94A3B8">Kamera aktif tetapi gambar kosong. Tutup aplikasi kamera lain lalu coba lagi.</div><button class="btn btn-pri btn-sm" data-act="scanStart" style="margin-top:.5rem">Coba Lagi</button>'; } } }, 2500);
}
async function startLibCam() {
  await loadScript('https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js');
  $('#camReader').innerHTML = '';
  ST.sc.cam = ST.sc.cam || new Html5Qrcode('camReader', { formatsToSupport: [Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.QR_CODE], verbose: false });
  await ST.sc.cam.start({ facingMode: 'environment' }, { fps: 12, qrbox: (w, h) => ({ width: Math.floor(w * .85), height: Math.floor(h * .4) }) }, txt => onCamCode(txt), () => {});
  $$('video', $('#camReader')).forEach(v => { v.style.cssText += ';width:100%;height:100%;object-fit:cover'; });
}
async function stopCam(quiet) {
  const c = ST.sc.cam; ST.sc.camOn = false; ST.sc.loop = null;
  if (ST.sc.stream) { try { ST.sc.stream.getTracks().forEach(t => t.stop()); } catch (e) { } ST.sc.stream = null; }
  if (c) { try { if (c.isScanning) await c.stop(); c.clear(); } catch (e) { /* abaikan */ } ST.sc.cam = null; }
  const holder = $('#camReader'); if (holder) holder.innerHTML = '';
  const vf = $('#scVf'); if (vf) vf.classList.remove('run');
  if (quiet) return;
  const msg = $('#scVfMsg'); if (msg) { msg.classList.remove('hide'); msg.innerHTML = '<i class="bi bi-camera-video"></i><div style="margin-bottom:.75rem">Kamera belum aktif</div><button class="btn btn-pri btn-sm" data-act="scanStart"><i class="bi bi-camera-video"></i> Aktifkan Kamera</button>'; }
}
/* Penyegaran berkala sesi aktif (multi-operator) */
async function pollScan() {
  if (ST.page !== 'scan' || !ST.sc.jadwalId || ST.queue.length || ST.inflight || document.hidden) return;
  const jid = ST.sc.jadwalId;
  try {
    const r = await call('absen.list', { jadwalId: jid }); if (ST.sc.jadwalId !== jid || ST.inflight) return;
    const recs = r.rows.map(row => { const o = {}; r.cols.forEach((c, i) => { o[c] = row[i]; }); return o; });
    const pend = ST.K.filter(k => k.JadwalID === jid && k._pending);
    ST.K = ST.K.filter(k => k.JadwalID !== jid).concat(recs); pend.forEach(k => { if (!ST.K.some(x => x.PengurusID === k.PengurusID && x.JadwalID === jid)) ST.K.push(k); });
    index(); rScanLive();
  } catch (e) { /* diam */ }
}

/* ============================================================
   HALAMAN: LAPORAN
   ============================================================ */
function lapData() {
  const f = ST.lap; let sess = ST.done.filter(j => (!f.from || j.Tanggal >= f.from) && (!f.to || j.Tanggal <= f.to));
  let ppl = ST.act.filter(p => (!f.kel || p.Kelompok === f.kel) && (!f.dap || p.Dapukan === f.dap));
  let rows = ppl.map(p => Object.assign({ p }, pStats(p.ID, sess)));
  if (f.lvl === 'hi') rows = rows.filter(r => r.pct >= 90); else if (f.lvl === 'mid') rows = rows.filter(r => r.pct >= 75 && r.pct < 90); else if (f.lvl === 'lo') rows = rows.filter(r => r.pct < 75);
  rows.sort((a, b) => b.pct - a.pct || a.p.Nama.localeCompare(b.p.Nama));
  return { sess, rows };
}
function lapPdp() {
  const f = ST.lap, jm = {}; ST.J.forEach(j => { jm[j.ID] = j; });
  return ST.D.filter(d => { const j = jm[d.JadwalID]; return j && (!f.from || j.Tanggal >= f.from) && (!f.to || j.Tanggal <= f.to) && (!f.kel || d.Kelompok === f.kel); })
    .map(d => ({ d, j: jm[d.JadwalID] })).sort((a, b) => a.j.Tanggal.localeCompare(b.j.Tanggal) || String(a.d.Waktu).localeCompare(String(b.d.Waktu)));
}
RENDER.laporan = function () {
  const el = $('#page-laporan'), kel = uniq(ST.P, 'Kelompok'), dap = uniq(ST.P, 'Dapukan'), f = ST.lap;
  el.innerHTML =
    '<div class="ph"><div><span class="tag"><i class="bi bi-bar-chart-line"></i> Siklus laporan aktif</span><h1 style="margin-top:.5rem">Laporan &amp; <em>Rekapitulasi Presensi</em></h1><p>Statistik kehadiran, persentase per pengurus &amp; dapukan, ekspor Excel dan PDF.</p></div>' +
    '<div class="acts"><button class="btn btn-2" data-act="lapExcel"><i class="bi bi-file-earmark-excel"></i> Unduh Excel (.xlsx)</button><button class="btn btn-pri" data-act="lapPrint"><i class="bi bi-file-earmark-pdf"></i> Cetak / PDF</button></div></div>' +
    '<div class="card card-p" style="margin-bottom:1rem"><div class="lbl" style="margin-bottom:.625rem"><i class="bi bi-funnel"></i> Filter multivariabel</div><div class="filters f5">' +
    '<div class="fld" style="margin:0"><label>Dari tanggal</label><input class="input" type="date" id="lfFrom" value="' + f.from + '"></div><div class="fld" style="margin:0"><label>Sampai tanggal</label><input class="input" type="date" id="lfTo" value="' + f.to + '"></div>' +
    '<div class="fld" style="margin:0"><label>Kelompok</label><select class="select" id="lfKel"><option value="">Semua</option>' + kel.map(x => '<option ' + (f.kel === x ? 'selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></div>' +
    '<div class="fld" style="margin:0"><label>Dapukan</label><select class="select" id="lfDap"><option value="">Semua</option>' + dap.map(x => '<option ' + (f.dap === x ? 'selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></div>' +
    '<div class="fld" style="margin:0"><label>Tingkat kehadiran</label><select class="select" id="lfLvl"><option value="">Semua</option><option value="hi" ' + (f.lvl === 'hi' ? 'selected' : '') + '>≥ 90%</option><option value="mid" ' + (f.lvl === 'mid' ? 'selected' : '') + '>75–89%</option><option value="lo" ' + (f.lvl === 'lo' ? 'selected' : '') + '>&lt; 75%</option></select></div></div></div>' +
    '<div id="lapBody"></div>';
  ['lfFrom', 'lfTo', 'lfKel', 'lfDap', 'lfLvl'].forEach(id => { $('#' + id).onchange = () => { ST.lap = { from: $('#lfFrom').value, to: $('#lfTo').value, kel: $('#lfKel').value, dap: $('#lfDap').value, lvl: $('#lfLvl').value }; rLapBody(); }; });
  rLapBody();
};
function rLapBody() {
  const { sess, rows } = lapData(), tgt = ST.config.Target, last = sess.slice(-12), body = $('#lapBody');
  const avg = mean(rows.map(r => r.pct)), full = rows.filter(r => r.n && r.h === r.n).length, low = rows.filter(r => r.n && r.pct < 75);
  const tot = rows.reduce((a, r) => ({ h: a.h + r.h, i: a.i + r.i, s: a.s + r.s, a: a.a + r.a }), { h: 0, i: 0, s: 0, a: 0 });
  const by = (k) => { const m = {}; rows.forEach(r => { (m[r.p[k]] = m[r.p[k]] || []).push(r.pct); }); return Object.keys(m).map(x => ({ n: x, v: mean(m[x]) })).sort((a, b) => b.v - a.v); };
  const bk = by('Kelompok'), bd = by('Dapukan');
  body.innerHTML =
    '<div class="grid g4">' + statCard('Total Dilaksanakan', 'bi-calendar-check', 'g', sess.length, 'Pertemuan', '<span class="mute">pada rentang terpilih</span>') +
    statCard('Rata-rata Kumulatif', 'bi-graph-up-arrow', 'g', fmtPct(avg), '', '<span class="chip ' + (avg >= tgt ? 'c-H' : 'c-I') + '">' + (avg >= tgt ? 'Di atas target' : 'Di bawah target') + '</span>') +
    statCard('Presensi 100%', 'bi-award', 'y', full, 'Pengurus', '<span class="mute">Istiqomah — tanpa absen</span>') +
    statCard('Perlu Perhatian', 'bi-exclamation-triangle', 'r', low.length, 'Pengurus', '<span class="mute">Kehadiran &lt; 75% · ketuk untuk lihat &amp; tindak lanjuti</span>').replace('class="card stat hov"', 'class="card stat hov" role="button" tabindex="0" data-act="lapLow" style="cursor:pointer"') + '</div>' +
    '<div class="card card-p" style="margin-top:1rem"><div class="card-h"><div><h3>Matriks Presensi Per Sesi <span class="tag" style="margin-left:.375rem">' + last.length + ' sesi terakhir</span></h3><p>Persentase = Hadir ÷ total sesi yang sudah ada presensi pada rentang (' + sess.length + ' sesi). Alpa = tanpa catatan.</p></div><div class="legend"><span><i style="background:var(--pri)"></i>H</span><span><i style="background:var(--gold)"></i>I</span><span><i style="background:var(--blue)"></i>S</span><span><i style="background:var(--rose)"></i>A</span></div></div>' +
    '<div class="tbl-wrap"><table class="t mx"><thead><tr><th>No</th><th>Pengurus</th><th>Dapukan</th><th>Kelompok</th>' + last.map(j => '<th class="s" title="' + esc(fmtTgl(j.Tanggal)) + '">' + ST.noOf[j.ID] + '</th>').join('') + '<th class="tc">H</th><th class="tc">I</th><th class="tc">S</th><th class="tc">A</th><th style="min-width:130px">Persen</th></tr></thead><tbody>' +
    (rows.length ? rows.map((r, i) => {
      const cls = r.pct >= 90 ? '' : r.pct >= 75 ? 'y' : 'r';
      return '<tr><td class="mono mute">' + pad(i + 1) + '</td><td><div class="who">' + avatarHTML(r.p) + '<div><b>' + esc(r.p.Nama) + '</b><small class="mono">' + esc(r.p.Kode) + '</small></div></div></td><td>' + esc(r.p.Dapukan) + '</td><td>' + esc(r.p.Kelompok) + '</td>' +
        last.map(j => { const k = ST.kMap[j.ID + '|' + r.p.ID], st = k ? k.Status : 'Alpa', L = stLetter(st); return '<td class="s"><span class="dotc c-' + L + '">' + L + '</span></td>'; }).join('') +
        '<td class="num">' + r.h + '</td><td class="num">' + r.i + '</td><td class="num">' + r.s + '</td><td class="num">' + r.a + '</td><td><div style="display:flex;align-items:center;gap:.5rem"><div class="bar ' + cls + '" style="flex:1"><i style="width:' + r.pct + '%"></i></div><b class="mono">' + fmtPct(r.pct) + '</b></div></td></tr>';
    }).join('') : '<tr><td colspan="' + (9 + last.length) + '"><div class="empty"><i class="bi bi-inbox"></i>Tidak ada data pada filter ini.</div></td></tr>') + '</tbody></table></div></div>' +
    (function () {
      const pd = lapPdp();
      return '<div class="card card-p" style="margin-top:1rem"><div class="card-h"><div><h3><i class="bi bi-person-raised-hand" style="color:var(--gold-d)"></i> Pendamping Hadir <span class="tag" style="margin-left:.375rem">' + pd.length + ' orang</span></h3><p>Tamu / pendamping yang hadir pada sesi di rentang terpilih (tidak dihitung dalam persentase pengurus).</p></div></div>' +
        '<div class="tbl-wrap"><table class="t"><thead><tr><th>No</th><th>Tanggal</th><th>Sesi</th><th>Nama</th><th>Kelompok</th><th>Desa</th><th>Dapukan</th><th>Jam</th></tr></thead><tbody>' +
        (pd.length ? pd.map((x, i) => '<tr><td class="mono mute">' + pad(i + 1) + '</td><td>' + esc(fmtTgl(x.j.Tanggal)) + '</td><td>' + esc(x.j.Tema) + '</td><td><b>' + esc(x.d.Nama) + '</b></td><td>' + esc(x.d.Kelompok) + '</td><td>' + esc(x.d.Desa) + '</td><td>' + esc(x.d.Dapukan) + '</td><td class="mono">' + esc(String(x.d.Waktu).slice(11, 16)) + '</td></tr>').join('') : '<tr><td colspan="8"><div class="empty"><i class="bi bi-inbox"></i>Belum ada pendamping tercatat pada rentang ini.</div></td></tr>') + '</tbody></table></div></div>';
    })() +
    '<div class="grid g-8-4" style="margin-top:1rem"><div class="card card-p"><div class="card-h"><div><h3>Peringkat Presensi Antar Kelompok</h3><p>Rata-rata persentase kehadiran per kelompok · target ' + tgt + '%</p></div></div><div class="rank">' +
    (bk.length ? bk.map((x, i) => '<div class="rank-i"><div class="t"><span>' + esc(x.n) + (i === 0 ? ' <span class="chip c-H nodot" style="margin-left:.375rem">Terdisiplin #1</span>' : '') + '</span><span class="mono">' + fmtPct(x.v) + '</span></div><div class="bar ' + (x.v >= tgt ? '' : 'y') + '"><i style="width:' + x.v + '%"></i></div></div>').join('') : '<div class="empty">Tidak ada data.</div>') + '</div>' +
    '<div class="lbl" style="margin:1.25rem 0 .5rem">Distribusi kehadiran menurut dapukan</div><div class="dist">' + bd.slice(0, 6).map(x => '<div><b>' + fmtPct(x.v) + '</b>' + esc(x.n) + '</div>').join('') + '</div></div>' +
    '<div style="display:flex;flex-direction:column;gap:1rem"><div class="card card-p"><div class="card-h"><div><h3>Komposisi Kehadiran</h3><p>Seluruh pengurus pada filter</p></div></div><div class="chart-box" style="height:190px"><canvas id="chLap"></canvas></div></div>' +
    '<div class="card card-p"><div class="card-h"><div><h3>Rekomendasi Tindak Lanjut</h3><p>Disusun otomatis dari pola kehadiran</p></div></div>' +
    '<div class="reco"><b><i class="bi bi-award" style="color:var(--gold)"></i> Apresiasi ' + full + ' pengurus istiqomah</b><p>Hadir pada seluruh sesi terlaksana. Pertimbangkan sertifikat penghargaan.</p></div>' +
    '<div class="reco"><b><i class="bi bi-heart-pulse" style="color:var(--rose)"></i> Pendampingan ' + low.length + ' pengurus (&lt;75%)</b><p>' + (low.length ? esc(low.slice(0, 4).map(r => r.p.Nama).join(', ')) + (low.length > 4 ? ' dan ' + (low.length - 4) + ' lainnya' : '') + '. Jadwalkan silaturahmi untuk mengetahui kendala.' : 'Tidak ada pengurus di bawah ambang batas. Alhamdulillah.') + '</p></div></div></div></div>';
  mkChart('chLap', { type: 'doughnut', data: { labels: ['Hadir', 'Izin', 'Sakit', 'Alpa'], datasets: [{ data: [tot.h, tot.i, tot.s, tot.a], backgroundColor: [cssv('--pri'), cssv('--gold'), cssv('--blue'), cssv('--rose')], borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right', labels: { boxWidth: 10, usePointStyle: true } } } } });
}
function waLink(p, msg) { let n = String(p.NoHP || '').replace(/\D/g, ''); if (!n) return ''; if (n[0] === '0') n = '62' + n.slice(1); return 'https://wa.me/' + n + '?text=' + encodeURIComponent(msg); }
function lapLow() {
  const { rows } = lapData(), low = rows.filter(r => r.n && r.pct < 75).sort((a, b) => a.pct - b.pct);
  const canBim = isMaster() || ST.user.peran === 'pembina';
  openModal('<div class="modal-h"><h3>Perlu Perhatian (' + low.length + ')</h3><button class="btn btn-ghost btn-ic btn-sm" data-act="modalClose" aria-label="Tutup"><i class="bi bi-x-lg"></i></button></div><div class="modal-b">' +
    '<p class="ink2" style="margin-bottom:1rem">Pengurus dengan kehadiran di bawah 75% pada rentang laporan. Ketuk <b>WhatsApp</b> untuk mengirim pengingat' + (canBim ? ' atau <b>Bimbingan</b> untuk mencatat pesan pembinaan' : '') + '.</p>' +
    (low.length ? '<div class="bim-l">' + low.map(x => { const p = x.p, wa = waLink(p, BIM_TPL['Pengingat'].replace('{nama}', p.Nama).replace('{pct}', fmtPct(x.pct))); return '<div class="bim-i" style="align-items:flex-start;gap:.75rem"><div class="who" style="min-width:0;flex:1">' + avatarHTML(p) + '<div style="min-width:0"><b>' + esc(p.Nama) + '</b><small class="mute" style="display:block">' + esc(p.Dapukan) + ' · ' + esc(p.Kelompok) + (p.Desa ? ' · ' + esc(p.Desa) : '') + '</small><small style="display:block">H ' + x.h + ' · I ' + x.i + ' · S ' + x.s + ' · A ' + x.a + ' · <b style="color:var(--rose-d)">' + fmtPct(x.pct) + '</b></small><small class="mute" style="display:block">' + (p.NoHP ? esc(p.NoHP) : 'tanpa No. HP') + '</small></div></div><div style="display:flex;flex-direction:column;gap:.375rem">' +
      (wa ? '<a class="btn btn-gold btn-sm" href="' + wa + '" target="_blank" rel="noopener" data-nopd="1"><i class="bi bi-whatsapp"></i> WhatsApp</a>' : '') +
      (canBim ? '<button class="btn btn-pri btn-sm" data-act="bimbinganFor" data-id="' + p.ID + '"><i class="bi bi-chat-heart"></i> Bimbingan</button>' : '') + '</div></div>'; }).join('') + '</div>' : '<div class="empty"><i class="bi bi-emoji-smile"></i>Tidak ada pengurus di bawah 75%. Alhamdulillah.</div>') + '</div>' +
    '<div class="modal-f"><button type="button" class="btn btn-2" data-act="modalClose">Tutup</button></div>');
}
function lapExport() {
  const { sess, rows } = lapData();
  const head = ['No', 'Kode', 'Nama', 'Kelompok', 'Dapukan'].concat(sess.map(j => 'S' + ST.noOf[j.ID] + ' ' + j.Tanggal)).concat(['Hadir', 'Izin', 'Sakit', 'Alpa', 'Persentase (%)']);
  const data = rows.map((r, i) => [i + 1, r.p.Kode, r.p.Nama, r.p.Kelompok, r.p.Dapukan].concat(sess.map(j => { const k = ST.kMap[j.ID + '|' + r.p.ID]; return k ? k.Status : 'Alpa'; })).concat([r.h, r.i, r.s, r.a, Math.round(r.pct * 10) / 10]));
  exportXlsx([{ name: 'Rekap Kehadiran', rows: [head].concat(data) }, { name: 'Pendamping', rows: [['No', 'Tanggal', 'Sesi', 'Nama', 'Kelompok', 'Desa', 'Dapukan', 'Jam']].concat(lapPdp().map((x, i) => [i + 1, x.j.Tanggal, x.j.Tema, x.d.Nama, x.d.Kelompok, x.d.Desa, x.d.Dapukan, String(x.d.Waktu).slice(11, 16)])) }, { name: 'Daftar Sesi', rows: [['Sesi', 'Tanggal', 'Tema', 'Pemateri', 'Tempat']].concat(sess.map(j => [ST.noOf[j.ID], j.Tanggal, j.Tema, j.Pemateri, j.Tempat])) }], 'Rekap_Kehadiran_' + todayStr() + '.xlsx');
}
function lapPrint() {
  const { sess, rows } = lapData(), last = sess.slice(-12);
  doPrint('<div class="prep"><h1>Laporan Kehadiran Pengajian Pengurus — ' + esc(ST.config.AppName) + '</h1><p>Dicetak ' + fmtTgl(todayStr()) + ' · ' + sess.length + ' sesi terlaksana · ' + rows.length + ' pengurus · Rata-rata ' + fmtPct(mean(rows.map(r => r.pct))) + '</p><table><thead><tr><th>No</th><th>Nama</th><th>Kelompok</th><th>Dapukan</th>' + last.map(j => '<th class="c">S' + ST.noOf[j.ID] + '</th>').join('') + '<th class="c">H</th><th class="c">I</th><th class="c">S</th><th class="c">A</th><th class="c">%</th></tr></thead><tbody>' +
    rows.map((r, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(r.p.Nama) + '</td><td>' + esc(r.p.Kelompok) + '</td><td>' + esc(r.p.Dapukan) + '</td>' + last.map(j => { const k = ST.kMap[j.ID + '|' + r.p.ID]; return '<td class="c">' + (k ? stLetter(k.Status) : 'A') + '</td>'; }).join('') + '<td class="c">' + r.h + '</td><td class="c">' + r.i + '</td><td class="c">' + r.s + '</td><td class="c">' + r.a + '</td><td class="c">' + fmtPct(r.pct) + '</td></tr>').join('') + '</tbody></table>' + (function () {
    const pd = lapPdp(); if (!pd.length) return '';
    return '<h1 style="font-size:12pt;margin:6mm 0 2mm">Pendamping Hadir (' + pd.length + ' orang)</h1><table><thead><tr><th>No</th><th>Tanggal</th><th>Sesi</th><th>Nama</th><th>Kelompok</th><th>Desa</th><th>Dapukan</th></tr></thead><tbody>' +
      pd.map((x, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(fmtTgl(x.j.Tanggal)) + '</td><td>' + esc(x.j.Tema) + '</td><td>' + esc(x.d.Nama) + '</td><td>' + esc(x.d.Kelompok) + '</td><td>' + esc(x.d.Desa) + '</td><td>' + esc(x.d.Dapukan) + '</td></tr>').join('') + '</tbody></table>';
  })() + '</div>');
}

/* ============================================================
   HALAMAN: PENGATURAN
   ============================================================ */
RENDER.pengaturan = function () {
  const el = $('#page-pengaturan'), master = ST.user.peran === 'master';
  el.innerHTML =
    '<div class="ph"><div><span class="tag"><i class="bi bi-gear"></i> Pengaturan</span><h1 style="margin-top:.5rem">Pengaturan <em>&amp; Akun</em></h1><p>Profil, keamanan, identitas aplikasi, dan manajemen pengguna.</p></div></div>' +
    '<div class="grid g2" style="align-items:start">' +
    '<div class="card card-p"><div class="card-h"><div><h3>Profil &amp; Kata Sandi</h3><p>' + esc(ST.user.nama) + ' · ' + (ROLE_LABEL[ST.user.peran] || '') + ' · <span class="mono">' + esc(ST.user.username) + '</span></p></div></div>' +
    '<form id="pwForm" novalidate><div class="fld"><label for="pwOld">Kata sandi lama</label><input class="input" id="pwOld" type="password" autocomplete="current-password"></div><div class="row c2"><div class="fld"><label for="pwNew">Kata sandi baru</label><input class="input" id="pwNew" type="password" autocomplete="new-password" minlength="6"></div><div class="fld"><label for="pwNew2">Ulangi</label><input class="input" id="pwNew2" type="password" autocomplete="new-password"></div></div><div class="err" id="pwErr" role="alert"></div><button class="btn btn-pri" type="submit"><i class="bi bi-shield-lock"></i> Ganti Kata Sandi</button></form></div>' +
    '<div class="card card-p"><div class="card-h"><div><h3>Tampilan &amp; Sinkronisasi</h3><p>Preferensi perangkat ini</p></div></div><div style="display:flex;flex-direction:column;gap:.625rem"><button class="btn btn-2" data-act="theme"><i class="bi bi-moon-stars"></i> Ganti mode gelap / terang</button><button class="btn btn-2" data-act="resync"><i class="bi bi-arrow-repeat"></i> Sinkronkan ulang dari Google Sheets</button><button class="btn btn-2" data-act="clearLocal"><i class="bi bi-trash3"></i> Hapus cache lokal perangkat ini</button><button class="btn btn-danger" data-act="logout"><i class="bi bi-box-arrow-left"></i> Keluar</button></div>' + (ST.queue.length ? '<div class="help" style="margin-top:.75rem;color:var(--gold-d)"><i class="bi bi-cloud-slash"></i> ' + ST.queue.length + ' antrean belum terkirim.</div>' : '') + '</div>' +
    (master ? '<div class="card card-p"><div class="card-h"><div><h3>Identitas &amp; Target</h3><p>Nama aplikasi dan target kehadiran</p></div></div><form id="cfForm" novalidate><div class="fld"><label for="cfNama">Nama aplikasi / lembaga</label><input class="input" id="cfNama" value="' + esc(ST.config.AppName) + '" maxlength="60"></div><div class="fld"><label for="cfTgt">Target kehadiran minimum (%)</label><input class="input" id="cfTgt" type="number" min="1" max="100" value="' + ST.config.Target + '"></div><button class="btn btn-pri" type="submit"><i class="bi bi-check2"></i> Simpan</button></form></div>' +
      '<div class="card card-p"><div class="card-h"><div><h3>Logo &amp; Nama di ID Card</h3><p>Tampil pada kartu pengurus</p></div></div><form id="cdForm" novalidate>' +
      '<div class="upl fld"><div id="lgPv" class="lg-pv"></div><div><label class="btn btn-2 btn-sm" for="lgFile"><i class="bi bi-image"></i> Pilih Logo</label><input type="file" id="lgFile" accept="image/png,image/jpeg,image/webp" class="sr"> <button type="button" class="btn btn-ghost btn-sm" data-act="logoClear">Hapus logo</button><div class="help" style="margin-top:.375rem">PNG/JPG, otomatis diperkecil. Disimpan di Google Drive.</div></div></div>' +
      '<div class="fld"><label for="cdOrg">Nama pengajian di kartu</label><input class="input" id="cdOrg" value="' + esc(ST.config.CardOrg || '') + '" maxlength="40" placeholder="' + esc(ST.config.AppName) + '"></div>' +
      '<div id="cdPv" class="cd-pv"></div><div class="err" id="cdErr" role="alert"></div><button class="btn btn-pri" type="submit"><i class="bi bi-check2"></i> Simpan Kartu</button></form></div>' +
      '<div class="card card-p"><div class="card-h"><div><h3>Penyimpanan Google</h3><p>Database &amp; berkas tersimpan di akun Anda</p></div></div><div style="display:flex;flex-direction:column;gap:.625rem">' + (ST.links ? '<a class="btn btn-2" href="' + esc(ST.links.sheet) + '" target="_blank" rel="noopener"><i class="bi bi-table"></i> Buka Google Spreadsheet</a><a class="btn btn-2" href="' + esc(ST.links.folder) + '" target="_blank" rel="noopener"><i class="bi bi-folder2-open"></i> Buka Folder Google Drive</a>' : '') + '</div><div class="help" style="margin-top:.75rem">ID Spreadsheet/Folder & rahasia hash disimpan di Script Properties, tidak pernah dikirim ke browser.</div></div>' : '') +
    '</div>' +
    (master ? '<div class="card card-p" style="margin-top:1rem"><div class="card-h"><div><h3>Pengguna &amp; Hak Akses</h3><p>Master: akses penuh · Penerobos: jadwal, scan, manual, laporan · Pembina: lihat saja + kirim bimbingan</p></div><button class="btn btn-pri btn-sm" data-act="userAdd"><i class="bi bi-person-plus"></i> Tambah</button></div><div class="tbl-wrap cards"><table class="t rt" id="usTable"><tbody><tr><td><div class="skel" style="height:2rem"></div></td></tr></tbody></table></div></div>' : '');
  $('#pwForm').onsubmit = changePass;
  if (master) { $('#cfForm').onsubmit = saveConfig; loadUsers(); initCardForm(); }
};
async function changePass(e) {
  e.preventDefault(); const o = $('#pwOld').value, n = $('#pwNew').value, n2 = $('#pwNew2').value, er = $('#pwErr'); er.textContent = '';
  if (n.length < 6) { er.textContent = 'Kata sandi baru minimal 6 karakter.'; return; } if (n !== n2) { er.textContent = 'Konfirmasi tidak sama.'; return; }
  try { await call('pass.change', { old: o, nw: n }); toast('Kata sandi diperbarui.'); $('#pwForm').reset(); } catch (x) { er.textContent = x.message; }
}
async function saveConfig(e) {
  e.preventDefault(); const prev = Object.assign({}, ST.config); ST.config = Object.assign({}, prev, { AppName: $('#cfNama').value.trim() || 'Absensi Pengajian', Target: Math.max(1, Math.min(100, +$('#cfTgt').value || 85)) });
  $$('.appname').forEach(x => { x.textContent = ST.config.AppName; }); persistSoon(); toast('Pengaturan disimpan.');
  try { await call('config.save', { AppName: ST.config.AppName, Target: ST.config.Target, CardOrg: ST.config.CardOrg || '', CardSub: ST.config.CardSub || '' }); } catch (x) { ST.config = prev; $$('.appname').forEach(y => { y.textContent = prev.AppName; }); toast('Gagal: ' + x.message, 'err'); }
}
/* ============================================================
   LOGO & NAMA ID CARD (Master)
   ============================================================ */
let LOGO_NEW = undefined;   // undefined = tak berubah, '' = hapus, 'data:…' = baru
function cdPreview() {
  const cfg = Object.assign({}, ST.config, { CardOrg: $('#cdOrg').value.trim() });
  if (LOGO_NEW === '') { cfg.LogoID = ''; cfg.LogoData = ''; } else if (LOGO_NEW) cfg.LogoData = LOGO_NEW;
  const lg = cfg.LogoData || (cfg.LogoID ? 'https://lh3.googleusercontent.com/d/' + esc(cfg.LogoID) + '=w160' : '');
  $('#lgPv').innerHTML = lg ? '<img alt="Logo" src="' + lg + '">' : '<i class="bi bi-image"></i>';
  const sample = ST.P[0] || { Nama: 'Nama Pengurus', Dapukan: 'Dapukan', Kelompok: 'Kelompok', Desa: 'Desa', Alamat: 'Alamat', Kode: 'NP001' };
  $('#cdPv').innerHTML = cardHTML(sample, cfg); drawBarcodes($('#cdPv'));
}
function initCardForm() {
  LOGO_NEW = undefined; cdPreview();
  $('#cdOrg').oninput = cdPreview;
  $('#lgFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const url = URL.createObjectURL(f), img = new Image();
      await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('Gambar tidak dapat dibaca.')); img.src = url; });
      const sc = Math.min(1, 320 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); LOGO_NEW = c.toDataURL('image/png'); cdPreview();
    } catch (x) { $('#cdErr').textContent = x.message; }
  };
  $('#cdForm').onsubmit = saveCard;
}
async function saveCard(e) {
  e.preventDefault(); const er = $('#cdErr'); er.textContent = '';
  const btn = e.target.querySelector('[type=submit]'); btn.disabled = true;
  const prev = Object.assign({}, ST.config);
  try {
    if (LOGO_NEW !== undefined) { const r = await call('config.logo', { data: LOGO_NEW }); ST.config.LogoID = r.logoId || ''; }
    const r2 = await call('config.save', { AppName: ST.config.AppName, Target: ST.config.Target, CardOrg: $('#cdOrg').value.trim() });
    ST.config = Object.assign({}, ST.config, { CardOrg: r2.config.CardOrg, CardSub: r2.config.CardSub });
    LOGO_NEW = undefined; persistSoon(); applyBrand(); toast('ID Card diperbarui.'); cdPreview();
  } catch (x) { ST.config = prev; er.textContent = x.message; } finally { btn.disabled = false; }
}

/* ============================================================
   HALAMAN: BIMBINGAN (pembina & master)
   ============================================================ */
const BIM_KAT = ['Pengingat', 'Nasihat', 'Apresiasi', 'Panggilan Pembinaan'];
const BIM_TPL = {
  'Pengingat': 'Assalamu’alaikum {nama}. Kami perhatikan kehadiran antum/anti di pengajian pengurus masih {pct}. Mohon diusahakan hadir di pertemuan berikutnya. Jazakumullahu khairan.',
  'Nasihat': 'Assalamu’alaikum {nama}. Semoga sehat selalu. Mari kita jaga semangat dan komitmen mengikuti pengajian pengurus. Jika ada kendala, silakan sampaikan kepada kami.',
  'Apresiasi': 'Assalamu’alaikum {nama}. Alhamdulillah kehadiran antum/anti {pct}. Terima kasih dan semoga istiqamah.',
  'Panggilan Pembinaan': 'Assalamu’alaikum {nama}. Mohon antum/anti berkenan menemui pembina untuk silaturahmi dan pembinaan. Kapan kiranya ada waktu?'
};
function needGuidance() {
  return ST.act.map(p => ({ p, s: pStats(p.ID, ST.done) })).filter(x => ST.done.length && x.s.pct < ST.config.Target).sort((a, b) => a.s.pct - b.s.pct);
}
RENDER.bimbingan = function () {
  const el = $('#page-bimbingan'), list = needGuidance(), sent = {};
  ST.B.forEach(b => { sent[b.PengurusID] = (sent[b.PengurusID] || 0) + 1; });
  el.innerHTML =
    '<div class="ph"><div><span class="tag"><i class="bi bi-chat-heart"></i> Pembinaan</span><h1 style="margin-top:.5rem">Bimbingan <em>Pengurus</em></h1><p>Pengurus dengan kehadiran di bawah target ' + ST.config.Target + '%. Kirim pesan pembinaan lewat WhatsApp atau salin.</p></div></div>' +
    '<div class="grid g2" style="align-items:start"><div class="card card-p"><div class="card-h"><div><h3>Perlu Pembinaan</h3><p>' + list.length + ' pengurus · berdasarkan ' + ST.done.length + ' sesi selesai</p></div></div>' +
    (list.length ? '<div class="bim-l">' + list.map(x => '<div class="bim-i"><div class="who">' + avatarHTML(x.p) + '<div style="min-width:0"><b>' + esc(x.p.Nama) + '</b><small>' + esc(x.p.Dapukan) + ' · ' + esc(x.p.Kelompok) + '</small></div></div><div class="bim-r"><span class="chip c-A nodot">' + fmtPct(x.s.pct) + '</span>' + (sent[x.p.ID] ? '<span class="mute">' + sent[x.p.ID] + '× dibina</span>' : '') + '<button class="btn btn-pri btn-sm" data-act="bimbinganFor" data-id="' + x.p.ID + '"><i class="bi bi-chat-heart"></i> Bimbing</button></div></div>').join('') + '</div>'
      : '<div class="empty"><i class="bi bi-emoji-smile"></i>' + (ST.done.length ? 'Semua pengurus memenuhi target. Alhamdulillah.' : 'Belum ada sesi selesai untuk dinilai.') + '</div>') + '</div>' +
    '<div class="card card-p"><div class="card-h"><div><h3>Riwayat Bimbingan</h3><p>' + ST.B.length + ' pesan tercatat</p></div></div>' +
    (ST.B.length ? '<div class="bim-l">' + ST.B.slice().sort((a, b) => String(b.Waktu).localeCompare(String(a.Waktu))).slice(0, 30).map(b => { const p = ST.pById[b.PengurusID]; return '<div class="bim-i col"><div><b>' + esc(p ? p.Nama : '—') + '</b> <span class="chip c-S nodot">' + esc(b.Kategori) + '</span></div><div class="bim-m">' + esc(b.Pesan) + '</div><small class="mute">' + esc(b.Waktu) + ' · oleh ' + esc(b.Dari) + ' · ' + esc(b.Via) + '</small></div>'; }).join('') + '</div>' : '<div class="empty"><i class="bi bi-chat-dots"></i>Belum ada pesan bimbingan.</div>') + '</div></div>';
};
function bimbinganForm(id) {
  const p = ST.pById[id]; if (!p) return;
  const s = pStats(p.ID, ST.done), pct = ST.done.length ? fmtPct(s.pct) : 'belum tercatat';
  const fill = k => BIM_TPL[k].replace('{nama}', p.Nama).replace('{pct}', pct);
  openModal('<div class="modal-h"><h3>Pesan Bimbingan</h3><button class="btn btn-ghost btn-ic btn-sm" data-act="modalClose" aria-label="Tutup"><i class="bi bi-x-lg"></i></button></div><form id="fBim" novalidate><div class="modal-b">' +
    '<div class="who" style="margin-bottom:1rem">' + avatarHTML(p) + '<div><b>' + esc(p.Nama) + '</b><small>' + esc(p.Dapukan) + ' · kehadiran ' + pct + (p.NoHP ? ' · ' + esc(p.NoHP) : ' · tanpa No. HP') + '</small></div></div>' +
    '<div class="fld"><label for="bKat">Jenis pesan</label><select class="select" id="bKat">' + BIM_KAT.map(k => '<option>' + k + '</option>').join('') + '</select></div>' +
    '<div class="fld"><label for="bMsg">Pesan</label><textarea class="textarea" id="bMsg" maxlength="800" rows="6">' + esc(fill(BIM_KAT[0])) + '</textarea></div><div class="err" id="bErr" role="alert"></div></div>' +
    '<div class="modal-f"><button type="button" class="btn btn-2" data-act="modalClose">Batal</button><button type="button" class="btn btn-2" id="bCopy"><i class="bi bi-clipboard"></i> Salin</button><button type="button" class="btn btn-2" id="bNote"><i class="bi bi-journal-check"></i> Catat saja</button><button type="submit" class="btn btn-pri"><i class="bi bi-whatsapp"></i> Kirim WhatsApp</button></div></form>',
    box => {
      $('#bKat', box).onchange = e => { $('#bMsg', box).value = fill(e.target.value); };
      const go = async via => {
        const msg = $('#bMsg', box).value.trim(), er = $('#bErr', box); er.textContent = '';
        if (msg.length < 5) { er.textContent = 'Pesan terlalu pendek.'; return; }
        const hp = String(p.NoHP || '').replace(/\D/g, '').replace(/^0/, '62');
        if (via === 'WhatsApp' && hp.length < 8) { er.textContent = 'No. HP pengurus belum diisi.'; return; }
        if (via === 'Salin') { try { await navigator.clipboard.writeText(msg); } catch (x) { const t = $('#bMsg', box); t.select(); document.execCommand('copy'); } }
        if (via === 'WhatsApp') window.open('https://wa.me/' + hp + '?text=' + encodeURIComponent(msg), '_blank', 'noopener');
        const rec = { ID: 'tmp' + uid(), Waktu: nowStr(), Dari: ST.user.nama, PengurusID: p.ID, Kategori: $('#bKat', box).value, Pesan: msg, Via: via };
        ST.B.push(rec); closeModal(); if (ST.page === 'bimbingan') RENDER.bimbingan(); toast(via === 'Salin' ? 'Pesan disalin & dicatat.' : via === 'WhatsApp' ? 'WhatsApp dibuka, bimbingan dicatat.' : 'Bimbingan dicatat.'); persistSoon();
        try { const r = await call('bimbingan.send', { pengurusId: p.ID, kategori: rec.Kategori, pesan: msg, via: via }); if (r.rec) { rec.ID = r.rec.ID; rec.Waktu = r.rec.Waktu; persistSoon(); } }
        catch (x) { ST.B = ST.B.filter(b => b.ID !== rec.ID); if (ST.page === 'bimbingan') RENDER.bimbingan(); toast('Catatan gagal tersimpan: ' + x.message, 'err'); }
      };
      $('#fBim', box).onsubmit = e => { e.preventDefault(); go('WhatsApp'); };
      $('#bCopy', box).onclick = () => go('Salin'); $('#bNote', box).onclick = () => go('Catatan');
    });
}

let USERS = [];
async function loadUsers() {
  try { const r = await call('user.list'); USERS = r.users; } catch (e) { if ($('#usTable')) $('#usTable').innerHTML = '<tbody><tr><td>' + esc(e.message) + '</td></tr></tbody>'; return; }
  const t = $('#usTable'); if (!t) return;
  t.innerHTML = '<thead><tr><th>Pengguna</th><th>Nama</th><th>Peran</th><th>Status</th><th style="width:100px"></th></tr></thead><tbody>' + USERS.map(u => '<tr><td class="first mono">' + esc(u.Username) + '</td><td data-l="Nama">' + esc(u.Nama) + '</td><td data-l="Peran"><span class="chip ' + (u.Peran === 'master' ? 'c-I' : u.Peran === 'pembina' ? 'c-H' : 'c-S') + ' nodot">' + (ROLE_LABEL[u.Peran] || u.Peran) + '</span></td><td data-l="Status">' + (u.Aktif ? '<span class="chip c-H">Aktif</span>' : '<span class="chip c-N">Nonaktif</span>') + '</td><td data-l="Aksi"><button class="btn btn-ghost btn-sm btn-ic" data-act="userEdit" data-id="' + esc(u.Username) + '" aria-label="Ubah"><i class="bi bi-pencil"></i></button>' + (u.Username !== ST.user.username ? '<button class="btn btn-ghost btn-sm btn-ic" data-act="userDel" data-id="' + esc(u.Username) + '" aria-label="Hapus"><i class="bi bi-trash"></i></button>' : '') + '</td></tr>').join('') + '</tbody>';
}
function userForm(username) {
  const u = USERS.filter(x => x.Username === username)[0] || null;
  openModal('<div class="modal-h"><h3>' + (u ? 'Ubah Pengguna' : 'Tambah Pengguna') + '</h3><button class="btn btn-ghost btn-ic btn-sm" data-act="modalClose" aria-label="Tutup"><i class="bi bi-x-lg"></i></button></div><form id="fUs" novalidate><div class="modal-b">' +
    '<div class="fld"><label for="uUser">Nama pengguna *</label><input class="input" id="uUser" value="' + esc(u ? u.Username : '') + '" ' + (u ? 'readonly' : '') + ' maxlength="30" autocapitalize="none"></div>' +
    '<div class="fld"><label for="uNama">Nama lengkap *</label><input class="input" id="uNama" value="' + esc(u ? u.Nama : '') + '" maxlength="60"></div>' +
    '<div class="row c2"><div class="fld"><label for="uPeran">Peran</label><select class="select" id="uPeran"><option value="penerobos" ' + (u && u.Peran === 'penerobos' ? 'selected' : '') + '>Admin Penerobos</option><option value="pembina" ' + (u && u.Peran === 'pembina' ? 'selected' : '') + '>Pembina (lihat saja + bimbingan)</option><option value="master" ' + (u && u.Peran === 'master' ? 'selected' : '') + '>Master Admin</option></select></div><div class="fld"><label for="uAkt">Status</label><select class="select" id="uAkt"><option value="1">Aktif</option><option value="0" ' + (u && !u.Aktif ? 'selected' : '') + '>Nonaktif</option></select></div></div>' +
    '<div class="fld"><label for="uPass">' + (u ? 'Kata sandi baru (kosongkan jika tidak diganti)' : 'Kata sandi * (min. 6 karakter)') + '</label><input class="input" id="uPass" type="password" autocomplete="new-password"></div><div class="err" id="fErr" role="alert"></div></div>' +
    '<div class="modal-f"><button type="button" class="btn btn-2" data-act="modalClose">Batal</button><button type="submit" class="btn btn-pri"><i class="bi bi-check2"></i> Simpan</button></div></form>',
    box => {
      $('#fUs', box).onsubmit = async ev => {
        ev.preventDefault();
        const rec = { Username: $('#uUser').value.trim().toLowerCase(), Nama: $('#uNama').value.trim(), Peran: $('#uPeran').value, Aktif: $('#uAkt').value === '1', Password: $('#uPass').value };
        try { await call('user.save', { rec }); closeModal(); toast('Pengguna disimpan.'); loadUsers(); } catch (e) { $('#fErr').textContent = e.message; }
      };
    });
}

/* ============================================================
   EVENT DELEGASI (satu pendengar untuk seluruh aplikasi)
   ============================================================ */
const ACT = {
  theme: toggleTheme, logout: doLogout, modalClose: closeModal, closeSheet,
  goScan: () => navigate('scan'), bimbinganFor: t => bimbinganForm(t.dataset.id), logoClear: () => { LOGO_NEW = ''; cdPreview(); }, goSettings: () => navigate('pengaturan'),
  moreMenu: () => { $('#mSheet').classList.add('on'); $('#sheetBg').classList.add('on'); },
  resync: () => { closeSheet(); refresh(false); },
  clearLocal: async () => { if (await confirmBox('Hapus cache lokal?', 'Data akan diambil ulang dari server. Antrean yang belum terkirim ikut terhapus.', 'Hapus', true)) { store.del('np_d'); store.del('np_q'); ST.queue = []; toast('Cache dibersihkan.'); refresh(false); } },
  addPengurus: () => pengurusForm(), editPengurus: t => pengurusForm(t.dataset.id), delPengurus: t => delPengurus(t.dataset.id),
  togglePengurus: t => togglePengurus(t.dataset.id), regenKode: t => regenKode(t.dataset.id),
  pickPengurus: (t, e) => { if (e.target.closest('input,button,a')) return; ST.pg.cur = t.dataset.id; rPgTable(); if (matchMedia('(max-width:1180px)').matches) $('#pgPreview').scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  cardJpg: t => { const p = ST.pById[t.dataset.id]; if (p) downloadCards([p]); },
  backCards: () => backCardsForm(),
  jpgSelected: () => downloadCards(ST.P.filter(p => ST.pg.sel.has(p.ID))),
  delSelected: () => delSelected(),
  pdpCards: () => pdpCardsForm(),
  pdpDel: t => pdpDelete(t.dataset.id),
  printCard: t => { const p = ST.pById[t.dataset.id]; if (p) printCards([p]); },
  printSelected: () => printCards(ST.P.filter(p => ST.pg.sel.has(p.ID))),
  exportPengurus: () => exportXlsx([{ name: 'Pengurus', rows: [['Kode', 'Nama', 'Tempat Lahir', 'Tanggal Lahir', 'Kelompok', 'Desa', 'Alamat', 'Dapukan', 'No HP', 'Status']].concat(ST.P.map(p => [p.Kode, p.Nama, p.TempatLahir, p.TanggalLahir, p.Kelompok, p.Desa || '', p.Alamat, p.Dapukan, p.NoHP, p.Aktif === false ? 'Nonaktif' : 'Aktif'])) }], 'Data_Pengurus_' + todayStr() + '.xlsx'),
  pgPage: t => { ST.pg.page = +t.dataset.n; rPgTable(); },
  addJadwal: () => jadwalForm(), editJadwal: t => jadwalForm(t.dataset.id), delJadwal: t => delJadwal(t.dataset.id),
  statusJadwal: t => setStatusJadwal(t.dataset.id, t.dataset.s), viewPresensi: t => viewPresensi(t.dataset.id),
  exportJadwal: () => exportXlsx([{ name: 'Jadwal', rows: [['Sesi', 'Tanggal', 'Mulai', 'Selesai', 'Tempat', 'Tema', 'Pemateri', 'Kategori', 'Status']].concat(ST.J.slice().sort(cmpJ).map(j => [ST.noOf[j.ID], j.Tanggal, j.Mulai, j.Selesai, j.Tempat, j.Tema, j.Pemateri, j.Kategori, j.Status])) }], 'Jadwal_' + todayStr() + '.xlsx'),
  openScan: t => { ST.sc.jadwalId = t.dataset.id; navigate('scan'); },
  scanStart: startCam, scanSubmit, scanUndo: t => scanUndo(t.dataset.id), closeSesi: t => closeSesi(t.dataset.id),
  scanSound: () => { ST.sc.sound = !ST.sc.sound; const b = $('#scSndBtn'); if (b) b.innerHTML = '<i class="bi ' + (ST.sc.sound ? 'bi-volume-up' : 'bi-volume-mute') + '"></i>'; },
  lapExcel: lapExport, lapPrint, lapLow, printPres: t => printPresensi(t.dataset.id),
  userAdd: () => userForm(), userEdit: t => userForm(t.dataset.id),
  userDel: async t => { if (!await confirmBox('Hapus pengguna?', 'Akun <b>' + esc(t.dataset.id) + '</b> akan dihapus permanen.', 'Hapus', true)) return; try { await call('user.delete', { username: t.dataset.id }); toast('Pengguna dihapus.'); loadUsers(); } catch (e) { toast(e.message, 'err'); } }
};
document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); navigate(g.dataset.go); return; }
  const a = e.target.closest('[data-act]'); if (a && ACT[a.dataset.act]) { if (a.tagName === 'A' && !a.hasAttribute('data-nopd')) e.preventDefault(); ACT[a.dataset.act](a, e); return; }
  if (e.target === $('#modalBg')) closeModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); closeSheet(); }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role=button][data-go],[role=button][data-act]')) { e.preventDefault(); e.target.click(); }
});
document.addEventListener('change', e => {
  const t = e.target; if (!t.dataset || !t.dataset.chg) return;
  if (t.dataset.chg === 'selRow') { t.checked ? ST.pg.sel.add(t.dataset.id) : ST.pg.sel.delete(t.dataset.id); $('#fgInfo').textContent = 'Menampilkan ' + pgFiltered().length + ' pengurus · ' + ST.pg.sel.size + ' dipilih untuk cetak'; }
  if (t.dataset.chg === 'selAll') { pgFiltered().forEach(p => { t.checked ? ST.pg.sel.add(p.ID) : ST.pg.sel.delete(p.ID); }); rPgTable(); }
});

/* ============================================================
   INISIALISASI
   ============================================================ */
function init() {
  loadAssets();
  applyTheme(store.get('np_theme') || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light'));
  $('#loginForm').addEventListener('submit', doLogin);
  const flt = debounce(() => { ST.pg.page = 1; rPgTable(); }, 120);
  $('#fgQ').addEventListener('input', flt); ['#fgKel', '#fgDap', '#fgSt'].forEach(s => $(s).addEventListener('change', () => { ST.pg.page = 1; rPgTable(); }));
  $('#topSearch').addEventListener('input', debounce(e => { const v = e.target.value; if (!v.trim()) return; if (ST.page !== 'pengurus') navigate('pengurus'); $('#fgQ').value = v; ST.pg.page = 1; rPgTable(); }, 250));

  // Sesi tersimpan → buka INSTAN dari cache lokal, lalu segarkan di latar belakang
  const sess = store.get('np_s'), cache = store.get('np_d');
  if (sess && sess.token && cache && cache.P) {
    ST.token = sess.token; ST.user = sess.user; ST.config = cache.config || ST.config; ST.links = cache.links || null;
    ST.P = cache.P; ST.J = cache.J; ST.K = cache.K; ST.B = cache.B || []; ST.D = cache.D || []; ST.PC = cache.PC || []; index(); enterApp(); refresh(true); flushQueue();
  } else if (sess && sess.token) {
    ST.token = sess.token; ST.user = sess.user; showLogin(); $('#lgBtn').disabled = true; $('#lgBtn').innerHTML = '<span class="spin"></span> Memuat…';
    call('bootstrap').then(r => { ingest(r.boot); enterApp(); }).catch(() => { ST.token = null; showLogin(); });
  } else showLogin();

  setInterval(() => { if (ST.token && !document.hidden) { if (ST.queue.length) flushQueue(); } }, 15000);
  setInterval(pollScan, 12000);
  setInterval(() => { if (ST.token && !document.hidden && ST.page !== 'scan') refresh(true); }, 180000);
  window.addEventListener('online', () => { flushQueue(); refresh(true); });
  window.addEventListener('offline', () => setSync('off'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ST.token) { flushQueue(); if (ST.page !== 'scan') refresh(true); } });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
