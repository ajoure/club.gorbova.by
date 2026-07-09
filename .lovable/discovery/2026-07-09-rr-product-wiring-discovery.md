# Отчет о выполненной работе: Discovery существующего installment/product buttons flow для РР

**Дата:** 2026-07-09
**Sprint:** 1 (discovery, read-only)
**Изменения в коде/БД:** нет.

## 1. Snapshot счётчиков БД (verify no-op)

Выполнен один раз в начале и один раз в конце discovery — совпадают:

| таблица | count |
|---|---|
| tariff_offers | 60 |
| orders_v2 | 4082 |
| payments_v2 | 6267 |
| provider_events | 35 |
| domain_events | 2134 |
| installment_payments | 0 |

## 2. Модель кнопки продукта = `public.tariff_offers`

Отдельной таблицы `product_buttons` не существует. Кнопка = строка `tariff_offers`.

Актуальные поля:
- `offer_type text` (без CHECK/enum в БД) — фактические значения: `pay_now, trial, preregistration, lead, bank_installment`.
- `payment_method text` — `full_payment, internal_installment, bank_installment`.
- `button_label, amount, currency (нет — валюта всегда BYN), is_active, is_primary, sort_order, tariff_id`.
- `installment_count, installment_interval_days, first_payment_delay_days` — параметры собственной (bepaid) рассрочки.
- `meta jsonb` — уже содержит вложенные ключи: `bank_installment.{external_link,link_label,message_html}`, `installment.{max_months}`, `recurring.{...}`, `lead_form.{...}`, `acquiring.{...}`.
- `reentry_amount` — цена повторного вступления.

Source of truth для будущего `installment-initiate` — **`tariff_offer_id`**. По нему подтягиваются `tariff_id`, `product_id` (через tariff), `amount`, `meta`.

## 3. Существующий «Заявка на рассрочку» = `offer_type='bank_installment'`

В `tariff_offers` уже 2 записи с `offer_type='bank_installment'` (тарифы `543940b1-…` и `9bc81736-…`). Текущий фронт-контур:
- `src/lib/bankInstallment.ts` — `readBankInstallmentMeta(offer)`, дефолтная ссылка захардкожена: `https://pay.rrllc.ru/katerina-gorbova-credit`.
- `src/components/lead/LeadRequestDialog.tsx` — рендерит эту ссылку в `<a target="_blank">`.
- Точки использования: `SitePageBySlug.tsx`, `TariffPricing.tsx`, `landing/UniversalPricingSection.tsx`, `landing/ProductLanding.tsx`, `landing/TariffCard.tsx`, `live/LiveEventProductCta.tsx`.

Никакого createOrder / webhook / записи в `orders_v2` в этом flow сейчас нет — просто внешняя ссылка.

**Решено по правкам:** название `bank_installment` в БД сохраняем, старый URL-контур оставляем как fallback до отдельного cleanup. В UI редактора отображаем как «Рассрочка банка».

## 4. Редактор кнопки — `src/pages/admin/AdminProductDetailV2.tsx`

Модалка «Редактировать кнопку» / «Новая кнопка оплаты» (строки 1795–2010). Селект «Тип кнопки» показывает 5 значений:
- `pay_now` → «Оплата (полная стоимость)»
- `trial` → «Trial (пробный период)»
- `preregistration` → «Предзапись (привязка карты)»
- `installment` (виртуальный ключ = `pay_now + payment_method='internal_installment'`) → «Рассрочка» (собственная, bepaid)
- `lead` → «Заявка (без оплаты)»

**`bank_installment` в UI-селекте отсутствует.** На вкладке «Оплата» есть RadioGroup-элемент `bank_installment` с `opacity-70` и подписью «настроим позже» — заглушка. То есть управлять существующим типом `bank_installment` через UI сейчас нельзя.

CRM-роутинг (`pipeline_id`, `pipeline_stage_id`) — уже встроен в `orders_v2`; отдельные `stage_new/stage_success/stage_failed` тянутся из `crm_pipeline_product_bindings` / `crm_pipeline_stages`. Переиспользуем.

## 5. RR shared-модуль — готов

`supabase/functions/_shared/rr/`:
- `rr-config.ts` — `loadRRTestConfig`, `createServiceClient`.
- `rr-adapter.ts` — `createOrder`, `rrGetOrderStatus`, `verifyNotificationSignature`, `mapStatus`, `redactRRResponse`.

`supabase/functions/`:
- `rr-notification` — **занят test-only контуром** (принимает только `rr_test_*`, пишет только в `rr_test_ledger`).
- `rr-test-create-order`, `rr-test-get-status`, `rr-test-simulate-webhook` — admin/test инструменты.

**Вывод:** production webhook — новый endpoint `rr-webhook` (не `rr-notification`).

## 6. Единая точка выдачи доступов — есть

