# WCT Accountability

The daily check-in dashboard for the Winner Circle Traders 30-Day Development Program. It replaces the Google Sheet.

- **Students** sign in with their own email and password and set **their own rules** each month: max risk per trade, max trades a day and a week, a daily stop, and up to 8 personal rules. Each trading day they mark ✓ (followed my rules) or X (broke my rules). Until they do, the day is **No check-in** and counts as 0. Every trade they took needs a **trade post**: MT5 chart and history screenshots plus their thought process. Not trading when there was no setup, or on a no-trade day, is a ✓ with no trades. The site checks each post against their rules and the news calendar, and turns a ✓ into an X automatically if a rule was broken.
- **You (admin)** are the only one who can add students. You get a **Review** queue to check each day's proof and mark it *Not valid* (it then counts as X), plus the overview, follow-up lists, news calendar, challenge results, CSV export, and **Export for Claude**: one file with everything Claude needs to rank the month and spot logs that look fake.

It's a static website (free on GitHub Pages) with a free Supabase database for logins and data.

---

## Try it first (demo mode)

Add `?demo` to the address (for example `http://localhost:5173/?demo`) to run in **demo mode** with made-up students. Data stays only in your browser. Tap any name to sign in as that person. Without Supabase keys in `js/config.js` the site is always in demo mode.

---

## Go live: one-time setup (about 20 minutes)

### 1. Create the database (Supabase)

1. Go to <https://supabase.com>, sign up and create a **New project** (free plan). Pick the Singapore region since your students are in the Philippines.
2. Open **SQL Editor → New query**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
   This creates the tables, the security rules, Batches 1–3, the October news days, and **you as admin** (`fornillosoliver@gmail.com`).
   Then do the same with [`supabase/002_trades_and_rules.sql`](supabase/002_trades_and_rules.sql), which adds personal rules, trade posts, private storage for MT5 screenshots and coach review. Then [`supabase/003_news_rule_and_screenshots.sql`](supabase/003_news_rule_and_screenshots.sql), which adds the second MT5 screenshot and the "no news = no trade" setting.
3. Go to **Authentication → Sign In / Providers → Email** and turn **off "Confirm email"**, then save.
   *Why:* only emails you've added to the roster can create an account anyway. The free email sender also allows just a few emails per hour, so 40 students confirming on the same day would get stuck.
4. Go to **Project Settings → API** and copy the **Project URL** and the **anon public** key.

### 2. Connect the website

Open [`js/config.js`](js/config.js) and paste them in:

```js
export const SUPABASE_URL = 'https://xxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJ...';
```

The anon key is meant to be public. The security rules in the database decide who can see what.

### 3. Put it online (GitHub Pages)

1. Create a GitHub account if you don't have one, then a **new public repository**, e.g. `wct-accountability`.
2. Upload all the files in this folder (or push with git).
3. In the repository: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save**.
4. After a minute your site is at `https://<your-username>.github.io/wct-accountability/`.
5. Back in Supabase, go to **Authentication → URL Configuration**. Set **Site URL** to that address and add it under **Redirect URLs** too. Password-reset links need this.

### 4. First sign-in

Open the site, choose **First time? Activate**, use `fornillosoliver@gmail.com` and pick a password. You'll land on the admin overview.

---

## Each month (5 minutes)

1. **Calendar**: fills itself from **Forex Factory** every 6 hours (USD high and medium impact, one week at a time, since Forex Factory only publishes the current week). Synced days show an **FF** tag. The sync applies your rules: FOMC day = NO TRADE, the day before NFP, CPI or PPI = NO TRADE, a high-impact 8:30 release = trade only after 9:00, a US holiday = NO TRADE. **A weekday with no news is a NO TRADE day** (this rule can be switched off in Setup). Any day you edit yourself is never overwritten. "↻ Sync from Forex Factory now" runs it on demand. The sync code is in `supabase/functions/ff-sync`, and the schedule comes from `supabase/004_forexfactory_sync.sql`.
2. **Challenges → New challenge**: it pre-fills next month at 100% check-in and 100% rules. Adjust if needed.
3. **New batch?** Setup → New batch, then Students → **Add many**, and paste `Name, email` lines from your sign-up sheet.
4. Tell students: open the link, tap **First time? Activate**, use the same email you gave the coach.

