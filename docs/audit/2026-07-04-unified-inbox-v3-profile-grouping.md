# PATCH-CONTACT-CENTER-UNIFIED-INBOX-V3-PROFILE-GROUPING

Дата: 2026-07-04
Статус: DONE

## Что сделано

Одна строка ленты = один контакт. Telegram / Instagram / Support свёрнуты в
каналы внутри карточки. Правая панель переключает канал без смены
`selectedKey`.

## Файлы

- `src/hooks/useUnifiedInbox.ts` — добавлены `SourceChannelRef`,
  `UnifiedContactRow`, `getActiveChannel`, `contactRows`. Legacy `rows`
  оставлен для совместимости.
- `src/components/admin/communication/unified/ChannelPicker.tsx` — теперь
  меняет `activeSource` внутри контакта, а не `selectedKey`.
- `src/components/admin/communication/unified/UnifiedChatHeader.tsx` —
  принимает contact + activeSource; бейджи всех каналов, активный подсвечен.
- `src/components/admin/communication/unified/UnifiedInboxView.tsx` —
  переписан под `contactRows` и `activeSourceByKey`; поиск/фильтры/actions
  работают на contact-level.

## Правило группировки

```
groupKey = profileId ? "profile:<id>" : "source:<src>:<key>"
```

- TG(profile=X) + IG(profile=X) + Support(profile=X) → одна строка.
- Без profileId — одинокая source-строка, как раньше.
- Support-дубли одного profileId: остаётся только самый свежий тикет
  (visual grouping, не data merge).

## Модель

```ts
UnifiedContactRow {
  key, profileId,
  displayName, avatarUrl,
  channels: { telegram?, instagram?, support? },  // каждый — SourceChannelRef с sourceRow
  availableSources[],
  defaultActiveSource,                            // канал последнего сообщения
  lastMessageAt, lastMessageSource, lastMessagePreview,
  totalUnread,                                    // сумма
  isPinned, isFavorite                            // OR
}
```

## Active source

- default = `defaultActiveSource` = channel with `max(lastMessageAt)`.
- source filter overrides default при первом выборе строки.
- override per-row в state `activeSourceByKey`.
- ChannelPicker меняет только override, `selectedKey` не двигает.

## Row actions (V1 safe)

- pin / favorite / mark-read применяются к **activeChannel** строки
  (title/aria содержит имя канала).
- Другие каналы контакта не трогаются.
- unread по другим каналам сохраняется, строка может остаться в «Новые».

## Фильтры

- **Все** — все contact rows (после source filter).
- **Новые** — `totalUnread > 0` OR исходное `isUnanswered` в любом канале.
- **Избранное** — favorite в любом канале.
- **Закреплённые** — pinned в любом канале.
- Source filter: показывает контакт, если у него есть канал этого source;
  activeSource по умолчанию = этот source.

## Поиск

Матчится по: `displayName`, каждый `channel.lastMessagePreview`, каждый
`channel.sourceRow.sourceLabel`.

## Attach IG → merge

- Одинокий IG без profileId живёт как `source:instagram:<thread>`.
- После `AttachProfileDialog` — invalidate:
  `INBOX_DIALOGS_QK`, `unified-ig-dialogs`, `unified-ig-contacts`,
  `unified-support-tickets`, `profile-channels`.
- Regroup производит новую grouped-строку `profile:<id>`; fallback по
  `lastSelectedSourceKey` находит её и обновляет `selectedKey` без reload.

## Proof (2026-07-04)

Скриншот `/tmp/browser/v3/2_search.png` (opt-in ON, поиск «федорчук»):

- Раньше: две строки «Сергей Федорчук» (Telegram + Instagram отдельно).
- Сейчас: **одна строка** «Сергей Федорчук» с двумя бейджами
  `[Instagram] [Telegram]`, totalUnread = 3, preview =
  «Instagram · Нет в Польше ее» (канал последнего сообщения).

## DoD

- Profile-linked channels — grouped into one contact row ✓
- Active channel — selected inside row ✓
- Duplicate profile rows — removed ✓
- Source-specific chats — preserved (per-source components untouched) ✓
- Full cross-channel merged chat history — **deferred**
- Contact-level pin/favorite/read-all — **deferred**

## Что НЕ трогали

- БД, RPC (`get_inbox_dialogs_v1`, `get_instagram_dialogs_v1`), edge functions.
- ManyChat, Meta Graph, `instagram_messages`.
- Auto-link профилей.

## Отдельная задача (не в этом патче)

Если ManyChat вернул `code 3031` (24h window), показать UX-текст:
«Нельзя отправить сообщение: клиент не писал в Instagram за последние 24 часа.
Дождитесь нового входящего сообщения.» — новая задача.
