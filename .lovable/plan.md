# Products 2 — финальный гейт: hardening payment_links_enriched_v + деплой 5 функций

Статус проверок: **PASS** (гейты SHA/дерева/миграции пройдены, изменений не вносилось).

## 1. Гейт SHA и дерева

- HEAD = `55d26de4b5b7a872f5d7537cb2a165c238d15754` — совпадает с указанным merged origin/main.
- Рабочее дерево чистое, WIP-коммитов нет. Верхние коммиты: `55d26de4b` (merge PR #397), `d8970bf4c` (fix: harden payment links view access).

## 2. Точный SQL миграции

Файл `supabase/migrations/20260830130000_restore_payment_links_enriched_security_invoker.sql` содержит ровно три разрешённых оператора (плюс комментарий-заголовок):

```sql
ALTER VIEW public.payment_links_enriched_v
  SET (security_invoker = true);

REVOKE ALL ON public.payment_links_enriched_v
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.payment_links_enriched_v TO service_role;
```

Никакого DDL сверх этого — соответствие разрешённой семантике подтверждено.

## 3. Текущее production-состояние (baseline, read-only)

- `pg_class.reloptions` для `payment_links_enriched_v` = NULL — `security_invoker` не установлен (view исполняется правами владельца).
- `aclexplode(relacl)`: `anon`, `authenticated`, `service_role` имеют полный набор привилегий (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN). `has_table_privilege` для anon/authenticated по SELECT и INSERT = true.
- `get_admin_payment_links_v1`: owner `postgres`, `prosecdef = true`, EXECUTE только у `postgres`, `authenticated`, `service_role`; у `anon`/PUBLIC нет; внутри fail-closed проверка `has_admin_section_access`.

То есть находка ACL реальна и снимается именно этой миграцией.

## 4. Ожидаемое состояние каталога после применения

- `reloptions` содержит `security_invoker=true`.
- `anon` и `authenticated` — ноль прямых привилегий на view.
- `service_role` — только SELECT; INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER отсутствуют.
- `get_admin_payment_links_v1` без изменений: SECURITY DEFINER, owner postgres, EXECUTE для authenticated (не anon/PUBLIC), внутренняя fail-closed проверка доступа.

## 5. Предсказанная граница авто-диффа платформы

Разрешено ровно:
- один платформенный дубликат этой миграции (файл `supabase/migrations/<platform-ts>_*.sql`) с тем же SQL — комментарии/имя могут отличаться;
- один сервисный коммит, связанный с этим применением.

STOP при любом ином диффе: изменения `src/integrations/supabase/types.ts`, исходников функций, любого кода, данных или дополнительных SQL-операторов в сгенерированной копии. Дубликат позже удаляется отдельным GitHub PR со стороны Codex.

## 6. Скоуп деплоя (ровно пять функций)

`admin-create-payment-link`, `admin-create-public-link`, `admin-invoice-checkout-issue`, `public-checkout`, `public-rr-installment-initiate` — все присутствуют в дереве вместе с общими зависимостями `supabase/functions/_shared`. Деплой без миграций кода и без изменения исходников.

## 7. План верификации (безопасный, без побочных эффектов)

1. Read-back каталога: `reloptions`, `aclexplode(relacl)`, `has_table_privilege` для anon/authenticated/service_role по всем 7 привилегиям.
2. Read-back функции: `prosecdef`, owner, `proacl` для `get_admin_payment_links_v1`.
3. Регресс-проба админ-пути: вызов RPC `get_admin_payment_links_v1` продолжает работать под admin-контекстом (только чтение, без создания сущностей).
4. Fail-closed пробы пяти функций: OPTIONS (CORS), запрос без JWT, запрос с malformed JWT — ожидание 200 на OPTIONS и 401 `auth_required` (либо 403 для admin-функций) без 500.
5. Никаких реальных платежей, ссылок, checkout, сообщений, пользователей, контактов, подписок, строк доступа и backfill.
6. Publish не выполняется.

## 8. Итог

PASS по всем предварительным гейтам. Готово к execute в порядке: миграция `20260830130000` → read-back каталога → деплой пяти функций → fail-closed пробы → отчёт. Без Publish.

READ-ONLY: NO CHANGES.
