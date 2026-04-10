
# Диагностика и исправление бага карточек доступа — Выполнение

## Статус: PATCH A, B, C, D — выполнены

---

## SQL-proof по Диане Шуляк (PATCH C)

### До фикса:
```
id: e4908f2f-f4c0-42bc-92d7-94ea6c3b22f1
status: expired ❌
access_end_at: 2026-05-08 20:59:59+00
auto_renew: false
billing_type: provider_managed
product_id: 11c9f1b8-0355-4753-bd74-40b42aa53616
tariff_id: 31f75673-a7ae-420a-b5ab-5906e34cbf84
```

### После фикса:
```
id: e4908f2f-f4c0-42bc-92d7-94ea6c3b22f1
status: active ✅
access_end_at: 2026-05-08 20:59:59+00
auto_renew: true ✅
billing_type: provider_managed
product_id: 11c9f1b8-0355-4753-bd74-40b42aa53616
tariff_id: 31f75673-a7ae-420a-b5ab-5906e34cbf84
```

### Аудит: `subscription.status_manual_fix` записан в `audit_logs`

---

## Второй аналогичный кейс (тот же класс бага)

```
id: dea78a37-2185-4bd7-9107-d726b2a12c28
user_id: 871ac688-88c8-4739-b2eb-51779bd69fed
status: expired
access_end_at: 2026-05-05 20:59:59+00
auto_renew: true
billing_type: provider_managed
product_id: 85046734-2282-4ded-b0d3-8c66c8f5bc2b
tariff_id: c5981337-242b-49e8-8c99-64ccf8fac13e
```
→ Вынесен как отдельный follow-up. Массовый UPDATE не делаем без подтверждения.

---

## Выполненные патчи

### PATCH A: Фикс sync-flow bePaid
**Файл:** `supabase/functions/bepaid-get-subscription-details/index.ts`
- При sync дат, если подписка `expired`/`past_due` и `access_end_at` > now() → автоматически восстанавливает `status = 'active'` и `auto_renew = true`
- Safeguard: только для `billing_type = 'provider_managed'`
- Не трогает `cancelled`, `revoked`, `superseded`
- Аудит: `bepaid.subscription.status_restored`
- Задеплоено ✅

### PATCH B: Кнопка удаления для карточек доступа по правилу
**Файл:** `src/components/admin/ContactDetailSheet.tsx`
- Добавлена кнопка 🗑️ (Trash2) в шаблон `activeEntitlements`
- Использует прямой DELETE из `entitlements` с подтверждением и аудитом
- Аудит включает: `entitlement_id`, `product_name`, `product_id`, `source_type`, `order_id`
- Блокировка повторного клика через `isProcessing`
- Инвалидация кэша: `admin-contact-entitlements` + `admin-contact`
- ✏️ Edit **не добавлен** — нет доказанного стандартного action-path без новых сущностей

### PATCH C: SQL-фикс подписки Дианы
- `status: expired → active`, `auto_renew: false → true`
- Аудит записан
- Подписка теперь попадает в стандартный шаблон с ✏️ и 🗑️

### PATCH D: Информативное автопродление для bePaid
**Файл:** `src/components/admin/ContactDetailSheet.tsx`
- Для подписок `billing_type = 'provider_managed'`: кнопка toggle скрыта, показан бейдж «bePaid»
- Для остальных подписок: логика toggle без изменений

---

## Follow-up (не в этом патче)

### PATCH E: Защита от двойных подписок
- Проверка по `product_id + tariff_id` при оформлении
- Конфликтующие статусы: `active`, `trial`, `past_due`, `grace_period`
- Нужен отдельный trace по кейсу Казачек

### Второй expired-кейс
- `dea78a37` — требует отдельного подтверждения перед фиксом

---

## Что НЕ сделано (по правилам)
- Не создан `EditEntitlementDialog`
- Не создан новый CRUD / новые компоненты
- Не подменено редактирование доступа редактированием сделки
- Не сделан массовый UPDATE
- Не исправлен `isCurrentValidAccess` — предикат корректен
- Не создан дубль подписки или дубль доступа
