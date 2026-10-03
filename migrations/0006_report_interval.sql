-- How often the EA sends its profit report (minutes). The server returns it with every report,
-- so running EAs follow a change without being recompiled.
INSERT OR IGNORE INTO settings (key, value) VALUES ('report_interval_min', '30');
