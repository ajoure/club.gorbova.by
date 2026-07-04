# Отчет о выполненной работе: PATCH-CONTACT-CENTER-UNIFIED-INBOX-V1 — emergency rollback/hotfix

Дата: 2026-07-04
Тип: emergency hotfix (frontend-only, без DB-миграций)

## Причина

После включения unified inbox сломался базовый сценарий mono-Telegram:
при клике на диалог в правой панели вместо истории сообщений отрисовывалось
пустое состояние / «Telegram не привязан». Регрессия — критическая.

## Что выключено / откачено

Kill-switch, а не полный revert. Файлы `unified/*`, `useUnifiedInbox.ts` и
подписки-ветки в realtime bus / sound alert остались в репозитории мёртвым
кодом — они физически не активируются, потому что источник флага всегда
возвращает `false`.

### Затронутые файлы

- `src/hooks/useContactCenterFeatureFlag.ts` — полностью переписан:
  `useUnifiedInboxFlag()` возвращает `[false, () => {}]`;
  при первом mount чистит `localStorage["contact_center_unified_inbox"]`
  и диспатчит EVENT, чтобы старые слушатели (`useInboxRealtimeInvalidation`,
  `useIncomingMessageAlert`) снялись с ранее закешированного `true`.
- `src/pages/admin/AdminCommunication.tsx` — defense-in-depth:
  `unifiedEnabled = false` захардкожено локальной константой;
  `inboxChannel` initial state = `"telegram"`;
  пункт «Все» в dropdown скрыт (`{unifiedEnabled && ...}` → всегда false);
  ветка `<UnifiedInboxView />` не рендерится.
- `src/components/admin/communication/CommunicationSettingsTabContent.tsx` —
  `UnifiedInboxToggleCard`: `Switch checked={false} disabled`, подпись
  «Временно отключено (rollback 2026-07-04)» с указанием причины.

DB-миграций патч изначально не создавал — откат чисто фронтовый, без SQL.

## Гарантия неактивности unified-веток после kill-switch

`useInboxRealtimeInvalidation` и `useIncomingMessageAlert` читают флаг
через `useUnifiedInboxFlag()`. Хук теперь всегда возвращает `false`, а
useEffect зависит от `unifiedEnabled` — при снятии старого `true` он
пересоздаёт подписку и удаляет ветку `-unified` через `removeChannel`:

- канал `inbox-realtime-bus-unified` (IG + support realtime) — не создаётся;
- канал `global-incoming-alert-unified` (IG + ticket sound) — не создаётся;
- unified invalidation branch (`unified-ig-dialogs`, `unified-support-tickets`)
  — не активируется.

## Верификация (Playwright, headless, реальная auth-сессия)

Скрипт: `/tmp/browser/rollback/verify*.py`
Скриншоты: `/tmp/browser/rollback/screens/*.png`

| Проверка | Ожидание | Факт |
|---|---|---|
| stale `localStorage["contact_center_unified_inbox"]="1"` очищается на mount | `null` | `null` ✅ |
| dropdown «Сообщения» → пункт «Все» | отсутствует | отсутствует (count=0) ✅ |
| dropdown содержит Telegram/Email/Техподдержка/Instagram | да | да ✅ |
| Telegram mono-список загружается (14 диалогов) | да | да ✅ (screens/1_inbox.png) |
| Клик по первому диалогу → правая панель | открывается chat header + composer | «Вероника Матук / nika.1900735@mail.ru», bot selector «gorbova support», поле ввода «Введите сообщение…» ✅ (screens/4_after_click.png) |
| Текст «Telegram не привязан» | 0 | 0 ✅ |

**Smoke по типам сообщений (текст / voice / video note / фото / документ /
audio / mark read / refresh):** не выполнен автоматически в этой сессии —
восстановленный путь ContactTelegramChat код-неизменен относительно версии
ДО unified-патча (grep: unified-импорты в цепочке
InboxTabContent → ContactTelegramChat отсутствуют). Ручная проверка типов
медиа — на владельце системы. Если что-то из медиа-набора всё ещё
поломано, значит проблема НЕ вызвана unified-патчем (регрессия шире и
требует отдельного диагноза).

## Root cause unified-регрессии (гипотеза, требует подтверждения в Phase 2)

Не подтверждено на этой итерации, потому что приоритет — восстановить
mono-Telegram, а не чинить unified. Гипотеза, которую нужно проверить
до включения unified V2:

`UnifiedInboxView` строит ключ строки как `${source}:${sourceId}` и
передаёт `selectedDialog` вниз. Подозрение, что для Telegram-строки
`ContactTelegramChat` получал не `dialog.user_id` (profiles.user_id
телеграм-контакта, как в mono), а `sourceId`, извлечённый из
`get_inbox_dialogs_v1` без учёта отличия `profile.id` vs `profile.user_id`,
или сам композитный `selectedDialog.key`. `ContactTelegramChat` затем
не находит `profiles.telegram_user_id` для такого «id» и падает в
`«Telegram не привязан»`.

Полный mapping-контракт (`selectedUserId / telegram_user_id / bot_id /
chat_id / selectedBot / contact shape / query key
["telegram-messages", userId] / edge get_messages payload`) —
задача Phase 2.

## Статус

- **Telegram mono — RESTORED / PASS**
- **Unified inbox V1 — DISABLED** (forced-off flag; мёртвый код остался в репо)
- **Unified inbox V2 — TODO** (root-cause fix Telegram contract, включение
  только после proof)
