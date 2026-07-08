-- Fix ЮЛ buttons on cb site page: rewrite legacy href="https://gorbova.getcourse.ru/yurlizoN"
-- to bridge-action anchors that open InvoiceCheckoutDialog for the right tariff.
-- yurlizo1 → buh (Бухгалтер), yurlizo2 → gl_buh (Главный бухгалтер), yurlizo3 → biz-l (Бизнес-леди).

UPDATE public.site_pages
SET blocks = jsonb_set(
  blocks,
  '{0,content,code}',
  to_jsonb(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          blocks->0->'content'->>'code',
          '<a class="tn-atom" href="https://gorbova\.getcourse\.ru/yurlizo1"',
          '<a class="tn-atom" href="#" data-lovable-action="open-invoice" data-tariff-key="buh"',
          'g'
        ),
        '<a class="tn-atom" href="https://gorbova\.getcourse\.ru/yurlizo2"',
        '<a class="tn-atom" href="#" data-lovable-action="open-invoice" data-tariff-key="gl_buh"',
        'g'
      ),
      '<a class="tn-atom" href="https://gorbova\.getcourse\.ru/yurlizo3"',
      '<a class="tn-atom" href="#" data-lovable-action="open-invoice" data-tariff-key="biz-l"',
      'g'
    )
  ),
  false
),
updated_at = now()
WHERE slug = 'cb';