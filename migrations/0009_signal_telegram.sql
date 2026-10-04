-- Telegram posts of each BUY/SELL signal ({"<chat_id>": message_id}), so the close result is posted as a reply.
ALTER TABLE signals ADD COLUMN tg_msgs TEXT;
-- Chart screenshots drawn by the MASTER EA (indicators + entry/SL/TP + Claude's analysis): kind 'open' or 'close'.
CREATE TABLE IF NOT EXISTS signal_charts (
  signal_id  INTEGER NOT NULL,
  kind       TEXT    NOT NULL,
  mime       TEXT    NOT NULL DEFAULT 'image/png',
  data       TEXT    NOT NULL,           -- base64
  created_at INTEGER NOT NULL,
  PRIMARY KEY (signal_id, kind)
);
-- Telegram bot settings (token is stored encrypted as telegram_bot_token_enc)
INSERT OR IGNORE INTO settings (key, value) VALUES ('telegram_enabled', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('telegram_targets', '[]');
