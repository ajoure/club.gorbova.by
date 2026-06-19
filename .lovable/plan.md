## да, согласен, с учетом правок:

1. **План нельзя закрывать как полностью выполненный, пока не сделан root-fix резолвера.**  
UI-guard убирает визуальную ложь, но не чинит источник проблемы. В DoD обязательно оставить проверку: `past_due` без валидного `entitlements.expires_at > now()` больше не даёт `access_status='ok'`.
2. **Для удалённых нельзя считать** `access_ended_at` **датой кика.**  
В текущем плане написано: «для удалённых вторая показывает дату кика по факту = `access_ended_at`». Это неверно.  
Нужно добавить отдельное поле:
  - `kicked_at`;
  - желательно `kicked_at_source`.
3. **Колонку лучше назвать не просто «Доступ до», а «Доступ до / Кик».**  
Логика:
  - `ok` / `no_access` → показывать `access_ended_at`;
  - `removed` → показывать `kicked_at`;
  - активный доступ → «—».
4. **Нужно добавить фильтр мусорных удалённых.**  
Иначе вкладка «Удалённые» останется грязной. Минимально:
  - `is_commercial_orphan = true`, если нет paid orders, subscriptions, entitlements по продуктам клуба и `joined_chat_at IS NULL`;
  - во вкладке «Удалённые» переключатель «Скрыть мусорные» по умолчанию ВКЛ;
  - физически строки не удалять.
5. `access_started_at` **нужно считать шире, чем только по** `subscriptions_v2.access_start_at`**.**  
Иначе у разовых оплат и старых entitlements дата останется пустой. Fallback:
  1. `MIN(subscriptions_v2.access_start_at)`;
  2. иначе `MIN(orders_v2.paid_at)` по paid orders продуктов клуба;
  3. иначе `MIN(entitlements.created_at)`;
  4. иначе `joined_chat_at`.
