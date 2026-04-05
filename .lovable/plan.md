## да, согласен, с учетом правок:

&nbsp;

1. **Execute только по optimistic guards.**
  Для каждой из 19 строк в UPDATE добавить проверку текущего ожидаемого состояния:
  &nbsp;
  - группа A: WHERE id = ... AND status = 'active' AND product_id IS NULL AND product_code = ...
  - группа B: WHERE id = ... AND status = 'active' AND expires_at = <current_expires>
    Если обновлено не 10/10 и 9/9 — **ROLLBACK / STOP**. Это нужно, чтобы не затронуть записи, если они уже изменились после dry-run. ID-driven и safe workflow обязательны.
  &nbsp;
2. **Не использовать “migration tool” как DDL-миграцию.**
  Здесь нужен **одноразовый data remediation script / transactional SQL patch**, а не обычная schema migration. В платформенных правилах критичны add-only, безопасное исполнение и недопущение поломки production-логики; для такого патча важнее controlled execute + verify, чем миграция схемы. 
3. **Зафиксировать exact binding для 9 wrong_end_date.**
  В плане сейчас указан target_expires, но нет явного subscription_id для каждой строки. Добавь в таблицу группы B колонку:
  &nbsp;
  - source_subscription_id
  - source_access_end_at
  - binding_proof = audit_v2
    Иначе остаётся риск неоднозначного источника, если у пользователя несколько подписок по продукту. Это уже проверялось в v2 как dry-run basis на 19 строк. 
  &nbsp;
4. **Audit log сделать с batch_id / remediation_run_id.**
  Не просто action='entitlement.remediated', а ещё единый batch_id, одинаковый для всех 19 записей, плюс в meta:
  &nbsp;
  - remediation_bucket
  - before_snapshot
  - after_snapshot
  - source_subscription_id или resolved_product_id_by_code
  - plan_name = PATCH-ACCESS-REMEDIATION-EXECUTE-SAFE
    Audit logging для критических операций обязателен. 
  &nbsp;
5. **Before/after/diff делать по тем же 19 ID и в том же порядке.**
  Добавь явный machine-check:
  &nbsp;
  - 15_before_remediation.csv = ровно 19 строк
  - 16_after_remediation.csv = ровно те же 19 entitlement_id
  - 17_remediation_diff.csv не содержит изменений вне полей product_id, expires_at, updated_at
    Это защищает от скрытых побочных эффектов и соответствует verify-этапу.
  &nbsp;
6. **В DoD добавить отдельную проверку на scope leakage.**
  Помимо “вне 19 ID изменено 0”, зафиксировать ещё:
  &nbsp;
  - 13 current NULL product_id → после execute должно стать **3**, и это именно deferred cb_module_*
  - classification buckets по v2 не пересчитываются и не должны использоваться как post-factum justification
    V2 явно зафиксировал safe-scope именно как 10 + 9 = 19, а 3 cb_module_* — уже новый deferred факт. 
  &nbsp;
7. **PATCH 2, PATCH 3, PATCH 4 оставить отдельными и не смешивать с PATCH 1.**
  Это уже закреплено в v2 backlog: 17 missing_entitlement, 12 illegal_bonus_access, duration-alignment backlog — отдельные follow-up категории, не для текущего execute-safe. 
8. **Формулировку про source of truth уточнить.**
  Лучше так:
  &nbsp;
  - entitlements — SoT по факту доступа;
  - для **группы B** целевой срок берётся из **validated subscription binding** из audit v2.
    Так формулировка не конфликтует с общим правилом платформы, где SoT доступа — entitlements. 
  &nbsp;

&nbsp;

&nbsp;

В остальном план собран правильно: scope жёстко ограничен, unsafe категории исключены, deferred вынесены отдельно, это соответствует v2 audit validation и правилам проверки планов.

&nbsp;

План: PATCH-ACCESS-REMEDIATION-EXECUTE-SAFE

### Основание

Audit validation v2 принят. Sanity-check 6/6 PASS. Scope зафиксирован: ровно 19 строк из `11_remediation_candidates_dry_run_v2.csv`.

### Scope — строго 19 записей

**Группа A — 10 null_product_id → SET product_id:**


| entitlement_id | product_code      | resolved_product_id                  |
| -------------- | ----------------- | ------------------------------------ |
| 81db3470       | course_close_year | 73c29914-63a3-4f4f-ac42-9f5287e58696 |
| 02755e31       | course_close_year | 73c29914-63a3-4f4f-ac42-9f5287e58696 |
| fc45e085       | course_close_year | 73c29914-63a3-4f4f-ac42-9f5287e58696 |
| 4d34bb8d       | course_close_year | 73c29914-63a3-4f4f-ac42-9f5287e58696 |
| d37fd2e8       | course_close_year | 73c29914-63a3-4f4f-ac42-9f5287e58696 |
| a57a6ba6       | course_close_year | 73c29914-63a3-4f4f-ac42-9f5287e58696 |
| 359c2767       | course_close_year | 73c29914-63a3-4f4f-ac42-9f5287e58696 |
| 46495c6c       | course_close_year | 73c29914-63a3-4f4f-ac42-9f5287e58696 |
| 4d7e34de       | buh_business      | 85046734-2282-4ded-b0d3-8c66c8f5bc2b |
| 3dbfcfb8       | buh_business      | 85046734-2282-4ded-b0d3-8c66c8f5bc2b |


