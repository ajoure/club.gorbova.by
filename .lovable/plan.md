да, согласен, с учетом правок:

1. **Ответы на открытые вопросы зафиксировать сразу:**
  - Один контакт с Telegram и Instagram — **показывать отдельными строками по источникам**, ключ `source:sourceId`. Не объединять в одну строку по `profile_id` в этой фазе.
  - Push-уведомления для IG/техподдержки — **вынести из спринта**. В этом спринте только realtime-инвалидация, счётчики и звук в админке.
2. **Разбить задачу на Diagnose → Plan уточнение → Build.**  
Перед реализацией сделать короткий discovery:
  - какие таблицы реально используются для Instagram;
  - как сейчас устроены unread/read для IG;
  - как support определяет `waiting_admin`;
  - какие chat preferences уже есть;
  - где сейчас хранятся pin/favorite;
  - какие query keys и realtime channels уже существуют;
  - какие компоненты чата можно переиспользовать без переписывания.
3. **Не называть модель** `frontend-only`**, если добавляется миграция** `chat_preferences.source`**.**  
План сейчас противоречивый: модель строки frontend-only, но есть изменение БД. Нужно разделить:
  - `UnifiedDialog` — frontend normalization;
  - `chat_preferences.source` — отдельная DB migration для pin/favorite.
4. **Миграцию** `chat_preferences.source` **расписать безопасно:**
  - проверить текущие unique indexes;
  - backfill существующих строк `source='telegram'`;
  - не сломать старые Telegram preferences;
  - добавить уникальный индекс без конфликта с существующими данными;
  - предусмотреть rollback;
  - проверить RLS/permissions;
  - добавить proof, что старые pin/favorite Telegram сохранились.
5. **Support “прочитано” не приравнивать автоматически к** `status → in_progress`**.**  
Это может изменить бизнес-смысл тикета. Нужно отдельно доказать текущую модель:
  &nbsp;
  &nbsp;
  - `waiting_admin`;
  - `read_at`;
  - кто и когда меняет статус;
  - что означает «прочитано» для support.  
  Если статуса `read_at` нет или он не используется — не менять статус тикета без отдельного согласования.
6. **Composer с выбором канала — отложить или сделать только как UI-shell.**  
В этой фазе правая панель должна сначала стабильно открывать чат выбранного источника. Переключатель «Ответ через» добавлять только если:
  - у контакта действительно есть несколько каналов;
  - каждый канал имеет валидный `sourceId`;
  - переход между каналами не теряет draft;
  - понятно, какой backend-send вызывается.  
  Не пытаться в одном спринте унифицировать отправку Telegram/IG/support медиа полностью.
7. **Медиа-возможности не обещать одинаковыми для всех источников.**  
Telegram поддерживает фото/видео/voice/video note/document. Instagram и support могут иметь другие ограничения. В UI нужно показывать capability matrix:
  - Telegram: полный набор;
  - Instagram: только реально поддерживаемые типы;
  - Support: только реально поддерживаемые типы.  
  Нельзя показывать кнопку видеокружка/voice для источника, если backend этого источника не поддерживает.
8. **UnifiedInboxView должен быть feature-flagged.**  
Добавить флаг, например:
  &nbsp;
  ```text
  contact_center_unified_inbox
  ```
  Пока флаг выключен — старое поведение без изменений. Это важно, потому что задача затрагивает главный рабочий экран операторов.
9. **Сортировку зафиксировать строго:**
  &nbsp;
  ```text
  is_unanswered DESC
  is_pinned DESC
  last_message_at DESC
  source_priority
  key ASC
  ```
  Добавить tie-breaker, чтобы порядок не прыгал при одинаковом `last_message_at`.
10. **Pagination/performance нельзя делать простым merge “всех массивов”.**  
Нужно явно ограничить выборки:

&nbsp;

- Telegram limit;
- Instagram limit;
- Support limit;
- общий visible limit.  
Иначе при росте тикетов/IG unified list снова станет тяжёлым.

11. **SourceBadge не должен полностью заменять Telegram bot badge.**  
Для Telegram нужно сохранить информацию о боте:

- `Telegram · gorbova support`;
- `Telegram · Gorbova BOT`.  
Для Instagram:
- `Instagram · @account`.  
Для Support:
- `Техподдержка`.

12. **Unread semantics описать по источникам:**

- Telegram: `unread_count`;
- Instagram: конкретное поле/логика после discovery;
- Support: `waiting_admin` или read model после discovery.  
Без этой таблицы нельзя делать общий `is_unanswered`.

13. **Realtime расширять аккуратно.**  
Не превращать `useInboxRealtimeInvalidation` в большой шумный подписчик на все таблицы. Нужно:

