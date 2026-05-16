# PATCH H — read-only диагностика: bePaid платёж 2026-05-16 снова привязался к мартовской сделке

Дата: 2026-05-16 06:55 UTC
Скоуп: ровно один реальный платёж за последние 36 часов (Алёна Богинская, Gorbova Club / BUSINESS, sbs_70f8efb8949a490c).

## TL;DR

1. **`BEPAID_REBILL_MATERIALIZATION=dry_run` сработал штатно.** Аудит `bepaid.rebill.dry_run` с `decision=would_materialize` создан в `bepaid-webhook` через ~0.4с после inbound platform-callback. План материализации (REBILL-order, payment-repoint) собран полностью и валидно.
2. **Платёж остался привязан к мартовскому order — это ОЖИДАЕМОЕ поведение `mode=dry_run`.** Dry_run по контракту только пишет audit и НЕ делает DML. Никакого «не сработало» нет; чтобы реально расщепить — нужен `mode=on`.
3. **Параллельно вскрыта отдельная аномалия фулфилмента.** `grant-access-for-order` отказался продлевать (`skip_blocked_stale_access`, patch-12.2-skip-stale-guard) — `existing_subscription_access_end_at=2026-05-16T20:59:59Z` < `expected_min_end=2026-06-15T06:45:46Z`. Доступ в итоге был продлён НЕ canonical writer-ом, а прямой записью `bepaid.webhook.link_order_dates_updated` в `subscriptions_v2.access_end_at=2026-06-16T12:00:00Z` из `bepaid_active_to`. Это обход canonical write-path.

## 1. Идентификация платежа

| Поле | Значение |
|---|---|
| Покупатель | Алёна Богинская (`lena_times@mail.ru`) |
| user_id | 78123ed5-3a00-4982-87cf-72de6c0cdb8c |
| profile_id | 3d4a987b-60d3-456b-8eb1-ecc2baa71ab4 |
| payment_id | 14d419cb-e1ea-4756-ad9c-5996779a0795 |
| provider_payment_id (uid) | bdfc574d-2f3c-4aa1-8376-9c81c7379598 |
| paid_at | 2026-05-16 06:45:45.805Z |
| amount / currency | 250 BYN |
| is_recurring | **true** |
| Привязан к order_id | **68e2c243-8950-491e-b6d2-bdefd1e8d506** |
| order_number | SUB-LINK-MMU8KF07 |
| order.created_at | **2026-03-17 06:33:16Z** (мартовская сделка) |
| order.deal_date | 2026-03-17 06:33:16Z |
| order.payment_flow | `admin_subscription` (`admin_payment_link_subscription`) |
| order.bepaid_subscription_id | `sbs_70f8efb8949a490c` |
| subscription_v2_id | 493f5559-0a1d-4a7d-b43f-d6375078e1cd |
| product_id | 11c9f1b8-0355-4753-bd74-40b42aa53616 (BUSINESS / Gorbova Club) |
| tariff_id | 7c748940-dcad-4c7c-a92e-76a2344622d3 |

## 2. Source / ingestion path

Платёж пришёл через **bePaid platform webhook → `bepaid-webhook` edge function**. Это подтверждено:
- актор audit-цепочки = `bepaid-webhook` (actor_type=`system`, actor_label=`bepaid-webhook`);
- сразу после inbound зафиксированы `crm_stage_apply_skipped_invalid_config` (trigger=`webhook_link_order_paid`) и `bepaid.rebill.dry_run` — обе пишутся именно `bepaid-webhook`.

Никакого admin-sync / polling / ручного действия в окне платежа нет. Ingestion-path = тот же, в котором уже подключён §A REBILL dispatcher.

## 3. Что сделал §A dry_run dispatcher

Запись `bepaid.rebill.dry_run` (2026-05-16 06:45:46.244Z):

