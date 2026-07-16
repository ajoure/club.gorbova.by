
# План: восстановление доступа к урокам (RLS `training_lessons`)

## Diagnose (уже проведён)

Клиенты получили «урок недоступен» после миграции **20260716095645** (сегодня, 09:56 UTC). Она заменила старую SELECT-политику `Authenticated users can view active lessons` на строгую:

```sql
product_id IS NOT NULL
AND EXISTS (SELECT 1 FROM entitlements e
            WHERE e.user_id = auth.uid()
              AND e.product_id = training_lessons.product_id
              AND e.status='active' AND (e.expires_at IS NULL OR e.expires_at > now()))
```

Однако у **всех 406 строк** `training_lessons.product_id IS NULL` — связь с продуктом лежит на `training_modules.product_id` и/или в `access_rules` (grant_target_type = `training_content` / `product_access`). Условие политики никогда не проходит → все не-админы потеряли SELECT на уроки платформы (кроме 3 KB-lessons из моей вчерашней политики). Именно это и наблюдают клиенты.

Дополнительно у части активных entitlement'ов продукт вообще не имеет своих training_modules (Идеология, standalone-потоки) — доступ им приходит через `access_rules.grant_target_type IN ('training_content','product_access')`, что старая политика также не учитывает.

## Что нужно сделать

Заменить SELECT-политику `Users can view lessons they are entitled to` на корректную, повторяющую фронтенд-resolver. Не трогать другие политики (`Admins can manage lessons`, `Authenticated can view lessons referenced by kb_questions`).

### 1. Helper (SECURITY DEFINER)

Создать `public.user_has_training_lesson_access(_user_id uuid, _lesson_id uuid) RETURNS boolean` со `search_path=public`, `stable`, `security definer`. Возвращает `true`, если урок активен и:

- админ / super_admin (по `has_role_v2`), **или**
- есть активный entitlement (`status='active'`, `expires_at IS NULL OR > now()`) на продукт, чей `training_modules.product_id` = `lesson.module_id → module.product_id`, **или**
- есть активный entitlement на продукт `P`, для которого существует активное правило `access_rules`:
  - `grant_target_type='training_content'`, `product_id = P`, target module = `lesson.module_id` **или** module лежит в `conditions.allowed_module_ids`, **или**
  - `grant_target_type='product_access'`, `product_id = P`, `target_ref = module.product_id` (кросс-продуктовый бонус) — эквивалент entitlement на целевой продукт.

Функция чистая (только SELECT, без побочек), возвращает boolean, легко откатывается.

### 2. Политика

```text
DROP POLICY "Users can view lessons they are entitled to" ON public.training_lessons;
CREATE POLICY "Users can view lessons they are entitled to"
  ON public.training_lessons FOR SELECT TO authenticated
  USING (public.user_has_training_lesson_access(auth.uid(), id));
```

Политика `Authenticated can view lessons referenced by kb_questions` остаётся как есть (нужна для KB-вопросов, где lesson.module может быть у продукта без entitlement, но публично разрешено).

### 3. GRANT / RLS

Существующие GRANT'ы на `training_lessons` не меняем. На helper: `GRANT EXECUTE ... TO authenticated, service_role`.

## Dry run (перед миграцией)

Через `psql` под `SET LOCAL role authenticated` + JWT sub для 4 профилей, зафиксировать AS-IS видимость и after-count:

| Профиль | Ожидание |
|---|---|
| Test asmanta (Ideology 24h, `291aaf0b-...`) | до: 3 KB-lessons; после: те же 3 KB-lessons (Идеология без training_modules) |
| User с активным «Ценный бухгалтер 1 ст. 2.0» (`df411c24-...`) | до: 0; после: 106 |
| User только с cross-product bonus (пример из access_rules) | до: 0; после: N (>0) |
| Anon / без entitlement | до: 0; после: 0 (только KB-lessons через отдельную политику) |
| Super admin | до: 406; после: 406 |

Если хоть один expected fail → миграция не применяется, готовим rollback.

## Execute

Одна миграция:

1. `CREATE OR REPLACE FUNCTION public.user_has_training_lesson_access(...)`
2. `GRANT EXECUTE`
3. `DROP POLICY ... ; CREATE POLICY ...`

## Verify (postflight)

1. Тот же psql-скрипт под 5 профилями — числа совпали с ожиданием.
2. Playwright под Test asmanta: страница `/knowledge` → кнопка «Смотреть видеоответ» активна, клик открывает урок; страница `/library` → карточки видны.
3. `supabase--linter` — ошибок нет.

## Rollback

Заранее сохранить текущее определение политики и helper (если существовал). Rollback-миграция:

```text
DROP POLICY "Users can view lessons they are entitled to" ON public.training_lessons;
CREATE POLICY "Users can view lessons they are entitled to" ON public.training_lessons ...
  -- (точное тело исходной политики из 20260716095645)
DROP FUNCTION IF EXISTS public.user_has_training_lesson_access(uuid, uuid);
```

## Что явно НЕ трогаем в этом спринте

- `training_modules` policies (там уже `is_active` — ок).
- `entitlements`, `access_rules` — данные не меняются.
- Ранее добавленную политику `Authenticated can view lessons referenced by kb_questions` — оставляем.
- Никаких массовых бэкфиллов `training_lessons.product_id` — колонка де-факто заменена связкой module+access_rules; выравнивание модели — отдельной задачей.

## DoD

- Не-админ с активным entitlement на продукт с training_modules видит ВСЕ активные уроки этого продукта.
- Не-админ с активным entitlement и cross-product access_rule видит уроки целевого продукта.
- Не-админ без активных entitlement / с истёкшим `expires_at` НЕ видит уроки (кроме KB-lessons).
- Админ видит всё.
- Не сломаны существующие тесты и `supabase--linter`.
- Rollback-миграция подготовлена и проверена dry-run.
