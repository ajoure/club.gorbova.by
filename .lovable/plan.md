# да, согласен, с учетом правок:

## **1. HOTFIX-1 нужно сузить до реальной задачи**

Убрать из плана любые упоминания:

```text
RUB / KZT / UAH
```

В проекте для Stripe-ссылок сейчас используются только:

```text
BYN / USD / EUR / PLN
```

Никакие другие валюты в этом спринте не добавлять, не обсуждать, не валидировать и не включать в whitelist.

---

## **2. HOTFIX-1 — правильная бизнес-логика**

Формулировку зафиксировать так:

```md
Источник суммы и валюты по умолчанию — выбранная кнопка / offer.

Если offer = 250 BYN, то Stripe-ссылка по умолчанию создаётся на 250 BYN.
Если offer = 250 USD, то Stripe-ссылка по умолчанию создаётся на 250 USD.
Если offer = 250 EUR, то Stripe-ссылка по умолчанию создаётся на 250 EUR.
Если offer = 250 PLN, то Stripe-ссылка по умолчанию создаётся на 250 PLN.

Администратор может вручную изменить Stripe-валюту в модалке создания ссылки. В этом случае используется выбранная администратором валюта.

Сумму не пересчитывать. Currency conversion / FX rates не делать.
```

---

## **3. HOTFIX-1 — исправить frontend**

В `AdminPaymentLinkDialog.tsx`:

```md
- Убрать hardcoded default `useState<string>("EUR")`.
- Default `stripeCurrency` должен браться из выбранного offer:
  `offer.currency || offer.meta?.currency || 'BYN'`.
- При смене offer / тарифа пересчитывать default currency из нового offer.
- Если админ уже вручную изменил Stripe currency — не перетирать его выбор автоматом.
- Селектор Stripe currency оставить.
```

---

## **4. HOTFIX-1 — исправить backend fallback**

В `admin-provision-stripe-price`:

```md
Если в `tariff_prices` нет активной строки, использовать fallback:
`offer.amount + requested_currency`.

`requested_currency` приходит из `admin-create-public-link` как `stripe_currency`.

Нельзя использовать EUR как fallback.
Нельзя требовать ручную строку в `tariff_prices` для каждого тарифа.
```

Whitelist в рамках hotfix:

```ts
['BYN', 'USD', 'EUR', 'PLN']
```

---

## **5. HOTFIX-1 — убрать спорную формулировку про “если поддерживается аккаунтом”**

Не надо снова возвращаться к обсуждению, «поддерживает ли Stripe BYN». Это уже проверялось в Phase 7.

Оставить проще:

```md
Stripe-ссылки создаются только в четырёх разрешённых валютах проекта: BYN, USD, EUR, PLN.
Если backend resolver по какой-то причине отклонит валюту — это отдельный controlled error, но hotfix не должен подставлять EUR вместо валюты offer.
```

---

## **6. HOTFIX-1 — acceptance переписать**

```md
Acceptance Hotfix-1:

- Offer 250 BYN → Stripe-ссылка по умолчанию 250 BYN.
- Offer 250 USD → Stripe-ссылка по умолчанию 250 USD.
- Offer 250 EUR → Stripe-ссылка по умолчанию 250 EUR.
- Offer 250 PLN → Stripe-ссылка по умолчанию 250 PLN.
- Админ вручную меняет Stripe currency на BYN/USD/EUR/PLN → ссылка создаётся в выбранной валюте.
- EUR больше не подставляется автоматически без причины.
- bePaid-ссылки не затронуты.
- Currency conversion не выполняется.
```

---

## **7. HOTFIX-2 — принять, но с ограничением**

Hotfix-2 по bePaid 404 логически корректный, но добавить ограничение:

```md
404 от bePaid трактуется как success только в replacement/cancel flow, где цель — заменить старую подписку.

Это не глобальное правило для всех bePaid 404.

Если bePaid отвечает 500 / auth error / timeout / unknown error — replacement по-прежнему блокируется.
```

Response должен содержать:

```md
remote_missing: true
reason_code: provider_subscription_not_found_treated_as_canceled
```

---

## **8. Phase 8 — не начинать весь объём сразу**

План слишком большой для одного approve. Правильная последовательность:

```md
1. Hotfix-1 → proof → отчет.
2. Hotfix-2 → proof → отчет.
3. Phase 8-A Discovery only → отчет.
4. После отдельного approve по результатам Discovery — решаем:
   - новая таблица payment_documents или reuse existing;
   - нужна ли миграция;
   - нужен ли backfill dry-run edge;
   - где именно показывать document block в UI.
```

