import { api } from './api.js';
import { APP_NAME, AWARDS, EDIT_WINDOW_DAYS, PROGRAM_NAME, PROP_FIRMS } from './config.js';
import { mountMarkForm } from './checkin-form.js';
import { addDays, addMonths, fmtDate, fmtLong, monthEnd, monthStart, nyDateOf, weekStart } from './dates.js';
import { activeChallenge, challengeAwards, challengeStatus, effMark, inChallenge, indexMarks, isTradingDay, rankCompare, streaks, studentStart, summarize, tradingDays } from './metrics.js';
import { batchName, batchOf, ctx, store } from './store.js';
import { loadImages, tradeCard } from './trades-ui.js';
import { $, busy, calCell, checkInSummary, esc, legend, monthGrid, monthNav, newsBanner, pct, progressBar, stat, toast } from './ui.js';

async function myMarks() {
  const rows = await api.myCheckIns(store.me.id);
  return new Map(rows.map((c) => [c.date, c]));
}

const STATE_COPY = {
  on_track: ['On track', 'tone-green'],
  needs_rules: ['Set your rules', 'tone-amber'],
  completed: ['Completed', 'tone-gold'],
  failed: ['Out this round', 'tone-red'],
  upcoming: ['Starts soon', 'tone-blue'],
  not_eligible: ['Not in this round', 'tone-muted'],
};

function challengeCard(ch, st, { compact = false } = {}) {
  const [label, tone] = STATE_COPY[st.state];
  const done = st.total - st.remaining;
  return `
    <a class="card challenge-card ${compact ? 'compact' : ''}" href="#/challenge">
      <div class="row-between">
        <div><div class="eyebrow">30-Day Challenge</div><h3>${esc(ch.name)}</h3></div>
        <span class="badge ${tone}">${label}</span>
      </div>
      ${progressBar(st.total ? done / st.total : 0, st.state === 'failed' ? 'bar-red' : 'bar-gold')}
      <div class="row-between small muted">
        <span>Day ${Math.min(done, st.total)} of ${st.total}</span>
        <span>${fmtDate(ch.start_date)} – ${fmtDate(ch.end_date)}</span>
      </div>
    </a>`;
}

// ---------------------------------------------------------------------------
// TODAY
// ---------------------------------------------------------------------------

