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

// MT5 screenshots older than this are deleted by the cleanup-screenshots function
// (keep in sync with SCREENSHOT_RETENTION_DAYS there). Trades and notes stay.
export const SCREENSHOT_RETENTION_DAYS = 60;
