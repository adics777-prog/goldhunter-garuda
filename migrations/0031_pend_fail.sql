-- Why the AI's pending plan of this analysis was not placed (shown on the live card, also sent to Telegram)
ALTER TABLE signals ADD COLUMN pend_fail TEXT NOT NULL DEFAULT '';