То есть сейчас approve только на:

```text
Hotfix-1 + Hotfix-2 + Phase 8-A Discovery
```

Phase 8-B…F пока не выполнять.

---

## **9. Phase 8 — исправить GRANT**

Если после discovery будет новая таблица `payment_documents`, убрать:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_documents TO authenticated;
```

Заменить на:

```sql
GRANT SELECT ON public.payment_documents TO authenticated;
GRANT INSERT, UPDATE ON public.payment_documents TO authenticated;
GRANT ALL ON public.payment_documents TO service_role;
```

DELETE не выдавать. Удаление/архивация документов — отдельная admin-only процедура после dependency audit.

---

## **10. Phase 8 — storage не трогать**

Добавить:

```md
В Phase 8 MVP не копировать Stripe/bePaid документы в storage.

Использовать provider-native external_url:
- Stripe receipt_url / hosted_invoice_url / invoice_pdf;
- bePaid receipt URL, если есть.

Storage copy / PDF snapshot / retention policy — отдельная будущая фаза.
```

---

## **11. Backfill dry-run function — только после discovery**

Не создавать сразу:

```text
admin-payment-documents-backfill-dryrun
```

Добавить:

```md
Новый Edge Function для backfill dry-run создавать только после Phase 8-A Discovery и отдельного approve.

Если dry-run можно сделать SQL/report-only — предпочесть report-only.
```

---

## **12. Итоговый ответ Lovable**

```md
План в целом принят, но выполнять можно только с правками:

1. Hotfix-1:
   - убрать RUB/KZT/UAH;
   - использовать только BYN/USD/EUR/PLN;
   - Stripe currency default = currency выбранного offer, а не EUR;
   - если админ вручную меняет Stripe currency — использовать ручной выбор;
   - сумма берётся из offer.amount;
   - если tariff_prices отсутствует — fallback на offer.amount + requested_currency;
   - currency conversion не делать;
   - bePaid не трогать.

2. Hotfix-2:
   - bePaid 404 трактовать как success только в replacement/cancel flow;
   - 500/timeout/auth/unknown errors по-прежнему блокируют replacement;
   - response должен содержать remote_missing + reason_code;
   - audit обязателен.

3. Phase 8:
   - сейчас выполнять только Phase 8-A Discovery;
   - Phase 8-B…F не начинать без отдельного approve после discovery;
   - новую таблицу / миграции / backfill edge не создавать до отдельного решения;
   - DELETE grant для payment_documents не выдавать;
   - storage copy не делать;
   - ЭСЧФ / налоговые документы / PDF generator не добавлять.

Порядок:
1. Hotfix-1 → proof → отчет.
2. Hotfix-2 → proof → отчет.
3. Phase 8-A Discovery → отчет.
4. Ждать approve на дальнейшую модель Phase 8.

После этих правок можно приступать к Hotfix-1.

