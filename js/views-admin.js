import { api, DEMO } from './api.js';
import { mountMarkForm } from './checkin-form.js';
import { addDays, addMonths, fmtDate, fmtLong, monthEnd, monthStart, nyDateOf, weekStart } from './dates.js';
import { challengeStatus, daysSilent, effMark, indexMarks, lastCheckIn, rankCompare, streaks, studentStart, summarize, tradingDays } from './metrics.js';
import { batchName, batchOf, ctx, loadReference, store } from './store.js';
import { loadImages, tradeCard } from './trades-ui.js';
import { $, $$, busy, calCell, checkInSummary, confirmBox, dayStatus, esc, legend, monthGrid, monthNav, openModal, pct, progressBar, stat, toast } from './ui.js';
import { STATE_COPY, rulebookSummary } from './views-student.js';

const HISTORY_DAYS = 150;

async function loadAdmin(month) {
  const [students, rows] = await Promise.all([
    api.listStudents(),
    api.listCheckIns(addDays(month, -HISTORY_DAYS), monthEnd(month)),
  ]);
  return { students: students.filter((s) => s.role !== 'admin'), marks: indexMarks(rows), rows };
}

function metricsFor(s, marks, month) {
  const m = marks.get(s.id) ?? new Map();
  const c = ctx(s, m);
  const sum = summarize({ ...c, from: month, to: monthEnd(month) });
  return { s, m, sum, st: streaks(c), last: lastCheckIn(m), silent: daysSilent(c) };
}

