да, согласен, с учетом правок:

## **1. План правильный**

Сейчас ключевая правка сформулирована верно:

- `auto` / «По настройке кнопки» → система следует SOT тарифа;
- `explicit` / ручной выбор админа → админ сам выбирает `one_time` или `subscription`;
- recurring offer **не должен насильно блокировать** разовую оплату в explicit admin override;
- для Phase 8 runtime verify нужно просто явно выбрать **Stripe + subscription**, а не ломать свободу выбора.

---

## **2. Правка к Step 2 — не добавлять новый toggle, если уже есть выбор способа оплаты**

В плане написано:

Добавить переключатель «Способ оплаты для ссылки»: auto vs explicit

Уточни:

```md
Не добавлять новый отдельный toggle, если уже существует UI-блок выбора способа оплаты:
- «По настройке кнопки»;
- «Белорусская карта»;
- «Иностранная карта»;
- «Клиент выбирает».

Использовать существующий выбор как source:

- «По настройке кнопки» → `provider_choice_source='auto'`;
- «Белорусская карта» / «Иностранная карта» / «Клиент выбирает» → `provider_choice_source='explicit'`.

Не плодить второй дублирующий переключатель auto/explicit.
```

---

## **3. Правка к backend — customer_choice тоже explicit**

Добавить:

```md
Для `provider_mode='customer_choice'` и `provider_choice_source='explicit'` не форсить recurring в subscription автоматически.

Если в customer_choice выбран payment_type='one_time':
- ссылка остаётся one_time;
- Stripe branch при оплате идёт в mode=payment;
- bePaid branch — как раньше.

Если payment_type='subscription':
- Stripe branch идёт в mode=subscription;
```

Иначе он снова может зажать customer_choice.

---

## **4. Правка к auto-mode**

Добавить:

```md
Auto-promote recurring → subscription делать только если реально выбран режим «По настройке кнопки».

Не использовать fallback `provider_choice_source ?? 'auto'` так, чтобы старые/явные admin links случайно стали auto.

Если source отсутствует:
- определить его из UI-полей/режима;
- если невозможно определить — логировать/ошибка, а не молча считать auto для explicit-ссылки.
```

Это важно, чтобы он снова не сделал скрытый auto fallback и не заблокировал админские ссылки.

---

## **5. Правка к audit**

Добавить обязательную проверку:

```md
Audit `payment_link.payment_type_promoted_recurring` должен писаться только в auto-mode.

Для explicit one_time по recurring offer audit:
`payment_link.payment_type_admin_override`.

Не писать promote-audit для explicit.
```

---

## **6. Правка к Step 5 — negative one-time link лучше создать, но не оплачивать**

В плане написано правильно, но уточни:

```md
Negative one_time test:
- создать ссылку explicit one_time;
- проверить `payment_links.payment_type='one_time'`;
- проверить Stripe Checkout Session `mode='payment'`;
- НЕ оплачивать, если не нужно плодить лишние paid orders.

Оплата one-time уже была подтверждена ранее и `receipt_url` PASS.
```

---

## **7. Runtime Verify — пусть делает сам**

Добавить прямо:

```md
Runtime Verify выполняет Lovable/агент самостоятельно через preview/dev login.

Не перекладывать оплату тестовой картой на пользователя.

Аккаунт/контакт для теста:
Федорчук Сергей / 7500084@gmail.com.

Тестовая карта:
4242 4242 4242 4242.
```

---

## **8. Итоговый текст для Lovable**

