План: CRM Companies — Phase 2 фактический closure-patch runnable SQL

## 1. Проблема

Повторный отчёт был отклонён, потому что в репозитории фактически сохранились незакрытые остатки:

- `.lovable/plan.md` не восстановлен и начинается с review-текста `# да, согласен, с учетом правок:`;
- canonical forward/rollback markers охватывают markdown-прозу, заголовки и несколько code fences, поэтому диапазон между маркерами не является самостоятельным SQL-файлом;
- в §11.2 есть незакрытый/вложенный SQL fence: после `END $$;` открыт второй ```sql без закрытия первого;
- в Phase 2 runnable SQL остаются логические пробелы по deterministic resolve, billing no-op/idempotency, race-safe link_contact, merge guards/metadata, hash fallback и ACL matrix.

## 2. Диагностика текущего состояния

Read-only проверка в этом turn подтвердила:

- `docs/ENGINEERING_RULES.md` требует формат `План:` / `Отчет о выполнении:` и последовательность Diagnose → Plan → Dry run → Execute → Verify.
- `.lovable/plan.md` действительно содержит review-текст и начинается с `# да, согласен, с учетом правок:`.
- В `.lovable/discovery/companies-1.0/companies_phase2_runnable_plan.md`:
  - `<!-- PHASE2_FORWARD_SQL_BEGIN -->` стоит перед строкой `Файл: ...`, заголовками `### 11.x` и markdown fences;
  - §11.2 содержит открытый ```sql на строке 716 и второй открытый ```sql на строке 759 без закрытия первого;
  - rollback marker также охватывает markdown-заголовки и fences;
  - §13.8 заявляет `forward: 0 hits / rollback: 0 hits`, но этот результат неприменим как доказательство автономного SQL-файла, потому что canonical range не является чистым SQL.

## 3. Предлагаемое решение

Выполнить фактический новый документационный patch, без изменений БД, migration-файлов и `src/**`.

### 3.1 Восстановить `.lovable/plan.md`

- Восстановить `.lovable/plan.md` дословно из commit `aa14bdaaa0de8fc0fbad99cb31e7f0df99ae51f7`.
- После восстановления проверить, что первая строка больше не равна `# да, согласен, с учетом правок:`.

### 3.2 Сделать clean canonical forward SQL block

В `companies_phase2_runnable_plan.md`:

- оставить markdown-описание §11 вне canonical markers;
- поместить `<!-- PHASE2_FORWARD_SQL_BEGIN -->` непосредственно перед единым SQL fence;
- внутри marker-range оставить только один самостоятельный SQL-файл:
  - `BEGIN;`
  - preflight DO-block;
  - private helper `_crm_company_emit_domain_event`;
  - private helper `_crm_company_resolve_or_create_internal`;
  - 7 public RPC;
  - `CREATE OR REPLACE FUNCTION search_global(...)`;
  - ACL `REVOKE/GRANT`;
  - post-apply invariant DO-block;
  - `COMMIT;`
- закрыть единый SQL fence до `<!-- PHASE2_FORWARD_SQL_END -->`;
- удалить/перенести из canonical range markdown-заголовки, prose, `<ts>`, отдельные code fences и checklist.

### 3.3 Исправить §11.2 SQL fence

