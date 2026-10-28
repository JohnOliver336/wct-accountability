// The automatic rule check: compares a day's trade posts with the student's own rules
// and the news calendar. Any flag means the day can't be a ✓.
import { SESSIONS } from './config.js';
import { fmtTime12 } from './dates.js';

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// Session name for a New York 'HH:MM', or null if it falls in no window.
export function sessionFor(hhmm) {
  if (!hhmm) return null;
  const t = toMin(hhmm);
  for (const s of SESSIONS) {
    const a = toMin(s.start), b = toMin(s.end);
    if (a < b ? t >= a && t < b : t >= a || t < b) return s.name;
  }
  return null;
}

/**
 * status:     dayStatus(date) from ui.js
 * dayTrades:  this day's trade posts
 * weekTrades: every trade post Monday..this day of the same week (includes dayTrades)
 * rulebook:   the student's rules for this month, or null
 * ticked:     personal rules the student confirmed they followed
 */
export function checkDay({ status, dayTrades, weekTrades, rulebook, ticked = [] }) {
  const flags = [];
  if (!dayTrades.length) return flags;

  if (status.kind === 'NO_TRADE') flags.push(`Traded on a no-trade day${status.label ? ` (${status.label})` : ''}`);
  if (status.kind === 'RESTRICTED' && status.after) {
    for (const t of dayTrades) {
      const at = t.entry_time_ny?.slice(0, 5);
      if (at && toMin(at) < toMin(status.after)) flags.push(`${t.symbol} entered at ${fmtTime12(at)} NY, before the ${fmtTime12(status.after)} news rule`);
    }
  }
  if (!rulebook) return flags;

  for (const t of dayTrades) {
    if (Number(t.risk_pct) > Number(rulebook.max_risk_pct)) flags.push(`${t.symbol} risked ${Number(t.risk_pct)}%, your max is ${Number(rulebook.max_risk_pct)}%`);
  }
  if (dayTrades.length > rulebook.max_trades_day) flags.push(`${dayTrades.length} trades today, your max is ${rulebook.max_trades_day} a day`);
  if (weekTrades.length > rulebook.max_trades_week) flags.push(`${weekTrades.length} trades this week, your max is ${rulebook.max_trades_week} a week`);

  if (rulebook.max_daily_loss_r) {
    const limit = -Number(rulebook.max_daily_loss_r);
    const ordered = [...dayTrades].sort((a, b) => (a.entry_time_ny || '99').localeCompare(b.entry_time_ny || '99'));
    let total = 0;
    for (const t of ordered) {
      if (total <= limit) {
        flags.push(`Kept trading after losing ${Math.abs(total)}R, your daily stop is ${Math.abs(limit)}R`);
        break;
      }
      total += Number(t.result_r);
    }
  }

  for (const rule of rulebook.personal_rules ?? []) {
    if (!ticked.includes(rule)) flags.push(`Not followed: "${rule}"`);
  }
  return flags;
}
