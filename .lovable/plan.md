# да, согласен, с учетом правок:

&nbsp;

1. В плане убери формулировку, что SQL-формулы «корректны» заранее. Пока это не вывод, а гипотеза. Формулируй так:
  &nbsp;
  - сначала доказать direct SQL → RPC summary → UI mapping → rendered rows;
  - только после этого решать, нужны ли правки SQL/RPC или достаточно post-sync.
  &nbsp;
2. Не ограничивай финальную верификацию только getChatMembersCount. Это слишком грубая метрика.
  Обязательно добавь два уровня Telegram-proof:
  &nbsp;
  - getChatMembersCount / getChatAdministrators по клубу;
  - поимённый check_status/getChatMember для всех спорных админов и для выборки спорных обычных участников.
    Иначе нельзя доказать, кто именно физически в чате/канале.
  &nbsp;
3. В шаге про parity добавь явное разделение двух сущностей:
  &nbsp;
  - **физически в ресурсе**;
  - **имеет бизнес-доступ**.
    В итоговом proof block это должны быть разные колонки, а не одна смешанная интерпретация.
  &nbsp;
4. По BkB и GC отдельно потребуй финальную таблицу не только по числам, но и по составу:
  &nbsp;
  - кто входит в admins_total;
  - кто входит в admins_in_club;
  - кто входит в removed_non_admin;
  - кто входит в removed_admin;
  - кто входит в bought_not_joined.
    Нужны не только counts, но и ID/email/telegram_user_id строками.
  &nbsp;
5. В шаге про админов зафиксируй жёстко:
  если Telegram API после sync возвращает administrator/creator и isMember=true, то:
  &nbsp;
  - in_chat/in_channel обязаны стать true;
  - access_status='removed' для такой записи недопустим;
  - такая запись не может выпадать из «В клубе».
    Это должно быть вынесено как отдельный invariant/DoD, а не просто как часть описания.
  &nbsp;
6. Добавь в план обязательную проверку **всех write-paths после deploy** не только по коду, но и по факту:
  &nbsp;
  - cron-sync;
  - revoke-access;
  - club-members/check_status;
  - club-members/kick;
  - club-members/kick_present;
  - kick-violators;
  - check-expired.
    Для каждого нужен proof: либо audit log, либо controlled dry-run / test case.
  &nbsp;
7. В разделе про единый шаблон клуба не ограничивайся только TelegramClubMembers.tsx и ClubQuickStats.tsx.
  Добавь проверку всей цепочки:
  &nbsp;
  - route/page;
  - hooks;
  - summary RPC;
  - members RPC/search RPC;
  - admin hook;
  - edge functions;
  - visual cards / badges / tabs / filters / table.
    Нужен итоговый вывод: действительно ли новый клуб наследует **и UI, и данные, и sync-логику** без ручных кодовых изменений.
  &nbsp;
8. В acceptance criteria добавь отдельный пункт по визуальной унификации:
  &nbsp;
  - одинаковый набор рядов карточек;
  - одинаковая сетка;
  - одинаковая высота/ширина/ритм карточек;
  - одинаковые badges/tabs/table layout;
  - resource_mode влияет только на значения/disabled-state, но не создаёт ощущение «другого продукта».
  &nbsp;
9. Добавь обязательный post-sync proof по BkB именно для текущего спорного кейса:
  &nbsp;
  - Сергей;
  - Катерина;
  - Ирина;
  - бот клуба.
    По каждому: Telegram факт, DB state до, DB state после, попадает ли в «В клубе», попадает ли в «Админы».
  &nbsp;
10. Добавь обязательный stop-guard:
  если после sync и post-check остаётся расхождение хотя бы в одной ключевой метрике между:
  &nbsp;
  - direct SQL,
  - RPC summary,
  - UI badge/card,
  - rendered rows,
  - Telegram fact,
    то план не считается выполненным и должен автоматически перейти в следующий точечный PATCH в рамках этого же цикла, без ухода в PATCH-4.
  &nbsp;
11. В разделе deliverable потребуй в финале короткий и понятный ответ на два вопроса:

&nbsp;

&nbsp;

&nbsp;

- где именно находится единая функция/единый шаблон клуба;
- если создать новый клуб, унаследует ли он автоматически текущий UI и текущую логику.
  Без общих слов — с перечислением конкретных файлов, RPC и зависимостей.

&nbsp;

&nbsp;

&nbsp;

12. Формат итогового результата плана должен включать отдельный блок:

&nbsp;

&nbsp;

&nbsp;

- **Что исправлено в коде**
- **Что исправлено в данных**
- **Что подтверждено фактами**
- **Что остаётся backlog / blocked**
  И отдельно сохранить: PATCH-4 по-прежнему заблокирован.

