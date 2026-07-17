## да, согласен, с учетом правок:

1. Название типа подтверждаем: **«Сформировать счёт»**. Текущий пользовательский `button_label` не перезаписывать автоматически. Значение «Сформировать счёт» подставлять только для нового оффера либо когда label пустой/равен стандартному label предыдущего типа.
2. Старые `pay_now` с корректными `document_scenarios` не мигрировать. Legacy-ветку `detectInvoiceOnlyOffer` сохранить. Data-fix ограничить тремя офферами продукта «Ценный бухгалтер».
3. Для `offer_type='invoice'` вкладки «Оплата» и «Автопродление» скрыть полностью. Во вкладке «Документы» оставить только `bank_transfer`; остальные каналы недоступны, добавление сценария физлица скрыто.
4. `invoice-checkout-issue` без необходимости не ограничивать новым списком `('invoice','pay_now')`: сейчас функция принимает любой активный оффер и уже работает. Добавить только явное принятие `invoice`, если существующая валидация фактически содержит ограничивающий allowlist. Не сужать текущую обратную совместимость.
5. Вынести единый helper определения счёта:
  - сначала `offer_type === 'invoice'`;
  - затем legacy `pay_now + document_scenarios`;
  - использовать его во всех frontend-точках, чтобы логика снова не разошлась между `/cb`, `TariffCard`, `UniversalPricingSection` и `TariffPricing`.
6. Backend guard добавить во все пути **инициации списания**, включая `bepaid-auto-process`, если он получает текущий оффер перед списанием. В `bepaid-webhook` не блокировать обработку по текущему `offer_type`: webhook обязан завершать уже созданные исторические платежи и заказы, даже если оффер позднее переведён в `invoice`.
7. Для data-fix не собирать `document_scenarios` вручную по сокращённым UUID. Скопировать массив JSONB **побайтно/структурно** из invoice-оффера тарифа «Бухгалтер» в два остальных оффера через `CASE` или CTE. До UPDATE сохранить полный snapshot трёх строк и подготовить обратный guarded UPDATE.
8. Последовательность релиза:
  - код и typecheck;
  - deploy изменённых edge functions;
  - publish frontend и подтверждение live commit;
  - только затем guarded data-fix трёх офферов;
  - postflight SQL;
  - production E2E `/cb` и админки.
  Нельзя менять `offer_type` в БД до появления нового frontend-кода в production.
9. Guarded UPDATE должен проверять точные три UUID и исходные значения `offer_type/payment_method/meta`, вернуть ровно три строки. `0–2` либо более `3` строк — остановка без продолжения E2E.
10. Verify дополнить:

- все три invoice-кнопки передают точный `offer_id`;
- card/installment flow никогда не выбирает `offer_type='invoice'`;
- прямые charge endpoints возвращают `400` и единый код `offer_type_invoice_not_chargeable`;
- после неуспешного production proof три строки восстанавливаются из snapshot;
- после успешного proof изменения остаются как целевой production state.
- &nbsp;
- План: новый тип кнопки «Сформировать счёт» + починка регрессии на /cb

### 1. Что происходит сейчас (Diagnose)

**Регрессия.** Кнопка «Оплатить от юрлица» на `/cb` должна открывать визард выписки счёта (`InvoiceCheckoutDialog`), а открывает диалог оплаты картой (`PaymentDialog`). Причина:

`SitePageBySlug` выбирает диалог через `detectInvoiceOnlyOffer(offer)`, а тот считает оффер «invoice-only» ТОЛЬКО по `meta.document_scenarios`. Проверка данных `products_v2.id=3e43fb28-…` («Ценный бухгалтер»):


| Тариф             | `offer_type` | `document_scenarios`                                                          | Итог                                |
| ----------------- | ------------ | ----------------------------------------------------------------------------- | ----------------------------------- |
| Бухгалтер         | `pay_now`    | 2 enabled legal_entity+bank_transfer (шаблоны ЮЛ и ИП, executor `d0c7fe75-…`) | ✅ Работает                          |
| Главный бухгалтер | `pay_now`    | **null**                                                                      | ❌ Открывается PaymentDialog (карта) |
| Бизнес-леди       | `pay_now`    | **null**                                                                      | ❌ Открывается PaymentDialog (карта) |


У всех трёх есть корректные `meta.slot_role='payment_invoice'` и `meta.site_button_variant='legal_entity'` — но этого не достаточно текущему детектору.

