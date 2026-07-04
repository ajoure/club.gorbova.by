# да, согласен, с учетом правок:

1. **“Только один файл” нереалистично.**
  &nbsp;
  В плане написано:
  ```text
  Только фронт, в одном файле: src/hooks/useUnifiedInbox.ts
  ```
  Но дальше сам план требует адаптации:
  - списка;
  - правой панели;
  - `ChannelPicker`;
  - row actions;
  - filters;
  - selected state.
  Значит правки будут минимум в:
  ```text
  src/hooks/useUnifiedInbox.ts
  src/components/admin/communication/unified/UnifiedInboxView.tsx
  src/components/admin/communication/unified/ChannelPicker.tsx
  src/components/admin/communication/unified/UnifiedChatHeader.tsx
  ```
  Не ограничивать искусственно одним файлом. Ограничение должно быть: **front-only, без DB/RPC/edge**.
2. **Сначала ввести адаптер совместимости, чтобы не сломать чаты.**
  Старые компоненты ожидают source-row. Новая строка — contact-row. Поэтому нужен явный helper:
  ```ts
  getActiveChannel(row, activeSource): SourceChannelRef | null
  ```
  Правая панель должна получать старый source-specific payload из `channels[activeSource]`.
3. **Сохранить старый source key внутри каждого channel.**
  Для каждого канала хранить полный старый объект или достаточный ref:
  ```ts
  channels.telegram.sourceRow
  channels.instagram.sourceRow
  channels.support.sourceRow
  ```
  Не только `key/unread/pinned/favorite`, иначе `ContactTelegramChat`, `ContactInstagramChat`, `TicketChat`, mark-read, pin/fav потеряют нужные meta-поля.
  Минимально:
4. `selectedKey` **должен быть contact key, а** `activeSourceByKey` **— отдельный state.**
  В `UnifiedInboxView` сделать:
  ```ts
  selectedKey = "profile:<id>" | "source:<...>"
  activeSourceByKey: Record<string, UnifiedSource>
  ```
  При выборе строки:
  - если для `selectedKey` ещё нет override → использовать `row.activeSource`;
  - если оператор переключил канал → сохранить override;
  - если пришло новое более свежее сообщение в другой канал — аккуратно решить, перезаписывать ли override.
  Для V1:
5. **Source filter должен влиять на default active source, но не уничтожать другие каналы.**
  Если фильтр Instagram включён:
  - строка показывается, если есть `channels.instagram`;
  - activeSource при первом открытии = `instagram`;
  - но header всё равно показывает Telegram/Support, если они есть.
6. **Правило** `displayName/avatar` **должно быть детерминированным.**
  &nbsp;
  Для grouped profile row:
  ```text
  приоритет displayName/avatar:
  1. profiles.full_name/avatar_url, если есть;
  2. самый свежий channel displayName/avatar;
  3. fallback source displayName.
  ```
  Иначе при разных каналах имя может прыгать.
7. **Last message preview должен быть от lastMessageSource, а не от activeSource.**
  &nbsp;
  В списке:
  ```text
  Последнее: Instagram · привет
  ```
  должно всегда показывать канал последнего сообщения. Если оператор переключил activeSource на Telegram, preview в списке не должен стать Telegram.
8. **Unread count должен быть суммой, но mark-read должен инвалидировать агрегат.**
  &nbsp;
  После mark read activeSource:
  - перезапросить соответствующий source query;
  - пересчитать grouped row;
  - если другие каналы unread, строка остаётся в “Новые”.
9. **Pin/favorite action activeSource — принять, но в UI надо показать, к какому каналу применяется действие.**
  &nbsp;
  Иначе оператор видит одну строку контакта и может думать, что закрепляет весь контакт.
  Tooltip:
  ```text
  Закрепить текущий канал: Instagram
  В избранное текущий канал: Telegram
  ```
  Или в action aria-label добавить канал.
10. **Фильтр “Закреплённые/Избранное” должен показывать контакт, если pinned/favorite в любом канале.**

