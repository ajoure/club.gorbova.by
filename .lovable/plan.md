## Контекст (verified reads)

- `AdminPaymentLinkDialog.tsx` уже поддерживает composable-quote и выбирает `paymentType ∈ {one_time, subscription}` + provider (bepaid/stripe) + внутреннюю рассрочку по `payment_method='internal_installment'`. Сценарии «Счёт для юрлица/ИП» (`offer_type='invoice'`, `payment_method='bank_transfer'`) и «Ресурс развития» (`offer_type='bank_installment'`) в UI отсутствуют.
- Оффер `4c6d6110…` = `invoice`, оффер `fdb8bffc…` = `bank_installment`. Значит для UI-фильтра НЕ нужно хардкодить UUID: определяем сценарий по паре `offer_type`/`payment_method` активного оффера того же тарифа.
- `invoice-checkout-issue` (edge) уже поддерживает `addon_offer_ids`, `resolveComposableCheckout`, `materializeComposableOrderGroup`, `buildPurchaseCompositionTitle` → используется у клиента (JWT + `client_legal_details` принадлежит его профилю).
- `public-rr-installment-initiate` уже принимает `addon_offer_ids`, применяет `allocateComposablePayableTotal` и материализует order-group на успешный callback → используется публично.
- `admin-create-public-link` уже принимает `composable_quote` + `provider`.
- Точка входа: `ContactDetailSheet.tsx` → кнопка «Ссылка на оплату» → `AdminPaymentLinkDialog` (`mode="contact"`). `CreateDealDialog.tsx` — минимальный (`title/amount/pipeline/stage/product/tariff`), без модулей и способа оплаты.
- В `orders_v2` payer/legal_details пишутся в `meta.legal_details_id` + `meta.purchase_snapshot`; `order_group` строится хелпером `materializeComposableOrderGroup`.

## Scope (только фронтенд + два узких серверных writer-а, канонические таблицы)

### 1. UI: способы оплаты (AdminPaymentLinkDialog)

Расширить набор «Способ оплаты» до 4 сценариев, определяемых по активным `tariff_offers` выбранного тарифа (без хардкода UUID):

- «Картой сейчас» — `pay_now` (текущая ветка, provider bepaid/stripe).
- «Внутренняя рассрочка» — `payment_method='internal_installment'` (текущая).
- «Счёт для юрлица/ИП» — `offer_type='invoice'`.
- «Ресурс развития» — `offer_type='bank_installment'`.

Каждая опция скрывается, если у тарифа нет соответствующего активного оффера. Selector даёт единый способ выбора → `effectiveOffer` подставляется автоматически (по offer_type). Выбор модулей и `composable_quote` работают одинаково для всех 4 сценариев. Скидка/наценка/`adjustmentReason` уже общий блок — переиспользуем.

### 2. Ветка «Счёт»

- В диалоге появляется блок:
  - `payer_type` = ЮЛ / ИП / ФЛ,
  - Select карточки реквизитов из `client_legal_details` (WHERE `profile_id`=owner контакта, соответствующий `client_type`).
- Отправка на новый **узкий** edge writer `admin-invoice-checkout-issue` (service-role, role guard admin/super_admin/menedzher):
  - Принимает `user_id, product_id, offer_id, addon_offer_ids, legal_details_id, adjustment_reason, composable_quote_client`.
  - Использует те же shared модули (`resolveComposableCheckout`, `materializeComposableOrderGroup`, `resolveOfferRouting`, `buildPurchaseCompositionTitle`), что и `invoice-checkout-issue`.
  - Создаёт ORD + при необходимости order-group + вызывает `canonical-document-generate-strict` с `pre_payment_invoice=true`. Не рассылает email/telegram автоматически (админский flow — только выпуск PDF, возвращает `pdf_url`, `document_number`, `order_id`).
  - Для ФЛ legal_details не требуется — вызываем без `legal_details_id`; шаблон подтягивает данные пользователя как и раньше.
- В UI показываем результат (номер счёта, кнопка «Открыть PDF»).

### 3. Ветка «Ресурс развития»

- `payment_type` фиксируется как one-time (RR — рассрочка провайдера).
- Отправка на новый **узкий** edge writer `admin-rr-installment-initiate` (service-role, role guard):
  - Body: `user_id, product_id, offer_id, addon_offer_ids, composable_quote_client, adjustment_reason, contact_snapshot (name/phone/email из контакта)`.
  - Внутри — то же, что `public-rr-installment-initiate`, но identity берём из `profiles.user_id` контакта; upstream-выкладка НЕ выполняется автоматически, если админ не подтвердил — рендерим редирект-URL, копируем/шлём в Telegram.
  - Callback (`rr-webhook`) уже правильно материализует order-group.

### 4. CreateDealDialog / канонический ручной flow

- Добавить в `CreateDealDialog` мост «Создать сделку и открыть ссылку на оплату» — по клику диалог закрывается и открывается `AdminPaymentLinkDialog` (`mode="contact"`) с предзаполненными `product/tariff`. Никакой параллельной формы, вся логика модулей/оплат остаётся в одном диалоге.
- Кроме того — под чекбоксом «только сделка без оплаты» (уже есть) — оставляем текущий upsert `orders_v2`.

### 5. Помощник состава документа

