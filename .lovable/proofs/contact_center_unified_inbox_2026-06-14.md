# Отчет о выполненной работе: PATCH-CONTACT-CENTER-UNIFIED-INBOX-V1

Дата: 2026-07-04
Скоуп: единая лента «Сообщения» в контакт-центре (Telegram + Instagram + Техподдержка), feature-flagged, без изменения БД.

## Diagnose (discovery)

### Источники, маппинг таблиц и unread-семантика

| Источник       | Источник данных                                         | Ключ строки                                | Unread / «неотвечено»                                          | Pin / Favorite                                                                 |
| -------------- | ------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Telegram       | RPC `get_inbox_dialogs_v1`                              | `user_id` (профиль контакта)               | `unread_count > 0` из RPC                                      | `chat_preferences (admin_user_id, contact_user_id)` — `is_pinned/is_favorite` |
| Instagram      | edge `instagram-admin-chat` action=`get_dialogs`        | `${instagram_account_id}:${thread_key}`     | `unread_count` из edge (базируется на `instagram_messages.is_read`) | `instagram_dialog_preferences (admin_user_id, instagram_account_id, thread_key)` — `is_pinned` |
| Техподдержка   | таблица `support_tickets`                               | `ticket.id`                                | `has_unread_admin = true AND status NOT IN (closed,resolved)`  | `support_tickets.is_starred` (аналог favorite); pin отсутствует, не вводим     |

### Read-модель support
- Поля `has_unread_admin`/`has_unread_user` управляются триггерами на `ticket_messages` (админ пишет → `has_unread_user`; юзер пишет → `has_unread_admin`).
- «Прочитано» = обнулить `has_unread_admin` (существующий UI TicketChat при открытии тикета уже это делает). **`status` не меняем** — избегаем изменения бизнес-семантики.
- Пуш-уведомления для support/IG — вне спринта (только realtime + звук в админке).

### Realtime и звук
- Существует `useInboxRealtimeInvalidation` (bus для `telegram_messages`) и `useIncomingMessageAlert` (звук на incoming Telegram) — оба mounted в AdminLayout.
- Для IG уже есть INSERT-подписки в `InstagramInboxView`, для support — в `useUnreadTicketsCount`. В unified режиме добавляем **дополнительно** ветку в общий bus для инвалидации unified query и звук на incoming (IG direction=incoming, support = INSERT на `ticket_messages` где author ≠ admin) — только когда фича-флаг включён, чтобы не задваивать логику моно-лент.

### Preferences — миграция НЕ нужна
Изначально план предполагал добавить `chat_preferences.source`. Discovery показал: у IG уже отдельная таблица `instagram_dialog_preferences`, у support — `is_starred`. Унификацию делаем на уровне UI-хука (per-source мутации), схема БД не меняется. Пункт «миграция chat_preferences.source» закрыт как `wont_do`.

## Plan (V1, feature-flagged)

Feature-flag: `contact_center_unified_inbox` (localStorage, `1|0`). По умолчанию **выключен** — старое поведение не меняется.

Компоненты:
1. `src/hooks/useContactCenterFeatureFlag.ts` — чтение/переключение флага.
2. `src/hooks/useUnifiedInbox.ts` — параллельно тянет 3 источника (React Query, отдельные `queryKey`), нормализует в `UnifiedDialog`, сортирует.
3. `src/components/admin/communication/unified/SourceBadge.tsx` — единый бейдж источника.
4. `src/components/admin/communication/unified/UnifiedInboxView.tsx` — левая лента + диспетчер правой панели (Telegram → `ContactTelegramChat`, IG → `ContactInstagramChat`, Support → `TicketChat`).
5. `AdminCommunication.tsx` — пункт «Все» в дропдауне (виден только когда флаг включён), + переключатель флага в настройках.
6. Расширение `useInboxRealtimeInvalidation` и `useIncomingMessageAlert` каналами IG/tickets (условно от флага).

Сортировка (строгая, с tie-breaker):
```
is_unanswered DESC, is_pinned DESC, last_message_at DESC, source_priority (tg→ig→support), key ASC
```

Лимиты per-source: Telegram 100 (RPC уже так), IG 50, Support 100 → общий visible cap 200. Пагинация — Phase 2.

Что НЕ входит в V1 (Phase 2):
- Bulk-действия по разным источникам.
- Cross-channel reply picker с общей отправкой медиа.
- Пуш-уведомления IG/support.
- Объединение строк одного контакта по `profile_id`.

## Build
См. изменённые файлы:
- `src/hooks/useContactCenterFeatureFlag.ts` — новый
- `src/hooks/useUnifiedInbox.ts` — новый
- `src/components/admin/communication/unified/SourceBadge.tsx` — новый
- `src/components/admin/communication/unified/UnifiedInboxView.tsx` — новый
- `src/pages/admin/AdminCommunication.tsx` — «Все» в дропдауне + подключение UnifiedInboxView под флагом
- `src/hooks/useInboxRealtimeInvalidation.ts` — расширение bus'а (IG + tickets) под флагом
- `src/hooks/useIncomingMessageAlert.ts` — звук на IG/support incoming под флагом
- `src/components/admin/communication/CommunicationSettingsTabContent.tsx` — тумблер unified inbox

## DoD
- Флаг выключен → все моно-ленты (TG/IG/Support/Email/Broadcasts/Settings) работают как раньше. Regression zero.
- Флаг включён → в дропдауне «Сообщения» появляется пункт «Все» и он выбран по умолчанию; лента показывает три источника с SourceBadge; неотвеченные сверху; клик по строке открывает соответствующий чат-компонент (полный функционал моно-режима).
- Pin/Fav/Read работают per-source через существующие мутации (никакого хардкода, никаких новых миграций).
- Realtime и звук: INSERT в `telegram_messages/instagram_messages/ticket_messages` (только incoming/от юзера) инвалидируют unified query и играют звук.
- Сайдбар-счётчик «Сообщения» = TG + IG + Support unread; Email badge остаётся отдельно.

## Deferred
- Cross-channel composer с выбором канала (ChannelPicker).
- Bulk-actions across sources.
- Push-уведомления IG/support.
- Объединение строк одного профиля.
- Пагинация unified ленты.
