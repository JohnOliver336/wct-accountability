import { api } from './api.js';
import { todayNY } from './dates.js';

// Data every screen needs, loaded once after sign-in.
export const store = {
  me: null,
  batches: [],
  cal: new Map(),
  settings: { followup_threshold: 2, inactive_days: 3 },
  challenges: [],
  today: todayNY(),
};

export async function loadReference() {
  const [batches, days, settings, challenges] = await Promise.all([
    api.listBatches(), api.listTradingDays(), api.getSettings(), api.listChallenges(),
  ]);
  store.batches = batches;
  store.cal = new Map(days.map((d) => [d.date, d]));
  store.settings = settings;
  store.challenges = challenges;
  store.today = todayNY();
}

export const batchOf = (s) => store.batches.find((b) => b.id === s?.batch_id) ?? null;
export const batchName = (s) => batchOf(s)?.name ?? '—';

// Context object the metrics functions expect.
export const ctx = (student, marks) => ({ student, batch: batchOf(student), today: store.today, cal: store.cal, marks });
