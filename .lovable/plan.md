# да, согласен, с учетом правок:

## **1. Sprint A можно выполнять**

План вернулся в правильный scope: **нормализовать UI банковской рассрочки**, не начинать `installment-initiate`, `rr-webhook`, платежи, доступы и CRM.

Это корректный промежуточный шаг перед полноценным Sprint B.

---

## **2. Исправить противоречие в пункте 2.1**

Сейчас написано:

```txt
{offerForm.offer_type !== "bank_installment" && offerForm.offer_type !== "lead" && offerForm.offer_type !== "preregistration" && (
  <OfferAcquiringSettings ... />
)}
```

Но далее сказано:

```txt
lead/preregistration тоже не эквайринг — оставим текущее поведение, если они уже там показаны, не меняем; главное — вырезать для bank_installment
```

Это противоречие. Для Sprint A не надо менять `lead` и `preregistration`.

Заменить на:

```tsx
{offerForm.offer_type !== "bank_installment" && (
  <OfferAcquiringSettings ... />
)}
```

То есть в этом спринте **только вырезать** `OfferAcquiringSettings` **для** `bank_installment`. Остальные типы не трогать.

---

## **3. SQL UPDATE допустим, но только с backup snapshot**

Перед UPDATE обязательно снять полный snapshot конкретного оффера:

```sql
SELECT *
FROM tariff_offers
WHERE id = '15ce91ec-5dc1-4abf-9fab-9c97dc1e6b74';
```

И в отчет добавить old/new по 4 полям:

```txt
payment_method: internal_installment → full_payment
installment_count: 6 → NULL
installment_interval_days: 30 → NULL
first_payment_delay_days: <old> → NULL
```

Если `first_payment_delay_days` уже `NULL`, так и написать.

---

## **4. Не называть UPDATE “миграцией”**

В плане правильно написано “SQL UPDATE”, но в отчете подрядчик не должен назвать это миграцией. Это **точечный data-fix одной записи**, а не schema migration.

Формулировка:

```txt
Data-fix одной bank_installment-записи тарифа «Бухгалтер»
```

---





## **5.**

`OfferRowCompact` **должен различать bank installment и internal installment**

Правило для `OfferRowCompact`:

```txt
offer_type='bank_installment'
→ показывать «Рассрочка банка · РР · BYN»
→ показывать amount/button_label
→ НЕ показывать «до N мес»
→ НЕ считать платежи по installment_count
```

А для внутренней рассрочки оставить старое поведение:

```txt
offer_type='pay_now' AND payment_method='internal_installment'
→ прежняя логика «до N мес × X BYN»
```

---

## **6. Проверка публичной страницы через iframe должна быть корректной**

Так как `gorbova.by/cb` рендерит Tilda HTML внутри sandbox iframe, в proof надо не требовать обычный DOM parent-доступ.

Добавить:

```txt
Если Playwright не может напрямую прочитать DOM внутри sandbox iframe, проверять через:
- iframe locator, если доступен;
- postMessage flow;
- popup/navigation URL после клика;
- network request log parent page.
```

Главное доказать:

```txt
клик по кнопке → external_link pay.rrllc.ru
нет вызовов installment-initiate / rr-*.
```

---

## **7. Проверить все 3 тарифа, но data-fix только один**

Правильно:

```txt
Бухгалтер — data-fix 4 полей
Главный бухгалтер — read-only snapshot
Бизнес-леди — read-only snapshot
```

Запрещено “заодно” править два других оффера, если в snapshot не найден критический дефект и нет отдельного согласования.

---

## **8. Боевые таблицы проверять before/after с max timestamps**

В DoD добавить не только счетчики, но и timestamp-проверку:

```sql
SELECT 'orders_v2' AS t, count(*), max(created_at), max(updated_at) FROM orders_v2
UNION ALL SELECT 'payments_v2', count(*), max(created_at), max(updated_at) FROM payments_v2
UNION ALL SELECT 'provider_events', count(*), max(created_at), max(updated_at) FROM provider_events
UNION ALL SELECT 'domain_events', count(*), max(created_at), max(updated_at) FROM domain_events
UNION ALL SELECT 'entitlements', count(*), max(created_at), max(updated_at) FROM entitlements
UNION ALL SELECT 'access_grant_ledger', count(*), max(created_at), max(updated_at) FROM access_grant_ledger;
```

Если `max_updated_at` меняется из-за фоновой системы, в отчете отдельно указать, что новых строк нет и изменение не связано с РР.

---

## **9. Runtime proof не должен включать сохранение формы**

В админке:

```txt
открыть → проверить → скрин → закрыть
```

Не нажимать “Сохранить”, кроме точечного SQL data-fix по согласованному офферу.

---

## **10. Формат отчета после выполнения**

Использовать точный заголовок:

```txt
Отчет о выполненной работе: Sprint A — нормализация UI кнопки «Рассрочка от банка»
```

---

## **Итог**

План можно выполнять после этих правок.

Ключевые ограничения:

