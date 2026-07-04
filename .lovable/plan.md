да, согласен, с учетом правок:

1. **План слишком большой для одного безопасного патча. Разделить на 2 патча.**
  &nbsp;
  Сейчас в одном плане смешаны:
  - P0 — багфикс Instagram history;
  - P1 — channel picker;
  - P2 — новая таблица, RPC, RLS, merge/ unlink;
  - P3 — карточка контакта по IG.
  Риск высокий: можно снова сломать уже восстановленный unified. Делать так:
2. **P0 выполнить первым и отдельно.**
  Это реальный баг: unified передаёт `thread_key`, а `ContactInstagramChat` ждёт `ig_thread_id`.
  Минимальный scope P0:
  - `useUnifiedInbox.ts` добавить `instagramThreadId = d.ig_thread_id`;
  - `UnifiedInboxView.tsx` передавать `threadId={row.meta.instagramThreadId}`;
  - `instagramThreadKey` оставить для mark_read/unread;
  - не трогать picker, merge, ContactDetailSheet, БД.
  Proof P0:
  - Катерина Коток — история IG грузится;
  - ещё один IG-контакт — история грузится;
  - mark_read работает;
  - mono-IG не сломан;
  - Telegram unified не сломан;
  - kill-switch не тронут.
3. **P1 ChannelPicker не должен обещать “писать в любой канал”, если нет открытого диалога.**
  &nbsp;
  Формулировку заменить:
  ```text
  ChannelPicker V1 переключает правую панель между уже существующими доступными каналами контакта.
  ```
  Не делать в этой фазе:
  - создание нового IG-разговора;
  - создание нового support ticket из picker;
  - отправку в канал, где нет существующего thread/ticket;
  - общий composer поверх всех источников.
  Иначе это уже cross-channel composer, который сам же указан как Phase 2/deferred.
4. **Опцию “Создать новый тикет” вынести из P1.**
  &nbsp;
  Это отдельная бизнес-операция с новым lifecycle:
  - тема тикета;
  - статус;
  - первый комментарий;
  - исполнитель;
  - уведомления;
  - read/unread;
  - audit.
  В текущем патче максимум: показать `Support` enabled, если есть открытый тикет; disabled, если нет.
5. **Не трогать существующие composer-компоненты.**
  &nbsp;
  Пункт:
  ```text
  Композер в правой панели unified становится общим
  ```
  убрать из этой фазы.
  Правильно:
  ```text
  Правая панель продолжает рендерить существующий компонент выбранного канала:
  Telegram → ContactTelegramChat
  Instagram → ContactInstagramChat
  Support → TicketChat
  ```
  ChannelPicker только меняет выбранный dialog/channel, а не унифицирует composer.
6. **P2 Merge через новую таблицу — принять, но только после отдельного DB discovery.**
  &nbsp;
  Перед миграцией обязательно проверить, нет ли уже существующих связей:
  - `instagram_contacts.profile_id`;
  - `instagram_contacts.user_id`;
  - `profiles.instagram_*`;
  - `contact_id`;
  - любые bridge-таблицы;
  - текущая логика `ContactDetailSheet`.
  Нельзя создавать `contact_channel_links`, если уже есть каноническое поле связи.
7. **Если** `instagram_contacts.profile_id` **уже существует — не дублировать связь новой таблицей.**
  &nbsp;
  Тогда правильнее:
  - использовать существующее поле;
  - добавить UI для привязки/отвязки через существующую модель;
  - не плодить параллельную truth source.
  Новая таблица допустима только если discovery докажет, что нормальной связи IG → profile сейчас нет.
8. **RLS для** `contact_channel_links` **расписать точнее.**
  &nbsp;
  Недостаточно:
  ```text
  has_role(auth.uid(),'admin' | 'superadmin')
  ```
  Нужно использовать реальный формат проекта, вероятно отдельно:
  ```sql
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin')
  ```
  И проверить фактическое имя роли `super_admin` vs `superadmin`, как уже было с rollout.
