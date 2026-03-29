# Да, согласен, с учетом правок:

&nbsp;

1. Добавь ещё один cross-field DB-guard для batch-строк.  
Сейчас action_type='batch_start' и target_type='batch' описаны логически, но это лучше зафиксировать в БД явно:

&nbsp;

ADD CONSTRAINT chk_batch_row_contract CHECK (

  (action_type = 'batch_start' AND target_type = 'batch')

  OR

  (action_type <> 'batch_start' AND target_type <> 'batch')

);

&nbsp;

1. Иначе можно случайно получить невалидные строки вида target_type='batch', action_type='grant'.
2. Добавь симметричный guard для parent-полей.  
Сейчас lineage proof хороший, но сама таблица ещё допускает полусломанные строки, где заполнен только один parent:

&nbsp;

ADD CONSTRAINT chk_parent_keys_pair CHECK (

  (parent_event_key IS NULL AND parent_execution_key IS NULL)

  OR

  (parent_event_key IS NOT NULL AND parent_execution_key IS NOT NULL)

);

&nbsp;

2. Это важно, чтобы downstream-контракт был защищён не только proof-запросом, но и самой схемой.
3. Добавь минимальный subject-contract, чтобы ledger-строка не была “без источника”.  
Нужен CHECK, что у записи есть хотя бы один реальный источник:

&nbsp;

ADD CONSTRAINT chk_has_subject CHECK (

  order_id IS NOT NULL

  OR source_order_id IS NOT NULL

  OR source_subscription_id IS NOT NULL

  OR source_offer_id IS NOT NULL

  OR source_subject_ref IS NOT NULL

);

&nbsp;