export async function viewToday(root) {
  const me = store.me;
  const today = store.today;
  const [marks, trades, rulebooks] = await Promise.all([
    myMarks(),
    api.listTrades(me.id, weekStart(addDays(today, -EDIT_WINDOW_DAYS)), today),
    api.listRulebooks(me.id),
  ]);
  const rulebookFor = (d) => rulebooks.find((r) => r.month === monthStart(d)) ?? null;
  const start = studentStart(me, batchOf(me));
  const editable = [];
  for (let n = EDIT_WINDOW_DAYS; n >= 0; n--) {
    const d = addDays(today, -n);
    if (d >= start && isTradingDay(d, store.cal)) editable.push(d);
  }
  let sel = editable.includes(today) ? today : editable.findLast((d) => !marks.has(d)) ?? editable.at(-1) ?? today;
  let editing = false;

  function render() {
    const c = ctx(me, marks);
    const month = summarize({ ...c, from: monthStart(today), to: monthEnd(today) });
    const st = streaks(c);
    const ch = activeChallenge(store.challenges, today);
    const chSt = ch ? challengeStatus(ch, c, { hasRules: !!rulebookFor(ch.start_date) }) : null;
    const existing = marks.get(sel);
    const beforeStart = today < start;
    const hasRules = !!rulebookFor(today);

    root.innerHTML = `
      <section class="hero">
        <div class="eyebrow">${esc(fmtLong(today))} · New York</div>
        <h1>Hi ${esc(me.full_name.split(' ')[0])}.</h1>
        <p class="muted">Did you follow your rules today? Takes 5 seconds.</p>
      </section>

      ${beforeStart ? `<div class="card"><h3>Your batch starts ${esc(fmtLong(start))}</h3><p class="muted">Check-ins open on your first trading day. Make sure you've watched Module 3 of the Free Trading Masterclass before then.</p></div>` : ''}

      ${editable.length > 1 ? `<div class="date-strip">${editable.map((d) => `
        <button class="date-chip${d === sel ? ' on' : ''}" data-date="${d}">
          <span>${d === today ? 'Today' : fmtDate(d, { weekday: 'short' })}</span>
          <strong>${fmtDate(d, { month: 'short', day: 'numeric' })}</strong>
          <i class="dot ${marks.has(d) ? 'dot-' + marks.get(d).mark.toLowerCase() : 'dot-blank'}"></i>
        </button>`).join('')}</div>` : ''}

      ${!hasRules && !beforeStart ? `<a class="card rules-cta" href="#/rules"><div class="eyebrow">Step 1</div><h3>Set your rules for ${esc(fmtDate(today, { month: 'long' }))}</h3><p class="muted small">Your max risk per trade, trades per day and per week, and your personal rules. Every trade you post is checked against them.</p></a>` : ''}

      ${beforeStart ? '' : newsBanner(sel)}

      ${editable.includes(sel) ? `
        <div class="card checkin-card">
          <h3>${sel === today ? 'Today\'s check-in' : `Check-in for ${esc(fmtDate(sel))}`}</h3>
          ${existing && !editing ? `
            <div class="done-state">${checkInSummary(existing)}</div>
            ${trades.filter((t) => t.date === sel).map((t) => tradeCard(t)).join('')}
            <div class="row-end"><button class="btn ghost" data-edit>Change</button></div>` : '<div data-form></div>'}
        </div>` : ''}

      <div class="stats">
        ${stat('Rule streak', `${st.rule}<small> days</small>`, `Best: ${st.best}`, 'tone-gold')}
        ${stat('Check-in rate', pct(month.checkInRate), `${month.checkIns} of ${month.elapsed} days this month`)}
        ${stat('Discipline', pct(month.rulesRate), `${month.check} ✓ · ${month.x} X this month`)}
      </div>

      ${ch && chSt ? challengeCard(ch, chSt, { compact: true }) : ''}`;

    loadImages(root);
    const form = $('[data-form]', root);
    if (form) {
      mountMarkForm(form, {
        studentId: me.id,
        date: sel,
        existing,
        rulebook: rulebookFor(sel),
        dayTrades: trades.filter((t) => t.date === sel),
        weekTrades: trades.filter((t) => t.date >= weekStart(sel) && t.date <= sel),
        onCancel: existing ? () => { editing = false; render(); } : null,
        onTradesChange: (dayTrades) => {
          for (let i = trades.length - 1; i >= 0; i--) if (trades[i].date === sel) trades.splice(i, 1);
          trades.push(...dayTrades);
        },
        onSaved: (saved) => {
          marks.set(saved.date, saved);
          editing = false;
          const next = editable.find((d) => !marks.has(d));
          if (next && saved.date !== today) sel = next;
          render();
        },
      });
    }
  }

  root.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-date]');
    if (chip) { sel = chip.dataset.date; editing = false; render(); }
    if (e.target.closest('[data-edit]')) { editing = true; render(); }
  });
  render();
}

// ---------------------------------------------------------------------------
// PROGRESS
// ---------------------------------------------------------------------------

export async function viewProgress(root) {
  const me = store.me;
  const [marks, allTrades] = await Promise.all([myMarks(), api.listTrades(me.id, '2000-01-01', '2999-12-31')]);
  let month = monthStart(store.today);

  function render() {
    const c = ctx(me, marks);
    const s = summarize({ ...c, from: month, to: monthEnd(month) });
    const st = streaks(c);
    const monthRows = [...marks.values()].filter((ci) => ci.date >= month && ci.date <= monthEnd(month));
    const tagCount = {};
    monthRows.forEach((ci) => (ci.mistake_tags || []).forEach((t) => (tagCount[t] = (tagCount[t] || 0) + 1)));
    const topTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]);
    const xRows = monthRows.filter((ci) => effMark(ci) === 'X').sort((a, b) => b.date.localeCompare(a.date));
    const monthTrades = allTrades.filter((t) => t.date >= month && t.date <= monthEnd(month)).sort((a, b) => b.date.localeCompare(a.date));

    root.innerHTML = `
      <section class="hero"><div class="eyebrow">My progress</div><h1>${esc(me.full_name)}</h1><p class="muted">${esc(batchName(me))}</p></section>
      ${monthNav(month)}
      <div class="stats">
        ${stat('Check-in rate', pct(s.checkInRate), `${s.checkIns} of ${s.elapsed} trading days so far`)}
        ${stat('Discipline', pct(s.rulesRate), `${s.check} ✓ · ${s.x} X · ${s.missed} no check-in (not counted)`)}
        ${stat('Rule streak', `${st.rule}<small> days</small>`, `Best ever: ${st.best}`, 'tone-gold')}
        ${stat('Check-in streak', `${st.current}<small> days</small>`, 'Any mark counts')}
      </div>
      <div class="card">
        ${monthGrid(month, (d) => calCell(d, marks.get(d), store.today))}
        ${legend()}
      </div>
      <div class="two-col">
        <div class="card">
          <h3>What trips you up</h3>
          ${topTags.length ? `<ul class="bar-list">${topTags.map(([t, n]) => `<li><span>${esc(t)}</span>${progressBar(n / topTags[0][1], 'bar-red')}<b>${n}</b></li>`).join('')}</ul>
            <p class="hint">Your most common slip is <strong>${esc(topTags[0][0])}</strong>. Bring it to Saturday's session.</p>` : '<p class="muted">No broken rules this month. Keep stacking days.</p>'}
        </div>
        <div class="card">
          <h3>My X notes</h3>
          ${xRows.length ? xRows.map((ci) => `<div class="note-row"><div class="muted small">${esc(fmtDate(ci.date))}</div>${checkInSummary(ci)}</div>`).join('') : '<p class="muted">Nothing here. That\'s the goal.</p>'}
        </div>
      </div>
      <div class="card">
        <h3>My trades this month</h3>
        ${monthTrades.length ? monthTrades.map((t) => `<div class="muted small trade-date">${esc(fmtDate(t.date))}</div>${tradeCard(t)}`).join('') : '<p class="muted">No trades posted this month.</p>'}
      </div>`;
    loadImages(root);
  }

  root.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-month]');
    if (nav) { month = addMonths(month, Number(nav.dataset.month)); render(); }
  });
  render();
}

// ---------------------------------------------------------------------------
// LEADERBOARD (students and admin)
// ---------------------------------------------------------------------------

async function loadCohort(from, to) {
  const isAdmin = store.me.role === 'admin';
  const [roster, marks] = isAdmin
    ? [(await api.listStudents()).filter((s) => s.status === 'active'), await api.listCheckIns(from, to)]
    : await Promise.all([api.cohortRoster(), api.cohortMarks(from, to)]);
  return { roster: roster.filter((s) => s.role !== 'admin'), marks: indexMarks(marks) };
}

export async function viewLeaderboard(root) {
  let month = monthStart(store.today);
  let scope = store.me.batch_id ? 'batch' : 'all';
  let showAll = store.me.role === 'admin';

  async function render() {
    root.innerHTML = '<div class="loading">Loading leaderboard…</div>';
    const { roster, marks } = await loadCohort(addDays(month, -120), monthEnd(month));
    const rows = roster
      .filter((s) => scope === 'all' || s.batch_id === store.me.batch_id)
      .map((s) => {
        const m = marks.get(s.id) ?? new Map();
        const c = ctx(s, m);
        return { s, sum: summarize({ ...c, from: month, to: monthEnd(month) }), st: streaks(c) };
      })
      .filter((r) => r.sum.elapsed > 0)
      .sort((a, b) => rankCompare(a.sum, b.sum) || a.s.full_name.localeCompare(b.s.full_name));

    let rank = 0, prev = null;
    rows.forEach((r, i) => {
      const key = `${r.sum.rulesRate}|${r.sum.checkInRate}|${r.sum.check}`;
      if (key !== prev) rank = i + 1;
      r.rank = rank;
      prev = key;
    });
    const mine = rows.find((r) => r.s.id === store.me.id);
    const visible = showAll ? rows : rows.slice(0, 10);
    if (mine && !visible.includes(mine)) visible.push(mine);

    root.innerHTML = `
      <section class="hero"><div class="eyebrow">Leaderboard</div><h1>Discipline ranking</h1>
        <p class="muted">Discipline = ✓ days ÷ (✓ + X days). Days with no check-in don't count. Ties go to the better check-in rate, then more ✓ days. P&amp;L never counts.</p></section>
      ${monthNav(month)}
      <div class="seg">
        ${store.me.batch_id ? `<button class="${scope === 'batch' ? 'on' : ''}" data-scope="batch">${esc(batchName(store.me))}</button>` : ''}
        <button class="${scope === 'all' ? 'on' : ''}" data-scope="all">All batches</button>
      </div>
      <div class="card flush">
        <table class="table lb">
          <thead><tr><th>#</th><th>Name</th><th class="num">Discipline</th><th class="num hide-sm">Check-in</th><th class="num hide-sm">✓ / X</th><th class="num">🔥</th></tr></thead>
          <tbody>${visible.map((r) => `
            <tr class="${r.s.id === store.me.id ? 'me' : ''} ${r.rank <= 3 ? 'top' + r.rank : ''}">
              <td class="rank">${r.rank}</td>
              <td><div class="name">${esc(r.s.full_name)}</div><div class="muted small">${esc(batchName(r.s))}</div></td>
              <td class="num"><strong>${pct(r.sum.rulesRate)}</strong></td>
              <td class="num hide-sm">${pct(r.sum.checkInRate)}</td>
              <td class="num hide-sm">${r.sum.check} / ${r.sum.x}</td>
              <td class="num">${r.st.rule}</td>
            </tr>`).join('') || '<tr><td colspan="6" class="muted center">No trading days yet this month.</td></tr>'}
          </tbody>
        </table>
      </div>
      ${rows.length > 10 ? `<div class="center"><button class="btn ghost" data-toggle>${showAll ? 'Show top 10' : `Show all ${rows.length}`}</button></div>` : ''}`;
  }

  root.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-month]');
    if (nav) { month = addMonths(month, Number(nav.dataset.month)); render(); }
    const sc = e.target.closest('[data-scope]');
    if (sc) { scope = sc.dataset.scope; render(); }
    if (e.target.closest('[data-toggle]')) { showAll = !showAll; render(); }
  });
  await render();
}

// ---------------------------------------------------------------------------
// CHALLENGE
// ---------------------------------------------------------------------------

// Live standings for a challenge: team battle plus the two individual awards.
// Once the challenge is finalized, the official winners replace the live leaders.
export function standingsHtml(ch, awards, winners, meId) {
  const teamRows = ch.finalized_at && ch.team_results ? ch.team_results.map((t) => ({ name: t.batch, score: t.score / 100, members: t.members }))
    : awards.teams.map((t) => ({ name: store.batches.find((b) => b.id === t.batch_id)?.name ?? '—', score: t.score, members: t.members }));
  const top = teamRows[0]?.score || 1;
  const list = (rows, key, value) => `<ol class="award-list">${rows.slice(0, 5).map((r) => `
      <li class="${r.s.id === meId ? 'me' : ''}"><span>${esc(r.s.full_name)} <span class="muted small">${esc(batchName(r.s))}</span></span><b>${pct(r.sum[key])}</b>${value ? `<span class="muted small">${value(r)}</span>` : ''}</li>`).join('') || '<li class="muted">No one yet.</li>'}</ol>`;
  const myPlace = (rows) => {
    const i = rows.findIndex((r) => r.s.id === meId);
    return i >= 5 ? `<p class="muted small">You're #${i + 1}.</p>` : '';
  };
  const official = winners.length ? `
    <div class="card winners-card">
      <h3>🏆 Official winners</h3>
      ${winners.map((w) => `<div class="row-between list-row"><span>${AWARDS[w.category].icon} <b>${AWARDS[w.category].label}</b></span><span>${esc(w.full_name)} <span class="muted small">${esc(w.batch_name ?? '')}</span></span></div>`).join('')}
      <p class="muted small">Winners can claim their prize on this page.</p>
    </div>` : '';
  return `
    ${official}
    ${teamRows.length > 1 || ch.batch_ids?.length ? `
      <div class="card">
        <h3>🤝 Team battle${ch.finalized_at ? ' · final' : ''}</h3>
        <p class="muted small">Team score = each member's discipline % × check-in rate, averaged across the whole batch. Everyone who doesn't check in pulls the team down. One member of the winning batch is drawn at random for a prize.</p>
        ${teamRows.map((t, i) => `<div class="team-row"><span><b>${esc(t.name)}</b> <span class="muted small">${t.members} students</span></span>${progressBar(t.score / top, i === 0 ? 'bar-gold' : '')}<b>${(t.score * 100).toFixed(1)}</b></div>`).join('')}
      </div>` : ''}
    <div class="two-col">
      <div class="card"><h3>🎯 Most Disciplined</h3>
        <p class="muted small">Highest discipline %. Needs at least ${ch.award_min_checkin_pct ?? 80}% check-in rate to qualify.</p>
        ${list(awards.discipline, 'rulesRate', (r) => `${r.sum.check} ✓ · ${r.sum.x} X`)}${myPlace(awards.discipline)}</div>
      <div class="card"><h3>⚡ Most Active</h3>
        <p class="muted small">Highest check-in rate.</p>
        ${list(awards.active, 'checkInRate', (r) => `${r.sum.checkIns}/${r.sum.elapsed} days`)}${myPlace(awards.active)}</div>
    </div>`;
}