План: Phase 8 — Receipts / Documents (+ 2 связанных hotfix)
```

Phase 7 закрываю как PASS. Phase 8 идёт в полном объёме по твоему ТЗ, плюс два **hotfix-а**, которые ты явно потребовал внести в этот же план (тарифная валюта на Stripe и 404 при отмене подписки на скрине).

Ниже — единая последовательность. Порядок строгий: **сначала Hotfix-1 + Hotfix-2** (короткие, разблокируют тебя в проде уже сейчас), потом полный **Phase 8** по твоему скелету (Discovery → Spec → Provider mapping → UI → Backfill dry-run → Audit → Proof → Gates → DoD).

Все артефакты — только на русском. DIAGNOSE → PLAN → DRY RUN → EXECUTE → VERIFY. Runtime freeze: webhook / grant-access / Telegram / subscriptions-reconcile / bePaid receipts не трогать.

---

## HOTFIX-1 — «Валюта Stripe = валюта тарифа, а не EUR по умолчанию»

### Root cause (по твоему описанию + код)

- `tariff_offers.meta.currency = 'BYN'`, `amount = 250.00` — это **единственный SOT суммы**, что у нас есть в админке.
- `admin-provision-stripe-price` читает сумму/валюту **только** из `tariff_prices` (строгий inline-контракт «SOT only tariff_prices»). В реальности `tariff_prices` заполнено только для 5 тарифов (все BYN). Для остальных 99% тарифов Stripe-ссылку создать **нельзя в принципе**, не вводя руками EUR-цену.
- В UI `AdminPaymentLinkDialog.tsx:199`: `useState<string>("EUR")` — Stripe-валюта по умолчанию EUR, без всякой связи с офером.

То, что ты описал словами: «если кнопка в BYN — пусть будет BYN; если админ явно меняет валюту — берём ту, что выбрали; никаких фиксированных EUR-эквивалентов».

### Решение (минимальное, без архитектурного переписывания)

**A. UI mirror (frontend, `AdminPaymentLinkDialog.tsx`):**

- Default `stripeCurrency` = `offer.meta.currency ?? 'BYN'`, не `EUR`.
- При смене оффера / тарифа / payment_type — пересчитать default из текущего offer-meta.
- Селектор Stripe-валюты **остаётся** (админ может вручную поменять под Stripe-аккаунт), но дефолт идёт от кнопки/оффера. Поведение `customer_choice` и `fixed bepaid` не меняется.

**B. Backend SOT-расширение (`admin-provision-stripe-price/index.ts`, lines 191–200):**

- Если в `tariff_prices` нет активной строки для тарифа — **fallback на `offer.amount` + `requested_currency**` (валюта берётся из тела запроса `admin-create-public-link`, который уже передаёт `stripe_currency`). Контракт-комментарий обновляю явно: «SOT = `tariff_prices` row; fallback = `offer.amount` + request currency, если активной price-строки нет».
- `CURRENCY_WHITELIST` (BYN/USD/EUR/PLN/RUB/KZT/UAH) сохраняется.
- Все остальные guard-ы (`offer_inactive`, `currency_not_whitelisted`, `billing_period_*`, foreign mapping cross-check, idempotency by `meta.stripe.price_id`) — без изменений.
- Audit `stripe_provision_offer_amount_fallback` с полями `{ tariff_id, offer_id, currency, amount, source: 'offer_meta' }`.

**C. Reconcile с CurrencyProviderResolver (Phase 7):**

- Если выбранная Stripe-валюта не входит в `acquiring_connections.capabilities_snapshot.supported_currencies` — UI уже блокирует с понятной причиной (Phase 7-UI). Ничего не меняется.
- `admin-create-public-link` уже валидирует currency через shared resolver — повторно не валидируем.

### Артефакты Hotfix-1

- `.lovable/proofs/hotfix_stripe_currency_v1.md` — root cause, before/after, скрин «BYN-тариф → Stripe-ссылка в BYN PASS», `git diff --name-only`, audit-row, freeze.
- Изменения: `src/components/admin/AdminPaymentLinkDialog.tsx` (default state), `supabase/functions/admin-provision-stripe-price/index.ts` (fallback + audit), inline-контракт-комментарий (lines 12–14).

### Acceptance Hotfix-1

- Тариф «Бухгалтерия как бизнес → Стандартный» (250 BYN, без `tariff_prices`) — Stripe-ссылка создаётся в BYN без ошибок и без ручного создания `tariff_prices` строки.
- Тариф с EUR-кнопкой → Stripe-ссылка создаётся в EUR.
- Админ меняет валюту вручную на USD/PLN → ссылка идёт в USD/PLN (если поддерживается аккаунтом).
- bePaid-ссылки не затронуты.

---

## HOTFIX-2 — «Провайдер не смог отменить подписку: 404 subscription not found in bePaid»

### Root cause

- `/pay/:token` → «Заменить подписку» → `cancelOldSubscriptionForReplacement` → `bepaid-cancel-subscriptions`.
- bePaid отвечает 404, а локально `subscriptions_v2.state='active'` → код возвращает `failed[].error = '404: subscription not found in bePaid'` (line 213 в edge).
- `subscriptionReplacement.ts` бросает исключение → новый платёж не создаётся, юзер видит красный alert на скрине.

Логически 404 от bePaid означает «подписки на провайдере уже нет» — это **не блокирует** локальную замену. Сейчас же мы корректно идём `local_only_no_provider_subscription` только если `provider_subscription_id IS NULL` — а здесь id есть, но он мёртвый.

### Решение

**A. Edge `bepaid-cancel-subscriptions` (lines 202–218):**

- 404 + `localSub.state` ∈ active/pending/past_due → **treat as success** + audit `bepaid_cancel_remote_missing_treated_as_canceled` с meta `{ subscription_v2_id, local_state, provider_subscription_id }`.
- `shouldMarkCanceled = true`, в response — `succeeded.push(subId)` плюс отдельный список `remote_missing` для диагностики.

**B. Client `subscriptionReplacement.ts` (страховка):**

- Если всё-таки `failed[].reason_code === 'not_found'` — не throw-им, продолжаем `superseded` + новый платёж. Audit на клиенте уже пишется (`replacement_mode='provider_managed_remote_missing'`).

### Артефакты Hotfix-2

- `.lovable/proofs/hotfix_bepaid_cancel_404_v1.md` — root cause, fixture (`a60cd9aa-…`), before/after edge response, audit-row, скрин «replace проходит без ошибки», freeze.
- Memory: дополнить `mem://commercial-logic/subscriptions/safe-replacement-flow` пунктом «remote_missing = treat as canceled, не блокирует replace».
- Изменения: `supabase/functions/bepaid-cancel-subscriptions/index.ts` + `src/lib/subscriptionReplacement.ts`.

