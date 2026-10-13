ALTER TABLE keno_bets
ADD COLUMN risk TEXT NOT NULL DEFAULT 'medium'
CHECK(risk IN ('easy', 'medium', 'hard', 'extreme'));
