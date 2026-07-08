-- Add bank_installment offer to all 3 tariffs of the cb product
INSERT INTO public.tariff_offers (tariff_id, offer_type, button_label, amount, is_active, sort_order, meta)
SELECT
  t.id,
  'bank_installment',
  'Заявка на рассрочку',
  0,
  true,
  100,
  jsonb_build_object(
    'bank_installment', jsonb_build_object(
      'external_link', 'https://pay.rrllc.ru/katerina-gorbova-credit',
      'link_label', 'Перейти к оформлению рассрочки',
      'message_html', '<p>Оставьте заявку — мы свяжемся с вами, а затем оформите рассрочку от банка по кнопке ниже.</p>'
    )
  )
FROM public.tariffs t
WHERE t.id IN (
  'adbe94e8-171d-4b49-8338-66c554bb1f0b',
  '543940b1-99da-47f3-accc-671ad5b11afe',
  '9bc81736-e7e5-48db-9925-b866427a98e1'
)
AND NOT EXISTS (
  SELECT 1 FROM public.tariff_offers o
  WHERE o.tariff_id = t.id AND o.offer_type = 'bank_installment'
);

-- Add lead offer to the two tariffs missing it
INSERT INTO public.tariff_offers (tariff_id, offer_type, button_label, amount, is_active, sort_order)
SELECT t.id, 'lead', 'Оставить заявку', 0, true, 90
FROM public.tariffs t
WHERE t.id IN (
  '543940b1-99da-47f3-accc-671ad5b11afe',
  '9bc81736-e7e5-48db-9925-b866427a98e1'
)
AND NOT EXISTS (
  SELECT 1 FROM public.tariff_offers o
  WHERE o.tariff_id = t.id AND o.offer_type = 'lead'
);