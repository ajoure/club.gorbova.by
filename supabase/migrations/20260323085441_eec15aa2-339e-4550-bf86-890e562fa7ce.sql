
-- PATCH 7.3 FIX: Cleanup duplicate positions by normalized label
DO $$
DECLARE
  rec RECORD;
  canonical_id UUID;
  dup_id UUID;
  rebound_count INT := 0;
BEGIN
  FOR rec IN
    SELECT
      lower(trim(regexp_replace(label, '\s+', ' ', 'g'))) AS norm_label,
      array_agg(id ORDER BY
        (CASE WHEN is_active THEN 0 ELSE 1 END),
        (CASE WHEN code = replace(lower(trim(regexp_replace(label, '\s+', ' ', 'g'))), ' ', '_') THEN 0 ELSE 1 END),
        id
      ) AS ids
    FROM legal_details_positions_catalog
    GROUP BY lower(trim(regexp_replace(label, '\s+', ' ', 'g')))
    HAVING count(*) > 1
  LOOP
    canonical_id := rec.ids[1];
    FOR i IN 2..array_length(rec.ids, 1) LOOP
      dup_id := rec.ids[i];

      UPDATE legal_details_entity_person_links
        SET position_catalog_id = canonical_id
        WHERE position_catalog_id = dup_id;
      GET DIAGNOSTICS rebound_count = ROW_COUNT;

      DELETE FROM legal_details_positions_catalog WHERE id = dup_id;

      INSERT INTO audit_logs (action, actor_type, actor_label, meta)
      VALUES (
        'position_catalog_dedup',
        'system',
        'migration',
        jsonb_build_object(
          'norm_label', rec.norm_label,
          'canonical_id', canonical_id,
          'deleted_id', dup_id,
          'links_rebound', rebound_count
        )
      );
    END LOOP;
  END LOOP;
END $$;

-- Unique index on normalized label to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_catalog_norm_label
  ON legal_details_positions_catalog (lower(trim(regexp_replace(label, '\s+', ' ', 'g'))))
  WHERE is_active = true;
