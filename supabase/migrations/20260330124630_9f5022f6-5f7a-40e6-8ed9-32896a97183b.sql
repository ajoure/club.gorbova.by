INSERT INTO app_settings (key, value, created_at, updated_at)
VALUES ('phase1_ledger_schema_ready_at', to_jsonb(now()::text), now(), now())
ON CONFLICT (key) DO UPDATE SET value = to_jsonb(now()::text), updated_at = now();