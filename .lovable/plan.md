# да, согласен

План принят. Можно выполнять PATCH-STRIPE-UI-INTEGRATION-CLEANUP-V1.

Обязательное уточнение перед Execute:

# Не допускается частичная UI-реализация

Нельзя снова сделать временное решение вида:

text Stripe сверху отдельным блоком bePaid ниже отдельной таблицей 

Результат должен быть только такой:

text одна таблица «Подписки» одна таблица «Автопродления» одна таблица «Платежи» provider-aware строки внутри существующего UI 

Stripe должен быть встроен в существующие таблицы, фильтры, статусы, действия и receipt UX так же, как bePaid.

---

# Дополнительный proof по parity

В proof обязательно добавить отдельный раздел:

text bePaid parity checklist 

Проверить и показать:

## Подписки

- bePaid и Stripe отображаются в одной таблице;

- одинаковые бизнес-колонки;

- provider-specific действия не смешиваются;

- Stripe не рендерится отдельным блоком;

- фильтр по provider работает.

## Автопродления

- bePaid строки остались как были;

- Stripe recurring строки добавлены только при валидном sub_*, auto_renew=true, next_charge_at;

- layout не съехал.

## Cancel

- Stripe cancel повторяет bePaid cancel behavior:

  - рекуррент отменён;

  - доступ не отозван;

  - refund не создан;

  - платежи/заказы не изменены;

  - подписка исчезла из активной карточки контакта;

  - новую подписку можно создать.

## Документы

- Stripe payment row открывает документ оплаты;

- Stripe refund row открывает документ возврата / Stripe hosted page с refund information;

- payment row не открывает refund-документ;

- refund row не пишет «документ не получен», если URL есть;

- UI-кнопка такая же по стилю, как у bePaid.

## Navigation

- «Проблемы с оплатой» скрыта из UI;

- legacy route не удалён.

---

# Execute разрешён

Начинай с Discovery, затем выполняй PATCH по этапам A–G.

DoD остаётся как в плане:

text PASS ⇔ все Verify зелёные, Stripe встроен в единые provider-aware разделы, bePaid не сломан. 

&nbsp;

План: PATCH-STRIPE-UI-INTEGRATION-CLEANUP-V1 (revised)

## Бизнес-принцип (фундамент всего патча)

Три независимые сущности — **никогда не смешивать автоматически**:

1. **Рекуррент / автосписание** (subscriptions_v2 + provider_subscriptions)
2. **Оплаченный доступ** (entitlements + access_end_at)
3. **Возврат денег** (payments_v2 refund row)

Cancel рекуррента ≠ revoke access ≠ refund. Каждая операция — отдельная кнопка, отдельная edge-функция, отдельный audit.

---

## Discovery (read-only, обязательный pre-step)

1. `BepaidSubscriptionsTabContent` + `BepaidSubscriptionsList` — текущий query/row model, какие действия provider-specific.
2. `StripeSubscriptionsList.tsx` — удаление как отдельного блока.
3. `AutoRenewalsTabContent` — фильтр когорты (`tariff_offers.meta.recurring.is_recurring=true` per memory) + layout issues.
4. `PaymentsTable` + receipt actions (`ReceiptStatusBadge` и пр.) — общий компонент для bePaid documents.
5. Карточка контакта — компонент с блоком «Подписки» (где «Следующее списание: —» и «Отменить (Stripe)»). Определить query.
6. `stripe-subscription-action` edge function (уже существует, см. `StripeSubscriptionActionsBlock`) — текущее поведение `cancel_at_period_end` / `cancel_now`. **Не дублировать**, переиспользовать.
7. `stripe-webhook` — пишет ли `customer.subscription.updated` → `subscriptions_v2.meta.stripe.current_period_end`. SQL-проверка для активной подписки Сергея (`sub_1TgWoO6UYJj2vm0Gjc9P0jxH`).
8. SQL: `payments_v2.meta.stripe.*` для $2 payment и $5 refund — какие URL уже есть (`receipt_url`, `invoice_pdf`, `hosted_invoice_url`, `refund.receipt_url`).
9. `tariff_offers.meta.recurring` для текущего Stripe-тарифа — зафиксировать `interval` / `interval_count` (для proof, не менять).

---

## PATCH-A — Unified Subscriptions Table (add-only)

**Цель:** одна provider-aware таблица «Подписки» во вкладке `/admin/payments/bepaid-subscriptions` (route legacy сохраняется).

