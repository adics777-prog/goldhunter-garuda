-- Web cursor of a setup's deal history (EA v3.29+ sends deal_from): the time up to which the stored deals are complete,
-- -1 = not started (the EA is asked to send from the record start). Reset whenever the start of the record changes.
ALTER TABLE ea_setups ADD COLUMN deal_cur INTEGER NOT NULL DEFAULT -1;