Но если оператор в такой строке нажимает unpin, действие применяется к activeSource. Если pinned был в другом канале, строка останется в фильтре. Это нужно указать в proof как expected.

11. **Support-дубли: визуальная группировка может скрыть проблему.**

Принять для V3, но в proof явно:

```text
Multiple active support tickets under one profile are visually collapsed to latest active support channel only.
Data-level merge/backfill remains separate.
```

И показывать оператору только latest support ticket. Старые дубли не должны исчезнуть из БД.

12. **Не потерять row actions.**

`IconAction` сейчас, вероятно, принимает source row. Нужно адаптировать:

- actions вызываются на `activeChannel.sourceRow`;
- capabilities берутся из `activeChannel`;
- counters/indicators — агрегированные.

13. **Непривязанный IG после link должен слиться с profile row.**

Для этого после `AttachProfileDialog.onSuccess` invalidate должен включать:

- IG contacts/prefs;
- unified inbox;
- profile channels;
- selected row resolution.

Если `selectedKey` был `source:instagram:<thread>` и после link стал `profile:<id>`, нужно перевыбрать новую строку, иначе выбранный key исчезнет.

14. **Empty selected state обработать.**

После regroup может исчезнуть выбранный source key. Нужно fallback:

```text
если selectedKey больше не существует → выбрать новую grouped row, содержащую прежний sourceRow.key, либо первую строку.
```

15. **Search должен работать по всем каналам контакта.**

Если в строке объединены TG+IG, поиск должен находить по:

- profile name;
- telegram username/name;
- instagram username/name;
- support subject/last message;
- last previews всех каналов.

Не только по агрегированному `displayName`.

16. **Счётчики фильтров считать после группировки.**

Сейчас counts могут считаться по source rows. После V3:

```text
Все = contactRows.length
Новые = grouped rows with totalUnread > 0
Избранное = grouped rows with any favorite
Закреплённые = grouped rows with any pinned
```

17. **Sorting после grouping.**

Сортировать grouped rows:

```text
isPinned DESC
isUnanswered DESC / totalUnread DESC
lastMessageAt DESC
displayName ASC
key ASC
```

Если текущий порядок другой — не менять резко без необходимости, но tie-breaker должен быть стабильным.

18. **Не ломать “source-only” строки.**

Для rows без `profileId`:

- key остаётся `source:<source>:<sourceKey>`;
- channels содержит один source;
- activeSource = source;
- header работает как раньше;
- attach IG может превратить её в profile row.

19. **Type names не должны ломать существующих потребителей.**

Можно не переименовывать внешний тип резко. Если много кода ждёт `UnifiedDialog`, сделать:

```ts
type UnifiedInboxRow = UnifiedContactRow
```

или сохранить совместимость через adapter.

20. **Proof добавить по row actions после grouping.**

Проверить:

- pin Telegram внутри grouped Сергей;
- переключить на Instagram, favorite Instagram;
- фильтр Избранное показывает Сергея;
- mark-read Instagram не читает Telegram;
- hard refresh сохраняет.

21. **Proof добавить по source filter + activeSource.**

Проверить:

- source filter Instagram → Сергей одна строка, activeSource Instagram;
- source filter Telegram → Сергей одна строка, activeSource Telegram;
- снятие source filter → activeSource по last message или сохранённый override.

22. **В план добавить “before/after row count”.**

Для конкретного профиля:

```text
before: Sergey = 2 rows
after: Sergey = 1 row, channels = [telegram, instagram]
```

23. **В regression добавить opt-in.**

Проверить:

- opt-in ON — V3 grouping работает;
- opt-in OFF — unified скрыт;
- mono-ленты без регресса.

24. **Финальный статус должен быть точнее:**

```text
Unified inbox V3 profile grouping — PASS
One profile = one row
Channels remain separate chat panels
Cross-channel merged timeline — deferred
Contact-level pin/favorite/read-all — deferred
```

После этих правок план утверждён. Выполнять front-only без DB/RPC/edge.