**Реализация — строго add-only:**

- Удалить из `BepaidSubscriptionsTabContent` импорт и рендер отдельного `StripeSubscriptionsList` сверху.
- Расширить существующий reader/таблицу `BepaidSubscriptionsList` на `provider_subscriptions.provider IN ('bepaid','stripe')`. Не переписывать таблицу с нуля.
- Все bePaid-specific колонки и действия — сохранить. Stripe-rows маппятся в ту же row model.
- Stripe mapping:
  - amount/currency — из `subscriptions_v2.meta.amount_byn`+`meta.currency` или `meta.stripe.price`; для Stripe — реальная валюта (USD/EUR/PLN/BYN), без приведения.
  - next_charge_at — `meta.stripe.current_period_end` → `provider_subscriptions.meta.current_period_end` → fallback `access_end_at` (с другой подписью, см. PATCH-D).
  - last_payment_at — `payments_v2.paid_at` (max) по `subscription_v2_id`.
  - payment_method — `meta.stripe.default_payment_method` brand (если есть).
- Действия — **provider-aware**: bePaid actions показываются только при `provider='bepaid'`, Stripe actions — только при `provider='stripe'`.

**Колонки (только бизнес-названия, RU):**
ID подписки · Провайдер · Статус · Клиент · Продукт/тариф · Сумма · Валюта · Создана · Последняя оплата · Следующее списание · Метод оплаты · ID платежа · Сделка · Связь · Действия.

Технические `subv2_id` / `Stripe ID` / `Состояние (state)` — НЕ в основные колонки. Допустимо сокращённый ID + copy-button.

**Локализация статусов:**
active → Активна, pending → Ожидает оплаты, canceled → Отменена, past_due → Просрочена, payment_failed → Ошибка оплаты, completed → Завершена.

**Фильтр «Провайдер»:** Все / bePaid / Stripe (динамически из distinct). Pending не смешивать с активными — отдельный статус.

---

## PATCH-B — AutoRenewals: provider-aware + fix layout

**Когорта Stripe** (строгие условия, по аналогии с bePaid SOT):

```
provider = 'stripe'
status IN ('active','trialing','past_due')
auto_renew = true
provider_subscription_id LIKE 'sub_%'
next_charge_at IS NOT NULL   -- из meta.stripe.current_period_end
```

Если `next_charge_at` нет — строка идёт в отдельный warning-фильтр («Без даты следующего списания»), а не в основной список (чтобы не ломать таблицу).

**UI fix:**

- Снять жёсткие узкие `width`, поставить `min-w-*` на ключевые колонки.
- Не использовать `table-fixed`, либо задать sensible widths.
- Горизонтальный scroll только при переполнении.
- Provider badge bePaid/Stripe.
- Колонки: Контакт · Продукт · Провайдер · Сумма · Валюта · Следующее списание · Последнее списание · Попытки · Метод · Статус · Связь · Действия.

bePaid строки не должны измениться визуально.

---

## PATCH-C — Stripe cancel = bePaid cancel parity

**Принцип:** кнопка «Отменить» отменяет только рекуррент. Доступ/entitlements/telegram/orders/payments — не трогаются.

**Backend** (`stripe-subscription-action`, переиспользовать существующий):

- Использовать action `cancel_now` → `stripe.subscriptions.cancel(id)` для immediate cancel рекуррента.
- Локально:
  ```
  subscriptions_v2.status = 'canceled'
  subscriptions_v2.auto_renew = false
  subscriptions_v2.canceled_at = now()
  provider_subscriptions.state/status = 'canceled'
  provider_subscriptions.canceled_at = now()
  ```
- **НЕ менять:** `access_end_at`, `entitlements`, `access_grant_ledger`, `telegram_access`, `orders_v2`, `payments_v2`.

**STOP-guards (перед cancel):**

- `provider = 'stripe'`
- `provider_subscription_id LIKE 'sub_%'` (НЕ `pending:*`)
- subscription exists in Stripe
- local sub принадлежит ожидаемому user/profile
- Stripe status ∈ (active, trialing, past_due)

**Edge cases:**

- Если `provider_subscription_id` начинается с `pending:` — кнопку «Отменить» не показывать; edge возвращает `cannot_cancel_pending_subscription`.
- Если Stripe уже `canceled` — не ошибка, только синхронизация локального статуса, success.

