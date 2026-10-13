ALTER TABLE player_profiles ADD COLUMN profile_public INTEGER NOT NULL DEFAULT 1 CHECK (profile_public IN (0, 1));
ALTER TABLE player_profiles ADD COLUMN show_username INTEGER NOT NULL DEFAULT 1 CHECK (show_username IN (0, 1));
ALTER TABLE player_profiles ADD COLUMN show_rank INTEGER NOT NULL DEFAULT 1 CHECK (show_rank IN (0, 1));
