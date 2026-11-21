// Peti notifikasi dalam app (loceng) — untuk pengguna yang tidak terima pop-up notifikasi
import { collection, query, where, orderBy, limit, onSnapshot } from './fs.js';
import { $, L, esc, icon, modal, toDate, fmtDateTime, toast } from './ui.js';

let unsub = null, items = [], seenKey = '', btnSel = '';

const seen = () => { try { return Number(localStorage.getItem(seenKey) || 0); } catch { return 0; } };
const unread = () => items.filter(x => (toDate(x.at)?.getTime() || 0) > seen()).length;

export const bellHtml = (cls = 'icon-btn') =>
  `<button type="button" class="${cls} bell-btn" id="bellBtn" aria-label="${L('Notifikasi', 'Notifications')}">${icon('bell', 20)}<span class="bell-n hide" id="bellN"></span></button>`;

function paint() {
  const n = unread(), b = $('#bellN');
  if (!b) return;
  b.textContent = n > 9 ? '9+' : String(n);
  b.classList.toggle('hide', !n);
}

// targets: senarai nilai medan 'to' (cth: [uid, 'workers'] atau ['admins'])
export function startInbox(db, cid, targets, uid) {
  seenKey = `pa_inbox_seen_${cid}_${uid}`;
  if (unsub) unsub();
  let first = true;
  unsub = onSnapshot(query(collection(db, 'companies', cid, 'inbox'), where('to', 'in', targets), orderBy('at', 'desc'), limit(40)), (s) => {
    const before = new Set(items.map(x => x.id));
    items = s.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }));
    paint();
    // Mesej baharu semasa app dibuka → paparkan sekejap
    if (!first) items.filter(x => !before.has(x.id)).slice(0, 2).forEach(x => toast(`🔔 ${x.title}`, 'ok', 5000));
    // Bila app dibuka dengan mesej belum dibaca → beri tahu sekali
    if (first && unread()) toast(L(`🔔 ${unread()} notifikasi baharu — tekan loceng di atas.`, `🔔 ${unread()} new notifications — tap the bell at the top.`), 'ok', 5000);
    first = false;
  }, (e) => console.warn('inbox', e));
  bindBell();
}

export function bindBell() {
  const b = $('#bellBtn'); if (!b) return;
  b.onclick = openInbox; paint();
}

export function stopInbox() { if (unsub) unsub(); unsub = null; items = []; }

function openInbox() {
  const last = seen();
  modal({
    title: `🔔 ${L('Notifikasi', 'Notifications')}`,
    body: items.length ? `<div class="inbox">${items.map(x => {
      const t = toDate(x.at);
      return `<div class="inbox-it ${(t?.getTime() || 0) > last ? 'new' : ''}">
        <div class="row between" style="flex-wrap:nowrap;gap:.5rem"><b>${esc(x.title || '')}</b><span class="xs muted" style="white-space:nowrap">${t ? fmtDateTime(t) : ''}</span></div>
        ${x.body ? `<div class="small muted" style="margin-top:2px">${esc(x.body)}</div>` : ''}</div>`;
    }).join('')}</div>` : `<div class="empty">${L('Tiada notifikasi lagi.', 'No notifications yet.')}</div>`,
    actions: [{ label: L('Tutup', 'Close'), cls: 'btn-primary' }]
  });
  const newest = Math.max(0, ...items.map(x => toDate(x.at)?.getTime() || 0));
  try { localStorage.setItem(seenKey, String(Math.max(newest, Date.now()))); } catch { /* */ }
  paint();
}
