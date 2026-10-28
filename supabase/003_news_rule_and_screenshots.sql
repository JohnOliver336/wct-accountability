-- =============================================================================
-- Update 3: two MT5 screenshots per trade, and the "no news = no trade" rule
-- Run once in Supabase: SQL Editor > New query > paste this file > Run.
-- (schema.sql and 002_trades_and_rules.sql must already have been run.)
-- =============================================================================

-- Screenshot of the trade on the MT5 chart (entry, SL, TP). mt5_path stays the
-- MT5 trade history screenshot. The TradingView link becomes optional.
alter table public.trade_posts add column chart_path text;
alter table public.trade_posts alter column chart_url drop not null;

-- On: weekdays without high or medium-impact news in the calendar are no-trade days.
alter table public.app_settings add column news_days_only boolean not null default true;
