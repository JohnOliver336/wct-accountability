// The daily check-in form: ✓ (followed my rules) or X (broke my rules). Until a student
// picks one, the day is "No check-in". A ✓ day may have no trades (not trading when there
// was no setup, or on a no-trade day, is following the rules). Any trades posted are run
// through the rule check, which turns a ✓ into an X when a rule was broken.
// A ✓ with no trades on a day trading was allowed needs proof the student watched the market:
// what they watched, the setup they waited for, why it didn't form, and a chart screenshot.
import { api } from './api.js';
import { MARKS, MISTAKE_TAGS, SESSIONS, SETUPS } from './config.js';
import { checkDay } from './rules.js';
import { SYMBOLS, loadImages, openTradeForm, prepareShot, tradeCard } from './trades-ui.js';
import { $, busy, confirmBox, dayStatus, esc, toast } from './ui.js';

const chip = (value, label, on) => `<button type="button" class="chip${on ? ' on' : ''}" data-value="${esc(value)}">${esc(label)}</button>`;

// Words with real letters in them, so "asdf ..." padding or symbols don't count.
const realWords = (t) => t.trim().split(/\s+/).filter((w) => /[a-z]{2,}/i.test(w));
const sameText = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function proofProblem(p, hasShot) {
  if (!p.market.trim()) return 'Add the market you watched.';
  if (!p.session) return 'Pick the session you watched.';
  if (!p.waited_for) return 'Pick the setup you were waiting for.';
  const words = realWords(p.why);
  if (p.why.trim().length < 40 || words.length < 8) return 'Explain why there was no trade: at least 8 words about what price did.';
  if (new Set(words.map((w) => w.toLowerCase())).size < words.length / 2) return 'Your explanation repeats the same words. Describe what price actually did today.';
  if (!hasShot) return 'Add a screenshot of the chart you watched.';
  return null;
}

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
  const proof = { market: '', session: '', waited_for: '', why: '', chart_path: null, ...(existing?.no_trade_proof ?? {}) };
  let shot = null; // a newly picked chart screenshot: { blob, hash }
  const proofOn = () => !admin && s.mark === 'CHECK' && !trades.length && !noTrade;
  const problem = () => (proofOn() ? proofProblem(proof, !!(shot || proof.chart_path)) : null);

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
    if (problem()) return false;
    return flags().length === 0;
  }

  function proofSection() {
    if (!proofOn()) return '';
    const opts = (list, v) => `<option value="">Choose…</option>${list.map((x) => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('')}`;
    return `
      <div class="proof-box">
        <div class="field-label">No trade today? Show what you watched <span class="req">Required</span></div>
        <p class="muted small">Waiting for a valid setup is discipline. Show your coach you were in front of the chart.</p>
        <div class="form-row">
          <label>Market watched<input class="input" data-proof="market" list="proof-symbols" value="${esc(proof.market)}" placeholder="NAS100"></label>
          <label>Session watched<select class="input" data-proof="session">${opts(SESSIONS.map((x) => x.name), proof.session)}</select></label>
          <label>Setup you waited for<select class="input" data-proof="waited_for">${opts(SETUPS, proof.waited_for)}</select></label>
        </div>
        <datalist id="proof-symbols">${SYMBOLS.map((x) => `<option value="${x}">`).join('')}</datalist>
        <label class="field-label">Why didn't it form?</label>
        <textarea class="input" data-proof="why" rows="3" placeholder="e.g. Price swept the Asia low but never shifted structure on the 3m. No MSS, no FVG to enter, so I stayed out.">${esc(proof.why)}</textarea>
        <label class="field-label">Screenshot of the chart you watched</label>
        <input class="input" type="file" accept="image/*" data-proof-file>
        ${shot ? `<img class="proof-thumb" src="${URL.createObjectURL(shot.blob)}" alt="Chart you watched">`
          : proof.chart_path ? `<img class="proof-thumb" data-path="${esc(proof.chart_path)}" alt="Chart you watched">` : ''}
        <p class="hint">Tip: on a computer you can paste a screenshot with Ctrl+V.</p>
        <p class="hint warn">Fake, random or copy-pasted proof counts as an X. Do it again and you lose your chance at a prize.</p>
        <p class="hint" data-proof-hint>${esc(problem() ?? '')}</p>
      </div>`;
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
      return tradesSection() + proofSection() + xPart;
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
      const needProof = proofOn();
      const oldShot = existing?.no_trade_proof?.chart_path ?? null;
      let no_trade_proof = null;
      if (needProof) {
        try {
          no_trade_proof = await busy(save, async () => {
            // The same explanation as another day is a copy, not today's market.
            const why = sameText(proof.why);
            const copied = (await api.myCheckIns(studentId)).find((c) => c.date !== date && c.no_trade_proof?.why && sameText(c.no_trade_proof.why) === why);
            if (copied) throw new Error(`You wrote this exact explanation on ${copied.date}. Describe what price did today.`);
            const chart_path = shot ? await api.uploadExecution(studentId, shot.blob, shot.hash) : proof.chart_path;
            return { market: proof.market.trim().toUpperCase(), session: proof.session, waited_for: proof.waited_for, why: proof.why.trim(), chart_path };
          });
        } catch { return; }
      }
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
        ...(admin ? {} : { no_trade_proof }),
      };
      const saved = await busy(save, () => api.saveCheckIn(row));
      // The old proof screenshot is no longer used (replaced, or the day now has trades).
      if (!admin && oldShot && oldShot !== no_trade_proof?.chart_path) api.deleteImage(oldShot).catch(() => {});
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
    if (e.target.matches('[data-note]')) s.note = e.target.value;
    else if (e.target.matches('[data-proof]')) {
      proof[e.target.dataset.proof] = e.target.value;
      const hint = $('[data-proof-hint]', el);
      if (hint) hint.textContent = problem() ?? '';
    } else return;
    const btn = $('[data-save]', el);
    if (btn) btn.disabled = !valid();
  });
  const setShot = async (file) => {
    const picked = await prepareShot(file);
    if (picked) shot = picked;
    render();
  };
  el.addEventListener('change', (e) => {
    if (e.target.matches('[data-proof-file]')) setShot(e.target.files[0]);
  });
  el.addEventListener('paste', (e) => {
    if (!proofOn()) return;
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    setShot(item.getAsFile());
  });
  render();
}
