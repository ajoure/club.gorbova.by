## Да, согласен, с учетом правок:

1. Во вкладке «Удалённые» по умолчанию должны отображаться только реальные бывшие клиенты клуба:
  - `access_status='removed'`;
  - `is_commercial_orphan=false`;
  - `has_active_access=false`;
  - `in_chat=false`;
  - `in_channel=false`;
  - не admin.
2. `is_commercial_orphan=true` скрывать по умолчанию.  
Это исторический мусор / ошибочные входы / trial / записи без коммерческой связи. Их не удаляем физически, но в рабочем списке «Удалённые» они не нужны.
3. Если у removed-клиента `kicked_at IS NULL`, но есть `access_ended_at`, в колонке «Доступ до / Кик» показывать не «дата кика неизвестна», а:
  - `доступ до dd.MM.yyyy`;
  - визуально muted;
  - tooltip: `Точная дата кика не найдена в audit_logs, показана дата окончания коммерческого доступа`.
  Это важно для таких клиентов, как Ольга Червейко: сделки есть, клиент реальный, но точного audit-события кика нет. Такой клиент должен оставаться в «Удалённых», а не выглядеть как мусор.
4. Если у removed-записи нет ни `kicked_at`, ни `access_ended_at`, тогда показывать:
  &nbsp;
  - `дата неизвестна`;
  - и такая строка должна быть видна только если `is_commercial_orphan=false`.  
  Если `is_commercial_orphan=true` — скрывать по умолчанию.
5. Для Татьяны Ярошевич и Юлии Рабчевской отдельно проверить, почему ручной кик не попал в `audit_logs`:
  - если кик был сделан через UI, значит manual kick action не пишет корректный audit event либо RPC/view не матчят его;
  - нужно добавить future-fix: все ручные кики через UI обязаны писать audit event с `action='telegram.kick.manual'`, `club_id`, `telegram_user_id`/`tg_user_id`, `profile_id/auth_user_id`, `actor_user_id`.
  В рамках текущего hotfix без ручного DML не восстанавливать задним числом дату кика, если её нет в audit_logs.
6. Для re-purchase:
  - если пользователь снова купил продукт и `has_active_access=true`, он не должен отображаться во вкладке «Удалённые»;
  - он должен отображаться в «С доступом» / «В клубе» по текущему состоянию.
7. Локальный `counts.removed` должен считаться так же, как фактический список вкладки:  
`removed AND !is_commercial_orphan AND !has_active_access AND !in_chat AND !in_channel AND !admin`.
8. Proof дополнить:
  - сколько всего `removed`;
  - сколько скрыто как `is_commercial_orphan=true`;
  - сколько скрыто как `has_active_access=true` / re-purchase;
  - сколько реально показывается во вкладке «Удалённые»;
  - 10 примеров видимых бывших клиентов с `kicked_at`;
  - 10 примеров видимых бывших клиентов без `kicked_at`, но с `access_ended_at`;
  - 10 примеров скрытых orphan-записей;
  - отдельно проверить Ольгу Червейко, Татьяну Ярошевич, Юлию Рабчевскую.
9. Никакого физического DELETE/DML по `telegram_club_members`.  
Только UI-фильтр, корректное отображение и proof.

&nbsp;

Итоговая логика колонки «Доступ до / Кик»:

- `removed + kicked_at` → `кикнут dd.MM.yyyy`;
- `removed + kicked_at IS NULL + access_ended_at` → `доступ до dd.MM.yyyy`;
- `removed + kicked_at IS NULL + access_ended_at IS NULL` → `дата неизвестна`;
- `ok/no_access` → `access_ended_at` или `—`.

Цель: «Удалённые» = реальные бывшие платные участники клуба, с понятным периодом доступа. Мусорные записи скрыты, повторно купившие клиенты убраны из «Удалённых».

&nbsp;

План: финальный cleanup вкладки «Удалённые»

### Diagnose (что уже есть)

Текущее состояние по клубу Горбова (`fa547c41-...`):