**UI:**

- В карточке контакта и в таблице «Подписки» кнопка «Отменить» (без `(Stripe)` суффикса в caption — provider в badge).
- Confirm dialog: «Подписка отменяется. Будущих списаний не будет. Доступ сохраняется до {access_end_at}. Деньги не возвращаются.»
- После cancel: подписка пропадает из активного блока карточки контакта; видна только в общей таблице под фильтром «Отменена»/«Все».

**Conflict guard для новой подписки:**
Создание новой подписки на тот же продукт блокируется только если существует:

```
status IN ('active','trialing','past_due') AND auto_renew=true
AND provider_subscription_id NOT LIKE 'pending:%'
```

Canceled subscriptions не блокируют. Перекрытие access-окон допустимо.

---

## PATCH-D — «Следующее списание» vs «Доступ до» (карточка контакта)

В блоке «Подписки» карточки контакта показывать **две даты раздельно**:

```
Следующее списание: DD.MM.YYYY
Доступ до:          DD.MM.YYYY
```

**Резолвер `next_charge_at`:**

1. `subscriptions_v2.meta.stripe.current_period_end` (epoch → ISO)
2. `provider_subscriptions.meta.current_period_end`
3. Для bePaid — существующий резолвер (без изменений)
4. Если ни одного — показывать «—», НЕ подменять на `access_end_at`.

**Резолвер `access_until`:** всегда `subscriptions_v2.access_end_at`.

**Webhook check (discovery):** убедиться, что `stripe-webhook` на `customer.subscription.created/updated` пишет `current_period_end` в `subscriptions_v2.meta.stripe`. Если для подписки Сергея пусто — одноразовый pull через существующий sync-механизм (без массовой миграции).

---

## PATCH-E — Payments documents parity

**Текущая проблема:** payment row открывает refund-документ; refund row пишет «документ не получен»; для Stripe рисуется отдельный «Invoice PDF» текстом.

**Решение:** единая иконка/кнопка документа (тот же компонент, что для bePaid).

**Mapping для Stripe payment row:**

1. `meta.stripe.charge.receipt_url`
2. `meta.stripe.invoice.hosted_invoice_url`
3. `meta.stripe.invoice.invoice_pdf`
4. Stripe hosted payment page fallback

Caption: «Открыть чек» (как у bePaid). Payment row **никогда** не открывает refund URL.

**Mapping для Stripe refund row:**

1. `meta.stripe.refund.receipt_url` (если Stripe выдал)
2. `meta.stripe.charge.receipt_url` (с refund information)
3. `meta.stripe.invoice.hosted_invoice_url` (credit note, если есть)
4. Stripe hosted payment page (последний fallback)

Caption: «Открыть документ Stripe» / «Открыть квитанцию Stripe» если нет отдельного refund PDF.

**Запрет:** не писать «документ ещё не получен», если есть **любой** Stripe hosted URL.

**Не изобретать новые компоненты** — переиспользовать существующий receipt-action component bePaid.

---

## PATCH-F — Скрыть «Проблемы с оплатой»

- Убрать tab-trigger из `AdminPaymentsHub` nav.
- Route `/admin/payments/payment-issues` оставить legacy hidden (прямой URL работает).
- Backend / data logic / `PaymentIssuesTabContent` не удалять.

---

## PATCH-G — PublicPayPage final check (verify only)

Прочитать текущий `PublicPayPage.tsx`, зафиксировать в proof: для Stripe subscription нет disabled bePaid card, нет «Белорусская карта», CTA → Stripe Checkout/Apple Pay. Если уже OK — только proof, без изменений.

---

## Stripe recurring period (НЕ менять, только зафиксировать)

В этом PATCH периодичность Stripe не меняется. Зафиксировать в proof текущие значения `interval` / `interval_count` для активной подписки.

**В backlog:** `PATCH-STRIPE-BILLING-PERIOD-MODE-V2`:

- Явный billing_mode на тарифе: `every_N_days` (bePaid parity) / `calendar_month` (Stripe).
- UI labels: «каждые 30 дней» vs «ежемесячно в дату оформления».
- Пересчёт `next_charge_at` и публичных текстов.

---

## Что НЕ делать

