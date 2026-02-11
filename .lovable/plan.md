

# FIX: Завершение замены contact.* на resolved* переменные в ContactDetailSheet

## Проблема

Предыдущий фикс добавил resolved-переменные (`resolvedUserId`, `resolvedStatus`, `resolvedTelegramUserId`, `resolvedTelegramUsername`), которые берут данные из БД напрямую. Но замена `contact.*` на `resolved*` была сделана **только в нескольких местах** (badge статуса, telegram tab). Остались десятки мест, где UI и запросы используют `contact.user_id`, `contact.telegram_user_id`, `contact.telegram_username` напрямую из пропа -- а проп из сделок приходит без этих полей.

## Что именно пропущено (ключевые точки)

| Строка | Что используется | Что должно быть | Эффект бага |
|--------|-----------------|-----------------|-------------|
| 351-361 | `contact?.user_id`, `contact?.telegram_user_id` в queryKey и enabled | `resolvedUserId`, `resolvedTelegramUserId` | Telegram info не загружается |
| 1334 | `contact.telegram_user_id` | `resolvedTelegramUserId` | Кнопка "Фото из Telegram" скрыта |
| 1479-1484 | `contact.telegram_username`, `contact.telegram_user_id` | resolved варианты | В карточке контакта показано "Не привязан" |
| 1487-1493 | `contact.telegram_username` | `resolvedTelegramUsername` | Ссылка на t.me скрыта |
| 1560-1571 | `contact.telegram_user_id` | `resolvedTelegramUserId` | Целая Telegram Info Card скрыта |
| 1576 | `contact.telegram_username` | `resolvedTelegramUsername` | Username не показан |

## Решение (1 файл, точечные замены)

### `src/components/admin/ContactDetailSheet.tsx`

**Замена 1** -- Telegram user info query (строки 349-363):
- queryKey: `contact?.user_id` -> `resolvedUserId`
- Условие внутри: `!contact?.user_id || !contact?.telegram_user_id` -> `!resolvedUserId || !resolvedTelegramUserId`
- body: `user_id: contact.user_id` -> `user_id: resolvedUserId`
- enabled: аналогично

**Замена 2** -- Avatar fetch from Telegram (строка 1334):
- `contact.telegram_user_id ? fetchPhotoFromTelegram : undefined` -> `resolvedTelegramUserId ? fetchPhotoFromTelegram : undefined`

**Замена 3** -- Contact info card Telegram section (строки 1479-1493):
- `contact.telegram_username` -> `resolvedTelegramUsername`
- `contact.telegram_user_id` -> `resolvedTelegramUserId`

**Замена 4** -- Telegram Info Card на вкладке "О контакте" (строки 1560-1576+):
- `contact.telegram_user_id` -> `resolvedTelegramUserId`
- `contact.telegram_username` -> `resolvedTelegramUsername`

## Что НЕ меняем

- Все остальные `contact.user_id` в запросах к orders, subscriptions, payments, audit_logs -- они используют user_id для фильтрации данных, и если user_id нет в пропе, эти запросы корректно вернут пустой результат (не критично для отображения статуса/telegram)
- SQL/миграции/RLS -- не нужны
- Другие файлы -- не нужны

## Почему предыдущий фикс не сработал

Resolved-переменные были созданы правильно (строки 344-347), но применены только к badge статуса (строка 1348-1367) и telegram tab (строки 1962+). Вкладка "О контакте" и запрос telegram info остались на старых `contact.*` полях. Когда ContactDetailSheet открывается из сделок, проп `contact` содержит только `id, user_id, email, full_name, phone, avatar_url` -- без telegram-полей и status.

## DoD

1. Открыть контакт из карточки сделки -- статус "Активен", Telegram данные видны
2. Открыть тот же контакт из списка контактов -- поведение не изменилось
3. Telegram Info Card на вкладке "О контакте" показывает ID и username
