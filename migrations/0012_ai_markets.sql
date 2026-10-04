-- Garuda AI analyses several markets. One MASTER EA per market (chart); settings per market are edited in
-- Admin > Garuda AI. min_sl / max_sl are in pips of that market (gold 1 pip = 0.10, EURUSD 0.0001, USDJPY 0.01, BTC 1.00).
CREATE TABLE IF NOT EXISTS ai_symbols (
  symbol        TEXT PRIMARY KEY,               -- canonical name without broker suffix: XAUUSD, BTCUSD, EURUSD, USDJPY
  enabled       INTEGER NOT NULL DEFAULT 1,
  pip           REAL    NOT NULL,
  digits        INTEGER NOT NULL,
  pip_label     TEXT    NOT NULL DEFAULT 'pips',
  session_start INTEGER NOT NULL DEFAULT 7,
  session_end   INTEGER NOT NULL DEFAULT 20,
  weekend       INTEGER NOT NULL DEFAULT 0,
  min_sl        REAL    NOT NULL,
  max_sl        REAL    NOT NULL,
  sort          INTEGER NOT NULL DEFAULT 0,
  master_seen   INTEGER,
  master_info   TEXT,
  profile       TEXT    NOT NULL DEFAULT ''   -- character of the market, written into Claude's prompt (editable in Admin)
);
INSERT OR IGNORE INTO ai_symbols (symbol, enabled, pip, digits, pip_label, session_start, session_end, weekend, min_sl, max_sl, sort) VALUES
  ('XAUUSD', 1, 0.1,    2, 'pips', 7, 20, 0, 30,  200,  1),
  ('BTCUSD', 1, 1.0,    2, 'poin', 0, 24, 1, 150, 2000, 2),
  ('EURUSD', 1, 0.0001, 5, 'pips', 7, 20, 0, 8,   40,   3),
  ('USDJPY', 1, 0.01,   3, 'pips', 7, 20, 0, 10,  50,   4);
-- news research is done once per hour by one master and shared with the others
CREATE TABLE IF NOT EXISTS ai_research (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  symbol     TEXT    NOT NULL DEFAULT '',
  text       TEXT    NOT NULL,
  cost_usd   REAL    NOT NULL DEFAULT 0
);
UPDATE ai_symbols SET profile = 'Emas sangat sensitif pada dolar AS dan yield riil AS: dolar atau yield naik biasanya menekan emas, dan sebaliknya. Saat geopolitik memanas emas menjadi safe haven. Pergerakan terbesar ada di sesi London (07-11 server) dan pembukaan New York (12-16 server), terutama saat rilis data AS (NFP, CPI, PCE, FOMC) yang bisa memicu lonjakan 20-40 dolar dalam hitungan menit. Sesi Asia cenderung sempit dan range-nya sering disapu (liquidity sweep) di awal London sebelum harga bergerak ke arah sebenarnya. Emas suka menyapu high/low sesi Asia, high/low kemarin, dan angka bulat (kelipatan 10 dan 50 dolar) lalu berbalik. Pullback dalam tren kuat sering hanya ke EMA20 H1. Hindari entry menjelang rilis berdampak tinggi; SL di luar noise ATR M15.' WHERE symbol = 'XAUUSD' AND profile = '';
UPDATE ai_symbols SET profile = 'Bitcoin diperdagangkan 24 jam 7 hari dan sangat volatil: gerak 2-5 persen sehari itu biasa. Likuiditas akhir pekan tipis sehingga rawan spike dan false breakout. Pergerakan besar sering terjadi saat sesi AS dibuka (sekitar 13-16 server) dan ketika saham teknologi AS bergerak tajam; BTC berkorelasi dengan Nasdaq dan sentimen risk-on/risk-off, serta melemah ketika dolar dan yield AS melonjak. Angka bulat (kelipatan 1.000 dan 5.000 dolar) serta high/low mingguan menjadi magnet likuiditas; sering terjadi likuidasi berantai (long/short squeeze) yang menembus level lalu berbalik cepat. Berita ETF, regulasi, dan data inflasi AS menggerakkan harga. SL harus lebih lebar mengikuti ATR; jangan mengejar candle besar, tunggu retest.' WHERE symbol = 'BTCUSD' AND profile = '';
UPDATE ai_symbols SET profile = 'Pasangan paling likuid di dunia, spread rendah, dan relatif menghormati level teknikal (support/resistance, trendline, EMA). Digerakkan oleh selisih kebijakan The Fed dan ECB serta data AS dan zona euro. Sesi Asia sempit; gerak utama di London (07-11 server) dan overlap London-New York (12-16 server). Sering terjadi false breakout di awal London yang kemudian berbalik. Range harian rata-rata relatif kecil (sekitar 50-80 pips), jadi target intraday yang realistis 20-40 pips dan SL yang wajar 10-20 pips. Rilis CPI/NFP AS serta keputusan ECB/Fed memicu lonjakan; hindari entry tepat sebelum rilis tersebut.' WHERE symbol = 'EURUSD' AND profile = '';
UPDATE ai_symbols SET profile = 'Sangat dipengaruhi selisih yield obligasi AS (10 tahun) dan Jepang: yield AS naik membuat USDJPY cenderung naik. Cenderung membentuk tren panjang yang rapi dan menghormati EMA. Sesi Tokyo (00-06 server) juga aktif untuk pasangan ini. Ada risiko intervensi Bank of Japan / Kementerian Keuangan Jepang ketika yen melemah tajam, yang bisa memicu turun 200-500 pips tiba-tiba, terutama di dekat level psikologis (misalnya 150.00 atau 160.00). Saat risk-off, yen menguat (USDJPY turun). Rilis data AS, pernyataan BoJ, dan pergerakan yield AS sangat penting; angka bulat (kelipatan 50 dan 100 pips) sering menjadi support/resistance.' WHERE symbol = 'USDJPY' AND profile = '';
INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_research_symbol', 'XAUUSD');
UPDATE signals SET symbol = 'XAUUSD' WHERE symbol LIKE 'XAUUSD%';