**Группа B — 9 invalid_wrong_end_date → SET expires_at = subscription.access_end_at:**


| entitlement_id | product_code       | current_expires  | target_expires      | direction    |
| -------------- | ------------------ | ---------------- | ------------------- | ------------ |
| 05494f6a       | club               | 2026-04-26 12:00 | 2026-04-24 20:59:59 | decrease     |
| c20b325d       | club               | 2026-05-03 12:00 | 2026-04-30 20:59:59 | decrease     |
| 2452715d       | club               | 2026-06-17 12:00 | 2026-05-17 12:00:00 | decrease     |
| d3c3e069       | club               | 2026-05-03 12:00 | 2026-05-01 20:59:59 | decrease     |
| 55a06e2c       | club               | 2026-04-20 12:00 | 2026-04-18 21:59:59 | decrease     |
| aabeddb3       | 1769009596189-398a | 2026-04-08 17:54 | 2026-06-25 06:50:44 | **increase** |
| 02c58778       | buh_business       | 2026-05-12 18:50 | 2026-05-03 20:59:59 | decrease     |
| 80361311       | club               | 2026-05-08 12:00 | 2026-05-04 20:59:59 | decrease     |
| 40e98595       | buh_business       | 2026-05-31 06:00 | 2026-05-03 20:59:59 | decrease     |


Выравнивание по source of truth (subscription.access_end_at) допускает как увеличение, так и уменьшение expires_at.

### Явные исключения из scope

- 3 записи cb_module_* с NULL product_id — **не входят** в PATCH 1 (новый факт после v2, вынесены в deferred/discovery bucket)
- 105 valid_rule_based_bonus — не трогать
- 12 illegal_bonus_access — не трогать (PATCH 3)
- 7 bonus_access_without_parent_trace — не трогать
- 3 unknown_needs_manual_review — не трогать
- 17 missing_entitlement — не трогать (PATCH 2)

### Архитектурные guards

1. **ID-driven**: все UPDATE по точным UUID из v2 CSV. Никаких решений по email/имени/тексту
2. **Access SoT**: entitlements — источник истины по доступам; subscription.access_end_at — источник истины по срокам
3. **Audit logging**: каждое изменение → INSERT в audit_logs с action='entitlement.remediated', actor_type='system', actor_label='PATCH-ACCESS-REMEDIATION-EXECUTE-SAFE', meta содержит before/after snapshot
4. **Safe workflow**: DIAGNOSE (v1) → PLAN (v2) → DRY RUN (before CSV) → EXECUTE → VERIFY (after CSV + diff)

### Порядок выполнения

1. **Before-snapshot**: SELECT 19 entitlements по ID → `15_before_remediation.csv`
2. **Execute группа A**: UPDATE entitlements SET product_id, updated_at WHERE id IN (10 IDs) AND product_id IS NULL
3. **Execute группа B**: 9 отдельных UPDATE entitlements SET expires_at, updated_at WHERE id = '...'
4. **Audit logging**: INSERT 19 записей в audit_logs
5. **After-snapshot**: SELECT same 19 → `16_after_remediation.csv`
6. **Diff-report**: `17_remediation_diff.csv` с before/after по каждому полю
7. **Verify guard**: SELECT count(*) FROM entitlements WHERE status='active' AND product_id IS NULL → ожидаем ≤3 (cb_module_*)

### Machine-check DoD


| Проверка                                           | Ожидание |
| -------------------------------------------------- | -------- |
| Строк в dry-run до execute                         | 19/19    |
| product_id IS NOT NULL после execute (группа A)    | 10/10    |
| expires_at = subscription.access_end_at (группа B) | 9/9      |
| Записей вне 19 ID изменено                         | 0        |
| audit_logs с action='entitlement.remediated'       | 19       |
| illegal_bonus_access затронуто                     | 0        |
| bonus_access_without_parent_trace затронуто        | 0        |
| unknown_needs_manual_review затронуто              | 0        |
| missing_entitlement затронуто                      | 0        |


### Follow-up (отдельные патчи)

- **PATCH 2**: 17 missing_entitlement (discovery → dry-run → execute)
- **PATCH 3**: 12 illegal_bonus_access (manual review, auto-fix запрещён)
- **PATCH 4**: drift/duration alignment backlog (38 child > parent + 10 child < parent)
- **Deferred**: 3 cb_module_* с NULL product_id (новый discovery после v2)

### Технические детали

- Python-скрипт через code--exec
- Database migration tool для UPDATE-запросов
- Все артефакты в `/mnt/documents/access_audit/`
- Все тексты на русском