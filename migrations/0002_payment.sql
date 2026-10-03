-- Payment verification step ("Sudah Bayar") and unique-code lookups
ALTER TABLE orders ADD COLUMN paid_at INTEGER;
CREATE INDEX idx_orders_unique_code ON orders(unique_code, created_at);