```txt
- Sprint A = только UI-normalization + один data-fix
- не начинать installment-initiate
- не начинать rr-webhook
- не создавать payments_v2/orders_v2
- не выдавать доступы
- не трогать CRM/payment pipeline
- не смешивать bank_installment с bePaid/internal_installment


План: Sprint A — нормализация UI кнопки «Рассрочка от банка»
```

## 0. Область

Только продукт **«Ценный бухгалтер. Первая ступень 2.0»** (`7101ed3c-...`) и его 3 тарифа: Бухгалтер / Главный бухгалтер / Бизнес-леди.

Затрагиваем:

- `src/pages/admin/AdminProductDetailV2.tsx` — редактор оффера (диалог offer_type)
- `src/components/admin/product/OfferRowCompact.tsx` — превью строки оффера в списке
- один SQL UPDATE на существующий bank_installment оффер тарифа «Бухгалтер»

НЕ трогаем:

- public flow (`UniversalPricingSection`, `TariffCard`, `SitePageBySlug`, `LeadRequestDialog`, `bankInstallment.ts`)
- edge functions (`installment-initiate` не создаём, `rr-webhook` не создаём, `rr-notification` не трогаем)
- схему БД, RLS, миграции, RR-подключение
- bePaid / Stripe / internal_installment ветки (кроме того, что для `bank_installment` они больше не показываются)

Legacy external_link должен продолжать работать байт-в-байт как сейчас — это доказано Sprint 2.1.

---

## 1. Что уже правильно (оставить как есть)

В редакторе оффера уже реализовано:

- селект `offer_type` содержит `bank_installment` (label «Рассрочка банка»)
- при выборе `bank_installment` форма сбрасывает `installment_count/interval_days/first_payment_delay_days = null`, `requires_card_tokenization = false`, `payment_method = 'full_payment'` (если не был другой)
- на вкладке **Оплата** для `bank_installment` показывается отдельная info-card «Рассрочка банка» с бейджами (Ресурс Развития / BYN / внешний payment_url), amber-alert про legacy и поле `Fallback URL (external_link)` в `meta.bank_installment.external_link`
- radio «Способ приёма оплаты» (`full_payment` / `bank_installment` / …) показывается только для `offer_type='pay_now'` — для `bank_installment` он уже скрыт
- блок «Внутренняя рассрочка N платежей» показывается только для `pay_now + internal_installment` — для `bank_installment` уже скрыт

## 2. Что чинить в UI редактора оффера (`AdminProductDetailV2.tsx`)

Для `offer_type='bank_installment'` в текущем UI ещё «протекает» посторонняя логика. Правки — только condition-gate, без изменения submit-логики.

### 2.1. Вкладка «Оплата» — `OfferAcquiringSettings` (строки ~2153-2165)

Сейчас `<OfferAcquiringSettings ... />` рендерится всегда, включая `bank_installment`. Это блок настроек bePaid/Stripe карточного эквайринга — для банковской рассрочки РР он нерелевантен.

Обернуть в:

```
{offerForm.offer_type !== "bank_installment" && offerForm.offer_type !== "lead" && offerForm.offer_type !== "preregistration" && (
  <OfferAcquiringSettings ... />
)}
```

(lead/preregistration тоже не эквайринг — оставим текущее поведение, если они уже там показаны, не меняем; главное — вырезать для `bank_installment`).

### 2.2. Вкладка «Автопродление» (`renewal`, строки ~2169-…)

Внутри уже стоит гейт `offerForm.offer_type === "pay_now" && offerForm.payment_method === "full_payment"` — для `bank_installment` тело не рендерится. Показать в этой вкладке подсказку-заглушку для `bank_installment`:

```
{offerForm.offer_type === "bank_installment" && (
  <Card>… «Банковская рассрочка не является подписочной. Условия
  и срок определяет банк/Ресурс Развития.» …</Card>
)}
```

### 2.3. Вкладка «Дополнительно» (`extra`, строки ~2657-2723)

- «Блокировать виртуальные карты» уже гейтчено `payment_method === 'internal_installment'` — для `bank_installment` не показывается. ОК.
- Остальные блоки (`GetCourse код`, `OfferWelcomeMessageEditor`, `OfferCrmRoutingSection`, `OfferAutomationRulesSection`, is_active, is_primary) — оставить, они общие. `is_primary` уже гейтчен `pay_now` — для `bank_installment` скрыт. ОК.

### 2.4. Селект `offer_type` — надпись «Рассрочка» (строка ~1859)

В обработчике при выборе «Рассрочка» (внутренней) сейчас корректно ставится `pay_now + internal_installment`. Оставить без изменений.

### 2.5. submit-логика (`handleSaveOffer`, строки ~572-691)

Не трогать. Она уже:

- для `bank_installment` пишет `payment_method` из формы (по умолчанию `full_payment`),
- обнуляет `installment_count/interval/delay`,
- сохраняет `meta.bank_installment.*`.

## 3. Что чинить в списке офферов (`OfferRowCompact.tsx`)

Открыть и добавить branch для `offer_type === 'bank_installment'`:

- бейдж «Рассрочка банка · РР · BYN»
- НЕ показывать «до N мес × X BYN» математику (она валидна только для `payment_method === 'internal_installment'`)
- показывать `button_label` и `amount` из `tariff_offers` (SoT = БД)

Detail — уточнить при чтении файла на build-фазе.

## 4. Data-fix для существующего оффера «Бухгалтер»

Один точечный UPDATE (через insert-tool) — только один оффер, только очистка нерелевантных полей внутренней рассрочки:

```sql
UPDATE tariff_offers
SET payment_method = 'full_payment',
    installment_count = NULL,
    installment_interval_days = NULL,
    first_payment_delay_days = NULL,
    updated_at = now()
WHERE id = '15ce91ec-5dc1-4abf-9fab-9c97dc1e6b74'
  AND offer_type = 'bank_installment';
```

`meta.bank_installment.*` (external_link, installment_provider, currency, rr_mode='payment_url') — не трогаем, они уже корректны.

Офферы «Главный бухгалтер» (`2a07af43…`) и «Бизнес-леди» (`4f64def7…`) уже:

- `payment_method='full_payment'`
- `installment_count/interval/delay = NULL`

По ним UPDATE не нужен. Проверим read-only снапшотом до/после.

## 5. Discovery-снапшот всех 3 тарифов (BEFORE + AFTER)

`supabase--read_query` до и после UPDATE. По каждому bank_installment оффер зафиксировать в отчёте:

```
tariff_id, tariff.name, tariff.code,
offer_id, button_label, amount, currency, payment_method,
installment_count, installment_interval_days, first_payment_delay_days,
meta.bank_installment.installment_provider,
meta.bank_installment.currency,
meta.bank_installment.rr_mode,
meta.bank_installment.external_link
```

Дельта проверяется только по офферу «Бухгалтер»: 4 поля.

## 6. Runtime proof (Playwright, read-only для публики)

1. **Админка** (`/admin/products-v2/7101ed3c...?tab=offers`) — открыть по одному все 3 bank_installment оффера:
  - селект `offer_type` = «Рассрочка банка»
  - info-card «Рассрочка банка» с бейджами Ресурс Развития / BYN / внешний payment_url
  - amber-alert про legacy present
  - fallback external_link заполнен
  - НЕТ radio «Способ приёма оплаты»
  - НЕТ блока «Внутренняя рассрочка N платежей»
  - НЕТ `OfferAcquiringSettings` (bePaid/Stripe)
  - вкладка «Автопродление» показывает подсказку про банковскую рассрочку
  - скриншот каждого
2. **Публичная страница** (`https://gorbova.by/cb`) — по каждой из 3 кнопок:
  - клик открывает `pay.rrllc.ru/...` (external_link)
  - Network НЕ содержит запросов к `installment-initiate`/`rr-*`
  - скриншот
3. **SQL AFTER-снапшот** = байт-в-байт BEFORE для 2-х тарифов; для «Бухгалтера» — только 4 ожидаемых дельты.

## 7. DoD Sprint A

- UI редактора оффера для `offer_type='bank_installment'` не показывает: radio способ оплаты bePaid/Stripe, внутреннюю рассрочку N платежей, `OfferAcquiringSettings`, virtual-card блокировку.
- Вкладка «Автопродление» для `bank_installment` содержит явную подсказку (не подписка).
- `OfferRowCompact` для `bank_installment` не показывает «до N мес × X BYN».
- Оффер «Бухгалтер» нормализован SQL-UPDATE'ом (4 поля).
- BEFORE/AFTER снапшот трёх тарифов приложен.
- Playwright screenshots админки (3 оффера) и публичного клика (3 кнопки) приложены.
- Публичный legacy external_link работает без вызовов `installment-initiate`/`rr-*`.
- Никаких изменений в `orders_v2 / payments_v2 / provider_events / domain_events / entitlements / access_grant_ledger` (счётчики совпадают до/после).
- Отчёт: `.lovable/proofs/2026-07-09-rr-sprint-A-bank-installment-ui-normalize.md`.

## 8. Что НЕ делаем в Sprint A

- `installment-initiate`, `rr-webhook`, `rr-*` edge-функции
- `payments_v2` для РР, `grant-access-for-order`, CRM stage transitions
- `rr_mode='runtime'` — все офферы остаются `rr_mode='payment_url'`
- переименование `bank_installment` в БД
- удаление `DEFAULT_BANK_INSTALLMENT_LINK` из `src/lib/bankInstallment.ts`
- ручные платежи
- изменения bePaid/Stripe/internal_installment веток
- миграции БД / RLS / GRANT

## 9. Технические файлы, которые будут изменены

- `src/pages/admin/AdminProductDetailV2.tsx` — 2 condition-gate правки (§2.1, §2.2)
- `src/components/admin/product/OfferRowCompact.tsx` — branch для `bank_installment` (§3)
- SQL UPDATE через insert-tool (§4)
- отчёт-файл `.lovable/proofs/2026-07-09-rr-sprint-A-*.md`