**Архитектурная проблема.** Признак «эта кнопка = выписка счёта» размазан: он спрятан в двух JSONB-полях `meta.document_scenarios` и `meta.site_button_variant`, редактируется в двух вкладках («Основное» → «Слот» и «Документы» → «Банковский перевод»). Легко потерять при копировании оффера — что и произошло с двумя тарифами. Пользователь просит вынести это в **тип кнопки** (`offer_type`) наравне с «Оплата», «Trial», «Предзапись», «Рассрочка», «Заявка», «Рассрочка банка».

### 2. Discovery (места, где читается `offer_type`)

Полный список найден `rg -n "offer_type"`:

**Frontend, поведенческие развилки:**

- `src/pages/SitePageBySlug.tsx` — `pickOfferForFlow`, ветка выбора диалога (`InvoiceCheckoutDialog` / `PaymentDialog` / `LeadRequestDialog`), `open-invoice` action.
- `src/lib/invoiceCheckout.ts` — `detectInvoiceOnlyOffer`.
- `src/pages/admin/AdminProductDetailV2.tsx` — форма «Редактировать кнопку»: `<Select>` с типом кнопки, ветки defaults (`button_label`, `payment_method`, `is_primary`, `sort_order`), панели вкладок «Оплата»/«Документы»/«Автопродление».
- `src/hooks/useTariffOffers.tsx`, `src/hooks/usePublicProduct.tsx` — union-типы для `offer_type`.
- `src/components/landing/TariffCard.tsx`, `UniversalPricingSection.tsx`, `pages/TariffPricing.tsx` — рендер карточек тарифа.
- `src/lib/siteSlotManifest.ts` — allowlist `site_button_variant`.

**Backend edge functions:**

- `bepaid-create-token`, `bepaid-auto-process`, `bepaid-webhook`, `direct-charge`, `admin-create-public-link`, `payment-dialog-create-bridge-link`, `public-create-installment-link`, `public-rr-installment-initiate` — фильтры/валидации по `offer_type`; для `invoice` эквайринговые пути ДОЛЖНЫ явно отклонять оффер.
- `public-product`, `public-product-by-slug`, `public-tariff-by-public-id`, `getcourse-grant-access` — просто читают/возвращают, менять не нужно.
- `invoice-checkout-issue` — уже принимает любой активный оффер, не смотрит `document_scenarios`. Шаблон резолвится внутри `canonical-document-generate-strict` через сценарии → в дальнейшем всё равно надо иметь корректные `document_scenarios`, но edge не сломается без них.
- `_shared/renewal-offer-resolver.ts`, `_shared/standard-fields.ts` — чисто снимок значения, менять не нужно.

**База:** `tariff_offers.offer_type text` (не enum). Новое значение можно ввести без миграции схемы — только data.

### 3. Что делаем

#### 3.1. Новый offer_type `invoice` («Сформировать счёт»)

Каноническая семантика: одно значение — вся конфигурация. Оффер этого типа:

- Не участвует в эквайринге (карта/Apple/Google/ЕРИП/bank_installment).
- Всегда открывает `InvoiceCheckoutDialog`.
- `payment_method` фиксируется как `bank_transfer` (для консистентности с существующим сценарием), `requires_card_tokenization=false`, `is_primary=false`, `installment_*`=null, `trial_*`=null, `preregistration=null`.
- В админке автоматически заполняется один enabled `document_scenarios` legal_entity + bank_transfer. Шаблон/executor подтягиваются из product/tariff defaults; если у продукта они есть — берём их, иначе оставляем `template_id=null` (заполнит админ во вкладке «Документы»).
- Вкладки «Оплата», «Автопродление» скрываются. Вкладка «Документы» показывается, но каналы жёстко = `['bank_transfer']`, остальные disabled (карта/Apple/Google/ЕРИП/GooglePay серые).

#### 3.2. Изменения кода

**Frontend:**