- Убрать вложенный второй ```sql между emit-helper и resolve-helper.
- В canonical SQL оставить оба helper в одной непрерывной SQL-секции.

### 3.4 Уточнить deterministic resolve active/merged компаний

В `_crm_company_resolve_or_create_internal`:

- искать активную canonical company детерминированно:
  - `status <> 'merged'` предпочтительно;
  - `ORDER BY created_at ASC, id ASC`;
  - `FOR UPDATE`;
- если найдены только merged-кандидаты — рекурсивно разрешать `merged_into_company_id` до активного leaf с depth guard;
- если chain broken/cyclic или leaf отсутствует — `RAISE EXCEPTION`;
- не возвращать произвольную merged target без проверки активного leaf.

### 3.5 Исправить корректную первую billing-синхронизацию и no-op

В `crm_company_upsert_from_billing`:

- после resolve/create определить, является ли это первой billing-синхронизацией по отсутствию `last_billing_source_updated_at`/snapshot;
- не считать неизменившееся поле changed, если target уже равен normalized billing value;
- добавлять поле в `v_changed` только при реальном изменении target;
- при первой синхронизации корректно заполнить snapshot без ложных material changes, если helper уже создал company с тем же `full_name`;
- повторный billing с теми же значениями/source version должен быть no-op: без ложного `changed_fields`, без нового event/activity.

### 3.6 Усилить billing event idempotency

- Сделать idempotency key для `company.upserted_from_billing.v1` зависящим не только от списка changed fields, но и от material values/source version:
  - company id;
  - client legal details id;
  - `source_updated_at` или нормализованный values hash;
  - hash changed/conflict fields и normalized values.
- При отсутствии material changes и conflicts event не писать.

### 3.7 Сделать `crm_company_link_contact` race-safe

- Добавить advisory lock по ключу `company_id/profile_id/relationship_type` перед SELECT/INSERT.
- Использовать conflict-safe insert/update pattern для уникального `(company_id, profile_id, relationship_type)`:
  - сначала lock;
  - затем SELECT FOR UPDATE;
  - затем INSERT;
  - при `unique_violation` повторно SELECT FOR UPDATE и применить update merge-logic.
- Сохранить lineage guard для billing map.

### 3.8 Исправить merge: source existence guard и metadata перенос

В `crm_company_merge`:

- после deterministic locks явно проверить, что source и target rows найдены;
- если source отсутствует — `RAISE EXCEPTION 'source not found'`;
- если target leaf отсутствует — `RAISE EXCEPTION`;
- при merge контактов переносить source metadata без потери:
  - target metadata сохранить;
  - source metadata вложить/объединить в `merged_from`/`sources`, чтобы ключи source не затирали target;
- при company-level merge добавить в target metadata сведения о source metadata/public_id/status и consumed chain.

### 3.9 Сделать hash guard исполняемым с fallback

В preflight SQL:

- не использовать несуществующую/неподключенную функцию `sha256()` без guard;
- реализовать исполняемый fallback:
  - сначала попробовать `digest(..., 'sha256')`, если доступна `pgcrypto.digest`;
  - иначе использовать `md5(pg_get_functiondef(...))` и сверять с зафиксированным md5 `7641d12fc0bea802a93935a384e7e349`;
- если ни SHA, ни md5 fallback не совпали — HARD STOP.

### 3.10 Расширить post-apply ACL matrix

В §11.12 и §13:

- проверить все 7 public RPC:
  - 6 authenticated RPC: `authenticated=true`, `anon=false`, `service_role=false`;
  - `crm_company_upsert_from_billing`: `service_role=true`, `authenticated=false`, `anon=false`;
- проверить оба private helper: `anon=false`, `authenticated=false`, `service_role=false`;
- проверить `search_global` ACL как сохранённый pre-Phase-2 contract, если он не должен меняться;
- добавить explicit failure messages по каждой группе.

### 3.11 Сделать clean canonical rollback SQL block

- Переместить `<!-- PHASE2_ROLLBACK_SQL_BEGIN -->` непосредственно перед единым rollback SQL fence.
- В marker-range оставить только самостоятельный SQL-файл:
  - `BEGIN;`
  - `DROP FUNCTION` для 5 новых public RPC;
  - восстановление Phase 1 skeletons для 2 RPC;
  - восстановление pre-Phase-2 `search_global`;
  - `DROP FUNCTION` resolve helper;
  - `DROP FUNCTION` emit helper;
  - восстановление Phase 1 ACL;
  - `COMMIT;`
- Убрать из rollback canonical range markdown-заголовки/prose/fences.

### 3.12 Обновить static verification (§13)

- Заменить недостоверные утверждения `forward: 0 hits` / `rollback: 0 hits` на фактические результаты нового сканирования.
- Добавить команды/описание extractor, который сканирует именно содержимое SQL внутри canonical markers.
- Проверить и отразить:
  - forbidden placeholders отсутствуют;
  - marker-ranges являются чистым SQL;
  - нет markdown headers внутри canonical SQL;
  - нет nested fences внутри canonical SQL;
  - counts функций соответствуют 10 forward / 7 drop + 3 restore rollback;
  - прямой `INSERT INTO public.domain_events` есть только в emit helper.

## 4. Изменяемые компоненты

Будут изменены только:

1. `.lovable/plan.md` — восстановление из указанного commit.
2. `.lovable/discovery/companies-1.0/companies_phase2_runnable_plan.md` — документационная материализация clean canonical SQL blocks и static verification.

## 5. Что не будет изменено

Не трогать:

- БД / backend state;
- `supabase/migrations/**`;
- `src/**`;
- `supabase/functions/**`;
- `supabase/config.toml`;
- ADR-0002, если по ходу не будет обнаружена прямая зависимость от исправляемого runnable SQL;
- admin fixture и execution package — остаются следующими этапами.

## 6. Dry-run

Перед patch:

- зафиксировать текущие проблемные места read-only:
  - первая строка `.lovable/plan.md`;
  - диапазоны forward/rollback markers;
  - наличие nested SQL fence в §11.2.

После patch, до отчёта:

- выполнить read-only static scan по `companies_phase2_runnable_plan.md`:
  - extract forward canonical SQL;
  - extract rollback canonical SQL;
  - проверить отсутствие markdown-заголовков и prose внутри marker ranges;
  - проверить отсутствие запрещённых placeholders: `...`, `сокращено`, `см. body`, `см. helpers`, `при финализации`, `в фактической миграции`, `аналогично`, `остальные поля`, `TODO`, `FIXME`, `<...>`, `{{...}}`, `TBD`;
  - проверить баланс SQL fences;
  - посчитать функции/GRANT/REVOKE/INSERT domain_events.

## 7. Execute

После approve плана:

1. Прочитать точное содержимое `.lovable/plan.md` из commit `aa14bdaaa0de8fc0fbad99cb31e7f0df99ae51f7` и заменить текущий файл.
2. Отредактировать только `companies_phase2_runnable_plan.md`:
   - перестроить §11 canonical forward block в единый SQL file;
   - исправить helper order/fence;
   - внести SQL-логические исправления по пунктам 3.4–3.10;
   - перестроить §12 canonical rollback block в единый SQL file;
   - обновить §13 verification и checklist.
3. Не создавать migration-файл и не применять SQL.

## 8. STOP-guards

Остановиться и не выдавать closure, если:

- восстановление `.lovable/plan.md` из указанного commit невозможно;
- требуется изменение БД/migrations/src для закрытия документационного patch;
- extractor показывает markdown/prose/fences внутри canonical SQL marker ranges;
- placeholder scan даёт >0 hits внутри canonical SQL;
- обнаружен прямой `INSERT INTO public.domain_events` вне emit helper;
- count matrix не совпадает;
- rollback использует `CASCADE`;
- patch затрагивает файлы вне двух разрешённых.

## 9. DoD

Patch считается выполненным только если отчёт сможет подтвердить фактами:

- `.lovable/plan.md` восстановлен из `aa14bdaaa0de8fc0fbad99cb31e7f0df99ae51f7`, первая строка больше не review-текст;
- changed files ровно два указанных файла;
- forward marker range — самостоятельный SQL-файл без markdown-прозы и без nested fences;
- rollback marker range — самостоятельный SQL-файл без markdown-прозы и без nested fences;
- §11.2 fence исправлен;
- deterministic resolve, billing no-op/idempotency, race-safe link_contact, merge metadata/source guard, executable hash fallback и full ACL matrix внесены в SQL;
- static scan результатов обновлён и показывает 0 запрещённых placeholders в canonical SQL;
- БД, migrations и `src/**` не изменялись;
- Phase 2 execution остаётся `NOT APPROVED`, admin fixture blocker сохранён.

## 10. Риски и зависимости

- Большой markdown-файл требует аккуратной замены блоков, чтобы не потерять ранее согласованные discovery/ADR sections.
- SQL не будет применяться, поэтому проверка ограничена static review и syntactic/readability controls.
- Без отдельного admin fixture runtime proof остаётся заблокированным; этот patch не снимает blocker execution.

## 11. Требуется дополнительная информация

Дополнительная информация от пользователя не требуется. Нужен approve этого плана для перехода к фактическому документационному patch.