&nbsp;

&nbsp;

В текущем виде план близкий, но без этих уточнений он всё ещё позволяет уйти в “код поправили, а фактическая parity не доказана”.

&nbsp;

План: Закрытие рассинхрона метрик и единая верификация клубной статистики

---

## Цель

Устранить все оставшиеся расхождения между SQL, RPC, UI и фактическим Telegram-состоянием для метрик «В клубе», «Админы», «С доступом», «Не вошли», «Удалённые», «Нарушители». Подтвердить результат parity-проверкой для БкБ и GC.

---

## 1. Текущее состояние admin-guard

По результатам чтения кода, guard-логика **уже внедрена** в 5 edge functions:


| Функция                                | Guard есть          | Что делает                                                                                              |
| -------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------- |
| `telegram-cron-sync`                   | ДА (строки 157-211) | Форсирует `in_chat=true` для admin/creator, пропускает autokick, пишет в audit_logs                     |
| `telegram-revoke-access`               | ДА (строки 529-565) | Проверяет `last_telegram_check_result`, блокирует `in_chat=false` и `access_status=removed` для админов |
| `telegram-club-members` (check_status) | ДА (строки 349-373) | Форсирует `in_chat=true`/`in_channel=true` для admin/creator, восстанавливает `access_status`           |
| `telegram-club-members` (kick)         | ДА (строки 670-686) | Пропускает кик для admin/creator                                                                        |
| `telegram-club-members` (kick_present) | ДА (строки 760-782) | Пропускает кик для admin/creator, помечает `admin_protected`                                            |
| `telegram-kick-violators`              | ДА (строки 310-325) | Пропускает кик для admin/creator                                                                        |
| `telegram-check-expired`               | ДА (строки 249-267) | Пропускает кик для admin/creator                                                                        |


**Гипотеза**: guard-логика задеплоена, но данные в БД **ещё не были пересинхронизированы** после деплоя. У Катерины, Сергея (БкБ), Ирины, Алимы (GC) до сих пор лежит `in_chat=false`, `access_status=removed` — legacy-состояние, записанное до внедрения guard. Это нужно подтвердить.

---

## 2. Полный перечень write-paths для `in_chat` / `in_channel` / `access_status`

Все точки, где эти поля перезаписываются:


| Функция                                | Действие            | Пишет `in_chat`          | Пишет `access_status`           | Guard                                                                           |
| -------------------------------------- | ------------------- | ------------------------ | ------------------------------- | ------------------------------------------------------------------------------- |
| `telegram-cron-sync`                   | check + autokick    | ДА (строка 184, 266)     | ДА (строка 189, 268)            | ДА                                                                              |
| `telegram-revoke-access`               | revoke              | ДА (строка 560)          | ДА (строка 562)                 | ДА                                                                              |
| `telegram-club-members` → check_status | check               | ДА (строка 366)          | ДА (строка 371)                 | ДА                                                                              |
| `telegram-club-members` → kick         | manual kick         | ДА (строка 705)          | ДА (строка 704)                 | ДА                                                                              |
| `telegram-club-members` → kick_present | bulk kick           | ДА (строка 833)          | ДА (строка 835)                 | ДА                                                                              |
| `telegram-club-members` → sync_members | initial sync/upsert | ДА (строка 536-558)      | ДА (строка 535)                 | Нет explicit guard, но инлайново ставит `in_chat=true` для админов (строка 550) |
| `telegram-kick-violators`              | cron kick violators | ДА (через kick result)   | ДА                              | ДА                                                                              |
| `telegram-check-expired`               | cron check + kick   | ДА (через kick result)   | ДА                              | ДА                                                                              |
| `telegram-grant-access`                | grant access        | Нет (не пишет `in_chat`) | Пишет `access_status` при unban | Не требуется                                                                    |


**Вывод**: все 8 write-paths покрыты guard-логикой. Оставшийся потенциальный gap — `sync_members` (upsert), но он инлайново ставит `in_chat=true` для админов из getChatAdministrators.

---

## 3. Бизнес-правила (окончательная фиксация)


