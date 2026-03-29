# План: Универсальная система offer-driven fulfillment + platform access grants (v22)

## Принятые правки v22

| # | Правка |
|---|--------|
| 1 | Cross-field DB-guard: `action_type='batch_start' ↔ target_type='batch'` (и наоборот) |
| 2 | Симметричный guard: parent_event_key и parent_execution_key — оба NULL или оба NOT NULL |
| 3 | Subject-contract: хотя бы один из 5 source-полей обязателен |
| 4 | Machine-check для result.post_check по action_type в p0_invariant_report.txt |

Все правки v1–v21 сохранены.

---

## Изменение 1 (v22): chk_batch_row_contract

```sql
ADD CONSTRAINT chk_batch_row_contract CHECK (
  (action_type = 'batch_start' AND target_type = 'batch')
  OR
  (action_type <> 'batch_start' AND target_type <> 'batch')
);
```

Предотвращает невалидные строки вида `target_type='batch', action_type='grant'`.

---

## Изменение 2 (v22): chk_parent_keys_pair

```sql
ADD CONSTRAINT chk_parent_keys_pair CHECK (
  (parent_event_key IS NULL AND parent_execution_key IS NULL)
  OR
  (parent_event_key IS NOT NULL AND parent_execution_key IS NOT NULL)
);
```

Downstream-контракт защищён схемой, а не только proof-запросом.

---

## Изменение 3 (v22): chk_has_subject

```sql
ADD CONSTRAINT chk_has_subject CHECK (
  order_id IS NOT NULL
  OR source_order_id IS NOT NULL
  OR source_subscription_id IS NOT NULL
  OR source_offer_id IS NOT NULL
  OR source_subject_ref IS NOT NULL
);
```

Каждая ledger-строка трассируется к конкретному источнику.

---

## Изменение 4 (v22): Machine-check для result.post_check

Не CHECK constraint, а verify-блок в p0_invariant_report.txt:

```sql
-- grant/extend/reactivate → post_check обязателен
SELECT count(*) FILTER (WHERE action_type IN ('grant','extend','reactivate') AND status NOT IN ('failed','skipped') AND result->'post_check' IS NULL) as missing_post_check
FROM access_grant_ledger
WHERE created_at >= (watermark);
-- missing_post_check = 0 → PASS

-- batch_start → post_check IS NULL
SELECT count(*) FILTER (WHERE action_type = 'batch_start' AND result->'post_check' IS NOT NULL) as unexpected_post_check
FROM access_grant_ledger
WHERE created_at >= (watermark);
-- unexpected_post_check = 0 → PASS
```

---

## Полный DDL access_grant_ledger (v18 + v19 + v20 + v21 + v22)

