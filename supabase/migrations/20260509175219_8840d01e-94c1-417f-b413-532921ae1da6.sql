-- C5-G FIX: устранить ambiguous column reference в allocate_document_number
-- (RETURNS TABLE OUT vars `document_date`/`document_timezone` коллизировали с колонками)
CREATE OR REPLACE FUNCTION public.allocate_document_number(p_document_id uuid, p_now timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(document_number text, document_date date, document_seq integer, document_timezone text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_doc_id uuid;
  v_existing_number text;
  v_existing_date date;
  v_existing_seq integer;
  v_existing_tz text;
  v_context_type text;
  v_context_id uuid;
  v_template_id uuid;
  v_template_version_id uuid;
  v_profile_id uuid;
  v_today date;
  v_tz text := 'Europe/Minsk';
  v_seq integer;
  v_number text;
  v_now timestamptz := coalesce(p_now, now());
BEGIN
  SELECT d.id, d.document_number, d.document_date, d.document_seq, d.document_timezone,
         d.context_type, d.context_id, d.template_id, d.template_version_id, d.profile_id
    INTO v_doc_id, v_existing_number, v_existing_date, v_existing_seq, v_existing_tz,
         v_context_type, v_context_id, v_template_id, v_template_version_id, v_profile_id
  FROM public.ai_generated_documents d
  WHERE d.id = p_document_id
  FOR UPDATE;

  IF v_doc_id IS NULL THEN
    RAISE EXCEPTION 'document_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_existing_number IS NOT NULL THEN
    document_number := v_existing_number;
    document_date := v_existing_date;
    document_seq := v_existing_seq;
    document_timezone := coalesce(v_existing_tz, v_tz);
    RETURN NEXT;
    RETURN;
  END IF;

  v_today := (v_now AT TIME ZONE v_tz)::date;

  INSERT INTO public.document_number_counters AS c (document_date, document_timezone, last_seq)
  VALUES (v_today, v_tz, 1)
  ON CONFLICT (document_date, document_timezone)
  DO UPDATE SET last_seq = c.last_seq + 1, updated_at = now()
  RETURNING c.last_seq INTO v_seq;

  v_number := to_char(v_today, 'DDMM') || '/' || v_seq::text;

  UPDATE public.ai_generated_documents
     SET document_number = v_number,
         document_date = v_today,
         document_seq = v_seq,
         document_timezone = v_tz,
         document_number_assigned_at = now()
   WHERE id = p_document_id;

  INSERT INTO public.audit_logs (actor_user_id, actor_type, actor_label, action, meta)
  VALUES (
    NULL, 'system', 'document_numbering_v2', 'document_number.assigned',
    jsonb_build_object(
      'document_id', v_doc_id,
      'context_type', v_context_type,
      'context_id', v_context_id,
      'template_id', v_template_id,
      'template_version_id', v_template_version_id,
      'profile_id', v_profile_id,
      'document_number', v_number,
      'document_date', v_today,
      'document_seq', v_seq,
      'timezone', v_tz
    )
  );

  document_number := v_number;
  document_date := v_today;
  document_seq := v_seq;
  document_timezone := v_tz;
  RETURN NEXT;
END;
$function$;