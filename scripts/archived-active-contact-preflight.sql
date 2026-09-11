-- READ ONLY. Run only through the canonical Lovable Cloud audit.
-- Returns UUIDs and flags; raw contact fields stay inside the CTE.
-- A match is not an instruction to merge: inspect all dependency collisions first.
WITH normalized AS MATERIALIZED (
  SELECT id, user_id, is_archived, status, merged_to_profile_id, telegram_user_id,
    nullif(lower(btrim(email)), '') AS email_key,
    CASE WHEN length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) >= 7
      THEN regexp_replace(phone, '[^0-9]', '', 'g') END AS phone_key
  FROM public.profiles
), archived AS (
  SELECT * FROM normalized WHERE is_archived IS TRUE OR status::text = 'archived'
), active AS (
  SELECT * FROM normalized
  WHERE is_archived IS NOT TRUE AND status::text IS DISTINCT FROM 'archived'
    AND merged_to_profile_id IS NULL
), matches AS (
  SELECT a.id AS archived_id, m.id AS master_id, true AS by_email, false AS by_phone
  FROM archived a JOIN active m ON m.email_key = a.email_key
  WHERE a.email_key IS NOT NULL
  UNION ALL
  SELECT a.id, m.id, false, true
  FROM archived a JOIN active m ON m.phone_key = a.phone_key
  WHERE a.phone_key IS NOT NULL
), pairs AS (
  SELECT archived_id, master_id, bool_or(by_email) AS matched_email,
    bool_or(by_phone) AS matched_phone
  FROM matches GROUP BY archived_id, master_id
), classified AS (
  SELECT p.*, count(*) OVER (PARTITION BY p.archived_id) AS active_candidates,
    a.user_id AS archived_user_id, m.user_id AS master_user_id,
    a.merged_to_profile_id,
    a.telegram_user_id IS NOT NULL AND m.telegram_user_id IS NOT NULL
      AND a.telegram_user_id <> m.telegram_user_id AS telegram_conflict,
    a.user_id IS NOT NULL AND a.user_id IS DISTINCT FROM m.user_id AS needs_auth_transfer
  FROM pairs p JOIN normalized a ON a.id = p.archived_id JOIN normalized m ON m.id = p.master_id
)
SELECT jsonb_build_object(
  'audited_at', transaction_timestamp(),
  'scope', 'archived-to-active-only',
  'profiles_total', (SELECT count(*) FROM normalized),
  'pairs', coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.master_id, c.archived_id), '[]'::jsonb)
) AS preflight
FROM classified c;

-- Discover declared ownership dependencies before any write. Catalog output only.
SELECT ns.nspname AS schema_name, rel.relname AS table_name, att.attname AS column_name,
  target_ns.nspname AS referenced_schema, target.relname AS referenced_table,
  con.conname AS constraint_name, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace ns ON ns.oid = rel.relnamespace
JOIN pg_class target ON target.oid = con.confrelid
JOIN pg_namespace target_ns ON target_ns.oid = target.relnamespace
JOIN LATERAL unnest(con.conkey) AS key(attnum) ON true
JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = key.attnum
WHERE con.contype = 'f' AND ns.nspname = 'public'
  AND (con.confrelid = 'public.profiles'::regclass OR con.confrelid = 'auth.users'::regclass)
ORDER BY schema_name, table_name, column_name;

-- Modern ownership tables may lack declared FKs (for example entitlement_sources).
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND column_name IN ('profile_id', 'user_id')
ORDER BY table_name, column_name;