&nbsp;

План: PATCH-CONTACT-CENTER-UNIFIED-INBOX-V3-PROFILE-GROUPING

Одна строка = один человек. Telegram / Instagram / Техподдержка — это **каналы внутри карточки контакта**, а не отдельные строки ленты.

## Scope

**В scope этого патча — только Problem 2** (дубли строк одного человека в ленте).

**Problem 1 (отправка Instagram) — вне scope.** Отправка через платформу работает; ошибка «не отправляется» была ожидаемой — закрыто 24-часовое окно Meta/ManyChat. После нового входящего от клиента отправка снова прошла. Отдельной задачей позже сделать UX-улучшение: если ManyChat возвращает 24h-window error (`code 3031`), показывать понятный текст:

> «Нельзя отправить сообщение: клиент не писал в Instagram за последние 24 часа. Дождитесь нового входящего сообщения.»

Сейчас это не blocker и не часть текущего патча.

## Цель

Если Telegram и Instagram (и/или Support) привязаны к одному `profiles.id`, в ленте отображается **одна строка**:

```
Сергей Федорчук
[Telegram] [Instagram]
Последнее: Instagram · привет
```

А не две строки (одна Telegram, одна Instagram) как сейчас.

## Правило группировки

В `useUnifiedInbox.ts`, после получения source rows и до отдачи наружу, группируем:

```
groupKey =
  profileId exists → "profile:" + profileId
  else             → "source:" + source + ":" + sourceKey
```

Три строки — TG(profile=X), IG(profile=X), Support(profile=X) — становятся **одной** unified row. Если `profileId` нет — строка остаётся отдельной, как сейчас.

## Модель новой строки

```ts
interface UnifiedContactRow {
  key: string;                 // "profile:<id>" | "source:<src>:<key>"
  profileId: string | null;
  displayName: string;
  avatarUrl: string | null;
  channels: {
    telegram?: SourceChannelRef;
    instagram?: SourceChannelRef;
    support?: SourceChannelRef;
  };
  activeSource: UnifiedSource; // по умолчанию — источник последнего сообщения
  lastMessageAt: string;       // max по каналам
  lastMessageSource: UnifiedSource;
  lastMessagePreview: string;
  totalUnread: number;         // сумма по каналам
  isPinned: boolean;           // OR по каналам
  isFavorite: boolean;         // OR по каналам
}

interface SourceChannelRef {
  key: string;                 // старый source-key (для роутинга правой панели)
  unread: number;
  pinned: boolean;
  favorite: boolean;
  lastMessageAt: string;
  lastMessagePreview: string;
}
```

## Выбор activeSource

По умолчанию `activeSource = channel with max(lastMessageAt)`. Пример: TG 10 мин назад, IG 2 мин назад → строка одна, справа открывается Instagram.

## ChannelPicker

Больше **не переключает выбранную строку ленты**. Он меняет только `activeSource` внутри уже выбранного контакта:

```
selectedKey = "profile:<id>"     // не меняется
activeSource = telegram | instagram | support   // меняется
```

Запрещено внутри одного `profile:<id>`:

```
setSelectedKey("instagram:<thread>")
setSelectedKey("telegram:<dialog>")
```

## Правая панель

- `UnifiedChatHeader` — имя/аватар профиля + бейджи доступных каналов `[Telegram] [Instagram]`.
- Ниже — `ChannelPicker` (`Канал: Telegram | Instagram | Техподдержка`), disabled для отсутствующих каналов.
- Ниже — чат-компонент соответствующего `activeSource` (`ContactTelegramChat` / `InstagramChat` / `SupportTicketChat`) — без изменений в их внутренностях.

## Бейдж в строке списка

```
Сергей Федорчук
[Telegram] [Instagram]
Последнее: Instagram · привет
```

Формат: имя, аватар, набор доступных каналов маленькими бейджами (`SourceBadge`), отдельная строка «Последнее: &nbsp; · &nbsp;».

## Unread

