-- Phase 5B — additive Company ↔ Order/Deal and Company ↔ Task links.
--
-- This migration deliberately does not alter orders_v2 writers. Deals are represented
-- by orders_v2, which is payment-critical and has no reliable historic billing-CLD FK.

BEGIN;

CREATE TABLE IF NOT EXISTS public.company_order_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid
    REFERENCES public.tenants(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES public.orders_v2(id) ON DELETE RESTRICT,
  relationship_role text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  source_client_legal_details_id uuid
    REFERENCES public.client_legal_details(id) ON DELETE RESTRICT,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  unlinked_at timestamptz,
  unlinked_by uuid,
  unlink_reason text,
  CONSTRAINT company_order_links_role_chk CHECK (relationship_role IN
    ('customer','payer','beneficiary','contract_party','employer','partner')),
  CONSTRAINT company_order_links_source_chk CHECK (source IN
    ('manual','billing_requisites','migration','integration')),
  CONSTRAINT company_order_links_manual_lineage_chk CHECK
    (source <> 'manual' OR source_client_legal_details_id IS NULL),
  CONSTRAINT company_order_links_unlink_audit_chk CHECK
    (unlinked_at IS NULL OR (unlinked_by IS NOT NULL AND length(trim(coalesce(unlink_reason, ''))) >= 3))
);

CREATE UNIQUE INDEX IF NOT EXISTS company_order_links_active_uniq
  ON public.company_order_links(company_id, order_id, relationship_role)
  WHERE unlinked_at IS NULL;
CREATE INDEX IF NOT EXISTS company_order_links_company_idx
  ON public.company_order_links(workspace_id, company_id, created_at DESC)
  WHERE unlinked_at IS NULL;
CREATE INDEX IF NOT EXISTS company_order_links_order_idx
  ON public.company_order_links(order_id, created_at DESC)
  WHERE unlinked_at IS NULL;

DROP TRIGGER IF EXISTS update_company_order_links_updated_at ON public.company_order_links;
CREATE TRIGGER update_company_order_links_updated_at
  BEFORE UPDATE ON public.company_order_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.company_order_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_order_links FROM anon, authenticated;
GRANT SELECT ON public.company_order_links TO authenticated;
GRANT ALL ON public.company_order_links TO service_role;

DROP POLICY IF EXISTS company_order_links_staff_read ON public.company_order_links;
CREATE POLICY company_order_links_staff_read ON public.company_order_links
  FOR SELECT TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
    OR public.has_role_v2(auth.uid(), 'menedzher')
    OR public.has_role_v2(auth.uid(), 'support')
  );