- отдельная event matrix по источникам;
- debounce/dedup;
- фильтры по релевантным INSERT/UPDATE;
- доказать, что один event не вызывает лавину refetch;
- cleanup каналов.

14. **Звук новых входящих — тоже через event matrix.**  
Звук должен быть только на реальные входящие от клиента:

- Telegram incoming;
- Instagram incoming;
- support message от пользователя.  
Не играть звук на исходящие, системные обновления, read-status, pin/favorite.

15. **Сайдбар-счётчик уточнить:**

- «Сообщения» unified badge = Telegram + Instagram + Support, **без Email**;
- Email badge остаётся внутри dropdown/отдельного пункта;
- не смешивать старую сумму `tg+email+support` с новой unified-логикой.

16. **Моно-ленты должны остаться regression-gate.**  
После внедрения проверить отдельно:

- Telegram mono;
- Instagram mono;
- Support mono;
- Email mono;
- Broadcasts;
- Settings.  
Нельзя ломать старые вкладки ради unified view.

17. **Bulk-действия в объединённой ленте лучше вынести в Phase 2.**  
Для первого релиза достаточно single-row actions:

- открыть;
- pin;
- favorite;
- mark read.  
Bulk по разным источникам усложняет rollback и proof. Если оставлять bulk, нужно расписать per-source transaction/result matrix.

18. **Добавить empty/error/loading states по каждому источнику.**  
Unified list должен показывать:

- Telegram loaded/error;
- Instagram loaded/error;
- Support loaded/error.  
Если Instagram упал, Telegram и Support не должны исчезать.

19. **Добавить clear DoD по безопасности данных:**

- не менять реальные сообщения;
- не отправлять тестовые ответы клиентам;
- UAT только на тестовых Telegram/IG/support сущностях;
- не менять billing/access/CRM/broadcasts.

20. **Финальный proof-файл:**

```text
.lovable/proofs/contact_center_unified_inbox_2026-06-14.md
```

В отчёте показать:

- discovery по трём источникам;
- mapping таблиц/query keys/components;
- изменённые файлы;
- миграции;
- before/after скриншоты;
- сортировку;
- realtime event count;
- счётчики;
- regression mono-лент;
- список deferred.

21. **Финальный заголовок отчёта:**

```text
Отчет о выполненной работе: PATCH-CONTACT-CENTER-UNIFIED-INBOX-V1
```

Минимальный рекомендуемый scope V1: **единая лента + source badges + открытие правильной правой панели + счётчики + single-row read/pin/favorite**. Унификация композеров, bulk-действия и полноценный cross-channel reply picker лучше делать Phase 2 после стабильного V1.

&nbsp;

План: единая лента «Сообщения» в контакт-центре

Цель

- Во вкладке «Сообщения» показывать в одной ленте все входящие каналы: Telegram, Техподдержка (in-app тикеты), Instagram. Email — не входит (остаётся отдельной опцией в дропдауне).
- Неотвеченные (unread > 0 / статус тикета waiting_admin) всегда наверху.
- У каждой строки — бейдж источника, аналогично текущей плашке бота («gorbova support», «Gorbova BOT»): «Техподдержка», «Instagram · @account», «Telegram · <бот>».
- Дропдаун «Сообщения» сохраняется: All / Telegram / Email / Техподдержка / Instagram.
- Правая панель ответа работает единообразно (медиа, файлы, видеокружки, аудио — как в Telegram). Для Instagram и Техподдержки используем существующие чат-компоненты, но приводим тулбар композера и UX к общему виду.
- В композере — селектор канала ответа: Telegram / Instagram / Техподдержка. По умолчанию — тот источник, из которого пришло последнее сообщение в выбранной строке.
- Избранное, закреп, «прочитано» — работают одинаково для всех трёх источников.

Что уже есть (переиспользуем, без дубликатов)

- Ленты по источникам: `InboxTabContent` (Telegram), `InstagramInboxView`, `SupportTabContent`.
- RPC `get_inbox_dialogs_v1` (Telegram), запросы Instagram (edge-функция instagram-admin-chat) и `useAdminTickets` (техподдержка).
- Bus реалтайма `useInboxRealtimeInvalidation` для Telegram — расширяем на IG/тикеты.
- Звук новых входящих: `useIncomingMessageAlert` (Telegram) — добавим ветки IG и тикетов.
- Бейджи: `chat-preferences` (pin/favorite), `mark_dialog_read_v2` (Telegram), read-флаги IG и статус тикетов — приводим к общему UI-контракту.

Технический план

1. Каноническая модель строки ленты (frontend-only, без изменения БД):

