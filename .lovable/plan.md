да, согласен, с учетом правок:

1. **F1 — обязательно**: блокировать оплату только если конфликт по тому же `product_id`. Чужая активная подписка не должна блокировать кнопку.
2. **F2 — обязательно**: поправить overflow без изменения дизайна: `min-w-0`, `w-full`, `flex-wrap`, `overflow-y-auto`, кнопки не должны вылезать.
3. **F3 — согласен с архитектурой через** `payment_links`, не через дублирование логики в `bepaid-create-token`.
4. **Перед новой edge function проверить существующие функции**:
  - `admin-create-public-link`
  - `create-payment-link`
  - `public-checkout`
  - возможный bridge-link
  Если можно расширить существующий writer безопасно — не создавать новую функцию.
5. **Gate рассрочки должен быть только** `payment_method='internal_installment'`, а не `is_installment`.
6. В `payment_links.meta.installment` явно добавить:
  - `installment_count`
  - `installment_interval_days`
  - `first_payment_delay_days`
  - `source='landing_payment_dialog'`
  - `offer_id`
7. DoD дополнить:
  - `installment_payments` создаются ровно в количестве `installment_count`;
  - нет лишних provider-managed подписок как у клуба;
  - после последнего платежа сработает Stage 3 completion logic.
  - &nbsp;
  - План:

## Контекст и diagnose

Проверены: `subscription-conflict.ts` (shared helper), `subscriptionReplacement.ts` (клиент), `PaymentDialog.tsx`, `UniversalPricingSection.tsx`, `public-checkout/index.ts`, данные `tariff_offers` для продукта `de36a695-...`.

### Находки

**Баг 1 — «уже есть активная подписка» при создании installment/one-time кнопки.**

- Shared helper `subscription-conflict.ts` уже фильтрует по `user_id + product_id` (не по всем подпискам). Это ОК.
- Но `existing_subscription_conflict` возвращается ТОЛЬКО из `bepaid-create-subscription-checkout` и `create-payment-checkout` (recurring path).
- На UI кнопка `handlePayment` блокируется при ЛЮБОМ `conflictData` (строка 1444): `disabled={... || !!conflictData}`. Если conflictData по другому продукту — это не должно блокировать оплату.
- Алерт «У вас уже есть активная подписка на этот продукт» показывается корректно только при `conflictData.product_id === productId`, но `disabled` на кнопке не учитывает этот же фильтр.
- Кроме того, при попытке КУПИТЬ installment-оффер (`payment_method='internal_installment'`) у которого `is_installment=false` — UI всё равно классифицирует его как обычный one-time (`isSubscription=false`), и в этом сценарии conflict-проверка вообще не должна срабатывать. Если пользователь видит её — значит реально открывается subscription-checkout, скорее всего из-за `requires_card_tokenization=true` на оффере.

**Баг 2 — кнопка вылезает за поля диалога на десктопе.**

- `DialogContent` (строка 1543): `sm:max-w-md` (~448px) + `overflow-hidden`.
- Conflict-alert (строка 1301) рендерит две кнопки в `flex flex-col sm:flex-row gap-2`. На десктопе они становятся в ряд, вторая («Заменить подписку» с иконкой `Repeat`) переполняет.
- Также основная кнопка «Оплатить 390 BYN» в `flex gap-2` (строка 1428) с двумя кнопками `flex-1` без `min-w-0` — иконка + длинный текст ломает layout.

**Баг 3 — рассрочка не работает с лендинговой кнопки.**

- В БД для тарифа «стандарт» есть оффер `32de637b-...` с `payment_method='internal_installment'`, `installment_count=2`, `is_installment=false`, `button_label='Оплатить в рассрочку'`.
- `UniversalPricingSection.tsx` (строка 148) пробрасывает только `isSubscription={offer.requires_card_tokenization}`. Поле `payment_method` НЕ пробрасывается в `PaymentDialog`.
- `PaymentDialog` → `bepaid-create-token` (one-time path) НЕ передаёт `installment`/`payment_method`. Edge function создаёт обычный платёж на полную сумму 390 BYN, без `installment_payments` и без `meta.installment.*`.
- Installment-flow реализован только через `/pay/:token` payment_links с предзаполненной `link.meta.installment` (admin-create-public-link). Прямой checkout с лендинга в обход payment_links — не поддерживает рассрочку.

## План фиксов

### F1. Sub-conflict: блокировать кнопку оплаты только для same-product

- В `PaymentDialog.tsx` (строка 1444): заменить `!!conflictData` на `(!!conflictData && conflictData.product_id === productId && isSubscription && !isTrial)`.
- Обоснование: alert (строка 1275) уже использует ту же тройную проверку. Кнопка должна быть симметрично заблокирована по тем же условиям.
- Дополнительно: в `setConflictData` после получения ответа из edge — оставить как есть (helper в edge уже фильтрует по product). На фронте дополнительной чистки не нужно.