- `totalUnread = telegramUnread + instagramUnread + supportUnread` — один общий бейдж на строке.
- При переключении каналов unread не теряется (per-channel unread хранится в `channels.*.unread`).

## Mark read (V1 безопасный)

- Клик «отметить прочитанным» на строке → отмечает прочитанным **только `activeSource**`.
- Если в другом канале контакта тоже есть unread — строка остаётся в фильтре «Новые».
- V2 (mark read всех каналов сразу) — отдельной задачей.

## Pin / Favorite

- `isPinned = OR по каналам`, `isFavorite = OR по каналам`.
- Клик применяется **к `activeSource**`, а не ко всем каналам сразу.
- «Закрепить весь контакт» одним действием — отдельной задачей.

## Фильтры

Работают по объединённым контактам:

- **Все** — все contact rows.
- **Новые** — если unread ≥ 1 хотя бы в одном канале.
- **Избранное** — если favorite хотя бы в одном канале.
- **Закреплённые** — если pinned хотя бы в одном канале.

## Source filter

Фильтр по Instagram → показываем контакты, у которых есть IG-канал; `activeSource` по умолчанию = Instagram; но строка одна, не отдельная IG-строка. Аналогично Telegram / Support.

## Непривязанные IG

IG без `profileId` → остаётся отдельной строкой `source:instagram:<thread>`. После ручной привязки через `AttachProfileDialog` — invalidate `INBOX_DIALOGS_QK`, строка сливается с существующим profile row без reload.

## Support-дубли

Profile grouping визуально объединит старые support-дубли одного `profile_id`, но это **не заменяет** backfill merge. Правила:

- В `channels.support` выбираем активный тикет по `updated_at DESC` (не merged).
- Старые тикеты того же `profile_id` не рендерим как отдельные строки.
- В proof отметить: **visual grouping ≠ data merge**.

## Где реализовывать

Только фронт, в одном файле:

- `src/hooks/useUnifiedInbox.ts` — после получения source rows: нормализация → группировка по `profileId` → возврат `UnifiedContactRow[]`.
- Компоненты списка и правой панели адаптируются под новую модель (row.key = `profile:<id>`, activeSource state).
- `ChannelPicker` — переписать под изменение `activeSource`, а не `selectedKey`.

**Без SQL / RPC / миграций.** `get_inbox_dialogs_v2` не создаём.

## Что НЕ делаем

- Не меняем БД, RPC, ManyChat, `instagram_messages`, Meta Graph.
- Не делаем общий composer (кросс-канальную отправку).
- Не объединяем истории TG+IG в один timeline.
- Не делаем auto-link профилей.
- Не делаем source-wide pin/favorite/mark-read.
- Не включаем всем без opt-in — работает под тем же feature flag `useUnifiedInboxRolloutStatus`.

## Proof

`docs/audit/2026-07-04-unified-inbox-v3-profile-grouping.md`. Скриншоты + описания:

1. **До**: Сергей Федорчук двумя строками (TG + IG).
2. **После**: Сергей одной строкой с бейджами `[Telegram] [Instagram]`.
3. Последний канал определяется по `max(lastMessageAt)`.
4. ChannelPicker переключает правую панель, `selectedKey` не меняется.
5. Unread суммируется в один бейдж.
6. Фильтр Instagram — Сергей одной строкой.
7. Фильтр Telegram — Сергей одной строкой.
8. Непривязанный IG (без profileId) — остаётся отдельной строкой.
9. После привязки IG к profile — строка сливается (invalidate, без reload).
10. Mono Telegram/Instagram/Support/Email — без регресса.

## DoD (финальный статус в отчёте)

```
Profile-linked channels        — grouped into one contact row
Active channel                 — selected inside row
Duplicate profile rows         — removed
Source-specific chats          — preserved
Full cross-channel merged chat history — deferred
```

Отчёт: `Отчет о выполненной работе: PATCH-CONTACT-CENTER-UNIFIED-INBOX-V3-PROFILE-GROUPING`.