- `removed` всего: **49**
- `removed` + `is_commercial_orphan=true`: **9** (мусор)
- `removed` + `is_commercial_orphan=false`: **40** (реальные бывшие клиенты)

Что **уже** реализовано в v4/v5:

- `v_club_members_enriched.is_commercial_orphan` рассчитан строго по требованию:
`joined_chat_at IS NULL` AND нет paid `orders_v2`, нет `subscriptions_v2`, нет `entitlements` по `product_club_mappings` клуба.
- UI: тогглер «Скрыть мусорные» во вкладке «Удалённые», **по умолчанию ON**, бейдж со счётчиком скрытых.
- `kicked_at` берётся только из `audit_logs` (без `updated_at`-fallback).

Что **не доделано** (баг сортировки/видимости):

- В фильтре вкладки `removed` (строка 329) условие — только `access_status!=='removed' || in_any || isAdmin`. **Не учитывается `has_active_access**` — если бывший removed-пользователь снова купил продукт и получил активный доступ, он останется в «Удалённых». Нужно исключать таких из вкладки `removed` и оставлять их только в «С доступом» / «В клубе».

### Plan (что делаю)

**1. UI — `src/pages/admin/TelegramClubMembers.tsx**` (frontend-only, без миграции):

- В фильтре `case 'removed'` добавить условие: если `member.has_active_access === true` → исключить из вкладки (re-purchase auto-hide). Пользователь автоматически появится в «С доступом» / «В клубе» по существующей логике.
- Подсчёт `counts.removed` (через summary RPC) не трогаю — это серверный счётчик. Но если он завышает за счёт re-purchasers, добавлю клиентскую коррекцию: считать локально по `members` отфильтрованным как и таб (как уже делается для бейджа orphans).
- Бейдж скрытых orphans оставить.

**2. Proof (read-only SQL, без DML)** — после изменения UI выполнить и приложить в отчёте:

```sql
-- 1. removed всего
SELECT COUNT(*) FROM v_club_members_enriched
WHERE club_id='fa547c41-...' AND access_status='removed';

-- 2. removed + orphan=true
SELECT COUNT(*) ... AND is_commercial_orphan=true;

-- 3. removed + orphan=false
SELECT COUNT(*) ... AND is_commercial_orphan=false;

-- 4. показываются во вкладке по умолчанию
-- (= removed AND NOT in_any AND NOT is_commercial_orphan AND NOT has_active_access AND NOT admin)

-- 5. 10 примеров orphan=true (скрытые)
SELECT telegram_username, full_name, email, joined_chat_at
FROM v_club_members_enriched
WHERE club_id='fa547c41-...' AND access_status='removed' AND is_commercial_orphan=true LIMIT 10;

-- 6. 10 примеров реальных бывших клиентов
SELECT telegram_username, full_name, email, access_started_at, kicked_at, kicked_at_source
FROM v_club_members_enriched
WHERE club_id='fa547c41-...' AND access_status='removed' AND is_commercial_orphan=false
ORDER BY kicked_at DESC NULLS LAST LIMIT 10;

-- 7. Подтверждение отсутствия DML по telegram_club_members
SELECT COUNT(*) FROM audit_logs
WHERE action ILIKE '%telegram_club_members%delete%'
  AND created_at >= CURRENT_DATE;
```

### Что НЕ трогаю

- Канонический write-path grant/revoke.
- Автокик и `telegram-grant-access`.
- Физический DELETE строк в `telegram_club_members` (только видимость через флаг).
- Миграции БД — изменения только в одном файле UI.

### DoD

- В «Удалённых» по умолчанию: только `removed` + `!orphan` + `!has_active_access` + `!in_any` + `!admin`.
- Re-purchase автоматически убирает из «Удалённых».
- Тогглер «Скрыть мусорные» доступен для диагностики.
- Proof-блок (7 запросов) приложен в отчёте.
- Никакого DML.

### Файлы

- `src/pages/admin/TelegramClubMembers.tsx` — 1 строка в `case 'removed'` фильтре + локальный пересчёт `counts.removed`.