3. Иначе таблица позволит audit-строки, которые невозможно будет трассировать назад.
4. Сделай machine-check для [result.post](http://result.post)_check по action_type.  
Сейчас контракт описан текстом, но лучше зафиксировать хотя бы на уровне validate-query/proof:  

  - grant / extend / reactivate → [result.post](http://result.post)_check обязателен
  - batch_start → [result.post](http://result.post)_check IS NULL
  - revoke / expire / skip / failed → [result.post](http://result.post)_check допускается только если это явно оговорено, иначе NULL
5.   
Не обязательно CHECK constraint, но как минимум отдельный verify-блок в p0_invariant_report.txt, чтобы подрядчик не “забыл” писать post_check в боевых grant-строках.

&nbsp;

&nbsp;

После этих 4 правок план уже можно считать финальным и достаточно жёстким для исполнения без дальнейшего расползания.

&nbsp;

План: Универсальная система offer-driven fulfillment + platform access grants (v21)

## Принятые правки v21


| #   | Правка                                                                                              |
| --- | --------------------------------------------------------------------------------------------------- |
| 1   | CHECK constraint для `reason_code` + cross-field guard `action_type ↔ status`                       |
| 2   | Lineage proof: parent валиден только если **одна строка** удовлетворяет обоим условиям одновременно |
| 3   | FK на существующие таблицы с `ON DELETE SET NULL` + явное решение по `user_id`                      |


Все правки v1–v20 сохранены.

---

## Изменение 1: CHECK для reason_code + action_type ↔ status guard

### reason_code CHECK

```sql
ALTER TABLE access_grant_ledger
  ADD CONSTRAINT chk_reason_code CHECK (
    reason_code IN (
      'paid_order', 'trial_start', 'subscription_renew', 'subscription_extend',
      'admin_grant', 'bulk_import', 'rule_engine_bonus',
      'payment_failed', 'trial_expired', 'admin_cancel', 'subscription_expired',
      'admin_revoke', 'cron_cleanup', 'violation_kick',
      'duplicate_skip', 'already_active', 'no_matching_target',
      'batch_orchestration'
    )
  );
```

### action_type ↔ status cross-field guard

```sql
ALTER TABLE access_grant_ledger
  ADD CONSTRAINT chk_action_status_compat CHECK (
    CASE action_type
      WHEN 'grant'       THEN status IN ('granted', 'failed', 'skipped')
      WHEN 'extend'      THEN status IN ('extended', 'failed', 'skipped')
      WHEN 'revoke'      THEN status IN ('revoked', 'failed', 'skipped')
      WHEN 'expire'      THEN status IN ('expired', 'failed', 'skipped')
      WHEN 'reactivate'  THEN status IN ('reactivated', 'failed', 'skipped')
      WHEN 'skip'        THEN status IN ('skipped')
      WHEN 'batch_start' THEN status IN ('completed', 'failed')
      ELSE false
    END
  );
```

Мусорные комбинации (`action_type='grant', status='expired'` и т.п.) теперь невозможны на уровне БД.

---

## Изменение 2: Lineage proof — single-row parent match

Текущая проверка (два отдельных EXISTS) заменяется на **один EXISTS с двумя условиями**:

```sql
-- Валидный parent: одна строка p, где оба поля совпадают одновременно
SELECT
  count(*) as total_downstream,
  count(*) FILTER (WHERE parent_event_key IS NOT NULL AND parent_execution_key IS NOT NULL) as has_both_parent_fields,
  count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM access_grant_ledger p
    WHERE p.source_event_key = l.parent_event_key
      AND p.execution_key   = l.parent_execution_key
  )) as parent_single_row_match
FROM access_grant_ledger l
WHERE target_type != 'batch'
  AND parent_event_key IS NOT NULL
  AND created_at >= (watermark);

-- orphan = total_downstream - parent_single_row_match
```

В `p0_ledger_watermark_coverage_proof.txt` секция A2 обновлена:

```text
#### A2: DOWNSTREAM PATHS (single-row parent match)
| # | path | expected | ledger_rows | has_both_parent_fields | parent_single_row_match | orphan | status |
|---|------|----------|-------------|----------------------|------------------------|--------|--------|
| 7 | telegram-grant-access | 95 | 95 | 95 | 95 | 0 | PASS |
| 8 | telegram-process-access-queue | 30 | 30 | 30 | 30 | 0 | PASS |
```

orphan > 0 по любому path = Phase 1 DoD не выполнен.

---

## Изменение 3: FK на существующие таблицы

```sql
ALTER TABLE access_grant_ledger
  ADD CONSTRAINT fk_ledger_order
    FOREIGN KEY (order_id) REFERENCES orders_v2(id) ON DELETE SET NULL,

  ADD CONSTRAINT fk_ledger_source_order
    FOREIGN KEY (source_order_id) REFERENCES orders_v2(id) ON DELETE SET NULL,

  ADD CONSTRAINT fk_ledger_source_subscription
    FOREIGN KEY (source_subscription_id) REFERENCES subscriptions_v2(id) ON DELETE SET NULL,

  ADD CONSTRAINT fk_ledger_source_offer
    FOREIGN KEY (source_offer_id) REFERENCES tariff_offers(id) ON DELETE SET NULL,

  ADD CONSTRAINT fk_ledger_profile
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL;
```

### user_id — решение для Phase 1

`user_id` **не получает FK на `auth.users(id)**` в Phase 1. Причины:

1. `auth.users` — reserved Supabase schema, прямые FK из public-схемы не рекомендованы и могут вызвать проблемы при restore/migration
2. `profiles.id` уже является каноническим proxy для `auth.users.id` в проекте (profiles.id = auth.users.id by convention)
3. Ghost grants используют `user_id = profile_id` placeholder — FK на auth.users сломает этот паттерн

Вместо FK гарантия целостности user_id обеспечивается:

- `fk_ledger_profile` покрывает связь с пользователем через `profile_id`
- `user_id` остаётся informational/nullable, без FK
- В Phase 2 при необходимости можно добавить FK на `profiles(id)` для `user_id` отдельной миграцией

---

## Обновлённый DoD (v21, 72 инварианта)

К 69 инвариантам v20 добавлены:

- **70**: `reason_code` защищён CHECK constraint на уровне БД. Произвольные коды невозможны без миграции.
- **71**: `action_type ↔ status` защищены cross-field CHECK constraint. Мусорные комбинации невозможны.
- **72**: FK на `orders_v2`, `subscriptions_v2`, `tariff_offers`, `profiles` с `ON DELETE SET NULL`. `user_id` без FK (решение задокументировано, proxy через `profile_id`).

Lineage proof усилен: parent валиден только при single-row match по обоим полям одновременно.

---

## Proof-артефакты (11 файлов, без изменений в количестве)

Формат `p0_ledger_watermark_coverage_proof.txt` секция A2 обновлён на single-row parent match.

---

## Порядок реализации (обновлённый)

Phase 0 + Phase 1:

1. Создать `access_grant_ledger` по полному DDL v18 + CHECK constraints v19/v20 + **reason_code CHECK v21** + **action_type↔status guard v21** + **FK v21**
2. Записать deploy watermark через INSERT ... ON CONFLICT с guard
3. Убрать hardcode из 8 live файлов
4. Обернуть **4 grant-path группы** в FulfillmentExecutor
5. Обернуть **2 downstream paths** с parent propagation
6. Обернуть **7 revoke-paths** в AccessRevoker
7. Для batch/import: трёхуровневая структура
8. `resolveAccessWindow()`, merge effective windows, запись в `result JSONB`
9. P0 invariant report, **6 proof-артефактов** с single-row lineage proof