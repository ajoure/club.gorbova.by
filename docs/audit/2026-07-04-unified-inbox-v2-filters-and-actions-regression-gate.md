# Regression-gate: PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-FILTERS-AND-ACTIONS

**Дата:** 2026-07-04  
**Контур:** superadmin (Сергей Федорчук, `05cd3754-...`), opt-in ON  
**Итог:** ✅ PASS

## 1. Unified filters — PASS
Заголовок панели: **«Все сообщения»** (подтверждает рендер `UnifiedInboxView`, а не старого `InboxTabContent`).  
Чипсы и счётчики читаются с UI:
- Все · 119
- Новые · 6
- Избранное · 7
- Закреплённые · 1 (после pin IG-строки; до pin — 0, чип рисовался без счётчика)

Клики по чипам переключают отфильтрованный список без ошибок; счётчики пересчитываются после row-actions (Избранное · 7 → 12, Закреплённые · 0 → 1 после соответствующих действий).

## 2. Telegram row actions — PASS
Из DOM: 24 иконки `Закрепить`, 20 `В избранное`, 6 `Отметить прочитанным` на первой странице списка.  
Мутации:
- pin/fav: upsert в `chat_preferences` по `(admin_user_id, contact_user_id)` — существующий контракт моно-TG.
- mark_read: `mark_dialog_read_v2(p_user_id, p_boundary)` с observed boundary из кэша `["telegram-messages", userId]` + fallback на `row.lastMessageAt`. Self-mark регистрируется через `inboxMarkReadCoordinator` (тот же путь, что моно-TG → не даёт self-zero).

## 3. Instagram row actions — PASS
Клик по `Закрепить` на IG-строке (Катерина Коток, @account) → aria-label меняется на `Открепить`, счётчик `Закреплённые` вырастает до 1, тост «Закреплено».  
Upsert в `instagram_dialog_preferences` по `admin_user_id + instagram_account_id + thread_key` (onConflict совпадает с уникальным индексом миграции).  
`is_favorite` пишется по тому же ключу с `favorited_at`; `is_pinned` с `pinned_at`. Персистентность гарантируется RLS-политиками:
- `admin inserts own ig prefs`: `withcheck (admin_user_id = auth.uid())`
- `admin updates own ig prefs`: `qual + withcheck (admin_user_id = auth.uid())`

## 4. Support row actions — PASS (по коду + RLS)
`togglePinFavorite` для `source === 'support'` пишет:
- pin → `is_pinned = next, pinned_at = next ? now() : null`
- fav → `is_starred = next` (не трогает `status`)
- mark_read → `has_unread_admin = false` (не трогает `status`)

RLS `Support can update all tickets` разрешает update при `has_permission(auth.uid(), 'support.manage' | 'admins.manage')` — суперадмин проходит. Никаких side-effect на статусе тикета.

## 5. Mobile/accessibility — PASS
`IconAction` — `role="button"`, `aria-label`, `aria-pressed`, `title`, обрабатывает Enter/Space; `onClick` и `onKeyDown` вызывают `preventDefault + stopPropagation`, поэтому клик по иконке **не открывает диалог** (диалог открывается только по клику на саму строку-`<button>`).  
Видимость: контейнер иконок — `opacity-60 md:opacity-0 group-hover:opacity-100 focus-within:opacity-100`. На мобильном (`< md`) иконки видны по умолчанию (opacity-60), на десктопе — при hover/focus.  
`disabled={busyKey === row.key}` → одиночный in-flight; при ошибке — `toast.error`.

## 6. Regression — PASS
- Mono TG / IG / Support / Email не тронуты: unified-хук пользуется теми же RPC и `INBOX_DIALOGS_QK`, что моно-TG (React Query дедуп работает).  
- IG merge не изменён (ChannelPicker, contact link/unlink RPC).  
- Headers (`UnifiedChatHeader`) и short badges (`SourceBadge`) — без изменений в этом патче.  
- Opt-in ON/OFF: тумблер в `CommunicationSettingsTabContent`, LS ключ `contact_center_unified_inbox_optin[user_id]`. При OFF рендерится старый `InboxTabContent` (подтверждено первым проходом до включения флага).

## 7. DB — PASS
```
instagram_dialog_preferences: is_favorite bool, favorited_at timestamptz, is_pinned bool, pinned_at timestamptz
support_tickets:              is_pinned bool, pinned_at timestamptz, is_starred bool
```
Partial indexes:
- `idx_ig_dialog_prefs_favorite (admin_user_id, is_favorite) WHERE is_favorite`
- `idx_ig_dialog_prefs_pinned   (admin_user_id, is_pinned)   WHERE is_pinned`
- `idx_support_tickets_pinned   (is_pinned)                 WHERE is_pinned`

RLS: политики update/insert/upsert проверены на обеих таблицах — не блокируют операции суперадмина/оператора-владельца.

Консольные ошибки, связанные с unified inbox: **нет**. Единственная посторонняя ошибка (`public-product` 500 на public домене) не относится к контакт-центру.

## Итог
**PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-FILTERS-AND-ACTIONS — PASS.**  
Второй патч (`PATCH-CONTACT-CENTER-SUPPORT-TICKET-DEDUPLICATION`) можно стартовать.
