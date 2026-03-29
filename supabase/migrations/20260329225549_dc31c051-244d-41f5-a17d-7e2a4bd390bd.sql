-- access_grant_ledger v22: full DDL with all constraints
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

  -- v20: expanded target_type
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

-- RLS policy: only service role can read/write (no anon/authenticated access)
CREATE POLICY "Service role full access" ON public.access_grant_ledger
  FOR ALL USING (auth.role() = 'service_role');

-- v21: Deploy watermark (safe idempotent)
INSERT INTO app_settings (key, value)
VALUES ('system', jsonb_build_object('phase1_ledger_enabled_at', now()::text))
ON CONFLICT (key) DO UPDATE
SET value = CASE
  WHEN NOT (COALESCE(app_settings.value, '{}'::jsonb) ? 'phase1_ledger_enabled_at')
  THEN jsonb_set(COALESCE(app_settings.value, '{}'::jsonb), '{phase1_ledger_enabled_at}', to_jsonb(now()::text))
  ELSE app_settings.value
END;