-- Claude manages running positions (move stop / close early): the latest reason is shown with the signal
ALTER TABLE signals ADD COLUMN mgmt_note TEXT NOT NULL DEFAULT '';