| Метрика            | Определение                                                                                                                                                                                                                            | Source of truth                                                               | Формула в SQL                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **В клубе**        | Физически состоит в ресурсе по данным Telegram membership-state, сохранённым после последней успешной синхронизации. Для admin/creator запрещено состояние, при котором Telegram подтверждает membership, а локально стоит not-in-club | `in_chat`/`in_channel` (кеш getChatMember)                                    | `COUNT(*) WHERE in_any AND NOT is_orphaned`                                      |
| **Админы всего**   | Все пользователи с `chat_status` = administrator/creator в `last_telegram_check_result` + бот клуба, не входящий в `telegram_club_members`                                                                                             | `last_telegram_check_result` + `telegram_bots`                                | `COUNT(is_admin) + v_bot_admin_count`                                            |
| **Админы в клубе** | Подмножество «Админы всего», у которых `in_any=true`. При соблюдении инварианта должно равняться «Админы всего» минус только те, кто не в members-таблице (бот)                                                                        | `in_any` + `is_admin`                                                         | `COUNT(*) WHERE is_admin AND in_any`                                             |
| **С доступом**     | Уникальные пользователи с действующим business-доступом (subscription/entitlement/manual access). НЕ зависит от физического присутствия в Telegram                                                                                     | `has_valid_access_for_club()` → subscriptions_v2, entitlements, access_grants | `COUNT(*) WHERE has_active_access AND NOT is_orphaned`                           |
| **Не вошли**       | Имеют действующий доступ, но физически не в ресурсах клуба и не помечены как removed                                                                                                                                                   | Пересечение access + NOT in_any                                               | `COUNT(*) WHERE has_active_access AND NOT in_any AND access_status != 'removed'` |
| **Удалённые**      | Не-админы с `access_status='removed'` и `in_any=false`. Историческая метрика                                                                                                                                                           | `access_status`                                                               | `COUNT(*) WHERE access_status='removed' AND NOT in_any AND NOT is_admin`         |
| **Нарушители**     | Физически в ресурсе, но без действующего доступа. Не-админы                                                                                                                                                                            | `in_any` + NOT `has_active_access`                                            | `COUNT(*) WHERE in_any AND NOT has_active_access AND NOT is_admin`               |


**Инвариант (enforced кодом):**

- Если `chat_status IN ('administrator','creator')`, то `in_chat` не может быть `false`
- Если `channel_status IN ('administrator','creator')`, то `in_channel` не может быть `false`
- Нарушение логируется как аномалия в `audit_logs`

---

## 4. Диагностика текущих противоречий БкБ

**Почему «В клубе» и «Админы» не совпадали:**

- Cron-sync до внедрения guard ставил `in_chat=false` для Катерины (creator) и Сергея (administrator), потому что у них не было бизнес-доступа (нет подписки). Autokick не мог их забанить (Telegram не разрешает), но всё равно помечал `in_chat=false, access_status=removed`
- В итоге `in_club_admins` = 1 (только Ирина с `in_chat=true`), а `useClubAdmins` = 4 (считает по `chat_status`, игнорируя `in_chat`)

**Почему часть админов отображалась как removed:**

- `access_status=removed` был записан autokick-ом, который не проверял admin-статус

**Почему карточка и badge говорили разное:**

- Карточка «В клубе» subtitle: `30 участн. + 1 адм. (физич.)` — берёт `in_club_admins` из RPC (SQL: `in_any AND is_admin`)
- Badge «Админы»: `4` — берёт `adminsList.length` из `useClubAdmins` (фильтр только по `chat_status`)
- Эти два числа расходятся, потому что 3 админа имели `in_any=false`

**Где ломалась цепочка:**

1. Edge function `telegram-cron-sync` → записывал `in_chat=false` для админов ← **корень**
2. `telegram_club_members.in_chat=false` → `v_club_members_enriched.in_any=false`
3. `get_club_member_summary` → `in_club_admins=1` (правильная формула, неправильные данные)
4. UI → отображал правильно то, что получил, но данные были ложными

---

## 5. План выполнения

### Шаг 1: Диагностика (READ-ONLY)

Перед любыми действиями — подтвердить текущее состояние данных:

**5.1.1** Прямой SQL-запрос для БкБ и GC: проверить `in_chat`, `access_status`, `last_telegram_check_result→chat→status` для всех записей с `is_admin`-статусом. Цель: зафиксировать baseline до sync.

**5.1.2** Вызвать `get_club_member_summary` для обоих клубов. Зафиксировать значения `in_club_total`, `in_club_admins`, `admins_total`, `with_access_total`, `removed_count`.

**5.1.3** Проверить audit_logs: есть ли записи `telegram.autokick.admin_protected` или `telegram.admin_invariant.anomaly` после деплоя guard-логики. Если нет — guard ещё ни разу не срабатывал (данные не обновлялись после деплоя).

### Шаг 2: Пересинхронизация

**5.2.1** Вызвать `telegram-club-members` с `action: check_status` для БкБ (`club_id = 4f8f9d8f-...`). Guard-логика задеплоена — при check_status для admin/creator будет принудительно записано `in_chat=true` и `access_status` восстановлен с `removed` на `ok`.

