import { MARKS, NO_ENTRY_REASONS } from './config.js';
import { addDays, fmtLong, fmtTime12, isWeekend, monthEnd, monthStart, nyTimeInManila, weekStart } from './dates.js';
import { effMark } from './metrics.js';
import { store } from './store.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function toast(message, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3200);
}

export function openModal(html, bind) {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal';
  dlg.innerHTML = `<div class="modal-card"><button class="modal-x" data-close aria-label="Close">×</button>${html}</div>`;
  document.body.append(dlg);
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
  });
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
  bind?.(dlg);
  return dlg;
}

export function confirmBox(message, okLabel = 'Delete') {
  return new Promise((resolve) => {
    let answer = false;
    const dlg = openModal(`
      <p class="confirm-msg">${esc(message)}</p>
      <div class="row-end"><button class="btn ghost" data-close>Cancel</button><button class="btn danger" data-ok>${esc(okLabel)}</button></div>`,
    (d) => $('[data-ok]', d).onclick = () => { answer = true; d.close(); });
    dlg.addEventListener('close', () => resolve(answer));
  });
}

export async function busy(button, fn) {
  const label = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<span class="spinner"></span>';
  try {
    return await fn();
  } catch (e) {
    toast(e.message || 'Something went wrong', 'err');
    throw e;
  } finally {
    button.disabled = false;
    button.innerHTML = label;
  }
}

// ---------------------------------------------------------------------------
// Trading-day status and the news banner
// ---------------------------------------------------------------------------

export function dayStatus(date) {
  const r = store.cal.get(date);
  if (isWeekend(date)) return { kind: 'WEEKEND' };
  if (r?.is_trading_day === false) return { kind: 'OFF', label: r.news_label };
  const kind = r?.news_status || 'NORMAL';
  // Coach's rule: no high or medium-impact news that day means no trading.
  if (kind === 'NORMAL' && !r?.news_label && store.settings.news_days_only !== false) {
    return { kind: 'NO_TRADE', label: 'No high or medium-impact news', noNews: true };
  }
  return { kind, label: r?.news_label, after: r?.trade_allowed_after?.slice(0, 5) };
}

