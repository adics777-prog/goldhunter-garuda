-- One-sentence fundamental summary (news, dollar, yields) that Claude adds to each signal.
ALTER TABLE signals ADD COLUMN news TEXT NOT NULL DEFAULT '';
