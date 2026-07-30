-- Temporary private import buffer for the verified Resolution 161 snapshot.
CREATE SCHEMA IF NOT EXISTS asset_classifier_import;
REVOKE ALL ON SCHEMA asset_classifier_import FROM PUBLIC;

CREATE TABLE IF NOT EXISTS asset_classifier_import.resolution_161_nodes (
  ordinal integer PRIMARY KEY CHECK (ordinal BETWEEN 1 AND 2349),
  batch_no smallint NOT NULL CHECK (batch_no BETWEEN 1 AND 12),
  node jsonb NOT NULL,
  source_checksum text NOT NULL
    CHECK (source_checksum = 'ac7e28c93b6b3d1f029cec22593157d1624f9de9c7ffee1a811bd60e743b5f4b'),
  inserted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE asset_classifier_import.resolution_161_nodes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON asset_classifier_import.resolution_161_nodes FROM PUBLIC;

DO $permissions$
BEGIN
  IF to_regrole('sandbox_exec') IS NOT NULL THEN
    EXECUTE 'GRANT USAGE ON SCHEMA asset_classifier_import TO sandbox_exec';
    EXECUTE 'GRANT SELECT, INSERT ON asset_classifier_import.resolution_161_nodes TO sandbox_exec';
    EXECUTE 'DROP POLICY IF EXISTS sandbox_resolution_161_select ON asset_classifier_import.resolution_161_nodes';
    EXECUTE 'DROP POLICY IF EXISTS sandbox_resolution_161_insert ON asset_classifier_import.resolution_161_nodes';
    EXECUTE 'CREATE POLICY sandbox_resolution_161_select ON asset_classifier_import.resolution_161_nodes FOR SELECT TO sandbox_exec USING (source_checksum = ''ac7e28c93b6b3d1f029cec22593157d1624f9de9c7ffee1a811bd60e743b5f4b'')';
    EXECUTE 'CREATE POLICY sandbox_resolution_161_insert ON asset_classifier_import.resolution_161_nodes FOR INSERT TO sandbox_exec WITH CHECK (source_checksum = ''ac7e28c93b6b3d1f029cec22593157d1624f9de9c7ffee1a811bd60e743b5f4b'')';
  END IF;
END
$permissions$;
