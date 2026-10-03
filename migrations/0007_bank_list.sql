-- Structured payment accounts (any number): [{"bank":"BCA","number":"123","name":"Nama","active":true}]
-- The old free-text sample account ("BCA 1234567890 a.n. NAMA ANDA") is no longer shown to members.
INSERT OR IGNORE INTO settings (key, value) VALUES ('bank_list', '[]');
