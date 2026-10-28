// All dates are 'YYYY-MM-DD' strings. A trading day is a New York calendar day.
export const NY_TZ = 'America/New_York';
export const PH_TZ = 'Asia/Manila';

function partsIn(tz, date = new Date()) {
  const p = {};
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  for (const { type, value } of f.formatToParts(date)) p[type] = value;
  return p;
}

export function todayNY() {
  const p = partsIn(NY_TZ);
  return `${p.year}-${p.month}-${p.day}`;
}

// New York calendar day of a timestamp, e.g. a row's created_at.
export function nyDateOf(timestamp) {
  const p = partsIn(NY_TZ, new Date(timestamp));
  return `${p.year}-${p.month}-${p.day}`;
}

export function toUTC(d) {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd));
}

export const iso = (dt) => dt.toISOString().slice(0, 10);

export function addDays(d, n) {
  const t = toUTC(d);
  t.setUTCDate(t.getUTCDate() + n);
  return iso(t);
}

export const dow = (d) => toUTC(d).getUTCDay();
export const isWeekend = (d) => dow(d) === 0 || dow(d) === 6;
export const monthStart = (d) => d.slice(0, 8) + '01';

export function monthEnd(d) {
  const t = toUTC(monthStart(d));
  t.setUTCMonth(t.getUTCMonth() + 1);
  t.setUTCDate(0);
  return iso(t);
}

export function addMonths(d, n) {
  const t = toUTC(monthStart(d));
  t.setUTCMonth(t.getUTCMonth() + n);
  return iso(t);
}

// Monday of the week containing d.
export const weekStart = (d) => addDays(d, -((dow(d) + 6) % 7));

export function eachDay(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export const maxDate = (...ds) => ds.filter(Boolean).sort().at(-1);
export const minDate = (...ds) => ds.filter(Boolean).sort()[0];

export function fmtDate(d, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(toUTC(d));
}
export const fmtMonth = (d) => fmtDate(d, { month: 'long', year: 'numeric' });
export const fmtLong = (d) => fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' });

// '09:00' New York time on date d, shown as Manila time, e.g. '9:00 PM'.
export function nyTimeInManila(d, hhmm) {
  const [y, m, dd] = d.split('-').map(Number);
  const [h, min] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, dd, h, min);
  const p = partsIn(NY_TZ, new Date(guess));
  const asNY = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  const real = new Date(guess - (asNY - guess));
  return new Intl.DateTimeFormat('en-US', { timeZone: PH_TZ, hour: 'numeric', minute: '2-digit' }).format(real);
}

// A Manila clock time on New York trading day d, as New York 'HH:MM'. PH evening and the
// early hours of the next PH morning both belong to the same NY day, so try both.
export function phTimeToNY(d, hhmm) {
  const [h, min] = hhmm.split(':').map(Number);
  for (const phDay of [d, addDays(d, 1), addDays(d, -1)]) {
    const [y, m, dd] = phDay.split('-').map(Number);
    const instant = new Date(Date.UTC(y, m - 1, dd, h, min) - 8 * 3600e3);
    const p = partsIn(NY_TZ, instant);
    if (`${p.year}-${p.month}-${p.day}` === d) return `${p.hour}:${p.minute}`;
  }
  return null;
}

export function fmtTime12(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
