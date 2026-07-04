План:

## Диагноз
Ошибка `permission denied for table training_lessons` из скриншота — это ошибка уровня GRANT (PostgREST), а не RLS.

Проверил в БД:
- У роли `authenticated` на `public.training_lessons` есть только `SELECT`, но нет `INSERT`/`UPDATE`/`DELETE`.
- То же самое на `public.training_modules`.
- RLS-политика `Admins can manage lessons` корректная (разрешает admin/super_admin через `has_role_v2`), но до неё запрос не доходит — GRANT срезает раньше.
- Ирина Гаринова (auth uid `f1a79dd0-…`, вход с `irenessa@yandex.ru` подтверждён в auth-логах) имеет роль `admin` в `user_roles_v2`, то есть RLS её пропустит, как только появятся GRANT'ы.

Соседние таблицы (`lesson_blocks`, `lesson_attachments`) уже имеют полные GRANT'ы — расхождение подтверждает, что на `training_lessons`/`training_modules` GRANT'ы просто забыли выдать при создании.

## Исправление (одна миграция)

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_lessons TO authenticated;
GRANT ALL ON public.training_lessons TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_modules TO authenticated;
GRANT ALL ON public.training_modules TO service_role;
```

RLS не трогаем — доступ к записи остаётся у admin/super_admin, как и было задумано.

## Verify (DoD)
1. После применения миграции — повторный запрос `has_table_privilege('authenticated', 'public.training_lessons', 'INSERT')` должен вернуть `true`.
2. Открыть в preview `/admin/live-events` под учёткой Ирины (или под тест-админом), создать урок «Тест GRANT» в модуле «Итоги месяца» — должен создаться без тоста «permission denied». Затем удалить тестовый урок.
3. Проверить в логах Postgres/edge, что ошибок permission denied по этим таблицам больше нет.

## Что НЕ делаем
- Не меняем RLS-политики.
- Не трогаем роли пользователей (у Ирины уже admin).
- Не выдаём `anon` — таблицы админские.