```sql
CREATE TABLE public.access_grant_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Event identity
  source_event_key TEXT NOT NULL,
  execution_key TEXT NOT NULL DEFAULT gen_random_uuid()::text,

  -- Lineage
  parent_event_key TEXT,
  parent_execution_key TEXT,

  -- Action
  action_type TEXT NOT NULL,
  status TEXT NOT NULL,
  reason_code TEXT NOT NULL,

  -- Source context
  source_event_type TEXT NOT NULL,
  source_subject_type TEXT NOT NULL,
  source_subject_ref TEXT,

  -- Target
  target_type TEXT NOT NULL,
  target_key TEXT NOT NULL,
  target_ref UUID,

  -- Actors
  user_id UUID,
  profile_id UUID,

  -- Source references
  order_id UUID,
  source_order_id UUID,
  source_subscription_id UUID,
  source_offer_id UUID,

  -- Result
  result JSONB,
  error_details JSONB,

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- === CHECK CONSTRAINTS ===

  -- v19: dictionary constraints
  CONSTRAINT chk_action_type CHECK (
    action_type IN ('grant','extend','revoke','expire','reactivate','skip','batch_start')
  ),
  CONSTRAINT chk_status CHECK (
    status IN ('granted','extended','skipped','failed','revoked','expired','reactivated','completed')
  ),
  CONSTRAINT chk_source_event_type CHECK (
    source_event_type IN ('webhook','cron','admin','manual','system','rule_engine')
  ),
  CONSTRAINT chk_source_subject_type CHECK (
    source_subject_type IN ('order','subscription','admin_action','import_batch','cron_job','system','rule_engine_trigger')
  ),

  -- v20: expanded target_type for future phases
  CONSTRAINT chk_target_type CHECK (
    target_type IN ('product','club','training_module','feature','batch','domain','menu_item','training_lesson','subscription_tier')
  ),

  -- v21: reason_code dictionary
  CONSTRAINT chk_reason_code CHECK (
    reason_code IN (
      'paid_order','trial_start','subscription_renew','subscription_extend',
      'admin_grant','bulk_import','rule_engine_bonus',
      'payment_failed','trial_expired','admin_cancel','subscription_expired',
      'admin_revoke','cron_cleanup','violation_kick',
      'duplicate_skip','already_active','no_matching_target',
      'batch_orchestration'
    )
  ),

  -- v21: action_type ↔ status cross-field guard
  CONSTRAINT chk_action_status_compat CHECK (
    CASE action_type
      WHEN 'grant'       THEN status IN ('granted','failed','skipped')
      WHEN 'extend'      THEN status IN ('extended','failed','skipped')
      WHEN 'revoke'      THEN status IN ('revoked','failed','skipped')
      WHEN 'expire'      THEN status IN ('expired','failed','skipped')
      WHEN 'reactivate'  THEN status IN ('reactivated','failed','skipped')
      WHEN 'skip'        THEN status IN ('skipped')
      WHEN 'batch_start' THEN status IN ('completed','failed')
      ELSE false
    END
  ),

  -- v22: batch row ↔ batch action symmetry
  CONSTRAINT chk_batch_row_contract CHECK (
    (action_type = 'batch_start' AND target_type = 'batch')
    OR
    (action_type <> 'batch_start' AND target_type <> 'batch')
  ),

  -- v22: parent keys pair (both or neither)
  CONSTRAINT chk_parent_keys_pair CHECK (
    (parent_event_key IS NULL AND parent_execution_key IS NULL)
    OR
    (parent_event_key IS NOT NULL AND parent_execution_key IS NOT NULL)
  ),

  -- v22: at least one subject reference
  CONSTRAINT chk_has_subject CHECK (
    order_id IS NOT NULL
    OR source_order_id IS NOT NULL
    OR source_subscription_id IS NOT NULL
    OR source_offer_id IS NOT NULL
    OR source_subject_ref IS NOT NULL
  )
);

-- Indexes
CREATE INDEX idx_ledger_source_event_key ON public.access_grant_ledger (source_event_key);
CREATE INDEX idx_ledger_execution_key ON public.access_grant_ledger (execution_key);
CREATE INDEX idx_ledger_profile_id ON public.access_grant_ledger (profile_id);
CREATE INDEX idx_ledger_order_id ON public.access_grant_ledger (order_id);
CREATE INDEX idx_ledger_target ON public.access_grant_ledger (target_type, target_key);
CREATE INDEX idx_ledger_created_at ON public.access_grant_ledger (created_at);
CREATE INDEX idx_ledger_action_status ON public.access_grant_ledger (action_type, status);

-- v21: Foreign keys
ALTER TABLE public.access_grant_ledger
  ADD CONSTRAINT fk_ledger_order FOREIGN KEY (order_id) REFERENCES orders_v2(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_ledger_source_order FOREIGN KEY (source_order_id) REFERENCES orders_v2(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_ledger_source_subscription FOREIGN KEY (source_subscription_id) REFERENCES subscriptions_v2(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_ledger_source_offer FOREIGN KEY (source_offer_id) REFERENCES tariff_offers(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_ledger_profile FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- RLS
ALTER TABLE public.access_grant_ledger ENABLE ROW LEVEL SECURITY;

-- v21: Watermark (safe idempotent)
INSERT INTO app_settings (key, value)
VALUES ('system', jsonb_build_object('phase1_ledger_enabled_at', now()::text))
ON CONFLICT (key) DO UPDATE
SET value = CASE
  WHEN NOT (COALESCE(app_settings.value, '{}'::jsonb) ? 'phase1_ledger_enabled_at')
  THEN jsonb_set(COALESCE(app_settings.value, '{}'::jsonb), '{phase1_ledger_enabled_at}', to_jsonb(now()::text))
  ELSE app_settings.value
END;
```

