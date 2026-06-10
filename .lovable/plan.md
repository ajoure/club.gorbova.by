Да, согласен, с учетом правок.

План Stage 2D принимается, но нужно добавить обязательный Stage 2E: Stripe payer/card data parity в столбце «Плательщик».

# Дополнение к Stage 2D / Stage 2E

## Новая проблема

В /admin/payments в столбце:

text Плательщик 

для Stripe payment/refund сейчас отображается:

text Без данных Метод оплаты: Без данных Данные карты недоступны 

Это неправильно.

По Stripe-платежам должны отображаться данные карты так же, как по bePaid:

text VISA **** 3587 

или:

text Apple Pay / VISA **** 3587 

если платёж был через Apple Pay.

На скрине Stripe payment/refund строки показывают «Без данных», хотя карта известна по Stripe и уже использовалась в этих платежах.

---

# Stage 2D — принимается

Stage 2D выполняем как в плане:

1. В карточке контакта разделить:

   text    Следующее списание    Доступ до    

2. Не подменять next_charge_at через access_end_at.

3. PublicPayPage Stripe subscription final proof.

4. Зафиксировать Stripe recurring:

   text    interval    interval_count    collection_method    

5. Периодичность Stripe в этом PATCH не менять.

---

# Stage 2E — Stripe payer/card data parity в PaymentsTable

## Цель

Stripe payment/refund строки в таблице «Платежи» должны показывать карту/метод оплаты в колонке «Плательщик» так же, как bePaid.

Не должно быть:

text Без данных 

если Stripe metadata содержит card/payment method data или если данные можно взять из связанной parent payment строки.

---

# Discovery Stage 2E

Проверить read-only:

## 1. Stripe payment $2

Посмотреть:

sql select id, provider, provider_payment_id, transaction_type, amount, currency,        receipt_url, meta from payments_v2 where provider='stripe' order by created_at desc; 

Найти в meta:

text payment_method_details card brand last4 wallet apple_pay payment_method_id charge payment_intent 

## 2. Stripe payment +5 BYN

Проверить, есть ли:

text VISA last4 = 3587 wallet / apple_pay 

в payments_v2.meta, provider_response, stripe.card, charge.payment_method_details.

## 3. Stripe refund -5 BYN

Refund row должен наследовать payer/card data от parent payment:

text parent_payment_id meta.parent_payment_id meta.parent_payment_uid payment_intent_id 

Если refund сам не содержит card data, использовать parent payment card snapshot.

---

# Required mapping для payer/card

Добавить derived fields в useUnifiedPayments.tsx:

ts payer_card_brand payer_card_last4 payer_card_wallet payer_card_exp_month payer_card_exp_year payer_display 

SOT остаётся payments_v2.meta / parent payment meta.

## Priority для Stripe payment row

text 1. meta.stripe.payment_method_details.card.brand / last4 2. meta.stripe.charge.payment_method_details.card.brand / last4 3. meta.stripe.card.brand / last4 4. meta.provider_response.stripe.payment_method_details.card 5. meta.provider_response.stripe.charge.payment_method_details.card 6. existing card_* fields, если есть 7. null 

Если wallet:

text meta.stripe.payment_method_details.card.wallet.type = apple_pay 

то display:

text Apple Pay · VISA **** 3587 

Иначе:

text VISA **** 3587 

## Priority для Stripe refund row

Refund row:

text 1. собственные card fields, если есть 2. parent payment card data через parent_payment_id 3. parent payment card data через parent_payment_uid / provider_payment_id 4. null 

Refund должен отображать карту родительского платежа, потому что возврат идёт на ту же карту.

---

# UI Stage 2E

В PaymentsTable.tsx в колонке «Плательщик»:

## Для Stripe payment/refund

Если card data есть, показывать:

text VISA **** 3587 

или:

text Apple Pay · VISA **** 3587 

Provider badge уже есть отдельно, его не дублировать.

## Если card data нет

Показывать:

text Карта не определена 

или:

text Метод оплаты не сохранён 

но не общий Без данных, если это технически означает «мы не достали карту».

Tooltip:

text Данные карты не сохранены в Stripe metadata 

---

# Важно по refund

Для Stripe refund row:

- сумма -5.00 BYN;

- тип Возврат;

- payer/card должен быть тем же, что у parent payment:

  text   VISA **** 3587   

- документ refund открывается через Stage 2C mapping.

---

# Что НЕ делать

Не делать:

