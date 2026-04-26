ALTER TABLE public.payment_links ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_payment_links_meta_source ON public.payment_links ((meta->>'source'));