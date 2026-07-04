# PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2 — validation (2026-07-04)

## TL;DR

- Флаг остаётся **OFF по умолчанию** (production-операторы ничего не видят).
- V2 включается ТОЛЬКО через `localStorage.setItem('contact_center_unified_inbox_v2_test','1')`.
- Все ключевые проверки пройдены; регрессии моно-лент нет.
- Статус unified inbox: **disabled by default / test-only**. Готов к включению после отдельного согласования.

## 1. Default OFF

| Проверка | Ожидание | Факт | Статус |
|---|---|---|---|
| Флаг по умолчанию | `useUnifiedInboxFlag()` → `false` | `false` | PASS |
| Пункт «Все» в дропдауне | отсутствует | отсутствует (Telegram/Email/Техподдержка/Instagram) | PASS |
| Telegram mono открывается | список из 12 диалогов | 12 диалогов | PASS |
| Legacy key очищается | `contact_center_unified_inbox` → удалён | удалён при mount | PASS |

Screenshots: `01_default_off_inbox.png`, `02_default_off_dropdown.png`.

## 2. V2 test ON

| Проверка | Ожидание | Факт | Статус |
|---|---|---|---|
| Пункт «Все» появляется | видно | видно | PASS |
| Unified feed рендерится | 20+ строк, три источника | 24 строки, TG+IG+Support | PASS |
| Source badges | «Telegram · gorbova support», «Instagram · @mc:…», «Техподдержка» | все три отображаются | PASS |
| Сортировка | unanswered → pinned → last_message_at | стабильна (см. 12_v2on_unified_feed.png) | PASS |
| Telegram row → **история** | реальные сообщения, не «Telegram не привязан» | Юлия Лялина: полная переписка, voice player, admin auto-messages | PASS |
| Telegram composer | textarea + bot selector (gorbova support) | обе присутствуют, принимает ввод | PASS |
| Instagram row | ContactInstagramChat, header + composer | header «Катерина Коток · Instagram Direct · @mc:305d6fa4…», composer с attach/voice/send | PASS |
| Support row | TicketChat с историей | тикет Ольги Мацкевич: «Запрос по ст. 107», сообщения от 3 июл. 14:38, вложение, composer «Я (по умолчанию)» + «Внутренняя заметка» | PASS |
| Email в unified | отсутствует | источник не подключён (только tg/ig/support) | PASS |

Screenshots: `12_v2on_unified_feed.png`, `21_v2on_tg_history.png`, `50_v2on_support_open.png`, `51_v2on_ig_open.png`, `52_v2on_tg_composer_typed.png`.

## 3. Regression моно-лент

| Канал | Статус |
|---|---|
| Telegram mono | PASS (`30_mono_telegram.png`) |
| Email mono | PASS (`30_mono_email.png`) |
| Support mono | PASS (`30_mono_support.png`) |
| Instagram mono | PASS (`30_mono_instagram.png`) |
| Broadcasts | не затронут (unified не рендерится вне inbox tab) |
| Settings | тумблер unified в UI помечен disabled — без регрессии |

## 4. Realtime / refetch

- Начальная загрузка unified feed: **6 запросов** (`get_inbox_dialogs_v1`, `chat_preferences`, `unified-tg-profiles`, `unified-ig-accounts`, `get_instagram_dialogs_v1`, `support_tickets`).
- Idle 8 сек после стабилизации: **0 дополнительных запросов**. Никакого лишнего каскада refetch, полинги (`refetchInterval: 30_000`) во время idle-окна не сработали — ожидаемо.
- IG/Support realtime подписки при default OFF **не активируются** (`useUnifiedInbox({enabled:false})` возвращает пустой output; `enabled` пробрасывается во все `useQuery`).

## 5. Root-cause фикс — подтверждение

Контракт `ContactTelegramChat` → `telegramUserId: profiles.telegram_user_id` (число).
- До V2: `UnifiedInboxView` передавал `null` → «Telegram не привязан».
- После V2: `useUnifiedInbox` берёт `telegram_user_id` из `profiles` через enrichment-запрос и кладёт в `meta.telegramNumericId`; `ChatPanel` передаёт его в `ContactTelegramChat`.
- Итог в V2-test: **«Telegram не привязан» на скринах нет**, отображается полноценная история сообщений с voice-player, кнопками и composer.

## 6. Файлы

- `src/hooks/useContactCenterFeatureFlag.ts` — kill-switch, default OFF, V2-test override.
- `src/hooks/useUnifiedInbox.ts` — enrichment profiles с `telegram_user_id, telegram_username`.
- `src/components/admin/communication/unified/UnifiedInboxView.tsx` — `ChatPanel` пробрасывает `telegramNumericId`/`telegramUsername`.
- `src/pages/admin/AdminCommunication.tsx` — читает `useUnifiedInboxFlag`, показывает «Все» только при V2-ON.
- `src/components/admin/communication/CommunicationSettingsTabContent.tsx` — тумблер в UI помечен disabled с бейджем «временно отключено».

## 7. Статус флага и следующие шаги

- **Флаг:** OFF по умолчанию, включается только вручную через localStorage `contact_center_unified_inbox_v2_test=1`.
- **Роль UI-тумблера** в Настройках: no-op (setter пустой), UI сообщает «отключено до V2-proof».
- **Готовность к раскатке на операторов:** технический proof пройден, но включение оставлено под ручной контроль. Финальное включение — по отдельному запросу пользователя (например, включить хук `useUnifiedInboxFlag` на чтение `contact_center_unified_inbox` + вернуть setter, либо ввести server-side флаг).

## 8. Что остаётся в Phase 2 (не входит в этот патч)

- Cross-channel composer (ответить в другой канал из unified).
- Bulk-операции.
- Полная догрузка истории Instagram (пользователь отметил: «когда открываешь, не все сообщения видны, но это позже»).
- Email в unified ленте (пользователь явно исключил).
- Server-side флаг вместо localStorage-override.
