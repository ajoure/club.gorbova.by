
-- ============================================
-- VOCHI Phase 1 — DB skeleton
-- Tables: integration_credentials, calls, call_events, call_sync_queue
-- Tenancy: workspace_id column reserved (NULL allowed; матчит pattern crm_tasks).
-- RLS: staff-gate через has_role_v2 (employee/admin/super_admin), service_role bypass.
-- ============================================

-- ---------- ENUMS ----------
DO $$ BEGIN
  CREATE TYPE public.call_direction AS ENUM ('inbound','outbound');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.call_status AS ENUM (
    'queued','ringing','answered','no_answer','busy','failed','completed','voicemail','cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.call_link_status AS ENUM ('unresolved','linked','manual','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- 1) integration_credentials ----------
CREATE TABLE IF NOT EXISTS public.integration_credentials (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid,
  provider        text NOT NULL,
  display_name    text,
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,    -- non-secret: endpoint, clientId, webhook URL
  secrets         jsonb NOT NULL DEFAULT '{}'::jsonb,    -- secrets (server-only via RLS)
  status          text NOT NULL DEFAULT 'inactive',      -- inactive|active|error
  last_error      text,
  last_checked_at timestamptz,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_credentials_ws_provider_uniq UNIQUE (workspace_id, provider)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_credentials TO authenticated;
GRANT ALL ON public.integration_credentials TO service_role;

ALTER TABLE public.integration_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY integration_credentials_admin_select ON public.integration_credentials
  FOR SELECT TO authenticated
  USING (public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin'));
CREATE POLICY integration_credentials_admin_insert ON public.integration_credentials
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin'));
CREATE POLICY integration_credentials_admin_update ON public.integration_credentials
  FOR UPDATE TO authenticated
  USING (public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin'));
CREATE POLICY integration_credentials_admin_delete ON public.integration_credentials
  FOR DELETE TO authenticated
  USING (public.has_role_v2(auth.uid(),'super_admin'));

CREATE TRIGGER trg_integration_credentials_updated_at
  BEFORE UPDATE ON public.integration_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- 2) calls ----------
-- Register public_id sequence (idempotent)
INSERT INTO public.public_id_sequences (entity_type, prefix, last_value)
VALUES ('call', 'CALL', 0)
ON CONFLICT (entity_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.calls (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id           text UNIQUE,
  workspace_id        uuid,

  provider            text NOT NULL DEFAULT 'vochi',
  external_call_id    text NOT NULL,
  direction           public.call_direction NOT NULL,
  status              public.call_status NOT NULL DEFAULT 'queued',
  link_status         public.call_link_status NOT NULL DEFAULT 'unresolved',

  contact_id          uuid,
  deal_id             uuid,
  manager_user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  phone_from_raw      text,
  phone_from_e164     text,
  phone_to_raw        text,
  phone_to_e164       text,

  started_at          timestamptz,
  answered_at         timestamptz,
  ended_at            timestamptz,
  duration_seconds    integer GENERATED ALWAYS AS (
    CASE WHEN answered_at IS NOT NULL AND ended_at IS NOT NULL
         THEN GREATEST(0, EXTRACT(EPOCH FROM (ended_at - answered_at))::int)
         ELSE NULL END
  ) STORED,

  recording_provider  text,
  recording_url       text,
  recording_ready_at  timestamptz,
  recording_stored    boolean NOT NULL DEFAULT false,

  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT calls_provider_extid_uniq UNIQUE (provider, external_call_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.calls TO authenticated;
GRANT ALL ON public.calls TO service_role;

ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY calls_staff_read ON public.calls FOR SELECT TO authenticated
  USING (public.has_role_v2(auth.uid(),'employee') OR public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin'));
CREATE POLICY calls_staff_insert ON public.calls FOR INSERT TO authenticated
  WITH CHECK (public.has_role_v2(auth.uid(),'employee') OR public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin'));
CREATE POLICY calls_staff_update ON public.calls FOR UPDATE TO authenticated
  USING (public.has_role_v2(auth.uid(),'employee') OR public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role_v2(auth.uid(),'employee') OR public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin'));
CREATE POLICY calls_admin_delete ON public.calls FOR DELETE TO authenticated
  USING (public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin'));

CREATE INDEX IF NOT EXISTS calls_workspace_started_idx ON public.calls (workspace_id, started_at DESC);
CREATE INDEX IF NOT EXISTS calls_contact_started_idx  ON public.calls (contact_id, started_at DESC) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS calls_deal_started_idx     ON public.calls (deal_id, started_at DESC) WHERE deal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS calls_manager_started_idx  ON public.calls (manager_user_id, started_at DESC) WHERE manager_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS calls_phone_from_idx       ON public.calls (phone_from_e164) WHERE phone_from_e164 IS NOT NULL;
CREATE INDEX IF NOT EXISTS calls_phone_to_idx         ON public.calls (phone_to_e164)   WHERE phone_to_e164   IS NOT NULL;
CREATE INDEX IF NOT EXISTS calls_link_status_idx      ON public.calls (link_status) WHERE link_status = 'unresolved';

CREATE TRIGGER trg_calls_updated_at
  BEFORE UPDATE ON public.calls
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Public ID trigger
CREATE OR REPLACE FUNCTION public.set_call_public_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    NEW.public_id := public.next_public_id('call');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_calls_set_public_id
  BEFORE INSERT ON public.calls
  FOR EACH ROW EXECUTE FUNCTION public.set_call_public_id();

-- ---------- 3) call_events ----------
CREATE TABLE IF NOT EXISTS public.call_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid,
  call_id       uuid REFERENCES public.calls(id) ON DELETE CASCADE,
  provider      text NOT NULL DEFAULT 'vochi',
  external_call_id text,                                  -- для событий до создания row calls
  event_type    text NOT NULL,                            -- call.started|call.ringing|call.answered|call.ended|call.recorded|...
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  signature_ok  boolean,
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  process_error text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_events TO authenticated;
GRANT ALL ON public.call_events TO service_role;

ALTER TABLE public.call_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY call_events_admin_read ON public.call_events FOR SELECT TO authenticated
  USING (public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin'));
-- INSERT/UPDATE — только service_role (edge function), authenticated не пишет.

CREATE INDEX IF NOT EXISTS call_events_call_idx        ON public.call_events (call_id, received_at DESC);
CREATE INDEX IF NOT EXISTS call_events_extid_idx       ON public.call_events (provider, external_call_id) WHERE external_call_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS call_events_unprocessed_idx ON public.call_events (received_at) WHERE processed_at IS NULL;

-- ---------- 4) call_sync_queue ----------
CREATE TABLE IF NOT EXISTS public.call_sync_queue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid,
  provider      text NOT NULL DEFAULT 'vochi',
  job_type      text NOT NULL,                            -- recording_fetch|call_resolve|cdr_sync|...
  dedupe_key    text NOT NULL,                            -- стабильный ключ (например: 'recording:<external_call_id>')
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts      integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 8,
  next_run_at   timestamptz NOT NULL DEFAULT now(),
  done          boolean NOT NULL DEFAULT false,
  done_at       timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_sync_queue_dedupe_uniq UNIQUE (provider, job_type, dedupe_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_sync_queue TO authenticated;
GRANT ALL ON public.call_sync_queue TO service_role;

ALTER TABLE public.call_sync_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY call_sync_queue_admin_read ON public.call_sync_queue FOR SELECT TO authenticated
  USING (public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin'));
-- INSERT/UPDATE/DELETE — только service_role.

CREATE INDEX IF NOT EXISTS call_sync_queue_pending_idx
  ON public.call_sync_queue (workspace_id, done, next_run_at)
  WHERE done = false;

CREATE TRIGGER trg_call_sync_queue_updated_at
  BEFORE UPDATE ON public.call_sync_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
