# да, согласен, с учетом правок:

1. Фрагмент стал существенно безопаснее.  
Явный `DROP CONSTRAINT IF EXISTS instagram_contacts_instagram_account_id_instagram_user_id_key` вместо эвристики — это правильное исправление.
2. Нужно добавить **идемпотентность / rerun-safety** для шага 5.  
Сейчас:
  &nbsp;
  ```sql
  ALTER TABLE public.instagram_contacts
    ADD CONSTRAINT instagram_contacts_account_provider_user_unique
      UNIQUE (instagram_account_id, provider_kind, instagram_user_id);
  ```
  при повторном запуске миграции упадёт, если constraint уже существует.  
  Нужен guard через `DO $$ ... IF NOT EXISTS (...) THEN ALTER TABLE ... ADD CONSTRAINT ... END IF; END $$;`.
3. Post-migration machine-check №3 в текущем виде **не rerun-safe**:
  &nbsp;
  ```sql
  legacy_apixdrive_count = total_contacts
  ```
  Это корректно только для самого первого запуска до появления ManyChat-строк. При повторном запуске или если между миграциями уже появятся `provider_kind='manychat'`, check даст ложный fail.  
  Этот assert нужно заменить на более безопасный вариант:
  - либо убрать как неидемпотентный;
  - либо проверять только то, что **нет** `NULL` и что старые строки до миграции были успешно backfill-нуты по заранее зафиксированному pre-count;
  - либо явно пометить его как one-time pre-launch assertion и вынести из idempotent migration в verify-скрипт.
4. Для полноты безопасного порядка добавь guard перед `DROP CONSTRAINT`, что колонка `provider_kind` действительно уже существует и `CHECK/NOT NULL` применены. Это не blocker, но усилит predictability.
5. После этих двух правок фрагмент Migration 1 можно принимать в execute.  
Критичных архитектурных замечаний по A4 больше нет.
6. &nbsp;
7. План: PATCH 1.1 v3 — Migration 1 (revised, A4 safe order)

## Что меняется vs предыдущая версия

Принятые правки ревью по A4:

1. ❌ Эвристика `contype='u' AND array_length(conkey,1)=2` для DROP — удалена. Дропаем только явно поименованный constraint.
2. ✅ Preflight conflict-check выполняется по **целевому будущему ключу** после backfill `provider_kind='apixdrive'`.
3. ✅ Жёсткий безопасный порядок для A4 (5 шагов).
4. ✅ Machine-check после миграции (4 ассерта).
5. ✅ Execute заблокирован до approve этого фрагмента.

---

## Безопасный порядок для A4 (внутри Migration 1)

1. `ALTER TABLE instagram_contacts ADD COLUMN provider_kind text NOT NULL DEFAULT 'apixdrive'` (с CHECK)
2. Verify `provider_kind IS NULL = 0` через `RAISE EXCEPTION` guard
3. Preflight conflict-check по будущему composite UNIQUE `(instagram_account_id, provider_kind, instagram_user_id)` → hard-stop при ≥1 дубле
4. `DROP CONSTRAINT IF EXISTS instagram_contacts_instagram_account_id_instagram_user_id_key`
5. `ADD CONSTRAINT instagram_contacts_account_provider_user_unique UNIQUE (...)`

Никаких эвристических `pg_constraint` поисков. Только явное имя.

---

## Обновлённый фрагмент Migration 1 (целиком, для approve)

