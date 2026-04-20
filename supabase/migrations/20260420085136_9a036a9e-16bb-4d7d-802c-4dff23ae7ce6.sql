DO $$
DECLARE
  v_footer_content jsonb := '{
    "brand": {"showBrand": true, "logoUrl": "/src/assets/logo.png", "name": "БУКВА ЗАКОНА", "subtitle": "Клуб по законодательству", "description": ""},
    "company": {"showCompany": true, "name": "ЗАО «АЖУР инкам»", "unp": "193405000", "legalAddress": "220035, г. Минск, ул. Панфилова, 2, офис 49Л", "mailingAddress": "220052, Республика Беларусь, г. Минск, а/я 63", "phone": "+375 29 171-43-21", "phoneHref": "tel:+375291714321", "email": "info@ajoure.by", "workHours": "Пн–Пт 9:00–18:00 (Минск)"},
    "navigation": {"showNavigation": true, "title": "Навигация", "items": [{"label": "Контакты", "href": "/contacts", "openInNewTab": false}, {"label": "Помощь", "href": "/help", "openInNewTab": false}, {"label": "Вход", "href": "/auth", "openInNewTab": false}]},
    "legal": {"showLegal": true, "title": "Документы", "items": [{"label": "Публичная оферта", "href": "/offer", "openInNewTab": false}, {"label": "Заказ и оплата услуг", "href": "/order-payment", "openInNewTab": false}, {"label": "Политика конфиденциальности", "href": "/privacy", "openInNewTab": false}, {"label": "Согласие на обработку данных", "href": "/consent", "openInNewTab": false}]},
    "social": {"showSocial": false, "title": "Мы в соцсетях", "items": []},
    "payments": {"showPayments": true},
    "copyright": {"showCopyright": true, "text": ""}
  }'::jsonb;
  v_footer_block jsonb;
  r record;
BEGIN
  FOR r IN
    SELECT id FROM public.site_pages
    WHERE slug IN ('consultation', 'consultation-copy')
      AND status = 'draft'
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(blocks::jsonb) b WHERE b->>'type' = 'footer'
      )
  LOOP
    v_footer_block := jsonb_build_object(
      'id', gen_random_uuid()::text,
      'type', 'footer',
      'version', 1,
      'content', v_footer_content,
      'settings', '{}'::jsonb,
      'metadata', '{}'::jsonb
    );
    UPDATE public.site_pages
    SET blocks = (blocks::jsonb || jsonb_build_array(v_footer_block))::jsonb,
        updated_at = now()
    WHERE id = r.id;
  END LOOP;
END $$;