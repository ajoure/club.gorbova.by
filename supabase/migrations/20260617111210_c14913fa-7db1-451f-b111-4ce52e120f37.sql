DELETE FROM public.audit_logs
 WHERE action = 'package_document_atomic_save'
   AND entity_id = 'b0b229b7-cf7e-4869-988e-8e97bdf54043';

DROP FUNCTION IF EXISTS public._proof_stage3_call_atomic(uuid, uuid, uuid, jsonb, jsonb, uuid);