export function newsBanner(date) {
  const st = dayStatus(date);
  if (st.kind === 'NO_TRADE') {
    return `<div class="banner banner-red"><strong>NO TRADE DAY</strong>${st.label ? ` · ${esc(st.label)}` : ''}
      <span>Showing up and not trading is a win today. Mark NO ENTRY.</span></div>`;
  }
  if (st.kind === 'RESTRICTED') {
    const after = st.after ? `Trade only after ${fmtTime12(st.after)} New York (${nyTimeInManila(date, st.after)} PH time).` : 'High-impact news today. Check the time before you enter.';
    return `<div class="banner banner-amber"><strong>NEWS DAY</strong>${st.label ? ` · ${esc(st.label)}` : ''}<span>${after}</span></div>`;
  }
  if (st.kind === 'WEEKEND') return `<div class="banner banner-calm"><strong>Weekend</strong><span>Markets are closed. Rest, review, and come back Monday.</span></div>`;
  if (st.kind === 'OFF') return `<div class="banner banner-calm"><strong>No session</strong>${st.label ? ` · ${esc(st.label)}` : ''}<span>Not counted as a trading day.</span></div>`;
  return `<div class="banner banner-green"><strong>Trading day</strong>${st.label ? ` · ${esc(st.label)}` : ''}<span>${st.label ? 'News is out there today. Trade your plan, or wait for it.' : 'Trade your plan, or wait for it.'}</span></div>`;
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

export function markPill(mark) {
  if (!mark) return '<span class="pill pill-blank">Not checked in</span>';
  return `<span class="pill pill-${mark.toLowerCase()}">${MARKS[mark].glyph} ${MARKS[mark].label}</span>`;
}

export function checkInSummary(ci) {
  const bits = [];
  if (ci.setup) bits.push(esc(ci.setup));
  if (ci.session) bits.push(esc(ci.session));
  if (ci.mistake_tags?.length) bits.push(ci.mistake_tags.map(esc).join(', '));
  if (ci.no_entry_reason) bits.push(esc(NO_ENTRY_REASONS.find((r) => r.id === ci.no_entry_reason)?.label));
  const coach = ci.coach_status === 'invalid'
    ? `<div class="coach-flag bad"><strong>Coach: not valid, counts as X.</strong>${ci.coach_note ? ` ${esc(ci.coach_note)}` : ''}</div>`
    : ci.coach_status === 'valid' ? `<div class="coach-flag good">Coach verified ✓${ci.coach_note ? ` · ${esc(ci.coach_note)}` : ''}</div>` : '';
  return `${markPill(ci.mark)}${bits.length ? `<div class="muted small">${bits.join(' · ')}</div>` : ''}
    ${ci.auto_flags?.length ? `<ul class="flags">${ci.auto_flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    ${ci.reason_note ? `<blockquote>${esc(ci.reason_note)}</blockquote>` : ''}${coach}`;
}

export function stat(label, value, sub = '', tone = '') {
  return `<div class="stat ${tone}"><div class="stat-label">${esc(label)}</div><div class="stat-value">${value}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
}

export function monthNav(month) {
  return `<div class="month-nav">
    <button class="icon-btn" data-month="-1" aria-label="Previous month">‹</button>
    <strong>${new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(month + 'T00:00:00Z'))}</strong>
    <button class="icon-btn" data-month="1" aria-label="Next month">›</button>
  </div>`;
}

// Mon–Fri calendar for a month. cell(date) returns { cls, html, attrs }.
export function monthGrid(month, cell) {
  const end = monthEnd(month);
  let html = '<div class="grid-cal"><div class="gc-head">Mon</div><div class="gc-head">Tue</div><div class="gc-head">Wed</div><div class="gc-head">Thu</div><div class="gc-head">Fri</div>';
  for (let wk = weekStart(monthStart(month)); wk <= end; wk = addDays(wk, 7)) {
    for (let i = 0; i < 5; i++) {
      const d = addDays(wk, i);
      if (d < month || d > end) { html += '<div class="gc-cell gc-empty"></div>'; continue; }
      const c = cell(d);
      html += `<div class="gc-cell ${c.cls ?? ''}" ${c.attrs ?? ''}><span class="gc-day">${Number(d.slice(8))}</span>${c.html ?? ''}</div>`;
    }
  }
  return html + '</div>';
}

export function legend() {
  return `<div class="legend">
    <span><i class="sw sw-check"></i>Followed rules</span>
    <span><i class="sw sw-no_entry"></i>No entry</span>
    <span><i class="sw sw-x"></i>Broke rules</span>
    <span><i class="sw sw-blank"></i>No check-in</span>
    <span><i class="sw sw-notrade"></i>No-trade day</span>
  </div>`;
}

export function calCell(date, ci, today) {
  const st = dayStatus(date);
  const m = effMark(ci);
  const cls = [m ? `gc-${m.toLowerCase()}` : date < today && st.kind !== 'OFF' ? 'gc-missed' : '', st.kind === 'NO_TRADE' ? 'gc-notrade' : '', st.kind === 'RESTRICTED' ? 'gc-news' : '', st.kind === 'OFF' ? 'gc-off' : '', date === today ? 'gc-today' : ''].join(' ');
  const glyph = m ? `<span class="gc-mark">${MARKS[m].glyph}</span>${ci.coach_status === 'invalid' ? '<span class="gc-coach">coach</span>' : ''}` : '';
  return { cls, html: glyph, attrs: `title="${esc(fmtLong(date) + (st.label ? ' · ' + st.label : ''))}"` };
}

export function progressBar(value, tone = '') {
  const v = Math.max(0, Math.min(1, value ?? 0));
  return `<div class="bar ${tone}"><div style="width:${(v * 100).toFixed(1)}%"></div></div>`;
}