9. **Unique constraint** `unique(channel, external_id)` **может быть недостаточен.**
  &nbsp;
  Для Instagram `external_id` может быть не глобален, а зависеть от account/page. Лучше заранее заложить:
  ```text
  unique(channel, account_id, external_id)
  ```
  или хранить `external_id` в формате:
  ```text
  instagram:<account_id>:<peer_id>
  ```
  Иначе один и тот же peer id в разных IG-аккаунтах может конфликтовать.
10. **Telegram merge через** `contact_channel_links` **сейчас не делать.**

В профиле уже есть `profiles.telegram_user_id`. Не вводить вторую связь Telegram → profile.

P2 V1:

- показывать Telegram как read-only existing binding из `profiles.telegram_user_id`;
- link/unlink делать только для Instagram;
- Support пока не линковать через новую таблицу.

11. **ContactDetailSheet нельзя превращать в источник регрессии.**

Секцию «Каналы связи» добавлять изолированно:

- если запрос IG links упал — карточка контакта всё равно открывается;
- Telegram-данные карточки не ломаются;
- редактирование профиля не меняется;
- все старые действия карточки остаются.

12. **P3 клик по имени в IG-строке не должен конфликтовать с кликом по строке.**

Нужно разделить поведение:

- клик по строке = открыть чат;
- клик по имени/иконке контакта = открыть `ContactDetailSheet`;
- `event.stopPropagation()` обязателен;
- если `profile_id` нет — показать tooltip/иконку “не привязан”, но не мешать открытию чата.

13. **P1/P2/P3 должны оставаться под rollout-флагом.**

Не только unified view, но и:

- ChannelPicker;
- новые query-хуки;
- merge UI в `ContactDetailSheet`, если он доступен из unified.

Если `ContactDetailSheet` открывается и из mono Telegram, новая секция должна быть безопасной для всех, либо скрытой за тем же флагом.

14. **В DoD добавить rollback для миграции.**

Для P2 нужен:

- SQL rollback;
- proof, что удаление/отключение новой таблицы не ломает Telegram;
- отсутствие влияния на старые mono-ленты.

15. **Нельзя помечать “обычные операторы не видят” только через kill/роль.**

После P1–P3 опять проверить:

- обычный оператор не видит пункт «Все»;
- обычный оператор не видит ChannelPicker;
- обычный оператор не видит/не может использовать новые link/unlink controls, если они не должны быть доступны.

16. **Proof-файлы разделить.**

Для P0:

```text
docs/audit/2026-07-04-unified-inbox-v2-ig-history.md
```

Для P1–P3:

```text
docs/audit/2026-07-04-unified-inbox-v2-channels.md
```

17. **Финальные отчёты разделить.**

Сначала вернуть:

```text
Отчет о выполненной работе: PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-IG-HISTORY
```

Только после PASS — стартовать:

```text
PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-CHANNELS
```

## **Утверждённый порядок**

```text
1. Выполнить P0 отдельно.
2. Получить PASS по IG history.
3. Сделать DB discovery по связям IG ↔ profile.
4. После этого финализировать P1–P3.
5. Не трогать общий composer и создание новых тикетов/IG-разговоров в этом патче.
```

Сейчас выполняем только P0.

&nbsp;

План: PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-CHANNELS

Порядок Diagnose → Plan → Dry run → Execute → Verify. Все изменения — под тем же rollout-флагом (superadmin only), продакшн-операторов не касается. Всё делится на 4 подзадачи, идут строго последовательно.

## P0 — Fix: Instagram история в unified не грузится

Диагноз. Моно-IG передаёт в `ContactInstagramChat` `threadId={selectedDialog.ig_thread_id}` (реальный IG thread id из БД, нужный edge-функции `instagram-admin-chat/get_history`). Unified передаёт `threadId={row.meta.instagramThreadKey}`, куда пишется `d.thread_key` из RPC `get_instagram_dialogs_v1`. Это разные поля — в результате `get_history` получает не то, и возвращает пустую историю → «Нет сообщений».

Правки:

- `src/hooks/useUnifiedInbox.ts`: в normalize IG добавить `instagramThreadId: d.ig_thread_id` (и оставить `instagramThreadKey` как ключ для mark_read/сортировки). Обновить тип `UnifiedDialog.meta`.
- `src/components/admin/communication/unified/UnifiedInboxView.tsx`: в `ChatPanel` для `source === "instagram"` передавать `threadId={row.meta.instagramThreadId ?? null}`.
- Ключ `unread` mark_read остаётся на `thread_key` (как в edge-функции instagram-admin-chat action `mark_read`).

