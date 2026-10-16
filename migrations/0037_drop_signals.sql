-- The website focuses on ONE EA, GOLD HUNTER GARUDA: the archived Garuda AI signal service is removed completely.
-- Signal tables (their indexes idx_signals_symbol_id / idx_signals_trades go with them), AI master settings,
-- the Garuda AI EA files and the signal-only promo video jobs. The content system keeps working (educational videos).
DROP TABLE IF EXISTS signal_charts;
DROP TABLE IF EXISTS signals;
DROP TABLE IF EXISTS ai_research;
DROP TABLE IF EXISTS ai_symbols;

-- AI master settings (ai_model, ai_claude_key_enc, ai_master_seen, ai_research_symbol, ...); '_' escaped so LIKE is literal
DELETE FROM settings WHERE key LIKE 'ai\_%' ESCAPE '\';
DELETE FROM settings WHERE key LIKE 'tg\_wait\_last\_%' ESCAPE '\';
DELETE FROM settings WHERE key IN ('telegram_wait', 'telegram_wait_hours', 'signals_public', 'web_wait_chart',
  'garuda_ai_ea', 'garuda_ai_master_ea', 'ai_master_seen', 'ai_master_info', 'ai_research_symbol',
  'content_on_signal', 'content_weekly', 'content_ai');

-- Garuda AI EA files (CLIENT / MASTER .ex5 uploaded by the builder)
DELETE FROM files WHERE kind IN ('garuda_ai', 'garuda_ai_master');

-- Promo video jobs built from signal data: one video per closed signal and the weekly signal recap
DELETE FROM content_jobs WHERE kind IN ('signal', 'weekly');
