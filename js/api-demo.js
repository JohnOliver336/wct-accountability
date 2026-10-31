// Offline demo backend. Same interface as api-supabase.js, data lives in localStorage.
// Every name here is made up. Used until SUPABASE_URL is set in config.js.
import { addDays, isWeekend, todayNY } from './dates.js';
import { MISTAKE_TAGS, SCREENSHOT_RETENTION_DAYS, SETUPS, SESSIONS } from './config.js';
import { challengeAwards, inChallenge, summarize } from './metrics.js';

const KEY = 'wct-demo-db-v6';
const IMG_PREFIX = 'wct-demo-img:';

// Stand-in for an MT5 screenshot in the seeded data.
const SAMPLE_IMG = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300"><rect width="100%" height="100%" fill="#1c2030"/>' +
  '<text x="24" y="44" fill="#9aa4b8" font-family="Arial" font-size="18">MT5 · History (sample)</text>' +
  '<text x="24" y="100" fill="#e8ecf4" font-family="Arial" font-size="22">NAS100  buy 0.50</text>' +
  '<text x="24" y="140" fill="#9aa4b8" font-family="Arial" font-size="16">Demo data. Real students upload a screenshot.</text></svg>');
const SESSION_KEY = 'wct-demo-session';
const uid = () => crypto.randomUUID();
const clone = (v) => JSON.parse(JSON.stringify(v));

function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

// Made-up medium-impact news on most weekdays, so the demo calendar has tradeable days.
// Every 5th weekday is left without news, which makes it a no-trade day.
function withNews(rows) {
  const labels = ['ISM Services PMI', 'JOLTS', 'ADP Employment', 'Unemployment Claims 8:30', 'UoM Consumer Sentiment'];
  const out = [...rows];
  let n = 0;
  for (let d = '2026-09-01'; d <= '2026-11-30'; d = addDays(d, 1)) {
    if (isWeekend(d) || out.some((r) => r.date === d)) continue;
    if (++n % 5 === 0) continue;
    out.push({ date: d, is_trading_day: true, news_status: 'NORMAL', news_label: labels[(new Date(d).getUTCDay() + 4) % 5], trade_allowed_after: null });
  }
  return out;
}

