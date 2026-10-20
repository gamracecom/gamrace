INSERT OR IGNORE INTO site_settings(setting_key, value_text, updated_at, updated_by)
VALUES('chat_cooldown_ms', '1500', 0, 'system');

INSERT OR IGNORE INTO site_settings(setting_key, value_text, updated_at, updated_by)
VALUES('chat_max_characters', '240', 0, 'system');

INSERT OR IGNORE INTO site_settings(setting_key, value_text, updated_at, updated_by)
VALUES('global_announcement', '{"text":"","enabled":false,"startsAt":0,"endsAt":0}', 0, 'system');
