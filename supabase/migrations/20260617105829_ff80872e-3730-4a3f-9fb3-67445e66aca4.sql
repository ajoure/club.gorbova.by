-- Stage 3 proof helper (transient).
-- Цель: позволить edge-функции `_proof-stage3-runtime` вызвать save_session_document_atomic
-- от имени конкретного пользователя в одной транзакции, чтобы auth.uid() резолвился корректно.
-- ВАЖНО: функция доступна ТОЛЬКО service_role и удаляется отдельной миграцией после прогона proof.

CREATE OR REPLACE FUNCTION public._proof_stage3_call_atomic(
  p_uid uuid,
  p_session_id uuid,
  p_item_id uuid,
  p_field_values jsonb,
  p_role_assignments jsonb,
  p_expected_version uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_uid IS NULL THEN
    RAISE EXCEPTION 'proof_uid_required';
  END IF;
  -- Локально для транзакции выставляем JWT-claim. save_session_document_atomic ниже
  -- читает auth.uid() из этого же контекста, что эквивалентно реальному пользовательскому вызову.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text,
    true
  );
  v_result := public.save_session_document_atomic(
    p_session_id, p_item_id, p_field_values, p_role_assignments, p_expected_version
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public._proof_stage3_call_atomic(uuid, uuid, uuid, jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._proof_stage3_call_atomic(uuid, uuid, uuid, jsonb, jsonb, uuid) TO service_role;

COMMENT ON FUNCTION public._proof_stage3_call_atomic(uuid, uuid, uuid, jsonb, jsonb, uuid) IS
'TRANSIENT Stage 3 proof helper. Drops after concurrent + rollback + desired-state runtime proof completes.';