function seed() {
  const today = todayNY();
  const b1 = { id: 'b1', name: 'Batch 1', start_date: '2026-09-05', end_date: '2026-09-26', slots: 41 };
  const b2 = { id: 'b2', name: 'Batch 2', start_date: '2026-10-03', end_date: '2026-10-24', slots: 70 };
  const b3 = { id: 'b3', name: 'Batch 3', start_date: '2026-11-07', end_date: '2026-11-28', slots: 40 };

  const people = [
    // name, batch, profile: [check-in probability, X probability, probability of a ✓ day with no trade]
    ['Paolo Reyes', 'b1', [0.98, 0.04, 0.3]],
    ['Bea Santos', 'b1', [0.92, 0.12, 0.35]],
    ['Miguel Tan', 'b1', [0.7, 0.2, 0.3]],
    ['Carla Mendoza', 'b1', [0.0, 0, 0]],
    ['Jomar Villanueva', 'b1', [0.5, 0.3, 0.2]],
    ['Ella Ramos', 'b1', [1.0, 0.0, 1.0]],
    ['Nico Bautista', 'b1', [0.85, 0.08, 0.4]],
    ['Trish Aquino', 'b2', [0.95, 0.06, 0.3]],
    ['Ken Navarro', 'b2', [0.6, 0.25, 0.25]],
    ['Liza Garcia', 'b2', [0.0, 0, 0]],
    ['Ramon Cruz', 'b2', [0.8, 0.15, 0.3]],
    ['Joy Dela Rosa', 'b2', [0.4, 0.1, 0.5]],
    ['Arvin Castillo', 'b2', [1.0, 0.0, 0.25]],
    ['Mae Lopez', 'b2', [0.0, 0, 0]],
    ['Dennis Ocampo', 'b3', [0, 0, 0]],
    ['Grace Lim', 'b3', [0, 0, 0]],
  ];

  const students = [
    { id: 'admin', user_id: 'u-admin', full_name: 'Coach (Admin)', email: 'admin@demo.test', batch_id: null, role: 'admin', status: 'active', joined_date: '2026-09-01' },
  ];
  const checkIns = [];
  const trades = [];
  const rulebooks = [];
  const rand = rng(42);
  const symbols = ['NAS100', 'US30', 'XAUUSD', 'EURUSD'];
  const thoughts = [
    'HTF bias bullish after sell-side sweep at London low. Waited for MSS on the 2m, entered on the FVG retrace, target the Asia high.',
    'Bearish daily bias. Price swept buy-side at NY open, shifted structure on the 3m, entered the iFVG with stop above the sweep.',
    'Purge & revert: took out PDL, displaced up, entered on the OB + FVG. Target was opposing liquidity at the session high.',
  ];
  const notes = ['Chased the candle, no FVG', 'Entered before the MSS confirmed', 'Did not check HTF bias first', 'Moved SL to BE too early', 'Revenge trade after first loss'];

  people.forEach(([name, batch, [pIn, pX, pNE]], i) => {
    const id = `s${i + 1}`;
    const start = { b1: b1.start_date, b2: b2.start_date, b3: b3.start_date }[batch];
    const email = name.toLowerCase().replace(/[^a-z]+/g, '.') + '@demo.test';
    students.push({ id, user_id: batch === 'b3' && i === 15 ? null : `u-${id}`, full_name: name, email, batch_id: batch, role: 'student', status: 'active', joined_date: start });
    if (pIn > 0) {
      for (const month of ['2026-09-01', '2026-10-01']) {
        rulebooks.push({ id: uid(), student_id: id, month, max_risk_pct: 1, max_trades_day: 2, max_trades_week: 5, max_daily_loss_r: 2, personal_rules: ['Only trade the NY Open Kill Zone', 'Wait for a liquidity sweep and MSS', 'No trading on red-folder days'], created_at: month + 'T00:00:00Z', updated_at: null });
      }
    }
    for (let d = start; d < today; d = addDays(d, 1)) {
      if (isWeekend(d) || rand() > pIn) continue;
      const r = rand();
      // A ✓ without a trade is a patient day: no valid setup, so no entry.
      const mark = r < pX ? 'X' : 'CHECK';
      const tookTrade = mark === 'X' || r >= pX + pNE;
      const row = { id: uid(), student_id: id, date: d, mark, setup: null, session: null, mistake_tags: [], reason_note: null, no_entry_reason: null, created_at: d + 'T14:00:00Z', edited_at: null, coach_status: null, coach_note: null, reviewed_at: null, auto_flags: [], rules_ticked: [] };
      if (tookTrade) {
        trades.push({
          id: uid(), student_id: id, date: d, symbol: symbols[Math.floor(rand() * symbols.length)],
          direction: rand() < 0.5 ? 'Long' : 'Short', setup: SETUPS[Math.floor(rand() * SETUPS.length)],
          session: SESSIONS[2].name, entry_time_ny: `0${7 + Math.floor(rand() * 2)}:${String(Math.floor(rand() * 6) * 10).padStart(2, '0')}`,
          risk_pct: mark === 'X' && rand() < 0.3 ? 2 : 1, result_r: Math.round((rand() * 4 - 1.2) * 10) / 10,
          ticket: String(50000000 + Math.floor(rand() * 9999999)), mt5_path: 'sample', chart_path: 'sample', chart_url: `https://www.tradingview.com/x/sample${Math.floor(rand() * 1e9)}/`,
          thoughts: thoughts[Math.floor(rand() * thoughts.length)], created_at: d + 'T14:00:00Z', edited_at: null,
          images_removed_at: d < addDays(today, -SCREENSHOT_RETENTION_DAYS) ? today + 'T03:00:00Z' : null,
        });
      }
      if (mark === 'X') {
        row.mistake_tags = [MISTAKE_TAGS[Math.floor(rand() * MISTAKE_TAGS.length)]];
        row.reason_note = notes[Math.floor(rand() * notes.length)];
      } else if (tookTrade) {
        row.setup = SETUPS[Math.floor(rand() * SETUPS.length)];
        row.session = SESSIONS[2].name;
      }
      checkIns.push(row);
    }
  });

  const db = {
    batches: [b1, b2, b3],
    students,
    trading_days: withNews([
      { date: '2026-10-01', is_trading_day: true, news_status: 'NO_TRADE', news_label: 'Day before NFP', trade_allowed_after: null },
      { date: '2026-10-02', is_trading_day: true, news_status: 'RESTRICTED', news_label: 'NFP 8:30', trade_allowed_after: '09:00' },
      { date: '2026-10-07', is_trading_day: true, news_status: 'NO_TRADE', news_label: 'FOMC', trade_allowed_after: null },
      { date: '2026-10-12', is_trading_day: true, news_status: 'NO_TRADE', news_label: 'US holiday', trade_allowed_after: null },
      { date: '2026-10-13', is_trading_day: true, news_status: 'NO_TRADE', news_label: 'Day before CPI', trade_allowed_after: null },
      { date: '2026-10-14', is_trading_day: true, news_status: 'RESTRICTED', news_label: 'Core CPI 8:30 · Day before PPI', trade_allowed_after: null },
      { date: '2026-10-15', is_trading_day: true, news_status: 'RESTRICTED', news_label: 'Core PPI 8:30', trade_allowed_after: '09:00' },
      { date: '2026-10-28', is_trading_day: true, news_status: 'NO_TRADE', news_label: 'FOMC 2PM', trade_allowed_after: null },
      { date: '2026-11-26', is_trading_day: true, news_status: 'NO_TRADE', news_label: 'US holiday · Thanksgiving', trade_allowed_after: null },
    ]),
    check_ins: checkIns,
    trade_posts: trades,
    rulebooks,
    challenges: [
      { id: 'c-oct', name: 'October 30-Day Challenge', description: 'Batch 1 vs Batch 2. Set your own rules, check in every trading day Monday to Friday, and follow them on every trade.', start_date: '2026-10-01', end_date: '2026-10-30', min_checkin_pct: 100, min_rules_pct: 100, batch_ids: ['b1', 'b2'], award_min_checkin_pct: 80, team_draw_count: 1, team_results: null, finalized_at: null },
      { id: 'c-nov', name: 'November 30-Day Challenge', description: 'Batch 1 vs Batch 2. Set your own rules, check in every trading day Monday to Friday, and follow them on every trade.', start_date: '2026-11-09', end_date: '2026-11-30', min_checkin_pct: 100, min_rules_pct: 100, batch_ids: ['b1', 'b2'], award_min_checkin_pct: 80, team_draw_count: 1, team_results: null, finalized_at: null },
    ],
    challenge_winners: [],
    reflections: [],
    app_settings: { id: 1, followup_threshold: 2, inactive_days: 3, news_days_only: true },
  };
  // Seeded students don't trade on no-trade days: those are ✓ days with no trades.
  const tradeable = new Set(db.trading_days.filter((r) => r.news_status !== 'NO_TRADE' && r.news_label).map((r) => r.date));
  for (const c of db.check_ins) {
    if (!tradeable.has(c.date)) {
      Object.assign(c, { mark: 'CHECK', setup: null, session: null, mistake_tags: [], reason_note: null });
    }
  }
  db.trade_posts = db.trade_posts.filter((t) => tradeable.has(t.date));
  return db;
}

