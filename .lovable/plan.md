
# Отчёт о выполненной работе: PATCH E — Запрет двойных подписок

## Статус: Код завершён, browser-proof pending

---

## 1. Что изменено

### Файлы

| Файл | Что изменено |
|---|---|
| `supabase/functions/_shared/create-payment-checkout.ts` | Заменён Duplicate Guard: subscriptions_v2 SoT, fail-closed, структурированный conflict, replacement_of_subscription_v2_id. Добавлен серверный аудит `subscription.replaced` с `new_order_id` после создания checkout |
| `supabase/functions/admin-create-payment-link/index.ts` | Проброс replacement_of_subscription_v2_id, conflict в ответе |
| `src/components/admin/AdminPaymentLinkDialog.tsx` | UI конфликта: предупреждение, «Оставить»/«Заменить», промежуточные статусы. Аудит split: клиент пишет `subscription.replace_started` с явным `actor_user_id`, сервер пишет `subscription.replaced` с `new_order_id` |

### Аудит — двухэтапный

1. **`subscription.replace_started`** — клиент, после успешной отмены старой подписки у провайдера, до создания нового checkout. Поля: `old_subscription_v2_id`, `product_id`, `tariff_id`, `old_bepaid_subscription_id`, `cancel_result`, `actor_type`, `actor_user_id` (явно через `supabase.auth.getUser()`), `target_user_id`.

2. **`subscription.replaced`** — сервер (`create-payment-checkout.ts`), после успешного создания нового checkout. Поля: `old_subscription_v2_id`, `new_order_id`, `new_checkout_or_order_id`, `product_id`, `tariff_id`, `bepaid_subscription_id`, `actor_type`, `actor_user_id`, `target_user_id`.

### Терминальные статусы (из кода, строки 387)

```
canceled, superseded, revoked, expired, expired_reentry
```

---

## 2. Server-proof

### Proof 1: Дубль по тому же product_id + tariff_id — ЗАБЛОКИРОВАН ✅

Подписка `c30f04c3` (Gorbova Club / BUSINESS, active) найдена → checkout не создан, вернулся `existing_subscription_conflict` с `subscription_v2_id`, `bepaid_subscription_id`, датами.

### Proof 2: Другой тариф того же продукта — РАЗРЕШЁН ✅

Тариф CHAT → checkout создан, `redirect_url` получен.

### Proof 3: STOP-guard — replacement без отмены — ЗАБЛОКИРОВАН ✅

`replacement_of_subscription_v2_id: c30f04c3`, status=active → ответ: «Заменяемая подписка ещё не отменена (статус: active)».

### Proof 4: Fail-closed — подтверждён кодом ✅

Строки 415-418: при ошибке запроса к subscriptions_v2 → checkout блокируется.

### Proof 5: replacement через конкретный ID — не generic bypass ✅

Строки 373-401: проверка конкретной подписки по UUID + терминальный статус.

---

## 3. Negative-proof

- Если отмена у провайдера не прошла → UI показывает ошибку, новая ссылка не создаётся (STOP-guard на клиенте: строка 109-111)
- Если guard-query падает → checkout не создаётся (fail-closed: строки 415-418)
- Если replacement sub не в терминальном статусе → checkout не создаётся (строки 388-395)

---

## 4. Browser-proof — pending

Checklist:
1. Конфликт по тому же product_id + tariff_id → блок «Активная подписка уже существует» с датой по Минску
2. «Оставить текущую» → ничего не создаётся
3. «Заменить подписку» → «Отменяем…» → «Создаём…» → новая ссылка
4. SQL: старая подписка в терминальном статусе, новая ровно одна

---

## 5. Что вне scope

| Пункт | Статус |
|---|---|
| Кейс `dea78a37` (тот же баг-класс) | Pending, не фиксим без подтверждения |
| Массовый поиск аналогичных случаев | Не в этом патче |
| Guard для `public-checkout` | Отдельный scope |

---

## 6. DoD

| Критерий | Статус |
|---|---|
| Дубль по product_id + tariff_id блокируется | ✅ Server-proof |
| Другой тариф не блокируется | ✅ Server-proof |
| Завершённая подписка не блокирует | ✅ Код (терминальные статусы: canceled, superseded, revoked, expired, expired_reentry) |
| STOP-guard при не-отменённой подписке | ✅ Server-proof |
| Fail-closed при ошибке запроса | ✅ Код |
| replacement через конкретный ID | ✅ Server-proof + код |
| Аудит `subscription.replace_started` с actor_user_id | ✅ Код (клиент, auth.getUser()) |
| Аудит `subscription.replaced` с new_order_id | ✅ Код (сервер, после создания checkout) |
| Browser-proof UI конфликта | ⏳ Требуется |
| Даты по Europe/Minsk в UI | ✅ Код (formatPaymentTimeIANA) — нужен скрин |
