да, согласен, с учетом правок:

1. Зафиксировать SOT явно: **единственный источник типа продукта для продления —** `tariff_offers.meta.recurring.is_recurring`, который управляется чекбоксом «Подписка (автопродление)».
2. Не использовать как SOT:
  - `requires_card_tokenization`
  - `payment_method`
  - наличие active SBS
  - `subscriptions_v2.billing_type`
  - название/slug/code продукта
3. Добавить guard/test:
  - если чекбокс включён → reminder считает продукт продлеваемым;
  - если выключен → reminder считает продукт разовым;
  - отсутствие active SBS не делает продукт разовым.
4. В план добавить проверку конкретного тарифа BUSINESS:
  - `meta.recurring.is_recurring=true`
  - resolver возвращает `hasSubscriptionOffer=true`.
5. Все тексты/кнопки напоминаний строить только через `renewal-offer-resolver`.

Можно выполнять.

&nbsp;

План:

## Diagnose

Пользователь требует канонизировать SOT для типа продукта: **чекбокс «Подписка (автопродление)» на pay_now-оффере = единственный источник истины**. Если он включён → продукт продлеваемый, со всей соответствующей логикой (recurring-напоминания, кнопки «Продлить», авто-списание). Если выключен → продукт разовый, без напоминаний на продление и без кнопок оплаты в авто-уведомлениях.

Проверка текущего состояния:

- UI (`AdminProductDetailV2.tsx`, строки 588-624): чекбокс «Подписка (автопродление)» (поле `requires_card_tokenization` в форме) пишет `tariff_offers.meta.recurring.is_recurring=true` + одновременно ставит колонку `requires_card_tokenization=true`.
- Резолвер (`_shared/renewal-offer-resolver.ts`): читает строго `meta.recurring.is_recurring`, плюс `payment_method='internal_installment'` (рассрочка), плюс `offer_type='subscription'`. Колонка `requires_card_tokenization` намеренно НЕ используется.
- Reminders (`subscription-renewal-reminders/index.ts:135`): прямо в комментарии зафиксировано «requires_card_tokenization is used as a SECONDARY signal (logged in meta only), never as sole source of truth». Решение принимает только `resolveProductRenewability`.
- Фактическая проверка офферов BUSINESS/FULL/CHAT (Gorbova Club): все активные pay_now-офферы корректно имеют `meta.recurring.is_recurring=true`. Резолвер их видит как recurring.

Вывод: **архитектура уже соответствует требованию**. Канонизировать нужно три вещи:

1. Закрепить контракт в memory как Core-rule, чтобы будущие правки не разъезжались.
2. Добавить grep-guard / проверку, чтобы не появлялись эвристики типа «если `requires_card_tokenization` → это подписка» в обход резолвера.
3. Убедиться, что **все** места, принимающие решение «продлеваемый ли продукт», ходят через `resolveProductRenewability`.

## План правок

### 1. Аудит всех точек принятия решения «recurring vs one-time»

Прогон по edge-функциям и фронту: найти все места, где напрямую читаются `requires_card_tokenization`, `is_subscription`, `subscription`, или вычисляется флаг подписки. Каждое такое место либо

- заменить на вызов `resolveProductRenewability(productId, tariffId)`,
- либо — если речь про сам процесс оплаты (биллинг-флоу), оставить, но добавить комментарий «биллинг, не классификация».

Ожидаемые «нарушители» для проверки:

- `telegram-send-reminders`
- `subscription-charge`
- `bepaid-*` функции
- `generate-renewal-ctas`
- `AdminPaymentLinkDialog` (UI ветка «телеграм-кнопки»)
- любые другие edge-функции, формирующие напоминания / кнопки продления.

### 2. Hardening UI карточки тарифа

В `AdminProductDetailV2.tsx`:

- Переименовать в UI лейбл/help-text чекбокса так, чтобы было однозначно: **«Это подписка (автопродление)»** + подпись «Если выключено — продукт считается разовым».
- При сохранении явно гарантировать: `meta.recurring.is_recurring === offerForm.requires_card_tokenization (для pay_now/full_payment)` — никогда не отдельная колонка как источник.
- Disabled-состояние: для `internal_installment` чекбокс «Подписка» должен быть скрыт/disabled (рассрочка ≠ подписка, но это recurring другой природы).

### 3. Renewal Offer Resolver — публичный контракт

Добавить в `renewal-offer-resolver.ts` короткий jsdoc-блок «**Source of truth = `tariff_offers.meta.recurring.is_recurring**`. Никакая колонка вне этого пути не определяет продлеваемость. `requires_card_tokenization` — биллинг-сигнал, не классификация.»

### 4. Memory rule

Сохранить новую memory `mem://commercial-logic/products/product-type-source-of-truth`:

- Type = `feature`
- Rule: «Тип продукта (recurring vs one-time) определяется ТОЛЬКО через `resolveProductRenewability` поверх `tariff_offers.meta.recurring.is_recurring` / `payment_method='internal_installment'` / `offer_type='subscription'`. UI-чекбокс «Подписка (автопродление)» — единственное место, где это поле выставляется.»

Добавить в Core-секцию index одну строку: «Product type SOT: tariff_offers.meta.recurring.is_recurring через resolveProductRenewability. Эвристики по requires_card_tokenization запрещены.»

### 5. DoD

- Аудит: список найденных мест, для каждого помечено «фикс» или «биллинг, оставляем».
- Все «фикс»-места переведены на `resolveProductRenewability`.
- В `AdminProductDetailV2.tsx` — обновлённый лейбл/подпись и инвариант сохранения.
- Memory-файл создан, index обновлён.
- Grep-guard-проверка вручную:
  - `rg -n "requires_card_tokenization" supabase/functions/_shared/renewal-offer-resolver.ts` → пусто (или только в комментарии-предупреждении).
  - `rg -n "is_subscription\|isSubscription" supabase/functions` → не используется как классификатор продукта (только как описание состояния пользовательской подписки).

Подтвердите план — выполняю аудит и правки.