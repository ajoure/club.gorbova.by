-- =====================================================================
-- A.0 v3.2 PATCH
-- Fix: shdfh_block_direct_insert had wrong pg_trigger_depth() condition.
-- Add: session marker for stricter guard.
-- Add: explicit policy COMMENT on system_health_discovery_snapshots.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Fixed history INSERT guard (depth >= 2 + session marker)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shdfh_block_direct_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_marker text;
BEGIN
  -- Layer 1: глубина вложенности должна быть >= 2.
  -- Этот триггер сам = уровень 1. Если depth=1, значит INSERT пришёл
  -- напрямую от клиента/service_role/SQL, а не из родительского триггера.
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION
      'system_health_discovery_findings_history: direct INSERT forbidden (depth=%). Writes only via shdf_write_history trigger.',
      pg_trigger_depth();
  END IF;

  -- Layer 2: session-local маркер, который ставит ТОЛЬКО shdf_write_history.
  -- Защищает от теоретического случая «другой триггер случайно делает INSERT в history».
  BEGIN
    v_marker := current_setting('app.shdfh_internal_write', true);
  EXCEPTION WHEN OTHERS THEN
    v_marker := NULL;
  END;

  IF v_marker IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION
      'system_health_discovery_findings_history: missing internal-write marker. Writes only via shdf_write_history trigger.';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.shdfh_block_direct_insert() IS
$cmt$
A.0 v3.2: dual-layer guard for history INSERT.

Layer 1 — pg_trigger_depth() check:
  This trigger itself runs at depth >= 1. A direct INSERT (from client,
  service_role, or raw SQL) lands here at depth=1. A nested INSERT from
  another trigger (e.g. shdf_write_history on findings) lands at depth>=2.
  Condition `depth < 2` therefore catches all direct inserts.

Layer 2 — session marker `app.shdfh_internal_write`:
  Only shdf_write_history sets this marker via set_config(...,'on',true).
  This blocks the theoretical case where some unrelated future trigger
  inserts into history at depth>=2 without authorization.

Both layers must pass.
$cmt$;

-- ---------------------------------------------------------------------
-- 2. shdf_write_history — add session marker before INSERT
-- ---------------------------------------------------------------------
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

  -- Set session-local marker so shdfh_block_direct_insert allows this INSERT.
  -- `is_local=true` → marker live only до конца текущей транзакции.
  PERFORM set_config('app.shdfh_internal_write', 'on', true);

  BEGIN
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
  EXCEPTION WHEN OTHERS THEN
    -- Снимаем маркер даже при ошибке, чтобы не оставлять "разрешение" в сессии
    PERFORM set_config('app.shdfh_internal_write', 'off', true);
    RAISE;
  END;

  -- Очищаем маркер сразу после успешного INSERT
  PERFORM set_config('app.shdfh_internal_write', 'off', true);

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 3. Snapshots — explicit policy COMMENT (v3.2)
-- ---------------------------------------------------------------------
COMMENT ON TABLE public.system_health_discovery_snapshots IS
$cmt$
Evidence-layer master record. INSERT-ONLY (UPDATE/DELETE blocked by triggers).

A.0 v3.2 write policy (locked) — DELIBERATE EXCEPTION from findings policy:
  - INSERT allowed via TWO paths:
      (a) service_role from edge function `system-health-discovery-snapshot`
          (system-driven discovery, cron, automated audit);
      (b) super_admin user-context from admin UI (manual discovery).
  - UPDATE/DELETE forbidden for ALL roles incl. service_role (triggers shds_10_*).
  - taken_by may be NULL for system-path (service_role) or uuid for UI-path.

Rationale: snapshots are technical capture-points without human "decision".
Unlike findings.decision (which requires super_admin attribution for audit),
snapshots are append-only timestamps of discovery runs and may be system-generated.

Not read by runtime/nightly/invariant code (evidence-only).
$cmt$;