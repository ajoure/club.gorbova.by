# Отчет о выполнении: PLAN-ONLY READ-ONLY REVIEW — Products 2 / PR #401

Итог: **PASS** (критических находок нет; 2 замечания уровня MINOR).

## 1. SHA и источник

- Ветка: `codex/products2-payment-manager-options` (GitHub `ajoure/club.gorbova.by`).
- `git ls-remote` → `e352725fc5592a2b6df994837a19de0f874e86a4`; после `git fetch <branch>` объект существует локально (`git cat-file -t` → `commit`), `FETCH_HEAD` = `e352725f...86a4`. Совпадение точное.
- База: локальный `origin/main` = `f89ac45561131b5077767f9ada0e3acaf1897126` — совпадает с заявленной.
- Примечание к процедуре: `origin` в этом окружении — зеркало Lovable, где ветки PR нет; ветка прочитана прямым fetch из GitHub-репозитория. Подмены `main`/другого SHA/устаревшего дерева не было.

## 2. Состав патча (diff f89ac455 → e352725f)

11 файлов, 620 вставок. Миграции — ровно одна:

- `supabase/migrations/20260901170547_payment_manager_options_directory.sql`

Edge Functions не затронуты (0 файлов в `supabase/functions/`), данных не пишется, backfill отсутствует. Остальное — фронтенд/хуки/тесты/типы и один аудит-документ.

## 3. RPC `public.get_payment_manager_options_v1()` — PASS

| Требование | Факт | Итог |
| --- | --- | --- |
| SECURITY DEFINER | да | PASS |
| `SET search_path = ''` | да, все объекты квалифицированы `public.` | PASS |
| anonymous → auth_required | `v_actor IS NULL AND NOT service_role` → `RAISE 'auth_required'` (42501) | PASS |
| authenticated → `has_permission(auth.uid(),'entitlements.view')` | да, иначе `forbidden_payments_view` | PASS |
| service_role разрешён | ветка `v_is_service_role` | PASS (см. MINOR-1) |
| REVOKE PUBLIC/anon, GRANT authenticated+service_role | `REVOKE ALL ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated, service_role` | PASS |
| Возвращает только `user_id`, `label` | RETURNS TABLE(user_id uuid, label text) | PASS |
| Только персонал с ролью ≠ `user` | `JOIN roles ON id=role_id WHERE code <> 'user'` | PASS |
| Нет PII (email/телефон/Telegram/детали ролей) | в выборке только id и `full_name`-производный ярлык | PASS |
| Не расширяет `users.view`, не меняет RLS/роли/назначения/платежи/сделки/заказы | в миграции только CREATE FUNCTION/COMMENT/REVOKE/GRANT | PASS |

Качество SQL:
- Компилируемость: plpgsql, корректные `RETURN QUERY`, `GROUP BY`, `ORDER BY 2, 1`.
- Неоднозначность идентификаторов: устранена алиасами `user_role`/`role_row`/`profile`; выходные имена `user_id`/`label` не конфликтуют с колонками входа (агрегат + алиас).
- Детерминизм: дедупликация по `GROUP BY user_role.user_id`, ярлык — `max(nullif(btrim(full_name),''))`, фолбэк `'Менеджер ' || left(uuid,8)`; сортировка по (label, user_id) — стабильна.
- Least privilege: обход RLS есть (SECURITY DEFINER), но поверхность — ровно 2 неконфиденциальных поля и жёсткий permission-гейт.

Критических находок (обход авторизации, ambiguous identifier, небезопасный search_path, избыточный grant, утечка данных) — нет.

## 4. Проверка предпосылок в production (read-only)

- `public.has_permission(_user_id uuid, _permission_code text)` — существует, SECURITY DEFINER. PASS.
- `public.user_roles_v2` — колонки `user_id`, `role_id` присутствуют. PASS.
- `public.roles` — `id`, `code` присутствуют. PASS.
- `public.profiles` — `user_id`, `full_name` присутствуют. PASS.
- Агрегат: сотрудников с хотя бы одной ролью ≠ `user` — **13** (без ID и PII).
- Функция `get_payment_manager_options_v1` в production ещё **отсутствует** — ожидаемо до применения миграции.

