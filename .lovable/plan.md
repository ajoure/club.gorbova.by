# да, согласен, с учетом правок:

1. **Карту выбрать основную:**  
`4000 0000 0000 0341`  
`4000 0000 0000 0002` использовать только как fallback, если 0341 не даст `invoice.payment_failed`.
2. **Шаг 5 уточнить по status-полю:**  
Проверять фактическое поле в `provider_subscriptions`: если в таблице используется `state`, то ожидание должно быть:
  &nbsp;
  ```text
  provider_subscriptions.state = past_due
  ```
  а не `status`.
3. **Добавить проверку, что** `invoice.paid` **не пришёл:**  
Для v7 обязательно подтвердить:
  &nbsp;
  ```text
  provider_events WHERE event_type='invoice.paid' = 0
  ```
  по этому `subscription_id` / `invoice_id`.
4. **Cleanup не должен маскировать G15:**  
Сначала зафиксировать все post-state SQL/assertions и proof, только потом cancel v7.
5. **Replay-пробу делать после фиксации первого processed event:**  
Иначе можно спутать первичную обработку и duplicate handling.

После этих уточнений план можно запускать.

&nbsp;

План: G15 Runtime Proof — `invoice.payment_failed` (закрытие Stage 2.5)

## Цель

Закрыть последний остающийся гейт G15 через реальный прогон сценария отказа оплаты в Stripe Hosted Checkout (без синтетических payloads) и подтвердить корректное поведение grace-режима.

## Diagnose

Stage 2.5 PASS по G10–G14, G16–G18. G15 PARTIAL: код-фикс задеплоен (API-drift fix на `invoice.parent.subscription_details`), но runtime-симуляция не выполнялась. Контракт grace из `stripe_subscription_lifecycle_contract_v1.md`:

- `invoice.payment_failed` → `subscriptions_v2.status=past_due`
- доступ НЕ отзывается (grace)
- НИКАКИХ `orders_v2`/`payments_v2`(success) не создаётся
- CRM не переводится в failed stage
- Smart Retries управляются Stripe

## Сценарий runtime

Используется Stripe-аккаунт и user/product/tariff/offer из предыдущих v1–v6 прогонов.

### Шаг 1. Pre-state snapshot

SELECT по `subscriptions_v2`, `provider_subscriptions`, `orders_v2`, `payments_v2`, `entitlements`, `deals` (CRM) — зафиксировать baseline для пользователя.

### Шаг 2. Создать checkout v7

```
POST /functions/v1/stripe-create-subscription-checkout
{ user_id, product_id, tariff_id, offer_id }
```

Получить Hosted Checkout URL.

### Шаг 3. Оплатить тест-картой отказа

Stripe test card для `invoice.payment_failed` на recurring:

- `4000 0000 0000 0341` — attaches successfully, charge fails (`card_declined`) → даёт реальный `invoice.payment_failed` event на первом цикле.
- alt: `4000 0000 0000 0002` (generic decline) — если 0341 не сработает в текущей API-версии.

Через browser-tools: fill card, Subscribe, дождаться редиректа/ошибки.

### Шаг 4. Дождаться webhook

Опросить `provider_events` по `event_type='invoice.payment_failed'` + `subscriptionId`, убедиться `processing_status='processed'`. Проверить логи `stripe-webhook`.

### Шаг 5. Verify post-state (G15 assertions)


| Проверка                                                   | Ожидание                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| `subscriptions_v2.status`                                  | `past_due`                                                                  |
| `provider_subscriptions.status`                            | `past_due`                                                                  |
| `subscriptions_v2.access_end_at`                           | НЕ изменён vs baseline                                                      |
| `entitlements` для (user, product)                         | НЕ изменены vs baseline (нет новых строк, нет revoke)                       |
| `orders_v2` по этому `invoice_id`                          | 0 строк                                                                     |
| `payments_v2` со `status=success` по этому invoice         | 0 строк                                                                     |
| `payments_v2` со `status=failed` (если контракт допускает) | опционально, audit-only                                                     |
| `deals` пользователя                                       | stage НЕ переведён в failed                                                 |
| `provider_events`                                          | event записан с `idempotency_key`, `processing_status=processed`            |
| Audit log                                                  | присутствует запись `invoice_payment_failed_grace` (или эквивалент из кода) |


### Шаг 6. Replay-проба (G18 reinforcement в рамках G15)

Повторно отправить тот же `event.id` через Stripe CLI / re-deliver из Dashboard → убедиться, что `provider_events_idem_unique` отклонил дубликат, никакие строки не созданы повторно.

### Шаг 7. Cleanup

- Cancel созданной `subscriptions_v2` с `cancel_reason='stage25_v7_g15_runtime'`.
- Cancel `provider_subscriptions` строки.
- Cancel Stripe Subscription через API (idempotent).

### Шаг 8. Proof артефакт

Дописать секцию `G15 RUNTIME PROOF` в `.lovable/proofs/stripe_phase_3_1_stage_2_5_runtime_g10_g18_v2.md`:

- event_id, invoice_id, subscription_id (Stripe)
- subv2_id, ps_id (наши)
- SQL до/после
- ссылки на webhook-логи
- финальный вердикт G15 = PASS

## Dry run

До прогона: подтвердить с пользователем выбор тест-карты (0341 vs 0002) и что browser-симуляция допустима (предыдущие v1–v6 прогоны её использовали).

## DoD

- G15 = PASS в proof-документе.
- Все 9 ассертов из Шага 5 зелёные.
- Replay-проба зелёная.
- Cleanup выполнен, в БД не осталось активных артефактов v7.
- Итоговый вердикт обновлён: **Stage 2.5 = FULL PASS → Phase 3.1 Stage 2 FULL PASS**, готовность к следующему этапу мастер-спринта.

## Что НЕ делаем

- Не трогаем `grant-access-for-order`.
- Не трогаем bePaid (freeze сохраняется).
- Не создаём новых таблиц / RPC / cron.
- Не меняем код `stripe-subscription-resolver.ts` без обнаружения нового дефекта (если G15 fail — отдельный план фикса).
- Не меняем схему `subscriptions_v2` / `provider_subscriptions`.