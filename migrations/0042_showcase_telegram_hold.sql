-- GOLD HUNTER GARUDA (phase A):
-- 1. showcase_logins: the public live board (/live, landing, member home, /api/live, Telegram picture) shows ONLY the
--    EA rows whose account login is listed here (comma / space separated). Empty = no account is shown publicly
--    ("akun live sedang disiapkan"). The admin fills it in Admin > Pengaturan > EA Live.
-- 2. telegram_hold: '1' = nothing is sent to Telegram automatically (EA live events / picture reports, content videos).
--    Production starts held; the admin switches it off in Admin > Media Sosial > Telegram.
INSERT OR IGNORE INTO settings (key, value) VALUES ('showcase_logins', '');
INSERT INTO settings (key, value) VALUES ('telegram_hold', '1') ON CONFLICT(key) DO UPDATE SET value='1';
