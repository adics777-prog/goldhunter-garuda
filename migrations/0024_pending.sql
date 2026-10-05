-- Pending-order signals: the master places BUY/SELL LIMIT or STOP from Claude's plan; status pending -> open (filled) or cancel
ALTER TABLE signals ADD COLUMN order_type TEXT NOT NULL DEFAULT 'MARKET';
ALTER TABLE signals ADD COLUMN filled_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE signals ADD COLUMN cancel_reason TEXT NOT NULL DEFAULT '';
