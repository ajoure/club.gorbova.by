# Products 2 — финальная ревизия + разбор ACL-находки (PLAN-ONLY / READ-ONLY)

Изменений не вносилось: код, миграции, данные, Edge Functions и Publish не затронуты.

## SHA-гейт

- Целевой и фактический HEAD: `9dffb20df08ad7e82dd2e14c298702a51cd79d21`; `origin/main` тот же; дерево чистое, WIP нет. **PASS**

## Базовые проверки (сохранены)

1. Три дублирующие Lovable-миграции `20260830124428…`, `20260830124544…`, `20260830124721…` в дереве **ABSENT** — PASS.
2. `src/integrations/supabase/types.ts` present, 26 007 строк, `PostgrestVersion: "14.5"`, типы Products 2 на месте — PASS.
3. Единственная pending-миграция `20260830130000_restore_payment_links_enriched_security_invoker.sql`, единственный оператор `ALTER VIEW public.payment_links_enriched_v SET (security_invoker = true);` — PASS. В истории БД её нет.
   Замечание: применённые миграции Products 2 записаны в истории под платформенными версиями `20260830124428 / 124544 / 124721`, а не под именами файлов `083925 / 085855 / 113500`.

## 1. `pg_class.relacl` / `aclexplode` для `public.payment_links_enriched_v`

Владелец: `postgres`. `reloptions = NULL` (security_invoker НЕ установлен).

| grantee | privileges | is_grantable |
|---|---|---|
| postgres | SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN | false |
| anon | SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN | false |
| authenticated | SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN | false |
| service_role | SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN | false |
| sandbox_exec, sandbox_exec_hdjg… | SELECT, INSERT | false |

## 2. `has_table_privilege` (anon / authenticated)

| privilege | anon | authenticated |
|---|---|---|
| SELECT | true | true |
| INSERT | true | true |
| UPDATE | true | true |
| DELETE | true | true |
| TRUNCATE | true | true |
| REFERENCES | true | true |
| TRIGGER | true | true |

Это прямо противоречит намерению `20260418131910…` (`REVOKE ALL FROM anon, authenticated; GRANT SELECT TO authenticated`) и последующим миграциям, которые многократно ставили `security_invoker = on` (`20260418131929`, `20260418155148`, `20260418160316`, `20260616200409`). Текущее состояние — расширенные права плюс owner-rights.

## 3. Авто-обновляемость представления

- `information_schema.views.is_updatable = NO`
- `information_schema.tables.is_insertable_into = NO`
- DML-правил (`pg_rewrite` INSERT/UPDATE/DELETE) — 0.

Следствие: гранты INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES на этом представлении практически не исполнимы, но являются лишними привилегиями и подлежат отзыву. Реальная и критичная часть — `SELECT` для `anon` при отсутствии `security_invoker`: чтение выполняется с правами владельца `postgres`, то есть RLS базовой `payment_links` обходится.

## 4. Потребители, которым нужен прямой SELECT на представление

- Прямых обращений `.from('payment_links_enriched_v')` в `src/` и `supabase/functions/` — **нет** (`rg` дал 0 совпадений).
- Единственный фронтенд-путь: `src/hooks/usePaymentLinks.ts` → `supabase.rpc("get_admin_payment_links_v1", …)` (полная загрузка и delta-загрузка).
- Прочие упоминания представления — только миграции, контрактный тест `src/test/salesManagerCreationUi.contract.test.ts` и сгенерированные `types.ts`.
- Внутри БД представление читает `get_admin_payment_links_v1` (SECURITY DEFINER, выполняется от владельца — прямой грант ролям для этого не требуется).

Вывод по evidence: прямой SELECT для `authenticated` больше не требуется ни одним потребителем.

## 5. `get_admin_payment_links_v1`

- Владелец: `postgres`; `prosecdef = true`; `proconfig = search_path=public`.
- `proacl`: `postgres=X`, `authenticated=X`, `service_role=X`, `sandbox_exec_hdjg…=X`. Для `anon` и PUBLIC EXECUTE отозван (`REVOKE ALL … FROM PUBLIC, anon` в `20260827153330`).
- Внутренняя авторизация: `IF NOT public.has_admin_section_access(auth.uid(), 'payments', 'view') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'` — fail-closed до любого чтения. Возвращает `SETOF public.payment_links_enriched_v` с фильтром по `p_since` и лимитом.

## 6. Корректирующий SQL по принципу минимальных привилегий

Предложенный кандидат оценивается так:

```sql
ALTER VIEW public.payment_links_enriched_v SET (security_invoker = true);
REVOKE ALL ON public.payment_links_enriched_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_links_enriched_v TO authenticated;
```

- Поведение UI/RPC сохраняет: единственный потребитель — SECURITY DEFINER RPC, который читает представление от владельца и не зависит от грантов ролей.
- Права `anon` и все write-привилегии убирает — да.
- Но третья строка избыточна: прямых клиентских SELECT нет.

Рекомендуемый минимальный вариант (без прямого гранта):

```sql
ALTER VIEW public.payment_links_enriched_v SET (security_invoker = true);
REVOKE ALL ON public.payment_links_enriched_v FROM PUBLIC, anon, authenticated;
```

`service_role` при необходимости оставить с `SELECT` (сузив с ALL). Оба варианта закрывают критическую находку; рекомендуемый строже. Отмечу, что checked-in миграция `20260830130000` содержит только `ALTER VIEW … security_invoker`, то есть без расширения её SQL широкие гранты `anon` останутся — а это и есть критическая часть.

## Итог и статус execute

- Гейты 1–3 по SHA `9dffb20df`: **PASS**
- Готовность к execute: **STOP**. Две причины:
  1. **Критическая ACL-находка не покрывается pending-миграцией.** Требуется решение: либо расширить корректирующую миграцию в GitHub до REVOKE-варианта, либо принять `20260830130000` как есть и завести отдельную миграцию на гранты.
  2. **BLOCKER по способу применения.** Lovable применяет SQL только через платформенный инструмент миграций, который сам создаёт файл с собственным timestamp/UUID и сопутствующий коммит — именно так появились `20260830124428 / 124544 / 124721`. Применить checked-in файл без платформенной копии и авто-коммита технически невозможно. Варианты: (A) разрешить копию и авто-коммит как ожидаемое отклонение; (B) применить SQL вне Lovable, оставив здесь только деплой пяти функций и non-side-effectful пробы; (C) выполнить только деплой функций, отложив миграцию.
- Деплой пяти функций (`admin-create-payment-link`, `admin-create-public-link`, `admin-invoice-checkout-issue`, `public-checkout`, `public-rr-installment-initiate`) блокером не является; файлы и `_shared/sales-manager-attribution.ts` присутствуют в дереве.

READ-ONLY: NO CHANGES.