```json
{
  "mode": "dry_run",
  "decision": "would_materialize",
  "parent_order_id": "68e2c243-8950-491e-b6d2-bdefd1e8d506",
  "payment_flow": "bepaid_subscription_charge",
  "sbs": "sbs_70f8efb8949a490c",
  "uid": "bdfc574d-2f3c-4aa1-8376-9c81c7379598",
  "existing_rebill_order_id": null,
  "full_refunded_uid": false,
  "planned_order_payload": {
    "order_number": "REBILL-bdfc574d-2f3",
    "deal_date": "2026-05-16T06:45:46.118Z",
    "deal_month": "2026-05",
    "final_price": 250,
    "currency": "BYN",
    "product_id": "11c9f1b8-0355-4753-bd74-40b42aa53616",
    "tariff_id":  "7c748940-dcad-4c7c-a92e-76a2344622d3",
    "user_id":    "78123ed5-3a00-4982-87cf-72de6c0cdb8c",
    "profile_id": "3d4a987b-60d3-456b-8eb1-ecc2baa71ab4",
    "bepaid_subscription_id": "sbs_70f8efb8949a490c",
    "meta": {
      "materialization_run": "bepaid_webhook_rebill_v2",
      "materialized_from_payment_uid": "bdfc574d-…",
      "original_parent_payment_flow": "admin_subscription",
      "parent_order_id": "68e2c243-…",
      "payment_flow": "bepaid_subscription_charge",
      "source": "bepaid_rebill"
    },
    "pipeline_id": "a0000001-…",
    "pipeline_stage_id": "b0000001-0001-0000-0000-000000000003"
  },
  "planned_grant_call": { "fn": "grant-access-for-order",
                          "args": { "order_id": "<new_rebill_order_id>" } },
  "planned_payment_repoint": {
    "existing_payment_id": "14d419cb-…",
    "existing_order_id":   "68e2c243-…",
    "will_create_payment": false,
    "will_repoint_to":     "<new_rebill_order_id>"
  }
}
```

Classifier отработал корректно: `payment_flow=admin_subscription` parent + recurring uid + sbs match → `bepaid_subscription_charge` (rebill). Никаких branch-ов «не классифицирован» / «пропуск» нет.

## 4. Почему платёж остался на мартовском order

`mode=dry_run` по контракту делает **только audit-запись и НЕ выполняет DML** (никаких `insert into orders_v2`, никакого `update payments_v2.order_id`). Это её цель — проверить, что план корректный, без побочных эффектов.

Поэтому факт «платёж висит на мартовской сделке» — **штатное и ожидаемое поведение dry_run**, а не сбой dispatcher-а. Чтобы расщепление реально произошло, нужен `mode=on`.

Подтверждение из аудита: `planned_payment_repoint.will_create_payment=false`, `will_repoint_to=<new_rebill_order_id>` — план зафиксирован, исполнение отложено до `on`.

## 5. Отдельная аномалия: canonical write-path обойдён

В рамках того же webhook-flow зафиксированы:

| Время | Событие | Что это значит |
|---|---|---|
| 06:45:46.754Z | `grant-access-for-order.skip_blocked_stale_access` (patch-12.2-skip-stale-guard) | Canonical writer **отказался** продлять: `existing_subscription_access_end_at=2026-05-16T20:59:59Z`, `expected_min_end=2026-06-15T06:45:46Z`. Окно по факту истекало в день платежа, writer счёл состояние «stale» и не стал двигать даты. |
| 06:45:54.008Z | `bepaid.webhook.link_order_dates_updated` | `bepaid-webhook` напрямую обновил `subscriptions_v2.access_end_at = 2026-06-16T12:00:00Z` (из `bepaid_active_to=2026-06-15T06:34:58Z`, `used_fallback=false`). |
| 06:45:53.429Z | `subscriptions_v2.updated_at` совпадает | Прямой UPDATE `subscriptions_v2` со стороны webhook-а (`bepaid_activated_at`, `last_extension_at`, `extended_by_orders` append, и т.д.). |

Текущий стейт `subscriptions_v2 493f5559-…`:
- `access_end_at = 2026-06-16 12:00:00Z` (после update);
- `meta.access_end_at_previous = 2026-05-16 20:59:59Z`;
- `meta.last_extension_at = 2026-05-16T06:45:46.774Z`;
- `meta.last_extension_days = 30`;
- `meta.extended_by_orders` содержит DUPLICATE `[68e2c243…, 68e2c243…]` (двойной push того же parent order — характерный признак retry/двойного прохода через тот же write-path).

Это нарушает canonical write-path standard: продление доступа должно идти ТОЛЬКО через `grant-access-for-order`. Здесь после `skip_blocked_stale_access` writer не вызывался повторно, а `bepaid-webhook` сам сдвинул даты напрямую — это второй параллельный путь записи в `subscriptions_v2`. См. memory `canonical-write-path-standard`, `bepaid-active-to-overshoot-guard`.

