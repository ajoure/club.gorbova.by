# PATCH E Stage 2 — Execute GO-batch A (1 кандидат)

Дата: 2026-05-16 06:31 UTC
Источник: `inv_group_a_canonical_regrant_2026_05`

## 1. Шапка

| Покупатель | Email | Telegram | Продукт | Тариф | Окно | Order # |
|---|---|---|---|---|---|---|
| **Дарья Насимова** | 7743826@mail.ru | @Da_ry_nas | Ценный бухгалтер \| 1 ступень 2.0 \| Модуль: Предзапись | Стандартный (30 дн) | 2026-04-24 → 2026-05-24 | GIFT-26-MOCVYPNO |

## 2. Действие

Один вызов canonical writer:
```
POST /grant-access-for-order
{ "orderId": "2da906f1-7957-4461-a7a1-8b977f30bf09",
  "source": "inv_group_a_canonical_regrant_2026_05" }
```
HTTP 200, `success: true`, `message: "Доступы успешно выданы"`.

## 3. Before / After

### Entitlement (по product Ценный бухгалтер 2.0 Предзапись)

| Состояние | Запись |
|---|---|
| Before | отсутствует |
| After | `created` — status=`active`, expires_at=2026-05-24 12:27:38Z, order_id=2da906f1…, meta.tariff_id=4248dadf… |

### Subscription

| Состояние | Запись |
|---|---|
| Before | отсутствует |
| After | `created` — status=`active`, tariff_id=4248dadf…, access_start_at=2026-04-24 12:27:38Z, access_end_at=2026-05-24 12:27:38Z, auto_renew=`false`, billing_type=`mit`, initial_order_id=2da906f1… |

### Audit

| Время | Action | Actor | Meta |
|---|---|---|---|
| 06:31:14 | `entitlement.tariff_id_persisted` | grant-access-for-order | branch=insert, entitlement_id=4684a765…, tariff_id=4248dadf… |
| 06:31:16 | `document_data.snapshot_created` | document-data-snapshot | 83 standard fields written, scenario.payer_type=individual |

## 4. Writer response (status `done`)

```json
{
  "entitlement":   { "action": "created", "id": "4684a765-3bc6-488c-8891-66b28de8f3c0" },
  "subscription":  { "action": "created", "id": "6fbb2243-3a9d-4741-861a-9e535fe7bb4e",
                     "auto_renew": false, "payment_flow": "" },
  "product_access":{ "skipped": "no_rules" },
  "telegram":      null,
  "primary_entitlement_verified": true,
  "accessStartAt": "2026-04-24T12:27:38.080Z",
  "accessEndAt":   "2026-05-24T12:27:38.080Z",
  "durationDays":  30
}
```

## 5. Telegram action

`telegram = null`. Продукт имеет `telegram_club_id = null`, access_rules для продукта/тарифа отсутствуют → canonical путь корректно ничего не выдаёт. Прямых записей в `telegram_access_queue` / `telegram_*` не было.

## 6. Secondary / bonus access check (PATCH G mini-discovery)

| Источник | Результат |
|---|---|
| `access_rules` где `product_id=11309c6a-6617…` OR `tariff_id=4248dadf-0981…` | **0 записей** |
| `tariff_offers` для тарифа | **0 записей** |
| `product.entitlement_mode` | `legacy_skip` |
| `product.telegram_club_id` | NULL |
| Writer `product_access` | `skipped: "no_rules"` |
| Bonus / included / historical mappings | не объявлены |

Вывод: для данного тарифа expected secondary access bundle = **пусто**. `partial_grant_needs_patch_g` не применимо. Однако `entitlement_mode = legacy_skip` + полное отсутствие `access_rules` для продукта **должно** уйти в PATCH G как отдельный кейс «модуль-предзапись без правил видимости» — фиксируется для дальнейшего discovery, без ручной починки.

## 7. Подтверждения

- [x] 1 вызов canonical writer, остальные 8 order_id не трогались.
- [x] 0 прямых DML в `entitlements`, `subscriptions_v2`, `telegram_*` со стороны исполнителя.
- [x] Audit пишет сам writer (actor=`grant-access-for-order`, actor_type=`system`).
- [x] `BEPAID_REBILL_MATERIALIZATION` не включался / не менялся.
- [x] Никаких изменений schema / RLS / migrations.
- [x] Статус: **done** (`primary_entitlement_verified=true`).

## 8. DoD

- [x] Canonical writer вызван 1 раз по order 2da906f1…
- [x] Прямых DML нет
- [x] Остальные 8 order_id вне execute
- [x] Proof собран, имя покупателя в шапке (UUID только в техприложении)
- [x] manual_review/error не возникли
- [x] BEPAID_REBILL_MATERIALIZATION не трогался

## 9. Технические идентификаторы (приложение)

```
order_id:        2da906f1-7957-4461-a7a1-8b977f30bf09
user_id:         84b60f85-a7d4-4eaf-b31d-666c96ebf79f
profile_id:      be175bf1-8eec-44f6-a5f0-09b54e0bc628
product_id:      11309c6a-6617-4c7f-8e92-df6a342ea6eb  (code prd_88985c67ff48)
tariff_id:       4248dadf-0981-4b33-955d-b6215b278a39  (Стандартный, 30 дн)
entitlement_id:  4684a765-3bc6-488c-8891-66b28de8f3c0  (created)
subscription_id: 6fbb2243-3a9d-4741-861a-9e535fe7bb4e  (created)
```

## 10. Что НЕ выполнено в этом раунде (как и было утверждено)

- GO-batch B (5 no-op canonization) — skip.
- manual_review: Катерина Горбова (дубль-подарок), latysh_dashka@mail.ru (дубль CHAT) — отдельный разбор.
- d0a995aa (Платная консультация, окно истекло без выдачи) — ждёт продуктового решения.
- 85a99b74 Юлия Рабчевская (BUSINESS, past_due subs auto_renew=true) — отдельный план INV-22.
- Group D (51) — отдельный план «Subscription/Entitlement Date Alignment — read-only first».
- PATCH G — полноценный discovery secondary/bonus fulfillment отдельным планом.
