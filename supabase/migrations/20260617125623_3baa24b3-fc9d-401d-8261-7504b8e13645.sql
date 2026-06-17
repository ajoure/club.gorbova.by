-- Stage 5.0.1: archive UAT test orphan field (pf-000002).
-- Token-driven canonical check confirmed: pf-000002 отсутствует во всех
-- document_template_versions.is_current=true.detected_tokens, поэтому это
-- безусловно orphan. Поле имеет 1 session-level значение → не удаляем
-- физически (preserve history), а архивируем (is_active=false).
-- После архива:
--   • orphan-блок «Идеологии» теряет это поле;
--   • session-level row остаётся для аудита, но не отображается
--     (catalog query фильтрует is_active=true);
--   • token aliases НЕ трогаем (нет field_catalog_id связи).
UPDATE public.document_package_field_catalog
SET is_active = false,
    updated_at = now()
WHERE id = '76e082af-5511-45dc-b2a3-258f13911ebc'
  AND public_id = 'pf-000002'
  AND label = 'UAT B5 — дата подписания'
  AND is_active = true;