**5.2.2** Вызвать то же для GC.

### Шаг 3: Post-sync верификация

**5.3.1** Повторить SQL-запрос из 5.1.1. Подтвердить:

- Для каждого админа: `in_chat=true` (если `chat_status=administrator/creator`)
- `access_status` ≠ `removed` для админов

**5.3.2** Повторить вызов `get_club_member_summary`. Подтвердить:

- `in_club_admins` увеличилось (должно стать 3 для БкБ, 4 для GC — без бота)
- `in_club_total` увеличилось на количество ранее ошибочно помеченных админов
- `removed_count` уменьшилось на то же количество

**5.3.3** Проверить UI: карточки и badges должны отражать новые значения.

**5.3.4** Проверить `getChatMembersCount` через Telegram API (edge function `check_status` возвращает это). Сравнить с `in_club_total`.

### Шаг 4: Идентификация лишних/зависших записей

Если после sync `in_club_total` всё ещё расходится с Telegram `getChatMembersCount`:

**5.4.1** Выгрузить поимённый список записей с `in_chat=true`, отсортированный по `last_telegram_check_at`. Записи, не обновлявшиеся давно — кандидаты на stale data.

**5.4.2** Для каждого кандидата: проверить, какой `telegram_user_id`, какой текущий `in_chat`, какой `last_telegram_check_result`. Дать поимённый разбор.

### Шаг 5: Оценка UI и SQL

После подтверждения данных:

**5.5.1** Проверить, что UI-компоненты (`ClubQuickStats.tsx`, `TelegramClubMembers.tsx`) корректно отображают обновлённые данные. Если да — зафиксировать как принятые. Если нет — описать конкретные расхождения.

**5.5.2** Проверить, что SQL-формулы в `get_club_member_summary` дают результаты, совпадающие с прямыми SQL-запросами. Если да — зафиксировать. Если нет — SQL-миграция может потребоваться.

---

## 6. Scope файлов


| Файл / Функция                                        | Действие                                                                                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `supabase/functions/telegram-club-members/index.ts`   | Вызов `check_status` (уже содержит guard)                                                                                     |
| `supabase/functions/telegram-cron-sync/index.ts`      | Guard уже внедрён. Не трогаем. Только верификация                                                                             |
| `supabase/functions/telegram-revoke-access/index.ts`  | Guard уже внедрён. Не трогаем. Только верификация                                                                             |
| `supabase/functions/telegram-kick-violators/index.ts` | Guard уже внедрён. Не трогаем                                                                                                 |
| `supabase/functions/telegram-check-expired/index.ts`  | Guard уже внедрён. Не трогаем                                                                                                 |
| `get_club_member_summary` (SQL RPC)                   | Не планируется изменение по умолчанию. Может потребоваться, если после фикса guard-логики выявится расхождение summary ↔ list |
| `src/components/telegram/ClubQuickStats.tsx`          | Предварительно выглядит пригодным. Считается не принятым до parity-проверки                                                   |
| `src/pages/admin/TelegramClubMembers.tsx`             | Предварительно выглядит пригодным. Считается не принятым до parity-проверки                                                   |


**Не включаем**: PATCH-4, billing, посторонние части проекта.

---

## 7. Единая визуальная система клубов

### Единый UI-каркас


| Компонент           | Файл                                         | Роль                                                                          |
| ------------------- | -------------------------------------------- | ----------------------------------------------------------------------------- |
| Страница клуба      | `src/pages/admin/TelegramClubMembers.tsx`    | Таблица, вкладки, фильтры, массовые действия. Один компонент, `clubId` из URL |
| Карточки статистики | `src/components/telegram/ClubQuickStats.tsx` | 3 ряда: тарифы, присутствие, динамика. Ветвление только по `resource_mode`    |
| Список админов      | `src/hooks/useClubAdmins.ts`                 | Параметризован через `clubId`                                                 |
| Данные (summary)    | RPC `get_club_member_summary(p_club_id)`     | Единый запрос для всех клубов                                                 |
| Данные (список)     | RPC `get_club_members_enriched(p_club_id)`   | Единый запрос для всех клубов                                                 |
| View                | `v_club_members_enriched`                    | Resource-mode aware (`in_any` вычисляется по `chat_id`/`channel_id` клуба)    |


### Проверка: новый клуб

Новый клуб должен наследовать единый интерфейс и общую логику через `club_id` + `resource_mode`. Это нужно подтвердить:

**Автоматически** (через архитектуру):

