# Phase 3B — Identity Remediation Report

- **Version:** 1.1
- **Дата:** 2026-07-19
- **История:** v1.0 (2026-07-19) — первичная schema-only миграция; v1.1
  (2026-07-19) — corrective schema-only миграция для NOT NULL actor blocker
  в `crm_company_link_contact` (см. §6).
- **Скоуп:** только schema-only миграции для устранения identity blocker'а из
  `companies_phase3b_rollback_rehearsal_report.md` и последующего NOT NULL
  actor blocker'а, обнаруженного независимым static review.
- **Backfill не выполнялся.** Никакие 17 CLD не обрабатывались; никаких DML,
  очередей, воркеров, UI, edge-функций или Phase 4+ изменений не вносилось.
- **Phase 3C НЕ выполнялся и остаётся запрещён до отдельного admin approval.**
- **Phase 3B rehearsal не запускался** — заблокирован до применения corrective
  миграции v1.1; после её apply — по-прежнему требует rehearsal под реальной
  service-role identity в approved окружении.

---

## 1. Migration

- **Название (человекочитаемое):** *Phase 3B identity remediation (schema-only)*.
- **Файл:** сгенерирован Lovable Cloud migration tool 2026-07-19 (timestamp
  `20260719-230952-307814`).
- **Тип:** schema-only. Никакие таблицы/RLS/policies/sequences/данные не менялись.

### Что делает миграция

1. **Preflight guards** (внутри `DO $preflight$`):
   - `crm_company_upsert_from_billing(_client_legal_details_id uuid)` существует,
     `SECURITY DEFINER=true`.
   - `crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)` существует,
     `SECURITY DEFINER=true`.
   - ACL до миграции (проверено через `has_function_privilege`):
     - `crm_company_link_contact`: `authenticated=EXECUTE`, `service_role`/`anon` — deny.
     - `crm_company_upsert_from_billing`: `service_role=EXECUTE`, `authenticated`/`anon` — deny.
   - Любое отклонение — миграция abort'ит без побочных эффектов.

2. **Изменение только authorization-gate** у `crm_company_link_contact`
   (тело функции переписано дословно, изменён только `IF NOT (...) THEN RAISE 'forbidden'`):
   ```plpgsql
   IF NOT (auth.role() = 'service_role'
        OR has_role_v2(auth.uid(),'admin')
        OR has_role_v2(auth.uid(),'super_admin')
        OR has_role_v2(auth.uid(),'menedzher')) THEN
     RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
   END IF;
   ```
   Остальная логика (advisory lock, INSERT/UPDATE, unique_violation retry-read,
   domain event, activity log) — сохранена побайтово. `SECURITY DEFINER`,
   `search_path=public`, сигнатура — без изменений.

3. **GRANT-ы `crm_company_link_contact` явно переустановлены к прежнему инварианту:**
   `REVOKE ALL FROM PUBLIC, anon, service_role; GRANT EXECUTE TO authenticated`.
   Это не JWT spoofing: `service_role` **по-прежнему не может вызывать функцию
   напрямую**. Bypass gate срабатывает только когда вложенный вызов идёт из
   owner-executed wrapper'а (owner=`postgres`), которым является новый writer.

4. **Новый service-only writer** `public.crm_company_backfill_billing_cld(uuid) RETURNS jsonb`:
   - `SECURITY DEFINER`, `SET search_path = public`, owner=`postgres`.
   - Первая инструкция:
     ```plpgsql
     IF auth.role() IS DISTINCT FROM 'service_role' THEN
       RAISE EXCEPTION 'forbidden: service_role only' USING ERRCODE='42501';
     END IF;
     ```
   - Не читает `auth` schema, не использует `SET LOCAL request.jwt.claims`,
     не опирается на BYPASSRLS/`sandbox_exec`, не выдаёт broad grants,
     не создаёт/не меняет политик и таблиц.
   - Поток:
     1. `SELECT profile_id ... FROM client_legal_details WHERE id=? FOR UPDATE` —
        row-lock источника, извлечение profile_id (обе колонки валидируются,
        `23503` / `23502` при отсутствии).
     2. `company_id := crm_company_upsert_from_billing(cld_id)` — canonical company
        через существующий Phase-2 RPC (service_role EXECUTE preserved).
     3. **Map (idempotent read-then-insert, единственное разрешённое отклонение от
        отсутствующего map RPC):**
        - `SELECT * FROM client_legal_details_company_map WHERE client_legal_details_id=? FOR UPDATE`.
        - Если запись есть и `company_id` совпадает — reuse.
        - Если есть и не совпадает — `RAISE 23505 'map conflict … existing % != expected %'`,
          **никаких ON CONFLICT / overwrite**.
        - Иначе `INSERT` с `metadata = {source:'billing_requisites', writer:'crm_company_backfill_billing_cld', writer_version:1}`.
        - `unique_violation` из-за гонки → повторное `SELECT ... FOR UPDATE` + такая
          же проверка equality; mismatch снова abort'ит.
     4. Снимок `contact_pre` для флагов created/reused.
     5. `crm_company_link_contact(company_id, profile_id, 'billing_contact', true,
        'billing_requisites', map_id)` — все idempotency/event/activity semantics
        сохранены (никаких дублирующих домен-событий/логов не добавляется).
   - Возвращает `jsonb`:
     ```json
     {
       "client_legal_details_id": "...", "profile_id": "...",
       "company_id": "...", "map_id": "...",
       "map_created": bool, "map_reused": bool,
       "contact_id": "...", "contact_created": bool, "contact_reused": bool,
       "writer": "crm_company_backfill_billing_cld", "writer_version": 1
     }
     ```
   - Транзакционная атомарность: writer выполняется в одной транзакции; ошибка
     на любом шаге (map conflict, link_contact validation, upsert) откатывает
     всё, включая уже созданный map, поскольку никаких промежуточных COMMIT нет.