function batchFilter(selected) {
  return `<select class="input slim" data-batch>
    <option value="">All batches</option>
    ${store.batches.map((b) => `<option value="${b.id}" ${b.id === selected ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
  </select>`;
}

// ---------------------------------------------------------------------------
// CSV export, same shape as the October sheet
// ---------------------------------------------------------------------------

function exportCsv(month, students, marks) {
  const days = tradingDays(month, monthEnd(month), store.cal);
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const glyph = { CHECK: '✓', X: 'X', NO_ENTRY: 'NO ENTRY' };
  const lines = [
    ['#', 'Batch', 'Student Name', ...days.map((d) => fmtDate(d, { month: 'short', day: 'numeric' })), '✓', 'X', 'NO ENTRY', 'Check-ins', 'Check-in %', 'Followed rules %', 'Notes / Reason'].map(q).join(','),
    ['', '', 'News', ...days.map((d) => store.cal.get(d)?.news_label ?? ''), '', '', '', '', '', '', ''].map(q).join(','),
  ];
  students.forEach((s, i) => {
    const m = marks.get(s.id) ?? new Map();
    const sum = summarize({ ...ctx(s, m), from: month, to: monthEnd(month) });
    const notes = days.filter((d) => m.get(d)?.mark === 'X')
      .map((d) => `${fmtDate(d, { month: 'short', day: 'numeric' })}: ${[...(m.get(d).mistake_tags || []), m.get(d).reason_note].filter(Boolean).join(' – ')}`)
      .join(' | ');
    lines.push([i + 1, batchName(s), s.full_name, ...days.map((d) => glyph[m.get(d)?.mark] ?? ''), sum.check, sum.x, sum.noEntry, sum.checkIns, pct(sum.checkInRate), pct(sum.rulesRate), notes].map(q).join(','));
  });
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Accountability_Checkin_${fmtDate(month, { month: 'long', year: 'numeric' }).replace(' ', '_')}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------------------
// Signs a day's log may not be genuine. These are prompts for the coach, not verdicts.
// ---------------------------------------------------------------------------

function buildSignals(checkIns, trades, students) {
  const nameOf = (id) => students.find((s) => s.id === id)?.full_name ?? 'someone';
  const byTicket = new Map();
  const byThought = new Map();
  const byChart = new Map();
  for (const t of trades) {
    const push = (map, key) => { if (!key) return; if (!map.has(key)) map.set(key, []); map.get(key).push(t); };
    push(byTicket, t.ticket?.trim());
    push(byThought, t.thoughts?.trim().toLowerCase());
    push(byChart, t.chart_url?.trim().replace(/\/$/, ''));
  }
  const out = new Map();
  for (const ci of checkIns) {
    const list = [];
    const logged = ci.created_at ? nyDateOf(ci.created_at) : null;
    if (logged && logged > ci.date) {
      const late = Math.round((new Date(logged) - new Date(ci.date)) / 864e5);
      if (late >= 1) list.push(`Logged ${late} day${late > 1 ? 's' : ''} after the trading day`);
    }
    if (ci.edited_at) list.push('Changed after it was first saved');
    for (const t of trades.filter((x) => x.student_id === ci.student_id && x.date === ci.date)) {
      const dupT = (byTicket.get(t.ticket?.trim()) ?? []).filter((o) => o.id !== t.id);
      if (dupT.length) list.push(`MT5 ticket #${t.ticket} also posted ${dupT.map((o) => `${o.student_id === t.student_id ? 'by them' : `by ${nameOf(o.student_id)}`} on ${fmtDate(o.date, { month: 'short', day: 'numeric' })}`).join(', ')}`);
      const dupC = (byChart.get(t.chart_url?.trim().replace(/\/$/, '')) ?? []).filter((o) => o.id !== t.id);
      if (dupC.length) list.push(`Same chart link as a post on ${fmtDate(dupC[0].date, { month: 'short', day: 'numeric' })}${dupC[0].student_id !== t.student_id ? ` by ${nameOf(dupC[0].student_id)}` : ''}`);
      const dupTh = (byThought.get(t.thoughts?.trim().toLowerCase()) ?? []).filter((o) => o.id !== t.id);
      if (dupTh.length) list.push(`Thought process copied word for word from ${fmtDate(dupTh[0].date, { month: 'short', day: 'numeric' })}`);
      if (!t.ticket) list.push(`${t.symbol}: no MT5 ticket number given`);
    }
    if (list.length) out.set(ci.id, [...new Set(list)]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Export for Claude: one JSON file with everything needed to audit the month
// ---------------------------------------------------------------------------

const CLAUDE_PROMPT = `You are helping a trading coach (Winner Circle Traders, 30-Day Development Program) review a month of student accountability check-ins. Each student sets their own rules (max risk per trade, max trades per day/week, daily stop, personal rules). Each trading day they mark CHECK (followed my rules), X (broke my rules) or NO_ENTRY (showed up, no trade). CHECK and X days must include trade posts with an MT5 execution screenshot, a TradingView chart link and their thought process.

Scoring: discipline % = CHECK / (CHECK + X). NO_ENTRY is attendance only. A day the coach marked "invalid" counts as X (see effective_mark). P&L never counts.

Please produce:
1. DISCIPLINE RANKING: the top 10 by discipline % (ties: check-in rate, then number of CHECK days). Name anyone with fewer than 3 traded days separately, since their % means little.
2. RELIABILITY REVIEW: students whose logs may not be genuine. For each, list the concrete evidence from the data, e.g. the "signals" field, CHECK days whose trades break the student's own rulebook (risk, trade count, daily stop, news days) without being flagged, thought processes that are generic, vague or copied, results that look too perfect, entries outside their stated session, days logged late or edited, every day NO_ENTRY with perfect attendance, missing ticket numbers. Rate each low / medium / high concern. Don't accuse anyone: present the evidence and let the coach decide. Also say which students look clearly genuine.
3. MISTAKE PATTERNS: the most common rule breaks this month and one suggested topic for the next Saturday lesson.
4. FOLLOW-UPS: who to message this week (gone quiet, repeated X, high concern), each with a one-line suggested message.
Keep it short, use tables where it helps. Answer in English.`;

async function exportForClaude(month, students, marks) {
  const from = month, to = monthEnd(month);
  const [trades, books] = await Promise.all([api.listAllTrades(addDays(from, -60), to), api.listAllRulebooks(month)]);
  const checkIns = students.flatMap((s) => [...(marks.get(s.id)?.values() ?? [])]).filter((c) => c.date >= addDays(from, -60) && c.date <= to);
  const signals = buildSignals(checkIns, trades, students);
  const days = tradingDays(from, to, store.cal);

  const rows = students.map((s) => {
    const m = marks.get(s.id) ?? new Map();
    const c = ctx(s, m);
    const sum = summarize({ ...c, from, to });
    const st = streaks(c);
    const rb = books.find((b) => b.student_id === s.id);
    return {
      name: s.full_name,
      batch: batchName(s),
      counts_from: studentStart(s, batchOf(s)),
      rulebook: rb ? { max_risk_pct: Number(rb.max_risk_pct), max_trades_day: rb.max_trades_day, max_trades_week: rb.max_trades_week, daily_stop_r: rb.max_daily_loss_r ? Number(rb.max_daily_loss_r) : null, personal_rules: rb.personal_rules, set_on: nyDateOf(rb.created_at) } : null,
      summary: {
        expected_days: sum.elapsed, check: sum.check, x: sum.x, no_entry: sum.noEntry, missed: sum.missed,
        check_in_rate: sum.checkInRate == null ? null : Math.round(sum.checkInRate * 100),
        discipline_pct: sum.rulesRate == null ? null : Math.round(sum.rulesRate * 100),
        rule_streak_now: st.rule, best_rule_streak: st.best,
      },
      _sum: sum,
      days: days.filter((d) => m.has(d)).map((d) => {
        const ci = m.get(d);
        return {
          date: d,
          news: store.cal.get(d)?.news_label ?? null,
          mark: ci.mark,
          effective_mark: effMark(ci),
          logged_at: ci.created_at,
          edited_at: ci.edited_at ?? null,
          no_entry_reason: ci.no_entry_reason,
          mistake_tags: ci.mistake_tags ?? [],
          note: ci.reason_note,
          auto_rule_check_flags: ci.auto_flags ?? [],
          personal_rules_ticked: ci.rules_ticked ?? [],
          coach_status: ci.coach_status ?? null,
          coach_note: ci.coach_note ?? null,
          signals: signals.get(ci.id) ?? [],
          trades: trades.filter((t) => t.student_id === s.id && t.date === d).map((t) => ({
            symbol: t.symbol, direction: t.direction, entry_model: t.setup, session: t.session,
            entry_time_ny: t.entry_time_ny?.slice(0, 5) ?? null, risk_pct: Number(t.risk_pct), result_r: Number(t.result_r),
            mt5_ticket: t.ticket, chart_url: t.chart_url, has_mt5_screenshot: !!t.mt5_path, thoughts: t.thoughts, posted_at: t.created_at,
          })),
        };
      }),
    };
  });
  const ranking = rows.filter((r) => r._sum.elapsed > 0).sort((a, b) => rankCompare(a._sum, b._sum))
    .map((r, i) => ({ rank: i + 1, name: r.name, batch: r.batch, discipline_pct: r.summary.discipline_pct, check_in_rate: r.summary.check_in_rate, check: r.summary.check, x: r.summary.x }));
  rows.forEach((r) => delete r._sum);

  const payload = {
    instructions_for_claude: CLAUDE_PROMPT,
    month: fmtDate(month, { month: 'long', year: 'numeric' }),
    generated_at: new Date().toISOString(),
    trading_days: days.map((d) => ({ date: d, news: store.cal.get(d)?.news_label ?? null, status: store.cal.get(d)?.news_status ?? 'NORMAL', trade_allowed_after_ny: store.cal.get(d)?.trade_allowed_after?.slice(0, 5) ?? null })),
    ranking,
    students: rows,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `WCT_Claude_Export_${fmtDate(month, { month: 'long', year: 'numeric' }).replace(' ', '_')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Downloaded. Give this file to Claude and ask it to follow the instructions inside.');
}

// ---------------------------------------------------------------------------
// Coach review: mark a logged day valid or not valid
// ---------------------------------------------------------------------------

function reviewButtons(ci) {
  return `<div class="row-gap review-actions" data-review="${ci.id}">
    <button type="button" class="btn small ${ci.coach_status === 'valid' ? 'primary' : 'ghost'}" data-verdict="valid">✓ Valid</button>
    <button type="button" class="btn small ${ci.coach_status === 'invalid' ? 'danger' : 'ghost danger'}" data-verdict="invalid">✗ Not valid (counts as X)</button>
    ${ci.coach_status ? '<button type="button" class="link" data-verdict="">Clear review</button>' : ''}
  </div>`;
}

// Wires the review buttons inside root, once. getCheckIns() returns the rows on screen.
function bindReview(root, getCheckIns, onDone) {
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-verdict]');
    if (!b) return;
    const ci = getCheckIns().find((c) => c.id === b.closest('[data-review]').dataset.review);
    const verdict = b.dataset.verdict || null;
    let note = ci.coach_note;
    if (verdict === 'invalid') {
      note = await new Promise((resolve) => {
        let value = null;
        const dlg = openModal(`<h3>Why is this not valid?</h3><p class="muted small">The student sees this note. The day counts as an X.</p>
          <form class="form" data-f><textarea class="input" name="note" rows="3" required placeholder="e.g. Screenshot shows the entry at 8:15, before the CPI rule">${esc(ci.coach_note ?? '')}</textarea>
          <div class="row-end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn danger">Mark not valid</button></div></form>`, (d) => {
          $('[data-f]', d).addEventListener('submit', (ev) => { ev.preventDefault(); value = new FormData(ev.target).get('note').trim(); d.close(); });
        });
        dlg.addEventListener('close', () => resolve(value));
      });
      if (note == null) return;
    }
    const saved = await busy(b, () => api.reviewCheckIn(ci.id, verdict, verdict ? note : null));
    Object.assign(ci, saved);
    toast(verdict === 'invalid' ? 'Marked not valid. It now counts as an X.' : verdict ? 'Verified' : 'Review cleared');
    onDone?.(ci);
  });
}

export async function viewAdminReview(root) {
  let filter = 'todo', batch = '', range = 14;
  let shown = [];
  bindReview(root, () => shown, () => render());

  async function render() {
    root.innerHTML = '<div class="loading">Loading…</div>';
    const from = addDays(store.today, -range);
    const [students, checkIns, trades, booksNow, booksPrev] = await Promise.all([
      api.listStudents(), api.listCheckIns(from, store.today), api.listAllTrades(addDays(from, -60), store.today),
      api.listAllRulebooks(monthStart(store.today)), api.listAllRulebooks(addMonths(store.today, -1)),
    ]);
    const books = [...booksNow, ...booksPrev];
    shown = checkIns;
    const signals = buildSignals(checkIns, trades, students);
    const studentOf = (id) => students.find((s) => s.id === id);
    const list = checkIns
      .filter((c) => c.mark !== 'NO_ENTRY' && studentOf(c.student_id)?.role !== 'admin')
      .filter((c) => !batch || studentOf(c.student_id)?.batch_id === batch)
      .filter((c) => filter === 'all' || (filter === 'todo' ? !c.coach_status : filter === 'flagged' ? signals.has(c.id) || c.auto_flags?.length : c.coach_status === 'invalid'))
      .sort((a, b) => b.date.localeCompare(a.date) || (signals.has(b.id) ? 1 : 0) - (signals.has(a.id) ? 1 : 0));
    const todo = checkIns.filter((c) => c.mark !== 'NO_ENTRY' && !c.coach_status).length;

    root.innerHTML = `
      <section class="hero row-between wrap"><div><div class="eyebrow">Admin</div><h1>Review trades</h1>
        <p class="muted">Check each trading day's proof. Mark it <strong>Not valid</strong> if the screenshot, chart or thought process doesn't back up the mark. It then counts as an X.</p></div></section>
      <div class="toolbar">
        <div class="seg">
          <button class="${filter === 'todo' ? 'on' : ''}" data-filter="todo">Needs review (${todo})</button>
          <button class="${filter === 'flagged' ? 'on' : ''}" data-filter="flagged">Flagged</button>
          <button class="${filter === 'invalid' ? 'on' : ''}" data-filter="invalid">Not valid</button>
          <button class="${filter === 'all' ? 'on' : ''}" data-filter="all">All</button>
        </div>
        ${batchFilter(batch)}
        <select class="input slim" data-range>${[7, 14, 30, 60].map((n) => `<option value="${n}" ${n === range ? 'selected' : ''}>Last ${n} days</option>`).join('')}</select>
      </div>
      ${list.map((ci) => {
        const s = studentOf(ci.student_id);
        const dayTrades = trades.filter((t) => t.student_id === ci.student_id && t.date === ci.date);
        const rb = books.find((b) => b.student_id === ci.student_id && b.month === monthStart(ci.date));
        const sig = signals.get(ci.id) ?? [];
        return `
          <div class="card review-card">
            <div class="row-between wrap">
              <div><a href="#/admin/student/${s?.id}"><strong>${esc(s?.full_name ?? '?')}</strong></a> <span class="muted small">${esc(batchName(s))} · ${esc(fmtLong(ci.date))}${store.cal.get(ci.date)?.news_label ? ` · ${esc(store.cal.get(ci.date).news_label)}` : ''}</span></div>
              ${reviewButtons(ci)}
            </div>
            <div class="done-state">${checkInSummary(ci)}</div>
            ${sig.length ? `<div class="banner banner-amber"><strong>WORTH A LOOK</strong>${sig.map((x) => `<span>• ${esc(x)}</span>`).join('')}</div>` : ''}
            ${dayTrades.map((t) => tradeCard(t)).join('') || '<p class="muted small">No trade posts on this day (logged before trade posts were required, or set by the coach).</p>'}
            ${rb ? `<details class="rb"><summary>Their rules for ${esc(fmtDate(rb.month, { month: 'long' }))}</summary>${rulebookSummary(rb)}</details>` : '<p class="muted small">No rules set for this month.</p>'}
          </div>`;
      }).join('') || '<div class="card muted center">Nothing to review here.</div>'}`;

    loadImages(root);
    $$('[data-filter]', root).forEach((b) => (b.onclick = () => { filter = b.dataset.filter; render(); }));
    $('[data-batch]', root).onchange = (e) => { batch = e.target.value; render(); };
    $('[data-range]', root).onchange = (e) => { range = Number(e.target.value); render(); };
  }
  await render();
}

// ---------------------------------------------------------------------------
// OVERVIEW
// ---------------------------------------------------------------------------

export async function viewAdminOverview(root) {
  let month = monthStart(store.today);
  let batch = '';

  async function render() {
    root.innerHTML = '<div class="loading">Loading…</div>';
    const { students, marks } = await loadAdmin(month);
    const active = students.filter((s) => s.status === 'active' && (!batch || s.batch_id === batch));
    const rows = active.map((s) => metricsFor(s, marks, month));
    const started = rows.filter((r) => r.sum.elapsed > 0);
    const tot = started.reduce((a, r) => ({ ci: a.ci + r.sum.checkIns, el: a.el + r.sum.elapsed, ok: a.ok + r.sum.check, x: a.x + r.sum.x }), { ci: 0, el: 0, ok: 0, x: 0 });
    const today = store.today;
    const isCurrent = month === monthStart(today);
    const expectedToday = active.filter((s) => studentStart(s, batchOf(s)) <= today && dayStatus(today).kind !== 'WEEKEND');
    const inToday = expectedToday.filter((s) => marks.get(s.id)?.has(today)).length;

    const ghosts = started.filter((r) => r.sum.checkIns === 0);
    const silent = rows.filter((r) => r.last && r.silent >= store.settings.inactive_days).sort((a, b) => b.silent - a.silent);
    const followUp = rows.filter((r) => r.sum.x >= store.settings.followup_threshold).sort((a, b) => b.sum.x - a.sum.x);

    // Weekly participation per batch.
    const weeks = [];
    for (let w = weekStart(month); w <= monthEnd(month); w = addDays(w, 7)) {
      const days = tradingDays(w < month ? month : w, addDays(w, 4) > monthEnd(month) ? monthEnd(month) : addDays(w, 4), store.cal).filter((d) => d <= today);
      if (days.length) weeks.push({ w, days });
    }
    const batches = store.batches.filter((b) => (!batch || b.id === batch) && active.some((s) => s.batch_id === b.id));
    const participation = batches.map((b) => {
      const members = active.filter((s) => s.batch_id === b.id);
      return {
        b,
        cells: weeks.map(({ days }) => {
          const eligible = members.filter((s) => studentStart(s, b) <= days.at(-1));
          const n = eligible.filter((s) => days.some((d) => marks.get(s.id)?.has(d))).length;
          return { n, of: eligible.length };
        }),
      };
    });

    // Mistake tags.
    const tagCounts = (from, to) => {
      const t = {};
      active.forEach((s) => marks.get(s.id)?.forEach((ci) => {
        if (ci.date >= from && ci.date <= to) (ci.mistake_tags || []).forEach((x) => (t[x] = (t[x] || 0) + 1));
      }));
      return Object.entries(t).sort((a, b) => b[1] - a[1]);
    };
    const weekTags = tagCounts(weekStart(today), today);
    const monthTags = tagCounts(month, monthEnd(month));
    const tagList = (list) => list.length ? `<ul class="bar-list">${list.slice(0, 8).map(([t, n]) => `<li><span>${esc(t)}</span>${progressBar(n / list[0][1], 'bar-red')}<b>${n}</b></li>`).join('')}</ul>` : '<p class="muted">None logged.</p>';
    const personRow = (r, right) => `<a class="list-row row-between" href="#/admin/student/${r.s.id}"><span><strong>${esc(r.s.full_name)}</strong> <span class="muted small">${esc(batchName(r.s))}</span></span><span class="small">${right}</span></a>`;

    root.innerHTML = `
      <section class="hero row-between wrap">
        <div><div class="eyebrow">Admin</div><h1>Overview</h1></div>
        <div class="row-gap">${batchFilter(batch)}<button class="btn ghost" data-export>Export CSV</button><button class="btn primary" data-export-ai>Export for Claude</button></div>
      </section>
      ${monthNav(month)}
      <div class="stats">
        ${isCurrent ? stat('Checked in today', `${inToday}<small> / ${expectedToday.length}</small>`, fmtDate(today), 'tone-gold') : ''}
        ${stat('Check-in rate', pct(tot.el ? tot.ci / tot.el : null), `${tot.ci} of ${tot.el} student-days`)}
        ${stat('Discipline', pct(tot.ok + tot.x ? tot.ok / (tot.ok + tot.x) : null), `${tot.ok} ✓ · ${tot.x} X`)}
        ${stat('Never checked in', ghosts.length, `of ${started.length} students this month`, ghosts.length ? 'tone-red' : '')}
      </div>

      <div class="card">
        <h3>Weekly participation</h3>
        <p class="muted small">Students who checked in at least once that week.</p>
        ${weeks.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Batch</th>${weeks.map(({ w }) => `<th>Wk of ${esc(fmtDate(w, { month: 'short', day: 'numeric' }))}</th>`).join('')}</tr></thead>
          <tbody>${participation.map((p) => `<tr><td><strong>${esc(p.b.name)}</strong></td>${p.cells.map((c) => `<td><div class="part"><span>${c.n}/${c.of}</span>${progressBar(c.of ? c.n / c.of : 0, 'bar-gold')}</div></td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="muted">No trading days yet.</p>'}
      </div>

      <div class="two-col">
        <div class="card"><h3>Mistakes this week</h3><p class="muted small">Use this to shape Saturday's lesson.</p>${tagList(weekTags)}</div>
        <div class="card"><h3>Mistakes this month</h3>${tagList(monthTags)}</div>
      </div>

      <div class="three-col">
        <div class="card"><h3>Never checked in <span class="badge tone-red">${ghosts.length}</span></h3><p class="muted small">Biggest upside. Message them directly.</p>
          ${ghosts.map((r) => personRow(r, r.s.user_id ? 'has login' : '<span class="tone-red-text">no login yet</span>')).join('') || '<p class="muted">Everyone has checked in.</p>'}</div>
        <div class="card"><h3>Gone quiet <span class="badge tone-amber">${silent.length}</span></h3><p class="muted small">${store.settings.inactive_days}+ trading days without a check-in.</p>
          ${silent.map((r) => personRow(r, `${r.silent} days · last ${esc(fmtDate(r.last, { month: 'short', day: 'numeric' }))}`)).join('') || '<p class="muted">No one has gone quiet.</p>'}</div>
        <div class="card"><h3>Needs follow-up <span class="badge tone-amber">${followUp.length}</span></h3><p class="muted small">${store.settings.followup_threshold}+ X days this month.</p>
          ${followUp.map((r) => personRow(r, `${r.sum.x} X`)).join('') || '<p class="muted">No one over the threshold.</p>'}</div>
      </div>`;

    $('[data-export]', root).onclick = () => exportCsv(month, active.sort((a, b) => batchName(a).localeCompare(batchName(b)) || a.full_name.localeCompare(b.full_name)), marks);
    $('[data-export-ai]', root).onclick = (e) => busy(e.currentTarget, () => exportForClaude(month, active, marks));
    $('[data-batch]', root).onchange = (e) => { batch = e.target.value; render(); };
  }

  root.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-month]');
    if (nav) { month = addMonths(month, Number(nav.dataset.month)); render(); }
  });
  await render();
}

// ---------------------------------------------------------------------------
// STUDENTS (roster)
// ---------------------------------------------------------------------------

function studentForm(s = {}) {
  return `
    <h3>${s.id ? 'Edit student' : 'Add student'}</h3>
    <form class="form" data-form>
      <label>Full name<input class="input" name="full_name" required value="${esc(s.full_name)}"></label>
      <label>Email <span class="muted small">(they sign up with this)</span><input class="input" type="email" name="email" required value="${esc(s.email)}"></label>
      <div class="form-row">
        <label>Batch<select class="input" name="batch_id"><option value="">No batch</option>${store.batches.map((b) => `<option value="${b.id}" ${b.id === s.batch_id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
        <label>Counts from<input class="input" type="date" name="joined_date" value="${esc(s.joined_date || store.today)}"></label>
      </div>
      <div class="form-row">
        <label>Status<select class="input" name="status"><option value="active">Active</option><option value="inactive" ${s.status === 'inactive' ? 'selected' : ''}>Inactive (hidden, can't sign up)</option></select></label>
        <label>Discord<input class="input" name="discord_handle" value="${esc(s.discord_handle)}" placeholder="optional"></label>
      </div>
      <p class="hint">Check-ins count from whichever is later: the batch start date or "Counts from".</p>
      <div class="row-end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div>
    </form>`;
}

export function editStudent(s, onDone) {
  openModal(studentForm(s), (dlg) => {
    $('[data-form]', dlg).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const row = { ...(s.id ? { id: s.id } : {}), full_name: f.full_name.trim(), email: f.email.trim().toLowerCase(), batch_id: f.batch_id || null, joined_date: f.joined_date, status: f.status, discord_handle: f.discord_handle.trim() || null };
      await busy(e.submitter, () => api.saveStudent(row));
      toast(s.id ? 'Saved' : `${row.full_name} added. They can now activate their account.`);
      dlg.close();
      onDone?.();
    });
  });
}

function bulkAdd(onDone) {
  openModal(`
    <h3>Add many students</h3>
    <p class="muted small">One per line: <code>Full name, email</code>. Paste straight from your sign-up sheet.</p>
    <form class="form" data-form>
      <textarea class="input mono" name="lines" rows="10" placeholder="Juan Dela Cruz, juan@gmail.com&#10;Maria Santos, maria@gmail.com" required></textarea>
      <div class="form-row">
        <label>Batch<select class="input" name="batch_id">${store.batches.map((b) => `<option value="${b.id}" ${b === store.batches.at(-1) ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
        <label>Counts from<input class="input" type="date" name="joined_date" value="${esc(store.batches.at(-1)?.start_date || store.today)}"></label>
      </div>
      <div data-preview class="small"></div>
      <div class="row-end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Add students</button></div>
    </form>`, (dlg) => {
    const parse = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const parts = l.split(/[,\t;]/).map((x) => x.trim()).filter(Boolean);
      const email = parts.find((p) => /@/.test(p));
      const name = parts.filter((p) => p !== email).join(' ');
      return { full_name: name, email: email?.toLowerCase(), ok: !!(name && email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)), raw: l };
    });
    const ta = $('textarea', dlg);
    ta.addEventListener('input', () => {
      const rows = parse(ta.value);
      const bad = rows.filter((r) => !r.ok);
      $('[data-preview]', dlg).innerHTML = `${rows.length - bad.length} ready${bad.length ? ` · <span class="tone-red-text">${bad.length} can't read: ${bad.map((b) => esc(b.raw)).join('; ')}</span>` : ''}`;
    });
    $('[data-form]', dlg).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const rows = parse(f.lines);
      if (rows.some((r) => !r.ok)) return toast('Fix the lines marked red first.', 'err');
      await busy(e.submitter, () => api.addStudents(rows.map(({ full_name, email }) => ({ full_name, email, batch_id: f.batch_id, joined_date: f.joined_date }))));
      toast(`${rows.length} students added`);
      dlg.close();
      onDone?.();
    });
  });
}

export async function viewAdminStudents(root) {
  const month = monthStart(store.today);
  let batch = '', q = '', status = 'active', sort = 'name', dir = 1;
  const { students, marks } = await loadAdmin(month);
  let data = students.map((s) => metricsFor(s, marks, month));

  function render() {
    const filtered = data
      .filter((r) => (!batch || r.s.batch_id === batch) && (status === 'all' || r.s.status === status))
      .filter((r) => !q || `${r.s.full_name} ${r.s.email}`.toLowerCase().includes(q.toLowerCase()));
    const key = {
      name: (r) => r.s.full_name.toLowerCase(),
      batch: (r) => batchName(r.s),
      checkin: (r) => r.sum.checkInRate ?? -1,
      rules: (r) => r.sum.rulesRate ?? -1,
      streak: (r) => r.st.rule,
      x: (r) => r.sum.x,
      last: (r) => r.last ?? '',
    }[sort];
    filtered.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * dir);
    const th = (k, label, cls = '') => `<th class="sortable ${cls}" data-sort="${k}">${label}${sort === k ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;

    $('[data-table]', root).innerHTML = `
      <table class="table">
        <thead><tr>${th('name', 'Student')}${th('batch', 'Batch', 'hide-sm')}${th('checkin', 'Check-in', 'num')}${th('rules', 'Rules', 'num')}${th('streak', '🔥', 'num')}${th('x', 'X', 'num')}${th('last', 'Last', 'hide-sm')}</tr></thead>
        <tbody>${filtered.map((r) => `
          <tr class="clickable" data-id="${r.s.id}">
            <td><div class="name">${esc(r.s.full_name)}${r.s.status === 'inactive' ? ' <span class="badge tone-muted">inactive</span>' : ''}</div>
              <div class="muted small">${esc(r.s.email)} · ${r.s.user_id ? '<span class="tone-green-text">activated</span>' : '<span class="tone-amber-text">not activated</span>'}</div></td>
            <td class="hide-sm">${esc(batchName(r.s))}</td>
            <td class="num">${pct(r.sum.checkInRate)}</td>
            <td class="num">${pct(r.sum.rulesRate)}</td>
            <td class="num">${r.st.rule}</td>
            <td class="num ${r.sum.x >= store.settings.followup_threshold ? 'tone-red-text' : ''}">${r.sum.x}</td>
            <td class="hide-sm small">${r.last ? esc(fmtDate(r.last, { month: 'short', day: 'numeric' })) : '—'}</td>
          </tr>`).join('') || '<tr><td colspan="7" class="center muted">No students match.</td></tr>'}
        </tbody>
      </table>`;
    $('[data-count]', root).textContent = `${filtered.length} students · rates are for ${fmtDate(month, { month: 'long' })}`;
  }

  const reload = async () => {
    const fresh = await loadAdmin(month);
    data = fresh.students.map((s) => metricsFor(s, fresh.marks, month));
    render();
  };

  root.innerHTML = `
    <section class="hero row-between wrap">
      <div><div class="eyebrow">Admin</div><h1>Students</h1></div>
      <div class="row-gap"><button class="btn ghost" data-bulk>Add many</button><button class="btn primary" data-add>+ Add student</button></div>
    </section>
    <div class="toolbar">
      <input class="input slim" type="search" placeholder="Search name or email" data-q>
      ${batchFilter(batch)}
      <select class="input slim" data-status><option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option></select>
    </div>
    <p class="muted small" data-count></p>
    <div class="card flush table-wrap" data-table></div>`;

  $('[data-q]', root).addEventListener('input', (e) => { q = e.target.value; render(); });
  $('[data-batch]', root).onchange = (e) => { batch = e.target.value; render(); };
  $('[data-status]', root).onchange = (e) => { status = e.target.value; render(); };
  $('[data-add]', root).onclick = () => editStudent({ batch_id: store.batches.at(-1)?.id, joined_date: store.batches.at(-1)?.start_date }, reload);
  $('[data-bulk]', root).onclick = () => bulkAdd(reload);
  root.addEventListener('click', (e) => {
    const h = e.target.closest('[data-sort]');
    if (h) { dir = sort === h.dataset.sort ? -dir : 1; sort = h.dataset.sort; return render(); }
    const tr = e.target.closest('tr[data-id]');
    if (tr) location.hash = `#/admin/student/${tr.dataset.id}`;
  });
  render();
}

// ---------------------------------------------------------------------------
// ONE STUDENT
// ---------------------------------------------------------------------------

export async function viewAdminStudent(root, [id]) {
  let month = monthStart(store.today);

  async function render() {
    const students = await api.listStudents();
    const s = students.find((x) => x.id === id);
    if (!s) { root.innerHTML = '<div class="card">Student not found.</div>'; return; }
    const [rows, trades, rulebook] = await Promise.all([api.myCheckIns(id), api.listTrades(id, month, monthEnd(month)), api.getRulebook(id, month)]);
    const m = new Map(rows.map((c) => [c.date, c]));
    const c = ctx(s, m);
    const sum = summarize({ ...c, from: month, to: monthEnd(month) });
    const st = streaks(c);
    const notes = rows.filter((r) => effMark(r) === 'X' && r.date >= month && r.date <= monthEnd(month)).sort((a, b) => b.date.localeCompare(a.date));

    root.innerHTML = `
      <a class="back" href="#/admin/students">‹ All students</a>
      <section class="hero row-between wrap">
        <div><div class="eyebrow">${esc(batchName(s))}</div><h1>${esc(s.full_name)}</h1>
          <p class="muted small">${esc(s.email)}${s.discord_handle ? ' · ' + esc(s.discord_handle) : ''} · ${s.user_id ? 'activated' : 'not activated yet'} · counts from ${esc(fmtDate(studentStart(s, batchOf(s))))}</p></div>
        <div class="row-gap"><button class="btn ghost" data-edit>Edit</button><button class="btn danger ghost" data-delete>Delete</button></div>
      </section>
      ${monthNav(month)}
      <div class="stats">
        ${stat('Check-in rate', pct(sum.checkInRate), `${sum.checkIns} of ${sum.elapsed} days`)}
        ${stat('Discipline', pct(sum.rulesRate), `${sum.check} ✓ · ${sum.x} X · ${sum.noEntry} no entry`)}
        ${stat('Rule streak', st.rule, `Best ${st.best}`, 'tone-gold')}
        ${stat('Trades posted', trades.length, lastCheckIn(m) ? `last check-in ${fmtDate(lastCheckIn(m), { month: 'short', day: 'numeric' })}` : 'no check-ins yet')}
      </div>
      <div class="card"><h3>Their rules for ${esc(fmtDate(month, { month: 'long' }))}</h3>
        ${rulebook ? rulebookSummary(rulebook) : '<p class="muted">Not set yet.</p>'}
      </div>
      <div class="card">
        <p class="muted small">Tap a day to see the trades, review it, or fix the mark.</p>
        ${monthGrid(month, (d) => { const cc = calCell(d, m.get(d), store.today); return { ...cc, cls: cc.cls + ' clickable', attrs: cc.attrs + ` data-day="${d}"` }; })}
        ${legend()}
      </div>
      <div class="card"><h3>X notes this month</h3>
        ${notes.map((n) => `<div class="note-row"><div class="muted small">${esc(fmtDate(n.date))}</div>${checkInSummary(n)}</div>`).join('') || '<p class="muted">None.</p>'}
      </div>`;

    $('[data-edit]', root).onclick = () => editStudent(s, render);
    $('[data-delete]', root).onclick = async () => {
      if (!(await confirmBox(`Delete ${s.full_name} and all their check-ins? To keep history, set them to Inactive instead.`))) return;
      await api.deleteStudent(s.id);
      toast('Deleted');
      location.hash = '#/admin/students';
    };
    $$('[data-day]', root).forEach((cell) => cell.addEventListener('click', () => {
      const d = cell.dataset.day;
      const existing = m.get(d);
      const dayTrades = trades.filter((t) => t.date === d);
      openModal(`<h3>${esc(fmtLong(d))}</h3><p class="muted small">${esc(s.full_name)}</p>
        ${existing ? `<div class="done-state">${checkInSummary(existing)}</div>
          ${dayTrades.map((t) => tradeCard(t)).join('')}
          ${existing.mark !== 'NO_ENTRY' ? reviewButtons(existing) : ''}
          <details class="rb"><summary>Change the mark</summary><div data-mf></div></details>
          <div class="row-start"><button class="btn danger ghost small" data-clear>Clear this day</button></div>` : '<div data-mf></div>'}`, (dlg) => {
        loadImages(dlg);
        mountMarkForm($('[data-mf]', dlg), { studentId: s.id, date: d, existing, admin: true, onSaved: () => { dlg.close(); render(); } });
        bindReview(dlg, () => [existing], () => { dlg.close(); render(); });
        $('[data-clear]', dlg)?.addEventListener('click', async () => { await api.deleteCheckIn(existing.id); dlg.close(); render(); });
      });
    }));
  }

  root.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-month]');
    if (nav) { month = addMonths(month, Number(nav.dataset.month)); render(); }
  });
  await render();
}

// ---------------------------------------------------------------------------
// NEWS CALENDAR
// ---------------------------------------------------------------------------

export async function viewAdminCalendar(root) {
  let month = monthStart(store.today);

  function render() {
    root.innerHTML = `
      <section class="hero"><div class="eyebrow">Admin</div><h1>News calendar</h1>
        <p class="muted">Students see each day's status before they check in. Mark NFP, CPI, PPI, FOMC and US holidays here once a month. Weekdays you leave alone are normal trading days.</p></section>
      ${monthNav(month)}
      <div class="card">
        ${monthGrid(month, (d) => {
          const st = dayStatus(d);
          const cls = { NO_TRADE: 'gc-notrade-fill', RESTRICTED: 'gc-news-fill', OFF: 'gc-off' }[st.kind] ?? '';
          return { cls: `${cls} clickable ${d === store.today ? 'gc-today' : ''}`, attrs: `data-day="${d}"`, html: st.label ? `<span class="gc-label">${esc(st.label)}</span>` : '' };
        })}
        <div class="legend"><span><i class="sw sw-notrade-fill"></i>No trade</span><span><i class="sw sw-news-fill"></i>News, restricted</span><span><i class="sw sw-off"></i>Not counted</span></div>
      </div>`;
  }

  root.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-month]');
    if (nav) { month = addMonths(month, Number(nav.dataset.month)); return render(); }
    const cell = e.target.closest('[data-day]');
    if (!cell) return;
    const d = cell.dataset.day;
    const r = store.cal.get(d) ?? { date: d, is_trading_day: true, news_status: 'NORMAL', news_label: '', trade_allowed_after: null };
    openModal(`
      <h3>${esc(fmtLong(d))}</h3>
      <form class="form" data-form>
        <label>Status<select class="input" name="news_status">
          <option value="NORMAL" ${r.news_status === 'NORMAL' ? 'selected' : ''}>Normal trading day</option>
          <option value="RESTRICTED" ${r.news_status === 'RESTRICTED' ? 'selected' : ''}>News day (trade only after a time)</option>
          <option value="NO_TRADE" ${r.news_status === 'NO_TRADE' ? 'selected' : ''}>NO TRADE day</option>
        </select></label>
        <label>Label<input class="input" name="news_label" value="${esc(r.news_label)}" placeholder="e.g. FOMC 2PM, Day before CPI, US holiday"></label>
        <label>Trade allowed after <span class="muted small">(New York time)</span><input class="input" type="time" name="trade_allowed_after" value="${esc(r.trade_allowed_after?.slice(0, 5) ?? '')}"></label>
        <label class="check"><input type="checkbox" name="off" ${r.is_trading_day === false ? 'checked' : ''}> Don't count this day at all (market fully closed)</label>
        <div class="row-between"><button type="button" class="btn ghost danger" data-reset>Reset to normal</button><button class="btn primary">Save</button></div>
      </form>`, (dlg) => {
      $('[data-form]', dlg).addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const f = Object.fromEntries(new FormData(ev.target));
        const row = { date: d, news_status: f.news_status, news_label: f.news_label.trim() || null, trade_allowed_after: f.trade_allowed_after || null, is_trading_day: !f.off };
        const saved = await busy(ev.submitter, () => api.saveTradingDay(row));
        store.cal.set(d, saved);
        dlg.close();
        render();
      });
      $('[data-reset]', dlg).onclick = async () => {
        await api.deleteTradingDay(d);
        store.cal.delete(d);
        dlg.close();
        render();
      };
    });
  });
  render();
}

