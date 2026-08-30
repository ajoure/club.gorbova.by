# Products 2 — финальная ревизия перед корректирующим execute (PLAN-ONLY / READ-ONLY)

Изменений не вносилось: код, миграции, данные, функции и Publish не затронуты.

## Проверенный SHA

- Целевой: `9dffb20df08ad7e82dd2e14c298702a51cd79d21`
- Фактический HEAD: `9dffb20df08ad7e82dd2e14c298702a51cd79d21`
- `origin/main`: тот же SHA; рабочее дерево чистое (`git status --porcelain` пусто), WIP-коммитов нет.
- Гейт SHA: **PASS**

## Результаты трёх обязательных проверок

1. Дубликаты Lovable-миграций в дереве — **PASS (отсутствуют)**
   - `20260830124428_7d7ccbde-...sql` — ABSENT
   - `20260830124544_baba1917-...sql` — ABSENT
   - `20260830124721_c7d70b79-...sql` — ABSENT
2. `src/integrations/supabase/types.ts` — **PASS (сохранён production-вариант)**
   - Файл присутствует, 26 007 строк, `PostgrestVersion: "14.5"`, типы Products 2 (`payment_sales_attribution`, `set_deal_responsible_v1`, `set_deals_responsible_bulk_v1`, `sales_manager_report_v1`, `admin_create_deal_v2`) на месте.
3. Ровно одна pending-миграция — **PASS**
   - В `supabase/migrations/` за 2026-08-30 присутствует единственный файл `20260830130000_restore_payment_links_enriched_security_invoker.sql`.
   - Его содержимое — только комментарий и `ALTER VIEW public.payment_links_enriched_v SET (security_invoker = true);`. Иных операторов нет.
   - В истории миграций БД версии `20260830130000` нет → миграция действительно pending.

## Фактическое состояние production (read-only)

- История миграций содержит три применённые записи Products 2 под сгенерированными платформой именами: `20260830124428`, `20260830124544`, `20260830124721`. Версий `20260830083925 / 085855 / 113500` в истории нет — файлы в репозитории и записи в БД именуются по-разному, хотя SQL применён.
- `public.payment_links_enriched_v`: `reloptions = NULL` → `security_invoker` **не установлен**, представление выполняется с правами владельца `postgres`.
- ACL представления: `anon` и `authenticated` имеют полный набор прав (`arwdDxtm`). Это противоречит более ранней оценке «грантов нет» — на текущий момент представление доступно на чтение анонимной роли и выполняется с правами владельца, то есть RLS базовых таблиц обходится. Корректирующая миграция `20260830130000` устраняет именно эту часть проблемы (owner-rights), но не сужает гранты.
- Пять целевых функций и общая зависимость присутствуют в дереве: `admin-create-payment-link`, `admin-create-public-link`, `admin-invoice-checkout-issue`, `public-checkout`, `public-rr-installment-initiate`, `supabase/functions/_shared/sales-manager-attribution.ts`.

## Предлагаемый execute (строго ограниченный)

1. Повторно сверить SHA `9dffb20df`, чистое дерево, отсутствие WIP.
2. Снять baseline: `orders_v2`, `payments_v2`, `payment_links`, `entitlements`, `installment_payments`, `payment_sales_attribution`, `audit_logs`.
3. Применить единственную миграцию `20260830130000_restore_payment_links_enriched_security_invoker.sql` (один оператор `ALTER VIEW ... SET (security_invoker = true)`).
4. Read-back: запись в истории миграций, `reloptions`, владелец и ACL представления.
5. Задеплоить ровно пять перечисленных функций с checked-in зависимостями; зафиксировать версии и логи.
6. Fail-closed пробы без побочных эффектов: OPTIONS, запрос без JWT, запрос с malformed JWT → ожидается `401` / корректный CORS-ответ. Реальные платежи, ссылки, checkout, сообщения, пользователи, контакты, подписки, строки доступа и backfill не создаются.
7. Проверка инвариантов: все baseline-счётчики без прироста (кроме естественного production-трафика, который фиксируется отдельно).
8. Publish не выполняется.

## Ответ на вопрос о дубликатах при execute

Lovable применяет SQL только через платформенный инструмент миграций, который сам создаёт новый файл миграции со своим timestamp и UUID-именем и сопутствующий коммит — именно так в истории появились `20260830124428 / 124544 / 124721`. Применить checked-in файл `20260830130000` «как есть», без создания платформенной копии и коммита, технически невозможно.

**BLOCKER (условие требования «no other commits/migrations»).** Требуется одно из решений до execute:
- (A) разрешить платформенную копию миграции и авто-коммит как ожидаемое отклонение — тогда execute выполняется полностью;
- (B) применить `ALTER VIEW` вне Lovable (собственный CI/CD по GitHub), а в Lovable оставить только деплой пяти функций и read-only проверки;
- (C) выполнить в Lovable только деплой функций и пробы, отложив миграцию.

Деплой пяти Edge Functions блокером не является: он не создаёт миграций, но платформа может создать служебный коммит синхронизации.

## Итог

- Гейты 1–3 по SHA `9dffb20df`: **PASS**
- Готовность к execute: **STOP до снятия BLOCKER** по способу применения миграции (варианты A/B/C выше).
- Дополнительное наблюдение вне текущего scope: широкие гранты `anon`/`authenticated` на `payment_links_enriched_v` — отдельная задача, текущей миграцией не закрывается.

READ-ONLY: NO CHANGES.
