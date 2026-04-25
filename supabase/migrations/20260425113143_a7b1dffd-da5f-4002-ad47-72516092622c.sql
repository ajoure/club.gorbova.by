-- 1. Add approval columns
ALTER TABLE public.broadcast_templates
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending_approval',
  ADD COLUMN IF NOT EXISTS approved_by UUID,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_reason TEXT;

ALTER TABLE public.broadcast_templates
  DROP CONSTRAINT IF EXISTS broadcast_templates_approval_status_check;
ALTER TABLE public.broadcast_templates
  ADD CONSTRAINT broadcast_templates_approval_status_check
  CHECK (approval_status IN ('pending_approval','approved','rejected'));

CREATE INDEX IF NOT EXISTS idx_broadcast_templates_approval_status
  ON public.broadcast_templates(approval_status);

-- 2. Backfill historical sent templates → approved
UPDATE public.broadcast_templates
SET
  approval_status = 'approved',
  approved_at = COALESCE(sent_at, updated_at, now()),
  approved_by = NULL,
  metadata = COALESCE(metadata, '{}'::jsonb)
            || jsonb_build_object('approval_backfill_reason','historical_sent_template')
WHERE status = 'sent'
  AND approval_status = 'pending_approval';

-- 3. Soft-archive ONLY the 4 confirmed Sprint B smoke templates (explicit IDs, no regex)
UPDATE public.broadcast_templates
SET
  status = 'archived',
  metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'archived_at', now(),
    'archived_by', 'system',
    'archive_reason', 'Sprint B smoke cleanup'
  )
WHERE id IN (
  '09ad81eb-8e6c-4afe-9777-bfc18dc91337'::uuid,
  '7786a7f2-6bbb-4339-8b36-a68efd51d863'::uuid,
  '9884f707-b069-49e4-8c6c-60963f11cdf5'::uuid,
  'd673bd32-cd18-4bd4-8e9d-493bd256d3f7'::uuid
)
AND status <> 'archived';

-- 3a. Audit logs for soft-archive (one row per archived template)
INSERT INTO public.audit_logs (action, actor_type, actor_label, meta)
SELECT
  'broadcast_template_soft_archived',
  'system',
  'patch-e-migration',
  jsonb_build_object(
    'entity_type','broadcast_template',
    'entity_id', id,
    'name', name,
    'reason','Sprint B smoke cleanup'
  )
FROM public.broadcast_templates
WHERE id IN (
  '09ad81eb-8e6c-4afe-9777-bfc18dc91337'::uuid,
  '7786a7f2-6bbb-4339-8b36-a68efd51d863'::uuid,
  '9884f707-b069-49e4-8c6c-60963f11cdf5'::uuid,
  'd673bd32-cd18-4bd4-8e9d-493bd256d3f7'::uuid
)
AND (metadata->>'archive_reason') = 'Sprint B smoke cleanup';

-- 4. Approval RPC (gated by entitlements.manage, mirrors forced helper RBAC)
CREATE OR REPLACE FUNCTION public.approve_broadcast_template(_template_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_has_perm BOOLEAN;
  v_tpl RECORD;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- entitlements.manage check (same as forced helper)
  SELECT public.has_permission(v_actor, 'entitlements.manage') INTO v_has_perm;
  IF NOT COALESCE(v_has_perm, FALSE) THEN
    RAISE EXCEPTION 'forbidden_missing_entitlements_manage' USING ERRCODE = '42501';
  END IF;

  SELECT id, name, status, approval_status
    INTO v_tpl
    FROM public.broadcast_templates
   WHERE id = _template_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'template_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_tpl.approval_status = 'approved' THEN
    RETURN jsonb_build_object('ok', true, 'already_approved', true, 'template_id', _template_id);
  END IF;

  IF v_tpl.approval_status = 'rejected' THEN
    RAISE EXCEPTION 'template_rejected_cannot_approve' USING ERRCODE = '22023';
  END IF;

  UPDATE public.broadcast_templates
     SET approval_status = 'approved',
         approved_by = v_actor,
         approved_at = now(),
         rejected_reason = NULL
   WHERE id = _template_id;

  INSERT INTO public.audit_logs (action, actor_type, actor_label, actor_id, meta)
  VALUES (
    'broadcast_template_approved',
    'user',
    'admin_ui',
    v_actor,
    jsonb_build_object(
      'entity_type','broadcast_template',
      'entity_id', _template_id,
      'template_name', v_tpl.name,
      'previous_approval_status', v_tpl.approval_status
    )
  );

  RETURN jsonb_build_object('ok', true, 'approved', true, 'template_id', _template_id);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_broadcast_template(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_broadcast_template(UUID) TO authenticated;