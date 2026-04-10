
# Отчёт о выполненной работе: PATCH E — Запрет двойных подписок

## Статус: Код завершён, server-proof подтверждён, browser-proof частичный

---

## 1. Что изменено

### Файлы

| Файл | Что изменено |
|---|---|
| `supabase/functions/_shared/create-payment-checkout.ts` | Заменён Duplicate Guard: subscriptions_v2 SoT, fail-closed, структурированный conflict, replacement_of_subscription_v2_id. Серверный аудит `subscription.replaced` с `new_order_id` после создания checkout |
| `supabase/functions/admin-create-payment-link/index.ts` | Проброс replacement_of_subscription_v2_id, conflict в ответе |
| `src/components/admin/AdminPaymentLinkDialog.tsx` | UI конфликта: предупреждение, «Оставить»/«Заменить», промежуточные статусы. Клиентский аудит `subscription.replace_started` с явным `actor_user_id` через `supabase.auth.getUser()` |

### Аудит — двухэтапный

1. **`subscription.replace_started`** — клиент, после успешной отмены старой подписки у провайдера, до создания нового checkout. Поля: `old_subscription_v2_id`, `product_id`, `tariff_id`, `old_bepaid_subscription_id`, `cancel_result`, `actor_type`, `actor_user_id` (явно через `supabase.auth.getUser()`), `target_user_id`.

2. **`subscription.replaced`** — сервер (`create-payment-checkout.ts`, строки 746-765), после успешного создания нового checkout. Поля: `old_subscription_v2_id`, `new_order_id`, `new_checkout_or_order_id`, `product_id`, `tariff_id`, `bepaid_subscription_id`, `actor_type`, `actor_user_id`, `target_user_id`.

### Терминальные статусы (из кода, строка 387)

```
canceled, superseded, revoked, expired, expired_reentry
```

---

## 2. Server-proof

### Proof 1: Дубль по тому же product_id + tariff_id — ЗАБЛОКИРОВАН ✅

```json
POST /admin-create-payment-link
body: { user_id: "6b0e0451-...", product_id: "11c9f1b8-..." (Gorbova Club), tariff_id: "7c748940-..." (BUSINESS) }

Response:
{
  "success": false,
  "error": "existing_subscription_conflict",
  "conflict": {
    "subscription_v2_id": "c30f04c3-3200-41f9-be09-e8bab09cad45",
    "status": "active",
    "bepaid_subscription_id": "sbs_b5c5ea6a57413c72",
    "provider_subscription_id": "sbs_b5c5ea6a57413c72",
    "next_charge_at": "2026-05-08T20:59:59+00:00",
    "access_end_at": "2026-05-08T20:59:59+00:00",
    "timezone_used": "Europe/Minsk"
  }
}
```

### Proof 2: Другой тариф того же продукта — РАЗРЕШЁН ✅

```json
POST /admin-create-payment-link
body: { ..., tariff_id: "b276d8a5-..." (FULL) }

Response:
{ "success": true, "redirect_url": "https://checkout.bepaid.by/...", "order_id": "d0999c4d-..." }
```

### Proof 3: STOP-guard — replacement без отмены — ЗАБЛОКИРОВАН ✅

```json
POST /admin-create-payment-link
body: { ..., replacement_of_subscription_v2_id: "c30f04c3-..." }

Response:
{ "success": false, "error": "Заменяемая подписка ещё не отменена (статус: active). Сначала отмените её у провайдера." }
```

### Proof 4: Fail-closed — подтверждён кодом ✅

Строки 415-418: при ошибке запроса к subscriptions_v2 → checkout блокируется.

### Proof 5: replacement через конкретный ID — не generic bypass ✅

Строки 373-401: проверка конкретной подписки по UUID + терминальный статус.

---

## 3. Negative-proof

- Если отмена у провайдера не прошла → UI показывает ошибку, новая ссылка не создаётся (STOP-guard на клиенте: строки 109-111)
- Если guard-query падает → checkout не создаётся (fail-closed: строки 415-418)
- Если replacement sub не в терминальном статусе → checkout не создаётся (строки 388-395)

---

## 4. Browser-proof — частичный

Подтверждено скринами:
1. ✅ Диалог «Ссылка на оплату» открывается на карточке Казачек
2. ✅ Видна существующая подписка Gorbova Club — BUSINESS (active, bePaid, MASTER ****2970)
3. ⏳ Полный UI-flow конфликта (выбор продукта из dropdown затруднён виртуализацией списка) — требует ручной проверки

---

## 5. SQL-proof (состояние Казачек)

Подписка `c30f04c3` — Gorbova Club / BUSINESS:
- status: `active`
- next_charge_at: `2026-05-08T20:59:59+00:00`
- access_end_at: `2026-05-08T20:59:59+00:00`

Ранее замённая подписка `eba308ca` — status: `superseded` ✅
Просроченные подписки `c5f83210`, `067fc30d` — status: `expired` ✅

По паре product_id + tariff_id (Gorbova Club / BUSINESS) активная подписка ровно одна: `c30f04c3`.

---

## 6. Что вне scope

| Пункт | Статус |
|---|---|
| Кейс `dea78a37` (тот же баг-класс) | Pending |
| Массовый поиск аналогичных случаев | Не в этом патче |
| Guard для `public-checkout` | Отдельный scope |

---

## 7. DoD

| Критерий | Статус |
|---|---|
| Дубль по product_id + tariff_id блокируется | ✅ Server-proof |
| Другой тариф не блокируется | ✅ Server-proof |
| Завершённая подписка не блокирует | ✅ Код (canceled, superseded, revoked, expired, expired_reentry) |
| STOP-guard при не-отменённой подписке | ✅ Server-proof |
| Fail-closed при ошибке запроса | ✅ Код |
| replacement через конкретный ID | ✅ Server-proof + код |
| Аудит `subscription.replace_started` с actor_user_id | ✅ Код (клиент, auth.getUser()) |
| Аудит `subscription.replaced` с new_order_id | ✅ Код (сервер, строки 746-765) |
| Browser-proof UI конфликта | ⏳ Частичный — полный flow требует ручной проверки |
| Даты по Europe/Minsk в UI | ✅ Код (formatPaymentTimeIANA) |
