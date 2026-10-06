-- Scalping mode per market (quick M5/M15 setups every M15 close, small risk); enabled for gold on request
ALTER TABLE ai_symbols ADD COLUMN scalp INTEGER NOT NULL DEFAULT 0;
UPDATE ai_symbols SET scalp = 1 WHERE symbol = 'XAUUSD';
