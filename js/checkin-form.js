// The daily check-in form: ✓ (followed my rules) or X (broke my rules). Until a student
// picks one, the day is "No check-in". A ✓ day may have no trades (not trading when there
// was no setup, or on a no-trade day, is following the rules). Any trades posted are run
// through the rule check, which turns a ✓ into an X when a rule was broken.
import { api } from './api.js';
import { MARKS, MISTAKE_TAGS } from './config.js';
import { checkDay } from './rules.js';
import { loadImages, openTradeForm, tradeCard } from './trades-ui.js';
import { $, busy, confirmBox, dayStatus, esc, toast } from './ui.js';

const chip = (value, label, on) => `<button type="button" class="chip${on ? ' on' : ''}" data-value="${esc(value)}">${esc(label)}</button>`;

/**
 * Students: pass rulebook, dayTrades (this day's posts) and weekTrades (the rest of that week).
 * Admin: pass admin: true to set or fix a mark without trade posts.
 */
export function mountMarkForm(el, { studentId, date, existing, onSaved, onCancel, onTradesChange, admin = false, rulebook = null, dayTrades = [], weekTrades = [] }) {
  const st = dayStatus(date);
  const noTrade = st.kind === 'NO_TRADE';
  const trades = [...dayTrades];
  const s = {
    chosen: existing?.mark ?? null, // what the student tapped
    mark: existing?.mark ?? null,   // what will be saved (a ✓ that breaks a rule becomes X)
    tags: new Set(existing?.mistake_tags ?? []),
    note: existing?.reason_note ?? '',
    ticked: new Set(existing?.rules_ticked ?? []),
  };
  const marked = (m) => m === 'CHECK' || m === 'X';

  const flags = () => checkDay({
    status: st,
    dayTrades: trades,
    weekTrades: [...weekTrades.filter((t) => t.date !== date), ...trades],
    rulebook,
    ticked: [...s.ticked],
  });

  function valid() {
    if (s.mark === 'X') return s.tags.size > 0 || s.note.trim().length > 0 || (admin ? existing?.auto_flags?.length > 0 : flags().length > 0);
    if (s.mark !== 'CHECK') return false;
    if (admin) return true;
    // Trades are checked against the student's own rules, so those must exist first.
    if (trades.length && !rulebook) return false;
    return flags().length === 0;
  }

  function tradesSection() {
    if (admin) return '';
    const f = flags();
    const rules = rulebook?.personal_rules ?? [];
    return `
      <label class="field-label">Your trades today</label>
      <div class="trade-list">${trades.map((t) => tradeCard(t, { actions: true })).join('') || `<p class="muted small">${s.mark === 'CHECK'
        ? 'Didn\'t trade? Leave this empty. Not trading when there\'s no valid setup, or on a no-trade day, is following your rules.'
        : 'If you took a trade, post it: one post per trade, with MT5 chart execution and trade history screenshots, plus your thought process.'}</p>`}</div>
      ${rulebook
        ? '<button type="button" class="btn ghost block" data-add-trade>+ Post a trade</button>'
        : '<div class="banner banner-amber"><strong>Set your rules before posting trades</strong><span>Your trades are checked against your own risk rules. It takes a minute. <a href="#/rules">Set my rules →</a></span></div>'}
      ${trades.length && rules.length ? `
        <label class="field-label">My rules: tick each one you followed</label>
        <div class="checklist">${rules.map((r) => `<label class="check"><input type="checkbox" data-rule="${esc(r)}" ${s.ticked.has(r) ? 'checked' : ''}> ${esc(r)}</label>`).join('')}</div>` : ''}
      ${trades.length && rulebook ? (f.length
        ? `<div class="banner banner-red"><strong>RULE CHECK · THIS IS AN X</strong>${f.map((x) => `<span>• ${esc(x)}</span>`).join('')}</div>`
        : `<div class="banner banner-green"><strong>RULE CHECK PASSED</strong><span>Risk ${esc(rulebook.max_risk_pct)}% max, ${rulebook.max_trades_day}/day, ${rulebook.max_trades_week}/week${rulebook.max_daily_loss_r ? `, ${rulebook.max_daily_loss_r}R daily stop` : ''}. All within your rules.</span></div>`) : ''}`;
  }

  function detail() {
    if (marked(s.mark)) {
      const xPart = s.mark === 'X' ? `
        <label class="field-label">What did you do wrong? ${flags().length && !admin ? '<span class="muted small">(optional, the rule check already found it)</span>' : '<span class="req">Required</span>'}</label>
        <div class="chips" data-group="tags">${MISTAKE_TAGS.map((x) => chip(x, x, s.tags.has(x))).join('')}</div>
        <textarea class="input" data-note rows="3" placeholder="What happened? e.g. entered before the MSS, no liquidity sweep">${esc(s.note)}</textarea>
        <p class="hint">Be honest. An X with a clear reason is how you improve. A win on a broken rule is worse than a loss on a followed plan.</p>` : '';
      return tradesSection() + xPart;
    }
    return '';
  }

  function render() {
    onTradesChange?.([...trades]);
    // A ✓ that breaks a rule is an X. It goes back to ✓ once the problem is fixed.
    s.mark = !admin && s.chosen === 'CHECK' && trades.length && flags().length ? 'X' : s.chosen;
    el.innerHTML = `
      <div class="mark-buttons">
        ${['CHECK', 'X'].map((m) => `
          <button type="button" class="mark-btn m-${m.toLowerCase()}${s.mark === m ? ' on' : ''}" data-mark="${m}">
            <span class="mark-glyph">${MARKS[m].glyph}</span><span>${MARKS[m].label}</span>
          </button>`).join('')}
      </div>
      ${!s.mark ? '<p class="hint">Not checked in yet. Until you tap ✓ or X, today counts as <strong>No check-in</strong> (0).</p>' : ''}
      ${noTrade ? '<p class="hint warn">No-trade day. Didn\'t trade? Tap ✓, you followed the rule. Traded anyway? That\'s an X.</p>' : ''}
      ${s.mark ? `<div class="mark-detail">${detail()}</div>` : ''}
      ${s.mark ? `<div class="row-end">
        ${onCancel ? '<button type="button" class="btn ghost" data-cancel>Cancel</button>' : ''}
        <button type="button" class="btn primary" data-save ${valid() ? '' : 'disabled'}>Save check-in</button>
      </div>` : ''}`;
    loadImages(el);
  }

  el.addEventListener('click', async (e) => {
    const markBtn = e.target.closest('[data-mark]');
    if (markBtn && !markBtn.disabled) {
      s.chosen = markBtn.dataset.mark;
      return render();
    }
    const c = e.target.closest('.chip');
    if (c) {
      const group = c.closest('[data-group]').dataset.group;
      const v = c.dataset.value;
      if (group === 'tags') s.tags.has(v) ? s.tags.delete(v) : s.tags.add(v);
      else s[group] = s[group] === v ? null : v;
      return render();
    }
    if (e.target.closest('[data-add-trade]')) {
      return openTradeForm({ studentId, date, onSaved: (t) => { trades.push(t); render(); } });
    }
    const card = e.target.closest('[data-trade]');
    if (card && e.target.closest('[data-edit-trade]')) {
      const t = trades.find((x) => x.id === card.dataset.trade);
      return openTradeForm({ studentId, date, trade: t, onSaved: (saved) => { trades.splice(trades.indexOf(t), 1, saved); render(); } });
    }
    if (card && e.target.closest('[data-del-trade]')) {
      const t = trades.find((x) => x.id === card.dataset.trade);
      if (!(await confirmBox(`Delete the ${t.symbol} trade?`))) return;
      await api.deleteTrade(t.id);
      for (const p of [t.mt5_path, t.chart_path]) if (p && p !== 'sample') api.deleteImage(p).catch(() => {});
      trades.splice(trades.indexOf(t), 1);
      return render();
    }
    if (e.target.closest('[data-cancel]')) return onCancel?.();
    const save = e.target.closest('[data-save]');
    if (save) {
      const row = {
        id: existing?.id,
        student_id: studentId,
        date,
        mark: s.mark,
        setup: trades[0]?.setup ?? (admin ? existing?.setup ?? null : null),
        session: trades[0]?.session ?? (admin ? existing?.session ?? null : null),
        mistake_tags: s.mark === 'X' ? [...s.tags] : [],
        reason_note: s.mark === 'X' ? s.note.trim() || null : null,
        no_entry_reason: null,
        auto_flags: admin ? existing?.auto_flags ?? [] : flags(),
        rules_ticked: trades.length ? [...s.ticked] : [],
      };
      const saved = await busy(save, () => api.saveCheckIn(row));
      toast(s.mark === 'X' ? 'Logged. Own it, learn it, come back tomorrow.' : trades.length ? 'Checked in. Discipline +1' : 'Checked in. Not trading without a setup is discipline too.');
      onSaved?.(saved);
    }
  });
  el.addEventListener('change', (e) => {
    if (e.target.matches('[data-rule]')) {
      const r = e.target.dataset.rule;
      e.target.checked ? s.ticked.add(r) : s.ticked.delete(r);
      render();
    }
  });
  el.addEventListener('input', (e) => {
    if (e.target.matches('[data-note]')) {
      s.note = e.target.value;
      const btn = $('[data-save]', el);
      if (btn) btn.disabled = !valid();
    }
  });
  render();
}