---

## Обновлённый DoD (v22, 76 инвариантов)

К 72 инвариантам v21 добавлены:

- **73**: `chk_batch_row_contract` — `action_type='batch_start' ↔ target_type='batch'` симметрия. Невалидные комбинации невозможны.
- **74**: `chk_parent_keys_pair` — parent_event_key и parent_execution_key всегда оба NULL или оба NOT NULL.
- **75**: `chk_has_subject` — каждая ledger-строка имеет хотя бы один source reference.
- **76**: Machine-check в p0_invariant_report.txt: grant/extend/reactivate (non-failed/skipped) → post_check обязателен; batch_start → post_check IS NULL.

---

## Proof-артефакты (11 файлов, без изменений в количестве)

В `p0_invariant_report.txt` добавлен verify-блок для post_check по action_type.

---

## Порядок реализации (обновлённый)

Phase 0 + Phase 1:
1. Создать `access_grant_ledger` по полному DDL v18 + v19 + v20 + v21 + **v22 constraints**
2. Записать deploy watermark через INSERT ... ON CONFLICT с guard
3. Убрать hardcode из 8 live файлов
4. Обернуть **4 grant-path группы** в FulfillmentExecutor
5. Обернуть **2 downstream paths** с parent propagation
6. Обернуть **7 revoke-paths** в AccessRevoker
7. Для batch/import: трёхуровневая структура
8. `resolveAccessWindow()`, merge effective windows, запись в `result JSONB`
9. P0 invariant report, **6 proof-артефактов** с single-row lineage proof + post_check machine-check

---

## Контракт result JSONB по action_type (v20)

### grant / extend / reactivate
- `access_start`, `access_end`, `window_days`, `source_window_rule` — ОБЯЗАТЕЛЬНО
- `previous_end` (для extend) — nullable
- `post_check` — ОБЯЗАТЕЛЬНО (5 проверок: `{applicability, status, details, ref}`)

### revoke / expire
- `revoked_from`, `previous_access_end`, `reconcile_basis`, `other_active_sources_checked`, `kept_projections` — ОБЯЗАТЕЛЬНО

### skip
- `skip_reason`, `existing_ref` — ОБЯЗАТЕЛЬНО/nullable

### failed
- `failed_at_step`, `error_message` — ОБЯЗАТЕЛЬНО
- `error_details` — отдельная колонка JSONB

### batch_start
- `batch_size`, `source_file`, `import_type` — nullable
- `result` может быть NULL

---

## Контракт result.post_check (v20 нормализованный)

```jsonb
{
  "applicability": "required | not_applicable",
  "status": "pass | warn | fail | null",
  "details": "...",
  "ref": "..."
}
```

- `not_applicable` → `status = null`
- `required` → `status` обязателен

---

## user_id — решение Phase 1 (v21)

FK на auth.users(id) не ставится. Причины:
1. auth.users — reserved Supabase schema
2. profiles.id — канонический proxy
3. Ghost grants используют placeholder

---

## Lineage proof (v21 + v22)

Single-row parent match + chk_parent_keys_pair:
```sql
SELECT count(*) FILTER (WHERE EXISTS (
  SELECT 1 FROM access_grant_ledger p
  WHERE p.source_event_key = l.parent_event_key
    AND p.execution_key = l.parent_execution_key
)) as parent_single_row_match
FROM access_grant_ledger l
WHERE target_type != 'batch' AND parent_event_key IS NOT NULL;
```

---

## Watermark coverage proof (v19 + v21)

Два раздела:
- Section A: access events (target_type != 'batch')
- Section B: meta/batch events (target_type = 'batch')