Verify: под superadmin открыть IG-строку Катерины Коток → история сообщений появляется, аудио/медиа рендерятся, отправка/приём работают, mark_read по-прежнему работает.

## P1 — Dropdown «Куда писать» (per-контакт channel picker)

Цель. В правой панели unified, рядом с composer'ом (там где сейчас выпадает «Я / gorbova support / Gorbova BOT / Gorbova Club / GetCourse»), сделать выбор канала доставки: любой Telegram-бот, любой Instagram-аккаунт, Support (создать/дописать в тикет). Недоступные — disabled с подсказкой почему.

Новый компонент: `src/components/admin/communication/unified/ChannelPicker.tsx`

- Пропсы: `contactProfileId | null`, `linkedTelegramUserId | null`, `linkedInstagramPeerIds: { accountId, peerId, threadId }[]`, `openSupportTickets: { ticketId, subject }[]`, `value: ChannelSelection`, `onChange`.
- Тип `ChannelSelection = { kind: 'telegram', botId }| { kind: 'instagram', accountId, peerId, threadId }| { kind: 'support', ticketId? }`.
- Внутри — `Popover` + список секций: «Telegram», «Instagram», «Техподдержка». Каждая опция активна только если у контакта есть привязка/тикет; иначе disabled + tooltip «Контакт не найден в этом канале — привяжите через карточку контакта».

Композер в правой панели unified становится общим:

- Если выбранный канал = текущий чат (тот же bot / IG-account / ticket), пишем через существующий соответствующий компонент (не ломаем `ContactTelegramChat`/`ContactInstagramChat`/`TicketChat`).
- Если пользователь выбрал другой канал, чем текущий открытый диалог, правая панель переключает `selectedKey` на соответствующий диалог того канала (если он есть) или показывает inline «пустое состояние с composer» для нового IG/Support-разговора — это следует существующим `send`-путям соответствующих компонентов.

Данные для picker:

- Telegram-боты: `telegram_bots` + `telegram_access_grants` (или уже используемое место для «от чьего имени писать», см. `src/components/admin/ContactTelegramChat.tsx` — переиспользовать существующий список).
- Instagram: список `instagram_accounts` (активные) + `instagram_contacts` для контакта; активность опции по факту существования пары `(account_id, peer_id)` в `instagram_contacts` или `instagram_messages`.
- Support: `support_tickets` по `profile_id`/`user_id` контакта со статусом не в (closed, resolved). Плюс опция «Создать новый тикет» (только если у контакта есть `profile_id`).

Изменяемые файлы:

- новый `src/components/admin/communication/unified/ChannelPicker.tsx`;
- новый `src/hooks/useContactChannels.ts` — единый источник «какие каналы доступны для этого контакта»;
- `src/components/admin/communication/unified/UnifiedInboxView.tsx` — `ChatPanel` берёт `ChannelPicker` и рендерит соответствующий чат-компонент по выбранному каналу.

БД-миграций не требуется.

Verify: у Катерины Коток picker показывает Telegram-боты (её текущий) + Instagram (её IG-аккаунт активен) + «Создать тикет техподдержки». У контакта без TG/IG — нужные опции disabled с tooltip. Переключение канала перерисовывает правую панель через существующий компонент канала.

## P2 — Ручное объединение контактов (Merge)

Цель. Оператор из карточки контакта (существующий `ContactDetailSheet`) может привязать/отвязать Instagram-контакт и Telegram-контакт к профилю. Никаких авто-склеек.

Миграция (один файл):

- Таблица `contact_channel_links (id, profile_id uuid FK profiles.id, channel text CHECK IN ('telegram','instagram'), external_id text, external_meta jsonb, linked_by uuid, linked_at timestamptz, unique(channel, external_id))`.
- GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated; GRANT ALL ... TO service_role.
- RLS: чтение/запись только для `has_role(auth.uid(),'admin' | 'superadmin')` (те же проверки, что у других admin-only таблиц контакт-центра).

Backend helpers:

