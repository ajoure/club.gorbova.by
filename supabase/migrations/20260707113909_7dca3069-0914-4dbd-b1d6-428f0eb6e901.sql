WITH orig AS (
  SELECT id, blocks->0->'content'->>'code' AS code
  FROM public.site_pages
  WHERE id = 'd5a5c2e0-9e4c-4e6c-b9bc-1e4bd264d656'
    AND blocks->0->'content'->>'code' NOT LIKE '%data-lovable-cb20-footer-v1%'
),
step1 AS (
  SELECT id,
    substr(code, 1, strpos(code, '<div id="rec1739234301"') - 1)
    || $FOOTER$<div id="rec1739234301" data-lovable-cb20-footer-v1="1" style="background:#1a0a0e;color:#f4ecec;padding:56px 20px 28px;font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;"><div style="max-width:1200px;margin:0 auto;"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:32px;margin-bottom:32px;"><div style="grid-column:span 2;min-width:0;"><div style="margin-bottom:16px;"><div style="font-weight:700;letter-spacing:0.18em;color:#f4ecec;font-size:15px;">KATERINA GORBOVA</div><div style="font-size:12px;color:#b8a3a8;margin-top:4px;letter-spacing:0.02em;">Курсы и клуб для бухгалтеров</div></div><div style="font-size:14px;color:#b8a3a8;line-height:1.7;"><div style="color:#f4ecec;font-weight:500;">ЗАО «АЖУР инкам»</div><div>УНП: 193405000</div><div>Юр. адрес: 220035, г. Минск, ул. Панфилова, 2, офис 49Л</div><div>Почтовый адрес: 220052, Республика Беларусь, г. Минск, а/я 63</div><div style="margin-top:8px;"><a href="tel:+375291714321" style="color:#b8a3a8;text-decoration:none;">Телефон: +375 29 171-43-21</a></div><div><a href="mailto:info@ajoure.by" style="color:#b8a3a8;text-decoration:none;">E-mail: info@ajoure.by</a></div><div>Режим работы: Пн–Пт 9:00–18:00 (Минск)</div></div></div><div><div style="font-weight:600;color:#f4ecec;margin-bottom:14px;font-size:14px;letter-spacing:0.02em;">Документы</div><div style="display:flex;flex-direction:column;gap:10px;font-size:14px;"><a href="https://club.gorbova.by/offer" target="_blank" rel="noopener noreferrer" style="color:#b8a3a8;text-decoration:none;">Публичная оферта</a><a href="https://club.gorbova.by/order-payment" target="_blank" rel="noopener noreferrer" style="color:#b8a3a8;text-decoration:none;">Заказ и оплата услуг</a><a href="https://club.gorbova.by/privacy" target="_blank" rel="noopener noreferrer" style="color:#b8a3a8;text-decoration:none;">Политика конфиденциальности</a><a href="https://club.gorbova.by/consent" target="_blank" rel="noopener noreferrer" style="color:#b8a3a8;text-decoration:none;">Согласие на обработку данных</a><a href="https://club.gorbova.by/instruction" target="_blank" rel="noopener noreferrer" style="color:#b8a3a8;text-decoration:none;">Инструкция по оформлению расходов</a></div></div><div><div style="font-weight:600;color:#f4ecec;margin-bottom:14px;font-size:14px;letter-spacing:0.02em;">Мы в соцсетях</div><div style="display:flex;flex-wrap:wrap;gap:10px;"><a href="https://t.me/gorbova_bot" target="_blank" rel="noopener noreferrer" style="color:#f4ecec;text-decoration:none;display:inline-flex;align-items:center;padding:8px 14px;border:1px solid rgba(255,255,255,0.18);border-radius:999px;font-size:13px;">Telegram</a><a href="https://instagram.com/katerina.gorbova" target="_blank" rel="noopener noreferrer" style="color:#f4ecec;text-decoration:none;display:inline-flex;align-items:center;padding:8px 14px;border:1px solid rgba(255,255,255,0.18);border-radius:999px;font-size:13px;">Instagram</a></div></div></div><div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:20px;text-align:center;font-size:13px;color:#7a6a6e;">© 2026 ЗАО «АЖУР инкам». Все права защищены.</div></div></div>$FOOTER$
    || substr(code, strpos(code, '<script> (function () { function setTextByElemId'))
    AS code
  FROM orig
),
step2 AS (
  SELECT id,
    replace(
      code,
      'href="https://drive.google.com/file/d/1UCPrOtSnAey0t8cEyWGam_7TcYzftqxF/view" target="_blank" rel="noopener"',
      'data-lovable-download-disabled="1" aria-disabled="true" tabindex="-1" style="pointer-events:none;opacity:0.6;cursor:default;"'
    ) AS code
  FROM step1
)
UPDATE public.site_pages sp
SET blocks = jsonb_set(sp.blocks, '{0,content,code}', to_jsonb(s.code)),
    updated_at = now()
FROM step2 s
WHERE sp.id = s.id;