export function createDemoApi() {
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
  if (!db) db = seed();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* private mode */ } };
  save();

  const listeners = [];
  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { session = null; }
  const setSession = (s, event) => {
    session = s;
    try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    listeners.forEach((cb) => cb(event, s));
  };
  const upsert = (table, row, key = 'id') => {
    const i = db[table].findIndex((r) => r[key] === row[key]);
    if (i >= 0) db[table][i] = { ...db[table][i], ...row };
    else db[table].push({ ...row });
    save();
    return clone(db[table].find((r) => r[key] === row[key]));
  };
  const remove = (table, key, value) => {
    db[table] = db[table].filter((r) => r[key] !== value);
    save();
  };
  const ok = (v) => Promise.resolve(clone(v));

  // Demo version of public._finalize_challenge: picks the winners once and stores them.
  function finalize(ch) {
    if (!ch || ch.finalized_at) return 0;
    const today = todayNY();
    const cal = new Map(db.trading_days.map((r) => [r.date, r]));
    const marksBy = new Map();
    for (const c of db.check_ins) {
      if (!marksBy.has(c.student_id)) marksBy.set(c.student_id, new Map());
      marksBy.get(c.student_id).set(c.date, c);
    }
    const rows = db.students.filter((s) => s.role === 'student' && s.status === 'active' && inChallenge(ch, s)).map((s) => ({
      s,
      sum: summarize({ student: s, batch: db.batches.find((b) => b.id === s.batch_id), from: ch.start_date, to: ch.end_date, today, cal, marks: marksBy.get(s.id) ?? new Map() }),
    }));
    const { discipline, active, teams } = challengeAwards(ch, rows);
    const won = new Set();
    const add = (r, category, details) => {
      won.add(r.s.id);
      db.challenge_winners.push({ id: uid(), challenge_id: ch.id, student_id: r.s.id, category, details, prop_firm: null, prop_email: null, claimed_at: null, prize_sent_at: null, created_at: new Date().toISOString() });
    };
    const pct = (v) => (v == null ? null : Math.round(v * 1000) / 10);
    if (discipline[0]) add(discipline[0], 'discipline', { discipline: pct(discipline[0].sum.rulesRate), checkin_rate: pct(discipline[0].sum.checkInRate), checks: discipline[0].sum.check, xs: discipline[0].sum.x, days: discipline[0].sum.elapsed });
    const act = active.find((r) => !won.has(r.s.id));
    if (act) add(act, 'active', { checkin_rate: pct(act.sum.checkInRate), checkins: act.sum.checkIns, days: act.sum.elapsed, discipline: pct(act.sum.rulesRate) });
    ch.team_results = teams.map((t) => ({ batch_id: t.batch_id, batch: db.batches.find((b) => b.id === t.batch_id)?.name, members: t.members, score: pct(t.score) }));
    if (teams[0]) {
      const pool = rows.filter((r) => r.s.batch_id === teams[0].batch_id && r.sum.checkInRate >= 0.5 && !won.has(r.s.id));
      for (let i = 0; i < (ch.team_draw_count ?? 1) && pool.length; i++) {
        const r = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
        add(r, 'team', { batch_id: teams[0].batch_id, checkin_rate: pct(r.sum.checkInRate), discipline: pct(r.sum.rulesRate), drawn_at: new Date().toISOString() });
      }
    }
    ch.finalized_at = new Date().toISOString();
    save();
    return db.challenge_winners.filter((w) => w.challenge_id === ch.id).length;
  }
  const finalizeDue = () => db.challenges.filter((c) => !c.finalized_at && c.end_date < todayNY()).forEach(finalize);

  return {
    mode: 'demo',
    demoUsers: () => db.students.filter((s) => s.user_id).map(({ full_name, email, role, batch_id }) => ({ full_name, email, role, batch_id })),
    resetDemo() {
      try {
        Object.keys(localStorage).filter((k) => k.startsWith(IMG_PREFIX)).forEach((k) => localStorage.removeItem(k));
        localStorage.removeItem(KEY);
        localStorage.removeItem(SESSION_KEY);
      } catch { /* ignore */ }
    },

    getSession: () => ok(session),
    onAuthChange: (cb) => listeners.push(cb),
    async signIn(email) {
      const s = db.students.find((r) => r.email.toLowerCase() === email.trim().toLowerCase() && r.user_id);
      if (!s) throw new Error('Wrong email or password.');
      setSession({ user: { id: s.user_id, email: s.email } }, 'SIGNED_IN');
    },
    async activate(email) {
      const s = db.students.find((r) => r.email.toLowerCase() === email.trim().toLowerCase());
      if (!s || s.status !== 'active') throw new Error('This email is not on the roster yet. Ask your coach to add you, then try again.');
      if (s.user_id) throw new Error('This email already has an account. Sign in, or reset your password.');
      s.user_id = 'u-' + uid();
      save();
      setSession({ user: { id: s.user_id, email: s.email } }, 'SIGNED_IN');
      return { needsConfirm: false };
    },
    async signOut() { setSession(null, 'SIGNED_OUT'); },
    async sendReset() {},
    async updatePassword() {},

    me: () => ok(db.students.find((s) => session && s.user_id === session.user.id) ?? null),

    listBatches: () => ok([...db.batches].sort((a, b) => a.start_date.localeCompare(b.start_date))),
    saveBatch: async (b) => upsert('batches', { id: b.id || uid(), ...b }),
    deleteBatch: async (id) => {
      db.students.forEach((s) => { if (s.batch_id === id) s.batch_id = null; });
      remove('batches', 'id', id);
    },

    listStudents: () => ok([...db.students].sort((a, b) => a.full_name.localeCompare(b.full_name))),
    async saveStudent(s) {
      const dup = db.students.find((r) => r.email.toLowerCase() === s.email.toLowerCase() && r.id !== s.id);
      if (dup) throw new Error(`${s.email} is already on the roster.`);
      return upsert('students', { role: 'student', status: 'active', user_id: null, joined_date: todayNY(), ...s, id: s.id || uid() });
    },
    async addStudents(rows) {
      for (const r of rows) {
        if (db.students.some((s) => s.email.toLowerCase() === r.email.toLowerCase())) throw new Error(`${r.email} is already on the roster.`);
      }
      return rows.map((r) => upsert('students', { id: uid(), role: 'student', status: 'active', user_id: null, joined_date: todayNY(), ...r }));
    },
    async deleteStudent(id) {
      db.check_ins = db.check_ins.filter((c) => c.student_id !== id);
      db.trade_posts = db.trade_posts.filter((t) => t.student_id !== id);
      db.rulebooks = db.rulebooks.filter((r) => r.student_id !== id);
      remove('students', 'id', id);
    },

    listTradingDays: () => ok(db.trading_days),
    saveTradingDay: async (row) => upsert('trading_days', { ...row, source: 'manual' }, 'date'),
    async syncForexFactory() {
      throw new Error('Forex Factory sync only runs on the live site, not in demo mode.');
    },
    deleteTradingDay: async (date) => remove('trading_days', 'date', date),

    myCheckIns: (studentId) => ok(db.check_ins.filter((c) => c.student_id === studentId)),
    listCheckIns: (from, to) => ok(db.check_ins.filter((c) => c.date >= from && c.date <= to)),
    async saveCheckIn(row) {
      const existing = db.check_ins.find((c) => c.student_id === row.student_id && c.date === row.date);
      const now = new Date().toISOString();
      const full = existing
        ? { ...existing, ...row, id: existing.id, edited_at: now }
        : { mistake_tags: [], ...row, id: uid(), created_at: now, edited_at: null };
      return upsert('check_ins', full);
    },
    deleteCheckIn: async (id) => remove('check_ins', 'id', id),

    cohortRoster: () => ok(db.students.filter((s) => s.status === 'active').map(({ id, full_name, batch_id, joined_date, role }) => ({ id, full_name, batch_id, joined_date, role }))),
    cohortMarks: (from, to) => ok(db.check_ins.filter((c) => c.date >= from && c.date <= to).map(({ student_id, date, mark, coach_status }) => ({ student_id, date, mark: coach_status === 'invalid' ? 'X' : mark }))),

    listChallenges() {
      finalizeDue();
      return ok([...db.challenges].sort((a, b) => a.start_date.localeCompare(b.start_date)));
    },
    saveChallenge: async (c) => upsert('challenges', { ...c, id: c.id || uid() }),
    deleteChallenge: async (id) => {
      db.reflections = db.reflections.filter((r) => r.challenge_id !== id);
      db.challenge_winners = db.challenge_winners.filter((w) => w.challenge_id !== id);
      remove('challenges', 'id', id);
    },

    // Prize winners: same rules as the database's _finalize_challenge, run in the browser.
    async listWinners(challengeId) {
      finalizeDue();
      const me = db.students.find((s) => session && s.user_id === session.user.id);
      return clone(db.challenge_winners.filter((w) => w.challenge_id === challengeId && (me?.role === 'admin' || w.student_id === me?.id)));
    },
    async winnerList(challengeId) {
      finalizeDue();
      const order = ['discipline', 'active', 'team'];
      return clone(db.challenge_winners.filter((w) => w.challenge_id === challengeId)
        .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category))
        .map((w) => {
          const s = db.students.find((x) => x.id === w.student_id);
          return { category: w.category, full_name: s?.full_name, batch_name: db.batches.find((b) => b.id === s?.batch_id)?.name ?? null, details: w.details };
        }));
    },
    async claimPrize(id, prop_firm, prop_email) {
      const w = db.challenge_winners.find((x) => x.id === id);
      if (w.prize_sent_at) throw new Error('This prize was already sent. Contact your coach to change it.');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(prop_email)) throw new Error('Enter a valid email address.');
      return upsert('challenge_winners', { id, prop_firm, prop_email: prop_email.trim().toLowerCase(), claimed_at: new Date().toISOString() });
    },
    setPrizeSent: async (id, sent) => upsert('challenge_winners', { id, prize_sent_at: sent ? new Date().toISOString() : null }),
    async finalizeChallengeNow(id) {
      return finalize(db.challenges.find((c) => c.id === id));
    },

    listReflections: () => ok([...db.reflections].reverse()),
    async saveReflection(r) {
      const existing = db.reflections.find((x) => x.student_id === r.student_id && x.challenge_id === r.challenge_id);
      return upsert('reflections', { created_at: new Date().toISOString(), ...existing, ...r, id: existing?.id || uid() });
    },

    async reviewCheckIn(id, coach_status, coach_note) {
      return upsert('check_ins', { id, coach_status, coach_note: coach_note || null, reviewed_at: coach_status ? new Date().toISOString() : null });
    },

    getRulebook: (studentId, month) => ok(db.rulebooks.find((r) => r.student_id === studentId && r.month === month) ?? null),
    listRulebooks: (studentId) => ok(db.rulebooks.filter((r) => r.student_id === studentId)),
    listAllRulebooks: (month) => ok(db.rulebooks.filter((r) => r.month === month)),
    async saveRulebook(r) {
      const existing = db.rulebooks.find((x) => x.student_id === r.student_id && x.month === r.month);
      const now = new Date().toISOString();
      return upsert('rulebooks', existing ? { ...existing, ...r, id: existing.id, updated_at: now } : { ...r, id: uid(), created_at: now, updated_at: null });
    },

    listTrades: (studentId, from, to) => ok(db.trade_posts.filter((t) => t.student_id === studentId && t.date >= from && t.date <= to)),
    listAllTrades: (from, to) => ok(db.trade_posts.filter((t) => t.date >= from && t.date <= to)),
    async saveTrade(t) {
      const now = new Date().toISOString();
      return upsert('trade_posts', t.id ? { ...t, edited_at: now } : { ...t, id: uid(), created_at: now, edited_at: null });
    },
    deleteTrade: async (id) => remove('trade_posts', 'id', id),

    async uploadExecution(studentId, blob) {
      const path = `${studentId}/${uid()}.jpg`;
      const dataUrl = await new Promise((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.readAsDataURL(blob);
      });
      try { localStorage.setItem(IMG_PREFIX + path, dataUrl); } catch { throw new Error('Demo storage is full. Reset demo data in Setup.'); }
      return path;
    },
    imageUrl: async (path) => {
      try { return localStorage.getItem(IMG_PREFIX + path) || SAMPLE_IMG; } catch { return SAMPLE_IMG; }
    },
    deleteImage: async (path) => { try { localStorage.removeItem(IMG_PREFIX + path); } catch { /* ignore */ } },

    getSettings: () => ok(db.app_settings),
    async saveSettings(s) {
      db.app_settings = { ...db.app_settings, ...s, id: 1 };
      save();
      return clone(db.app_settings);
    },
  };
}