### Acceptance Hotfix-2

- На скрине пользователя нажатие «Заменить подписку» проходит без красного alert; новая подписка создаётся; старая → `superseded`; audit виден.
- Если bePaid отвечает 500/past_due — поведение не меняется (по-прежнему блокируем replace).

---

## PHASE 8 — Receipts / Documents (полный объём по твоему ТЗ)

### 8-A. Discovery (read-only)

Без кода, без миграций. Артефакт:

`**.lovable/discovery/phase_8_receipts_documents_inventory_v1.md**` — содержит:

1. Таблицы: `payments_v2`, `orders_v2`, `provider_events`, `payment_links`, `subscriptions_v2`, `generated_documents`, `ai_generated_documents`, `document_templates`, `document_package_*`, `audit_logs`, storage buckets (`documents`, public). Для каждой — заполнены ли relevant-поля (receipt_url, document_url, file_path, …).
2. Текущие edge functions, релевантные документам:
  - `canonical-document-generate-strict`, `canonical-template-*`, `ai-generate-corporate-package` — bookkeeping/корпоративные пакеты (не receipts).
  - `bepaid-webhook`, `bepaid-receipts-cron` — где сейчас лежит чек bePaid.
  - Stripe: где читается `charge.receipt_url`, `invoice.hosted_invoice_url`, `invoice.invoice_pdf` (сейчас, по факту, **нигде** — Phase 8 это закрывает).
3. UI-точки: `AdminPaymentsHub`, `payments/PaymentDetailsDialog` (или эквивалент), `Purchases.tsx`, public success-page, email/Telegram-шаблоны.
4. Hardcode bePaid в receipt-логике (полный список).
5. Что **нельзя** трогать: ЭСЧФ-pipeline (его нет — и не добавляем), `canonical-document-generate-strict`, Gotenberg, `document_package_*`.
6. Рекомендованная минимальная модель Phase 8 (см. 8-B).

DoD discovery: документ закрывает все 4 раздела твоего пункта 4. STOP-guard'ы по твоему пункту 10 явно выписаны.

### 8-B. Canonical document model spec (без миграции, если discovery подтвердит существующую модель)

По умолчанию закладываюсь на **новую таблицу `payment_documents**` (поля строго по твоему пункту 5), но если discovery найдёт уже подходящую таблицу — расширяю её и spec фиксирует «no new table». Решение принимается **после** 8-A и фиксируется в proof.

Если новая таблица создаётся — миграция включает:

- `CREATE TABLE public.payment_documents (…)` + индексы (payment_id, order_id, provider_event_id, document_type+status).
- `GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_documents TO authenticated;`
- `GRANT ALL ON public.payment_documents TO service_role;`
- `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` + policies (super_admin read/write, обычный пользователь — read только своих, через join с `payments_v2.user_id`).
- Триггер `updated_at`.

### 8-C. Provider mapping

**bePaid** (read-only ingest):

- Resolver `_shared/documents/bepaid-receipt-resolver.ts`: пытается достать `receipt_url` из `provider_events.payload` (`payment.captured`, `payment.successful`); если нет — fallback на `bepaid-receipts-cron` historical data; если нет — `document_status='not_supported'`. Никакого нового PDF generator-а.

**Stripe** (read-only ingest из provider-native):

- One-time → `charge.receipt_url` (из `provider_events` `charge.succeeded` / `payment_intent.succeeded`).
- Subscription → `invoice.hosted_invoice_url` + `invoice.invoice_pdf` (из `invoice.paid`).
- Resolver `_shared/documents/stripe-receipt-resolver.ts`.
- Не копируем в наш storage (по твоему правилу «storage copy только при approved policy» — её нет → не копируем).

### 8-D. Admin UI

- `AdminPaymentDetailsDialog`: новый блок «Документ» — provider, document_type, document_status, кнопка «Открыть» (target=_blank на `external_url`).
- Статусы: «Документ ещё не получен» (pending), «Открыть» (available), «Провайдер не вернул документ» (failed), «Документ недоступен для этого типа платежа» (not_supported).
- Не показываем raw provider payload / external ids рядовому админу — только в expandable «Технические детали».

