-- 1. Добавить колонку public_url (nullable на время backfill)
ALTER TABLE public.payment_links
  ADD COLUMN IF NOT EXISTS public_url text;

-- 2. Backfill: собрать canonical URL из primary_domain продукта или фолбэка
UPDATE public.payment_links pl
SET public_url = CASE
  WHEN p.primary_domain IS NOT NULL
       AND p.primary_domain !~* '(lovable\.dev|lovable\.app|lovableproject\.com|localhost)'
       AND p.primary_domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'
    THEN 'https://' || p.primary_domain || '/pay/' || pl.url_token
  ELSE 'https://club.gorbova.by/pay/' || pl.url_token
END
FROM public.products_v2 p
WHERE pl.product_id = p.id
  AND (pl.public_url IS NULL OR pl.public_url ILIKE '%lovable%' OR pl.public_url ILIKE '%localhost%');

-- 3. Backfill для ссылок без product_id (или продукт удалён) — фолбэк
UPDATE public.payment_links
SET public_url = 'https://club.gorbova.by/pay/' || url_token
WHERE public_url IS NULL OR public_url ILIKE '%lovable%' OR public_url ILIKE '%localhost%';

-- 4. NOT NULL после backfill
ALTER TABLE public.payment_links
  ALTER COLUMN public_url SET NOT NULL;

-- 5. CHECK constraint: только https и без preview-доменов
ALTER TABLE public.payment_links
  DROP CONSTRAINT IF EXISTS payment_links_public_url_canonical_chk;

ALTER TABLE public.payment_links
  ADD CONSTRAINT payment_links_public_url_canonical_chk
  CHECK (
    public_url ~ '^https://'
    AND public_url !~* '(lovable\.dev|lovable\.app|lovableproject\.com|localhost|127\.0\.0\.1)'
  );