```md
План принят с правками.

Ключевые уточнения:

1. Не добавлять отдельный новый toggle auto/explicit, если уже есть блок выбора способа оплаты. Использовать существующую логику:
   - «По настройке кнопки» → `provider_choice_source='auto'`;
   - «Белорусская карта» / «Иностранная карта» / «Клиент выбирает» → `provider_choice_source='explicit'`.

2. Backend не должен безусловно форсить recurring offer в subscription.
   Правильно:
   - auto + recurring → subscription;
   - explicit + one_time → one_time;
   - explicit + subscription → subscription.

3. Customer_choice explicit также должен уважать выбранный `payment_type`.

4. Не использовать опасный fallback `provider_choice_source ?? 'auto'`, если это может превратить explicit admin link в auto. Источник нужно определять явно из режима.

5. Audit:
   - `payment_link.payment_type_promoted_recurring` — только для auto-promote;
   - `payment_link.payment_type_admin_override` — для explicit one_time по recurring offer.

6. Negative one_time test:
   - создать explicit one_time link;
   - проверить `payment_links.payment_type='one_time'`;
   - проверить Stripe Checkout Session `mode='payment'`;
   - оплачивать не обязательно, потому что one-time receipt_url уже PASS.

7. Runtime verify выполняй самостоятельно через preview/dev login, не перекладывай ввод test card на пользователя.
   Используй контакт:
   `Федорчук Сергей / 7500084@gmail.com`
   и test card:
   `4242 4242 4242 4242`.

8. Phase 9 не начинать до финального статуса Phase 8.

После правок и успешного subscription runtime verify:
- если subscription invoice materialization прошла → `Phase 8 = FULL PASS`;
- если нет → `Phase 8 = PARTIAL PASS` с конкретным gap.
```

## **9. Контроль следующего отчета**

Принимать **Phase 8 FULL PASS** только если есть:

- explicit one_time по recurring offer остался `one_time`;
- auto recurring стал `subscription`;
- explicit subscription создал Stripe Checkout `mode=subscription`;
- пришёл `invoice.paid`;
- заполнены:
  - `hosted_invoice_url`;
  - `invoice_pdf`;
  - `stripe_invoice_id`;
- есть audit `stripe.invoice_document_materialized`;
- one-time `receipt_url` уже PASS;
- Phase 9 не стартовал.
- &nbsp;
- План: Корректировка blocker-fix Phase 8 (auto vs explicit override) + Runtime Verify

## Контекст

Прошлый фикс был чрезмерным: и UI, и backend безусловно форсили `subscription` для recurring offer + Stripe. Это убирает легитимную возможность админа создать ручную разовую оплату по рекуррентному тарифу. Правильный контракт — два режима: `provider_choice_source='auto'` (следуем SOT оффера) и `'explicit'` (админ — источник истины).

## Diagnose (read-only, до правок)

1. SQL — проверить, какие значения `provider_choice_source` уже встречаются в `payment_links` и поддерживает ли колонка это поле (или хранится в `meta`).
2. Прочитать актуальные:
  - `supabase/functions/admin-create-public-link/index.ts` — текущая ветка recurring-guard.
  - `src/components/admin/AdminPaymentLinkDialog.tsx` — `lockPaymentTypeToSubscription`, состояние provider/payment_type, наличие переключателя «По настройке кнопки / explicit».
  - `supabase/functions/_shared/create-payment-checkout.ts` и `create-stripe-checkout.ts` — точка ветвления `mode=payment` vs `mode=subscription`.
3. Зафиксировать в proof фактическое состояние source-of-truth для `provider_choice_source`.

## Step 1 — Backend correction (`admin-create-public-link/index.ts`)

Заменить безусловный recurring-guard на ветвление:

```text
source = body.provider_choice_source ?? 'auto'   // 'auto' | 'explicit'

if (provider === 'stripe' && offerIsRecurring && !isInstallment) {
  if (source === 'auto' && requested_payment_type === 'one_time') {
    effective_payment_type = 'subscription'
    audit('payment_link.payment_type_promoted_recurring', {
      requested_payment_type: 'one_time',
      effective_payment_type: 'subscription',
      provider_choice_source: 'auto',
      reason: 'offer_is_recurring_auto_mode'
    })
  } else if (source === 'explicit') {
    effective_payment_type = requested_payment_type   // уважаем выбор админа
    if (requested_payment_type === 'one_time') {
      audit('payment_link.payment_type_admin_override', {
        requested_payment_type: 'one_time',
        effective_payment_type: 'one_time',
        provider_choice_source: 'explicit',
        offer_is_recurring: true,
        reason: 'admin_explicit_override'
      })
    }
  }
}
```

`provider_choice_source` должен сохраняться в `payment_links` (колонка либо `meta.provider_choice_source`) — определим на этапе Diagnose. Installment-ветка не трогается. bePaid-ветка не трогается.

## Step 2 — UI correction (`AdminPaymentLinkDialog.tsx`)

