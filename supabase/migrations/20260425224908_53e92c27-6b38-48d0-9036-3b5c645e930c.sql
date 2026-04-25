DO $$
DECLARE
  v_job RECORD;
  v_pm RECORD;
  v_job_ids uuid[] := ARRAY['8ab07271-6448-4a4b-8b15-969f3d72fcf9'::uuid, '97244316-840f-4f95-bcb6-1d11049c3cd1'::uuid];
  v_pm_ids  uuid[] := ARRAY['b9eb71c9-a941-4da4-a3d7-9fff29bb3eca'::uuid, '9f61129c-63b3-4dcf-81c8-fc744773bd7a'::uuid];
BEGIN
  FOR v_job IN
    SELECT * FROM public.payment_method_verification_jobs
    WHERE id = ANY(v_job_ids) AND status = 'pending'
  LOOP
    UPDATE public.payment_method_verification_jobs
       SET status = 'failed',
           attempt_count = COALESCE(max_attempts, 3),
           last_error = 'cleanup: MIT verification disabled; orphan job, no worker (cron inactive, edge fn disabled). Marked failed because schema does not allow "canceled".',
           updated_at = now()
     WHERE id = v_job.id;

    INSERT INTO public.audit_logs (actor_type, actor_user_id, actor_label, action, target_user_id, meta)
    VALUES (
      'system', NULL, 'cleanup-orphan-pending-verification',
      'payment_method.verification_job.cleanup',
      v_job.user_id,
      jsonb_build_object(
        'job_id', v_job.id,
        'payment_method_id', v_job.payment_method_id,
        'before', jsonb_build_object('status', v_job.status, 'attempt_count', v_job.attempt_count),
        'after',  jsonb_build_object('status', 'failed', 'attempt_count', COALESCE(v_job.max_attempts, 3)),
        'reason', 'MIT verification disabled; cron trigger_card_verification active=false; edge fn payment-method-verify-recurring marked disabled',
        'note',   'status=failed used because valid_verification_status check forbids canceled'
      )
    );
  END LOOP;

  FOR v_pm IN
    SELECT * FROM public.payment_methods
    WHERE id = ANY(v_pm_ids) AND verification_status = 'pending'
  LOOP
    UPDATE public.payment_methods
       SET verification_status = 'not_required',
           updated_at = now()
     WHERE id = v_pm.id;

    INSERT INTO public.audit_logs (actor_type, actor_user_id, actor_label, action, target_user_id, meta)
    VALUES (
      'system', NULL, 'cleanup-orphan-pending-verification',
      'payment_method.verification_status.cleanup',
      v_pm.user_id,
      jsonb_build_object(
        'payment_method_id', v_pm.id,
        'card_status', v_pm.status,
        'before', jsonb_build_object('verification_status', v_pm.verification_status),
        'after',  jsonb_build_object('verification_status', 'not_required'),
        'reason', 'Card-level status (active/revoked) unchanged; only orphan verification flag cleared.'
      )
    );
  END LOOP;
END $$;