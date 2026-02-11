

# FIX: ContactDetailSheet показывает "Заблокирован" и "Telegram не привязан" для активных пользователей

## Корневая причина

`ContactDetailSheet` полностью доверяет пропу `contact` для отображения `user_id`, `status`, `telegram_user_id`. Но разные вызывающие компоненты передают **неполные данные**:

| Вызывающий компонент | Что передаёт | Что отсутствует |
|---|---|---|
| `AdminContacts.tsx` | Полный профиль (select *) | -- (всё ок) |
| `InboxTabContent.tsx` | Частичный профиль из диалога | `status`; может потерять `user_id` при ре-рендере |
| `SupportTabContent.tsx` | `selectedTicket?.profiles` | Зависит от join; может не содержать `telegram_user_id` |
| `AdminDeals.tsx`, `AdminLessonProgress.tsx` | Зависит от контекста | Потенциально неполный |

При потере `user_id`:
- Строка 1342: показывается бейдж "Ghost"
- Строка 1352: показывается "Заблокирован" вместо реального статуса
- Строка 1956: Telegram-таб показывает "Telegram не привязан"

Данные в БД корректны: обе пользовательницы `status: active`, Telegram привязан.

## Решение (минимальный diff, 1 файл)

### `src/components/admin/ContactDetailSheet.tsx`

**Шаг 1**: Расширить существующий запрос `profileData` (строка 334), добавив поля `user_id`, `status`, `telegram_user_id`, `telegram_username`:

```typescript
// Было:
.select("telegram_linked_at, telegram_link_status, loyalty_score, loyalty_updated_at, loyalty_auto_update")

// Стало:
.select("user_id, status, telegram_user_id, telegram_username, telegram_linked_at, telegram_link_status, loyalty_score, loyalty_updated_at, loyalty_auto_update")
```

**Шаг 2**: Добавить вычисляемые переменные сразу после запроса profileData (~строка 342):

```typescript
// Reliable contact fields: prefer DB data (profileData) over potentially stale props
const resolvedUserId = profileData?.user_id ?? contact?.user_id ?? null;
const resolvedStatus = profileData?.status ?? contact?.status ?? "active";
const resolvedTelegramUserId = profileData?.telegram_user_id ?? contact?.telegram_user_id ?? null;
const resolvedTelegramUsername = profileData?.telegram_username ?? contact?.telegram_username ?? null;
```

**Шаг 3**: Заменить все обращения к `contact.user_id`, `contact.status`, `contact.telegram_user_id`, `contact.telegram_username` на `resolved*` переменные в ключевых местах:

1. **Ghost badge** (строка 1342): `!contact.user_id` -> `!resolvedUserId`
2. **Status badge** (строка 1349-1360): `!contact.user_id` -> `!resolvedUserId`, `contact.status` -> `resolvedStatus`
3. **Telegram tab condition** (строка 1956): `contact.telegram_user_id` -> `resolvedTelegramUserId`
4. **Telegram "не привязан" fallback** (строка 2060): аналогично
5. **Telegram profile info** (строки 1963, 1969, 1976-1985): `contact.telegram_user_id` -> `resolvedTelegramUserId`, `contact.telegram_username` -> `resolvedTelegramUsername`
6. **ContactTelegramChat props** (строка 2072-2074): аналогично

## Что НЕ меняем
- Никаких SQL/миграций/RLS
- Никаких других файлов
- Запрос profileData уже существует — только расширяем select
- Логика Ghost/Заблокирован остаётся такой же, но теперь использует реальные данные из БД

## Технические детали

Приоритет данных: `profileData` (свежие из БД) > `contact` prop (потенциально неполный) > дефолт.

Это безопасно, потому что:
- `profileData` fetchится по `contact.id` (profile.id), который всегда передаётся корректно
- Если `profileData` ещё загружается (undefined), fallback на `contact` prop работает как раньше
- На десктопе из AdminContacts (где данные полные) поведение не меняется

## DoD
1. Открыть ContactDetailSheet из Inbox для пользователя с привязанным Telegram — статус "Активен", Telegram показывает данные
2. Открыть из AdminContacts — поведение не изменилось
3. SQL-пруф: select count of profiles where user_id IS NOT NULL and status = 'active' — подтверждение корректности данных