## How scores work

| Mark | Counts as check-in | Discipline % | Needs |
|---|---|---|---|
| ✓ Followed my rules | yes | ✓ | a trade post for each trade taken (MT5 chart + history screenshots, thought process), all rules passed. No trades is fine. |
| X Broke my rules | yes | ✗ | what went wrong, plus a trade post for each trade taken |
| No check-in (default) | no | not counted (0) | – |

- **Discipline %** = ✓ ÷ (✓ + X). Only days a student traded count. A day you mark *Not valid* counts as X.
- **Check-in rate** = check-ins (any mark) ÷ trading days *so far*, from the batch start or "Counts from" if later. Today counts only once it's marked.
- **Leaderboard** ranks by discipline %, then check-in rate, then number of ✓ days. P&L never counts.
- **Rule streak** = trading days in a row with ✓. An X or a day with no check-in resets it.
- **Automatic rule check**: each trade post is compared with the student's own rules (risk %, trades a day and a week, daily stop, ticked personal rules) and the news calendar (no-trade days, "trade after" times). Any break turns the day into an X with the reasons listed.
- **Own rules**: students set them on the My rules page for this month or next. They can change them only on the day they set them. After that they're locked for the month (you can still edit them).
- **Challenge**: check in every trading day, never get an X, and have your own rules set for the month. Not trading on a no-trade day is a ✓.
- On a **NO TRADE** day a student who didn't trade taps ✓, since they followed the rule. If they post a trade, the rule check turns it into an X.
- Students can mark today and up to 3 days back. You can fix any day from the student's page.

## Checking for fake logs

1. **Review** (admin menu): every ✓ and X day with its MT5 screenshot (tap to enlarge), chart link, thought process and the student's rules. "Worth a look" warnings point out a reused MT5 ticket or chart link, copied thought process, missing ticket numbers, and days logged late or edited. Mark a day **✓ Valid** or **✗ Not valid**. Not valid needs a short note the student will see. Editing a day afterwards doesn't undo a Not valid.
2. **Export for Claude** (Overview): downloads `WCT_Claude_Export_<Month>.json`. Give it to Claude, here in Claude Code or on claude.ai, and say "follow the instructions in this file". You get the discipline ranking, a reliability review with evidence for each student, the month's mistake patterns, and who to message.
   The export holds text only. Screenshots stay private in Supabase, so check those in Review.

## Screenshot storage

MT5 screenshots live in the private Supabase Storage bucket `executions`, one folder per student. Only that student and the admin can open them, through links that expire after an hour. Each one is shrunk to at most 1600px (about 150–300 KB) before upload.

To stay inside the free 1 GB, the `cleanup-screenshots` function (in `supabase/functions`, scheduled by `supabase/005_screenshot_cleanup.sql`) runs every day at 11:00 AM PH and **deletes screenshots of trades older than 60 days**. The trade itself, its numbers, thought process, marks and scores are kept, and the site shows "Screenshots removed after 60 days". To change the period, set the `SCREENSHOT_RETENTION_DAYS` secret on the function and `SCREENSHOT_RETENTION_DAYS` in `js/config.js`.

## Files

```
index.html              page shell
css/styles.css          all styling
js/config.js            Supabase keys, setups, sessions, mistake tags
js/app.js               sign-in, navigation
js/views-student.js     Today, My rules, Progress, Leaderboard, Challenge, Certificate
js/views-admin.js       Overview, Review, Students, Calendar, Challenges, Setup, Claude export
js/checkin-form.js      the daily check-in form
js/trades-ui.js         trade post form and cards, screenshot upload
js/rules.js             the automatic rule check
js/metrics.js           every score calculation
js/api-supabase.js      live database
js/api-demo.js          demo mode
supabase/schema.sql     database, security rules, starting data
supabase/002_trades_and_rules.sql   rules, trade posts, screenshots, coach review
```