1. `src/hooks/useTariffOffers.tsx`, `src/hooks/usePublicProduct.tsx`, `src/components/landing/TariffCard.tsx`, `src/components/live/LiveEventProductCta.tsx`, `src/dev/slotFixtureHtml.ts` — расширить union `offer_type` значением `"invoice"`.
2. `src/pages/admin/AdminProductDetailV2.tsx`:
  - Добавить `<SelectItem value="invoice">Сформировать счёт</SelectItem>` (между «Заявка» и «Рассрочка банка»).
  - В onChange: при переключении на `invoice` — установить `payment_method='bank_transfer'`, `button_label='Сформировать счёт'` (если поле не редактировалось), `requires_card_tokenization=false`, `is_primary=false`, `installment_*`=null, `trial_*`=null, `preregistration=null`, `meta.site_button_variant='legal_entity'`, `meta.slot_role` — если пуст, ставим `payment_invoice`.
  - На save: если `offer_type==='invoice'` и `meta.document_scenarios` пуст — вставить один enabled сценарий `{payer_type:'legal_entity', payment_channels:['bank_transfer'], is_enabled:true, requires_required_requisites:true, template_id: product_default||null, executor_id: product_default||null}`.
  - Условный рендер вкладок: `offer_type==='invoice'` → показываем только «Основное» + «Документы» (или блокируем «Оплата»/«Автопродление» с подсказкой «недоступно для типа Сформировать счёт»).
  - В вкладке «Документы» при `offer_type==='invoice'` — заблокировать выбор `payment_channels` (только `bank_transfer`), спрятать «+ Ещё сценарий Физлицо».
3. `src/lib/invoiceCheckout.ts` — `detectInvoiceOnlyOffer`: первым условием возвращать `{isInvoiceOnly:true}` если `offer.offer_type==='invoice'`. Существующий scenarios-based путь остаётся как обратная совместимость для старых офферов `pay_now` с настроенными сценариями.
4. `src/pages/SitePageBySlug.tsx`:
  - `pickOfferForFlow`, ветка `flow==='invoice'` — искать сначала `offer_type==='invoice'`, потом fallback на `pay_now + detectInvoiceOnlyOffer` (legacy).
  - Ветка `flow==='payment'` — исключать `offer_type==='invoice'` (уже исключено, но подтвердить).
  - Ветка рендера диалога — если `offer.offer_type==='invoice'`, всегда `InvoiceCheckoutDialog`.
5. `src/components/landing/TariffCard.tsx`, `UniversalPricingSection.tsx`, `TariffPricing.tsx` — добавить invoiceOffers-фильтр и роутинг клика на `InvoiceCheckoutDialog`.
6. `src/lib/siteSlotManifest.ts` — allowlist `variant` уже содержит `legal_entity`; менять не надо.

**Backend defensive-guards:**
7. `bepaid-create-token`, `direct-charge`, `admin-create-public-link`, `payment-dialog-create-bridge-link`, `public-create-installment-link`, `public-rr-installment-initiate` — если `offer.offer_type==='invoice'` → 400 `offer_type_invoice_not_chargeable`. Это защита от прямого дёрганья URL/link с invoice-оффером.
8. `invoice-checkout-issue` — принять `offer_type in ('invoice','pay_now')`, для `pay_now` — не ломать существующий путь (legacy).

**Ничего не трогаем:**

- Миграции БД (offer_type — text).
- `InvoiceCheckoutDialog`, `canonical-document-generate-strict`, `canonical-document-send` — уже работают правильно.

#### 3.3. Data-fix (INSERT tool)

Один UPDATE на три оффера продукта «Ценный бухгалтер» (`3e43fb28-…`):

- `b6476800-…` (Бухгалтер), `d749583b-…` (Гл. бухгалтер), `4c6d6110-…` (Бизнес-леди).

Изменения:

- `offer_type := 'invoice'`
- `payment_method := 'bank_transfer'`
- `is_primary := false`
- `meta.site_button_variant := 'legal_entity'` (уже так)
- `meta.slot_role := 'payment_invoice'` (уже так)
- `meta.document_scenarios`:
  - Для «Бухгалтер» — оставить как есть (2 сценария с шаблонами ЮЛ и ИП).
  - Для «Гл. бухгалтер» и «Бизнес-леди» — записать 2 сценария 1:1 с «Бухгалтер»: `payer_type=legal_entity`, `payment_channels=['bank_transfer']`, `is_enabled=true`, `requires_required_requisites=true`, `executor_id=d0c7fe75-1192-40a9-bbae-b652b69e6882`, `template_id` = `4fa3160f-…` (ЮЛ-Исполнитель) и `bcf5e015-…` (ИП-Исполнитель) — те же, что настроены у «Бухгалтер». Пользователь подтвердил в чате, что настройки такие же (одна пара шаблонов на весь продукт).

Dry-run: `SELECT id, offer_type, payment_method, meta->'document_scenarios' FROM tariff_offers WHERE id IN (...)` до и после.

#### 3.4. Verify