- не делать сетевые Stripe API вызовы из frontend;

- не добавлять новую edge function только ради UI;

- не менять payments_v2 без отдельного backfill;

- не ломать bePaid payer display;

- не смешивать payer card с customer/contact;

- не показывать полный PAN карты;

- не показывать CVC/expiry, если это не нужно.

---

# Если данных карты реально нет в БД

Если discovery покажет, что в payments_v2.meta по Stripe нет card data, тогда:

1. Не делать вид, что всё ок.

2. Зафиксировать в proof:

   text    card data missing in local Stripe payment meta    

3. Добавить follow-up:

   text    PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2    

4. Scope follow-up:

   - при webhook/materialization сохранять payment_method_details.card.brand/last4/wallet;

   - для старых Stripe payments сделать targeted enrichment через Stripe API;

   - refund rows наследуют card snapshot от parent payment.

Но если данные уже есть в meta — Stage 2E должен быть закрыт сейчас.

---

# Stage 2D + 2E Verify

## Stage 2D

Проверить:

- карточка контакта показывает:

  text   Следующее списание: ...   Доступ до: ...   

- access_end_at не маскируется под next_charge_at;

- PublicPayPage Stripe subscription без bePaid card/text;

- Stripe interval/interval_count зафиксирован.

## Stage 2E

Проверить /admin/payments:

### Stripe payment $2

Ожидаемо:

text Плательщик: VISA **** 3587 

или Apple Pay variant, если был Apple Pay.

### Stripe payment +5 BYN

Ожидаемо:

text Плательщик: VISA **** 3587 

### Stripe refund -5 BYN

Ожидаемо:

text Плательщик: VISA **** 3587 

через parent payment.

### bePaid regression

bePaid строки продолжают показывать карты как раньше:

text Mastercard **** 1468 Visa **** 0145 

---

# Proof additions

