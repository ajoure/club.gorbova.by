
-- Payment links table for shareable public payment URLs
CREATE TABLE public.payment_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  
  -- What to pay for
  product_id UUID NOT NULL REFERENCES public.products_v2(id),
  tariff_id UUID NOT NULL REFERENCES public.tariffs(id),
  offer_id UUID REFERENCES public.tariff_offers(id),
  amount INTEGER NOT NULL, -- kopecks
  currency TEXT NOT NULL DEFAULT 'BYN',
  payment_type TEXT NOT NULL DEFAULT 'one_time',
  description TEXT,
  
  -- Optional: pre-assign to user (for personalized links)
  user_id UUID REFERENCES auth.users(id),
  
  -- Link lifecycle
  status TEXT NOT NULL DEFAULT 'active',
  max_uses INTEGER, -- null = unlimited
  current_uses INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  
  -- Metadata
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookup by url_token
CREATE INDEX idx_payment_links_url_token ON public.payment_links(url_token);

-- RLS
ALTER TABLE public.payment_links ENABLE ROW LEVEL SECURITY;

-- Admins can manage payment links
CREATE POLICY "Admins can manage payment links"
ON public.payment_links
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));
