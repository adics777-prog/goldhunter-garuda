-- English versions of Claude's reason and fundamental (website in two languages)
ALTER TABLE signals ADD COLUMN reason_en TEXT NOT NULL DEFAULT '';
ALTER TABLE signals ADD COLUMN news_en TEXT NOT NULL DEFAULT '';
