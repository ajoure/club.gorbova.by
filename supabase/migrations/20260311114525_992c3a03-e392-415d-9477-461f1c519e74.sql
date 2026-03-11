-- Make public_id have a default so generated types mark it optional in Insert
-- The trigger overrides this, but the default satisfies the type generator
ALTER TABLE tariffs ALTER COLUMN public_id SET DEFAULT '';