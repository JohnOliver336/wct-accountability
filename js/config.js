// Paste your Supabase project URL and anon (public) key here.
// Supabase Dashboard > Project Settings > API. Leave both empty to run in demo mode.
export const SUPABASE_URL = 'https://hffmjtajlsqkhbdrcmpq.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmZm1qdGFqbHNxa2hiZHJjbXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxNDkxODgsImV4cCI6MjEwODcyNTE4OH0.-Sij7FTwWVQiItTZsLVK1aJlWhAXkxHm0Mbopfh5pVE';

export const APP_NAME = 'Winner Circle Traders';
export const PROGRAM_NAME = '30-Day Development Program';

// Definitions from the Guide tab of the October sheet, kept word for word.
export const MARKS = {
  CHECK: {
    label: 'Followed my rules',
    glyph: '✓',
    definition: 'Followed my rules that day: right session and time (New York time, UTC-4), one of the entry models, risk and stop loss as taught. Not trading when there was no valid setup, or on a no-trade day, also counts.',
  },
  X: {
    label: 'Broke my rules',
    glyph: 'X',
    definition: 'Broke one or more of my rules that day. Write which one in Notes.',
  },
  // No longer offered; kept so check-ins saved before the change still display.
  NO_ENTRY: {
    label: 'No entry (old)',
    glyph: '–',
    definition: 'Showed up and did not trade because there was no valid setup, or it was a no-trade day. Patience is a win.',
  },
};

// From the WCT Trade Journal app.
export const SETUPS = ['iFVG + OB', 'FVG + BRKR', 'iFVG + BRKR', 'FVG + MSS', 'BPR + iFVG', 'OB + iFVG', 'FVG + OB'];

export const SESSIONS = [
  { name: 'Asia Session', start: '19:00', end: '02:00' },
  { name: 'London Open Kill Zone', start: '02:00', end: '05:00' },
  { name: 'New York Open Kill Zone', start: '07:00', end: '09:30' },
  { name: 'Opening Range', start: '09:30', end: '10:00' },
  { name: 'London Close Kill Zone', start: '10:00', end: '12:00' },
  { name: 'Lunch Hour', start: '12:00', end: '13:30' },
  { name: 'PM Session', start: '13:30', end: '16:00' },
];

export const MISTAKE_TAGS = [
  'FOMO entry',
  'Entered too early',
  'Moved stop loss',
  'Broke risk rules',
  'Revenge trade',
  'No confirmation',
  'Overtraded',
  'Cut winner early',
  'Traded on news / no-trade day',
];

export const NO_ENTRY_REASONS = [
  { id: 'no_setup', label: 'No valid setup' },
  { id: 'news_day', label: 'News / no-trade day' },
  { id: 'missed_session', label: 'Missed the session' },
  { id: 'other', label: 'Other' },
];

// How many calendar days back a student may still mark (today plus this many).
export const EDIT_WINDOW_DAYS = 3;

// Prize options the coach picks for each challenge winner (students can't choose).
export const PROP_FIRMS = ['Equity Edge', 'Alpha Capital Group (ACG)', 'The5ers', 'Other'];
export const ACCOUNT_SIZES = ['$5K', '$10K', '$25K', '$50K', '$100K'];
export const ACCOUNT_TYPES = ['1-Step', '2-Step', 'Instant Funding'];

// Challenge sponsors, shown on every page, the sign-in screen and the challenge page.
// To show a logo, put the file in assets/sponsors/ and set logo, e.g. 'assets/sponsors/equity-edge.png'.
// url (optional) makes the name a link, e.g. an affiliate link.
export const SPONSORS = [
  { name: 'Equity Edge', logo: null, url: null },
  { name: 'Alpha Capital Group', logo: null, url: null },
  { name: 'The5ers', logo: null, url: null },
];

// "$10K The5ers 2-Step" from a prize ({ prop_firm, account_size, account_type }); '' until firm and size are set.
export const prizeText = (p) => (p?.prop_firm && p?.account_size ? [p.account_size, p.prop_firm, p.account_type].filter(Boolean).join(' ') : '');

// Winners in award order, then by place (1st, 2nd, ...).
export const sortWinners = (rows) => [...rows].sort((a, b) => Object.keys(AWARDS).indexOf(a.category) - Object.keys(AWARDS).indexOf(b.category) || (a.details?.place ?? 0) - (b.details?.place ?? 0));

// An award's prize tiers: places 1..count win the main prize, the next extra.count places win
// the extra prize. challenges.prizes.<award> = { count, prop_firm, account_size, account_type, extra: {...} }.
export function prizeTiers(ch, cat) {
  const p = ch?.prizes?.[cat] ?? {};
  const first = cat === 'team' ? Number(p.count ?? ch?.team_draw_count ?? 1) : Math.max(1, Number(p.count) || 1);
  const tiers = [{ ...p, count: first }];
  if (Number(p.extra?.count) > 0) tiers.push({ ...p.extra, count: Number(p.extra.count) });
  return tiers.filter((t) => t.count > 0);
}
export const winnerCount = (ch, cat) => prizeTiers(ch, cat).reduce((n, t) => n + t.count, 0);
export function prizeFor(ch, cat, place) {
  let upTo = 0;
  for (const t of prizeTiers(ch, cat)) if (place <= (upTo += t.count)) return t;
  return {};
}

// Challenge award names, shown to students and in the admin winners table.
export const AWARDS = {
  discipline: { icon: '🎯', label: 'Most Disciplined' },
  active: { icon: '⚡', label: 'Most Active' },
  team: { icon: '🤝', label: 'Team draw' },
};

// MT5 screenshots older than this are deleted by the cleanup-screenshots function
// (keep in sync with SCREENSHOT_RETENTION_DAYS there). Trades and notes stay.
export const SCREENSHOT_RETENTION_DAYS = 60;
