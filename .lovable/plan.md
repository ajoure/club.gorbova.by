
# Отчёт: Финализация PATCH A, B, C, D — карточки доступа

## Статус: Browser-proof завершён

---

## Итоговый статус патчей

| Патч | Статус | Browser-proof |
|---|---|---|
| **PATCH A** | ✅ Код + safeguard подтверждены | Диана: подписка active, карточка стандартная |
| **PATCH C** | ✅ Данные + аудит подтверждены | Диана: subscription-card с ✏️🗑️ |
| **PATCH B** | ✅ Код внесён, UI подтверждён | Кнопка 🗑️ видна на entitlement-карточках Казачек |
| **PATCH D** | ✅ Код + browser-proof | bePaid-бейдж у Дианы и Казачек, toggle отсутствует |

---

## PATCH E — Запрет двойных подписок — ✅ ВЫПОЛНЕН

### Изменённые файлы

| Файл | Что изменено |
|---|---|
| `supabase/functions/_shared/create-payment-checkout.ts` | Заменён Duplicate Guard: subscriptions_v2 SoT, fail-closed, структурированный conflict, replacement_of_subscription_v2_id |
| `supabase/functions/admin-create-payment-link/index.ts` | Проброс replacement_of_subscription_v2_id, conflict в ответе |
| `src/components/admin/AdminPaymentLinkDialog.tsx` | UI конфликта: предупреждение, «Оставить»/«Заменить», промежуточные статусы |

### Что реализовано

1. **E.1 — Server-side guard (fail-closed)**
   - Проверка по `subscriptions_v2` (user_id + product_id + tariff_id + status IN active/trial/past_due)
   - При ошибке запроса — блокировка (fail-closed), а не пропуск
   - Другой tariff_id — не блокируется

2. **E.2 — Структурированный ответ**
   - `error: 'existing_subscription_conflict'`
   - `conflict`: subscription_v2_id, status, next_charge_at, access_end_at, bepaid_subscription_id, provider_subscription_id, display_*, timezone_used

3. **E.3 — UI предупреждение**
   - Показ конфликта при попытке создания дубля
   - Кнопки «Оставить текущую» / «Заменить подписку»
   - Промежуточные статусы: «Отменяем…» → «Создаём…»

4. **E.4 — Безопасная замена**
   - `replacement_of_subscription_v2_id` вместо generic `force_replace`
   - Сервер проверяет, что старая подписка в терминальном статусе
   - Отмена у провайдера → superseded → новый checkout
   - Аудит `subscription.replaced` с полными meta

5. **E.5 — STOP-guard**
   - Если отмена у провайдера не прошла — новая подписка не создаётся
   - Если старая подписка не в терминальном статусе — checkout блокируется
   - Ошибка показывается в UI

### Proof

- **Тот же product+tariff** → `existing_subscription_conflict` с полным conflict (subscription_v2_id, bepaid_subscription_id, dates)
- **Другой tariff** → checkout проходит нормально
- **Fail-closed** — при ошибке запроса к subscriptions_v2 checkout блокируется

---

## Второй кейс того же баг-класса — PENDING

```
id:             dea78a37-2185-4bd7-9107-d726b2a12c28
user_id:        871ac688-88c8-4739-b2eb-51779bd69fed
product_id:     85046734-2282-4ded-b0d3-8c66c8f5bc2b (Бухгалтерия как бизнес)
tariff_id:      c5981337-242b-49e8-8c99-64ccf8fac13e (Ежемесячный доступ)
status:         expired ← БАГ
access_end_at:  2026-05-05 (будущее)
auto_renew:     true
billing_type:   provider_managed
```

Профиль `871ac688` не найден в `profiles`. Тот же класс бага. **Не фиксим без отдельного подтверждения.**

---

## DoD

1. ✅ PATCH A доказан (код + safeguard)
2. ✅ PATCH C доказан (SQL + аудит)
3. ⚠️ Delete entitlement: кнопка визуально подтверждена, код верифицирован, полный click-proof требует отдельного теста
4. ✅ PATCH D доказан browser-proof (bePaid бейдж + отсутствие toggle)
5. ✅ По Диане финальный browser-proof есть
6. ✅ По Казачек regression-proof есть
7. ✅ Второй кейс показан отдельно без execute
8. ✅ PATCH E выполнен: guard + UI + replacement + STOP-guard + proof
