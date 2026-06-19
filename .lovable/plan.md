# План (v3): даты доступа + сортировка в таблице участников клуба + фикс автокика

## 1. Куда добавляем (никакой отдельной выгрузки)

Страница `/admin/integrations/telegram/clubs/:clubId/members` — компонент `src/pages/admin/TelegramClubMembers.tsx`, таблица с вкладками «В клубе / С доступом / Не вошли / Нарушители / Удалённые / Админы».

Источник данных — RPC `public.get_club_members_enriched(p_club_id uuid, p_scope text)` и `public.search_club_members_enriched(...)`. Сейчас они возвращают `access_status`, `has_active_access`, но **не возвращают сами даты доступа**. Их нужно добавить в RPC и пробросить в UI.

## 2. Что меняем — 3 шага

### Шаг 1. Миграция: RPC возвращают даты доступа

Расширяю обе RPC двумя полями (без новых таблиц, без новых колонок в `telegram_club_members`):

- `access_started_at timestamptz` — **первая дата начала доступа** пользователя к продукту этого клуба = `MIN(subscriptions_v2.access_start_at)` по `product_id` из `product_club_mappings` для данного `club_id` (для текущих и удалённых одинаково).
- `access_ended_at timestamptz` — **дата окончания доступа**:
  - если у пользователя есть валидный `entitlements.expires_at > now()` по продукту клуба → `NULL` (доступ ещё активен);
  - иначе → `MAX(entitlements.expires_at)` по тому же продукту, либо `MAX(subscriptions_v2.access_end_at)` если entitlements пуст.

Связка «клуб → продукт» уже существует: таблица `product_club_mappings` (см. memory *Telegram Club Engine*). Никаких новых сущностей.

Миграция: `CREATE OR REPLACE FUNCTION` для обеих RPC + `GRANT EXECUTE` тем же ролям, что и сейчас (без расширения прав). Тип возврата меняется → нужно `DROP FUNCTION ... CASCADE` и пересоздать; зависимостей на эти функции в БД нет, только клиент.

### Шаг 2. UI: 2 новых столбца + сортировка

Файл: `src/pages/admin/TelegramClubMembers.tsx`.

- Добавляю в `<TableHeader>` две колонки **«Доступ с»** и **«Доступ до»**, для удалённых вторая показывает дату кика по факту = `access_ended_at`. Формат `dd.MM.yyyy`, моноширинно (`tabular-nums`), пусто → «—».
- Расширяю TypeScript-тип в `src/hooks/useTelegramIntegration.tsx` (`ClubMemberEnriched`) на `access_started_at` / `access_ended_at`.
- Добавляю клиентскую сортировку (без серверной — данные уже в памяти):
  - локальный state `sortKey` ∈ `telegram_name | crm_name | access_status | chat_channel | access_started_at | access_ended_at`, `sortDir` ∈ `asc | desc`;
  - заголовки этих колонок становятся кликабельными (`Button` `variant="ghost"` с иконкой `ArrowUpDown` / `ArrowUp` / `ArrowDown` из lucide — уже используется в проекте);
  - по умолчанию во вкладке «Удалённые» — сортировка по `access_ended_at DESC` (чтобы свежие кики были сверху, как просил пользователь);
  - сортировка применяется в существующем `filteredMembers` через `useMemo`.
- Никакой логики доступа/кика не меняю, только отображение и сортировка.

### Шаг 3. Фикс «Доступ активен» у удалённого (Инна Грудецкая и ещё 2 случая)

**Диагноз** (подтверждён данными из БД):

- У Инны (`profile_id=006b96cc-...`), Юлии Рабчевской и Татьяны Ярошевич в `telegram_club_members.access_status='ok'`, хотя последний валидный `entitlement` истёк (06/16/18.06.2026), а в `subscriptions_v2` только зомби-`past_due` без `access_end_at`.
- Колонка `access_status` в `telegram_club_members` пишется фоновым резолвером (`telegram-members-sync` / `entitlement-sync-engine`). Он трактует `subscriptions_v2.status='past_due'` с `access_end_at IS NULL` как «доступ ещё есть» и оставляет `ok`. Поэтому автокик (`telegram_clubs.autokick_no_access=true`) их пропускает, а UI рисует жёлтый бейдж «Доступ активен» хотя пользователь уже удалён вручную (`in_chat=false`, `in_channel=false` после ручного кика, но `access_status` остался `ok`).

