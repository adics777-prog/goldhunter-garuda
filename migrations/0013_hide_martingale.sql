-- GoldHunter martingale EA is on hold (internal testing only): stop selling every EA package.
-- VPS-only packages stay. Re-enable later from Admin > Produk & Harga.
UPDATE products SET active = 0 WHERE includes_ea = 1;