- `buildPurchaseCompositionTitle` уже канонический. Убедиться, что он вызывается в `invoice-checkout-issue`, `admin-invoice-checkout-issue`, `public-rr-installment-initiate`, `admin-rr-installment-initiate` и в `_shared/document-data-snapshot.ts` (проверено). Пустые аддоны → «Продукт, тариф X» без висячих знаков (уже так).

### 6. UI-стиль

Переиспользовать существующие glass-классы диалога; секция «Способ оплаты» — сегмент-контрол; блок «Счёт» — компактная карточка с select реквизитов и badge payer_type. Мобильный layout — сохранить существующий `sm:` брейкпоинт.

### 7. Тесты

Vitest:
- `AdminPaymentLinkDialog` selector: показывает 4 опции только при наличии соответствующих активных офферов (мок `useTariffOffers`).
- `invoice-checkout` наименование состава: 0/1/2/9 addons — правильная пунктуация (`buildPurchaseCompositionTitle` уже покрыт, расширить кейс «0 addons — без запятой/точки»).
- `composable-checkout` quote: 0/2/9 addons, 50% только addons, ручная корректировка, adjustment_reason required (уже частично покрыт).

Backend Deno tests (dry, без сети):
- `admin-invoice-checkout-issue` — контракт success (мок админ-клиента, проверка что вызывается materialize при 2+ items).
- `admin-rr-installment-initiate` — контракт: без callback ничего не активирует; идемпотентность повторного initiate.
- Regression: `rr-webhook` full/partial refund не ломает line items (интеграционный SQL уже есть — добавить кейс на composable order-group).

### 8. Verify → Publish

- `bunx vitest run` (frontend), `tsgo` typecheck, `bun run build`.
- Дeploy edge functions: `admin-invoice-checkout-issue`, `admin-rr-installment-initiate` (+ переиспользуемые уже задеплоены).
- Обновить `supabase/functions.registry.txt` (P1 блок).
- `preview_ui--publish` после успешных тестов.
- Production verification (read-only): `SELECT` на офферы «Бизнес-леди» подтверждает 4 доступных сценария; проверить в preview что диалог рендерит все 4 варианта и quote для 9 модулей возвращает 50% на addons.

## Технические заметки

- Никаких новых таблиц. Всё пишется в `orders_v2`, `order_groups`, `order_group_items`, `ai_generated_documents`, `payment_links`.
- Идемпотентность: writer'ы получают `idempotencyKey = f"admin-invoice:{user_id}:{offer_id}:{sha(addon_ids)}"` / RR — тот же `rr_get_or_create_pending_order` уже идемпотентен.
- Concurrency: RR — вся защита в существующих RPC (`rr_mark_call_started`, `rr_finalize_*`). Invoice — единичный INSERT + materialize wrapped в try/catch (уже реализовано в `invoice-checkout-issue`).
- Access grants: только через существующие post-payment триггеры (`grant-access-for-order`, `rr-fulfill-order`, `bepaid-webhook`). Ссылка/счёт/RR-initiate не выдаёт доступов.
- Refund preservation: реализовано `materializeComposableOrderGroup` (order-group + line items), тест добавляем поверх.
- Rollback: код-only, миграций нет; в случае regression функции возвращаются на предыдущий tag.

## Список изменяемых артефактов

**Frontend**
- `src/components/admin/AdminPaymentLinkDialog.tsx` — расширенный selector, ветки Invoice и RR, вызовы новых writer-ов.
- `src/components/admin/CreateDealDialog.tsx` — мост «сделка → оплата».
- (опц.) `src/components/admin/deals/*` — точка входа тем же путём.
- `src/hooks/useTariffOffers.ts` — если нужно расширить типы `offer_type`.

**Backend (новые узкие writer-ы)**
- `supabase/functions/admin-invoice-checkout-issue/index.ts`
- `supabase/functions/admin-rr-installment-initiate/index.ts`
- `supabase/functions.registry.txt` — добавить обе функции в P1.

**Tests**
- `src/components/admin/__tests__/AdminPaymentLinkDialog.selector.test.tsx`
- `src/lib/__tests__/purchaseCompositionTitle.test.ts` — расширить (0 addons).
- `supabase/functions/admin-invoice-checkout-issue/index.test.ts`
- `supabase/functions/admin-rr-installment-initiate/index.test.ts`

**Verify**
- `bunx vitest run`, `tsgo`, `bun run build`, deploy edge, `preview_ui--publish`.

## Definition of Done

1. В карточке контакта «Ссылка на оплату» → появляются 4 сценария (карта, внутренняя рассрочка, счёт ЮЛ/ИП, Ресурс развития), скрытые если оффер отсутствует.
2. Каждый сценарий поддерживает выбор 0..N модулей, ручную корректировку суммы с обязательной причиной, снапшот `composable_quote` и создание одной сделки/группы.
3. «Счёт» создаёт PDF через `canonical-document-generate-strict`; наименование = `buildPurchaseCompositionTitle` (без висячих знаков без addons); payer_type = ЮЛ/ИП/ФЛ.
4. «Ресурс развития» отдаёт redirect_url, callback материализует одну сделку и раздаёт доступы отдельно per product.
5. Все тесты зелёные; сборка чистая; publish выполнен; отчёт с точным перечнем изменений.
