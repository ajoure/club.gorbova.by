-- PATCH-RESTORE-TRAINING-LESSONS-AUTHENTICATED-SELECT
-- Регрессия: миграция 20260629092921 заменила permissive SELECT-политику
-- training_lessons ("Authenticated users can view active lessons") на узкую
-- "Users can view training lessons with access" с тремя EXISTS-ветками
-- (subscriptions_v2.product_id, entitlements.product_code, module_access.tariff_id).
--
-- Симптом: пользователи с оплаченными тарифами и активными entitlements
-- (выданными по product_id без legacy product_code) перестали видеть уроки
-- базы знаний и видеоответы — строки training_lessons скрывались RLS целиком.
--
-- Клиентский слой (useContainerLessons, useKbQuestions, useTrainingLessons,
-- useProductTrainings, useSidebarModules) выполняет плоский SELECT уроков и
-- сам считает has_access по subscriptions_v2 / entitlements / access_rules /
-- module_access — RLS не должен скрывать строки активных уроков.
--
-- Восстанавливаем permissive SELECT для authenticated (как у training_modules:
-- is_active=true). Метаданные урока (title/slug/thumbnail/sort_order) не являются PII.
-- Полный контент урока (HTML/видео) защищён отдельно на уровне resolver/RPC.

DROP POLICY IF EXISTS "Users can view training lessons with access" ON public.training_lessons;
DROP POLICY IF EXISTS "Authenticated users can view active lessons" ON public.training_lessons;

CREATE POLICY "Authenticated users can view active lessons"
ON public.training_lessons
FOR SELECT
TO authenticated
USING (is_active = true);