// Forex Factory -> news calendar sync.
// Reads this week's Forex Factory calendar, keeps USD high and medium-impact events and
// holidays, applies the coach's news rules, and writes the result to public.trading_days.
// Days the coach set by hand (source = 'manual') are never touched.
//
// Rules (from the October 2026 accountability sheet):
//   - FOMC day (FOMC Statement / Federal Funds Rate)  -> NO TRADE
//   - The trading day before NFP, CPI or PPI           -> NO TRADE
//   - High-impact release at 8:30 New York time        -> trade only after 9:00
//   - US bank holiday                                   -> NO TRADE
//   - Any other high or medium-impact USD news          -> trading allowed
//   - No high or medium-impact USD news at all          -> no row (the site treats it as no trade)
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const FEED = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

type FFEvent = { title: string; country: string; date: string; impact: string };
type Row = { date: string; is_trading_day: boolean; news_status: string; news_label: string | null; trade_allowed_after: string | null; source: string; synced_at: string };

const isFOMC = (t: string) => /FOMC Statement|Federal Funds Rate/i.test(t);
const BIG_RELEASE: [RegExp, string][] = [
  [/Non-Farm Employment Change/i, 'NFP'],
  [/^(Core )?CPI (m\/m|y\/y)/i, 'CPI'],
  [/^(Core )?PPI (m\/m|y\/y)/i, 'PPI'],
];

function nyParts(iso: string) {
  const p: Record<string, string> = {};
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (const { type, value } of f.formatToParts(new Date(iso))) p[type] = value;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

const addDays = (d: string, n: number) => {
  const t = new Date(d + 'T12:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const dow = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay();
const fmtTime = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`;
};

function buildWeek(events: FFEvent[], now: string) {
  const usd = events.filter((e) => e.country === 'USD' && ['High', 'Medium', 'Holiday'].includes(e.impact));
  // Monday..Friday of the feed's week. Forex Factory weeks start on Sunday, so a Sunday
  // date belongs to the Monday after it.
  const anyDate = nyParts(events[Math.floor(events.length / 2)].date).date;
  const monday = dow(anyDate) === 0 ? addDays(anyDate, 1) : addDays(anyDate, -((dow(anyDate) + 6) % 7));
  const week = [0, 1, 2, 3, 4].map((i) => addDays(monday, i));

  const byDay = new Map<string, { title: string; impact: string; time: string }[]>();
  for (const e of usd) {
    const { date, time } = nyParts(e.date);
    if (!week.includes(date)) continue;
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date)!.push({ title: e.title, impact: e.impact, time });
  }

  const dayBefore = new Map<string, string[]>();
  for (const [date, list] of byDay) {
    for (const [re, name] of BIG_RELEASE) {
      if (!list.some((e) => re.test(e.title))) continue;
      const prev = dow(date) === 1 ? null : addDays(date, -1); // a Monday release's "day before" is last week
      if (prev && week.includes(prev)) dayBefore.set(prev, [...(dayBefore.get(prev) ?? []), name]);
    }
  }

  const rows: Row[] = [];
  for (const date of week) {
    const list = (byDay.get(date) ?? []).sort((a, b) => (a.impact === 'High' ? 0 : 1) - (b.impact === 'High' ? 0 : 1) || a.time.localeCompare(b.time));
    const news = list.filter((e) => e.impact !== 'Holiday');
    const holiday = list.find((e) => e.impact === 'Holiday');
    const label = [...new Set(news.map((e) => (e.time === '00:00' ? e.title : `${e.title} ${fmtTime(e.time)}`)))].join(' · ');
    const base = { date, is_trading_day: true, trade_allowed_after: null, source: 'forexfactory', synced_at: now };

    if (holiday) rows.push({ ...base, news_status: 'NO_TRADE', news_label: `US holiday · ${holiday.title}` });
    else if (news.some((e) => isFOMC(e.title))) rows.push({ ...base, news_status: 'NO_TRADE', news_label: `FOMC ${fmtTime(news.find((e) => isFOMC(e.title))!.time)}` });
    else if (dayBefore.has(date)) rows.push({ ...base, news_status: 'NO_TRADE', news_label: `Day before ${[...new Set(dayBefore.get(date))].join(' & ')}${label ? ` · ${label}` : ''}` });
    else if (news.some((e) => e.impact === 'High' && e.time === '08:30')) rows.push({ ...base, news_status: 'RESTRICTED', news_label: label, trade_allowed_after: '09:00' });
    else if (news.length) rows.push({ ...base, news_status: 'NORMAL', news_label: label });
    // No high or medium-impact news: no row, so the site shows a no-trade day.
  }
  return { week, rows };
}

Deno.serve(async () => {
  try {
    const res = await fetch(FEED, { headers: { 'User-Agent': 'WCT-Accountability/1.0' } });
    if (!res.ok) throw new Error(`Forex Factory feed returned ${res.status}`);
    const events = (await res.json()) as FFEvent[];
    if (!events.length) throw new Error('Forex Factory feed was empty');

    const now = new Date().toISOString();
    const { week, rows } = buildWeek(events, now);
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: existing, error: readErr } = await sb.from('trading_days').select('date, source').in('date', week);
    if (readErr) throw readErr;
    const manual = new Set((existing ?? []).filter((r) => r.source !== 'forexfactory').map((r) => r.date));

    const toWrite = rows.filter((r) => !manual.has(r.date));
    if (toWrite.length) {
      const { error } = await sb.from('trading_days').upsert(toWrite);
      if (error) throw error;
    }
    // Synced days whose news disappeared from the feed go back to "no news".
    const stale = (existing ?? []).filter((r) => r.source === 'forexfactory' && !rows.some((x) => x.date === r.date)).map((r) => r.date);
    if (stale.length) {
      const { error } = await sb.from('trading_days').delete().in('date', stale).eq('source', 'forexfactory');
      if (error) throw error;
    }

    return Response.json({ ok: true, week, written: toWrite.map((r) => `${r.date} ${r.news_status} ${r.news_label}`), kept_manual: [...manual], cleared: stale });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error).message ?? e) }, { status: 500 });
  }
});
