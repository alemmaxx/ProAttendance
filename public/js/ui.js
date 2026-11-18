// ProAttendance — fungsi kongsi UI
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

// ---------- Bahasa (BM | EN) ----------
export const getLang = () => { try { return localStorage.getItem('pa_lang') || 'ms'; } catch { return 'ms'; } };
export const L = (ms, en) => (getLang() === 'en' ? en : ms);
export function applyLang(root = document) {
  const en = getLang() === 'en';
  $$('[data-ms]', root).forEach(el => { el.textContent = en ? (el.dataset.en || el.dataset.ms) : el.dataset.ms; });
  $$('[data-ms-ph]', root).forEach(el => { el.placeholder = en ? (el.dataset.enPh || el.dataset.msPh) : el.dataset.msPh; });
  $$('[data-lang-toggle]', root).forEach(el => { el.textContent = en ? 'BM' : 'EN'; });
  document.documentElement.lang = en ? 'en' : 'ms';
}
export function setLang(l) {
  try { localStorage.setItem('pa_lang', l); } catch {}
  applyLang();
  document.dispatchEvent(new Event('langchange'));
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-lang-toggle]');
  if (b) setLang(getLang() === 'en' ? 'ms' : 'en');
});
export const langBtn = () => `<button type="button" class="lang-btn" data-lang-toggle>${getLang() === 'en' ? 'BM' : 'EN'}</button>`;