### F2. Desktop overflow

В `PaymentDialog.tsx`:

- Строка 1301 (две кнопки в alert): добавить `min-w-0` к обеим кнопкам, иконку `Repeat` обернуть в `shrink-0`, текст — в `truncate`. Альтернатива: оставить кнопки колонкой и на десктопе (`flex-col` без `sm:flex-row`).
- Строка 1428 (Оплатить/Отмена): добавить `min-w-0` к обеим кнопкам, текст «Оплатить {price}» обернуть в `<span className="truncate">`.
- Проверить, что `DialogContent` не получает `overflow-hidden` без вертикального скролла на ready-step (строка 1543) — добавить `overflow-y-auto` если контент длинный.

### F3. Рассрочка с лендинговой кнопки

Архитектурное решение: переиспользовать существующий payment_links flow вместо дублирования логики installment в bepaid-create-token.

- Когда `offer.payment_method === 'internal_installment'`:
  1. Frontend (`UniversalPricingSection` / `PaymentDialog`) при клике на такой оффер вызывает новую edge `public-create-installment-link` (или расширяет существующую `payment-dialog-create-bridge-link`), которая:
    - Принимает `product_id`, `tariff_id`, `offer_id`, контактные данные.
    - Резолвит `offer.installment_count`, `offer.amount` → формирует `meta.installment = { selected_installment_months, per_payment_amount_byn, max_installment_months }`.
    - Создаёт `payment_links` строку (без вызова bePaid — только запись).
    - Возвращает `url_token`.
  2. Frontend сразу редиректит на `/pay/:token` — дальше уже работает существующий public-checkout → bepaid-webhook → installment_payments materialization.
- Альтернатива (простая): пробросить `payment_method` и `installment_count` в `bepaid-create-token`, добавить там branching на installment. Не рекомендуется — дублирует логику и обходит уже стабилизированный path через payment_links.
- В `UniversalPricingSection` пробросить `offer.payment_method` и `offer.installment_count` в `PaymentDialog` через новые props.
- В `PaymentDialog`:
  - Если `paymentMethod === 'internal_installment'` — показать выбор количества платежей (если `installment_count > 0` фиксирован — просто показать «N платежей по X BYN»).
  - При нажатии «Оплатить» → вызвать `public-create-installment-link` → редирект на `/pay/:token`.

### F0 (минимальная санация данных, opt-in)

Текущий оффер `32de637b-...` имеет `is_installment=false` при `payment_method='internal_installment'`. Это data-anomaly. После фикса F3 поле `is_installment` уже не используется как gate (gate = `payment_method`). Менять данные не нужно, но в админке `AdminProductDetailV2.tsx` (строка 566) `isInstallment = payment_method==='internal_installment'` — уже правильная логика. Старое поле `is_installment` deprecated, оставляем для совместимости.

## DoD

- F1: при наличии active subscription на ДРУГОМ продукте — кнопка «Оплатить» активна и оплата проходит.
- F2: на viewport 1048×893 кнопки в основном диалоге и в conflict-alert не выходят за границы DialogContent.
- F3: клик на «Оплатить в рассрочку» с лендинга → редирект на `/pay/:token` → один платёж 195 BYN (390/2) → после оплаты `orders_v2.meta.installment_count=2`, `installment_payments` ровно 2 строки, первая paid, вторая pending, `subscriptions_v2.auto_renew=false`.

## Технические детали (для разработки)

Файлы:

- `src/components/payment/PaymentDialog.tsx` — F1 (строка 1444), F2 (1301, 1428).
- `src/components/landing/UniversalPricingSection.tsx` — F3 (передача `paymentMethod`, `installmentCount` в PaymentDialog).
- `src/hooks/usePublicProduct.tsx` — убедиться что `payment_method`, `installment_count` приходят из `tariff_offers` (тип уже есть, проверить SELECT).
- Новая edge function `supabase/functions/public-create-installment-link/index.ts` (или расширение `payment-dialog-create-bridge-link`).
- Новый prop в PaymentDialogProps: `paymentMethod?: string`, `installmentCount?: number | null`.

Edge function `public-create-installment-link` контракт:

- Input: `{ product_id, tariff_id, offer_id, customer_email, customer_phone, customer_first_name, customer_last_name, existing_user_id? }`.
- Server-side fetch оффера и валидация `payment_method='internal_installment'` + `installment_count >= 2`.
- Расчёт `per_payment = round(amount / installment_count, 2)`.
- INSERT в `payment_links` с `meta.installment = { selected_installment_months: N, per_payment_amount_byn, max_installment_months: N }` и `payment_type='one_time'`, `amount = per_payment * 100` (kopecks).
- Output: `{ success: true, url_token }`.

После approve выполню по порядку: F1 → F2 → F3 → smoke по протоколу из `.lovable/proofs/installment_l3_5_smoke_protocol.md`.