// Weekly Claude coaching report, emailed to the coach before the Saturday lesson.
// Gathers Monday-Friday of the current New York week (check-ins, trade posts, rulebooks,
// news calendar), asks Claude for a discipline ranking, a reliability review, mistake
// patterns and follow-ups, and emails the result through Resend.
// Secrets: ANTHROPIC_API_KEY, RESEND_API_KEY, EMAIL_FROM, REPORT_TO.
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const FROM = Deno.env.get('EMAIL_FROM') ?? 'WCT Accountability <onboarding@resend.dev>';

const PROMPT = `You are helping a trading coach (Winner Circle Traders, 30-Day Development Program) review one week of student accountability check-ins.

How the system works: each student sets their own monthly rules (max risk per trade, max trades per day and week, daily stop in R, personal rules). Each trading day they mark CHECK (followed my rules) or X (broke my rules); a day with no mark is "no check-in" and counts as 0. A CHECK day may have no trades: not trading when there was no setup, or on a no-trade day, is following the rules. Every trade taken needs a post with MT5 chart and trade-history screenshots and a thought process. Discipline % = CHECK / (CHECK + X). A day the coach marked "invalid" counts as X (effective_mark). The site's automatic rule check results are in auto_rule_check_flags. Students may only trade on days with high or medium-impact USD news; no-trade days are listed in trading_days. P&L never counts.

Write the report as a clean HTML fragment for an email (h2, h3, p, ul, li, table with inline border styles only; no <html>, <head>, scripts or external CSS). Keep it short and scannable. Sections:
1. Week at a glance: check-in rate across the roster, discipline %, how many never checked in.
2. Discipline ranking: top 10 (ties: check-in rate, then CHECK days). List anyone with fewer than 3 marked days separately.
3. Reliability review: students whose logs may not be genuine, each with concrete evidence from the data (CHECK days whose trades break their own rulebook without being flagged, trades on no-trade days marked CHECK, generic or copied thought processes, reused tickets, too-perfect results, CHECK every day with almost no trades posted, days logged late or edited). Rate low / medium / high concern. Present evidence, don't accuse. Also name students who look clearly genuine.
4. Mistake patterns: the most common rule breaks this week and one suggested topic for Saturday's lesson.
5. Follow-ups: who to message (no check-ins, repeated X, high concern), each with a one-line suggested message.`;

function nyToday() {
  const p: Record<string, string> = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())) p[type] = value;
  return `${p.year}-${p.month}-${p.day}`;
}
const addDays = (d: string, n: number) => {
  const t = new Date(d + 'T12:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const dow = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay();

Deno.serve(async (req) => {
  // Only the scheduler (and the coach's manual test) knows this secret.
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return new Response('Forbidden', { status: 403 });
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const today = nyToday();
    const monday = addDays(today, -((dow(today) + 6) % 7));
    const friday = addDays(monday, 4);
    const month = monday.slice(0, 8) + '01';

    const [students, batches, checkIns, trades, books, days] = await Promise.all([
      sb.from('students').select('id, full_name, batch_id, joined_date').eq('status', 'active').eq('role', 'student'),
      sb.from('batches').select('id, name, start_date'),
      sb.from('check_ins').select('*').gte('date', monday).lte('date', friday),
      sb.from('trade_posts').select('*').gte('date', monday).lte('date', friday),
      sb.from('rulebooks').select('*').eq('month', month),
      sb.from('trading_days').select('date, news_status, news_label, trade_allowed_after').gte('date', monday).lte('date', friday),
    ]);
    for (const r of [students, batches, checkIns, trades, books, days]) if (r.error) throw r.error;

    const batchOf = (id: string | null) => batches.data!.find((b) => b.id === id);
    const data = {
      week: `${monday} to ${friday}`,
      trading_days: days.data,
      students: students.data!.map((s) => {
        const start = [batchOf(s.batch_id)?.start_date, s.joined_date].filter(Boolean).sort().at(-1);
        const rb = books.data!.find((b) => b.student_id === s.id);
        return {
          name: s.full_name,
          batch: batchOf(s.batch_id)?.name ?? null,
          expected_from: start,
          rulebook: rb ? { max_risk_pct: rb.max_risk_pct, max_trades_day: rb.max_trades_day, max_trades_week: rb.max_trades_week, daily_stop_r: rb.max_daily_loss_r, personal_rules: rb.personal_rules } : null,
          days: checkIns.data!.filter((c) => c.student_id === s.id).map((c) => ({
            date: c.date, mark: c.mark, effective_mark: c.coach_status === 'invalid' ? 'X' : c.mark,
            logged_at: c.created_at, edited_at: c.edited_at, mistake_tags: c.mistake_tags, note: c.reason_note,
            auto_rule_check_flags: c.auto_flags, personal_rules_ticked: c.rules_ticked, coach_status: c.coach_status, coach_note: c.coach_note,
            trades: trades.data!.filter((t) => t.student_id === s.id && t.date === c.date).map((t) => ({
              symbol: t.symbol, direction: t.direction, entry_model: t.setup, session: t.session, entry_time_ny: t.entry_time_ny,
              risk_pct: t.risk_pct, result_r: t.result_r, mt5_ticket: t.ticket, thoughts: t.thoughts, posted_at: t.created_at,
            })),
          })),
        };
      }),
    };

    const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: PROMPT,
      messages: [{ role: 'user', content: `Here is this week's data as JSON:\n\n${JSON.stringify(data)}` }],
    } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);

    if (response.stop_reason === 'refusal') throw new Error(`Claude declined the report: ${response.stop_details?.explanation ?? 'no details'}`);
    const html = response.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n')
      .replace(/^```html\s*|```\s*$/g, '');

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [Deno.env.get('REPORT_TO')],
        subject: `WCT weekly report · ${monday} to ${friday}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:720px;margin:auto;color:#1a1a1a">${html}
          <p style="color:#888;font-size:12px">Generated by Claude from your accountability dashboard. Check screenshots in Admin → Review before acting on any concern.</p></div>`,
      }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
    return Response.json({ ok: true, week: data.week, students: data.students.length, usage: response.usage });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error).message ?? e) }, { status: 500 });
  }
});
