// Daily check-in reminder emails, sent through Resend.
//  - Activated students who haven't checked in today get a reminder.
//  - On Mondays, roster students who never activated their account get an "activate" nudge.
// Runs on weekdays (see supabase/006_reminders_and_weekly_report.sql). Skips days that
// aren't counted (market closed). Secrets: RESEND_API_KEY, EMAIL_FROM, SITE_URL.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SITE = Deno.env.get('SITE_URL') ?? 'https://johnoliver336.github.io/wct-accountability/';
const FROM = Deno.env.get('EMAIL_FROM') ?? 'WCT Accountability <onboarding@resend.dev>';

function nyToday() {
  const p: Record<string, string> = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())) p[type] = value;
  return `${p.year}-${p.month}-${p.day}`;
}
const dow = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay();
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function email(title: string, body: string, button: string) {
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;background:#0a0a0a;color:#f2f2f2;padding:28px;border-radius:14px">
    <div style="color:#ff7a00;font-weight:700;letter-spacing:.08em;font-size:12px">WINNER CIRCLE TRADERS</div>
    <h2 style="margin:8px 0 12px">${title}</h2>
    <div style="color:#c8c8c8;font-size:15px;line-height:1.5">${body}</div>
    <a href="${SITE}" style="display:inline-block;margin-top:18px;background:#ff7a00;color:#0a0a0a;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:10px">${button}</a>
    <p style="color:#777;font-size:12px;margin-top:22px">Control the input, not the outcome.</p></div>`;
}

Deno.serve(async (req) => {
  // Only the scheduler (and the coach's manual test) knows this secret.
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return new Response('Forbidden', { status: 403 });
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const today = nyToday();
    if (dow(today) === 0 || dow(today) === 6) return Response.json({ ok: true, skipped: 'weekend' });

    const [{ data: day }, { data: settings }, { data: students, error: sErr }, { data: batches }, { data: checkIns }] = await Promise.all([
      sb.from('trading_days').select('*').eq('date', today).maybeSingle(),
      sb.from('app_settings').select('news_days_only').eq('id', 1).maybeSingle(),
      sb.from('students').select('id, full_name, email, user_id, batch_id, joined_date').eq('status', 'active').eq('role', 'student'),
      sb.from('batches').select('id, start_date'),
      sb.from('check_ins').select('student_id').eq('date', today),
    ]);
    if (sErr) throw sErr;
    if (day?.is_trading_day === false) return Response.json({ ok: true, skipped: 'market closed' });

    const noNews = settings?.news_days_only !== false && (!day || (day.news_status === 'NORMAL' && !day.news_label));
    const status = day?.news_status === 'NO_TRADE' || noNews
      ? `Today is a <b style="color:#ef4444">NO TRADE</b> day${day?.news_label ? ` (${esc(day.news_label)})` : noNews ? ' (no high or medium-impact news)' : ''}. Didn't trade? Tap ✓, you followed the rule.`
      : day?.news_status === 'RESTRICTED' && day.trade_allowed_after
        ? `News today: ${esc(day.news_label ?? '')}. Trade only after ${day.trade_allowed_after.slice(0, 5)} New York time.`
        : `Trading day${day?.news_label ? `: ${esc(day.news_label)}` : ''}.`;

    const startOf = (s: { batch_id: string | null; joined_date: string }) => {
      const b = batches?.find((x) => x.id === s.batch_id)?.start_date;
      return b && b > s.joined_date ? b : s.joined_date;
    };
    const done = new Set((checkIns ?? []).map((c) => c.student_id));
    const eligible = (students ?? []).filter((s) => startOf(s) <= today);

    const messages = [];
    for (const s of eligible) {
      const first = esc(s.full_name.split(' ')[0]);
      if (s.user_id && !done.has(s.id)) {
        messages.push({ from: FROM, to: [s.email], subject: `${s.full_name.split(' ')[0]}, you haven't checked in today`,
          html: email(`Hi ${first}, quick check-in?`, `${status}<br><br>Mark today ✓ or X. It takes 5 seconds, and every honest day counts.`, 'Check in now') });
      } else if (!s.user_id && dow(today) === 1) {
        messages.push({ from: FROM, to: [s.email], subject: 'Activate your WCT Accountability account',
          html: email(`Hi ${first}, your seat is waiting`, 'Your coach added you to the WCT Accountability dashboard. Open the link, tap <b>First time? Activate</b>, and use this email address.', 'Activate my account') });
      }
    }

    let sent = 0;
    for (let i = 0; i < messages.length; i += 100) {
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(messages.slice(i, i + 100)),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
      sent += messages.slice(i, i + 100).length;
    }
    return Response.json({ ok: true, date: today, eligible: eligible.length, already_checked_in: done.size, emails_sent: sent });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error).message ?? e) }, { status: 500 });
  }
});
