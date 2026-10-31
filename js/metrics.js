// Every score is computed here, never stored.
// Discipline % = ✓ / (✓ + X). A day with no mark is "no check-in" (0). NO_ENTRY only appears
// on check-ins saved before it was retired; it counts as showing up but not in discipline.
import { addDays, eachDay, isWeekend, maxDate, minDate } from './dates.js';

// A day the coach marked "not valid" counts as an X.
export const effMark = (ci) => (ci ? (ci.coach_status === 'invalid' ? 'X' : ci.mark) : null);
export const followed = (mark) => mark === 'CHECK' || mark === 'NO_ENTRY';

export function isTradingDay(date, cal) {
  if (isWeekend(date)) return false;
  return cal.get(date)?.is_trading_day !== false;
}

export function tradingDays(from, to, cal) {
  if (!from || !to || from > to) return [];
  return eachDay(from, to).filter((d) => isTradingDay(d, cal));
}

// First day a student is expected to check in.
export const studentStart = (student, batch) => maxDate(batch?.start_date, student?.joined_date);

// Days from `from` to `to` (capped at today) that the student was expected to mark.
// Today only counts once it has been marked, so nobody looks behind before the session.
export function expectedDays({ student, batch, from, to, today, cal, marks }) {
  const start = maxDate(from, studentStart(student, batch));
  const days = tradingDays(start, minDate(to, today), cal);
  if (days.at(-1) === today && !marks.has(today)) days.pop();
  return days;
}

export function summarize(opts) {
  const { marks } = opts;
  const days = expectedDays(opts);
  let check = 0, x = 0, noEntry = 0;
  for (const d of days) {
    const m = effMark(marks.get(d));
    if (m === 'CHECK') check++;
    else if (m === 'X') x++;
    else if (m === 'NO_ENTRY') noEntry++;
  }
  const checkIns = check + x + noEntry;
  const traded = check + x;
  const elapsed = days.length;
  return {
    elapsed, checkIns, check, x, noEntry, traded,
    missed: elapsed - checkIns,
    checkInRate: elapsed ? checkIns / elapsed : null,
    // Discipline score: ✓ / (✓ + X). NO ENTRY days are not part of it.
    rulesRate: traded ? check / traded : null,
  };
}

// Leaderboard order: discipline %, then check-in rate, then number of ✓ days.
export function rankCompare(a, b) {
  return (b.rulesRate ?? -1) - (a.rulesRate ?? -1)
    || (b.checkInRate ?? -1) - (a.checkInRate ?? -1)
    || b.check - a.check;
}

export function streaks({ student, batch, today, cal, marks }) {
  const days = expectedDays({ student, batch, from: studentStart(student, batch), to: today, today, cal, marks });
  let current = 0, rule = 0;
  for (let i = days.length - 1; i >= 0 && marks.has(days[i]); i--) current++;
  for (let i = days.length - 1; i >= 0 && followed(effMark(marks.get(days[i]))); i--) rule++;
  let best = 0, run = 0;
  for (const d of days) {
    run = followed(effMark(marks.get(d))) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return { current, rule, best };
}

export function lastCheckIn(marks) {
  let last = null;
  for (const d of marks.keys()) if (!last || d > last) last = d;
  return last;
}

// Trading days in a row with no mark, ending yesterday (or today once it has passed).
export function daysSilent({ student, batch, today, cal, marks }) {
  const last = lastCheckIn(marks);
  const from = last ? addDays(last, 1) : studentStart(student, batch);
  return expectedDays({ student, batch, from, to: today, today, cal, marks }).length;
}

// hasRules: whether the student set their own rules for this challenge's month. Without them
// a student can't complete the challenge.
export function challengeStatus(ch, { student, batch, today, cal, marks }, { hasRules = true } = {}) {
  if (!inChallenge(ch, student)) return { ...summarize({ student, batch, from: ch.start_date, to: ch.end_date, today, cal, marks }), total: 0, remaining: 0, state: 'not_eligible' };
  const start = maxDate(ch.start_date, studentStart(student, batch));
  const total = tradingDays(start, ch.end_date, cal).length;
  const s = summarize({ student, batch, from: ch.start_date, to: ch.end_date, today, cal, marks });
  if (today < ch.start_date) return { ...s, total, remaining: total, state: 'upcoming' };
  if (!total) return { ...s, total, remaining: 0, state: 'not_eligible' };
  const remaining = total - s.elapsed;
  const bestCheckIn = (s.checkIns + remaining) / total;
  // Best case: every remaining day is a ✓.
  const bestRules = s.traded + remaining ? (s.check + remaining) / (s.traded + remaining) : 1;
  const eps = 1e-9;
  let state = 'on_track';
  if (bestCheckIn + eps < ch.min_checkin_pct / 100 || bestRules + eps < ch.min_rules_pct / 100) state = 'failed';
  else if (!hasRules) state = 'needs_rules';
  else if (remaining === 0) state = 'completed';
  return { ...s, total, remaining, state };
}

// A challenge can be limited to some batches (batch_ids); none set means every batch.
export const inChallenge = (ch, student) => !ch?.batch_ids?.length || ch.batch_ids.includes(student?.batch_id);

// Live standings and awards for a challenge. Same rules as public._finalize_challenge in
// supabase/007_challenge_prizes.sql, which picks the official winners once it ends.
// rows: [{ s, sum }] where sum = summarize() over the challenge window.
export function challengeAwards(ch, rows) {
  const people = rows.filter((r) => inChallenge(ch, r.s) && r.sum.elapsed > 0);
  const min = (ch.award_min_checkin_pct ?? 80) / 100;
  const discipline = people
    .filter((r) => r.sum.rulesRate != null && r.sum.checkInRate >= min - 1e-9)
    .sort((a, b) => b.sum.rulesRate - a.sum.rulesRate || b.sum.checkInRate - a.sum.checkInRate || b.sum.check - a.sum.check);
  const active = people
    .filter((r) => r.sum.checkIns > 0)
    .sort((a, b) => b.sum.checkInRate - a.sum.checkInRate || b.sum.check - a.sum.check || (b.sum.rulesRate ?? -1) - (a.sum.rulesRate ?? -1));
  // Team score: average per student of discipline x check-in rate; ghosts count as 0.
  const byBatch = new Map();
  for (const r of rows.filter((x) => inChallenge(ch, x.s) && x.s.batch_id)) {
    if (!byBatch.has(r.s.batch_id)) byBatch.set(r.s.batch_id, []);
    byBatch.get(r.s.batch_id).push((r.sum.rulesRate ?? 0) * (r.sum.checkInRate ?? 0));
  }
  const teams = [...byBatch].map(([batch_id, v]) => ({ batch_id, members: v.length, score: v.reduce((a, b) => a + b, 0) / v.length }))
    .sort((a, b) => b.score - a.score);
  return { discipline, active, teams };
}

export function activeChallenge(challenges, today) {
  const sorted = [...challenges].sort((a, b) => a.start_date.localeCompare(b.start_date));
  return sorted.find((c) => c.start_date <= today && c.end_date >= today)
    ?? sorted.find((c) => c.start_date > today)
    ?? sorted.at(-1)
    ?? null;
}

export function indexMarks(checkIns) {
  const by = new Map();
  for (const c of checkIns) {
    if (!by.has(c.student_id)) by.set(c.student_id, new Map());
    by.get(c.student_id).set(c.date, c);
  }
  return by;
}
