# Unified inbox V2 — mapping fix Telegram contract

Дата: 2026-07-04
Тип: fix + design doc (frontend-only, без DB-миграций)

## Root cause (подтверждён)

`ContactTelegramChat` (src/components/admin/ContactTelegramChat.tsx:1396):

```tsx
if (!telegramUserId) {
  return <>Telegram не привязан</>;
}
```

`telegramUserId` в этом компоненте — **числовой Telegram user ID**
(profiles.telegram_user_id), НЕ profiles.user_id (UUID).

### Mono-контракт (InboxTabContent.tsx:1050)
```tsx
<ContactTelegramChat
  userId={selectedUserId}                                            // profiles.user_id (UUID)
  telegramUserId={selectedDialog?.profile?.telegram_user_id || null} // числовой TG ID ✅
  telegramUsername={selectedDialog?.profile?.telegram_username || null}
  ...
/>
```

### Unified V1-контракт (UnifiedInboxView.tsx, ДО фикса)
```tsx
<ContactTelegramChat
  userId={row.meta.telegramUserId!}    // profiles.user_id (UUID) ✅
  telegramUserId={null}                // ❌ ХАРДКОД NULL → "Telegram не привязан"
  telegramUsername={null}              // ❌ ХАРДКОД NULL
  ...
/>
```

Причина: `useUnifiedInbox` в SELECT из profiles не запрашивал
`telegram_user_id, telegram_username`, а `UnifiedInboxView.ChatPanel`
подставлял `null` вместо реальных значений.

## Mapping-таблица контракта

| Prop ContactTelegramChat | Тип | mono (InboxTabContent) | unified V1 (ДО) | unified V2 (ПОСЛЕ) |
|---|---|---|---|---|
| `userId` | UUID (profiles.user_id) | selectedUserId ← dialog.user_id | row.meta.telegramUserId ← d.user_id | ✅ без изменений |
| `telegramUserId` | number (числовой TG ID) | profile.telegram_user_id | **null** ❌ | row.meta.telegramNumericId ← profile.telegram_user_id ✅ |
| `telegramUsername` | string | profile.telegram_username | **null** | row.meta.telegramUsername ← profile.telegram_username ✅ |
| `clientName` | string | profile.full_name | row.displayName | без изменений |
| `avatarUrl` | string | profile.avatar_url | row.avatarUrl | без изменений |
| `bot_id` (internal state) | UUID | восстанавливается из lastInbound.bot_id | idem | idem |

Дополнительно read-only проверено: `chat_id`, `selectedBot`, query key
`["telegram-messages", userId]`, edge `telegram-admin-chat get_messages`
получают тот же `userId` (profiles.user_id UUID) — эти цепочки в mono
и unified идентичны и не были причиной регрессии. Единственный
поломанный контракт — `telegramUserId` prop.

## Что изменено

- `src/hooks/useUnifiedInbox.ts`:
  - `UnifiedDialog.meta` теперь несёт `telegramNumericId?: number | null`
    и `telegramUsername?: string | null`.
  - SELECT из profiles расширен на `telegram_user_id, telegram_username`.
  - Normalize Telegram: пробрасывает `p?.telegram_user_id ?? null` /
    `p?.telegram_username ?? null` в meta.
- `src/components/admin/communication/unified/UnifiedInboxView.tsx`:
  `ChatPanel` для source=telegram теперь передаёт
  `telegramUserId={row.meta.telegramNumericId ?? null}` и
  `telegramUsername={row.meta.telegramUsername ?? null}`.

## Флаг — по-прежнему OFF по умолчанию

Требование пользователя: «Unified держать выключенным по умолчанию до
полного proof». Реализация:

- `useUnifiedInboxFlag()` по умолчанию возвращает `false`.
- UI-тумблер в настройках — `disabled`, setter — no-op.
- Legacy-ключ `contact_center_unified_inbox` чистится при mount.
- V2-test override — ТОЛЬКО ручной:
  `localStorage.setItem("contact_center_unified_inbox_v2_test","1")`.
  Оператор в проде без ручной команды в devtools ничего не увидит.

## Verify (Playwright, headless, реальная auth-сессия)

Скриншоты: `/tmp/browser/rollback/screens/5..8_*.png`

| Кейс | Ожидание | Факт |
|---|---|---|
| A. Default OFF: dropdown «Все» | отсутствует | 0 ✅ |
| B. V2-test override включён: пункт «Все» | появляется | 1 ✅ |
| B. Unified feed рендерится | список Telegram+IG+Support вперемешку | ✅ (screens/6_v2_unified.png) |
| B. Клик по Instagram-строке | Instagram chat header, без ошибок | «Катерина Коток · Instagram Direct» ✅ (screens/7_v2_dialog.png) |
| B. Клик по Telegram-строке (Вероника Матук) | Telegram chat, composer, bot selector | «gorbova support», поле «Введите сообщение…» ✅ (screens/8_v2_telegram_dialog.png) |
| B. «Telegram не привязан» | отсутствует | 0 ✅ |
| Легаси-ключ `contact_center_unified_inbox="1"` при mount | очищается | `null` ✅ |

## Что остаётся дальше (Phase 3, только по прямому запросу)
- Смоук по остальным типам сообщений (voice/video note/фото/документ)
  внутри unified — код-путь идентичен mono, но пока не проверен вручную.
- Cross-channel composer (ответ в другой источник), bulk-действия.
- Merge one contact across sources (сейчас: separate rows per source).
- UI-тумблер включения фичи заново (после того, как proof будет принят).
