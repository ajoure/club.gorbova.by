# План: свежий Stripe-чек по клику (payment-receipt-resolve)

PLAN-ONLY. Ни одного изменения не сделано: без кода, миграций, DML/DDL, deploy, sync, Publish, provider-writes и уведомлений. Ниже — только результаты read-only проверки Lovable Cloud и план патча.

## CURRENT STATE

**Данные (read-only SQL).**
- `payments_v2`: stripe — 7 записей, из них 5 с сохранённым `receipt_url` (последние оплаты 10.06–11.08.2026). bePaid — 1455 с `receipt_url` (их поведение не меняем).
- Все stripe-платежи, кроме одного legacy без метаданных, имеют точные `meta.stripe.charge_id` (`ch_…`) и `payment_intent_id` (`pi_…`), `meta.stripe.account_code='stripe_poland'`.
- `meta.stripe.livemode` — **NULL во всех строках**; `acquiring_connections` содержит одну активную запись `stripe / stripe_poland / test_mode=false / status=active / is_default=true`.

**Код.**
- Защищённый резолвер `admin-payment-documents-resolve` существует и **развёрнут** (OPTIONS → 200). RBAC: VIEW = `super_admin|admin|accountant`, REFRESH = `super_admin|admin`, диагностика = `super_admin`. Он умеет exact retrieve `payment_intents/charges/invoices/refunds/credit_notes` через account+mode-aware vault, без list/search, без записей в платежи/заказы.
- Функции `payment-receipt-resolve` нет (404).
- Фронт открывает **сохранённый** URL напрямую в 6 местах: `src/pages/Purchases.tsx` (661), `src/components/purchases/OrderListItem.tsx`, `src/components/purchases/SubscriptionDetailSheet.tsx` (349), `src/components/admin/DealDetailSheet.tsx` (1153–1155), `src/pages/admin/AdminOrdersV2.tsx` (485–490), реестр платежей через `src/hooks/useUnifiedPayments.tsx` (398–441, `document_url`). Именно эти ссылки протухают у Stripe (~30 дней → «Receipt URL Expired»).
- Клиентский слой резолвера уже есть: `src/hooks/usePaymentDocuments.ts`, `src/types/paymentDocuments.ts`, дровер в `PaymentsTable.tsx` (только админ-реестр).

## RISKS

1. **Mode not resolved.** `livemode` пуст, поэтому `normalizeStripeMode` вернёт `STRIPE_MODE_NOT_RESOLVED` и refresh упадёт для всех текущих stripe-платежей. Без учёта этого фича не заработает в проде.
2. **Расширение резолвера на владельца** ослабляет текущий admin-only контракт, если ownership-проверка и capability-матрица не разведены явно.
3. **Соблазн fallback'а** на сохранённый URL при ошибке провайдера — приведёт к повторению инцидента; запрещено.
4. **Popup-blocker**: асинхронный retrieve перед `window.open` теряет user-gesture.
5. bePaid-чеки не должны затрагиваться; их URL долговечны.
6. Резолвер не должен ничего писать (кроме уже существующего audit при refresh).

## RECOMMENDED DESIGN

**1) Отдельная функция `payment-receipt-resolve`** (а не расширение админского резолвера).
Аргументация: `admin-payment-documents-resolve` — «толстый» админ-контракт (внутренние документы, signed storage URLs, generation-статусы, diagnostics). Открывать его клиенту небезопасно и требует переписывать матрицу возможностей. Новая функция переиспользует shared-модули `_shared/payments/documents/stripe-client-factory.ts` и `stripe-documents.ts` без дублирования Stripe-логики.