Дополнительно: при `mode=on` план dispatcher-а вызывает `grant-access-for-order(order_id=<new REBILL>)`. Для свежесозданного REBILL-order существующая подписка имела бы `access_end_at=2026-05-16` на момент вызова → snap-stale-guard снова бы заблокировал extension, а fallback bepaid-webhook (`link_order_dates_updated`) сработал бы для REBILL-order ещё раз. То есть включение `on` без устранения skip-stale-guard / прямого webhook-write пути перенесёт ту же проблему в новую REBILL-сделку. Это блокер №2 для `mode=on`.

## 6. Почему dry_run был интерпретирован как «не сработал»

Внешние симптомы оплаты, на которые смотрит админ:
- payment виден в карточке мартовской сделки (это правда — `mode=dry_run`, payment не перенесён);
- доступ продлён до 16.06 (это правда — но НЕ через canonical writer, а прямой webhook-write).

Отсюда вывод «dispatcher не сработал». На самом деле:
- dry_run dispatcher сработал → есть `bepaid.rebill.dry_run` с полным планом;
- canonical writer был вызван, но скипнут `skip_blocked_stale_access`;
- даты доступа сдвинул прямой webhook-write — это и есть скрытый «костыль», маскирующий проблему canonical пути.

## 7. Что нужно исправить ДО включения `mode=on`

1. **Canonical write-path для продления.** Понять, почему `patch-12.2-skip-stale-guard` режет валидное продление (платёж пришёл в день истечения, `expected_min_end = paid_at + access_days`, `existing_end < expected_min_end` — это нормальный кейс продления, а не stale-state). Либо guard должен пропускать platform-charge с матчем `tariff_id` + `sbs`, либо webhook должен повторно вызывать `grant-access-for-order` с `extendFromCurrent=false / forceExtend=true`. Без этого `mode=on` создаст REBILL-сделки, у которых canonical writer не выдаст даты, а даты будут проставляться обходным `link_order_dates_updated`.
2. **Прямой webhook-write `subscriptions_v2`.** Любой `update access_end_at` в `bepaid-webhook` помимо `grant-access-for-order` должен быть исключён или явно помечен fallback-only с алертом. Сейчас он молча перекрывает canonical путь.
3. **Дубль в `meta.extended_by_orders`.** `[68e2c243, 68e2c243]` — индикатор двойного прохода. Проверить идемпотентность extend-блока в текущем webhook-flow ДО разрешения `mode=on`.
4. После 1–3 повторить dry_run ещё на 1–2 реальных rebill-платежах и проверить, что:
   - `bepaid.rebill.dry_run` снова `decision=would_materialize`;
   - `grant-access-for-order` НЕ скипается;
   - прямого `link_order_dates_updated` нет.

Только тогда переходить к approval `mode=on`.

## 8. STOP-список (соблюдён)

- [x] `BEPAID_REBILL_MATERIALIZATION=on` НЕ включался.
- [x] 0 DML в `orders_v2`, `payments_v2`, `subscriptions_v2`, `entitlements`, `telegram_*`.
- [x] 0 ручных перепривязок payment_id ↔ order_id.
- [x] 0 ручных REBILL-order-ов.
- [x] 0 миграций / RLS / правок edge functions.
- [x] Анализ строго по `audit_logs` + текущему state БД.

## 9. DoD

- [x] Платёж и parent order идентифицированы.
- [x] Ingestion-path подтверждён (`bepaid-webhook`, не admin-sync / polling).
- [x] `bepaid.rebill.dry_run` найден, decision = `would_materialize`, план зафиксирован полностью.
- [x] Объяснено, почему платёж остался на мартовском order (`mode=dry_run` контракт).
- [x] Найдена и описана отдельная аномалия canonical write-path (skip_blocked_stale_access + прямой webhook-write).
- [x] Сформулированы прекondition-ы для `mode=on` (3 пункта).
- [x] Proof создан, новых DML нет.

## 10. Что НЕ входит (отдельными планами)

- Фикс `patch-12.2-skip-stale-guard` под platform-charge rebill сценарий.
- Удаление / понижение в fallback-only прямого webhook-write `link_order_dates_updated`.
- Идемпотентность `extended_by_orders` append.
- Повторный dry_run sweep на следующих rebill-платежах после фиксов.
- Включение `BEPAID_REBILL_MATERIALIZATION=on`.
- PATCH G — full discovery secondary/bonus access (следующий шаг).