function claimCard(w, ch) {
  const award = AWARDS[w.category];
  if (w.prize_sent_at) {
    return `<div class="card prize-card done"><h3>${award.icon} ${award.label}: prize sent ✓</h3><p class="muted">${esc(ch?.name ?? '')} · sent to ${esc(w.prop_email)} (${esc(w.prop_firm)}). Congratulations!</p></div>`;
  }
  return `
    <div class="card prize-card" data-claim="${w.id}">
      <div class="eyebrow">${esc(ch?.name ?? 'Challenge')}</div>
      <h3>${award.icon} You won ${award.label}!</h3>
      ${w.claimed_at ? `<p>Claim sent: <b>${esc(w.prop_firm)}</b> · ${esc(w.prop_email)}. Your coach will send your challenge account. You can still correct it below until it's sent.</p>` : '<p>Claim your prize: a prop firm challenge account. Choose the prop firm and enter the email you registered there.</p>'}
      <form class="form" data-claim-form>
        <div class="form-row">
          <label>Prop firm<select class="input" name="prop_firm" required>
            <option value="">Choose…</option>${PROP_FIRMS.map((f) => `<option ${w.prop_firm === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}
          </select></label>
          <label>Registered email at that prop firm<input class="input" type="email" name="prop_email" required value="${esc(w.prop_email ?? '')}" placeholder="you@email.com"></label>
        </div>
        <div class="row-end"><button class="btn primary">${w.claimed_at ? 'Update claim' : '🏆 Claim prize'}</button></div>
      </form>
    </div>`;
}

export async function viewChallenge(root) {
  const me = store.me;
  const finalized = store.challenges.filter((x) => x.finalized_at);
  const [marks, reflections, rulebooks, myWins] = await Promise.all([
    myMarks(), api.listReflections(), api.listRulebooks(me.id),
    Promise.all(finalized.map((x) => api.listWinners(x.id))).then((a) => a.flat().filter((w) => w.student_id === me.id)),
  ]);
  const c = ctx(me, marks);
  const ch = activeChallenge(store.challenges, store.today);
  const hasRules = (x) => ({ hasRules: rulebooks.some((r) => r.month === monthStart(x.start_date)) });
  const prizes = myWins.map((w) => claimCard(w, store.challenges.find((x) => x.id === w.challenge_id))).join('');

  if (!ch) {
    root.innerHTML = `${prizes}<section class="hero"><div class="eyebrow">30-Day Challenge</div><h1>No challenge yet</h1><p class="muted">Your coach will open the next one soon.</p></section>`;
    bindClaims();
    return;
  }

  // Standings: everyone in the challenge's batches over the challenge window.
  const { roster, marks: cohort } = await loadCohort(ch.start_date, ch.end_date);
  const rows = roster.filter((s) => inChallenge(ch, s)).map((s) => ({ s, sum: summarize({ ...ctx(s, cohort.get(s.id) ?? new Map()), from: ch.start_date, to: ch.end_date }) }));
  const awards = challengeAwards(ch, rows);
  const winners = ch.finalized_at ? await api.winnerList(ch.id) : [];

  const st = challengeStatus(ch, c, hasRules(ch));
  const days = tradingDays(ch.start_date, ch.end_date, store.cal);
  const mine = reflections.find((r) => r.challenge_id === ch.id && r.student_id === me.id);
  const past = store.challenges.filter((x) => x.end_date < store.today && x.id !== ch.id).reverse();
  const msg = {
    on_track: 'Every trading day, Monday to Friday: check in and follow your own rules. Not trading on a no-trade day is a ✓. One missed day or one X and you\'re out of this round.',
    needs_rules: 'You\'re still in, but you can\'t finish without your own rules. Set your max risk, max trades and personal rules now. <a href="#/rules">Set my rules →</a>',
    completed: 'You did it. Every single trading day, rules followed. That is the habit that makes traders consistent.',
    failed: 'This round is over for you, but keep checking in. Your streak and your rate still count, and the next challenge starts fresh.',
    upcoming: 'Get ready. From day one: check in every trading day and follow your rules 100%.',
    not_eligible: inChallenge(ch, me) ? 'You joined after this round. Your first challenge is the next one.' : 'Your batch isn\'t in this round yet. Keep checking in: you\'ll join the next challenge. You can still follow the race below.',
  }[st.state];

  root.innerHTML = `
    ${prizes}
    <section class="hero"><div class="eyebrow">30-Day Challenge</div><h1>${esc(ch.name)}</h1><p class="muted">${esc(ch.description || '')}</p></section>
    ${challengeCard(ch, st)}
    <div class="card">
      <p>${msg}</p>
      <div class="rules-row">
        <div><b>${ch.min_checkin_pct}%</b><span>check-in needed</span></div>
        <div><b>${ch.min_rules_pct}%</b><span>discipline needed</span></div>
        <div><b>${pct(st.checkInRate)}</b><span>your check-in</span></div>
        <div><b>${pct(st.rulesRate)}</b><span>your discipline</span></div>
      </div>
      <div class="day-dots">${days.map((d) => {
        const m = effMark(marks.get(d));
        const cls = m ? `dot-${m.toLowerCase()}` : d < store.today && d >= studentStart(me, batchOf(me)) ? 'dot-missed' : d === store.today ? 'dot-today' : 'dot-blank';
        return `<i class="dot ${cls}" title="${esc(fmtDate(d))}"></i>`;
      }).join('')}</div>
    </div>
    ${st.state === 'completed' ? `
      <div class="card">
        <h3>🏆 Claim your certificate</h3>
        <p class="muted">Before you do, tell the next batch what these 30 days did for you.</p>
        <textarea class="input" rows="4" data-reflection placeholder="What changed for you in these 30 days?">${esc(mine?.body || '')}</textarea>
        <label class="check"><input type="checkbox" data-share ${mine?.can_share ? 'checked' : ''}> Coach can share this as a testimonial</label>
        <div class="row-end">
          <button class="btn ghost" data-save-reflection>Save reflection</button>
          <a class="btn primary" href="#/certificate/${ch.id}">View certificate</a>
        </div>
      </div>` : ''}
    ${standingsHtml(ch, awards, winners, me.id)}
    ${past.length ? `<div class="card"><h3>Past challenges</h3>${past.map((p) => {
      const ps = challengeStatus(p, c, hasRules(p));
      const [label, tone] = STATE_COPY[ps.state];
      return `<div class="row-between list-row"><span>${esc(p.name)}</span><span class="row-gap"><span class="badge ${tone}">${label}</span>${ps.state === 'completed' ? `<a class="small" href="#/certificate/${p.id}">Certificate</a>` : ''}</span></div>`;
    }).join('')}</div>` : ''}`;

  $('[data-save-reflection]', root)?.addEventListener('click', async (e) => {
    const body = $('[data-reflection]', root).value.trim();
    if (!body) return toast('Write a few lines first.', 'err');
    await busy(e.currentTarget, () => api.saveReflection({ student_id: me.id, challenge_id: ch.id, body, can_share: $('[data-share]', root).checked }));
    toast('Saved. Thank you!');
  });
  bindClaims();

  function bindClaims() {
    root.querySelectorAll('[data-claim-form]').forEach((form) => form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      const id = form.closest('[data-claim]').dataset.claim;
      try {
        await busy(e.submitter, () => api.claimPrize(id, f.prop_firm, f.prop_email.trim()));
      } catch { return; } // busy() already showed the error
      toast('Prize claim sent! Your coach will send your account.');
      viewChallenge(root);
    }));
  }
}