- RPC `link_contact_channel(p_profile_id, p_channel, p_external_id, p_meta jsonb)` и `unlink_contact_channel(p_link_id)` — security definer, проверка `has_role` внутри.

UI:

- В `ContactDetailSheet`: секция «Каналы связи» — список привязанных TG (`profiles.telegram_user_id` — авто-показ) + IG-линков из `contact_channel_links`. Кнопка «Привязать Instagram» открывает диалог со списком IG-контактов без `profile_id` (поиск по имени/username), «Привязать» вызывает RPC.
- В `useUnifiedInbox.ts` при нормализации IG-диалогов подтягивать `contact_channel_links` для активных `instagram_contacts.peer_id → profile_id`, чтобы клик по имени в IG-строке открывал существующий `ContactDetailSheet` (см. P3).

Verify: привязать IG-контакт Катерины к её profile → в unified у IG-строки клик по имени открывает ту же карточку, что и в Telegram. Отвязать — карточка перестаёт открываться.

## P3 — Клик по имени в IG-строке → карточка контакта

Правки:

- `UnifiedInboxView.tsx`: header правой панели IG-чата (сейчас находится внутри `ContactInstagramChat`, но нам нужен клик по имени в списке слева) — сделать имя контакта в строке кликабельным, если для этого IG-контакта известен `profile_id` (из `contact_channel_links` или `instagram_contacts.profile_id`).
- Открывать существующий `ContactDetailSheet` через уже используемый в проекте механизм (тот же путь, что для Telegram-строк — см. `src/components/admin/communication/InboxTabContent.tsx` для образца).
- Если `profile_id` нет — обычный клик по строке (без карточки) + tooltip «Не привязан к профилю».

Verify: у Катерины (после P2) клик по имени в IG-строке открывает ContactDetailSheet; у неизвестного IG-контакта карточка не открывается.

## Rollout / kill-switch

Изменений в `useContactCenterFeatureFlag.ts` нет: unified V2 остаётся включённым только для superadmin, kill-switch продолжает работать. Никаких новых feature-флагов.

## DoD (обязательный)

1. IG-история грузится в unified для Катерины Коток и хотя бы ещё одного IG-контакта; отправка/приём/mark_read работают.
2. `ChannelPicker` показывает корректный набор каналов и disabled-состояния для 2+ контактов; переключение канала перерисовывает правую панель.
3. Merge: RPC `link_contact_channel` / `unlink_contact_channel` работает; UI-секция «Каналы связи» в ContactDetailSheet линкует/отвязывает IG-контакт; changes видны в unified.
4. Клик по имени в IG-строке открывает ContactDetailSheet у слинкованного контакта.
5. Регрессия моно-лент (Telegram / Instagram / Support / Email) — без изменений: скрин-проверка.
6. Обычные операторы (не-superadmin) unified V2 не видят (kill-switch/роль не тронуты).
7. Proof-файл `docs/audit/2026-07-04-unified-inbox-v2-channels.md` со скриншотами всех 4 шагов, списком файлов и статусом флага.

## Файлы к изменению (сводно)

- `src/hooks/useUnifiedInbox.ts` — добавить `instagramThreadId`, слить `contact_channel_links`.
- `src/components/admin/communication/unified/UnifiedInboxView.tsx` — прокидка `threadId`, интеграция `ChannelPicker`, кликабельное имя IG.
- новый `src/components/admin/communication/unified/ChannelPicker.tsx`.
- новый `src/hooks/useContactChannels.ts`.
- `src/components/admin/ContactDetailSheet.tsx` — секция «Каналы связи» + диалог привязки IG.
- новая миграция: таблица `contact_channel_links` + RPC `link_contact_channel` / `unlink_contact_channel` + RLS + GRANT.
- `docs/audit/2026-07-04-unified-inbox-v2-channels.md`.

## Что НЕ делаем в этой задаче

- Cross-channel bulk-actions, объединение историй разных каналов в один тред.
- Авто-склейка по email/phone/username.
- Общий Unified ContactCard (пере-используем существующую Telegram-карточку `ContactDetailSheet`).
- Server-side feature flag / раскатка на всех операторов.
- Push/звук для новых IG-каналов, помимо уже имеющегося.