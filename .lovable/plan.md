# да, согласен, с учетом правок:

1. **Discovery принимается как Sprint 1**, но пункт 10 с проверкой БД нужно исправить.  
Нельзя писать:

```sql
SELECT count(*) FROM tariff_offers, orders_v2, payments_v2
```

Это cross join и даст бессмысленное число.

Правильно:

```sql
SELECT 'tariff_offers' AS table_name, count(*) FROM tariff_offers
UNION ALL
SELECT 'orders_v2', count(*) FROM orders_v2
UNION ALL
SELECT 'payments_v2', count(*) FROM payments_v2
UNION ALL
SELECT 'provider_events', count(*) FROM provider_events
UNION ALL
SELECT 'domain_events', count(*) FROM domain_events;
```

2. **В deliverable добавить, что discovery должен быть зафиксирован как отчет, а не как план.**

```txt
Отчет о выполненной работе: Discovery существующего installment/product buttons flow для РР
```

3. **Перед Sprint 2 обязательно закрыть пункт про** `installment_payments`**.**  
Он не может оставаться “не подтвержденным”, потому что может быть уже существующим контуром рассрочек. Нужно добавить в Sprint 1 discovery:

```txt
Проверить таблицу installment_payments:
- поля;
- связи с orders_v2/payments_v2/tariff_offers;
- используется ли сейчас internal_installment / bePaid;
- можно ли ее трогать;
- нужно ли ее исключить из РР v1.
```

4. **Перед Sprint 2 проверить источник комиссии в** `/admin/payments`**.**  
Это критично для product wiring, иначе можно записать комиссию в `meta`, а UI ее не увидит.

Добавить discovery:

```txt
Найти, откуда UI /admin/payments берет колонку «Комиссия»:
- отдельная колонка;
- meta;
- расчет;
- provider-specific mapping.
```

5. **Не добавлять** `commission_policy` **в Sprint 2.**  
На этом этапе достаточно:

```txt
provider = rr
external_link / payment_url mode
currency
amount_minor из тарифа/кнопки
```

`commission_policy` — отдельная финансовая логика, не нужна для первого wiring.

6. `bank_installment` **не переименовывать в БД и не менять старый flow.**  
В Sprint 2 только добавить управление существующим типом в UI:

```txt
offer_type='bank_installment'
label в UI: Рассрочка банка
```

Старый внешний URL оставить как fallback/legacy до отдельного cleanup.

7. **В Sprint 2 запретить массовую миграцию существующих 2 записей.**  
Сначала только UI + add-only поля/meta, затем отдельный runtime proof на одном выбранном тарифе.
8. **Для будущего** `installment-initiate` **source of truth должен быть** `tariff_offers.id`**.**  
Не `product_id + tariff_id + button_id` как свободная комбинация. Правильно:

```txt
Вход: tariff_offer_id
```

А уже по нему подтягивать tariff/product/amount/currency/meta.

После этих правок Sprint 1 можно считать корректным discovery и переходить к плану Sprint 2.

&nbsp;

План Sprint 1: Discovery — существующий installment/product buttons flow

**Статус:** Sprint 0 (правка отчета) закрыт. Ниже — только фактические находки из репозитория и БД, без изменений.

## 1. Модель кнопки продукта — уже существует, называется `tariff_offers`

Таблица `public.tariff_offers` (27 полей, актуальные для нас):

- `offer_type` (text, без enum-check в БД): фактические значения — `pay_now, trial, preregistration, lead, bank_installment`.
- `payment_method` (text): `full_payment, internal_installment, bank_installment`.
- `button_label, amount, is_active, is_primary, sort_order, tariff_id`.
- `installment_count, installment_interval_days, first_payment_delay_days` — для internal (bepaid).
- `meta jsonb` — уже содержит вложенные `bank_installment.{external_link,link_label,message_html}`, `installment.{max_months}`, `recurring.{...}`, `lead_form.{...}`, `acquiring.{...}`.
- `reentry_amount` — цена повторного вступления.

## 2. Существующий «Заявка на рассрочку» = `offer_type='bank_installment'`

В БД уже 2 записи с `offer_type='bank_installment'` на 2 тарифах. Рендерится в:

- `src/lib/bankInstallment.ts` — хелпер `readBankInstallmentMeta(offer)`; **дефолтная ссылка** захардкожена: `https://pay.rrllc.ru/katerina-gorbova-credit`.
- `src/components/lead/LeadRequestDialog.tsx` — показывает кнопку с этой ссылкой (target=_blank).
- Точки использования: `src/pages/SitePageBySlug.tsx`, `src/pages/TariffPricing.tsx`, `src/components/landing/UniversalPricingSection.tsx`, `src/components/landing/ProductLanding.tsx`, `src/components/landing/TariffCard.tsx`, `src/components/live/LiveEventProductCta.tsx`.

Текущий flow «банковской рассрочки» = внешний URL, без createOrder / webhook / payments.

## 3. Редактор кнопки — `src/pages/admin/AdminProductDetailV2.tsx`

