
-- ============================================================
-- PATCH 10: live_event_product_cta_bindings
-- ============================================================

CREATE TABLE public.live_event_product_cta_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE DEFAULT ('CTA-' || substr(gen_random_uuid()::text, 1, 8)),
  live_event_id uuid NOT NULL REFERENCES public.live_events(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products_v2(id),
  tariff_id uuid REFERENCES public.tariffs(id),
  offer_id uuid REFERENCES public.tariff_offers(id),
  cta_type text NOT NULL CHECK (cta_type IN ('buy_now','open_product','open_tariff','lead_form','preorder','external_link')),
  display_mode text NOT NULL DEFAULT 'manual' CHECK (display_mode IN ('manual','after_minutes','at_datetime','always')),
  position text NOT NULL DEFAULT 'under_video' CHECK (position IN ('under_video','sidebar','sticky')),
  show_after_minutes integer,
  show_at timestamptz,
  title_override text,
  description_override text,
  button_text_override text,
  image_override text,
  theme_override jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX idx_cta_bindings_live_event ON public.live_event_product_cta_bindings(live_event_id);
CREATE INDEX idx_cta_bindings_product ON public.live_event_product_cta_bindings(product_id);

ALTER TABLE public.live_event_product_cta_bindings ENABLE ROW LEVEL SECURITY;

-- Admin/employee CRUD
CREATE POLICY "Staff can manage CTA bindings"
  ON public.live_event_product_cta_bindings
  FOR ALL
  TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'admin') OR
    public.has_role_v2(auth.uid(), 'super_admin') OR
    public.has_role_v2(auth.uid(), 'employee')
  )
  WITH CHECK (
    public.has_role_v2(auth.uid(), 'admin') OR
    public.has_role_v2(auth.uid(), 'super_admin') OR
    public.has_role_v2(auth.uid(), 'employee')
  );

-- Users with event access can read active bindings
CREATE POLICY "Users with event access can read active CTA bindings"
  ON public.live_event_product_cta_bindings
  FOR SELECT
  TO authenticated
  USING (
    is_active = true AND
    public.user_has_live_event_access(auth.uid(), live_event_id)
  );

-- ============================================================
-- PATCH 10: live_event_cta_runtime_events
-- ============================================================

CREATE TABLE public.live_event_cta_runtime_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_event_id uuid NOT NULL REFERENCES public.live_events(id) ON DELETE CASCADE,
  binding_id uuid NOT NULL REFERENCES public.live_event_product_cta_bindings(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('shown','hidden','replaced','clicked','form_submitted')),
  trigger_mode text NOT NULL DEFAULT 'manual' CHECK (trigger_mode IN ('manual','scheduled','automatic')),
  shown_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX idx_cta_runtime_live_event ON public.live_event_cta_runtime_events(live_event_id);
CREATE INDEX idx_cta_runtime_binding ON public.live_event_cta_runtime_events(binding_id);

ALTER TABLE public.live_event_cta_runtime_events ENABLE ROW LEVEL SECURITY;

-- Staff can insert and read
CREATE POLICY "Staff can manage CTA runtime events"
  ON public.live_event_cta_runtime_events
  FOR ALL
  TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'admin') OR
    public.has_role_v2(auth.uid(), 'super_admin') OR
    public.has_role_v2(auth.uid(), 'employee')
  )
  WITH CHECK (
    public.has_role_v2(auth.uid(), 'admin') OR
    public.has_role_v2(auth.uid(), 'super_admin') OR
    public.has_role_v2(auth.uid(), 'employee')
  );

-- Users with event access can read runtime events for their event
CREATE POLICY "Users with event access can read CTA runtime events"
  ON public.live_event_cta_runtime_events
  FOR SELECT
  TO authenticated
  USING (
    public.user_has_live_event_access(auth.uid(), live_event_id)
  );

-- Enable realtime for runtime events (room needs live updates)
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_event_cta_runtime_events;

-- ============================================================
-- PATCH 14: Extend get_live_event_scenario with CTA events
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_live_event_scenario(
  _live_event_id uuid,
  _entry_type text DEFAULT NULL,
  _filter_user_id uuid DEFAULT NULL,
  _filter_visibility text DEFAULT NULL
)
RETURNS TABLE(
  entry_id uuid,
  entry_type text,
  user_id uuid,
  display_name text,
  entry_text text,
  visibility_scope text,
  created_at timestamptz,
  metadata jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT * FROM (
    SELECT c.id AS entry_id, 'comment'::text AS entry_type, c.user_id, c.author_display_name AS display_name, c.content AS entry_text, NULL::text AS visibility_scope, c.created_at, c.metadata
    FROM live_event_comments c WHERE c.live_event_id = _live_event_id
    UNION ALL
    SELECT q.id, 'question'::text, q.user_id, q.author_display_name, q.content, NULL::text, q.created_at, q.metadata
    FROM live_event_questions q WHERE q.live_event_id = _live_event_id
    UNION ALL
    SELECT r.id, 'reply'::text, r.created_by, NULL::text, r.reply_text, r.visibility_scope, r.created_at, r.metadata
    FROM live_event_replies r WHERE r.live_event_id = _live_event_id
    UNION ALL
    SELECT m.id, 'moderation'::text, m.created_by, NULL::text, m.action_type || ': ' || COALESCE(m.reason,''), NULL::text, m.created_at, m.metadata
    FROM live_event_room_moderation m WHERE m.live_event_id = _live_event_id
    UNION ALL
    SELECT re.id, ('cta_' || re.event_type)::text, re.shown_by, NULL::text,
      re.event_type || ': ' || COALESCE(b.title_override, p.name, ''),
      NULL::text, re.created_at,
      jsonb_build_object(
        'binding_id', re.binding_id,
        'product_id', b.product_id,
        'tariff_id', b.tariff_id,
        'offer_id', b.offer_id,
        'trigger_mode', re.trigger_mode,
        'cta_type', b.cta_type
      ) || COALESCE(re.metadata, '{}'::jsonb)
    FROM live_event_cta_runtime_events re
    JOIN live_event_product_cta_bindings b ON b.id = re.binding_id
    LEFT JOIN products_v2 p ON p.id = b.product_id
    WHERE re.live_event_id = _live_event_id
  ) t
  WHERE (_entry_type IS NULL OR t.entry_type = _entry_type)
    AND (_filter_user_id IS NULL OR t.user_id = _filter_user_id)
    AND (_filter_visibility IS NULL OR t.visibility_scope = _filter_visibility OR t.visibility_scope IS NULL)
  ORDER BY t.created_at;
$function$;
