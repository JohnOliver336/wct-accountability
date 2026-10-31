-- One-off: October 2026 news days from before the Forex Factory sync started (Oct 26).
-- Forex Factory's feed only covers the current week, so earlier weeks are typed in here
-- from the Forex Factory website. Safe to run more than once.
insert into public.trading_days (date, news_status, news_label, trade_allowed_after, source)
values
  ('2026-10-22', 'NORMAL', 'Unemployment Claims 8:30', null, 'manual'),
  ('2026-10-23', 'NORMAL', 'Flash Manufacturing PMI 9:45 · Flash Services PMI 9:45 · Revised UoM Consumer Sentiment 10:00 · Revised UoM Inflation Expectations 10:00', null, 'manual')
on conflict (date) do update
  set news_status = excluded.news_status,
      news_label = excluded.news_label,
      trade_allowed_after = excluded.trade_allowed_after,
      source = excluded.source;