// ---------------------------------------------------------------------------
// CHALLENGES
// ---------------------------------------------------------------------------

function challengeForm(c, onDone) {
  const next = addMonths(store.today, 1);
  const firstTrading = tradingDays(next, monthEnd(next), store.cal)[0] ?? next;
  const v = c ?? {
    name: `${fmtDate(next, { month: 'long' })} 30-Day Challenge`,
    description: 'Set your own rules, check in every trading day Monday to Friday, and follow them on every trade. NO ENTRY keeps you in, one X takes you out.',
    start_date: firstTrading, end_date: monthEnd(next), min_checkin_pct: 100, min_rules_pct: 100,
  };
  openModal(`
    <h3>${c ? 'Edit challenge' : 'New challenge'}</h3>
    <form class="form" data-form>
      <label>Name<input class="input" name="name" required value="${esc(v.name)}"></label>
      <label>Description<textarea class="input" name="description" rows="3">${esc(v.description)}</textarea></label>
      <div class="form-row">
        <label>Starts<input class="input" type="date" name="start_date" required value="${esc(v.start_date)}"></label>
        <label>Ends<input class="input" type="date" name="end_date" required value="${esc(v.end_date)}"></label>
      </div>
      <div class="form-row">
        <label>Check-in % needed<input class="input" type="number" min="0" max="100" name="min_checkin_pct" value="${v.min_checkin_pct}"></label>
        <label>Rules followed % needed<input class="input" type="number" min="0" max="100" name="min_rules_pct" value="${v.min_rules_pct}"></label>
      </div>
      <p class="hint">100 / 100 means: no missed trading day and no X. Discipline is ✓ ÷ (✓ + X), so NO ENTRY days don't affect it. Students must also set their own rules for the month to finish.</p>
      <div class="row-end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div>
    </form>`, (dlg) => {
    $('[data-form]', dlg).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (f.end_date < f.start_date) return toast('End date is before start date.', 'err');
      await busy(e.submitter, () => api.saveChallenge({ ...(c ? { id: c.id } : {}), ...f, min_checkin_pct: Number(f.min_checkin_pct), min_rules_pct: Number(f.min_rules_pct) }));
      store.challenges = await api.listChallenges();
      dlg.close();
      onDone();
    });
  });
}

