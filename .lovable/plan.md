да, согласен, с учетом правок:

1. **Opt-in для всех сотрудников контакт-центра — да, но не называть это production rollout.**
  &nbsp;
  Формулировка должна быть:
  ```text
  Unified inbox V2 — personal opt-in for contact-center users
  Full production rollout by default — still deferred
  ```
  То есть фича доступна для включения сотрудником, но не включается всем автоматически.
2. **Проверку доступа через** `useSectionAccess("communication")` **сначала подтвердить discovery.**
  &nbsp;
  Перед правкой хука проверить:
  - как именно сейчас гейтится `/admin/communication`;
  - есть ли `useSectionAccess("communication")`;
  - что он возвращает: boolean / object / loading;
  - как ведёт себя при loading;
  - не вызовет ли это мигание пункта «Все».
  Если access ещё `loading`, хук должен возвращать:
  ```text
  enabled=false
  source="default-off"
  isLoading=true
  ```
  или аналогично безопасно скрывать unified до завершения проверки.
3. **Не удалять все старые ключи без миграции состояния.**
  Правильно:
  - `contact_center_unified_inbox_v2_test=1` → один раз мигрировать в `contact_center_unified_inbox_optin=1`;
  - `contact_center_unified_inbox_kill` → удалить;
  - legacy `contact_center_unified_inbox` → удалить/игнорировать;
  - после миграции старые ключи удалить.
  В proof показать, что старый `v2_test` больше не управляет фичей напрямую.
4. **Superadmin/admin больше не auto-ON — принять.**
  Это нормальное упрощение: все включают через один switch.
  Но в Settings-карточке для superadmin не писать «включено по роли». Только:
5. **Switch должен быть disabled, если нет доступа к контакт-центру или access loading.**
  Для пользователя без доступа:
  - карточку лучше вообще не показывать;
  - если показывается — switch disabled и текст «Нет доступа к контакт-центру».
  Но обычный пользователь без доступа не должен получить пункт «Все» через localStorage opt-in.
6. **LocalStorage opt-in — per-browser, не per-user.**
  В плане написано “per-user, per-browser”, но localStorage сам по себе не per-user. Если в одном браузере сменить аккаунт, ключ останется.
  Поэтому обязательно namespace ключа по user id:
  ```text
  contact_center_unified_inbox_optin:<user_id>
  ```
  Либо хранить JSON map:
  ```json
  { "<user_id>": true }
  ```
  Без этого один сотрудник может включить unified, выйти, другой войдёт в том же браузере и тоже увидит unified.
7. **Settings-card должна читать/писать user-scoped key.**
  Не использовать общий:
  ```text
  contact_center_unified_inbox_optin
  ```
  Использовать user-scoped storage. Это обязательная правка.
8. **Убрать kill-switch можно, но оставить code rollback path.**
  В proof указать:
9. **Hover actions нужно изолировать от выбора строки.**
  Для каждой иконки:
  - `event.stopPropagation()`;
  - `event.preventDefault()`;
  - disabled/loading state на время mutation;
  - optimistic update либо invalidate после success;
  - error toast при ошибке.
10. **Telegram pin/favorite: проверить ключ** `contact_user_id`**.**

В плане указано:

```text
contact_user_id: row.meta.telegramUserId
```

Это потенциально опасно. Нужно сверить с mono-Telegram.

Если `chat_preferences.contact_user_id` в mono использует:

- `profiles.user_id` — использовать его;
- numeric `telegram_user_id` — использовать его;
- другой id — использовать ровно тот же контракт.

Не угадывать. Перед реализацией сделать grep по `InboxTabContent`.

11. **Telegram mark-read должен использовать тот же boundary, что mono.**

В прошлых патчах уже была проблема с mark-read boundary. Для unified mark-read нельзя просто вызвать `mark_dialog_read_v2` без правильных параметров.

Проверить mono-вызов:

- `contact_user_id`;
- `bot_id`;
- `last_message_at` / boundary;
- observed boundary перед отправкой.

Использовать тот же контракт.

12. **Instagram pin: проверить реальный unique/upsert contract.**

Перед upsert в `instagram_dialog_preferences` проверить:

- имя полей;
- unique index;
- нужен ли `admin_user_id`;
- `account_id`;
- `thread_key`;
- текущая реализация в `InstagramInboxView`.

Использовать ровно тот же код/хук, что mono-IG, если возможно.

13. **Instagram favorite не показывать вообще, не disabled.**

Раз поля нет — лучше не показывать иконку `Star` для IG, чтобы не плодить шум.

Tooltip “не поддерживается” допустим только если пользователь явно ожидает кнопку, но в unified-строке лучше чище: нет функции — нет иконки.

14. **Support pin не показывать вообще.**

Аналогично: нет поля — нет иконки.

15. **Support mark-read уточнить.**

В плане:

```text
has_unread_admin=false
```

