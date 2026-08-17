-- Broadcast analytics v1
-- Canonical chain: campaign -> run -> delivery -> event -> orders_v2/payments_v2.
-- Financial facts stay in orders_v2/payments_v2; this migration stores only
-- communication evidence and computes attribution from those canonical facts.

-- -----------------------------------------------------------------------------
-- 1. Campaigns and delivery journal
-- -----------------------------------------------------------------------------

CREATE TABLE public.broadcast_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid REFERENCES public.broadcast_templates(id) ON DELETE SET NULL,
  name text NOT NULL,
  source text NOT NULL DEFAULT 'contact_center'
    CHECK (source IN ('contact_center', 'scheduled_dispatcher', 'automation', 'system', 'historical')),
  send_mode text NOT NULL DEFAULT 'manual'
    CHECK (send_mode IN ('manual', 'scheduled', 'recurring', 'event', 'test', 'historical')),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('draft', 'running', 'completed', 'partial', 'failed', 'cancelled')),
  channels text[] NOT NULL DEFAULT ARRAY['telegram']::text[],
  audience_filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  audience_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  attribution_window_days integer NOT NULL DEFAULT 30
    CHECK (attribution_window_days BETWEEN 1 AND 90),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT broadcast_campaigns_channels_check CHECK (
    cardinality(channels) > 0
    AND channels <@ ARRAY['telegram', 'email']::text[]
  )
);

CREATE INDEX broadcast_campaigns_started_idx
  ON public.broadcast_campaigns(started_at DESC);
CREATE INDEX broadcast_campaigns_status_started_idx
  ON public.broadcast_campaigns(status, started_at DESC);
CREATE INDEX broadcast_campaigns_template_idx
  ON public.broadcast_campaigns(template_id, started_at DESC)
  WHERE template_id IS NOT NULL;

ALTER TABLE public.broadcast_runs
  ALTER COLUMN template_id DROP NOT NULL;

ALTER TABLE public.broadcast_runs
  DROP CONSTRAINT IF EXISTS broadcast_runs_template_id_fkey;

ALTER TABLE public.broadcast_runs
  ADD CONSTRAINT broadcast_runs_template_id_fkey
  FOREIGN KEY (template_id) REFERENCES public.broadcast_templates(id) ON DELETE SET NULL;

ALTER TABLE public.broadcast_runs
  ADD COLUMN campaign_id uuid REFERENCES public.broadcast_campaigns(id) ON DELETE CASCADE,
  ADD COLUMN accepted_count integer NOT NULL DEFAULT 0,
  ADD COLUMN delivered_count integer NOT NULL DEFAULT 0,
  ADD COLUMN opened_count integer NOT NULL DEFAULT 0,
  ADD COLUMN clicked_count integer NOT NULL DEFAULT 0,
  ADD COLUMN reply_count integer NOT NULL DEFAULT 0;

CREATE INDEX broadcast_runs_campaign_started_idx
  ON public.broadcast_runs(campaign_id, started_at DESC)
  WHERE campaign_id IS NOT NULL;

CREATE TABLE public.broadcast_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.broadcast_campaigns(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.broadcast_runs(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_id uuid,
  channel text NOT NULL CHECK (channel IN ('telegram', 'email')),
  recipient_key text NOT NULL,
  bot_id uuid REFERENCES public.telegram_bots(id) ON DELETE SET NULL,
  email_log_id uuid REFERENCES public.email_logs(id) ON DELETE SET NULL,
  telegram_message_id uuid REFERENCES public.telegram_messages(id) ON DELETE SET NULL,
  provider text,
  provider_message_id text,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'accepted', 'sent', 'delivered', 'failed', 'bounced', 'skipped')),
  queued_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  first_opened_at timestamptz,
  first_clicked_at timestamptz,
  first_replied_at timestamptz,
  open_count integer NOT NULL DEFAULT 0,
  click_count integer NOT NULL DEFAULT 0,
  error_code text,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, recipient_key)
);

CREATE INDEX broadcast_deliveries_campaign_idx
  ON public.broadcast_deliveries(campaign_id, created_at DESC);
CREATE INDEX broadcast_deliveries_run_status_idx
  ON public.broadcast_deliveries(run_id, status);
CREATE INDEX broadcast_deliveries_profile_time_idx
  ON public.broadcast_deliveries(profile_id, accepted_at DESC)
  WHERE profile_id IS NOT NULL;
CREATE INDEX broadcast_deliveries_user_time_idx
  ON public.broadcast_deliveries(user_id, accepted_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX broadcast_deliveries_profile_evidence_idx
  ON public.broadcast_deliveries(profile_id, (COALESCE(accepted_at, created_at)) DESC)
  WHERE profile_id IS NOT NULL;
CREATE INDEX broadcast_deliveries_user_evidence_idx
  ON public.broadcast_deliveries(user_id, (COALESCE(accepted_at, created_at)) DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX broadcast_deliveries_clicked_idx
  ON public.broadcast_deliveries(first_clicked_at DESC)
  WHERE first_clicked_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_v2_profile_effective_paid_idx
  ON public.payments_v2(profile_id, (COALESCE(paid_at, created_at)))
  WHERE profile_id IS NOT NULL AND NOT is_deleted AND amount > 0;
CREATE INDEX IF NOT EXISTS payments_v2_user_effective_paid_idx
  ON public.payments_v2(user_id, (COALESCE(paid_at, created_at)))
  WHERE user_id IS NOT NULL AND NOT is_deleted AND amount > 0;

CREATE TABLE public.broadcast_delivery_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES public.broadcast_deliveries(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products_v2(id) ON DELETE SET NULL,
  tariff_id uuid REFERENCES public.tariffs(id) ON DELETE SET NULL,
  access_mode text NOT NULL CHECK (access_mode IN ('purchased', 'active_access')),
  source_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX broadcast_delivery_segments_unique_idx
  ON public.broadcast_delivery_segments(
    delivery_id,
    COALESCE(product_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(tariff_id, '00000000-0000-0000-0000-000000000000'::uuid),
    access_mode
  );
CREATE INDEX broadcast_delivery_segments_product_tariff_idx
  ON public.broadcast_delivery_segments(product_id, tariff_id, delivery_id);

-- One logical URL per campaign/channel. Recipient-specific opaque tokens are
-- stored separately so URLs never contain profile ids, emails or phone numbers.
CREATE TABLE public.broadcast_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.broadcast_campaigns(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('telegram', 'email')),
  original_url text NOT NULL,
  label text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, channel, original_url)
);

CREATE INDEX broadcast_links_campaign_idx
  ON public.broadcast_links(campaign_id, channel, position);

CREATE TABLE public.broadcast_tracking_tokens (
  token uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES public.broadcast_deliveries(id) ON DELETE CASCADE,
  link_id uuid REFERENCES public.broadcast_links(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('open', 'click')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '180 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT broadcast_tracking_tokens_shape_check CHECK (
    (purpose = 'open' AND link_id IS NULL)
    OR (purpose = 'click' AND link_id IS NOT NULL)
  ),
  UNIQUE (delivery_id, link_id, purpose)
);

CREATE INDEX broadcast_tracking_tokens_delivery_idx
  ON public.broadcast_tracking_tokens(delivery_id);
CREATE UNIQUE INDEX broadcast_tracking_tokens_open_unique_idx
  ON public.broadcast_tracking_tokens(delivery_id, purpose)
  WHERE purpose = 'open';
CREATE UNIQUE INDEX broadcast_tracking_tokens_click_unique_idx
  ON public.broadcast_tracking_tokens(delivery_id, link_id, purpose)
  WHERE purpose = 'click';

CREATE TABLE public.broadcast_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.broadcast_campaigns(id) ON DELETE CASCADE,
  delivery_id uuid NOT NULL REFERENCES public.broadcast_deliveries(id) ON DELETE CASCADE,
  link_id uuid REFERENCES public.broadcast_links(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'queued', 'accepted', 'delivered', 'open_signal', 'click', 'reply',
    'reaction', 'failed', 'bounced', 'spam', 'unsubscribe'
  )),
  source text NOT NULL DEFAULT 'system'
    CHECK (source IN ('system', 'smtp', 'provider_webhook', 'tracking', 'telegram', 'contact_center')),
  provider_event_id text,
  event_key text NOT NULL,
  is_machine boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_key)
);