-- The existing company helper remains private. This wrapper is itself private and
-- is called only from the controlled linking RPCs below.
CREATE OR REPLACE FUNCTION public._crm_company_order_activity(
  _event_type text,
  _company_id uuid,
  _order_id uuid,
  _link_id uuid,
  _relationship_role text,
  _actor_user_id uuid,
  _idempotency_key text,
  _metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF _event_type NOT IN ('company.linked_to_order.v1', 'company.unlinked_from_order.v1') THEN
    RAISE EXCEPTION 'bad_company_order_event' USING ERRCODE='22023';
  END IF;
  IF _actor_user_id IS NULL OR _idempotency_key IS NULL OR length(_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'bad_company_order_event_input' USING ERRCODE='22023';
  END IF;

  PERFORM public._crm_company_emit_domain_event(
    _event_type,
    _company_id,
    _idempotency_key,
    jsonb_build_object(
      'version', 1,
      'company_id', _company_id,
      'order_id', _order_id,
      'link_id', _link_id,
      'relationship_role', _relationship_role,
      'actor_user_id', _actor_user_id,
      'occurred_at', now(),
      'idempotency_key', _idempotency_key,
      'metadata', coalesce(_metadata, '{}'::jsonb)
    )
  );

  INSERT INTO public.crm_activity_log(
    activity_type, source_entity_id, source_entity_type, user_id,
    idempotency_key, metadata
  ) VALUES (
    replace(_event_type, '.v1', ''), _company_id, 'company', _actor_user_id,
    _idempotency_key,
    jsonb_build_object('order_id', _order_id, 'link_id', _link_id,
                       'relationship_role', _relationship_role,
                       'metadata', coalesce(_metadata, '{}'::jsonb))
  ) ON CONFLICT (idempotency_key) DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.crm_company_link_order(
  _company_id uuid,
  _order_id uuid,
  _relationship_role text,
  _metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_company public.companies%ROWTYPE;
  v_link public.company_order_links%ROWTYPE;
  v_role text := lower(trim(coalesce(_relationship_role, '')));
  v_key text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE='42501'; END IF;
  IF NOT (public.has_role_v2(v_actor, 'admin') OR public.has_role_v2(v_actor, 'super_admin')
          OR public.has_role_v2(v_actor, 'menedzher')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF v_role NOT IN ('customer','payer','beneficiary','contract_party','employer','partner') THEN
    RAISE EXCEPTION 'invalid_relationship_role' USING ERRCODE='22023';
  END IF;
  IF _metadata IS NULL OR jsonb_typeof(_metadata) <> 'object' THEN
    RAISE EXCEPTION 'invalid_metadata' USING ERRCODE='22023';
  END IF;

  -- Stable order locks avoid a concurrent duplicate link even before the unique index.
  SELECT * INTO v_company FROM public.companies WHERE id = _company_id FOR UPDATE;
  IF v_company.id IS NULL OR v_company.status <> 'active' THEN
    RAISE EXCEPTION 'company_not_active' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM public.orders_v2 WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE='23503'; END IF;

  SELECT * INTO v_link FROM public.company_order_links
   WHERE company_id = _company_id AND order_id = _order_id
     AND relationship_role = v_role AND unlinked_at IS NULL
   FOR UPDATE;
  IF v_link.id IS NOT NULL THEN
    RETURN v_link.id;
  END IF;

  INSERT INTO public.company_order_links(
    workspace_id, company_id, order_id, relationship_role, source,
    metadata, created_by, updated_by
  ) VALUES (
    v_company.workspace_id, _company_id, _order_id, v_role, 'manual',
    _metadata, v_actor, v_actor
  ) RETURNING * INTO v_link;

  v_key := 'company.linked_to_order:' || v_link.id::text;
  PERFORM public._crm_company_order_activity(
    'company.linked_to_order.v1', _company_id, _order_id, v_link.id,
    v_role, v_actor, v_key, _metadata
  );
  RETURN v_link.id;
END $$;

CREATE OR REPLACE FUNCTION public.crm_company_unlink_order(
  _link_id uuid,
  _reason text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_link public.company_order_links%ROWTYPE;
  v_reason text := trim(coalesce(_reason, ''));
  v_key text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE='42501'; END IF;
  IF NOT (public.has_role_v2(v_actor, 'admin') OR public.has_role_v2(v_actor, 'super_admin')
          OR public.has_role_v2(v_actor, 'menedzher')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF length(v_reason) < 3 OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_link FROM public.company_order_links WHERE id = _link_id FOR UPDATE;
  IF v_link.id IS NULL THEN RAISE EXCEPTION 'company_order_link_not_found' USING ERRCODE='23503'; END IF;
  IF v_link.unlinked_at IS NOT NULL THEN RETURN false; END IF;

  UPDATE public.company_order_links
     SET unlinked_at = now(), unlinked_by = v_actor, unlink_reason = v_reason,
         updated_by = v_actor
   WHERE id = v_link.id;

  v_key := 'company.unlinked_from_order:' || v_link.id::text;
  PERFORM public._crm_company_order_activity(
    'company.unlinked_from_order.v1', v_link.company_id, v_link.order_id,
    v_link.id, v_link.relationship_role, v_actor, v_key,
    jsonb_build_object('reason', v_reason)
  );
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public._crm_company_order_activity(text,uuid,uuid,uuid,text,uuid,text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_company_link_order(uuid,uuid,text,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_company_unlink_order(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_company_link_order(uuid,uuid,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_unlink_order(uuid,text) TO authenticated;

ALTER TABLE public.crm_tasks
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS crm_tasks_workspace_company_status_due_idx
  ON public.crm_tasks(workspace_id, company_id, status, due_at)
  WHERE company_id IS NOT NULL;

-- Extend the existing task RPC rather than creating a competing writer.
CREATE OR REPLACE FUNCTION public.crm_task_create(payload jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid(); _type_key text; _type_id uuid;
  _type_row public.crm_task_types%ROWTYPE; _title text;
  _due_at timestamptz; _remind_at timestamptz; _source text; _new_id uuid;
  _company_id uuid; _company public.companies%ROWTYPE;
BEGIN
  PERFORM public._crm_tasks_assert_staff();
  IF payload IS NULL OR jsonb_typeof(payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE='22023';
  END IF;
  _title := nullif(trim(payload->>'title'), '');
  IF _title IS NULL THEN RAISE EXCEPTION 'title_required' USING ERRCODE='22023'; END IF;
  IF payload ? 'task_type_id' AND nullif(payload->>'task_type_id','') IS NOT NULL THEN
    _type_id := (payload->>'task_type_id')::uuid;
    SELECT * INTO _type_row FROM public.crm_task_types WHERE id = _type_id;
  ELSIF payload ? 'task_type' AND nullif(payload->>'task_type','') IS NOT NULL THEN
    _type_key := payload->>'task_type';
    SELECT * INTO _type_row FROM public.crm_task_types WHERE key = _type_key AND is_active = true;
  ELSE RAISE EXCEPTION 'task_type_required' USING ERRCODE='22023'; END IF;
  IF _type_row.id IS NULL THEN RAISE EXCEPTION 'task_type_not_found' USING ERRCODE='22023'; END IF;

  _company_id := nullif(payload->>'company_id','')::uuid;
  IF _company_id IS NOT NULL THEN
    SELECT * INTO _company FROM public.companies WHERE id = _company_id;
    IF _company.id IS NULL OR _company.status <> 'active' THEN
      RAISE EXCEPTION 'company_not_active' USING ERRCODE='22023';
    END IF;
  END IF;

  IF payload ? 'due_at' AND nullif(payload->>'due_at','') IS NOT NULL THEN
    _due_at := (payload->>'due_at')::timestamptz;
  ELSIF _type_row.default_due_offset_minutes IS NOT NULL THEN
    _due_at := now() + make_interval(mins => _type_row.default_due_offset_minutes);
  END IF;
  IF payload ? 'remind_at' AND nullif(payload->>'remind_at','') IS NOT NULL THEN
    _remind_at := (payload->>'remind_at')::timestamptz;
  ELSIF _due_at IS NOT NULL AND _type_row.default_reminder_offset_minutes IS NOT NULL THEN
    _remind_at := _due_at - make_interval(mins => _type_row.default_reminder_offset_minutes);
  END IF;
  _source := coalesce(nullif(payload->>'source',''), 'manual');
  IF _source NOT IN ('manual','auto','system') THEN RAISE EXCEPTION 'invalid_source' USING ERRCODE='22023'; END IF;

  INSERT INTO public.crm_tasks(
    task_type_id,title,description,contact_id,company_id,deal_id,order_id,
    pipeline_id,pipeline_stage_id,offer_id,product_id,tariff_id,
    assignee_user_id,due_at,remind_at,status,source,automation_rule_id,
    created_by,updated_by,meta
  ) VALUES (
    _type_row.id,_title,nullif(payload->>'description',''),
    nullif(payload->>'contact_id','')::uuid,_company_id,
    nullif(payload->>'deal_id','')::uuid,nullif(payload->>'order_id','')::uuid,
    nullif(payload->>'pipeline_id','')::uuid,nullif(payload->>'pipeline_stage_id','')::uuid,
    nullif(payload->>'offer_id','')::uuid,nullif(payload->>'product_id','')::uuid,
    nullif(payload->>'tariff_id','')::uuid,nullif(payload->>'assignee_user_id','')::uuid,
    _due_at,_remind_at,coalesce(nullif(payload->>'status',''),'open'),_source,
    nullif(payload->>'automation_rule_id','')::uuid,_uid,_uid,
    coalesce(payload->'meta','{}'::jsonb)
  ) RETURNING id INTO _new_id;
  RETURN _new_id;
END $$;

CREATE OR REPLACE FUNCTION public.crm_task_list(_filters jsonb DEFAULT '{}'::jsonb)
RETURNS SETOF public.crm_tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _assignee uuid; _statuses text[]; _type_ids uuid[]; _deal_id uuid;
  _contact_id uuid; _company_id uuid; _due_from timestamptz; _due_to timestamptz;
  _bucket text; _search text; _limit int; _offset int;
BEGIN
  PERFORM public._crm_tasks_assert_staff();
  _assignee := nullif(_filters->>'assignee_user_id','')::uuid;
  _statuses := CASE WHEN jsonb_typeof(_filters->'status')='array'
                    THEN ARRAY(SELECT jsonb_array_elements_text(_filters->'status')) ELSE NULL END;
  _type_ids := CASE WHEN jsonb_typeof(_filters->'task_type_id')='array'
                   THEN ARRAY(SELECT (jsonb_array_elements_text(_filters->'task_type_id'))::uuid) ELSE NULL END;
  _deal_id := nullif(_filters->>'deal_id','')::uuid;
  _contact_id := nullif(_filters->>'contact_id','')::uuid;
  _company_id := nullif(_filters->>'company_id','')::uuid;
  _due_from := nullif(_filters->>'due_from','')::timestamptz;
  _due_to := nullif(_filters->>'due_to','')::timestamptz;
  _bucket := nullif(_filters->>'bucket',''); _search := nullif(trim(_filters->>'search'),'');
  _limit := least(greatest(COALESCE(nullif(_filters->>'limit','')::int,200),1),500);
  _offset := greatest(COALESCE(nullif(_filters->>'offset','')::int,0),0);
  RETURN QUERY SELECT t.* FROM public.crm_tasks t
   WHERE (_assignee IS NULL OR t.assignee_user_id=_assignee)
     AND (_statuses IS NULL OR t.status=ANY(_statuses))
     AND (_type_ids IS NULL OR t.task_type_id=ANY(_type_ids))
     AND (_deal_id IS NULL OR t.deal_id=_deal_id)
     AND (_contact_id IS NULL OR t.contact_id=_contact_id)
     AND (_company_id IS NULL OR t.company_id=_company_id)
     AND (_due_from IS NULL OR t.due_at>=_due_from)
     AND (_due_to IS NULL OR t.due_at<=_due_to)
     AND (_bucket IS NULL
       OR (_bucket='overdue' AND t.status IN ('open','in_progress') AND t.due_at IS NOT NULL AND t.due_at<now())
       OR (_bucket='today' AND t.status IN ('open','in_progress') AND t.due_at::date=(now() AT TIME ZONE 'Europe/Minsk')::date)
       OR (_bucket='tomorrow' AND t.status IN ('open','in_progress') AND t.due_at::date=((now() AT TIME ZONE 'Europe/Minsk')::date+1))
       OR (_bucket='week' AND t.status IN ('open','in_progress') AND t.due_at>=now() AND t.due_at<now()+interval '7 days')
       OR (_bucket='later' AND t.status IN ('open','in_progress') AND t.due_at>=now()+interval '7 days')
       OR (_bucket='no_due' AND t.status IN ('open','in_progress') AND t.due_at IS NULL)
       OR (_bucket='closed' AND t.status IN ('done','canceled')))
     AND (_search IS NULL OR t.title ILIKE '%'||_search||'%' OR COALESCE(t.description,'') ILIKE '%'||_search||'%'
          OR COALESCE(t.public_id,'') ILIKE '%'||_search||'%')
   ORDER BY CASE WHEN t.status IN ('open','in_progress') THEN 0 ELSE 1 END,
            t.due_at NULLS LAST, t.created_at DESC
   LIMIT _limit OFFSET _offset;
END $$;

REVOKE ALL ON FUNCTION public.crm_task_create(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_task_list(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_task_create(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_task_list(jsonb) TO authenticated, service_role;

COMMIT;