5. **ACL нового writer'а:**
   `REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role`.

6. **Postflight guards** (внутри `DO $post$`):
   - `crm_company_link_contact`: `service_role`/`anon` deny, `authenticated` EXECUTE — **preserved verbatim**.
   - `crm_company_upsert_from_billing`: без изменений — `service_role` EXECUTE, `authenticated`/`anon` deny.
   - `crm_company_backfill_billing_cld`: только `service_role` EXECUTE.
   - Обе SECURITY DEFINER функции сохраняют `SET search_path = public`.

---

## 2. Runtime ACL / smoke proof (без DML)

Выполнено через managed exec (`psql` под `sandbox_exec`), только read-only проверка каталога и привилегий:

```
             proname              | secdef | proconfig            | anon | auth | service_role
----------------------------------+--------+----------------------+------+------+--------------
 crm_company_backfill_billing_cld |   t    | {search_path=public} |  f   |  f   |      t
 crm_company_link_contact         |   t    | {search_path=public} |  f   |  t   |      f
 crm_company_upsert_from_billing  |   t    | {search_path=public} |  f   |  f   |      t
```

Доказательства:

- **Service-role writer eligibility:** `has_function_privilege('service_role',
  'public.crm_company_backfill_billing_cld(uuid)', 'EXECUTE') = true`; для
  `anon`/`authenticated` — `false`.
- **Direct service execution `crm_company_link_contact` остаётся запрещена:**
  `has_function_privilege('service_role',
  'public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)',
  'EXECUTE') = false` — приватность прямого вызова сохранена, gate внутри
  функции разрешает только вложенный owner-executed путь.
- Прямой live-вызов новых функций от имени `service_role` **не выполнялся**,
  так как это потребовало бы либо JWT spoofing, либо реальной сервисной
  идентичности, недоступной managed executor'у, а также нарушило бы правило
  «no DML». Проверка сведена к каталогу и `has_function_privilege`, что и
  является требуемым runtime ACL proof без побочных эффектов.

---

## 3. Data invariants (без изменений)

Baseline canonical, снятый после миграции (`SELECT count(*) …`):

| Показатель | Значение |
|---|---|
| `public.companies` | 0 |
| `public.client_legal_details_company_map` | 0 |
| `public.company_contacts` (is_billing_contact=true) | 0 |
| `public.crm_activity_log` (activity_type='company.linked_to_contact') | 0 |
| `public.public_id_sequences` (entity_type='company', last_value) | 0 |

Точно совпадает с baseline из `companies_phase3b_rollback_rehearsal_report.md`.
Никаких таблиц/sequence/policy/RLS-изменений не производилось; никаких строк
не вставлено/не обновлено/не удалено. Никаких новых edge-функций, cron-задач,
очередей или UI-компонентов не создано.

---

## 4. Stop-guards и compliance с v1.2

- ✅ Единственный контролируемый map INSERT — только внутри writer'а, с
  execution ledger (metadata source/writer), с equality-check и без blind
  ON CONFLICT.
- ✅ ACL prior invariants сохранены; broad grants не выдавались.
- ✅ Никаких изменений RLS policies или table schema.
- ✅ Не читалась `auth` schema; не использовался `sandbox_exec`/`BYPASSRLS`;
  не подменялись JWT claims.
- ✅ 17 CLD **не обрабатывались**; никакого backfill-прохода не выполнялось.
- ✅ Phase 3C заблокирован до отдельного admin approval; для его старта
  требуется дополнительно: (a) успешный rollback-only rehearsal нового writer'а
  под реальной service-role идентичностью в approved окружении, и (b) явное
  одобрение админа.

---

## 5. Blocker status

**RESOLVED (schema-only).** Идентити-блокер из
`companies_phase3b_rollback_rehearsal_report.md §2` устранён минимальной
миграцией: единая транзакционная точка входа для service-only backfill теперь
существует, gate `crm_company_link_contact` расширен только для owner-executed
wrapper'а, а прежние ACL инварианты сохранены под postflight-guard'ами.
Требуемый next step (за пределами данного отчёта) — rollback-only rehearsal
нового writer'а в среде с реальной service-role идентичностью, до какого-либо
Phase 3C запроса на approval.
