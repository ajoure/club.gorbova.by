CREATE OR REPLACE FUNCTION public.shdf_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- Phase B.0: обязательный note при закрытии manual_review
  -- Только переходы manual_review → exclude и manual_review → keep.
  -- Остальные переходы не затрагиваются.
  IF OLD.decision = 'manual_review'
     AND NEW.decision IN ('exclude', 'keep')
     AND (NEW.note IS NULL OR btrim(NEW.note) = '')
  THEN
    RAISE EXCEPTION 'shdf_guard_update: note is required when closing manual_review (transition % -> %)', OLD.decision, NEW.decision
      USING ERRCODE = 'check_violation';
  END IF;

  -- Audit attribution для editor (note или decision)
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();

  -- Нормализация decision ↔ decided_by/decided_at
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
$function$;