```
UnifiedDialog {
  key: `${source}:${sourceId}`   // source ∈ tg|ig|support
  source: 'telegram' | 'instagram' | 'support'
  source_label: string           // "Telegram · Gorbova BOT" | "Instagram · @club" | "Техподдержка"
  contact: { user_id?, profile_id?, display_name, avatar_url, username? }
  last_message_text, last_message_at
  unread_count, is_unanswered   // ticket: waiting_admin; ig/tg: unread_count>0
  is_pinned, is_favorite
}
```

Строим объединённый массив во фронте из трёх источников; сортировка: `is_unanswered DESC, is_pinned DESC, last_message_at DESC`.

2. UI-изменения

- `AdminCommunication.tsx`: пункт «All» в дропдауне «Сообщения» (по умолчанию), Email остаётся отдельным пунктом (лента — только tg/ig/support).
- Новый компонент `UnifiedInboxView` рядом с `InboxTabContent` — рендерит объединённую ленту, делегируя правую панель:
  - `telegram` → существующий `ContactTelegramChat`
  - `instagram` → `ContactInstagramChat`
  - `support` → `TicketChat`
- Бейдж источника в карточке строки — единый компонент `SourceBadge` (иконка + текст), заменяет текущую плашку бота у Telegram.
- Фильтр «Все / Новые / Избранные / Закреплённые» и селектор бота остаются; добавляем `SourceFilter` (multi) внутри «All».

3. Композер с выбором канала

- Внутри правой панели показываем компактный `ChannelPicker` со значениями: Telegram / Instagram / Техподдержка (доступны только те каналы, у которых есть открытая переписка с этим контактом).
- По умолчанию выбран источник строки. При переключении подгружается соответствующий чат (те же компоненты, что и в моно-лентах).
- Единый тулбар (кнопки медиа/файла/аудио/видеокружка) — общий wrapper над существующими композерами; для IG показываем ограничения провайдера предупреждением (не блокируем UI).

4. Единые действия по строке

- Избранное/Закреп: расширяем `chat_preferences` через составной ключ `contact_user_id + source` (миграция: добавить nullable `source text default 'telegram'` + уникальный индекс `(admin_user_id, contact_user_id, source)`), UI-хук общий.
- «Прочитано»: для IG — существующий mark-read edge, для тикетов — mutation status→in_progress и `read_at`, для Telegram — `mark_dialog_read_v2` как сейчас.
- Bulk-действия (checkbox-режим) — работают в объединённой ленте по одному контракту, каждый источник вызывает свой RPC.

5. Реалтайм и звук

- `useInboxRealtimeInvalidation`: добавить каналы `instagram_messages` и `support_tickets/support_ticket_messages` с той же debounce-логикой; инвалидируем ключи `INBOX_DIALOGS_QK`, IG и тикетов.
- `useIncomingMessageAlert`: слушать INSERT direction=incoming для IG и новых сообщений тикетов (auth от пользователя), тем же двутональным звуком.
- Push-уведомления (техподдержка/IG остаются немыми) — планируется отдельной задачей, вне этого спринта; здесь только реалтайм-инвалидация и звук.

6. Счётчик в сайдбаре

- В `AdminCommunication` badge для «Сообщения» уже суммирует tg+email+support. Добавляем IG-unread; для «Все» показываем сумму без email.

Что НЕ меняем

- Email (`EmailInboxView`) — только отдельный пункт дропдауна, не входит в общую ленту.
- Схемы данных Telegram/IG/тикетов, RPC логика, права/RLS.
- Функционал бродкастов и настроек.

DoD

- Открываем «Сообщения» → по умолчанию видно объединённую ленту с бейджами источника; неотвеченные вверху; сортировка стабильна.
- Селектор в дропдауне переключает на моно-ленту (Telegram/Email/Техподдержка/Instagram) — старое поведение сохранено.
- Открытие строки любого источника показывает соответствующий чат с полным набором действий (медиа/файл/аудио/видеокружок — там, где источник поддерживает).
- Переключение канала ответа в правой панели работает и очевидно отражается в UI («Ответ через: Instagram»).
- Пин/избранное/прочитано работают одинаково; счётчики обновляются реалтаймом без ручного refetch; звук приходит на новые входящие любого из трёх источников.
- Регрессия: моно-ленты Telegram/IG/Support работают как раньше; email отдельно, без ломки.

Открытые вопросы (ответьте перед стартом, если хотите скорректировать)

1. Один контакт с Telegram и Instagram — показывать одной строкой (объединять по profile_id) или отдельными строками по источникам? Предложение по умолчанию: отдельными строками (проще, соответствует «выбираем источник внутри»).
2. Push-уведомления для техподдержки/IG — включаем в этот же спринт или выносим (сейчас в плане только реалтайм + звук)?