- Не менять `grant-access-for-order`, не писать в `entitlements` напрямую.
- Не отзывать доступ при cancel.
- Не делать refund автоматически при cancel.
- Не менять `access_end_at` при cancel.
- Не менять Stripe interval/interval_count.
- Не удалять `StripeSubscriptionsList.tsx` файл (только убрать импорт из вкладки) — может пригодиться для дебага.
- Не удалять route `/admin/payments/payment-issues`.
- Не делать миграций без явного dry-run/rowcount.
- Не ломать bePaid checkout/cancel/documents/auto-renewals.
- Не показывать английские статусы и технические поля (`subv2`, `Stripe ID`, `state`) в основной таблице.

---

## Verify (acceptance)

**Подписки** `/admin/payments/bepaid-subscriptions`:

- одна таблица, нет отдельного Stripe-блока сверху;
- активная Stripe-подписка Сергея видна: клиент, продукт «Платная консультация — Несрочная консультация», 2.00 USD, Stripe badge, Активна, последняя оплата 10.06.26, следующее списание определено или «—» (не подменено);
- provider filter работает;
- bePaid строки не изменились.

**Cancel Stripe:**

- кнопка «Отменить» доступна только для реальных `sub_*`;
- после cancel: status='canceled', auto_renew=false; access_end_at не изменился; entitlements целы;
- подписка исчезла из активного блока карточки контакта;
- видна в «Подписках» под фильтром «Отменена/Все»;
- можно создать новую подписку на тот же продукт.

**Карточка контакта:**

- две отдельные даты «Следующее списание» и «Доступ до»;
- для активной Stripe-подписки «Следующее списание» заполнено реальной датой из meta.

**Автопродления** `/admin/payments/auto-renewals`:

- layout не съехал;
- Stripe active recurring subscription с next billing date — видна с provider badge;
- Stripe subscriptions без next_charge_at — не ломают таблицу (отдельный warning/filter);
- bePaid строки целы.

**Платежи** `/admin/payments`:

- Stripe payment $2 — единая кнопка «Открыть чек», открывает документ оплаты;
- Stripe refund 5 BYN — единая кнопка, открывает документ возврата / hosted page с refund info;
- нет текстовых «Invoice PDF»;
- payment row не открывает refund URL и наоборот;
- нет ложного «документ ещё не получен», если есть любой URL.

**Навигация:** tab «Проблемы с оплатой» скрыт; прямой URL работает (read-only).

**Regression:** bePaid подписки/автопродления/документы/cancel — без изменений.

---

## Proof

`.lovable/proofs/stripe_ui_provider_parity_cleanup_v1.md`:

1. **Before/after скриншоты:** отдельный Stripe-блок исчез; единая таблица; provider filter; AutoRenewals fixed; payments documents унифицированы; «Проблемы с оплатой» скрыты.
2. **Cancel proof:** SQL до/после (`subscriptions_v2.status`, `auto_renew`, `canceled_at`, `access_end_at`, `entitlements` count), подтверждение что доступ не отозван, новая подписка не блокируется.
3. **Documents proof:** для $2 payment и $5 refund — какие URL были в meta до, какой URL открывает кнопка после.
4. **Recurring period proof:** текущий `interval`/`interval_count` (зафиксировано без изменений); ссылка на backlog `PATCH-STRIPE-BILLING-PERIOD-MODE-V2`.
5. **Regression proof:** bePaid subscriptions/auto-renewals/documents целы (счётчики до/после).
6. Без миграций. Если потребуется точечный backfill `meta.stripe.current_period_end` — отдельный dry-run + rowcount.

---

## DoD (обновлённый)

PASS ⇔ все пункты Verify зелёные, и:

- отдельный `StripeSubscriptionsList` как блок не рендерится;
- Stripe и bePaid в одной таблице;
- у Stripe-строки есть клиент/продукт/сумма/валюта/статус/последняя оплата/следующее списание (или «—» честное)/доступ до;
- фильтр по provider работает;
- AutoRenewals не съехал, Stripe только валидные recurring;
- Stripe cancel = bePaid behavior (рекуррент off, доступ цел);
- pending:* подписки нельзя отменить;
- после cancel — можно создать новую подписку;
- карточка контакта показывает обе даты корректно;
- Stripe payment/refund документы — единый icon-button UX;
- payment row → документ оплаты; refund row → документ возврата;
- «Проблемы с оплатой» скрыта;
- Stripe interval не менялся (зафиксировано в proof);
- bePaid checkout/cancel/documents/auto-renewals не сломаны;
- статусы и колонки только русские, технические ID — сокращённо + copy.