// ---------------------------------------------------------------------------
// CERTIFICATE (printable)
// ---------------------------------------------------------------------------

export async function viewCertificate(root, [challengeId, studentId]) {
  const ch = store.challenges.find((x) => x.id === challengeId);
  let student = store.me;
  if (studentId && store.me.role === 'admin') student = (await api.listStudents()).find((s) => s.id === studentId);
  const rows = store.me.role === 'admin'
    ? await api.listCheckIns(ch?.start_date ?? store.today, ch?.end_date ?? store.today)
    : await api.myCheckIns(student.id);
  const marks = indexMarks(rows).get(student?.id) ?? new Map();
  const rulebooks = student ? await api.listRulebooks(student.id) : [];
  const st = ch && student ? challengeStatus(ch, ctx(student, marks), { hasRules: rulebooks.some((r) => r.month === monthStart(ch.start_date)) }) : null;

  if (!st || st.state !== 'completed') {
    root.innerHTML = '<div class="card"><h3>Certificate not available</h3><p class="muted">Certificates unlock once a challenge is completed.</p></div>';
    return;
  }
  root.innerHTML = `
    <div class="no-print row-end"><button class="btn primary" onclick="window.print()">Print / Save as PDF</button></div>
    <div class="certificate">
      <div class="cert-inner">
        <img class="cert-logo" src="assets/logo.png" alt="">
        <div class="eyebrow">${esc(APP_NAME)}</div>
        <h2>Certificate of Completion</h2>
        <p>This certifies that</p>
        <div class="cert-name">${esc(student.full_name)}</div>
        <p>completed the <strong>${esc(ch.name)}</strong><br>checking in on all ${st.total} trading days and following their own rules on every trade they took.</p>
        <p class="muted">${esc(fmtDate(ch.start_date, { month: 'long', day: 'numeric' }))} – ${esc(fmtDate(ch.end_date, { month: 'long', day: 'numeric', year: 'numeric' }))} · ${esc(PROGRAM_NAME)}</p>
        <div class="cert-quote">“A win on a broken rule is worse than a loss on a followed plan.”</div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// MY RULES
// ---------------------------------------------------------------------------

const SUGGESTED_RULES = [
  'Only trade the NY Open Kill Zone',
  'Wait for a liquidity sweep and MSS before entry',
  'No trading on red-folder / no-trade days',
  'Stop for the day after 2 losses',
  'Stop loss is set before I enter',
  'Mark my HTF bias before the session',
];

export function rulebookSummary(r) {
  return `
    <div class="rules-row">
      <div><b>${Number(r.max_risk_pct)}%</b><span>max risk per trade</span></div>
      <div><b>${r.max_trades_day}</b><span>max trades a day</span></div>
      <div><b>${r.max_trades_week}</b><span>max trades a week</span></div>
      <div><b>${r.max_daily_loss_r ? `${Number(r.max_daily_loss_r)}R` : '—'}</b><span>daily stop</span></div>
    </div>
    ${r.personal_rules?.length ? `<ol class="rule-list">${r.personal_rules.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}`;
}

export async function viewRules(root) {
  const me = store.me;
  const months = [monthStart(store.today), addMonths(store.today, 1)];

  async function render() {
    const books = await api.listRulebooks(me.id);
    root.innerHTML = `
      <section class="hero"><div class="eyebrow">My rules</div><h1>Your rules, your restrictions</h1>
        <p class="muted">You decide how much you risk and how often you trade. Every trade you post is checked against these. Break one and the day is an X, automatically. You can change them on the day you set them. After that they're locked for the month.</p></section>
      ${months.map((m) => {
        const r = books.find((b) => b.month === m);
        const editable = !r || nyDateOf(r.created_at) === store.today;
        return `
          <div class="card">
            <div class="row-between"><h3>${esc(fmtDate(m, { month: 'long', year: 'numeric' }))}</h3>
              ${r ? (editable ? '<span class="badge tone-amber">Editable until today ends (NY)</span>' : '<span class="badge tone-muted">🔒 Locked</span>') : '<span class="badge tone-red">Not set</span>'}</div>
            ${r && !editable ? rulebookSummary(r) : `
              <form class="form" data-month-form="${m}">
                <div class="form-row">
                  <label>Max risk per trade (%)<input class="input" type="number" name="max_risk_pct" step="0.01" min="0.01" max="100" required value="${esc(r?.max_risk_pct ?? '')}" placeholder="1"></label>
                  <label>Daily stop in R <span class="muted small">(optional)</span><input class="input" type="number" name="max_daily_loss_r" step="0.5" min="0.5" value="${esc(r?.max_daily_loss_r ?? '')}" placeholder="2"></label>
                </div>
                <div class="form-row">
                  <label>Max trades a day<input class="input" type="number" name="max_trades_day" min="1" max="50" required value="${esc(r?.max_trades_day ?? '')}" placeholder="2"></label>
                  <label>Max trades a week<input class="input" type="number" name="max_trades_week" min="1" max="250" required value="${esc(r?.max_trades_week ?? '')}" placeholder="5"></label>
                </div>
                <label>My personal rules <span class="muted small">(one per line, up to 8. You'll tick each one when you check in.)</span>
                  <textarea class="input" name="personal_rules" rows="5" placeholder="Only trade the NY Open Kill Zone&#10;Wait for a liquidity sweep and MSS before entry">${esc((r?.personal_rules ?? []).join('\n'))}</textarea>
                </label>
                <div class="chips">${SUGGESTED_RULES.map((x) => `<button type="button" class="chip" data-suggest="${esc(x)}">+ ${esc(x)}</button>`).join('')}</div>
                <div class="row-end"><button class="btn primary">${r ? 'Update rules' : 'Set my rules'}</button></div>
              </form>`}
          </div>`;
      }).join('')}`;

    root.querySelectorAll('[data-month-form]').forEach((form) => {
      form.addEventListener('click', (e) => {
        const s = e.target.closest('[data-suggest]');
        if (!s) return;
        const ta = form.personal_rules;
        const lines = ta.value.split('\n').map((l) => l.trim()).filter(Boolean);
        if (!lines.includes(s.dataset.suggest)) lines.push(s.dataset.suggest);
        ta.value = lines.join('\n');
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(form));
        const rules = f.personal_rules.split('\n').map((l) => l.trim()).filter(Boolean);
        if (rules.length > 8) return toast('Keep it to 8 rules or fewer.', 'err');
        if (Number(f.max_trades_week) < Number(f.max_trades_day)) return toast('Max trades a week can\'t be lower than max trades a day.', 'err');
        const existing = books.find((b) => b.month === form.dataset.monthForm);
        await busy(e.submitter, () => api.saveRulebook({
          ...(existing ? { id: existing.id } : {}),
          student_id: me.id,
          month: form.dataset.monthForm,
          max_risk_pct: Number(f.max_risk_pct),
          max_trades_day: Number(f.max_trades_day),
          max_trades_week: Number(f.max_trades_week),
          max_daily_loss_r: f.max_daily_loss_r ? Number(f.max_daily_loss_r) : null,
          personal_rules: rules,
        }));
        toast('Rules saved. You can still change them today.');
        render();
      });
    });
  }
  await render();
}

export { STATE_COPY, loadCohort };
