-- Index for filtering payments by refunds count
CREATE INDEX IF NOT EXISTS idx_payments_v2_bepaid_refunds_len
ON payments_v2 ((jsonb_array_length(COALESCE(refunds,'[]'::jsonb))))
WHERE provider='bepaid';