1. Удалить безусловный `lockPaymentTypeToSubscription` и `disabled` на кнопке «Разовая оплата».
2. Добавить (или реюзать существующий) переключатель «Способ оплаты для ссылки»: `auto` («По настройке кнопки/тарифа») vs `explicit` (админ выбирает сам). Если такой переключатель уже есть в диалоге — привязать логику к нему; если нет — реализовать минимальный toggle.
3. Поведение:
  - **auto + recurring** → `payment_type` форсится в `subscription`, кнопки разовая/подписка скрыты или disabled с подсказкой *«По настройке тарифа будет создана подписка.»*
  - **explicit + Stripe + recurring + one_time** → кнопка активна, amber hint: *«Тариф является рекуррентным, но вы создаёте разовую админскую оплату. Подписка Stripe создана не будет.»*
  - **explicit + Stripe + subscription** → hint: *«Для Stripe будет создана подписка mode=subscription.»*
  - **bePaid / installment** → без изменений.
4. Параллельно убрать прошлую регрессию: «Иностранная карта» disabled при первой загрузке — починить порядок инициализации (если правка не сделана ранее).

## Step 3 — Runtime Verify Phase 8 (агент)

1. Создать payment_link через починенный UI:
  - Продукт: Gorbova Club, тариф: CHAT, recipient: Сергей Федорчук ([7500084@gmail.com](mailto:7500084@gmail.com)), provider: Stripe, payment_type: `subscription` (explicit), currency: EUR или BYN.
2. Открыть `/pay/:token`, авторизоваться dev-login `123456` если требуется, оплатить test card `4242 4242 4242 4242` (3DS — Complete).
3. Дождаться webhook `invoice.paid`.

## Step 4 — Verify SQL (как в задаче, пункт 7)

- `payment_links` (top 20): `provider`, `provider_mode`, `provider_choice_source`, `payment_type`, `offer_id`, `currency`, `meta`.
- `payments_v2` (provider='stripe', top 20): `provider_payment_id`, `order_id`, `receipt_url`, `meta.stripe.hosted_invoice_url|invoice_pdf|stripe_invoice_id`.
- `audit_logs` по 4 action'ам.

## Step 5 — Дополнительная негативная проверка

Создать ещё одну ссылку **explicit one_time** по тому же CHAT тарифу и убедиться:

- backend НЕ промоутит в subscription;
- audit пишет `payment_link.payment_type_admin_override`;
- Stripe Checkout открывается с `mode=payment` (не оплачиваем — достаточно session inspect через `provider_events`/checkout session id).

## Step 6 — Proof

Создать `.lovable/proofs/phase_8_runtime_verify_full_v1.md` с:

- статусом блоков (one-time receipt_url, subscription invoice materialization, auto vs explicit поведение);
- ссылками на order_id / subscription id / invoice id;
- скринами/SQL-выписками;
- финальным вердиктом Phase 8 = FULL PASS (если subscription invoice materialize) или PARTIAL PASS с конкретным gap.

Обновить `.lovable/plan.md` и пометить прошлый proof `phase_8_blocker_fix_recurring_subscription_v1.md` как superseded.

## DoD

- Backend: explicit one_time по recurring offer проходит без promotion; auto + recurring по-прежнему → subscription; bePaid не задет.
- UI: «Разовая оплата» доступна в explicit Stripe режиме с warning, недоступна (или auto-subscription) в auto режиме для recurring.
- Audit: оба action'а пишутся в правильных сценариях.
- Runtime: subscription test показывает все три stripe-поля + audit `stripe.invoice_document_materialized`.
- One-time runtime (negative): mode=payment подтверждён, без invoice fields.
- Proof v1 создан, Phase 8 статус зафиксирован.
- Phase 9 не стартует до явного approve.

## Затрагиваемые файлы (ожидание)

- `supabase/functions/admin-create-public-link/index.ts` — переписать ветку guard.
- `src/components/admin/AdminPaymentLinkDialog.tsx` — снять lock, добавить warning/auto-режим.
- `.lovable/proofs/phase_8_runtime_verify_full_v1.md` — новый.
- `.lovable/proofs/phase_8_blocker_fix_recurring_subscription_v1.md` — пометка superseded.
- `.lovable/plan.md` — статус.

## Вне scope

- Telegram DM с product/tariff names, redirect URL после оплаты, прочие follow-up фиксы из `stripe_runtime_followup_fixes_v1.md`.
- Phase 9 / Phase 10.