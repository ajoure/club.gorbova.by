

# План: security hardening — финальная версия с правками

## Принципы

- Add-only / safe-change only. Никаких новых доступов «на будущее».
- Этап A (critical) и этап B (warn) — две отдельные миграции, не сливать.
- Все правки только на основании подтверждённого discovery.
- Отчёт на русском, с before/after pg_policies, SQL proof и повторным scan/linter.

## Discovery — итог

**CRITICAL (подтверждено):**
1. `public.ilex_documents` — SELECT policy `USING (true)` для authenticated. INSERT/UPDATE/DELETE уже scoped по `saved_by`. Admin-read use-case в коде **не подтверждён** — admin override не добавляем.
2. `storage.objects` policy `System can upload document files` — `roles:{public}` + `WITH CHECK (bucket_id='documents')`. Grep по клиенту: `storage.from('documents')` отсутствует, все upload'ы идут через edge (service_role). Заменяющий authenticated INSERT не вводим.

**Contextual / warn:**
3. `realtime.messages` — проект использует только `postgres_changes` (30 файлов, 0 `private: true`, 0 Broadcast/Presence). DDL не нужен.
4. Public buckets listing — `owner-photos` listing подтверждён (admin uploader); остальные (`avatars`, `signatures`, `training-content`, `webinar-prestart`, `tariff-media`, `training-assets`) listing не используется.
5. `trg_site_form_submissions_public_id`, `validate_training_content_rule` — `proconfig=NULL`.
6. `media_jobs`, `notification_outbox`, `subscription_payment_credentials`, `support_ticket_counters` — service-role only by design.

## Этап A — Migration 1: critical fixes

Один файл: `supabase/migrations/<ts>_security_critical_ilex_and_documents.sql`

### A.1. `public.ilex_documents` — сузить SELECT

```sql
DROP POLICY IF EXISTS "Authenticated users can read all ilex documents"
  ON public.ilex_documents;

CREATE POLICY "Users can read own ilex documents"
  ON public.ilex_documents FOR SELECT TO authenticated
  USING (auth.uid() = saved_by);
```

INSERT/UPDATE/DELETE — не трогаем. Admin override — **не добавляем** (нет подтверждённого use-case).

### A.2. `storage.objects` / bucket `documents` — закрыть unsafe INSERT

```sql
DROP POLICY IF EXISTS "System can upload document files"
  ON storage.objects;
```

Заменяющий authenticated INSERT **не создаём**: client-side upload в `documents` отсутствует. Service_role обходит RLS — edge продолжит работать. SELECT/UPDATE/DELETE для bucket `documents` не трогаем (уже owner-scoped).

### A.3. Verify (этап A)

- SQL proof: from `user_A` viewpoint `SELECT count(*) FROM ilex_documents` = только свои; от `user_B` записи user_A не видны.
- Storage proof: anon `INSERT` в `documents` denied; service_role insert через edge работает.
- UI smoke: страница iLex (`useIlexApi`) у обычного пользователя — список своих документов, без RLS-ошибок.

## Этап B — Migration 2: warn/contextual

Один файл: `supabase/migrations/<ts>_security_warn_search_path_and_buckets.sql`

### B.1. Functions search_path

```sql
ALTER FUNCTION public.trg_site_form_submissions_public_id() SET search_path = public;
ALTER FUNCTION public.validate_training_content_rule() SET search_path = public;
```

Тела не меняем.

### B.2. Public buckets — убрать broad public listing там, где он не нужен

Для каждого bucket: `DROP` текущей broad public SELECT policy. **Заменяющий broad SELECT не создаём.** Прямой доступ к файлам у public buckets идёт через bucket-level `public = true` (Supabase отдаёт публичные URL без RLS на чтение конкретного объекта по URL), поэтому удаление SELECT-policy убивает только `.list()` и cross-file enumeration, не ломая `getPublicUrl`.

Buckets, у которых сносим public SELECT:
- `avatars`
- `signatures`
- `training-content`
- `webinar-prestart`
- `tariff-media`
- `training-assets`

Точные имена policies возьмём из `pg_policies` непосредственно перед написанием миграции (через `DROP POLICY IF EXISTS "<name>" ON storage.objects` для каждой найденной broad public SELECT-policy в этих bucket'ах).

Buckets, которые **не трогаем**:
- `owner-photos` — listing подтверждён (admin uploader/edge generate-cover) — accepted risk / justified.
- `documents-templates` — private bucket, не в scope warn.

### B.3. realtime.messages — без DDL

Документируем как **not applicable for current usage** (только `postgres_changes`).

### B.4. 4 service-role-only таблицы — без DDL

Документируем как **closed by design**, fake deny-policy не добавляем.

### B.5. Verify (этап B)

- Linter: `function_search_path_mutable` уходит для двух функций; `public_bucket_allows_listing` уходит для 6 сужённых buckets.
- Smoke: открытие аватара/подписи/training-content/webinar-prestart/tariff-media/training-assets по прямому public URL — отображается. `.list()` для этих bucket'ов из клиента — пусто/denied (это и нужно).
- Realtime smoke: подписки tickets/live/instagram/telegram продолжают работать (`postgres_changes` не затронут).

## Регресс-чек (что прогнать после обеих миграций)

1. iLex: «мои документы» отображаются у обычного пользователя.
2. Edge-функция, генерирующая документы в bucket `documents`, успешно загружает файл (service_role).
3. Аватары/подписи/training-content отображаются на сайте по прямым URL.
4. Realtime обновления Kanban / live-комнаты / instagram / telegram приходят без задержки.
5. `npm run build` проходит, типы supabase не требуют обновления (только policies, без schema).

## STOP-guards

- Не добавляем admin-read в `ilex_documents` без подтверждённого admin flow.
- Не добавляем authenticated INSERT в `documents` без подтверждённого client-side upload.
- Не «чиним listing» через `name <> ''` — это не блокирует listing.
- Не делаем DDL по `realtime.messages`.
- Не добавляем декоративные deny-policy на service-role-only таблицы.
- Не переводим public buckets в private в рамках этого патча.

## DoD

- 0 critical findings по `ilex_documents` и `documents` bucket.
- Linter: 0 `function_search_path_mutable`, 0 `public_bucket_allows_listing` для сужённых buckets.
- Отчёт содержит: список миграций, diff, before/after `pg_policies`, повторный security scan, повторный linter, SQL proof (owner vs other vs anon), runtime smoke (iLex + публичные buckets + realtime), accepted-risk список (`realtime.messages`, `owner-photos`, 4 service-role-only таблицы).

## Файлы

- `supabase/migrations/<ts>_security_critical_ilex_and_documents.sql` — этап A
- `supabase/migrations/<ts>_security_warn_search_path_and_buckets.sql` — этап B

UI/edge код не меняется.