## 5. Фронтенд-контракт — PASS

- `/admin/payments` больше не использует `useStaffOptions`: в `src/components/admin/payments/**` совпадений нет; хук остаётся только в CRM-диалогах (сделки, ссылки на оплату) — вне scope.
- Директория тянется через `usePaymentManagerDirectoryOptions` → `supabase.rpc('get_payment_manager_options_v1')`, react-query, `staleTime` 5 мин.
- Исторические менеджеры из загруженной атрибуции сохраняются: `buildPaymentManagerOptions` сливает снимки `responsible_user_id/responsible_name` с директорией, дедупликация по стабильному `user_id` (Map).
- `all` / `__unassigned__` сохранены как отдельные пункты и исключены из директории.
- loading/error/retry: `role="status"`/`role="alert"`, кнопка «Повторить загрузку сотрудников» с `refetch`, состояние «Сотрудники не найдены».
- Выбранный бывший менеджер не сбрасывается: `retainedOption` удерживает выбор с безопасным ярлыком «Выбранный менеджер (имя недоступно)».
- Период/persistence не изменены логически; правки `period-selector` — только адаптивность (max-height/max-width, скролл).
- Таблица/статистика/CSV считаются из `filteredPayments` — фильтрация по `responsible_user_id` не изменена, паритет сохранён.
- Overflow desktop/mobile: сетка фильтров `grid-cols-1 sm:grid-cols-2 …`, `min-w-0`, ограничение высоты SelectContent.

## 6. Атрибуция (read-back, без изменений)

`public.payment_sales_attribution` где `effective_to IS NULL`: **total 31 / assigned 0 / unassigned 31** — совпадает с ранее наблюдаемым. `orders_v2.responsible_user_id` не использовался. Исторический backfill — STOP, вне scope: требует отдельного read-only dry-run с точными наборами/счётчиками защищённых строк и отдельного одобрения.

## 7. Находки

- **MINOR-1 (функциональное, fail-closed).** Определение service_role через legacy-GUC `current_setting('request.jwt.claim.role')`. На современном PostgREST клеймы отдаются в `request.jwt.claims` (JSON), поэтому GUC может быть пуст, и прямой вызов от service_role без `sub` упадёт в `auth_required`. Риска безопасности нет (ошибка в сторону запрета), но пункт «service_role allowed» может не выполняться в рантайме. Проверяется только после применения миграции.
- **MINOR-2 (стиль).** В `PaymentsFilters.tsx` два `import` (`useId`, `Button`) добавлены в конец файла. Для ESM это валидно (hoisting), сборка/тесты зелёные, но стилистически стоит перенести вверх.
- INFO: `src/integrations/supabase/types.ts` правится вручную (файл автогенерируемый) — после применения миграции регенерация перезапишет запись; расхождений в сигнатуре нет.

## 8. Точный будущий execute-план (НЕ выполняется)

1. Merge ровно ревьюированного head `e352725fc5592a2b6df994837a19de0f874e86a4`.
2. Синхронизировать точный merge SHA и доказать чистое дерево.
3. Применить ровно одну managed-миграцию `20260901170547_payment_manager_options_directory.sql`.
4. Deploy Edge Functions: **0**. Записей данных и backfill: **0**.
5. Build и Publish.
6. Runtime QA (после отдельного одобрения): вызов RPC от authenticated с `entitlements.view` (PASS) и без (forbidden), негативная проверка anon, проверка фильтра менеджеров на `/admin/payments` на desktop и mobile, паритет таблицы/статистики/CSV, повторный read-back атрибуции 31/0/31.
7. Отдельно и позже: решение по MINOR-1 (service_role detection) и MINOR-2.
