# План: повторный инцидент оплаты 22.09.2026 ~12:02 UTC (BUSINESS 250 BYN)

Режим: READ-ONLY. Ничего не изменено, не задеплоено, не опубликовано; checkout и платежи не создавались, сообщения не отправлялись.
Источник истины: origin/main = HEAD = `86cd71d0cd4baefdd076043954613b36904dee15`, дерево чистое.

## 1. Доказательства

**Edge Function logs за 11:58–12:06 UTC — недоступны (UNKNOWN).** Фактическое окно хранения аналитики: все источники (`function_logs`, `edge_logs`, `function_edge_logs`, `postgres_logs`) содержат записи только с 13:04:58 по 13:14:45 UTC (~10 минут). Поэтому `incident_id`, `request_started` и `unexpected_error` за окно инцидента физически не восстановимы. Это ограничение ретенции, а не отсутствие логирования: код `request_started`/`unexpected_error` с `incident_id` и `stage` присутствует в задеплоенной версии (строки 66–70, 918–928).

**Коммерческие дельты = 0 (confirmed).** С 11:40 UTC: orders_v2 0, payments_v2 0, subscriptions_v2 0, provider_subscriptions 0, crm_checkout_discount_intents 0. Последняя запись `crm_checkout_attempts` — 11:24:06 (state `ready`, вчерашний обходной путь); за окно инцидента attempt не создавался. Provider checkout по инциденту не возникал, списаний нет.

**Единственные audit-следы в окне (confirmed):** две записи `bepaid.subscription.create_blocked`, `reason: missing_explicit_user_choice`, 12:09:01.755 и 12:09:02.197 UTC — это отдельный класс (403 `MISSING_EXPLICIT_CHOICE`, product_id в meta отсутствует), он не даёт текста «Не удалось открыть страницу оплаты».

**Стадия отказа (confirmed по исключению):** наблюдаемый пользователю текст в `src/utils/normalizeEdgeFunctionError.ts` (строки 145–150) возвращается только для `internal server error` / `subscription_checkout_internal_error`, то есть функция дошла до финального catch и вернула `SUBSCRIPTION_CHECKOUT_INTERNAL_ERROR`. При этом ни одной новой строки не создано, значит отказ произошёл **до** `purchase_claim`. Из стадий до claim только `pending_checkout_lookup` бросает необработанные исключения; `offer_resolve` возвращает контролируемые 400, `classifySameProductState` — контролируемый 200-конфликт.

**Найден конкретный триггер (hypothesis, высокая уверенность):** `provider_subscriptions` id `021baade…`, `sbs_f04c8a…`, state `pending`, user `a1830fb9…`, order `7fbb2654…` (BUSINESS 250 BYN, `pending`, 0 платежей), subscription `835a5f58…` в статусе `past_due`. `reusePendingSubscriptionCheckout` (`supabase/functions/_shared/pending-subscription-checkout.ts`) для такого сочетания обращается к bePaid и при не-переиспользуемом состоянии бросает `pending_checkout_payment_requires_reconciliation`, а при отсутствии совпадения — `existing_provider_subscription_requires_reconciliation`. Оба throw не обработаны в вызывающей функции и попадают в финальный catch → 500 `SUBSCRIPTION_CHECKOUT_INTERNAL_ERROR`. Повторные нажатия дают тот же 500 идемпотентно: побочных строк не создаётся.

**Точный `error_name`/`error_message` конкретного вызова — UNKNOWN** (логи ушли). Подтверждение возможно только после патча наблюдаемости или non-charge проверки состояния подписки у провайдера.

## 2. Корневая причина

Класс ошибок «требуется ручная сверка незавершённого checkout» из shared-хелпера не имеет контролируемого кода ответа: он маскируется под внутреннюю ошибку 500 и не оставляет следа в БД. Плюс десятиминутная ретенция логов делает инцидент недиагностируемым постфактум.

## 3. Минимальный GitHub-first патч

Файлы:
- `supabase/functions/_shared/pending-subscription-checkout.ts` — бросать типизированную ошибку с полем `code` (существующие строки становятся кодами; поведение не меняется).
- `supabase/functions/bepaid-create-subscription-checkout/index.ts` — обернуть стадию `pending_checkout_lookup`: reconciliation-класс возвращать как HTTP 409 JSON `{ ok:false, code:'CHECKOUT_RECONCILIATION_REQUIRED', stage, incident_id }`; во всех неуспешных выходах писать строку `crm_checkout_attempts` со `state='failed'` и `result={code,stage,incident_id}` (без PII), чтобы инциденты переживали ретенцию логов.
- `src/utils/normalizeEdgeFunctionError.ts` — понятное сообщение для `CHECKOUT_RECONCILIATION_REQUIRED` («незавершённая оплата, обратитесь в поддержку, код обращения»), без сырых кодов провайдера.
- `src/test/paymentCheckoutIncidentContract.test.ts` — расширить контракт.
- Новый `tests/edge/pendingSubscriptionCheckoutReconciliation.test.ts` — reconciliation-throw → 409 + attempt-строка, повтор идемпотентен.

Миграции: **не нужны**. Deploy: только `bepaid-create-subscription-checkout`. Publish: фронтенд (из-за сообщения в normalizeEdgeFunctionError).

## 4. Безопасный runtime acceptance (без списания)

1. OPTIONS → 200; неавторизованный/пустой body → контролируемый JSON, не «Internal server error».
2. Воспроизведение сценария пользователя `a1830fb9…` **не платежом**, а non-charge provider validation: read-only GET состояния `sbs_f04c8a…` через `bepaid-get-subscription-details` — подтверждает фактическое состояние и стадию без создания checkout и без денег.
3. Повторный вызов той же публичной страницы после патча должен вернуть 409 с кодом и создать ровно одну `crm_checkout_attempts(state='failed')`; повтор — без новых orders/payments/subscriptions/provider rows.
4. Read-back дельт: orders_v2/payments_v2/subscriptions_v2/provider_subscriptions = 0.
5. Реальный тестовый checkout с последующей отменой **не предлагается**: у bePaid provider-managed subscription создание checkout порождает mandate-строку и не отменяется штатно без риска — используем non-charge validation из п.2.

## 5. Отдельный хвост

Две записи `missing_explicit_user_choice` (12:09 UTC) — отдельный вопрос вызывающей стороны, к тексту инцидента отношения не имеет; вынести в follow-up.