// ---------- Teks selamat ----------
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Toast ----------
export function toast(msg, type = 'ok', ms = 3200) {
  let box = $('#toastBox');
  if (!box) { box = document.createElement('div'); box.id = 'toastBox'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

// ---------- Modal ----------
export function modal({ title = '', body = '', actions = [], wide = false, closable = true, onClose } = {}) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `
    <div class="modal ${wide ? 'modal-wide' : ''}" role="dialog">
      <div class="modal-head">
        <h3>${title}</h3>
        ${closable ? '<button type="button" class="icon-btn" data-x aria-label="close">✕</button>' : ''}
      </div>
      <div class="modal-body">${body}</div>
      ${actions.length ? `<div class="modal-foot">${actions.map((a, i) =>
        `<button type="button" class="btn ${a.cls || 'btn-ghost'}" data-a="${i}">${a.label}</button>`).join('')}</div>` : ''}
    </div>`;
  document.body.appendChild(bg);
  document.body.classList.add('no-scroll');
  const close = () => {
    bg.remove();
    if (!$('.modal-bg')) document.body.classList.remove('no-scroll');
    onClose && onClose();
  };
  if (closable) {
    $('[data-x]', bg).onclick = close;
    bg.addEventListener('mousedown', e => { if (e.target === bg) close(); });
  }
  actions.forEach((a, i) => {
    $(`[data-a="${i}"]`, bg).onclick = async (ev) => {
      const btn = ev.currentTarget;
      if (!a.onClick) return close();
      btn.disabled = true;
      try {
        const r = await a.onClick({ el: bg, close });
        if (r !== false && a.autoClose !== false) close();
      } finally { btn.disabled = false; }
    };
  });
  applyLang(bg);
  return { el: bg, close };
}

export function confirmBox(msg, okLabel) {
  return new Promise(res => {
    let done = false;
    modal({
      title: L('Pengesahan', 'Confirm'),
      body: `<p>${msg}</p>`,
      actions: [
        { label: L('Batal', 'Cancel'), onClick: () => { done = true; res(false); } },
        { label: okLabel || L('Ya', 'Yes'), cls: 'btn-primary', onClick: () => { done = true; res(true); } }
      ],
      onClose: () => { if (!done) res(false); }
    });
  });
}

export function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.lbl = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span> ${label || ''}`; }
  else { btn.disabled = false; if (btn.dataset.lbl) btn.innerHTML = btn.dataset.lbl; }
}

// ---------- Tarikh & masa ----------
const pad = n => String(n).padStart(2, '0');
export function todayStr(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function toDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  if (ts instanceof Date) return ts;
  if (typeof ts === 'number') return new Date(ts);
  if (typeof ts === 'string') return new Date(ts);
  if (ts.seconds) return new Date(ts.seconds * 1000);
  return null;
}
export const punchTime = (r) => (r?.offline && r.clientTs) ? new Date(r.clientTs) : toDate(r?.ts);
export function fmtTime(ts) { const d = toDate(ts); return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '-'; }
export function fmtDate(x, opts) {
  const d = typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? new Date(x + 'T00:00:00') : toDate(x);
  if (!d) return '-';
  return d.toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'ms-MY', opts || { day: '2-digit', month: 'short', year: 'numeric' });
}
export function fmtDateTime(ts) { const d = toDate(ts); return d ? `${fmtDate(d)} ${fmtTime(d)}` : '-'; }
export function minsToHM(m) { m = Math.max(0, Math.round(m || 0)); return `${Math.floor(m / 60)}j ${pad(m % 60)}m`; }
export function dayName(i, short = true) {
  const ms = ['Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu'];
  const en = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const n = (getLang() === 'en' ? en : ms)[i];
  return short ? n.slice(0, 3) : n;
}
export function addDays(str, n) { const d = new Date(str + 'T00:00:00'); d.setDate(d.getDate() + n); return todayStr(d); }

// ---------- Ringkasan kehadiran sehari ----------
// recs: rekod seorang pekerja pada satu tarikh (type in/out/break_in/break_out, ts)
export function summarizeDay(recs, settings = {}, dateStr) {
  // Punch luar talian guna masa peranti (clientTs) kerana masa server ialah masa ia dihantar
  const list = [...recs].map(r => ({ ...r, _t: (r.offline && r.clientTs ? r.clientTs : toDate(r.ts)?.getTime()) || 0 }))
    .filter(r => r.type !== 'visit').sort((a, b) => a._t - b._t);
  let firstIn = null, lastOut = null, work = 0, brk = 0, inAt = null, brAt = null, onBreak = false;
  for (const r of list) {
    if (r.type === 'in') { if (!firstIn) firstIn = r._t; inAt = r._t; }
    else if (r.type === 'out') { if (inAt) { work += r._t - inAt; inAt = null; } if (brAt) { brk += r._t - brAt; brAt = null; } lastOut = r._t; onBreak = false; }
    else if (r.type === 'break_in') { brAt = r._t; onBreak = true; }
    else if (r.type === 'break_out') { if (brAt) { brk += r._t - brAt; brAt = null; } onBreak = false; }
  }
  const isToday = dateStr === todayStr();
  if (inAt && isToday) { work += Date.now() - inAt; if (brAt) brk += Date.now() - brAt; }
  const workMin = Math.max(0, (work - brk) / 60000);
  let lateMin = 0;
  if (firstIn && settings.workStart && dateStr) {
    const [h, m] = settings.workStart.split(':').map(Number);
    const start = new Date(dateStr + 'T00:00:00'); start.setHours(h, m, 0, 0);
    const grace = Number(settings.grace || 0) * 60000;
    if (firstIn > start.getTime() + grace) lateMin = Math.round((firstIn - start.getTime()) / 60000);
  }
  const last = list[list.length - 1];
  return {
    firstIn: firstIn ? new Date(firstIn) : null,
    lastOut: lastOut ? new Date(lastOut) : null,
    workMin, breakMin: brk / 60000, lateMin, onBreak,
    open: !!inAt, lastType: last ? last.type : null, count: list.length,
    locName: (list.find(r => r.type === 'in') || {}).locName || ''
  };
}

export const TYPE_LABEL = {
  in: () => L('Masuk', 'Clock In'),
  out: () => L('Keluar', 'Clock Out'),
  break_in: () => L('Mula Rehat', 'Break Start'),
  break_out: () => L('Tamat Rehat', 'Break End'),
  visit: () => L('Lawatan Tapak', 'Site Visit')
};
export const METHOD_LABEL = {
  button: () => L('Butang', 'Button'),
  gps: () => 'GPS',
  qr: () => 'QR',
  fix: () => L('Pembetulan', 'Correction'),
  kiosk: () => 'Kiosk'
};

// ---------- Lokasi ----------
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
export function getPosition(timeout = 15000) {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('nogeo'));
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      e => rej(e),
      { enableHighAccuracy: true, timeout, maximumAge: 0 }
    );
  });
}
export const mapLink = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;

// ---------- Peranti ----------
export function getDeviceId() {
  try {
    let id = localStorage.getItem('pa_device');
    if (!id) { id = 'd' + crypto.getRandomValues(new Uint32Array(3)).join('').slice(0, 20); localStorage.setItem('pa_device', id); }
    return id;
  } catch { return 'nodevice'; }
}

// ---------- Imej ----------
export function drawToDataURL(source, sw, sh, maxW, type = 'image/jpeg', q = 0.6, stamp) {
  const scale = Math.min(1, maxW / sw);
  const c = document.createElement('canvas');
  c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
  const ctx = c.getContext('2d');
  ctx.drawImage(source, 0, 0, c.width, c.height);
  if (stamp) {
    const fs = Math.max(11, Math.round(c.width / 26));
    ctx.font = `600 ${fs}px system-ui, sans-serif`;
    const lines = stamp.split('\n');
    const h = lines.length * (fs + 4) + 8;
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(0, c.height - h, c.width, h);
    ctx.fillStyle = '#fff';
    lines.forEach((ln, i) => ctx.fillText(ln, 8, c.height - h + 6 + (i + 1) * (fs + 2)));
  }
  return c.toDataURL(type, q);
}
export function fileToDataURL(file, maxW = 200, type = 'image/png', q = 0.85) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { try { res(drawToDataURL(img, img.naturalWidth, img.naturalHeight, maxW, type, q)); } catch (e) { rej(e); } URL.revokeObjectURL(url); };
    img.onerror = rej;
    img.src = url;
  });
}

// ---------- Kamera: selfie ----------
export function takeSelfie(stampText) {
  return new Promise(resolve => {
    let stream = null, done = false;
    const stop = () => { stream && stream.getTracks().forEach(t => t.stop()); };
    const m = modal({
      title: L('Ambil Selfie', 'Take a Selfie'),
      body: `<div class="cam-wrap"><video id="camV" playsinline autoplay muted></video><div class="cam-ring"></div></div>
             <p class="muted small center" id="camMsg">${L('Pastikan wajah jelas dalam bulatan.', 'Make sure your face is clear in the circle.')}</p>`,
      actions: [
        { label: L('Batal', 'Cancel'), onClick: () => { done = true; stop(); resolve(null); } },
        {
          label: '📸 ' + L('Tangkap', 'Capture'), cls: 'btn-primary', onClick: () => {
            const v = $('#camV', m.el);
            if (!v.videoWidth) { toast(L('Kamera belum sedia', 'Camera not ready'), 'warn'); return false; }
            const url = drawToDataURL(v, v.videoWidth, v.videoHeight, 360, 'image/jpeg', 0.6, stampText);
            done = true; stop(); resolve(url);
          }
        }
      ],
      onClose: () => { stop(); if (!done) resolve(null); }
    });
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false })
      .then(s => { stream = s; const v = $('#camV', m.el); if (v) v.srcObject = s; else stop(); })
      .catch(() => { $('#camMsg', m.el).textContent = L('Tidak dapat buka kamera. Benarkan akses kamera dalam pelayar.', 'Cannot open camera. Allow camera access in your browser.'); });
  });
}

// ---------- Kamera: imbas QR ----------
export function scanQR() {
  return new Promise(resolve => {
    let stream = null, done = false, raf = 0, detector = null;
    const stop = () => { cancelAnimationFrame(raf); stream && stream.getTracks().forEach(t => t.stop()); };
    const m = modal({
      title: L('Imbas Kod QR', 'Scan QR Code'),
      body: `<div class="cam-wrap qr"><video id="qrV" playsinline autoplay muted></video><div class="qr-frame"></div></div>
             <p class="muted small center" id="qrMsg">${L('Halakan kamera ke kod QR di lokasi kerja.', 'Point the camera at the QR code at your workplace.')}</p>`,
      actions: [{ label: L('Batal', 'Cancel'), onClick: () => { done = true; stop(); resolve(null); } }],
      onClose: () => { stop(); if (!done) resolve(null); }
    });
    if ('BarcodeDetector' in window) { try { detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch {} }
    const c = document.createElement('canvas'), ctx = c.getContext('2d', { willReadFrequently: true });
    const tick = async () => {
      if (done) return;
      const v = $('#qrV', m.el);
      if (v && v.videoWidth) {
        try {
          let text = null;
          if (detector) {
            const codes = await detector.detect(v);
            if (codes.length) text = codes[0].rawValue;
          } else if (window.jsQR) {
            c.width = v.videoWidth; c.height = v.videoHeight;
            ctx.drawImage(v, 0, 0);
            const img = ctx.getImageData(0, 0, c.width, c.height);
            const r = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (r) text = r.data;
          }
          if (text) { done = true; stop(); m.close(); resolve(text); return; }
        } catch {}
      }
      raf = requestAnimationFrame(tick);
    };
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(s => { stream = s; const v = $('#qrV', m.el); if (v) { v.srcObject = s; tick(); } else stop(); })
      .catch(() => { $('#qrMsg', m.el).textContent = L('Tidak dapat buka kamera. Benarkan akses kamera dalam pelayar.', 'Cannot open camera. Allow camera access in your browser.'); });
  });
}

// ---------- QR dinamik ----------
export const QR_WINDOW_MS = 30000;
export const qrWindow = (t = Date.now()) => Math.floor(t / QR_WINDOW_MS);
export async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function qrPayload(cid, lid, secret, win = qrWindow()) {
  const sig = (await sha256hex(`${secret}:${cid}:${lid}:${win}`)).slice(0, 12);
  return `PA1|${cid}|${lid}|${win}|${sig}`;
}
export async function verifyQr(text, cid, locations) {
  const p = String(text || '').split('|');
  if (p.length !== 5 || p[0] !== 'PA1') return { ok: false, err: L('Kod QR ini bukan kod kehadiran.', 'This is not an attendance QR code.') };
  const [, qcid, lid, win, sig] = p;
  if (qcid !== cid) return { ok: false, err: L('Kod QR ini milik syarikat lain.', 'This QR code belongs to another company.') };
  const loc = locations.find(l => l.id === lid);
  if (!loc) return { ok: false, err: L('Lokasi QR tidak dijumpai.', 'QR location not found.') };
  const now = qrWindow();
  if (Math.abs(now - Number(win)) > 1) return { ok: false, err: L('Kod QR sudah tamat tempoh. Imbas kod terkini.', 'QR code expired. Scan the latest code.') };
  const expect = (await sha256hex(`${loc.qrSecret}:${cid}:${lid}:${win}`)).slice(0, 12);
  if (expect !== sig) return { ok: false, err: L('Kod QR tidak sah.', 'Invalid QR code.') };
  return { ok: true, loc };
}

// ---------- Jenama syarikat (white-label) ----------
export function applyBrand(c) {
  if (!c) return;
  const color = /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : '#1d4ed8';
  document.documentElement.style.setProperty('--brand', color);
  document.documentElement.style.setProperty('--brand-dark', shade(color, -0.25));
  document.documentElement.style.setProperty('--brand-soft', shade(color, 0.88));
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = color;
  $$('[data-brand-name]').forEach(el => el.textContent = c.name || '');
  $$('[data-brand-logo]').forEach(el => { el.innerHTML = logoHtml(c); });
}
export function logoHtml(c, cls = 'logo') {
  if (c && c.logo) return `<img class="${cls}" src="${c.logo}" alt="">`;
  const ini = String(c?.name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return `<span class="${cls} logo-ini">${esc(ini || '?')}</span>`;
}
export function shade(hex, p) {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const t = p < 0 ? 0 : 255, a = Math.abs(p);
  r = Math.round((t - r) * a + r); g = Math.round((t - g) * a + g); b = Math.round((t - b) * a + b);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// ---------- Lain-lain ----------
export const isExpired = c => !c || c.status === 'suspended' || !toDate(c.expiry) || toDate(c.expiry).getTime() < Date.now();
export const daysLeft = c => { const d = toDate(c?.expiry); return d ? Math.ceil((d.getTime() - Date.now()) / 86400000) : 0; };
export const randPin = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
export const randSecret = () => Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
export const money = n => 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function copyText(t) {
  if (navigator.clipboard) return navigator.clipboard.writeText(t).then(() => toast(L('Disalin', 'Copied')));
  const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
  document.execCommand('copy'); ta.remove(); toast(L('Disalin', 'Copied'));
}
export function authErr(e) {
  const c = e?.code || '';
  const map = {
    'auth/invalid-credential': L('ID / e-mel atau kata laluan salah.', 'Wrong ID / email or password.'),
    'auth/wrong-password': L('Kata laluan salah.', 'Wrong password.'),
    'auth/user-not-found': L('Akaun tidak dijumpai.', 'Account not found.'),
    'auth/invalid-email': L('Format e-mel tidak sah.', 'Invalid email format.'),
    'auth/email-already-in-use': L('E-mel ini sudah didaftarkan.', 'This email is already registered.'),
    'auth/weak-password': L('Kata laluan terlalu lemah (min 6 aksara).', 'Password too weak (min 6 characters).'),
    'auth/too-many-requests': L('Terlalu banyak cubaan. Cuba lagi sebentar.', 'Too many attempts. Try again later.'),
    'auth/user-disabled': L('Akaun ini telah dinyahaktifkan.', 'This account has been disabled.'),
    'auth/popup-closed-by-user': L('Tetingkap log masuk ditutup.', 'Sign-in window closed.'),
    'auth/network-request-failed': L('Tiada sambungan internet.', 'No internet connection.'),
    'auth/requires-recent-login': L('Sila log keluar dan log masuk semula.', 'Please log out and log in again.'),
    'permission-denied': L('Tiada kebenaran untuk tindakan ini.', 'You do not have permission for this action.')
  };
  return map[c] || (e?.message || String(e));
}

// ---------- Ikon (SVG) ----------
const P = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6"/><path d="M16 4a4 4 0 010 8"/><path d="M22 21c0-3-2-5-4-6"/>',
  pin: '<path d="M12 22s7-7 7-12a7 7 0 10-14 0c0 5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
  chart: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
  bell: '<path d="M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 01-3.4 0"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  out: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h4v4h-4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  dl: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
  money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  doc: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 01-9 8.4 8.6 8.6 0 01-4-1L3 20l1.2-4.4A8.3 8.3 0 013 11.5 8.4 8.4 0 0112 3a8.4 8.4 0 019 8.5z"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
};
export const icon = (n, s = 20) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[n] || ''}</svg>`;

// Butang tunjuk kata laluan
document.addEventListener('click', e => {
  const b = e.target.closest('[data-eye]');
  if (!b) return;
  const inp = b.parentElement.querySelector('input');
  if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
});

// Service worker (PWA)
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
