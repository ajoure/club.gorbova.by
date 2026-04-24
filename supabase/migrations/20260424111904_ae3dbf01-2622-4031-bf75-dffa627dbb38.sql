-- =====================================================================
-- A.0 v3.1 — Evidence layer for System Health discovery findings
-- Pure schema, no runtime dependency, not used by nightly/invariant code.
-- All three tables are append-only with strictly defined mutability.
-- Writes to findings restricted to super_admin user-context (JWT role=authenticated
-- + has_role_v2 super_admin + sub matches auth.uid()).
-- Service_role and direct SQL without JWT are blocked at DB level.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1.1 Snapshot master-record table (insert-only)
-- ---------------------------------------------------------------------
CREATE TABLE public.system_health_discovery_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id      text NOT NULL,
  taken_at        timestamptz NOT NULL DEFAULT now(),
  taken_by        uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  source_query    text NOT NULL,
  total_rows      integer NOT NULL CHECK (total_rows >= 0),
  note            text NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT system_health_snapshots_finding_id_chk
    CHECK (finding_id ~ '^F[1-9][0-9]*$')
);

CREATE INDEX idx_shds_finding_id_taken_at
  ON public.system_health_discovery_snapshots (finding_id, taken_at DESC);

ALTER TABLE public.system_health_discovery_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "snapshots_select_super_admin"
  ON public.system_health_discovery_snapshots
  FOR SELECT TO authenticated
  USING (public.has_role_v2(auth.uid(), 'super_admin'));

COMMENT ON TABLE public.system_health_discovery_snapshots IS
  'Evidence-layer master record. INSERT-ONLY. Not read by runtime/nightly/invariant code.';

-- ---------------------------------------------------------------------
-- 1.2 Main evidence table (insert + restricted update)
-- ---------------------------------------------------------------------
CREATE TABLE public.system_health_discovery_findings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id        text NOT NULL,
  snapshot_id       uuid NOT NULL REFERENCES public.system_health_discovery_snapshots(id) ON DELETE RESTRICT,
  field             text NOT NULL,
  value             text NOT NULL,
  match_count       integer NOT NULL CHECK (match_count >= 0),
  total_in_finding  integer NOT NULL CHECK (total_in_finding >= 0),
  coverage_pct      numeric(6,3) GENERATED ALWAYS AS (
                      CASE WHEN total_in_finding = 0 THEN 0
                           ELSE round((match_count::numeric / total_in_finding::numeric) * 100, 3)
                      END
                    ) STORED,
  decision          text NOT NULL DEFAULT 'proposed'
                      CHECK (decision IN ('exclude','keep','manual_review','proposed')),
  decided_by        uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at        timestamptz NULL,
  evidence_query    text NOT NULL,
  note              text NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,

  CONSTRAINT shdf_finding_id_chk CHECK (finding_id ~ '^F[1-9][0-9]*$'),
  CONSTRAINT shdf_decided_consistency_chk CHECK (
    (decision =  'proposed' AND decided_at IS NULL     AND decided_by IS NULL)
    OR
    (decision <> 'proposed' AND decided_at IS NOT NULL AND decided_by IS NOT NULL)
  ),
  CONSTRAINT shdf_unique_per_snapshot UNIQUE (snapshot_id, field, value)
);

CREATE INDEX idx_shdf_finding_decision ON public.system_health_discovery_findings (finding_id, decision);
CREATE INDEX idx_shdf_snapshot          ON public.system_health_discovery_findings (snapshot_id);
CREATE INDEX idx_shdf_field_value       ON public.system_health_discovery_findings (field, value);