`supabase/functions/grant-access-for-order/index.ts` — единственный writer доступов (используется bepaid-webhook в 7 местах). Использует `writeLedgerEntry` из `_shared/fulfillment-executor.ts` и `syncSecondaryProductAccessForUser` из `_shared/product-access-grants.ts`.

Будущий `rr-webhook` **обязан** вызывать `grant-access-for-order`, а не заводить параллельную ветку выдачи.

## 7. Схема боевых таблиц — расширений почти не требуется

- `orders_v2` (36 полей): `provider text` (без CHECK), `provider_payment_id text`, `pipeline_id, pipeline_stage_id` — CRM встроен.
- `payments_v2` (31 поле): `provider text`, `installment_number int`, `is_recurring bool`, `transaction_type text`, `origin text`, `meta jsonb`.
- `provider_events` (14 полей): `provider text`, `event_id text`, `idempotency_key`, `signature_valid`, `processing_status` — идемпотентность из коробки.
- Фактические значения `provider` в `payments_v2`: `bepaid, stripe, admin_test, admin, '', historical_import, getcourse`. Значения `rr` пока нет; добавление — add-only (text, без миграции enum).

## 8. Источник колонки «Комиссия» в /admin/payments (закрыто)

Источник: **`payments_v2.meta.commission_total`** (numeric, в единицах валюты, не minor).

Цепочка:
- `src/hooks/useUnifiedPayments.tsx:547–549` — `commission_total = meta?.commission_total ? Number(meta.commission_total) : null`.
- `src/components/admin/payments/PaymentsStatsPanel.tsx:92–94` — читает `p.commission_total` (top-level, проброшенный хуком).
- Комментарий в коде: «Real commission from bePaid statement» — сейчас заполняется только синхронизацией из bePaid-выписки.

**Вывод для РР:** чтобы UI показал комиссию РР без правок фронта, `rr-webhook` при `paid` должен писать `commission_total` в `payments_v2.meta` в тех же единицах, что и bepaid (numeric BYN, не minor). Отдельная колонка `commission_minor` в Sprint 2 не заводится.

## 9. Таблица `installment_payments` — что это (закрыто)

`public.installment_payments` (19 полей, **0 строк**). FK-контур:
- `subscription_id → subscriptions_v2(id) ON DELETE CASCADE`
- `order_id → orders_v2(id) ON DELETE CASCADE`
- `payment_plan_id → payment_plans(id)`
- `payment_id → payments_v2(id)`
- `UNIQUE (order_id, payment_number)`

Это **график собственной (internal) рассрочки bepaid** (offer_type `pay_now` + `payment_method='internal_installment'`). Хранит очерёдность списаний (`payment_number/total_payments`, `due_date`, `charge_attempts`, `last_attempt_at`).

**Решение для РР v1:** таблица **не используется**. Рассрочка от РР — это **один платёж** от банка (единая сумма), график ведёт банк, а не наша БД. `installment_payments` в РР-flow не трогаем и не расширяем.

## 10. Scope Sprint 2 (уточнён по правкам, для утверждения перед стартом)

Только add-only:
- В UI редактора `AdminProductDetailV2.tsx` — добавить пункт «Рассрочка банка» в селект «Тип кнопки», маппинг: `offer_type='bank_installment'` (текст в БД не переименовываем).
- В `meta` кнопки добавить поле `installment_provider ∈ {'rr','bepaid',null}` и `rr_product_code` (nullable). Существующий `meta.bank_installment.external_link` не удаляем.
- `provider = 'rr'`, `payment_url mode`, валюта BYN, `amount` — из `tariff_offers.amount` соответствующего оффера.
- **`commission_policy` не вводится** (перенесено в отдельный financial-sprint).
- Массовая миграция 2 существующих `bank_installment`-записей запрещена. Сначала UI + добавление meta-полей, затем runtime proof на одном отдельно выбранном тарифе.

## 11. Deliverable

Этот файл: `.lovable/discovery/2026-07-09-rr-product-wiring-discovery.md`.
БД и код не изменены (snapshot счётчиков п.1 подтверждает).

## 12. Definition of Done — выполнено

- [x] Snapshot счётчиков (правильный UNION ALL).
- [x] Собрана карта `tariff_offers` (п.2).
- [x] Разобран текущий `bank_installment`-контур (п.3).
- [x] Отмечено отсутствие `bank_installment` в UI-селекте (п.4).
- [x] Подтверждена готовность RR shared (п.5).
- [x] Подтверждена единая точка `grant-access-for-order` (п.6).
- [x] Схема боевых таблиц — add-only путь для `provider='rr'` (п.7).
- [x] **Закрыт вопрос по «Комиссии»** — `payments_v2.meta.commission_total` (п.8).
- [x] **Закрыт вопрос по `installment_payments`** — internal bepaid schedule, в РР v1 не используется (п.9).
- [x] Уточнён scope Sprint 2 без `commission_policy` и без переименования `bank_installment` (п.10).