export async function viewAdminChallenges(root) {
  let selected = null;

  async function render() {
    const challenges = [...store.challenges].reverse();
    selected ??= challenges.find((c) => c.start_date <= store.today && c.end_date >= store.today)?.id ?? challenges[0]?.id;
    const ch = challenges.find((c) => c.id === selected);
    let results = '';
    let reflections = [];
    if (ch) {
      const [students, rows, refl, books] = await Promise.all([api.listStudents(), api.listCheckIns(ch.start_date, ch.end_date), api.listReflections(), api.listAllRulebooks(monthStart(ch.start_date))]);
      const marks = indexMarks(rows);
      reflections = refl.filter((r) => r.challenge_id === ch.id).map((r) => ({ ...r, s: students.find((s) => s.id === r.student_id) }));
      const list = students.filter((s) => s.role !== 'admin' && s.status === 'active')
        .map((s) => ({ s, st: challengeStatus(ch, ctx(s, marks.get(s.id) ?? new Map()), { hasRules: books.some((b) => b.student_id === s.id) }) }))
        .filter((r) => r.st.state !== 'not_eligible');
      const order = { completed: 0, on_track: 1, needs_rules: 2, upcoming: 3, failed: 4 };
      list.sort((a, b) => order[a.st.state] - order[b.st.state] || (b.st.discipline ?? 0) - (a.st.discipline ?? 0));
      const count = (k) => list.filter((r) => r.st.state === k).length;
      results = `
        <div class="stats">
          ${stat('Still in', count('on_track') + count('needs_rules'), count('needs_rules') ? `${count('needs_rules')} haven't set their rules` : 'on track today', 'tone-green')}
          ${stat('Completed', count('completed'), '', 'tone-gold')}
          ${stat('Out', count('failed'), 'missed a day or logged an X', 'tone-red')}
          ${stat('In the challenge', list.length)}
        </div>
        <div class="card flush table-wrap"><table class="table">
          <thead><tr><th>Student</th><th>Status</th><th class="num">Days</th><th class="num">Check-in</th><th class="num">Rules</th><th></th></tr></thead>
          <tbody>${list.map((r) => { const [label, tone] = STATE_COPY[r.st.state]; return `
            <tr><td><a href="#/admin/student/${r.s.id}">${esc(r.s.full_name)}</a><div class="muted small">${esc(batchName(r.s))}</div></td>
              <td><span class="badge ${tone}">${label}</span></td>
              <td class="num">${r.st.checkIns}/${r.st.total}</td><td class="num">${pct(r.st.checkInRate)}</td><td class="num">${pct(r.st.rulesRate)}</td>
              <td>${r.st.state === 'completed' ? `<a class="small" href="#/certificate/${ch.id}/${r.s.id}">Certificate</a>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="6" class="center muted">No students in this challenge.</td></tr>'}
          </tbody></table></div>
        <div class="card"><h3>Reflections &amp; testimonials</h3>
          ${reflections.map((r) => `<div class="note-row"><div class="row-between"><strong>${esc(r.s?.full_name ?? 'Former student')}</strong>${r.can_share ? '<span class="badge tone-green">OK to share</span>' : '<span class="badge tone-muted">Private</span>'}</div><blockquote>${esc(r.body)}</blockquote></div>`).join('') || '<p class="muted">Students who complete the challenge are asked for a short reflection. They\'ll show up here.</p>'}
        </div>`;
    }

    root.innerHTML = `
      <section class="hero row-between wrap"><div><div class="eyebrow">Admin</div><h1>30-Day Challenges</h1></div><button class="btn primary" data-new>+ New challenge</button></section>
      ${challenges.length ? `<div class="seg wrap">${challenges.map((c) => `<button class="${c.id === selected ? 'on' : ''}" data-pick="${c.id}">${esc(c.name)}</button>`).join('')}</div>` : '<div class="card muted">No challenges yet. Create one for next month.</div>'}
      ${ch ? `<div class="card row-between wrap"><div><strong>${esc(ch.name)}</strong><div class="muted small">${esc(fmtDate(ch.start_date))} – ${esc(fmtDate(ch.end_date))} · needs ${ch.min_checkin_pct}% check-in and ${ch.min_rules_pct}% rules</div></div>
        <div class="row-gap"><button class="btn ghost" data-edit>Edit</button><button class="btn ghost danger" data-del>Delete</button></div></div>` : ''}
      ${results}`;

    $('[data-new]', root).onclick = () => challengeForm(null, () => { selected = null; render(); });
    $('[data-edit]', root)?.addEventListener('click', () => challengeForm(ch, render));
    $('[data-del]', root)?.addEventListener('click', async () => {
      if (!(await confirmBox(`Delete "${ch.name}"? Check-ins are kept; only the challenge and its reflections go.`))) return;
      await api.deleteChallenge(ch.id);
      store.challenges = await api.listChallenges();
      selected = null;
      render();
    });
    $$('[data-pick]', root).forEach((b) => (b.onclick = () => { selected = b.dataset.pick; render(); }));
  }
  await render();
}

// ---------------------------------------------------------------------------
// SETUP: batches and settings
// ---------------------------------------------------------------------------

function batchForm(b, onDone) {
  openModal(`
    <h3>${b?.id ? 'Edit batch' : 'New batch'}</h3>
    <form class="form" data-form>
      <label>Name<input class="input" name="name" required value="${esc(b?.name ?? `Batch ${store.batches.length + 1}`)}"></label>
      <div class="form-row">
        <label>Start date<input class="input" type="date" name="start_date" required value="${esc(b?.start_date ?? '')}"></label>
        <label>End date<input class="input" type="date" name="end_date" value="${esc(b?.end_date ?? '')}"></label>
      </div>
      <label>Slots<input class="input" type="number" name="slots" min="0" value="${esc(b?.slots ?? '')}"></label>
      <p class="hint">Students in this batch are expected to check in from the start date. They keep checking in after the end date (lifetime community).</p>
      <div class="row-end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div>
    </form>`, (dlg) => {
    $('[data-form]', dlg).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      await busy(e.submitter, () => api.saveBatch({ ...(b?.id ? { id: b.id } : {}), name: f.name.trim(), start_date: f.start_date, end_date: f.end_date || null, slots: f.slots ? Number(f.slots) : null }));
      await loadReference();
      dlg.close();
      onDone();
    });
  });
}

export async function viewAdminSetup(root) {
  async function render() {
    const students = await api.listStudents();
    root.innerHTML = `
      <section class="hero"><div class="eyebrow">Admin</div><h1>Setup</h1></section>
      <div class="card">
        <div class="row-between"><h3>Batches</h3><button class="btn ghost" data-new>+ New batch</button></div>
        <table class="table"><thead><tr><th>Batch</th><th>Dates</th><th class="num">Students</th><th class="num hide-sm">Slots</th><th></th></tr></thead>
        <tbody>${store.batches.map((b) => `<tr><td><strong>${esc(b.name)}</strong></td><td class="small">${esc(fmtDate(b.start_date, { month: 'short', day: 'numeric', year: 'numeric' }))}${b.end_date ? ' – ' + esc(fmtDate(b.end_date, { month: 'short', day: 'numeric' })) : ''}</td>
          <td class="num">${students.filter((s) => s.batch_id === b.id && s.status === 'active').length}</td><td class="num hide-sm">${b.slots ?? '—'}</td>
          <td class="right"><button class="btn ghost small" data-edit="${b.id}">Edit</button></td></tr>`).join('')}</tbody></table>
      </div>
      <div class="card">
        <h3>Alerts</h3>
        <form class="form" data-settings>
          <div class="form-row">
            <label>Follow-up after this many X days in a month<input class="input" type="number" min="1" name="followup_threshold" value="${store.settings.followup_threshold}"></label>
            <label>"Gone quiet" after this many trading days with no check-in<input class="input" type="number" min="1" name="inactive_days" value="${store.settings.inactive_days}"></label>
          </div>
          <div class="row-end"><button class="btn primary">Save</button></div>
        </form>
      </div>
      ${DEMO ? `<div class="card"><h3>Demo data</h3><p class="muted small">You're in demo mode. Data lives only in this browser. Every name is made up.</p><button class="btn ghost danger" data-reset>Reset demo data</button></div>` : ''}`;

    $('[data-new]', root).onclick = () => batchForm(null, render);
    $$('[data-edit]', root).forEach((b) => (b.onclick = () => batchForm(store.batches.find((x) => x.id === b.dataset.edit), render)));
    $('[data-settings]', root).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      store.settings = await busy(e.submitter, () => api.saveSettings({ followup_threshold: Number(f.followup_threshold), inactive_days: Number(f.inactive_days) }));
      toast('Saved');
    });
    $('[data-reset]', root)?.addEventListener('click', async () => {
      if (!(await confirmBox('Reset all demo data in this browser?', 'Reset'))) return;
      api.resetDemo();
      location.reload();
    });
  }
  await render();
}