6. **CSV дополнить не только** `access_started_at` **/** `access_ended_at`**, но и:**
  - `kicked_at`;
  - `kicked_at_source`;
  - `is_commercial_orphan`.
7. **Отчёт исполнителя должен быть отдельным отчётом, а не смесью “готово + старый план”.**  
Для закрытия нужен короткий proof-отчёт:
  - какие файлы изменены;
  - какая миграция применена;
  - какие RPC возвращают новые поля;
  - какие кейсы проверены: Julia Gr, Инна Грудецкая, Юлия Рабчевская, Татьяна Ярошевич;
  - подтверждение, что ручных DML/DELETE по `telegram_club_members` не было.

**Итог:** план в целом правильный, но в текущем виде закрывает только часть проблемы. Для быстрого завершения нужно не переписывать весь патч, а добавить маленький follow-up: `kicked_at` + `is_commercial_orphan` + root-fix резолвера.

&nbsp;

План v4: правильные даты «Доступ с / Доступ до / Дата кика» + чистка мусорных удалённых

### Diagnose

1. **«Будущая» 11.07.2026 у Julia Gr** — это НЕ дата кика. Текущая колонка «Доступ до» = `MAX(entitlements.expires_at | subscriptions_v2.access_end_at)`. У Julia есть оплачённый длинный entitlement до июля, но физически из чата её уже удалили (`access_status='removed'`). Поле показывает **коммерческое окно**, а не реальный момент удаления. Это и есть путаница.
2. **Пустые даты у Анны Фёдоровой / Татьяны Конько (нет paid_orders в Gorbova-продуктах) / Елены Сивицкой / Никиты Рохмистрова** — мусорные записи: `joined_chat_at IS NULL`, `paid_orders=0`, ни subscriptions_v2, ни entitlements по club_id-продуктам. Они когда-то попали в `telegram_club_members` из исторического импорта/trial, но коммерчески к клубу не относятся.
3. `**access_started_at**` сейчас берётся только из `subscriptions_v2.access_start_at`. Если у юзера были только разовые `orders_v2` без подписки или старые `entitlements` — пусто. Нужен fallback-chain.

### План работ

**Шаг 1. Миграция: пересобрать `v_club_members_enriched` + обе RPC (`get_club_members_enriched`, `search_club_members_enriched`).**

Новые/изменённые поля в SELECT:

- `access_started_at` — fallback-цепочка:
  1. `MIN(subscriptions_v2.access_start_at)` по `product_id ∈ club_products`
  2. иначе `MIN(orders_v2.paid_at)` по `user_id` где `product_id ∈ club_products AND status='paid'`
  3. иначе `MIN(entitlements.created_at)` по `product_id ∈ club_products AND status IN ('active','expired')`
  4. иначе `joined_chat_at`
- `access_ended_at` — **только для статусов `ok`/`no_access**` (т.е. человек ещё формально с правом или истёк по сроку, но не кикнут):
  - `MAX(entitlements.expires_at)` или `MAX(subscriptions_v2.access_end_at)`, NULL если есть `> now()` валидная запись.
- `kicked_at` — **новое поле**, только для `access_status='removed'`:
  1. `MAX(audit_logs.created_at)` где `action IN ('telegram.autokick.attempt','AUTOKICK','telegram.kick.manual')` и `meta->>'tg_user_id' = telegram_user_id::text` и (`meta->>'club_id' = club.id::text` ИЛИ NULL)
  2. иначе `updated_at` записи `telegram_club_members` (как пессимистичный fallback)
- `is_commercial_orphan` — **новое булево**: `TRUE` если:
  - НЕТ ни одной строки в `orders_v2 (status='paid', product_id ∈ club_products)`
  - И НЕТ ни одной строки в `subscriptions_v2 (product_id ∈ club_products)`
  - И НЕТ ни одной строки в `entitlements (product_id ∈ club_products)`
  - И `joined_chat_at IS NULL`
  Это и есть «мусор»: исторические записи без коммерческой связи с клубом.

**Шаг 2. UI `src/pages/admin/TelegramClubMembers.tsx`:**

1. Колонка «Доступ до» переименовать → **«Доступ до / Кик»**:
  - `access_status ∈ ('ok','no_access')` → показываем `access_ended_at` (или «—» если NULL = активный).
  - `access_status='removed'` → показываем `kicked_at` с лейблом «кикнут dd.MM.yyyy» (другой цвет — `text-muted-foreground`).
2. «Доступ с» — без изменений в UI, но теперь заполнится у большинства за счёт fallback-chain.
3. Сортировка по этой колонке: использовать COALESCE(`kicked_at`, `access_ended_at`) для всех вкладок.
4. На вкладке **«Удалённые»** добавить переключатель **«Скрыть мусорные»** (по умолчанию ВКЛ) — фильтр `is_commercial_orphan === false`. Счётчик скрытых показывать рядом: «скрыто N мусорных».
5. CSV-экспорт: добавить колонку `kicked_at`, `is_commercial_orphan`.

**Шаг 3. (опционально, не блокирует) «Корзина мусорных»** — отдельный экран позже. Сейчас только фильтр-тогглер.

**Шаг 4. Никаких ручных DELETE** из `telegram_club_members`. «Удалить» в смысле пользователя = «не показывать» (фильтр). Если позже нужно физически архивировать — отдельной задачей через soft-delete колонку.

### Не делаем

- Не правим backend autokick / валидатор (это отдельная задача из предыдущего цикла, уже частично закрыта).
- Не трогаем `grant-access-for-order` / canonical write-path.
- Не удаляем строки из `telegram_club_members` физически.
- Не меняем CSV-экспорт прошлой версии — только дополняем.

### DoD

1. У Julia Gr (`@lalalajulia`) в колонке «Доступ до / Кик» — реальная дата кика (например 2026-06-19), не 11.07.2026.
2. У всех `access_status='removed'` дата = `kicked_at` (из audit или updated_at), не из коммерческого окна.
3. У Inna Grudetskaya / Татьяны Ярошевич / Юлии Рабчевской на вкладке «Удалённые» отображается реальная дата удаления, сортировка DESC ставит свежие сверху.
4. На вкладке «Удалённые» по умолчанию скрыты Анна Фёдорова, Елена Сивицкая, Никита Рохмистров и аналогичные мусорные. Тогглер «Показать мусорные» возвращает их.
5. «Доступ с» заполнен у всех, у кого был хотя бы один paid `orders_v2` по продуктам клуба.
6. RPC возвращают новые поля; типы Supabase регенерированы; UI типизирован.

### Файлы

- Новая миграция `…_club_members_kicked_at_and_orphan.sql` — `v_club_members_enriched`, обе RPC.
- `src/pages/admin/TelegramClubMembers.tsx` — колонка/фильтр/сортировка/CSV.
- `src/hooks/useTelegramIntegration.tsx` — расширение типа `ClubMemberEnriched` (`kicked_at`, `is_commercial_orphan`).