1. **TS build** — расширение union-типа `offer_type` не должно ломать сборку. Прогнать `tsgo` (агент сам запустит).
2. **Playwright на `localhost:8080/cb**`, viewport 1280×1800:
  - Клик по «Оплатить от юрлица» на каждом из трёх тарифов → скриншот заголовка `Оформление счёта` (InvoiceCheckoutDialog).
  - Клик по «Оплатить обучение» → скриншот PaymentDialog (регрессии нет).
  - Клик по «Оплатить в рассрочку» → скриншот PaymentDialog с installment-режимом.
3. **Админка** `admin/products-v2/3e43fb28-…?tab=offers` → открыть оффер «Бухгалтер»:
  - `Тип кнопки` теперь `Сформировать счёт`.
  - Вкладка «Оплата» скрыта/задизейблена.
  - Вкладка «Документы» — channels зафиксированы на bank_transfer, шаблоны сохранены.
4. **Backend smoke:**
  - `curl invoice-checkout-issue` c одним из офферов + фейковым legal_details_id → должен вернуть либо 200, либо валидную бизнес-ошибку (не 500).
  - `curl bepaid-create-token` c `offer_type='invoice'` → должен вернуть `offer_type_invoice_not_chargeable`.

### 4. Definition of Done

- Три оффера в базе имеют `offer_type='invoice'`, `payment_method='bank_transfer'`, корректные `document_scenarios`.
- В `AdminProductDetailV2` в селекте есть пункт «Сформировать счёт»; при его выборе автозаполняются нужные поля, вкладки «Оплата»/«Автопродление» скрыты, в «Документах» channels зафиксированы на bank_transfer.
- На `/cb` все три кнопки «Оплатить от юрлица» открывают `InvoiceCheckoutDialog` — скриншоты приложены.
- Ни одна из трёх кнопок не открывает PaymentDialog (карту).
- `bepaid-create-token`/`direct-charge`/`admin-create-public-link`/`public-create-installment-link` отклоняют `offer_type='invoice'` кодом 400.
- `invoice-checkout-issue` успешно принимает `offer_type='invoice'`.
- `tsgo` без новых ошибок.
- Отчёт в формате «Отчёт о выполнении:» с приложенными grep/скриншотами.

### 5. Технические детали

- **Файлы под правки** (frontend): `src/hooks/useTariffOffers.tsx`, `src/hooks/usePublicProduct.tsx`, `src/components/landing/TariffCard.tsx`, `src/components/landing/UniversalPricingSection.tsx`, `src/pages/TariffPricing.tsx`, `src/components/live/LiveEventProductCta.tsx`, `src/dev/slotFixtureHtml.ts`, `src/pages/admin/AdminProductDetailV2.tsx`, `src/lib/invoiceCheckout.ts`, `src/pages/SitePageBySlug.tsx`.
- **Файлы под правки** (edges): `bepaid-create-token/index.ts`, `direct-charge/index.ts`, `admin-create-public-link/index.ts`, `payment-dialog-create-bridge-link/index.ts`, `public-create-installment-link/index.ts`, `public-rr-installment-initiate/index.ts`.
- **Deploy**: перечисленные edge-функции нужно задеплоить (`supabase--deploy_edge_functions`) — иначе backend-гарды не применятся.
- **Data-fix**: один `UPDATE public.tariff_offers ... WHERE id IN (...)` через `supabase--insert`.
- **Миграций схемы нет**: `offer_type` — `text`, добавление значения не требует ALTER TYPE.
- **Обратная совместимость**: старые `pay_now`-офферы с настроенными `document_scenarios` продолжают работать через legacy-ветку `detectInvoiceOnlyOffer` (не удаляем её).

### 6. Открытые вопросы (нужны перед Execute)

1. **Название пункта в селекте** — «Сформировать счёт» подтверждаем? Или, например, «Счёт для юрлица (Б/Н)»?
2. **Что делать со старыми `pay_now`-офферами с document_scenarios на других продуктах**, если такие есть? Оставить legacy-ветку и не мигрировать (безопасно) — предпочтительно. Если хочется единого канона — прогнать backfill-скрипт, который переводит все `pay_now`+invoice-only офферы в `invoice`. Рекомендую пока НЕ трогать (только три оффера «Ценный бухгалтер») и вернуться к этому отдельной задачей после проверки на продакшне.
3. **Скрывать ли вкладку «Оплата» полностью** для типа `invoice`, или оставить её видимой но disabled с подсказкой «эквайринг недоступен для типа Сформировать счёт»? Рекомендую скрыть (как сейчас скрыты Оплата/Автопродление для `lead`).