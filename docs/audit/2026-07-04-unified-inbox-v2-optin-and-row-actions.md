# PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-OPTIN-AND-ROW-ACTIONS

**Дата:** 2026-07-04
**Скоуп:** personal opt-in для всех сотрудников контакт-центра + hover-действия pin/fav/mark-read на строках unified-ленты + удаление kill-switch.

## 1. Rollout: personal opt-in вместо superadmin auto-ON

### Изменения

- `src/hooks/useContactCenterFeatureFlag.ts` — новая матрица:
  - `optin[user_id]=true` → `enabled=true`, `source="user-optin"`
  - иначе → `enabled=false`, `source="default-off"`
- Убраны ветки `"superadmin"`, `"qa-override"`, `"kill"`. Superadmin/admin авто-ON больше нет — включают через тот же switch.
- Хранение: `localStorage.contact_center_unified_inbox_optin = JSON.stringify({ [user_id]: true })`. **Namespace по user_id** — один браузер, разные сотрудники: opt-in одного не даёт unified другому.
- Миграция при первом монтировании:
  - `contact_center_unified_inbox_v2_test=1` → `optin[current user]=true`, ключ удаляется
  - `contact_center_unified_inbox_kill` → удаляется (kill убран)
  - `contact_center_unified_inbox` (legacy) → удаляется
- `isLoading=true` пока `user?.id` не определён — предотвращает мигание пункта «Все» до загрузки сессии.
- `useUnifiedInboxFlag()` теперь возвращает реальный сеттер (personal opt-in), а не no-op.

### Rollback path

Код-роллбэк этого файла (revert) возвращает V2 в controlled-rollout режим (superadmin-only). Runtime kill-switch в UI больше не предоставляется — управление только через личный switch каждого сотрудника или через код-роллбэк.

## 2. Settings-карточка «Единая лента «Сообщения»»

`src/components/admin/communication/CommunicationSettingsTabContent.tsx` → `UnifiedInboxToggleCard`:

- Кнопки «Аварийно выключить (этот браузер)» / «Снять аварийное выключение» **удалены**.
- Единственный контрол — `Switch` (id=`unified-inbox-optin`), управляет `optin` текущего пользователя.
- Badge ON/OFF без строки `source=...` — упрощение UI, статус самоочевиден.
- Текст: «Личная настройка. Работает только в этом браузере. Не влияет на других сотрудников. По умолчанию для всех выключено; production rollout по умолчанию — отложен (deferred).»
- Switch `disabled={isLoading}` — блокируется, пока не загрузилась сессия.

## 3. Hover-действия на строках unified-ленты

`src/components/admin/communication/unified/UnifiedInboxView.tsx` + `src/hooks/useUnifiedInbox.ts`.

### Capabilities per source (normalized в `UnifiedDialog.capabilities`)

| Источник  | canPin | canFavorite | canMarkRead |
|-----------|--------|-------------|-------------|
| Telegram  | ✓      | ✓           | ✓           |
| Instagram | ✓      | —           | ✓           |
| Support   | —      | ✓ (star)    | ✓           |

Иконки без capability **не рисуются вовсе** (не disabled с tooltip). Никаких новых полей в БД — расширение IG favorite / Support pin вынесено в отдельную задачу с миграцией.

### Backend-контракты (существующие, без изменений схемы)

- **Telegram pin/favorite** — `chat_preferences` (то же, что моно-TG `InboxTabContent.togglePrefMutation`):
  - `contact_user_id = row.meta.telegramUserId` (== `profiles.user_id` UUID — тот же ключ, что моно)
  - upsert через select-then-insert/update (моно паттерн), invalidate `["chat-preferences", user.id]`.
- **Telegram mark-read** — RPC `mark_dialog_read_v2` с observed boundary:
  - `boundary = max(created_at of incoming)` из кэша `["telegram-messages", userId]`, fallback → `row.lastMessageAt`
  - `registerSelfMark(userId, 2500)` до RPC → подавление realtime-эха (тот же координатор, что моно-TG)
  - invalidate `INBOX_DIALOGS_QK`.
- **Instagram pin** — `instagram_dialog_preferences` upsert (тот же контракт, что `InstagramInboxView.togglePin`):
  - onConflict = `admin_user_id,instagram_account_id,thread_key`
  - `pinned_at` пишется только при `is_pinned=true`.
- **Instagram mark-read** — `instagram-admin-chat` edge-function, action `mark_read`, invalidate `["unified-ig-dialogs"]`.
- **Support favorite** — `support_tickets.is_starred` (то же поле, что `SupportTabContent.handleToggleStar`), invalidate `["unified-support-tickets"]` + `["admin-tickets"]`.
- **Support mark-read** — `support_tickets.has_unread_admin=false` (без изменения status — только read-flag).

### UI-инвариант

- `IconAction` изолирует клик от выбора строки: `e.preventDefault() + e.stopPropagation()` и на click, и на keyDown (Enter/Space).
- `busyKey` блокирует все действия конкретной строки во время mutation → нет двойных нажатий.
- Иконка mark-read показывается только если `row.unreadCount > 0` — иначе оператор нажимал бы «в никуда».
- Индикатор pinned/favorite (Pin, Star) в заголовке строки продолжает показываться постоянно (не только на hover), меняется по факту `refetch`.
- Сортировка/фильтрация по pin/fav НЕ меняются в этом патче (отдельная задача). Pin не поднимает строку вверх.

## 4. Что НЕ сделано (осознанно, вне скоупа)

- IG favorite: поля в схеме нет → иконка не показывается.
- Support pin: поля в схеме нет → иконка не показывается.
- Sort-by-pin в unified: отдельная задача.
- Full forced production rollout: остаётся **deferred**.
- Никаких новых edge-функций, миграций, bridge-таблиц.

## 5. DoD

- [x] Typecheck (`npx tsgo --noEmit`) — clean.
- [x] `useContactCenterFeatureFlag.ts` — `killActive`/`setKill`/`canManageKill`/`superadmin`/`qa-override` больше не экспортируются и не читаются.
- [x] `grep -r 'canManageKill\|setKill\|killActive'` по проекту — вне legacy audit-доков (`docs/audit/*.md`) ссылок нет.
- [x] `UnifiedInboxToggleCard` — Switch, без kill-кнопок, без `source=…` в badge.
- [x] Hover-иконки: pin (TG/IG), favorite (TG/Support), mark-read (TG/IG/Support) с capability-гейтингом.
- [x] Все мутации переиспользуют СУЩЕСТВУЮЩИЕ таблицы/RPC/edge-функции моно-инбоксов — контракты сохранены построчно.

## 6. Итоговый статус

- **Unified inbox V2** — available as personal opt-in for contact-center users.
- **Default for all users** — OFF.
- **Full forced production rollout** — deferred.
- **Row actions** — implemented per source capability.
- **MONO-AND-MERGE-HOTFIX / HEADERS / CHANNELS / BADGES-SHORT** — не затронуты, регрессий нет.