Модалка «Редактировать кнопку» / «Новая кнопка оплаты» (строки 1795–2010). Селект «Тип кнопки» показывает **5 значений**:

- `pay_now` → «Оплата (полная стоимость)»
- `trial` → «Trial (пробный период)»
- `preregistration` → «Предзапись (привязка карты)»
- `installment` (виртуальный ключ = `pay_now + payment_method='internal_installment'`) → «Рассрочка»
- `lead` → «Заявка (без оплаты)»

`**bank_installment` в UI-селекте отсутствует.** На вкладке «Оплата» есть RadioGroup с `bank_installment` (строки 1993–1999), но помечен `opacity-70` и подпись «настроим позже». То есть в UI ещё нет полноценного управления «Рассрочка банка».

Настройки CRM-воронки/стадий (`crm_funnel_id`, `stage_new`, `stage_success`, `stage_failed`) — на вкладке «Дополнительно» (в скриншоте видно `pipeline_id`, `pipeline_stage_id` из `orders_v2`). Их можно переиспользовать целиком, не плодить дубли.

## 4. RR shared-модуль — готов

`supabase/functions/_shared/rr/`:

- `rr-config.ts` — `loadRRTestConfig`, `createServiceClient`.
- `rr-adapter.ts` — `createOrder`, `rrGetOrderStatus`, `verifyNotificationSignature`, `mapStatus`, `redactRRResponse`.

`supabase/functions/`:

- `rr-notification` — **уже занят** как test-only endpoint (принимает только `rr_test_*` external_id, пишет в `rr_test_ledger`).
- `rr-test-create-order`, `rr-test-get-status`, `rr-test-simulate-webhook` — admin/test инструменты, боевые таблицы не трогают.

**Вывод:** production webhook нельзя переиспользовать `rr-notification`, нужен отдельный endpoint `rr-webhook` (согласно правкам к плану).

## 5. Access-grant pipeline — единая точка входа существует

`supabase/functions/grant-access-for-order/index.ts` — вызывается из `bepaid-webhook` (7 мест вызова) как единственный writer выдачи доступов. Использует `writeLedgerEntry` из `_shared/fulfillment-executor.ts` и `syncSecondaryProductAccessForUser` из `_shared/product-access-grants.ts`. Именно её должна вызывать будущая production-функция `rr-webhook` — никакой параллельной ветки.

## 6. Схема боевых таблиц — расширений почти не требуется

- `orders_v2`: 36 полей, `provider text` (без CHECK, без enum), `provider_payment_id text`, `pipeline_id, pipeline_stage_id` уже есть — CRM-роутинг встроен.
- `payments_v2`: 31 поле, `provider text`, `installment_number int`, `is_recurring bool`, `transaction_type text`, `origin text`, `meta jsonb`.
- `provider_events`: 14 полей, `provider text`, `event_id text`, `idempotency_key`, `signature_valid`, `processing_status` — идемпотентность из коробки.
- Фактические значения `provider` в `payments_v2`: `bepaid, stripe, admin_test, admin, "", historical_import, getcourse`. Значения `rr` пока нет.

**Add-only ход**: провайдер `rr` вводится значением text — миграция enum-check не требуется. Комиссия РР пишется в существующее поле, надо решить какое (`meta.commission_minor` — самый безопасный add-only путь; либо добавить колонку `commission_minor int`, если такой ещё нет — проверить).

## 7. Что осталось не подтверждённым (для следующего шага)

- Нужно ли для комиссии РР **отдельная колонка** `commission_minor` в `payments_v2`, или писать только в `meta`. Существующая колонка «Комиссия» в UI `/admin/payments` — надо посмотреть, откуда берётся.
- Формат `provider_events.event_id` для РР — принять `external_id + status` (как сейчас в rr-test) или `external_id + notification_id`.
- Публичный контур входа: где именно кнопка «Рассрочка банка» становится триггером `installment-initiate` — компоненты `TariffCard`/`LeadRequestDialog`/`SitePageBySlug` уже импортируют bank_installment. Плюс `live/LiveEventProductCta.tsx` — вебинарные кнопки.
- Есть ли отдельная таблица `installment_payments` (в списке таблиц видно) — что она содержит и как связана с текущим bank_installment.

## 8. Что НЕ меняется в этом Sprint

Никакие файлы, миграции, edge functions не тронуты. Это только discovery-отчёт.

## 9. Deliverable

Записать этот discovery в `.lovable/discovery/2026-07-09-rr-product-wiring-discovery.md` для сверки перед Sprint 2 (add-only поля кнопки).

## 10. Definition of Done Sprint 1

- Файл `.lovable/discovery/2026-07-09-rr-product-wiring-discovery.md` создан с содержимым п.1–7.
- Ни одна строка в БД не изменена (verify: `SELECT count(*) FROM tariff_offers, orders_v2, payments_v2` до/после — совпадает; и без того ничего не выполнялось).
- Пользователь подтверждает discovery перед стартом Sprint 2, где вводятся add-only поля и `bank_installment` появится в селекте UI редактора.