-- A.3 §4 / F4a-F4b: расширение CHECK для finding_id
-- old regex: ^F[1-9][0-9]*$
-- new regex: ^F[1-9][0-9]*[a-z]?$
-- scope: только два констрейнта, никаких других изменений.

ALTER TABLE public.system_health_discovery_snapshots
  DROP CONSTRAINT IF EXISTS system_health_snapshots_finding_id_chk;

ALTER TABLE public.system_health_discovery_snapshots
  ADD CONSTRAINT system_health_snapshots_finding_id_chk
  CHECK (finding_id ~ '^F[1-9][0-9]*[a-z]?$');

ALTER TABLE public.system_health_discovery_findings
  DROP CONSTRAINT IF EXISTS shdf_finding_id_chk;

ALTER TABLE public.system_health_discovery_findings
  ADD CONSTRAINT shdf_finding_id_chk
  CHECK (finding_id ~ '^F[1-9][0-9]*[a-z]?$');