- UI подхватывает через `useTelegramClubs` → появляется в списке
- `TelegramClubMembers.tsx` использует `clubId` из URL — нет club-specific веток (проверено: нет `if clubId ===`)
- `ClubQuickStats.tsx` — нет club-specific веток (проверено)
- Все RPC параметризованы через `p_club_id`
- Cron (`telegram-cron-sync`) итерирует все клубы из `telegram_clubs`
- `resource_mode` вычисляется из `chat_id`/`channel_id` в view и RPC

**Вручную** (требуется при создании):

- INSERT записи в `telegram_clubs` (club_name, chat_id, channel_id, bot_id)
- Привязка бота (`bot_id`)
- Настройка `product_club_mappings` (связь тарифов)
- Флаги `auto_resync_enabled`, `autokick_no_access`

**Если меняем общий компонент** — меняются все клубы сразу. Нет club-specific веток ни в UI, ни в RPC, ни в edge functions.

---

## 8. Final proof block (требования)

Для каждого клуба (БкБ, GC) отдельно:

### 8.1 Parity-таблица


| Метрика        | SQL snapshot | RPC summary | UI card  | UI badge | Rendered list | Telegram fact |
| -------------- | ------------ | ----------- | -------- | -------- | ------------- | ------------- |
| В клубе        | ?            | ?           | ?        | ?        | ?             | ?             |
| Админы всего   | ?            | ?           | —        | ?        | ?             | ?             |
| Админы в клубе | ?            | ?           | subtitle | —        | —             | —             |
| С доступом     | ?            | ?           | ?        | ?        | ?             | N/A           |
| Не вошли       | ?            | ?           | ?        | ?        | ?             | —             |
| Удалённые      | ?            | ?           | —        | ?        | ?             | —             |
| Нарушители     | ?            | ?           | ?        | ?        | ?             | —             |


### 8.2 Поимённый разбор админов

Для каждого админа (БкБ: 4, GC: 5):

- `telegram_user_id`
- Запись в `telegram_club_members`: да/нет
- `chat_status` из `last_telegram_check_result`
- `in_chat` / `in_channel`
- `access_status`
- Попадает в «В клубе»: да/нет
- Попадает в «Админы»: да/нет

### 8.3 Поимённый разбор лишних записей (если дельта > 0)

Если `in_club_total` ≠ `getChatMembersCount`:

- Список `telegram_user_id` с `in_chat=true`, но не обнаруженных Telegram
- Причина расхождения для каждого

---

## 9. Stop-guards

- Не объявлять «противоречие устранено», пока нет фактических post-sync данных
- Не менять SQL-формулы без доказанного расхождения summary ↔ direct query
- Не трогать файлы за пределами scope (раздел 6)
- PATCH-4 заблокирован и не входит в этот цикл
- Не использовать club-specific ветки вида `if (clubId === ...)`

---

## 10. Acceptance criteria

1. Для БкБ и GC одновременно выполнено 5-level parity: SQL snapshot = RPC summary = UI cards = UI badges = rendered list length. Между ними нет необъяснённой дельты
2. Сверка с Telegram fact (getChatMembersCount) выполнена. Если дельта > 0 — поимённый разбор лишних записей дан
3. Поимённый proof по всем 9 админам (4 БкБ + 5 GC) подтверждает: `in_chat=true` для admin/creator, `access_status ≠ removed`
4. Нет противоречия «в карточке +1 адм., а в бейдже другое число без объяснения»
5. Инвариант `chat_status=admin/creator → in_chat=true` подтверждён кодом (guard) и данными (post-sync)
6. Новый клуб наследует единый UI и единую логику без club-specific веток — подтверждено отсутствием таких веток в коде
7. UI и SQL не объявляются «корректными» до завершения parity-проверки
8. PATCH-4 остаётся заблокирован

---

## 11. Справка по архитектуре клубов (deliverable)

**Где единый шаблон клуба:**

- UI: `TelegramClubMembers.tsx` + `ClubQuickStats.tsx`
- Данные: `get_club_member_summary`, `get_club_members_enriched`, `v_club_members_enriched`
- Sync: `telegram-cron-sync`, `telegram-club-members`

**Что меняется сразу для всех клубов:**

- Любое изменение в перечисленных файлах и RPC

**Что не меняется автоматически:**

- Содержимое `telegram_clubs` (настройки конкретного клуба)
- Привязки `product_club_mappings`
- Флаги autokick/autosync

**Что нужно сделать вручную при создании нового клуба:**

- INSERT в `telegram_clubs` с `club_name`, `chat_id`, `channel_id`, `bot_id`
- INSERT в `product_club_mappings` для привязки тарифов
- Опционально: включить `autokick_no_access`, `auto_resync_enabled`