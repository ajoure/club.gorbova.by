
CREATE TABLE public.rr_test_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL UNIQUE,
  rr_request_id text,
  amount_minor bigint NOT NULL,
  currency text NOT NULL,
  status_internal text NOT NULL DEFAULT 'created',
  status_raw text,
  commission_minor bigint,
  payment_url text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_notification_at timestamptz,
  raw_last jsonb,
  CONSTRAINT rr_test_ledger_external_id_prefix CHECK (external_id LIKE 'rr_test_%'),
  CONSTRAINT rr_test_ledger_currency_rub CHECK (currency = 'RUB'),
  CONSTRAINT rr_test_ledger_status_internal_check CHECK (
    status_internal IN ('created','pending','paid','canceled','failed','expired')
  ),
  CONSTRAINT rr_test_ledger_amount_positive CHECK (amount_minor > 0)
);

CREATE INDEX idx_rr_test_ledger_created_at ON public.rr_test_ledger (created_at DESC);
CREATE INDEX idx_rr_test_ledger_rr_request_id ON public.rr_test_ledger (rr_request_id);

GRANT SELECT ON public.rr_test_ledger TO authenticated;
GRANT ALL ON public.rr_test_ledger TO service_role;

ALTER TABLE public.rr_test_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rr_test_ledger admin select"
  ON public.rr_test_ledger
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

CREATE TRIGGER rr_test_ledger_set_updated_at
  BEFORE UPDATE ON public.rr_test_ledger
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