```sql
-- ============================================================
-- PATCH 1.1 — Migration 1: schema add-only (A1, A2, A3 cols, A4)
-- Безопасный порядок для A4: ADD col → verify → preflight → DROP old → ADD new
-- ============================================================

-- A1: integration_instances.config_secrets
ALTER TABLE public.integration_instances
  ADD COLUMN IF NOT EXISTS config_secrets jsonb NOT NULL DEFAULT '{}'::jsonb;

-- A2: instagram_accounts.provider_kind
ALTER TABLE public.instagram_accounts
  ADD COLUMN IF NOT EXISTS provider_kind text NOT NULL DEFAULT 'apixdrive'
    CHECK (provider_kind IN ('apixdrive','manychat'));

-- A3: instagram_messages — 6 колонок (без индексов; индексы в Migration 2 CONCURRENTLY)
ALTER TABLE public.instagram_messages
  ADD COLUMN IF NOT EXISTS provider_kind text NOT NULL DEFAULT 'apixdrive'
    CHECK (provider_kind IN ('apixdrive','manychat')),
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS thread_key text,
  ADD COLUMN IF NOT EXISTS idempotency_hash text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

-- ============================================================
-- A4: instagram_contacts.provider_kind + UNIQUE swap (safe order)
-- ============================================================

-- Шаг 1: ADD COLUMN с DEFAULT (legacy backfill = 'apixdrive')
ALTER TABLE public.instagram_contacts
  ADD COLUMN IF NOT EXISTS provider_kind text NOT NULL DEFAULT 'apixdrive'
    CHECK (provider_kind IN ('apixdrive','manychat'));

-- Шаг 2: Verify backfill полностью применён (должно быть 0 NULL)
DO $$
DECLARE
  null_count integer;
BEGIN
  SELECT COUNT(*) INTO null_count
  FROM public.instagram_contacts
  WHERE provider_kind IS NULL;

  IF null_count > 0 THEN
    RAISE EXCEPTION
      'A4 backfill failed: % rows have provider_kind IS NULL after ADD COLUMN', null_count;
  END IF;
END $$;

-- Шаг 3: Preflight по ЦЕЛЕВОМУ composite UNIQUE
-- (instagram_account_id, provider_kind, instagram_user_id)
DO $$
DECLARE
  conflict_count integer;
BEGIN
  SELECT COUNT(*) INTO conflict_count
  FROM (
    SELECT instagram_account_id, provider_kind, instagram_user_id
    FROM public.instagram_contacts
    GROUP BY instagram_account_id, provider_kind, instagram_user_id
    HAVING COUNT(*) > 1
  ) dupes;

  IF conflict_count > 0 THEN
    RAISE EXCEPTION
      'A4 preflight failed: % duplicate (account, provider_kind, user_id) groups found. HARD STOP.', conflict_count;
  END IF;
END $$;

-- Шаг 4: DROP старого UNIQUE по ЯВНОМУ имени (без эвристики)
ALTER TABLE public.instagram_contacts
  DROP CONSTRAINT IF EXISTS instagram_contacts_instagram_account_id_instagram_user_id_key;

-- Шаг 5: ADD нового composite UNIQUE
ALTER TABLE public.instagram_contacts
  ADD CONSTRAINT instagram_contacts_account_provider_user_unique
    UNIQUE (instagram_account_id, provider_kind, instagram_user_id);

-- ============================================================
-- Post-migration machine-check (4 ассерта)
-- ============================================================
DO $$
DECLARE
  old_unique_exists boolean;
  new_unique_exists boolean;
  legacy_apixdrive_count integer;
  null_provider_count integer;
  total_contacts integer;
BEGIN
  -- 1. Старый UNIQUE отсутствует
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.instagram_contacts'::regclass
      AND conname = 'instagram_contacts_instagram_account_id_instagram_user_id_key'
  ) INTO old_unique_exists;

  IF old_unique_exists THEN
    RAISE EXCEPTION 'A4 check failed: old UNIQUE still exists';
  END IF;

  -- 2. Новый UNIQUE существует
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.instagram_contacts'::regclass
      AND conname = 'instagram_contacts_account_provider_user_unique'
  ) INTO new_unique_exists;

  IF NOT new_unique_exists THEN
    RAISE EXCEPTION 'A4 check failed: new composite UNIQUE missing';
  END IF;

  -- 3. Все legacy строки = 'apixdrive'
  SELECT COUNT(*) INTO total_contacts FROM public.instagram_contacts;
  SELECT COUNT(*) INTO legacy_apixdrive_count
    FROM public.instagram_contacts WHERE provider_kind = 'apixdrive';

  IF legacy_apixdrive_count <> total_contacts THEN
    RAISE EXCEPTION
      'A4 check failed: % of % rows are not provider_kind=apixdrive',
      (total_contacts - legacy_apixdrive_count), total_contacts;
  END IF;

  -- 4. provider_kind IS NULL = 0
  SELECT COUNT(*) INTO null_provider_count
    FROM public.instagram_contacts WHERE provider_kind IS NULL;

  IF null_provider_count > 0 THEN
    RAISE EXCEPTION 'A4 check failed: % rows with provider_kind IS NULL', null_provider_count;
  END IF;

  RAISE NOTICE 'A4 machine-check passed: old UNIQUE dropped, new UNIQUE active, % legacy rows=apixdrive', total_contacts;
END $$;
```

---

## Что НЕ изменилось

- Migration 2 (CONCURRENTLY indexes на `instagram_messages`) — без изменений
- Migration 3 (CONCURRENTLY composite UNIQUE на `integration_logs` для B1) — без изменений
- Migration 4 (RPC `get_instagram_dialogs_v1`) — без изменений
- Edges/UI порядок — без изменений

---

## Жду approve по обновлённому фрагменту Migration 1

После approve запускаю execute по полному порядку (Migration 1 → 2 → 3 → 4 → edges → UI → verify L1–L10).