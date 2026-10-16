-- Start date of an EA on the live board: by default the EA's first own deal (sent as own_start_utc);
-- since_manual = 1 once the admin sets the date by hand, then the EA no longer moves it.
ALTER TABLE ea_setups ADD COLUMN since_manual INTEGER NOT NULL DEFAULT 0;