**Фикс — два уровня, оба маленькие и канонические:**

1. **UI guard в `getAccessStatusBadge`** (`TelegramClubMembers.tsx`, строки ~723-746): если `has_active_access === false` ИЛИ (`member.in_chat === false && member.in_channel === false && member.access_status !== 'no_access' && member.access_status !== 'removed'`) — никогда не показывать зелёный/жёлтый «Доступ активен», вместо этого «Доступ истёк» (серый). Это уберёт визуальную ложь мгновенно, без миграций.
2. **Резолвер `access_status`** — добавляю условие: подписка в `past_due` НЕ считается «есть доступ», если по продукту нет валидного entitlement (`expires_at > now()`). Точечная правка в edge-функции, которая обновляет `telegram_club_members.access_status` (найду: `telegram-members-sync` / nightly reconcile из memory *Nightly Access Reconcile*). После правки запускаю однократный resync для клуба `fa547c41-...`, чтобы Инну и остальных «зомби» резолвер пометил `no_access` и `autokick_no_access` их кикнул сам.

Это согласовано с memory **Telegram Renewal Sync Standard v2**, **Club Status Integrity**, **Canonical Telegram Grant Write-Path** — никаких ручных DML по `telegram_club_members`, всё через канонический резолвер.

## 3. Технические детали

- **Миграция:** обе RPC `SECURITY DEFINER`, `SET search_path = public`. JOIN-ы лёгкие (по `product_club_mappings.club_id` → `product_id`, далее `subscriptions_v2.user_id = m.auth_user_id AND product_id=...` и `entitlements.user_id = m.auth_user_id AND product_id=...`). Под индекс уже попадает (есть индексы по `user_id, product_id`).
- **Тип `ClubMemberEnriched`** в `useTelegramIntegration.tsx` — расширяю; типы Supabase в `src/integrations/supabase/types.ts` обновятся автоматически после миграции.
- **Сортировка** клиентская (`useMemo`), не ломает существующий поиск/фильтры.
- **Регрессии:** не меняю поведение действий (кик, redeem, refresh), не трогаю tabs counts (они уже считаются по `has_active_access` и `access_status`).
- **Smoke-test после деплоя:** открываем вкладку «Удалённые» → должны появиться 2 столбца, по умолчанию отсортировано по «Доступ до» DESC; у Инны не должно быть жёлтого «Доступ активен» (UI-guard); после ручного перезапуска members-sync — её `access_status` должен стать `no_access` и автокик отработает на следующих зомби автоматически.

## 4. Что НЕ делаем

- Не создаём отдельных файлов (CSV/Excel) — всё в существующей таблице.
- Не добавляем новых таблиц/колонок в `telegram_club_members`.
- Не трогаем canonical write-path для grant/revoke (`grant-access-for-order`, `telegram-grant-access`, `telegram-revoke-access`).
- Не правим логику воронок/orders/subscriptions.

## DoD

- [ ] Миграция RPC применена, обе функции возвращают `access_started_at` / `access_ended_at`.
- [ ] В `/admin/integrations/telegram/clubs/:id/members` появились 2 столбца с датами, отображаются на всех вкладках.
- [ ] Сортировка по 6 колонкам работает; во «Удалённых» по умолчанию `access_ended_at DESC`.
- [ ] У Инны Грудецкой (и любого «зомби past_due без entitlement») больше не отображается «Доступ активен».
- [ ] После resync-а клуба `Gorbova Club` `telegram_club_members.access_status` у трёх «зомби» переключается на `no_access`, и автокик их обрабатывает в следующем цикле (cron 60 мин).
- [ ] Никаких ручных DML по `telegram_club_members`, никаких новых ENV/секретов.