CREATE INDEX broadcast_events_campaign_time_idx
  ON public.broadcast_events(campaign_id, occurred_at DESC);
CREATE INDEX broadcast_events_delivery_type_idx
  ON public.broadcast_events(delivery_id, event_type, occurred_at DESC);
CREATE INDEX broadcast_events_link_type_idx
  ON public.broadcast_events(link_id, event_type, occurred_at DESC)
  WHERE link_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. RLS and grants
-- -----------------------------------------------------------------------------

ALTER TABLE public.broadcast_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_delivery_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_tracking_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY broadcast_campaigns_contact_center_view
  ON public.broadcast_campaigns FOR SELECT TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'communication', 'view'));
CREATE POLICY broadcast_deliveries_contact_center_view
  ON public.broadcast_deliveries FOR SELECT TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'communication', 'view'));
CREATE POLICY broadcast_delivery_segments_contact_center_view
  ON public.broadcast_delivery_segments FOR SELECT TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'communication', 'view'));
CREATE POLICY broadcast_links_contact_center_view
  ON public.broadcast_links FOR SELECT TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'communication', 'view'));
CREATE POLICY broadcast_events_contact_center_view
  ON public.broadcast_events FOR SELECT TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'communication', 'view'));

CREATE POLICY broadcast_runs_contact_center_view
  ON public.broadcast_runs FOR SELECT TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'communication', 'view'));

REVOKE ALL ON public.broadcast_campaigns FROM PUBLIC, anon;
REVOKE ALL ON public.broadcast_deliveries FROM PUBLIC, anon;
REVOKE ALL ON public.broadcast_delivery_segments FROM PUBLIC, anon;
REVOKE ALL ON public.broadcast_links FROM PUBLIC, anon;
REVOKE ALL ON public.broadcast_tracking_tokens FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.broadcast_events FROM PUBLIC, anon;

GRANT SELECT ON public.broadcast_campaigns TO authenticated;
GRANT SELECT ON public.broadcast_deliveries TO authenticated;
GRANT SELECT ON public.broadcast_delivery_segments TO authenticated;
GRANT SELECT ON public.broadcast_links TO authenticated;
GRANT SELECT ON public.broadcast_events TO authenticated;
GRANT SELECT ON public.broadcast_runs TO authenticated;
GRANT ALL ON public.broadcast_campaigns TO service_role;
GRANT ALL ON public.broadcast_deliveries TO service_role;
GRANT ALL ON public.broadcast_delivery_segments TO service_role;
GRANT ALL ON public.broadcast_links TO service_role;
GRANT ALL ON public.broadcast_tracking_tokens TO service_role;
GRANT ALL ON public.broadcast_events TO service_role;