### 8-E. Backfill / reconciliation (dry-run only)

- Edge `admin-payment-documents-backfill-dryrun` (super_admin only): сканирует `payments_v2` + `provider_events`, агрегирует по 5 buckets: bePaid с receipt / bePaid без / Stripe с receipt / Stripe без / ambiguous.
- Результат пишется в `audit_logs` (action `payment_document.backfill_dryrun_completed`) и возвращается в админ-UI.
- **Execute backfill** — отдельной фазой, после твоего ручного approve и review dry-run-отчёта. В этом плане execute **не делаем**.

### 8-F. Audit

Все события из твоего пункта 9 пишутся в `audit_logs` с обязательными полями `actor_type / actor_user_id / actor_label / payment_id / order_id / provider / document_type / status`.

### 8-G. Proof

`**.lovable/proofs/phase_8_receipts_documents_v1.md**` — содержит ровно то, что в твоём пункте 12: discovery inventory link, diff summary, миграция (если была), dry-run result, 4 UI-скрина (bePaid с документом / Stripe с документом / без документа / unsupported), SQL proof из `payment_documents`, audit-logs proof, runtime freeze confirmation.

### 8-H. Gates (твоя таблица P8-1 … P8-10 без изменений)

Все 10 гейтов закрываются артефактами выше. P8-10 (runtime freeze) — отдельная секция в proof с git-diff по `bepaid-webhook` / `stripe-webhook` / `grant-access-for-order` / `telegram-*` / `subscriptions-reconcile` (должен быть пустой).

### 8-I. DoD

- Документы provider-aware (bePaid + Stripe в единой модели).
- Админ видит статус и может открыть доступный документ.
- Отсутствующий документ → понятный статус, не «error».
- Нет регрессии bePaid (`bepaid-receipts-cron` работает как раньше).
- Нет изменений access / Telegram / subscriptions.
- Нет ЭСЧФ и налогового scope creep.
- Proof закрыт.

---

## Технические детали

**Файлы, которые будут изменены (Hotfix-1 + Hotfix-2):**

- `src/components/admin/AdminPaymentLinkDialog.tsx` — default `stripeCurrency` от оффера.
- `supabase/functions/admin-provision-stripe-price/index.ts` — fallback на `offer.amount` + request currency, обновлён inline-контракт-комментарий.
- `supabase/functions/bepaid-cancel-subscriptions/index.ts` — 404+local-active → treat as canceled.
- `src/lib/subscriptionReplacement.ts` — страховка `reason_code='not_found'` не блокирует replace.
- `.lovable/proofs/hotfix_stripe_currency_v1.md` (new)
- `.lovable/proofs/hotfix_bepaid_cancel_404_v1.md` (new)

**Файлы, которые будут изменены (Phase 8):**

- `.lovable/discovery/phase_8_receipts_documents_inventory_v1.md` (new)
- `.lovable/proofs/phase_8_receipts_documents_v1.md` (new)
- Миграция `payment_documents` (если 8-A подтвердит) + GRANT + RLS + триггер.
- `supabase/functions/_shared/documents/bepaid-receipt-resolver.ts` (new)
- `supabase/functions/_shared/documents/stripe-receipt-resolver.ts` (new)
- `supabase/functions/admin-payment-documents-backfill-dryrun/index.ts` (new, super_admin only)
- `src/components/admin/payments/PaymentDocumentBlock.tsx` (new) + интеграция в `AdminPaymentDetailsDialog`.

**НЕ трогаем:** `bepaid-webhook`, `stripe-webhook`, `grant-access-for-order`, `telegram-*`, `subscriptions-reconcile`, `bepaid-receipts-cron`, `canonical-document-generate-strict`, Gotenberg, `document_package_*`.

---

## Порядок выполнения и контрольные точки

1. **Hotfix-1** (Stripe currency mirror + offer.amount fallback) → proof → твой approve.
2. **Hotfix-2** (404 bePaid cancel) → proof → твой approve.
3. **Phase 8-A** Discovery → proof discovery → твой approve модели (новая таблица vs reuse).
4. **Phase 8-B…F** Spec + миграция + resolvers + UI + backfill **dry-run only**.
5. **Phase 8-G** Proof + Gates P8-1…P8-10.
6. **Phase 8 PASS** → backlog: реальный execute backfill отдельной фазой, никаких массовых записей сейчас.

После твоего «План принят» — приступаю к Hotfix-1.