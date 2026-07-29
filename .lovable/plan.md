## Текущее состояние

- `origin/main` HEAD: **`c97ef1341b93ea8729f853ec4fe87c86c1813f67`**.
- Lovable-side HEAD: `632038d41...` (предыдущий релиз). Диф до `c97ef1341` включает новую миграцию `supabase/migrations/20260729074915_payment_reconcile_queue_profile_fk_set_null.sql`.
- Файл миграции прочитан. Он идемпотентно перекладывает FK `public.payment_reconcile_queue.matched_profile_id → public.profiles(id)` на `ON DELETE SET NULL`. Жёсткие guard-условия внутри `DO $$`: RAISE EXCEPTION, если таблица отсутствует, столбец отсутствует или `matched_profile_id` NOT NULL. Никаких `UPDATE`/`DELETE` над строками очереди; в контрактном тесте `src/test/paymentReconcileQueueProfileDeleteMigration.test.ts` это зафиксировано.

Scope релиза — строго одна миграция. Никаких Edge Functions, RLS, RPC, данных, Auth, Storage, CRM, UI, Publish.

## Release plan (PLAN-ONLY, execution — по отдельному EXECUTE)

### Шаг 0. Синхронизация SHA
- Managed action: sync Lovable working tree к `c97ef1341b93ea8729f853ec4fe87c86c1813f67`.
- Read-back: `git rev-parse HEAD == c97ef1341...`; файл `supabase/migrations/20260729074915_payment_reconcile_queue_profile_fk_set_null.sql` присутствует; `git log -1 --format=%H` для этого файла = `c97ef1341...` (либо коммит-предок, где он был впервые введён — не важно, важно что он существует на синхронизированном дереве).
- Rollback: вернуть sync к `632038d41...`; никаких DB-изменений на этом шаге ещё нет.

### Шаг 1. Managed migration `20260729074915_payment_reconcile_queue_profile_fk_set_null.sql`
- Managed action: apply ровно этот файл через managed migration tool. Никаких других SQL в той же транзакции.
- Pre-check (read-only, до apply):
  1. `SELECT to_regclass('public.payment_reconcile_queue');` — не NULL.
  2. `SELECT attnotnull FROM pg_attribute WHERE attrelid='public.payment_reconcile_queue'::regclass AND attname='matched_profile_id' AND NOT attisdropped;` — ожидается `false`.
  3. `SELECT count(*) AS total, count(*) FILTER (WHERE matched_profile_id IS NULL) AS null_profile FROM public.payment_reconcile_queue;` — сохранить как baseline.
- Stop guards (миграция сама остановит apply, а Codex — процесс релиза):
  - таблица `public.payment_reconcile_queue` отсутствует;
  - колонка `matched_profile_id` отсутствует;
  - колонка `matched_profile_id` NOT NULL;
  - любая ошибка `ALTER TABLE ... DROP CONSTRAINT` / `ADD CONSTRAINT`.
- Read-back proof (только `read_query`, без mutation):
  1. `SELECT conname, confdeltype FROM pg_constraint WHERE conrelid='public.payment_reconcile_queue'::regclass AND contype='f' AND confrelid='public.profiles'::regclass AND conkey = (SELECT ARRAY[attnum]::smallint[] FROM pg_attribute WHERE attrelid='public.payment_reconcile_queue'::regclass AND attname='matched_profile_id');` — ожидается ровно одна строка с `conname='payment_reconcile_queue_matched_profile_id_fkey'` и `confdeltype='n'` (SET NULL).
  2. Повтор запроса `SELECT count(*) AS total, count(*) FILTER (WHERE matched_profile_id IS NULL) AS null_profile FROM public.payment_reconcile_queue;` — оба значения идентичны baseline. Любое расхождение = STOP + докладывать владельцу.
  3. `SELECT attnotnull FROM pg_attribute WHERE attrelid='public.payment_reconcile_queue'::regclass AND attname='matched_profile_id';` — по-прежнему `false`.
- Rollback (при необходимости отката поведения FK — не данных):
  ```sql
  ALTER TABLE public.payment_reconcile_queue
    DROP CONSTRAINT payment_reconcile_queue_matched_profile_id_fkey;
  ALTER TABLE public.payment_reconcile_queue
    ADD CONSTRAINT payment_reconcile_queue_matched_profile_id_fkey
    FOREIGN KEY (matched_profile_id)
    REFERENCES public.profiles(id);
  ```
  Оформляется отдельной managed migration; данные не мутируются.

### Шаг 2. Publish
- Publish **не выполняется**: релиз backend-only, UI-изменений в диапазоне `632038d41...c97ef1341` для этого scope нет.

## Инварианты и жёсткие запреты
- Никаких real profile deletions, реальных платежей, customer email/Telegram сообщений, мутаций `payment_reconcile_queue` или `profiles` как способа проверить FK. Всё подтверждается только `pg_constraint` + `count(*)`.
- Никаких изменений других миграций, Edge Functions, RLS, RPC, product/tariff, Storage, Auth, CRM, UI, Publish.
- Стоп-условия: несовпадение SHA после sync; guard в миграции срабатывает; `confdeltype != 'n'` после apply; изменение `total`/`null_profile` count; любая ошибка apply — Execute немедленно прекращается, статус докладывается владельцу.

Готов к EXECUTE по вашему явному подтверждению.