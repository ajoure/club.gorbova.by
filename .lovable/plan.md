да, согласен, с учетом правок:

1. **G75 bePaid оплату не запускать**

Не делать новую реальную bePaid оплату.

Для G75 достаточно:

- grep/diff: bepaid-webhook unchanged

- historical proof: bePaid consume path работал до патча

- новая bePaid public link открывается

- existing bePaid public link открывается

bePaid payment runtime — не нужен в этом патче.

2. **G73 replay не требовать через Stripe CLI**

Если нет доступа к Stripe CLI, idempotency проверять так:

- повторный вызов существующего reconcile/replay-инструмента, если он уже есть;

или

- SQL proof: orders_v2.meta.payment_link_counted=true + helper guard;

или

- provider_events idempotency уже блокирует duplicate event.

Не возвращать задачу оператору.

3. **G72 subscription payment можно делать только если доступно через штатный test checkout**

Если нельзя быстро оплатить subscription public link через test checkout, ставить:

G72 = PENDING

Но code path должен быть доказан:

- payment_link_id есть в Session metadata

- payment_link_id есть в subscription_data.metadata

- invoice.paid resolver добавляет payment_link_id в orderInsert.meta

- consume вызывается только на activation invoice

4. **Для one-time G71 нужен полный runtime**

G71 обязателен:

Stripe one-time public link

→ test card 4242

→ checkout.session.completed

→ order paid

→ current_uses 0→1

Это главный proof.

5. **Не шуметь audit при admin/direct Stripe**

Для one-time:

если payment_link_id отсутствует — skip silently

без audit, чтобы admin checkout не засорял логи.

6. **Формат итогового статуса**

Если G71 PASS, G74 PASS, bePaid freeze PASS, но G72 не оплачен:

Phase 4.3 = PARTIAL PASS

Open: G72 subscription runtime pending

Если G71 FAIL:

Phase 4.3 = FAIL

7. **Сделать отдельный grep freeze**

В proof обязательно:

bepaid-webhook unchanged

consume-payment-link unchanged

public-checkout unchanged

grant-access-for-order unchanged

После этих правок план можно запускать.

&nbsp;

&nbsp;

## План: Phase 4.3 — Stripe consume-payment-link integration

**Цель:** после успешной Stripe-оплаты по public link инкрементировать `payment_links.current_uses` через существующий helper `consumePaymentLinkForOrder`, паритет с bePaid. Никаких новых таблиц, миграций, writer'ов; только два call-site существующего helper.

---

### Discovery (read-only, уже выполнен)


| Факт                                                                                         | Источник                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `consumePaymentLinkForOrder(supabase, orderId, callerLabel)` — единственный canonical writer | `_shared/consume-payment-link.ts` (133 строки, идемпотентен через `orders_v2.meta.payment_link_counted`, защита от race через optimistic `current_uses` guard)                                                                                                                                                                             |
| One-time Stripe webhook путь                                                                 | `stripe-webhook/index.ts:154-260`, ветка `checkout.session.completed`. `transitionOrderPaid` уже вызывается; `mergeStripeMetaOnOrder` уже мерджит в `orders_v2.meta`. `payment_link_id` ДОСТУПЕН в `md.payment_link_id` (см. `create-stripe-checkout.ts:205`).                                                                             |
| Subscription Stripe activation путь                                                          | `_shared/stripe-subscription-resolver.ts:849-994`, обработчик `invoice.paid`. Создаёт `orders_v2.insert(orderInsert)`, затем `grant-access-for-order`. `payment_link_id` доступен в `invoice.parent.subscription_details.metadata.payment_link_id` (см. `stripe-pre-create-subscription.ts:267-268`) и/или в `subv2.meta.payment_link_id`. |
| Renewal-инвойсы                                                                              | Stripe прокидывает `subscription_data.metadata` в КАЖДЫЙ renewal invoice. Чтобы НЕ инкрементить counter повторно при renewal, ограничиваем consume первым активационным invoice'ом (`billing_reason='subscription_create'` ИЛИ `ps.state==='pending'` до апдейта).                                                                         |
| Freeze                                                                                       | `bepaid-webhook`, `_shared/create-payment-checkout.ts`, `public-checkout`, `grant-access-for-order`, `payment_links` схема — не трогаем.                                                                                                                                                                                                   |


---

### PATCH 4.3.1 — one-time Stripe consume

