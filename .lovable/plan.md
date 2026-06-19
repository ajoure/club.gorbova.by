# да, согласен, с учетом правок:

1. **Не включать** `data_repair.patch2_orphan_grant_revoke`**,** `mass_telegram_revoke`**,** `cleanup.telegram_orphans` **как kick-actions без доказанного entity-match.**  
Их можно использовать только если в `audit_logs` есть точная связь с конкретным участником клуба: `telegram_user_id` / `tg_user_id` / `profile_id` / `auth_user_id` + `club_id`.  
Если связи нет — не использовать для `kicked_at`.
2. **Матчинг audit_logs сделать строго по участнику и клубу.**  
Недостаточно только `action IN (...)`. Нужно, чтобы событие относилось именно к этой строке `telegram_club_members`:
  - `club_id` совпадает с текущим клубом;
  - Telegram/user/profile идентификатор совпадает с участником;
  - `admin_protected`, `guard_skip`, `dry_run`, `failed` — исключить.
3. `kicked_at_source='unknown'` **лучше вернуть как** `NULL` **или** `'audit_log' | 'unknown'`**, но в UI не показывать source.**  
В CSV — да, можно.
4. **В Proof добавить проверку по sources:**

```sql
SELECT kicked_at_source, COUNT(*)
FROM v_club_members_enriched
WHERE club_id = 'fa547c41-3a84-4c4f-904a-427332a0506e'
  AND access_status = 'removed'
GROUP BY kicked_at_source;
```

5. **В Proof обязательно показать проблемные строки, где раньше была ложная дата 19.06.2026:**

```sql
SELECT telegram_name, telegram_username, access_started_at, kicked_at, kicked_at_source
FROM v_club_members_enriched
WHERE club_id = 'fa547c41-3a84-4c4f-904a-427332a0506e'
  AND access_status = 'removed'
ORDER BY kicked_at DESC NULLS LAST
LIMIT 30;
```

6. **DoD уточнить:**  
Не просто «нет строк `кикнут 19.06.2026`», а:
  - если `кикнут 19.06.2026` остался — у каждой такой строки должен быть реальный `audit_log` kick-event за 19.06.2026;
  - если audit-event нет — UI обязан показывать «дата кика неизвестна».

Остальное согласовано. Это правильный hotfix: **убрать** `updated_at` **как источник даты кика, показывать только audit-based дату либо “дата кика неизвестна”**.

&nbsp;

План v5 (hotfix): убрать ложную дату «кикнут 19.06.2026»

## Проблема (подтверждена в БД)

`v_club_members_enriched` (миграция v4) для `kicked_at` использует:

```sql
COALESCE(MAX(audit_logs где action IN (...)), tcm.updated_at)
```

`tcm.updated_at` массово обновился сегодня (19.06.2026) после resync/миграций — отсюда «кикнут 19.06.2026» у большинства removed-записей.

Discovery audit_actions по `club_id = fa547c41…`:

- `telegram.autokick.attempt` — **1 155** (это и есть реальные кики)
- `telegram.access_expired_revoke` — 42
- `telegram.autokick.admin_protected` — 1 398 (НЕ кик, защита)
- `data_repair.patch2_orphan_grant_revoke` — 1
- `AUTOKICK`, `telegram.kick.manual` — 0 (в текущих данных)

Текущий SQL уже включает `telegram.autokick.attempt`, но `admin_protected` НЕ кик и не должен попадать (он и не попадает — ок). Главная беда — fallback на `updated_at`.

## Что меняем

### 1. Миграция v5 (новый файл)

Пересоздать `v_club_members_enriched` + обе RPC `get_club_members_enriched` / `search_club_members_enriched`:

- `kicked_at` = **только** `MAX(audit_logs.created_at)` по реальным kick-actions, **без** fallback на `updated_at`. Если событий нет → `NULL`.
- Расширить список actions до:
`telegram.access_expired_revoke`, `telegram.autokick.attempt`, `AUTOKICK`, `telegram.kick.manual`, `data_repair.patch2_orphan_grant_revoke`, `mass_telegram_revoke`, `cleanup.telegram_orphans`.
(Проверены по `audit_logs` глобально, без `admin_protected` и `guard_skip`.)
- Добавить колонку `kicked_at_source text` в view/RPC со значениями:
  - `'audit_log'` — взято из audit;
  - `'unknown'` — событий нет, `kicked_at IS NULL`.
- `is_commercial_orphan` оставить как есть.
- Жёстко: `kicked_at` определяется **только для `access_status='removed'**`, иначе `NULL`.

### 2. UI (`TelegramClubMembers.tsx`)

- Колонка «Доступ до / Кик»:
  - `ok`/`no_access` → `access_ended_at` как сейчас;
  - `removed` + `kicked_at IS NOT NULL` → «кикнут dd.MM.yyyy»;
  - `removed` + `kicked_at IS NULL` → «дата кика неизвестна» (muted).
- Сортировка по `COALESCE(kicked_at, access_ended_at)` остаётся.
- CSV экспорт: колонки «Дата кика» (пустая если NULL) и новая «Источник даты кика» (`kicked_at_source`).
- Никаких `updated_at` в UI как «дата кика».

### 3. `useTelegramIntegration.tsx` / `types.ts`

Расширить тип `ClubMemberEnriched` полем `kicked_at_source: 'audit_log' | 'unknown' | null`.

### 4. Proof (после применения миграции)

Прогнать read-only запросы и приложить в отчёт:

1. `COUNT(*) WHERE access_status='removed' AND kicked_at_source='audit_log'`
2. `COUNT(*) WHERE access_status='removed' AND kicked_at IS NULL`
3. `COUNT(*) WHERE access_status='removed'` (общий)
4. 10 строк `WHERE access_status='removed' AND kicked_at::date = CURRENT_DATE` — проверить, что у них есть реальный audit-event сегодня, иначе должны быть NULL.

## Чего НЕ делаем

- Никакого DML/DELETE по `telegram_club_members`.
- Не трогаем canonical write-path (`grant-access-for-order`, `telegram-grant-access`, cron).
- Не меняем `validator`/`cron-sync` (отдельный план «zombie access» остаётся в backlog).

## Файлы

- `supabase/migrations/<ts>_club_members_kicked_at_v5_no_updated_at.sql`
- `src/pages/admin/TelegramClubMembers.tsx`
- `src/hooks/useTelegramIntegration.tsx`
- `src/integrations/supabase/types.ts` (после реген.)

## DoD

- На вкладке «Удалённые» нет ни одной строки `кикнут 19.06.2026`, если в audit_logs нет соответствующего события сегодня.
- Записи без audit-событий показывают «дата кика неизвестна».
- Proof-запросы приложены в отчёт.