ALTER TABLE public.system_health_discovery_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "findings_select_super_admin"
  ON public.system_health_discovery_findings
  FOR SELECT TO authenticated
  USING (public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY "findings_insert_super_admin"
  ON public.system_health_discovery_findings
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY "findings_update_super_admin"
  ON public.system_health_discovery_findings
  FOR UPDATE TO authenticated
  USING (public.has_role_v2(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role_v2(auth.uid(), 'super_admin'));

COMMENT ON TABLE public.system_health_discovery_findings IS
  'Evidence-layer rows. INSERT + restricted UPDATE (decision/decided_by/decided_at/note only). DELETE forbidden. Not read by runtime/nightly/invariant code.';

COMMENT ON COLUMN public.system_health_discovery_findings.decision IS
  'EVIDENCE ONLY. Do NOT read from nightly/invariant/edge runtime. Use versioned exclusion artifact (supabase/exclusions/*.yaml) instead.';

-- ---------------------------------------------------------------------
-- 1.3 History table (append-only audit, with FK)
-- ---------------------------------------------------------------------
CREATE TABLE public.system_health_discovery_findings_history (
  history_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_row_id    uuid NOT NULL REFERENCES public.system_health_discovery_findings(id) ON DELETE RESTRICT,
  finding_id        text NOT NULL,
  snapshot_id       uuid NOT NULL REFERENCES public.system_health_discovery_snapshots(id) ON DELETE RESTRICT,
  field             text NOT NULL,
  value             text NOT NULL,
  match_count       integer NOT NULL,
  total_in_finding  integer NOT NULL,
  decision          text NOT NULL,
  decided_by        uuid NULL,
  decided_at        timestamptz NULL,
  evidence_query    text NOT NULL,
  note              text NULL,
  op                text NOT NULL CHECK (op IN ('INSERT','UPDATE')),
  changed_fields    text[] NULL,
  changed_at        timestamptz NOT NULL DEFAULT now(),
  changed_by        uuid NULL,
  row_snapshot      jsonb NOT NULL
);

CREATE INDEX idx_shdfh_finding_row ON public.system_health_discovery_findings_history (finding_row_id, changed_at DESC);
CREATE INDEX idx_shdfh_finding_id  ON public.system_health_discovery_findings_history (finding_id, changed_at DESC);

ALTER TABLE public.system_health_discovery_findings_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "findings_history_select_super_admin"
  ON public.system_health_discovery_findings_history
  FOR SELECT TO authenticated
  USING (public.has_role_v2(auth.uid(), 'super_admin'));

COMMENT ON TABLE public.system_health_discovery_findings_history IS
  'Append-only audit. Direct INSERT/UPDATE/DELETE forbidden for ALL roles incl. service_role. Writes only via SECURITY DEFINER trigger from system_health_discovery_findings.';

-- ---------------------------------------------------------------------
-- 1.4 Triggers (named with _10_/_20_/_90_ for guaranteed lexicographic order)
-- ---------------------------------------------------------------------

-- 1.4.a — Hard guard: только super_admin user-context может писать в findings
CREATE OR REPLACE FUNCTION public.shdf_enforce_super_admin_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claims      jsonb;
  v_jwt_role    text;
  v_jwt_sub     text;
  v_uid         uuid := auth.uid();
BEGIN
  -- v3 policy: trusted server writes без user JWT запрещены by design.
  -- Любое изменение этой политики требует отдельного reviewed patch.

  BEGIN
    v_claims := current_setting('request.jwt.claims', true)::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_claims := NULL;
  END;

  -- v3 policy: нет JWT (прямой SQL / cron / миграция) → запрет
  IF v_claims IS NULL THEN
    RAISE EXCEPTION
      'shdf_enforce_super_admin_context: direct SQL writes forbidden (no JWT context). Use admin UI / edge endpoint as super_admin.';
  END IF;

  v_jwt_role := v_claims ->> 'role';
  v_jwt_sub  := v_claims ->> 'sub';

  -- v3 policy: service_role запрещён by design
  IF v_jwt_role = 'service_role' THEN
    RAISE EXCEPTION
      'shdf_enforce_super_admin_context: service_role writes forbidden on system_health_discovery_findings. Use super_admin user-context only.';
  END IF;

  -- v3 policy: только authenticated user-context
  IF v_jwt_role IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION
      'shdf_enforce_super_admin_context: only authenticated user-context allowed (got role=%).', COALESCE(v_jwt_role,'<null>');
  END IF;

  -- v3.1 policy: claims должны быть похожи на real user-context
  IF v_jwt_sub IS NULL THEN
    RAISE EXCEPTION
      'shdf_enforce_super_admin_context: JWT claims missing sub — not a real user context';
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'shdf_enforce_super_admin_context: auth.uid() is NULL';
  END IF;

  IF v_jwt_sub <> v_uid::text THEN
    RAISE EXCEPTION
      'shdf_enforce_super_admin_context: JWT sub (%) does not match auth.uid() (%)', v_jwt_sub, v_uid;
  END IF;

  IF NOT public.has_role_v2(v_uid, 'super_admin') THEN
    RAISE EXCEPTION 'shdf_enforce_super_admin_context: caller is not super_admin (uid=%)', v_uid;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.shdf_enforce_super_admin_context() IS
$cmt$
A.0 v3 policy (locked):
  - Writes to system_health_discovery_findings allowed ONLY from super_admin user-context.
  - Trusted server writes WITHOUT user JWT are FORBIDDEN by design.
  - service_role writes are FORBIDDEN by design.
  - Direct SQL without JWT is FORBIDDEN by design.

Any change to this policy (e.g. adding a trusted server-side endpoint that writes
on behalf of the system without a user JWT) requires a separate, reviewed patch
that explicitly amends this contract — not a silent bypass inside this function.
$cmt$;

CREATE TRIGGER trg_shdf_10_enforce_super_admin_insert
  BEFORE INSERT ON public.system_health_discovery_findings
  FOR EACH ROW EXECUTE FUNCTION public.shdf_enforce_super_admin_context();

CREATE TRIGGER trg_shdf_10_enforce_super_admin_update
  BEFORE UPDATE ON public.system_health_discovery_findings
  FOR EACH ROW EXECUTE FUNCTION public.shdf_enforce_super_admin_context();

-- 1.4.b — INSERT normalizer (audit-fields + decision consistency)
CREATE OR REPLACE FUNCTION public.shdf_normalize_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- Жёстко перезаписываем audit-поля (клиентские значения игнорируются)
  NEW.created_at := now();
  NEW.updated_at := now();
  NEW.created_by := v_uid;
  NEW.updated_by := v_uid;

  -- Нормализация decision ↔ decided_by/decided_at
  IF NEW.decision = 'proposed' THEN
    NEW.decided_by := NULL;
    NEW.decided_at := NULL;
  ELSE
    NEW.decided_by := v_uid;
    NEW.decided_at := now();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_shdf_20_normalize_insert
  BEFORE INSERT ON public.system_health_discovery_findings
  FOR EACH ROW EXECUTE FUNCTION public.shdf_normalize_insert();

-- 1.4.c — UPDATE guard (immutable fields + audit-attribution + decision normalization)
CREATE OR REPLACE FUNCTION public.shdf_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Immutable fields
  IF NEW.id               IS DISTINCT FROM OLD.id
     OR NEW.finding_id    IS DISTINCT FROM OLD.finding_id
     OR NEW.snapshot_id   IS DISTINCT FROM OLD.snapshot_id
     OR NEW.field         IS DISTINCT FROM OLD.field
     OR NEW.value         IS DISTINCT FROM OLD.value
     OR NEW.match_count   IS DISTINCT FROM OLD.match_count
     OR NEW.total_in_finding IS DISTINCT FROM OLD.total_in_finding
     OR NEW.evidence_query IS DISTINCT FROM OLD.evidence_query
     OR NEW.created_at    IS DISTINCT FROM OLD.created_at
     OR NEW.created_by    IS DISTINCT FROM OLD.created_by
  THEN
    RAISE EXCEPTION 'shdf_guard_update: only decision/decided_by/decided_at/note are mutable';
  END IF;

  -- Audit attribution для editor (note или decision)
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();

  -- Нормализация decision ↔ decided_by/decided_at
  -- Контракт:
  --   note без смены decision → decided_by/decided_at = OLD (не переписываются)
  --   смена decision → decided_by/decided_at переписываются на текущего actor/time
  --   попытка подменить decided_by без смены decision → откат к OLD
  IF NEW.decision IS DISTINCT FROM OLD.decision THEN
    IF NEW.decision = 'proposed' THEN
      NEW.decided_by := NULL;
      NEW.decided_at := NULL;
    ELSE
      NEW.decided_by := auth.uid();
      NEW.decided_at := now();
    END IF;
  ELSE
    NEW.decided_by := OLD.decided_by;
    NEW.decided_at := OLD.decided_at;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_shdf_20_guard_update
  BEFORE UPDATE ON public.system_health_discovery_findings
  FOR EACH ROW EXECUTE FUNCTION public.shdf_guard_update();

-- 1.4.d — DELETE guard для findings
CREATE OR REPLACE FUNCTION public.shdf_guard_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'shdf_guard_delete: DELETE is forbidden on system_health_discovery_findings';
END;
$$;

CREATE TRIGGER trg_shdf_10_guard_delete
  BEFORE DELETE ON public.system_health_discovery_findings
  FOR EACH ROW EXECUTE FUNCTION public.shdf_guard_delete();

-- 1.4.e — History writer (AFTER, runs last)
CREATE OR REPLACE FUNCTION public.shdf_write_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op text := TG_OP;
  v_changed text[] := NULL;
BEGIN
  IF v_op = 'UPDATE' THEN
    v_changed := ARRAY(
      SELECT k FROM (VALUES
        ('decision',    NEW.decision    IS DISTINCT FROM OLD.decision),
        ('decided_by',  NEW.decided_by  IS DISTINCT FROM OLD.decided_by),
        ('decided_at',  NEW.decided_at  IS DISTINCT FROM OLD.decided_at),
        ('note',        NEW.note        IS DISTINCT FROM OLD.note)
      ) AS t(k, ch) WHERE ch
    );
    IF v_changed IS NULL OR array_length(v_changed,1) IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.system_health_discovery_findings_history (
    finding_row_id, finding_id, snapshot_id, field, value,
    match_count, total_in_finding, decision, decided_by, decided_at,
    evidence_query, note, op, changed_fields, changed_by, row_snapshot
  ) VALUES (
    NEW.id, NEW.finding_id, NEW.snapshot_id, NEW.field, NEW.value,
    NEW.match_count, NEW.total_in_finding, NEW.decision, NEW.decided_by, NEW.decided_at,
    NEW.evidence_query, NEW.note, v_op, v_changed,
    auth.uid(),
    to_jsonb(NEW)
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_shdf_90_write_history
  AFTER INSERT OR UPDATE ON public.system_health_discovery_findings
  FOR EACH ROW EXECUTE FUNCTION public.shdf_write_history();

-- 1.4.f — History append-only guards (UPDATE/DELETE forbidden for ALL roles)
CREATE OR REPLACE FUNCTION public.shdfh_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'system_health_discovery_findings_history is append-only (UPDATE/DELETE forbidden)';
END;
$$;

CREATE TRIGGER trg_shdfh_10_no_update
  BEFORE UPDATE ON public.system_health_discovery_findings_history
  FOR EACH ROW EXECUTE FUNCTION public.shdfh_block_mutation();

CREATE TRIGGER trg_shdfh_10_no_delete
  BEFORE DELETE ON public.system_health_discovery_findings_history
  FOR EACH ROW EXECUTE FUNCTION public.shdfh_block_mutation();

-- 1.4.g — History direct-INSERT guard (только из триггера shdf_write_history)
CREATE OR REPLACE FUNCTION public.shdfh_block_direct_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() < 1 THEN
    RAISE EXCEPTION
      'system_health_discovery_findings_history accepts INSERT only via trigger shdf_write_history (direct INSERT forbidden, even for service_role)';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_shdfh_10_no_direct_insert
  BEFORE INSERT ON public.system_health_discovery_findings_history
  FOR EACH ROW EXECUTE FUNCTION public.shdfh_block_direct_insert();

-- 1.4.h — snapshots append-only (UPDATE/DELETE forbidden for ALL roles)
CREATE OR REPLACE FUNCTION public.shds_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'system_health_discovery_snapshots is insert-only (UPDATE/DELETE forbidden, even for service_role)';
END;
$$;

CREATE TRIGGER trg_shds_10_no_update
  BEFORE UPDATE ON public.system_health_discovery_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.shds_block_mutation();

CREATE TRIGGER trg_shds_10_no_delete
  BEFORE DELETE ON public.system_health_discovery_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.shds_block_mutation();

-- ---------------------------------------------------------------------
-- 1.5 GRANT/REVOKE
-- ---------------------------------------------------------------------
REVOKE ALL ON public.system_health_discovery_snapshots         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.system_health_discovery_findings          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.system_health_discovery_findings_history  FROM PUBLIC, anon, authenticated;

GRANT SELECT                  ON public.system_health_discovery_snapshots         TO authenticated;
GRANT SELECT, INSERT, UPDATE  ON public.system_health_discovery_findings          TO authenticated;
GRANT SELECT                  ON public.system_health_discovery_findings_history  TO authenticated;