План: Fix — кнопка «Смотреть видеоответ» неактивна у обычных пользователей

Diagnose

1. UI-условие в `src/pages/Knowledge.tsx` (строка 153):
   `hasInternalLink = question.lesson?.slug && question.lesson?.module?.slug`.
   Если `lesson` не подгрузилась — кнопка `disabled` и клик молча игнорируется. Именно это видит клиент («Test Asmanta», продукт «Gorbova Club — Идеология», 24 ч).

2. `useKbQuestions` в `src/hooks/useKbQuestions.ts` подтягивает slug урока и модуля отдельными SELECT'ами к `training_lessons` и `training_modules` под сессией самого пользователя.

3. RLS `public.training_lessons`, политика **`Users can view lessons they are entitled to`**:
   ```
   is_active AND (admin OR super_admin
     OR (product_id IS NOT NULL
         AND EXISTS entitlements e
              WHERE e.user_id = auth.uid()
                AND e.product_id = training_lessons.product_id
                AND e.status = 'active'))
   ```

4. Проверка в БД:
   ```
   SELECT tl.product_id, COUNT(kq.id)
   FROM kb_questions kq JOIN training_lessons tl ON tl.id = kq.lesson_id
   GROUP BY tl.product_id;
   → product_id = NULL, 669 строк
   ```
   У всех уроков-носителей видеоответов `product_id IS NULL`. Из-за `product_id IS NOT NULL` в политике **любой не-админ** не видит ни одной строки `training_lessons` для KB-вопросов → `lesson = null` → кнопка disabled.

5. Это регресс доступа, а не «неправильный тариф»: сейчас так у всех клиентов Club, включая Идеологию. `training_modules` не блокирует (политика `is_active = true`).

Scope (минимальный)

Раздел «База знаний → Вопросы» и только он. Никаких изменений в тарифной матрице, entitlements, странице урока, роутинге, страницах админа.

План правки

1. Миграция SQL — добавить в `public.training_lessons` дополнительную SELECT-политику (существующие не трогаем):
   ```sql
   CREATE POLICY "Authenticated can view lessons referenced by kb_questions"
     ON public.training_lessons
     FOR SELECT
     TO authenticated
     USING (
       is_active
       AND EXISTS (SELECT 1 FROM public.kb_questions kq WHERE kq.lesson_id = training_lessons.id)
     );
   ```
   Разрешает читать только строки уроков, на которые уже опубликован KB-вопрос, только авторизованным. `GRANT SELECT` для `authenticated` на `training_lessons` уже есть (иначе админ бы не читал).

2. Ничего в `training_modules` менять не нужно — существующая политика `is_active = true` уже пропускает.

3. Клиентская логика остаётся как есть: кнопка ведёт на `/library/:module/:lesson`, а гейт доступа к плееру продолжает работать на странице урока — этот план его НЕ ослабляет. Наружу «утекает» только пара `id + slug + module_id + module.slug` для уроков, у которых и так есть публичная запись в KB (title/question) — новой чувствительной информации не добавляется.

Dry run / Verify (после apply в build-режиме)

- SQL sanity:
  ```
  SET ROLE authenticated;  -- через impersonation user_id = 291aaf0b… (Test Asmanta)
  SELECT id, slug, module_id
  FROM training_lessons
  WHERE id IN (SELECT DISTINCT lesson_id FROM kb_questions LIMIT 5);
  ```
  Должно вернуть строки (до фикса — 0 строк).

- Playwright под этим пользователем на `/knowledge`:
  1. кнопка «Смотреть видеоответ» перестала быть `disabled`,
  2. клик уводит на `/library/<module>/<lesson>` с `state.seekTo` и `autoplay`,
  3. в консоли — лог `[goToVideoAnswer] Internal navigation`, а не тост «Видеоответ не привязан к уроку».

- Regression: под тем же non-admin проверить, что прямой список `training_lessons` без фильтра по kb_questions по-прежнему НЕ показывает уроки без entitlement (RLS других политик не расширилась).

DoD

- Кнопка активна для всех авторизованных с валидным `lesson_id` в KB.
- Не-админ по-прежнему не читает `training_lessons` без активного entitlement, кроме уроков, привязанных к `kb_questions`.
- Security scan: без новых level=error findings.
- Никаких мутаций entitlements/product_id и никаких правок UI-логики доступа.

Технический блок

- Файлы:
  - новый `supabase/migrations/<ts>_kb_lessons_public_slug_read.sql` — SQL из шага 1.
  - `src/pages/Knowledge.tsx`, `src/hooks/useKbQuestions.ts`, `src/lib/goToVideoAnswer.ts` — без изменений.
- Rollback: `DROP POLICY "Authenticated can view lessons referenced by kb_questions" ON public.training_lessons;`. Никаких данных не мигрируется.
