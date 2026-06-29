-- PATCH-RESTORE-ACCESS-RULES-AUTHENTICATED-SELECT
-- Регрессия: миграция 20260629092921 заменила SELECT-политику access_rules на admin-only.
-- Клиентские хуки (useAccessValidation, useTrainingContentRules, useMonthGate,
-- useModuleMonthGate, useProductTrainings) читают access_rules напрямую и без прав
-- получают пустой набор — это вызывало "пропадание" продуктов и "замок" на Базе знаний
-- и купленных тренингах у всех неадминов.
-- Восстанавливаем чтение для роли authenticated. Таблица не содержит PII —
-- только маппинги product_id/tariff_id/section на правила доступа.

DROP POLICY IF EXISTS "Admins can read access_rules" ON public.access_rules;

CREATE POLICY "Authenticated users can read access_rules"
ON public.access_rules
FOR SELECT
TO authenticated
USING (true);
