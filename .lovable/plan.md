
# ВЫПОЛНЕНО: Исправление Telegram-уведомлений и отображения платежей

## Статус: ✅ Завершено (2026-02-03)

---

## Исправленные проблемы

### ✅ Проблема 1: Кнопка "Тест себе" не работает

**Файл:** `supabase/functions/telegram-send-test/index.ts`

**Было:**
- Функция искала несуществующую колонку `telegram_link`
- Использовала `eq("id", userId)` вместо `eq("user_id", userId)`
- Делала лишние lookups в `telegram_members` и `telegram_profile_links`

**Исправлено:**
- Используется `telegram_user_id` напрямую из профиля
- Правильный запрос: `eq("user_id", userId)`
- Удалены лишние lookups — всё берётся из profiles

---

### ✅ Проблема 2: Платежи не отображаются в карточке контакта

**Файл:** `supabase/functions/bepaid-webhook/index.ts`

**Было:**
- При создании `payments_v2` не указывался `profile_id`

**Исправлено в 3 местах:**

1. **Legacy checkout flow (строки ~2072-2100):**
   - Добавлен resolve `profile_id` из `orderV2.profile_id` или profiles table

2. **Orphan order reconstruction (строки ~3021-3045):**
   - Добавлен resolve `profile_id` перед insert

3. **SQL миграция:**
   - Обновлены существующие 489+ платежей с `profile_id`

---

### ✅ Проблема 3: Уведомления в Telegram не приходят администраторам

**Файл:** `supabase/functions/bepaid-webhook/index.ts`

**Было:**
- Legacy flow отправлял только email через Resend
- Telegram уведомление было только в direct-charge flow

**Исправлено:**
- Добавлен вызов `telegram-notify-admins` в legacy flow (после audit_log, перед email)
- Формат сообщения идентичен direct-charge flow

---

## Развёрнутые функции

- ✅ `telegram-send-test` — deployed
- ✅ `bepaid-webhook` — deployed

---

## Результаты миграции

```
Платежи с profile_id: 489
Платежи без profile_id: 353 (без user_id или orphan профили)
```

---

## Что проверить

1. **Кнопка "Тест себе"** — должна работать в мастере KB
2. **Новые платежи** — должны появляться в карточке контакта
3. **Telegram уведомления** — должны приходить при оплате (и trial, и обычные)