В .lovable/proofs/stripe_ui_provider_parity_cleanup_[v1.md](http://v1.md) добавить:

## Stage 2E proof

1. Before screenshot:

   - Stripe rows показывают «Без данных».

2. SQL/meta snapshot:

   - Stripe $2 payment card fields;

   - Stripe +5 BYN payment card fields;

   - Stripe -5 BYN refund parent link.

3. After screenshot:

   - Stripe rows показывают карту/метод оплаты;

   - refund row наследует карту parent payment.

4. Regression:

   - bePaid payer column не изменился.

---

# Updated DoD

PATCH не закрывать, пока:

- Stage 2D = PASS;

- Stage 2E = PASS;

- Stripe payer/card data больше не показывает «Без данных», если данные есть;

- refund inherits parent card data;

- bePaid payer display не сломан;

- final proof обновлён.

Начинай Stage 2D + Stage 2E.

&nbsp;

План: Stage 2D — next_charge_at / access_until + PublicPayPage proof (PATCH-STRIPE-UI-INTEGRATION-CLEANUP-V1)

## Цель

Завершить PATCH:

1. Карточка контакта корректно показывает «Следующее списание» и «Доступ до» отдельно, с приоритетом Stripe-источников для `next_charge_at`.
2. PublicPayPage Stripe subscription чист от bePaid-текстов и disabled bePaid-карт (подтвердить proof, без изменений если уже ок).
3. Зафиксировать Stripe recurring `interval`/`interval_count` в proof (без изменения периодичности).
4. Обновить `.lovable/proofs/stripe_ui_provider_parity_cleanup_v1.md` с before/after скринами и SQL-сниппетами.

## Изменения в коде (минимальные)

### 1) `src/components/admin/ContactDetailSheet.tsx` (только блок healthyProviderSubs, строки ~2235–2330)

Поменять резолвер `nextCharge` на канонический приоритет:

```
nextCharge =
  1) sub.subscriptions_v2?.meta?.stripe?.current_period_end (unix sec → ISO)
  2) sub.meta?.stripe?.current_period_end (unix sec → ISO)
  3) sub.subscriptions_v2?.meta?.current_period_end (если когда-нибудь сохранено)
  4) sub.next_charge_at (bePaid-резолвер, как сейчас)
  5) sub.subscriptions_v2?.next_charge_at
  → иначе null
```

Правила отображения (контракт Stage 2D):

- Строка «Следующее списание: DD.MM.YYYY HH:mm — amount» — рисуется ТОЛЬКО когда `nextCharge` резолвится; иначе `Следующее списание: —` (как сейчас, не меняем).
- ❗ Не подменять `next_charge_at` через `access_end_at`. Если резолверы 1–5 вернули null — оставить `—`, даже если `accessEnd` известно.
- Строка «Доступ до …» рисуется независимо, по существующему `accessEnd` (db → provider_snapshot.active_to), без изменений.

В запрос подписок (`ContactDetailSheet.tsx` ~748–760) добавить `meta` в выборку `subscriptions_v2` и `provider_subscriptions`, если ещё не выбирается (проверить и расширить только select-list, без новых join'ов и без изменения RLS-доступа).

Маленький helper `resolveNextChargeAt(sub)` — рядом с компонентом или в `src/utils/`, чтобы тот же приоритет был переиспользуемым (read-only). Никаких записей в БД, никаких новых RPC.

### 2) `src/pages/PublicPayPage.tsx` — без изменений

Текущее поведение уже соответствует требованию:

- `isStripeSubscription` отключает `showSubscriptionDisabledCards` и `showSubscriptionFallbackHint`.
- `showStripeSubscriptionHint` рисует чистый Stripe-текст без слова «bePaid»/«Белорусская карта».
- CTA Stripe subscription уходит в Stripe Checkout (без изменений в этом стейдже).

Только зафиксировать факт в proof со скрином.

## Discovery / proof (read-only SQL)

В `.lovable/proofs/stripe_ui_provider_parity_cleanup_v1.md` добавить раздел Stage 2D:

1. SQL для recurring параметров Stripe-подписки Сергея:

```sql
select id, status, access_end_at, next_charge_at,
       meta->'stripe'->>'current_period_end' as cpe,
       meta->'stripe'->>'subscription_id'    as stripe_sub,
       meta->'stripe'->>'collection_method'  as collection_method,
       meta->'stripe'->'price'                as price,
       meta->'stripe'->'recurring'            as recurring
from subscriptions_v2
where id in (...sergey subv2...);
```

В proof — JSON-snapshot с полями `interval`, `interval_count`, `billing_mode` (как есть; ничего не меняем).

2. SQL для provider_subscriptions parity:

```sql
select id, provider, state, last_charge_at,
       meta->'stripe'->>'current_period_end' as cpe,
       meta->'current_period_end'            as cpe_flat
from provider_subscriptions
where provider='stripe' order by created_at desc limit 20;
```

3. UI-скрины (after):
  - Карточка контакта Сергея: одновременно видны «Следующее списание: —» (или дата из Stripe) и «Доступ до: …» — раздельно.
  - PublicPayPage Stripe-subscription ссылка: нет disabled bePaid-карт, нет текста «Белорусская карта», виден Stripe-hint, CTA ведёт в Stripe Checkout.
  - Stripe-сабка Сергея сейчас `canceled` → текущий next_charge = null; для after-скрина показать кейс с активной Stripe-сабкой, если появится; иначе зафиксировать «нет активной recurring → ожидаемо `—`».
4. Backlog (НЕ в этом PATCH):
  - `PATCH-STRIPE-BILLING-PERIOD-MODE-V2` — изменение периодичности recurring (interval/interval_count) и admin UI.
  - Добавить в `.lovable/backlog/` короткий файл-указатель.

## DoD

- Контакт-карточка использует новый резолвер next_charge_at (Stripe meta → bePaid → null), `access_end_at` НЕ маскируется под дату списания.
- `Следующее списание: —` корректно показывается, когда нет ни одного из источников.
- `Доступ до …` рисуется отдельно как и раньше.
- PublicPayPage Stripe-subscription чист — proof со скрином.
- В proof зафиксированы Stripe `interval` / `interval_count` / `collection_method` как есть.
- В proof файл `stripe_ui_provider_parity_cleanup_v1.md` помечен Stage 2D = PASS; добавлен Final Proof: Stages 1, 2A, 2B, 2C, 2D = PASS.
- bePaid карточка контакта не сломана (regression-скрин bePaid-подписки).
- Никаких изменений в edge functions, в `cancel`-логике Stripe, в публичной checkout-схеме.

## Файлы

- edit: `src/components/admin/ContactDetailSheet.tsx` (резолвер next_charge_at + расширение select при необходимости)
- new (опц.): `src/utils/resolveStripeNextChargeAt.ts` (тонкий helper)
- edit: `.lovable/proofs/stripe_ui_provider_parity_cleanup_v1.md` (Stage 2D + Final proof)
- new: `.lovable/backlog/stripe_billing_period_mode_v2.md` (one-pager)