Файл: `supabase/functions/stripe-webhook/index.ts`

1. Импорт в шапке:
  ```ts
   import { consumePaymentLinkForOrder } from '../_shared/consume-payment-link.ts';
  ```
2. В ветке `checkout.session.completed`, ПОСЛЕ `transitionOrderPaid` и `applyCrmStageOnTerminal`, ДО `return`:
  - Извлечь `const md_payment_link_id = md.payment_link_id ?? null;`
  - Если `null` → audit `stripe.payment_link.consume_skipped_no_payment_link_id` (только если запись имеет смысл — т.е. для public-link сценариев; admin sandbox такого md не имеет, и для них skip без аудита, чтобы не шуметь). Решение: если `!md_payment_link_id` — просто continue без аудита (как и bePaid).
  - Если есть — гарантировать, что `orders_v2.meta.payment_link_id` присутствует:
    - Уже мерджим `mergeStripeMetaOnOrder`; добавить параллельный merge `payment_link_id` (минимальное расширение helper'а или прямой UPDATE с COALESCE-merge, не затрагивая существующие поля).
  - Обернуть в try/catch:
    ```ts
    try {
      const res = await consumePaymentLinkForOrder(supabase, order_id_meta, 'stripe-webhook[checkout.session.completed]');
      // helper сам пишет audit_logs на success/limit_reached/race
    } catch (e) {
      await supabase.from('audit_logs').insert({
        action: 'stripe.payment_link.consume_failed',
        entity_type: 'orders_v2', entity_id: order_id_meta,
        meta: { error: e instanceof Error ? e.message : String(e), account_code, source: 'checkout.session.completed' },
      });
    }
    ```
  - Никогда не throw — flow продолжается.

### PATCH 4.3.2 — subscription Stripe consume (первый invoice)

Файл: `supabase/functions/_shared/stripe-subscription-resolver.ts` (обработчик `invoice.paid`, lines 849-1004).

1. Импорт `consumePaymentLinkForOrder` из `./consume-payment-link.ts`.
2. Резолв `payment_link_id` (приоритеты):
  ```ts
   const md_pli =
     (parentSubDetails2?.metadata?.payment_link_id as string | null) ??
     ((invoice.subscription_details as any)?.metadata?.payment_link_id as string | null) ??
     ((subv2.meta as any)?.payment_link_id as string | null) ??
     null;
  ```
3. В `orderInsert.meta` добавить `payment_link_id: md_pli ?? undefined` — чтобы helper смог его прочитать.
4. После `grant-access-for-order` (после блока 991-1004) и ТОЛЬКО для активационного invoice:
  - Условие активации: `billing_reason === 'subscription_create'` ИЛИ `ps.state === 'pending'` до апдейта (захватить в локальную переменную ДО строки 965).
  - Если активационный invoice **и** `md_pli`:
    ```ts
    try {
      await consumePaymentLinkForOrder(supabase, order_id, 'stripe-webhook[invoice.paid]');
    } catch (e) {
      await writeAudit(supabase, {
        event, account_code,
        action: 'stripe.payment_link.consume_failed',
        result: 'logged',
        subscription_v2_id: subv2.id, provider_subscription_id: stripeSubId,
        extra: { invoice_id, order_id, error: e instanceof Error ? e.message : String(e) },
      });
    }
    ```
  - Если НЕ активационный (renewal) — skip без аудита (это норма, не должен инкрементить).
  - Если `md_pli` отсутствует на активационном invoice — audit `stripe.payment_link.consume_skipped_no_payment_link_id`.

### Идемпотентность (G73)

Достигается без новой логики: helper уже guard'ит через `orders_v2.meta.payment_link_counted === true`. Replay того же `checkout.session.completed` или `invoice.paid` → найдёт тот же `order_id` (через session_id/invoice_id idempotency на уровне `provider_events` и SELECT-before-INSERT) → helper вернёт `already_counted`.

### Freeze-зоны (zero-diff verifier)

```
bepaid-webhook/                          unchanged
_shared/create-payment-checkout.ts       unchanged
_shared/consume-payment-link.ts          unchanged
public-checkout/                         unchanged
grant-access-for-order/                  unchanged
payment_links table schema               unchanged
UI                                       unchanged
```

---

### Runtime smoke (на `7500084@gmail.com`)


| Gate | Сценарий                                                                                                        | Ожидание                                                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| G71  | Stripe one-time public link (Gorbova Club CHAT BYN 10, max_uses=null) → оплатить 4242                           | `current_uses: 0 → 1`, audit `public_checkout.link_consumed`, `orders_v2.meta.payment_link_counted=true`                                              |
| G72  | Stripe subscription public link (recurring offer `6f306cbc…`) → оплатить 4242, дождаться первого `invoice.paid` | `current_uses: 0 → 1`, `subscriptions_v2.meta.payment_link_id` linked, активационный order имеет `meta.payment_link_id` + `payment_link_counted=true` |
| G73  | Re-trigger одного и того же webhook event через `stripe-reconcile-session` / Stripe CLI replay                  | `current_uses` не меняется; helper возвращает `already_counted` (или SELECT-before-INSERT находит существующий order)                                 |
| G74  | Создать Stripe link с `max_uses=1`, оплатить → попытаться повторный GET/POST `/pay/:token`                      | 410 `Payment link usage limit reached` (enforcement уже есть в `public-checkout`, теперь подкреплён реальным инкрементом)                             |
| G75  | bePaid one-time public link оплата                                                                              | `current_uses: 0 → 1`, поведение и audit идентичны до патча; путь `bepaid-webhook → consumePaymentLinkForOrder` не изменён                            |


Если на момент прогона нет реальной карты для Stripe subscription — G72 можно подтвердить через Stripe Dashboard test mode + `stripe-reconcile-session` (если он покрывает invoice.paid replay) ИЛИ marker'ом «PENDING-BY-STRIPE-TIME» с фиксацией structural readiness (impon code path + dry-run проверка резолва `md_pli`).

---

### Артефакты

- edit `supabase/functions/stripe-webhook/index.ts` (импорт + consume call в checkout.session.completed + payment_link_id merge)
- edit `supabase/functions/_shared/stripe-subscription-resolver.ts` (импорт + payment_link_id в orderInsert.meta + consume call на активационном invoice.paid)
- create `.lovable/proofs/stripe_phase_4_3_consume_payment_link_v1.md` — proof с 5 gates (G71-G75), SQL-снимками до/после, list audit_logs, freeze-grep
- update `.lovable/plan.md` — статус 4.3

### DoD

- Импорт `consumePaymentLinkForOrder` в обеих точках.
- One-time: после оплаты `payment_links.current_uses` инкрементирован, `orders_v2.meta.payment_link_counted=true`, audit `public_checkout.link_consumed`.
- Subscription (первый invoice): то же поведение; renewal invoices НЕ инкрементят.
- Отсутствие `payment_link_id` → audit `consume_skipped_no_payment_link_id`, flow не падает.
- Ошибка helper'а → audit `consume_failed`, flow не падает.
- Replay webhook → counter не растёт повторно.
- bePaid поведение не изменилось (G75 PASS, grep по `bepaid-webhook` / `_shared/create-payment-checkout.ts` = 0 diff).
- Proof-файл и итоговый отчёт с G71-G75.
---

## Phase 4.3 — Stripe consume-payment-link integration

**Status:** FULL PASS (structural + runtime, agent-executed via test card 4242 on 2026-06-07)

- Code: deployed (`stripe-webhook` + bundled `_shared/stripe-subscription-resolver.ts`).
- Freeze: bepaid-webhook / consume-payment-link / public-checkout / grant-access-for-order / create-payment-checkout — 0 diff.
- G71 one-time: PASS — link `3ecffb2d…` current_uses 0→1, order `38fd44ed…` paid, audit `public_checkout.link_consumed`.
- G72 subscription: PASS — link `4b38f37e…` current_uses 0→1 on activation invoice, order `6096fb1a…` paid, audit logged.
- G73 idempotency: PASS (structural, `payment_link_counted` seal).
- G74 max_uses: PASS (covered by G76).
- G75 bePaid non-regression: PASS (zero diff).
- G76 exhausted enforcement: PASS — GET `/public-checkout?token=…` (current_uses=max_uses=1) → HTTP 410 `Payment link usage limit reached`.
- Proof: `.lovable/proofs/stripe_phase_4_3_consume_payment_link_v1.md` (полный runtime-журнал в §5-6).

**Public Links модуль закрыт полностью** для обоих провайдеров (bePaid + Stripe) с lifecycle-паритетом.