Нужно проверить mono-Support, как именно он помечает прочитанным:

- mutation;
- RPC;
- status;
- `read_at`;
- `has_unread_admin`.

Не менять статус тикета. Только read-flag, если он уже есть и используется.

16. **Support favorite через** `is_starred` **— да, но проверить права/RLS.**

Использовать тот же mutation, что `SupportTabContent`, чтобы не получить 403/RLS.

17. `useUnifiedInbox` **должен отдавать capabilities для строки.**

Чтобы UI не гадал, лучше добавить normalized capabilities:

```ts
row.capabilities = {
  canPin: boolean,
  canFavorite: boolean,
  canMarkRead: boolean
}
```

Или локально вычислить в компоненте, но по одной таблице правил.

18. **Mark-read иконку показывать только если есть unread.**

Если `unread_count=0` и `is_unanswered=false`, `Check` лучше скрыть или disabled. Иначе оператор будет нажимать действие без эффекта.

19. **После pin/favorite нужно проверить визуальный результат.**

Сейчас сортировка не меняется — это допустимо. Но индикатор должен обновиться:

- pin badge;
- star badge;
- состояние иконки active/inactive;
- сохранение после refresh.

20. **В DoD добавить проверку persistence после hard refresh.**

Для каждого источника:

- Telegram pin/favorite сохраняется после refresh;
- IG pin сохраняется после refresh;
- Support star сохраняется после refresh;
- mark-read сохраняется после refresh.

21. **Не менять сортировку сейчас — согласен.**

Но в proof явно указать:

```text
Pin/favorite indicators implemented; sorting by pin/favorite remains deferred.
```

Иначе пользователь может ожидать, что pin поднимет строку вверх.

22. **Добавить proof по отсутствию регрессии opt-in.**

Проверить:

- user A включает opt-in;
- user B в том же браузере не получает opt-in, если ключ user-scoped;
- access denied user не включает unified через localStorage.

Если невозможно проверить B через UI — сделать unit/hook proof или кодовый proof.

23. **Название патча.**

Использовать единый отчёт:

```text
Отчет о выполненной работе: PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-OPTIN-AND-ROW-ACTIONS
```

24. **Proof-файл:**

```text
docs/audit/2026-07-04-unified-inbox-v2-optin-and-row-actions.md
```

25. **В итоговом статусе указать:**

```text
Unified inbox V2 — available as personal opt-in for contact-center users
Default for all users — OFF
Full forced production rollout — deferred
Row actions — implemented per source capability
```

26. **Если окажется, что существующих preferences/RPC не хватает — остановиться, не делать миграции.**

Особенно для:

- IG favorite;
- Support pin;
- Telegram preference source separation.

В этом патче запрещены новые таблицы/миграции, значит неподдерживаемые действия скрываются, а не реализуются костылём.

После этих правок план утверждён. Выполнять одним проходом.

&nbsp;

План:

## Область изменений

Три отдельных, независимых пункта из последнего сообщения. Backend-схему не трогаем — используем уже существующие таблицы preferences и RPC. Никаких новых edge-функций, миграций и bridge-таблиц.

## Задача 1. Единая лента — opt-in для всех сотрудников контакт-центра

**Изменение модели rollout** в `src/hooks/useContactCenterFeatureFlag.ts`:

- Ключ localStorage `contact_center_unified_inbox_optin` (per-user, per-browser). Значение `1` = «сотрудник сам включил». Дефолт — выключено.
- Право включать = у пользователя есть доступ в контакт-центр (проверяем через уже существующий `useSectionAccess("communication")` / текущий gate раздела; не роль). Superadmin/admin право сохраняют по умолчанию.
- Матрица включения (новая):
  - `optin=1` && есть доступ в контакт-центр → `enabled=true`, `source="user-optin"`
  - Иначе → `enabled=false`, `source="default-off"`
- Убираем ветки `superadmin` (роль больше не даёт авто-ON — если superadmin хочет unified, он тоже включает opt-in; это единообразно и предсказуемо) и `qa-override` (больше не нужны). Совместимость: старый `contact_center_unified_inbox_v2_test` мигрируем на `_optin` при первом монтировании, `_kill` вычищаем (см. Задача 2).
- Тип `UnifiedInboxFlagSource` = `"user-optin" | "default-off"`. Оставляем `useUnifiedInboxFlag()` (совместимость).

**UI карточки в Settings** — `src/components/admin/communication/CommunicationSettingsTabContent.tsx`, компонент `UnifiedInboxToggleCard`:

- Заголовок: «Единая лента «Сообщения»» (без «controlled rollout»).
- Основной элемент — `Switch` с подписью «Включить единую ленту для меня». Управляет `optin`. Виден всем, у кого есть доступ в контакт-центр.
- Пояснение: «Личная настройка. Работает только в этом браузере. Не влияет на других сотрудников.»
- Badge статуса: ON / OFF, без `source=...`.

