CREATE TABLE IF NOT EXISTS public.manychat_diagnose_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now(),
  http_method text,
  source_ip text,
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_body text,
  parsed_body jsonb,
  content_type text,
  signature_header_candidates jsonb DEFAULT '{}'::jsonb,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_manychat_diagnose_log_received_at
  ON public.manychat_diagnose_log (received_at DESC);

ALTER TABLE public.manychat_diagnose_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manychat_diagnose_log_select_superadmin"
  ON public.manychat_diagnose_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::public.app_role));

CREATE POLICY "manychat_diagnose_log_delete_superadmin"
  ON public.manychat_diagnose_log
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::public.app_role));

COMMENT ON TABLE public.manychat_diagnose_log IS
  'TEMPORARY (PATCH 0 / DIAGNOSE). Live capture входящих ManyChat webhook payloads + headers для фиксации контрактов (HMAC, idempotency, retry). Удаляется после завершения PATCH 0.';