-- -----------------------------------------------------------------------------
-- 3. Service-only write helpers
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.analytics_ensure_broadcast_run(
  _campaign_id uuid,
  _channel text,
  _name text,
  _source text DEFAULT 'contact_center',
  _send_mode text DEFAULT 'manual',
  _template_id uuid DEFAULT NULL,
  _run_id uuid DEFAULT NULL,
  _created_by uuid DEFAULT NULL,
  _audience_filters jsonb DEFAULT '{}'::jsonb,
  _audience_snapshot jsonb DEFAULT '{}'::jsonb,
  _content_snapshot jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
BEGIN
  IF _channel NOT IN ('telegram', 'email') THEN
    RAISE EXCEPTION 'unsupported broadcast channel';
  END IF;

  INSERT INTO public.broadcast_campaigns (
    id, template_id, name, source, send_mode, channels, audience_filters,
    audience_snapshot, content_snapshot, created_by
  ) VALUES (
    _campaign_id, _template_id, COALESCE(NULLIF(trim(_name), ''), 'Рассылка'),
    _source, _send_mode, ARRAY[_channel]::text[], COALESCE(_audience_filters, '{}'::jsonb),
    COALESCE(_audience_snapshot, '{}'::jsonb), COALESCE(_content_snapshot, '{}'::jsonb),
    _created_by
  )
  ON CONFLICT (id) DO UPDATE SET
    channels = ARRAY(
      SELECT DISTINCT channel_name
      FROM unnest(public.broadcast_campaigns.channels || EXCLUDED.channels) AS channel_name
      ORDER BY channel_name
    ),
    audience_snapshot = public.broadcast_campaigns.audience_snapshot || EXCLUDED.audience_snapshot,
    content_snapshot = public.broadcast_campaigns.content_snapshot || EXCLUDED.content_snapshot,
    status = 'running',
    finished_at = NULL,
    updated_at = now();

  IF _run_id IS NOT NULL THEN
    UPDATE public.broadcast_runs
    SET campaign_id = _campaign_id
    WHERE id = _run_id
    RETURNING id INTO v_run_id;

    IF v_run_id IS NULL THEN
      RAISE EXCEPTION 'broadcast run % not found', _run_id;
    END IF;
  ELSE
    INSERT INTO public.broadcast_runs (
      campaign_id, template_id, channel, triggered_by, idempotency_key,
      audience_count, audience_snapshot
    ) VALUES (
      _campaign_id, _template_id, _channel,
      CASE WHEN _send_mode IN ('scheduled', 'recurring') THEN _send_mode ELSE 'manual' END,
      'campaign:' || _campaign_id::text || ':' || _channel,
      COALESCE((_audience_snapshot->>CASE WHEN _channel = 'telegram' THEN 'telegram_count' ELSE 'email_count' END)::integer, 0),
      COALESCE(_audience_snapshot, '{}'::jsonb)
    )
    ON CONFLICT (idempotency_key) DO UPDATE SET
      campaign_id = EXCLUDED.campaign_id,
      audience_snapshot = public.broadcast_runs.audience_snapshot || EXCLUDED.audience_snapshot
    RETURNING id INTO v_run_id;
  END IF;

  RETURN jsonb_build_object('campaign_id', _campaign_id, 'run_id', v_run_id);
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_ensure_broadcast_run(
  uuid, text, text, text, text, uuid, uuid, uuid, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_ensure_broadcast_run(
  uuid, text, text, text, text, uuid, uuid, uuid, jsonb, jsonb, jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.analytics_snapshot_delivery_segments(_delivery_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_added integer := 0;
BEGIN
  INSERT INTO public.broadcast_delivery_segments (
    delivery_id, product_id, tariff_id, access_mode, source_ref
  )
  SELECT DISTINCT
    d.id,
    o.product_id,
    o.tariff_id,
    'purchased',
    'order:' || o.id::text
  FROM public.broadcast_deliveries d
  JOIN public.orders_v2 o
    ON o.profile_id = d.profile_id
    OR (d.user_id IS NOT NULL AND o.user_id = d.user_id)
  WHERE d.id = ANY(_delivery_ids)
    AND o.status::text = 'paid'
    AND NOT o.is_deleted
    AND COALESCE(o.reconcile_source, '') <> 'rule_engine'
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.broadcast_delivery_segments (
    delivery_id, product_id, tariff_id, access_mode, source_ref
  )
  SELECT DISTINCT
    d.id,
    s.product_id,
    s.tariff_id,
    'active_access',
    'subscription:' || s.id::text
  FROM public.broadcast_deliveries d
  JOIN public.subscriptions_v2 s
    ON s.profile_id = d.profile_id
    OR (d.user_id IS NOT NULL AND s.user_id = d.user_id)
  WHERE d.id = ANY(_delivery_ids)
    AND s.status::text IN ('active', 'trial', 'past_due')
    AND (s.access_end_at IS NULL OR s.access_end_at > d.created_at)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;
  v_count := v_count + v_added;

  INSERT INTO public.broadcast_delivery_segments (
    delivery_id, product_id, tariff_id, access_mode, source_ref
  )
  SELECT DISTINCT
    d.id,
    e.product_id,
    o.tariff_id,
    'active_access',
    'entitlement:' || e.id::text
  FROM public.broadcast_deliveries d
  JOIN public.entitlements e
    ON e.profile_id = d.profile_id
    OR (d.user_id IS NOT NULL AND e.user_id = d.user_id)
  LEFT JOIN public.orders_v2 o ON o.id = e.order_id
  WHERE d.id = ANY(_delivery_ids)
    AND e.status = 'active'
    AND (e.expires_at IS NULL OR e.expires_at > d.created_at)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;
  v_count := v_count + v_added;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_snapshot_delivery_segments(uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_snapshot_delivery_segments(uuid[])
  TO service_role;

CREATE OR REPLACE FUNCTION public.analytics_apply_delivery_outcomes(_outcomes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer := 0;
  v_events integer := 0;
BEGIN
  IF jsonb_typeof(_outcomes) <> 'array' THEN
    RAISE EXCEPTION 'outcomes must be a JSON array';
  END IF;

  WITH input AS (
    SELECT *
    FROM jsonb_to_recordset(_outcomes) AS x(
      id uuid,
      status text,
      provider text,
      provider_message_id text,
      email_log_id uuid,
      telegram_message_id uuid,
      error_code text,
      error_message text,
      metadata jsonb
    )
  )
  UPDATE public.broadcast_deliveries d
  SET
    status = CASE
      WHEN i.status IN ('accepted', 'sent', 'delivered', 'failed', 'bounced', 'skipped')
        THEN i.status
      ELSE d.status
    END,
    provider = COALESCE(i.provider, d.provider),
    provider_message_id = COALESCE(i.provider_message_id, d.provider_message_id),
    email_log_id = COALESCE(i.email_log_id, d.email_log_id),
    telegram_message_id = COALESCE(i.telegram_message_id, d.telegram_message_id),
    accepted_at = CASE
      WHEN i.status IN ('accepted', 'sent', 'delivered') THEN COALESCE(d.accepted_at, now())
      ELSE d.accepted_at
    END,
    delivered_at = CASE
      WHEN i.status = 'delivered' THEN COALESCE(d.delivered_at, now())
      ELSE d.delivered_at
    END,
    failed_at = CASE
      WHEN i.status IN ('failed', 'bounced') THEN COALESCE(d.failed_at, now())
      ELSE d.failed_at
    END,
    error_code = COALESCE(i.error_code, d.error_code),
    error_message = COALESCE(i.error_message, d.error_message),
    metadata = d.metadata || COALESCE(i.metadata, '{}'::jsonb),
    updated_at = now()
  FROM input i
  WHERE d.id = i.id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  INSERT INTO public.broadcast_events (
    campaign_id, delivery_id, event_type, source, provider_event_id,
    event_key, occurred_at, metadata
  )
  SELECT
    d.campaign_id,
    d.id,
    CASE
      WHEN i.status IN ('accepted', 'sent') THEN 'accepted'
      WHEN i.status = 'delivered' THEN 'delivered'
      WHEN i.status = 'bounced' THEN 'bounced'
      WHEN i.status = 'failed' THEN 'failed'
      ELSE 'queued'
    END,
    CASE WHEN d.channel = 'telegram' THEN 'telegram' ELSE 'smtp' END,
    i.provider_message_id,
    'outcome:' || d.id::text || ':' || i.status,
    now(),
    COALESCE(i.metadata, '{}'::jsonb)
  FROM jsonb_to_recordset(_outcomes) AS i(
    id uuid,
    status text,
    provider text,
    provider_message_id text,
    email_log_id uuid,
    telegram_message_id uuid,
    error_code text,
    error_message text,
    metadata jsonb
  )
  JOIN public.broadcast_deliveries d ON d.id = i.id
  WHERE i.status IN ('accepted', 'sent', 'delivered', 'failed', 'bounced')
  ON CONFLICT (event_key) DO NOTHING;
  GET DIAGNOSTICS v_events = ROW_COUNT;

  UPDATE public.broadcast_runs r
  SET
    audience_count = stats.total,
    sent_count = stats.accepted,
    accepted_count = stats.accepted,
    delivered_count = stats.delivered,
    failed_count = stats.failed,
    skipped_count = stats.skipped,
    opened_count = stats.opened,
    clicked_count = stats.clicked,
    reply_count = stats.replies,
    finished_at = CASE WHEN stats.pending = 0 THEN COALESCE(r.finished_at, now()) ELSE r.finished_at END
  FROM (
    SELECT
      d.run_id,
      count(*)::integer AS total,
      count(*) FILTER (WHERE d.status IN ('accepted', 'sent', 'delivered'))::integer AS accepted,
      count(*) FILTER (WHERE d.status = 'delivered')::integer AS delivered,
      count(*) FILTER (WHERE d.status IN ('failed', 'bounced'))::integer AS failed,
      count(*) FILTER (WHERE d.status = 'skipped')::integer AS skipped,
      count(*) FILTER (WHERE d.status = 'queued')::integer AS pending,
      count(*) FILTER (WHERE d.first_opened_at IS NOT NULL)::integer AS opened,
      count(*) FILTER (WHERE d.first_clicked_at IS NOT NULL)::integer AS clicked,
      count(*) FILTER (WHERE d.first_replied_at IS NOT NULL)::integer AS replies
    FROM public.broadcast_deliveries d
    WHERE d.run_id IN (
      SELECT DISTINCT d2.run_id
      FROM public.broadcast_deliveries d2
      JOIN jsonb_to_recordset(_outcomes) AS i2(id uuid) ON i2.id = d2.id
    )
    GROUP BY d.run_id
  ) stats
  WHERE r.id = stats.run_id;

  UPDATE public.broadcast_campaigns c
  SET
    status = CASE
      WHEN stats.pending > 0 THEN 'running'
      WHEN stats.accepted > 0 AND (stats.failed > 0 OR stats.skipped > 0) THEN 'partial'
      WHEN stats.accepted > 0 THEN 'completed'
      ELSE 'failed'
    END,
    finished_at = CASE WHEN stats.pending = 0 THEN COALESCE(c.finished_at, now()) ELSE c.finished_at END,
    updated_at = now()
  FROM (
    SELECT
      d.campaign_id,
      count(*) FILTER (WHERE d.status = 'queued')::integer AS pending,
      count(*) FILTER (WHERE d.status IN ('accepted', 'sent', 'delivered'))::integer AS accepted,
      count(*) FILTER (WHERE d.status IN ('failed', 'bounced'))::integer AS failed,
      count(*) FILTER (WHERE d.status = 'skipped')::integer AS skipped
    FROM public.broadcast_deliveries d
    WHERE d.campaign_id IN (
      SELECT DISTINCT d2.campaign_id
      FROM public.broadcast_deliveries d2
      JOIN jsonb_to_recordset(_outcomes) AS i2(id uuid) ON i2.id = d2.id
    )
    GROUP BY d.campaign_id
  ) stats
  WHERE c.id = stats.campaign_id;

  RETURN jsonb_build_object('updated', v_updated, 'events', v_events);
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_apply_delivery_outcomes(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_apply_delivery_outcomes(jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.analytics_record_tracking_event(
  _token uuid,
  _event_type text,
  _event_key text,
  _is_machine boolean DEFAULT false,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tracking public.broadcast_tracking_tokens%ROWTYPE;
  v_delivery public.broadcast_deliveries%ROWTYPE;
  v_url text;
  v_inserted boolean := false;
BEGIN
  SELECT * INTO v_tracking
  FROM public.broadcast_tracking_tokens
  WHERE token = _token
    AND expires_at > now();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired_or_unknown');
  END IF;

  IF (_event_type = 'open_signal' AND v_tracking.purpose <> 'open')
     OR (_event_type = 'click' AND v_tracking.purpose <> 'click') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'token_purpose_mismatch');
  END IF;

  SELECT * INTO v_delivery
  FROM public.broadcast_deliveries
  WHERE id = v_tracking.delivery_id;

  INSERT INTO public.broadcast_events (
    campaign_id, delivery_id, link_id, event_type, source, event_key,
    is_machine, metadata
  ) VALUES (
    v_delivery.campaign_id, v_delivery.id, v_tracking.link_id, _event_type,
    'tracking', _event_key, COALESCE(_is_machine, false), COALESCE(_metadata, '{}'::jsonb)
  )
  ON CONFLICT (event_key) DO NOTHING;
  v_inserted := FOUND;

  IF v_inserted AND _event_type = 'open_signal' THEN
    UPDATE public.broadcast_deliveries
    SET
      first_opened_at = COALESCE(first_opened_at, now()),
      open_count = open_count + 1,
      updated_at = now()
    WHERE id = v_delivery.id;

    UPDATE public.email_logs
    SET opened_at = COALESCE(opened_at, now())
    WHERE id = v_delivery.email_log_id;
  ELSIF v_inserted AND _event_type = 'click' THEN
    UPDATE public.broadcast_deliveries
    SET
      first_clicked_at = CASE
        WHEN COALESCE(_is_machine, false) THEN first_clicked_at
        ELSE COALESCE(first_clicked_at, now())
      END,
      click_count = click_count + 1,
      updated_at = now()
    WHERE id = v_delivery.id;

    UPDATE public.email_logs
    SET clicked_at = CASE
      WHEN COALESCE(_is_machine, false) THEN clicked_at
      ELSE COALESCE(clicked_at, now())
    END
    WHERE id = v_delivery.email_log_id;
  END IF;

  IF v_inserted THEN
    UPDATE public.broadcast_runs r
    SET
      opened_count = stats.opened,
      clicked_count = stats.clicked,
      reply_count = stats.replies
    FROM (
      SELECT
        count(*) FILTER (WHERE first_opened_at IS NOT NULL)::integer AS opened,
        count(*) FILTER (WHERE first_clicked_at IS NOT NULL)::integer AS clicked,
        count(*) FILTER (WHERE first_replied_at IS NOT NULL)::integer AS replies
      FROM public.broadcast_deliveries
      WHERE run_id = v_delivery.run_id
    ) stats
    WHERE r.id = v_delivery.run_id;
  END IF;

  IF v_tracking.link_id IS NOT NULL THEN
    SELECT original_url INTO v_url
    FROM public.broadcast_links
    WHERE id = v_tracking.link_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'inserted', v_inserted,
    'purpose', v_tracking.purpose,
    'url', v_url
  );
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_record_tracking_event(uuid, text, text, boolean, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_record_tracking_event(uuid, text, text, boolean, jsonb)
  TO service_role;

-- Replies are stronger engagement evidence than open pixels. Capture them from
-- the canonical inbound journals without changing contact-center behavior.
CREATE OR REPLACE FUNCTION public.capture_broadcast_telegram_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delivery public.broadcast_deliveries%ROWTYPE;
BEGIN
  IF NEW.direction <> 'incoming' THEN
    RETURN NEW;
  END IF;

  SELECT d.* INTO v_delivery
  FROM public.broadcast_deliveries d
  JOIN public.broadcast_campaigns c ON c.id = d.campaign_id
  WHERE d.channel = 'telegram'
    AND d.user_id = NEW.user_id
    AND (d.bot_id IS NULL OR NEW.bot_id IS NULL OR d.bot_id = NEW.bot_id)
    AND COALESCE(d.accepted_at, d.created_at) <= NEW.created_at
    AND NEW.created_at <= COALESCE(d.accepted_at, d.created_at)
      + make_interval(days => c.attribution_window_days)
  ORDER BY COALESCE(d.accepted_at, d.created_at) DESC
  LIMIT 1;

  IF v_delivery.id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.broadcast_deliveries
  SET first_replied_at = COALESCE(first_replied_at, NEW.created_at), updated_at = now()
  WHERE id = v_delivery.id;

  INSERT INTO public.broadcast_events (
    campaign_id, delivery_id, event_type, source, event_key, occurred_at,
    metadata
  ) VALUES (
    v_delivery.campaign_id, v_delivery.id, 'reply', 'contact_center',
    'reply:telegram:' || NEW.id::text, NEW.created_at,
    jsonb_build_object('telegram_message_id', NEW.id)
  ) ON CONFLICT (event_key) DO NOTHING;

  UPDATE public.broadcast_runs r
  SET reply_count = (
    SELECT count(*)::integer
    FROM public.broadcast_deliveries d
    WHERE d.run_id = v_delivery.run_id
      AND d.first_replied_at IS NOT NULL
  )
  WHERE r.id = v_delivery.run_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS capture_broadcast_telegram_reply_trigger ON public.telegram_messages;
CREATE TRIGGER capture_broadcast_telegram_reply_trigger
AFTER INSERT ON public.telegram_messages
FOR EACH ROW EXECUTE FUNCTION public.capture_broadcast_telegram_reply();

REVOKE ALL ON FUNCTION public.capture_broadcast_telegram_reply()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.capture_broadcast_email_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_delivery public.broadcast_deliveries%ROWTYPE;
  v_received_at timestamptz := COALESCE(NEW.received_at, NEW.created_at, now());
BEGIN
  v_profile_id := NEW.linked_profile_id;
  IF v_profile_id IS NULL THEN
    SELECT p.id INTO v_profile_id
    FROM public.profiles p
    WHERE lower(trim(p.email)) = lower(trim(NEW.from_email))
    ORDER BY (p.user_id IS NOT NULL) DESC, p.id
    LIMIT 1;
  END IF;

  IF v_profile_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT d.* INTO v_delivery
  FROM public.broadcast_deliveries d
  JOIN public.broadcast_campaigns c ON c.id = d.campaign_id
  WHERE d.channel = 'email'
    AND d.profile_id = v_profile_id
    AND COALESCE(d.accepted_at, d.created_at) <= v_received_at
    AND v_received_at <= COALESCE(d.accepted_at, d.created_at)
      + make_interval(days => c.attribution_window_days)
  ORDER BY COALESCE(d.accepted_at, d.created_at) DESC
  LIMIT 1;

  IF v_delivery.id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.broadcast_deliveries
  SET first_replied_at = COALESCE(first_replied_at, v_received_at), updated_at = now()
  WHERE id = v_delivery.id;

  INSERT INTO public.broadcast_events (
    campaign_id, delivery_id, event_type, source, event_key, occurred_at,
    metadata
  ) VALUES (
    v_delivery.campaign_id, v_delivery.id, 'reply', 'contact_center',
    'reply:email:' || NEW.id::text, v_received_at,
    jsonb_build_object('email_inbox_id', NEW.id)
  ) ON CONFLICT (event_key) DO NOTHING;

  UPDATE public.broadcast_runs r
  SET reply_count = (
    SELECT count(*)::integer
    FROM public.broadcast_deliveries d
    WHERE d.run_id = v_delivery.run_id
      AND d.first_replied_at IS NOT NULL
  )
  WHERE r.id = v_delivery.run_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS capture_broadcast_email_reply_trigger ON public.email_inbox;
CREATE TRIGGER capture_broadcast_email_reply_trigger
AFTER INSERT ON public.email_inbox
FOR EACH ROW EXECUTE FUNCTION public.capture_broadcast_email_reply();

REVOKE ALL ON FUNCTION public.capture_broadcast_email_reply()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.capture_broadcast_telegram_reaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delivery public.broadcast_deliveries%ROWTYPE;
BEGIN
  SELECT * INTO v_delivery
  FROM public.broadcast_deliveries
  WHERE telegram_message_id = NEW.message_id
  LIMIT 1;

  IF v_delivery.id IS NOT NULL THEN
    INSERT INTO public.broadcast_events (
      campaign_id, delivery_id, event_type, source, event_key, occurred_at,
      metadata
    ) VALUES (
      v_delivery.campaign_id, v_delivery.id, 'reaction', 'telegram',
      'reaction:telegram:' || NEW.id::text, COALESCE(NEW.created_at, now()),
      jsonb_build_object('reaction_id', NEW.id, 'emoji', NEW.emoji)
    ) ON CONFLICT (event_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS capture_broadcast_telegram_reaction_trigger ON public.telegram_message_reactions;
CREATE TRIGGER capture_broadcast_telegram_reaction_trigger
AFTER INSERT ON public.telegram_message_reactions
FOR EACH ROW EXECUTE FUNCTION public.capture_broadcast_telegram_reaction();

REVOKE ALL ON FUNCTION public.capture_broadcast_telegram_reaction()
  FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Read-only analytics RPCs for every contact-center viewer
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_broadcast_analytics_filters()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL
     OR NOT public.has_admin_section_access((SELECT auth.uid()), 'communication', 'view') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) ORDER BY p.name)
      FROM public.products_v2 p
    ), '[]'::jsonb),
    'tariffs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'product_id', t.product_id
      ) ORDER BY t.name)
      FROM public.tariffs t
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_broadcast_analytics_filters() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_broadcast_analytics_filters() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_broadcast_analytics(
  _from timestamptz,
  _to timestamptz,
  _channel text DEFAULT NULL,
  _product_id uuid DEFAULT NULL,
  _tariff_id uuid DEFAULT NULL,
  _limit integer DEFAULT 50,
  _offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL
     OR NOT public.has_admin_section_access((SELECT auth.uid()), 'communication', 'view') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH filtered_campaigns AS (
    SELECT c.*
    FROM public.broadcast_campaigns c
    WHERE c.started_at >= _from
      AND c.started_at < _to
      AND (_channel IS NULL OR _channel = ANY(c.channels))
      AND (
        (_product_id IS NULL AND _tariff_id IS NULL)
        OR EXISTS (
          SELECT 1
          FROM public.broadcast_deliveries d
          JOIN public.broadcast_delivery_segments s ON s.delivery_id = d.id
          WHERE d.campaign_id = c.id
            AND (_product_id IS NULL OR s.product_id = _product_id)
            AND (_tariff_id IS NULL OR s.tariff_id = _tariff_id)
        )
      )
  ),
  filtered_deliveries AS (
    SELECT d.*
    FROM public.broadcast_deliveries d
    JOIN filtered_campaigns c ON c.id = d.campaign_id
    WHERE (_channel IS NULL OR d.channel = _channel)
      AND (
        (_product_id IS NULL AND _tariff_id IS NULL)
        OR EXISTS (
          SELECT 1
          FROM public.broadcast_delivery_segments s
          WHERE s.delivery_id = d.id
            AND (_product_id IS NULL OR s.product_id = _product_id)
            AND (_tariff_id IS NULL OR s.tariff_id = _tariff_id)
        )
      )
  ),
  -- Attribution is selected globally first, then filtered for the report.
  -- Otherwise a product/date filter could incorrectly move one payment to an
  -- older campaign merely because the real last-touch campaign was hidden.
  candidate_attributions AS (
    SELECT
      p.id AS payment_id,
      p.order_id,
      p.profile_id,
      p.user_id,
      p.currency,
      GREATEST(p.amount - COALESCE(p.refunded_amount, 0), 0) AS net_amount,
      COALESCE(p.paid_at, p.created_at) AS paid_at,
      d.id AS delivery_id,
      d.campaign_id,
      CASE
        WHEN d.first_clicked_at IS NOT NULL
          AND d.first_clicked_at <= COALESCE(p.paid_at, p.created_at)
        THEN 'direct_click'
        ELSE 'post_send_assist'
      END AS model,
      CASE
        WHEN d.first_clicked_at IS NOT NULL
          AND d.first_clicked_at <= COALESCE(p.paid_at, p.created_at)
        THEN d.first_clicked_at
        ELSE COALESCE(d.accepted_at, d.created_at)
      END AS evidence_at
    FROM public.payments_v2 p
    JOIN public.broadcast_deliveries d
      ON (p.profile_id IS NOT NULL AND p.profile_id = d.profile_id)
      OR (p.user_id IS NOT NULL AND p.user_id = d.user_id)
    JOIN public.broadcast_campaigns c ON c.id = d.campaign_id
    WHERE p.status::text IN ('successful', 'succeeded')
      AND NOT p.is_deleted
      AND COALESCE(p.transaction_type, '') NOT IN ('refund', 'void')
      AND p.amount > 0
      -- A filtered campaign cannot produce an attributable payment before
      -- the report begins or more than the maximum allowed 90-day window
      -- after its end. This keeps global last-touch semantics while avoiding
      -- a scan of the full payment history on every dashboard refresh.
      AND COALESCE(p.paid_at, p.created_at) >= _from
      AND COALESCE(p.paid_at, p.created_at) < _to + interval '90 days'
      AND COALESCE(p.paid_at, p.created_at) >= COALESCE(d.accepted_at, d.created_at)
      AND COALESCE(p.paid_at, p.created_at) <= COALESCE(d.accepted_at, d.created_at)
        + make_interval(days => c.attribution_window_days)
  ),
  attributed_all AS (
    SELECT DISTINCT ON (payment_id)
      payment_id, order_id, delivery_id, campaign_id, currency, net_amount, model, paid_at
    FROM candidate_attributions
    ORDER BY payment_id, (model = 'direct_click') DESC, evidence_at DESC, delivery_id DESC
  ),
  attributed AS (
    SELECT a.*
    FROM attributed_all a
    JOIN filtered_campaigns c ON c.id = a.campaign_id
    JOIN filtered_deliveries d ON d.id = a.delivery_id
  ),
  campaign_delivery_stats AS (
    SELECT
      c.id,
      count(DISTINCT CASE
        WHEN d.profile_id IS NOT NULL THEN 'profile:' || d.profile_id::text
        WHEN d.user_id IS NOT NULL THEN 'user:' || d.user_id::text
        ELSE 'delivery:' || d.id::text
      END)::integer AS recipients,
      count(d.id) FILTER (WHERE d.status IN ('accepted', 'sent', 'delivered'))::integer AS accepted,
      count(d.id) FILTER (
        WHERE d.channel = 'email' AND d.status IN ('accepted', 'sent', 'delivered')
      )::integer AS email_accepted,
      count(d.id) FILTER (
        WHERE d.channel = 'telegram' AND d.status IN ('accepted', 'sent', 'delivered')
      )::integer AS telegram_accepted,
      count(d.id) FILTER (WHERE d.status = 'delivered')::integer AS delivered,
      count(DISTINCT CASE WHEN d.first_opened_at IS NOT NULL THEN
        COALESCE('profile:' || d.profile_id::text, 'user:' || d.user_id::text, 'delivery:' || d.id::text)
      END)::integer AS open_signals,
      count(DISTINCT CASE WHEN d.first_clicked_at IS NOT NULL THEN
        COALESCE('profile:' || d.profile_id::text, 'user:' || d.user_id::text, 'delivery:' || d.id::text)
      END)::integer AS unique_clicks,
      count(DISTINCT CASE WHEN d.first_replied_at IS NOT NULL THEN
        COALESCE('profile:' || d.profile_id::text, 'user:' || d.user_id::text, 'delivery:' || d.id::text)
      END)::integer AS replies,
      count(d.id) FILTER (WHERE d.status IN ('failed', 'bounced'))::integer AS failed,
      count(d.id) FILTER (WHERE d.status = 'skipped')::integer AS skipped
    FROM filtered_campaigns c
    LEFT JOIN filtered_deliveries d ON d.campaign_id = c.id
    GROUP BY c.id
  ),
  campaign_attribution_stats AS (
    SELECT
      c.id,
      count(DISTINCT a.payment_id)::integer AS purchases,
      count(DISTINCT a.payment_id) FILTER (WHERE a.model = 'direct_click')::integer AS direct_purchases,
      count(DISTINCT a.payment_id) FILTER (WHERE a.model = 'post_send_assist')::integer AS assisted_purchases,
      COALESCE((
        SELECT jsonb_object_agg(currency, amount)
        FROM (
          SELECT a2.currency, round(sum(a2.net_amount)::numeric, 2) AS amount
          FROM attributed a2
          WHERE a2.campaign_id = c.id
          GROUP BY a2.currency
        ) revenue_rows
      ), '{}'::jsonb) AS revenue_by_currency
    FROM filtered_campaigns c
    LEFT JOIN attributed a ON a.campaign_id = c.id
    GROUP BY c.id
  ),
  campaign_stats AS (
    SELECT
      c.id,
      c.name,
      c.status,
      c.source,
      c.send_mode,
      c.channels,
      c.content_snapshot,
      c.started_at,
      c.finished_at,
      ds.recipients,
      ds.accepted,
      ds.email_accepted,
      ds.telegram_accepted,
      ds.delivered,
      ds.open_signals,
      ds.unique_clicks,
      ds.replies,
      ds.failed,
      ds.skipped,
      ats.purchases,
      ats.direct_purchases,
      ats.assisted_purchases,
      ats.revenue_by_currency
    FROM filtered_campaigns c
    JOIN campaign_delivery_stats ds ON ds.id = c.id
    JOIN campaign_attribution_stats ats ON ats.id = c.id
  ),
  totals AS (
    SELECT
      count(*)::integer AS campaigns,
      COALESCE(sum(recipients), 0)::integer AS recipients,
      COALESCE((
        SELECT count(DISTINCT CASE
          WHEN d.profile_id IS NOT NULL THEN 'profile:' || d.profile_id::text
          WHEN d.user_id IS NOT NULL THEN 'user:' || d.user_id::text
          ELSE 'delivery:' || d.id::text
        END)::integer
        FROM filtered_deliveries d
      ), 0)::integer AS unique_recipients,
      COALESCE(sum(accepted), 0)::integer AS accepted,
      COALESCE(sum(email_accepted), 0)::integer AS email_accepted,
      COALESCE(sum(telegram_accepted), 0)::integer AS telegram_accepted,
      COALESCE(sum(delivered), 0)::integer AS delivered,
      COALESCE(sum(open_signals), 0)::integer AS open_signals,
      COALESCE(sum(unique_clicks), 0)::integer AS unique_clicks,
      COALESCE(sum(replies), 0)::integer AS replies,
      COALESCE(sum(failed), 0)::integer AS failed,
      COALESCE(sum(skipped), 0)::integer AS skipped,
      COALESCE(sum(purchases), 0)::integer AS purchases,
      COALESCE(sum(direct_purchases), 0)::integer AS direct_purchases,
      COALESCE(sum(assisted_purchases), 0)::integer AS assisted_purchases
    FROM campaign_stats
  ),
  revenue AS (
    SELECT COALESCE(jsonb_object_agg(currency, amount), '{}'::jsonb) AS by_currency
    FROM (
      SELECT currency, round(sum(net_amount)::numeric, 2) AS amount
      FROM attributed
      GROUP BY currency
    ) r
  ),
  daily AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'date', day::date,
      'sent', sent,
      'clicks', clicks,
      'replies', replies,
      'purchases', purchases
    ) ORDER BY day), '[]'::jsonb) AS items
    FROM (
      SELECT
        date_trunc('day', d.created_at) AS day,
        count(*) FILTER (WHERE d.status IN ('accepted', 'sent', 'delivered'))::integer AS sent,
        count(DISTINCT CASE WHEN d.first_clicked_at IS NOT NULL THEN
          d.campaign_id::text || ':' || COALESCE('profile:' || d.profile_id::text, 'user:' || d.user_id::text, 'delivery:' || d.id::text)
        END)::integer AS clicks,
        count(DISTINCT CASE WHEN d.first_replied_at IS NOT NULL THEN
          d.campaign_id::text || ':' || COALESCE('profile:' || d.profile_id::text, 'user:' || d.user_id::text, 'delivery:' || d.id::text)
        END)::integer AS replies,
        count(DISTINCT a.payment_id)::integer AS purchases
      FROM filtered_deliveries d
      LEFT JOIN attributed a ON a.delivery_id = d.id
      GROUP BY date_trunc('day', d.created_at)
    ) q
  ),
  page AS (
    SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.started_at DESC), '[]'::jsonb) AS items
    FROM (
      SELECT * FROM campaign_stats
      ORDER BY started_at DESC
      LIMIT LEAST(GREATEST(_limit, 1), 100)
      OFFSET GREATEST(_offset, 0)
    ) q
  )
  SELECT jsonb_build_object(
    'summary', to_jsonb(t),
    'revenue_by_currency', r.by_currency,
    'daily', d.items,
    'campaigns', p.items,
    'total_campaigns', (SELECT count(*) FROM campaign_stats),
    'limit', LEAST(GREATEST(_limit, 1), 100),
    'offset', GREATEST(_offset, 0)
  ) INTO v_result
  FROM totals t CROSS JOIN revenue r CROSS JOIN daily d CROSS JOIN page p;

  RETURN COALESCE(v_result, jsonb_build_object(
    'summary', '{}'::jsonb,
    'revenue_by_currency', '{}'::jsonb,
    'daily', '[]'::jsonb,
    'campaigns', '[]'::jsonb,
    'total_campaigns', 0
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_broadcast_analytics(
  timestamptz, timestamptz, text, uuid, uuid, integer, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_broadcast_analytics(
  timestamptz, timestamptz, text, uuid, uuid, integer, integer
) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_broadcast_campaign_recipients(
  _campaign_id uuid,
  _limit integer DEFAULT 50,
  _offset integer DEFAULT 0,
  _status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL
     OR NOT public.has_admin_section_access((SELECT auth.uid()), 'communication', 'view') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH rows AS (
    SELECT
      d.id,
      d.channel,
      d.status,
      d.accepted_at,
      d.delivered_at,
      d.first_opened_at,
      d.first_clicked_at,
      d.first_replied_at,
      d.open_count,
      d.click_count,
      d.error_message,
      p.id AS profile_id,
      p.full_name,
      p.email,
      p.telegram_username,
      COALESCE((
        SELECT jsonb_agg(DISTINCT jsonb_build_object(
          'product_id', s.product_id,
          'product_name', pv.name,
          'tariff_id', s.tariff_id,
          'tariff_name', t.name,
          'access_mode', s.access_mode
        ))
        FROM public.broadcast_delivery_segments s
        LEFT JOIN public.products_v2 pv ON pv.id = s.product_id
        LEFT JOIN public.tariffs t ON t.id = s.tariff_id
        WHERE s.delivery_id = d.id
      ), '[]'::jsonb) AS segments,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'order_id', pay.order_id,
          'payment_id', pay.id,
          'amount', GREATEST(pay.amount - COALESCE(pay.refunded_amount, 0), 0),
          'currency', pay.currency,
          'paid_at', COALESCE(pay.paid_at, pay.created_at),
          'product_id', purchase_order.product_id,
          'product_name', purchase_product.name,
          'tariff_id', purchase_order.tariff_id,
          'tariff_name', purchase_tariff.name,
          'model', CASE
            WHEN d.first_clicked_at IS NOT NULL
              AND d.first_clicked_at <= COALESCE(pay.paid_at, pay.created_at)
            THEN 'direct_click'
            ELSE 'post_send_assist'
          END
        ) ORDER BY COALESCE(pay.paid_at, pay.created_at))
        FROM public.payments_v2 pay
        JOIN public.broadcast_campaigns c ON c.id = d.campaign_id
        LEFT JOIN public.orders_v2 purchase_order ON purchase_order.id = pay.order_id
        LEFT JOIN public.products_v2 purchase_product ON purchase_product.id = purchase_order.product_id
        LEFT JOIN public.tariffs purchase_tariff ON purchase_tariff.id = purchase_order.tariff_id
        WHERE pay.status::text IN ('successful', 'succeeded')
          AND NOT pay.is_deleted
          AND COALESCE(pay.transaction_type, '') NOT IN ('refund', 'void')
          AND pay.amount > 0
          AND (
            (pay.profile_id IS NOT NULL AND pay.profile_id = d.profile_id)
            OR (pay.user_id IS NOT NULL AND pay.user_id = d.user_id)
          )
          AND COALESCE(pay.paid_at, pay.created_at) >= COALESCE(d.accepted_at, d.created_at)
          AND COALESCE(pay.paid_at, pay.created_at) <= COALESCE(d.accepted_at, d.created_at)
            + make_interval(days => c.attribution_window_days)
          AND NOT EXISTS (
            SELECT 1
            FROM public.broadcast_deliveries other
            JOIN public.broadcast_campaigns other_campaign ON other_campaign.id = other.campaign_id
            WHERE other.id <> d.id
              AND (
                (pay.profile_id IS NOT NULL AND pay.profile_id = other.profile_id)
                OR (pay.user_id IS NOT NULL AND pay.user_id = other.user_id)
              )
              AND COALESCE(other.accepted_at, other.created_at) <= COALESCE(pay.paid_at, pay.created_at)
              AND COALESCE(pay.paid_at, pay.created_at) <= COALESCE(other.accepted_at, other.created_at)
                + make_interval(days => other_campaign.attribution_window_days)
              AND (
                CASE
                  WHEN other.first_clicked_at IS NOT NULL
                    AND other.first_clicked_at <= COALESCE(pay.paid_at, pay.created_at)
                  THEN ROW(1, other.first_clicked_at, other.id)
                  ELSE ROW(0, COALESCE(other.accepted_at, other.created_at), other.id)
                END
              ) > (
                CASE
                  WHEN d.first_clicked_at IS NOT NULL
                    AND d.first_clicked_at <= COALESCE(pay.paid_at, pay.created_at)
                  THEN ROW(1, d.first_clicked_at, d.id)
                  ELSE ROW(0, COALESCE(d.accepted_at, d.created_at), d.id)
                END
              )
          )
      ), '[]'::jsonb) AS purchases
    FROM public.broadcast_deliveries d
    LEFT JOIN public.profiles p ON p.id = d.profile_id
    WHERE d.campaign_id = _campaign_id
      AND (_status IS NULL OR d.status = _status)
    ORDER BY d.created_at DESC
    LIMIT LEAST(GREATEST(_limit, 1), 100)
    OFFSET GREATEST(_offset, 0)
  )
  SELECT jsonb_build_object(
    'items', COALESCE(jsonb_agg(to_jsonb(rows)), '[]'::jsonb),
    'total', (
      SELECT count(*) FROM public.broadcast_deliveries d
      WHERE d.campaign_id = _campaign_id
        AND (_status IS NULL OR d.status = _status)
    ),
    'limit', LEAST(GREATEST(_limit, 1), 100),
    'offset', GREATEST(_offset, 0)
  ) INTO v_result
  FROM rows;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_broadcast_campaign_recipients(uuid, integer, integer, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_broadcast_campaign_recipients(uuid, integer, integer, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_broadcast_campaign_links(_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL
     OR NOT public.has_admin_section_access((SELECT auth.uid()), 'communication', 'view') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', l.id,
      'channel', l.channel,
      'url', l.original_url,
      'label', l.label,
      'unique_human_clicks', (
        SELECT count(DISTINCT e.delivery_id)
        FROM public.broadcast_events e
        WHERE e.link_id = l.id AND e.event_type = 'click' AND NOT e.is_machine
      ),
      'total_clicks', (
        SELECT count(*)
        FROM public.broadcast_events e
        WHERE e.link_id = l.id AND e.event_type = 'click'
      ),
      'machine_clicks', (
        SELECT count(*)
        FROM public.broadcast_events e
        WHERE e.link_id = l.id AND e.event_type = 'click' AND e.is_machine
      )
    ) ORDER BY l.channel, l.position, l.created_at)
    FROM public.broadcast_links l
    WHERE l.campaign_id = _campaign_id
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_broadcast_campaign_links(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_broadcast_campaign_links(uuid) TO authenticated;

COMMENT ON TABLE public.broadcast_campaigns IS
  'Canonical header for every quick, scheduled, recurring or automated broadcast.';
COMMENT ON TABLE public.broadcast_deliveries IS
  'Recipient-level delivery journal. Does not duplicate canonical order/payment amounts.';
COMMENT ON COLUMN public.broadcast_deliveries.first_opened_at IS
  'Observed email open signal; not proof that a human read the message. Unavailable for Telegram Bot API.';
COMMENT ON TABLE public.broadcast_events IS
  'Append-only communication events; machine/proxy activity is classified separately.';