## Задача 2. Убрать «Аварийно выключить (этот браузер)»

- В `UnifiedInboxToggleCard` удаляем блок с кнопками `setKill(true/false)` и с индикацией `killActive`.
- В `useContactCenterFeatureFlag.ts` убираем `KILL_KEY`, `killActive`, `setKill`, `canManageKill` из публичного API типа; при инициализации хука вычищаем старый ключ `contact_center_unified_inbox_kill` из localStorage (совместимость).
- Проверить, что kill-switch нигде больше не читается. Если находим ссылки — удаляем/приводим к opt-in.

## Задача 3. Действия на строке (pin / favorite / mark read) для всех источников

В `src/components/admin/communication/unified/UnifiedInboxView.tsx` добавляем hover-действия справа от строки, единообразно для всех трёх источников. Иконки как в моно-Telegram: `Pin`, `Star`, `Check` (mark read). Появляются на hover (`opacity-0 group-hover:opacity-100`), не сдвигают лейаут, каждая с `title` и `stopPropagation`.

**Backend-мутации по источникам (без новых таблиц):**

- **Telegram** — таблица `chat_preferences` (уже используется в `InboxTabContent`): upsert `{admin_user_id: user.id, contact_user_id: row.meta.telegramUserId, is_pinned|is_favorite: next}`; mark-read через RPC `mark_dialog_read_v2` (та же, что уже вызывается в моно). Инвалидация `["chat-preferences", user.id]` и `INBOX_DIALOGS_QK`.
- **Instagram** — таблица `instagram_dialog_preferences` (уже используется в `InstagramInboxView`): upsert `is_pinned` по (account_id, thread_key). Favorite для IG в существующей схеме нет — иконку fav для IG не показываем (или показываем `disabled` с tooltip). Mark-read через уже существующий вызов `instagram-admin-chat / mark_read` (уже реализован в `markRead`). Инвалидация `["unified-ig-dialogs"]`.
- **Support** — колонка `support_tickets.is_starred` (уже используется в `SupportTabContent`): update по ticket_id для «favorite». Pin для тикетов в схеме отсутствует — иконку pin для support не показываем. Mark-read — уже реализован (`has_unread_admin=false`).

**Правила показа иконок в строке:**


| Источник  | Pin | Favorite | Mark read |
| --------- | --- | -------- | --------- |
| Telegram  | ✓   | ✓        | ✓         |
| Instagram | ✓   | —        | ✓ (уже)   |
| Support   | —   | ✓ (star) | ✓ (уже)   |


Никаких новых полей в БД. Если пользователь захочет расширить (IG favorite, Support pin) — это отдельная задача с миграцией, не в этом патче.

**Индикаторы в строке:** уже отрисовываются `row.isPinned` и `row.isFavorite`. `useUnifiedInbox` для Support сейчас не отдаёт `is_starred` в `isFavorite` — правим: `isFavorite: !!t.is_starred`.

**Сортировка/фильтрация:** оставляем как есть (не расширяем скоуп — pin/fav сейчас показываются только как метки; отдельная задача — добавить sort-by-pin).

## Файлы, которые будут изменены

- `src/hooks/useContactCenterFeatureFlag.ts` — новая матрица opt-in, удалить kill.
- `src/components/admin/communication/CommunicationSettingsTabContent.tsx` — UI карточки: Switch, убрать kill-кнопку.
- `src/components/admin/communication/unified/UnifiedInboxView.tsx` — hover-иконки pin/fav/mark-read + мутации.
- `src/hooks/useUnifiedInbox.ts` — `isFavorite` для support из `is_starred`.
- Если найдётся использование `killActive`/`canManageKill` вне Settings — почистить.

## Definition of Done

1. Любой сотрудник с доступом в контакт-центр видит в «Настройки → Единая лента» переключатель, включает — «Все» появляется в списке табов; выключает — исчезает.
2. Superadmin/admin ведут себя так же (opt-in через тот же switch), без авто-ON по роли.
3. Кнопка «Аварийно выключить (этот браузер)» удалена; ссылок на `setKill`/`killActive` в коде не осталось.
4. На каждой строке unified-ленты при hover доступны иконки согласно таблице выше; клик по иконке не открывает диалог; статус (закреплено/избранное) сохраняется и виден после `refetch`.
5. Существующие блоки MONO-TG / IG merge / headers / channels / badges не регрессируют (проверка Playwright: mono-TG имена/история; unified «Все» открывается; IG merge без красной ошибки; бейджи короткие).

## Что НЕ делаем

- Не создаём новые таблицы/RPC/edge-функции.
- Не добавляем IG-favorite и Support-pin (нет полей в схеме).
- Не меняем сортировку/фильтрацию по pin/fav (отдельная задача при необходимости).
- Не открываем unified обычным операторам «по умолчанию» — только через их собственный opt-in.
- Не трогаем production rollout флаг (остаётся deferred).