Контракт:
- `verify_jwt = true`, вход `{ payment_id: uuid }`, выход `{ payment_id, provider, receipt: { url, source: 'provider_fresh'|'local_bepaid', expires_hint } | null, error_code? }`.
- Авторизация: VIEW-роли (`super_admin|admin|accountant`) через `has_role_v2`, **или** владелец — `orders_v2.user_id = auth.uid()` по `payments_v2.order_id` (для refund — через `meta.parent_payment_id`). Иначе 403 без деталей.
- Stripe: на каждый клик exact retrieve `charges/{ch_…}`; если `charge_id` нет — `payment_intents/{pi_…}` → `latest_charge` → retrieve charge. Только whitelisted поле `receipt_url`. **Никакого list/search.**
- **Mode/account:** account_code из `meta.stripe.account_code`; при отсутствующем `livemode` — детерминированный fallback на `acquiring_connections.test_mode` для этого `account_code` (одна активная запись). Без live↔test перебора; при конфликте — ошибка.
- При любой неудаче (`STRIPE_*`, timeout, network, пустой `receipt_url`) вернуть `receipt=null` + machine-code. **Сохранённый Stripe URL не возвращается никогда.**
- bePaid: сохранённый `receipt_url` возвращается как есть (`local_bepaid`), провайдер не вызывается.
- Ноль записей в `payments_v2/orders_v2/subscriptions_v2/entitlements`; опционально одна audit-строка без PII.

**2) Фронт.** Новый хук `useFreshReceipt()` + общий компонент кнопки `ReceiptLinkButton`:
- popup-safe: `const w = window.open('', '_blank')` синхронно по клику → после ответа `w.location = url`, при ошибке `w.close()` и toast с локализованным кодом;
- для Stripe UI больше не рендерит `href={receipt_url}`, а вызывает резолвер;
- для bePaid поведение не меняется.
Точки подключения: `DealDetailSheet.tsx`, реестр платежей (`useUnifiedPayments`/`PaymentsTable`), `AdminOrdersV2.tsx`, `Purchases.tsx`, `OrderListItem.tsx`, `SubscriptionDetailSheet.tsx`.

**3) Тесты** (vitest + deno-тесты рядом с существующими):
- RBAC: аноним → 401; чужой пользователь → 403; владелец → 200; accountant → 200.
- Ownership по refund через parent payment.
- Stale replacement: сохранённый Stripe URL в БД ≠ возвращаемому; при успехе возвращается только свежий.
- Provider failure: 4xx/5xx/timeout/пустой receipt → `receipt=null`, старый URL не отдаётся.
- Guard «no list/search»: счётчик exact retrieve, отсутствие вызовов list.
- Popup: клик открывает окно синхронно; при ошибке окно закрывается.

## EXACT DEPLOY LIST (после merge, managed)

1. Sync проекта строго на merge-SHA PR.
2. Миграций **нет** (RBAC-хелперы и таблицы существуют). Если решите добавить audit-action — это данные, не схема.
3. Deploy Edge Functions: `payment-receipt-resolve` (новая). `admin-payment-documents-resolve` — только если общий shared-модуль менялся.
4. Добавить `payment-receipt-resolve` в `supabase/functions.registry.txt` (в PR, не в проде).
5. Publish frontend с того же SHA.

## VERIFICATION (read-back)

- `OPTIONS /functions/v1/payment-receipt-resolve` → 200.
- Как admin: вызов по `e0c1f0ed-…` (stripe, 11.08) → `source='provider_fresh'`, URL ≠ значения `payments_v2.receipt_url`.
- Как владелец: свой платёж → 200; чужой → 403; без JWT → 401.
- Старый stripe-платёж 10.06 → либо свежий URL, либо `receipt=null` с кодом; **никогда** просроченный сохранённый.
- bePaid-платёж → прежний чек открывается как раньше.
- SQL read-back: `payments_v2/orders_v2/entitlements` — 0 изменений (`updated_at` неизменны).
- UI-пруф после Publish: desktop 1440 и mobile 390 для сделки, реестра платежей, `/admin/orders` и клиентских «Мои покупки».

## STOP GATES

- Любой ответ, содержащий сохранённый Stripe URL при ошибке провайдера → стоп.
- Обнаружен list/search-вызов Stripe → стоп.
- Ненулевой rowcount по write в платёжные/заказные/доступные таблицы → стоп, rollback.
- 403 для владельца или 200 для чужого пользователя → стоп.
- `STRIPE_MODE_NOT_RESOLVED` на боевом платеже после фикса mode-fallback → стоп, не публиковать.
- Расхождение синхронизированного SHA с merge-SHA → стоп.
