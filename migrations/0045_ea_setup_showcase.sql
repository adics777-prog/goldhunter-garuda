-- GOLD HUNTER GARUDA live board, per EA instance (account + pair + magic):
-- showcase       1 = this one setup is public even when its account is not in settings.showcase_logins
--                (the owner shows e.g. one TREN MURNI chart of an account and keeps the other charts private)
-- modal_override capital the public % is measured against (e.g. 10000 for "0.01 lot per 10.000"); 0 = the old rule
--                (EA budget input 4.0, else the account capital since the start)
ALTER TABLE ea_setups ADD COLUMN showcase INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ea_setups ADD COLUMN modal_override REAL NOT NULL DEFAULT 0;
