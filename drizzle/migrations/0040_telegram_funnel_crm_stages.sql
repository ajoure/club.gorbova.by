-- Config only; the separately reviewed one-time operation installs actual cohort bindings.
CREATE TABLE public.telegram_funnel_crm_bindings (
 funnel_id uuid PRIMARY KEY REFERENCES public.telegram_funnels(id),
 pipeline_id uuid NOT NULL REFERENCES public.crm_pipelines(id),
 product_id uuid NOT NULL REFERENCES public.products_v2(id),
 block_stages jsonb NOT NULL CHECK(jsonb_typeof(block_stages)='object'),
 refusal_button_ids uuid[] NOT NULL DEFAULT '{}',
 refusal_stage_id uuid NOT NULL REFERENCES public.crm_pipeline_stages(id),
 paid_stage_id uuid NOT NULL REFERENCES public.crm_pipeline_stages(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.telegram_funnel_crm_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telegram_funnel_crm_bindings FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.telegram_funnel_crm_bindings TO authenticated;
GRANT ALL ON public.telegram_funnel_crm_bindings TO service_role;
CREATE POLICY communication_read ON public.telegram_funnel_crm_bindings FOR SELECT TO authenticated USING((SELECT public.telegram_funnel_can_manage()));
CREATE INDEX telegram_funnel_crm_cohort_orders ON public.orders_v2(pipeline_id,profile_id) WHERE meta->>'source'='telegram_funnel_cohort' AND NOT is_deleted;

-- Canonical sales statuses and genuine net successful receipts include the first installment.
CREATE FUNCTION public.telegram_funnel_crm_has_paid(p_profile uuid,p_product uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.orders_v2 o WHERE o.profile_id=p_profile AND o.product_id=p_product AND NOT o.is_deleted
 AND coalesce(o.meta->>'source','')<>'telegram_funnel_cohort' AND o.status NOT IN('canceled','refunded')
 AND (o.status='paid' OR (o.status='partial' AND coalesce(o.paid_amount,0)>0) OR EXISTS(SELECT 1 FROM public.payments_v2 p WHERE p.order_id=o.id AND NOT p.is_deleted AND p.status='succeeded'
 AND coalesce(p.transaction_type,'payment') NOT IN('refund','void','authorization','tokenization','Отмена') AND p.amount>coalesce(p.refunded_amount,0))));
$$;
REVOKE ALL ON FUNCTION public.telegram_funnel_crm_has_paid(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_funnel_crm_has_paid(uuid,uuid) TO service_role;

CREATE FUNCTION public.telegram_funnel_crm_move(p_profile uuid,p_pipeline uuid,p_stage uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target public.crm_pipeline_stages; d record;
BEGIN
 SELECT * INTO target FROM public.crm_pipeline_stages WHERE id=p_stage AND pipeline_id=p_pipeline;
 IF NOT FOUND THEN RAISE EXCEPTION 'funnel_crm_stage_invalid';END IF;
 -- Lock each tracking deal; paid wins over refusal, refusal wins over message progress.
 FOR d IN SELECT o.id,o.pipeline_stage_id FROM public.orders_v2 o WHERE o.profile_id=p_profile AND o.pipeline_id=p_pipeline AND NOT o.is_deleted AND o.meta->>'source'='telegram_funnel_cohort' ORDER BY o.id FOR UPDATE LOOP
  IF d.pipeline_stage_id IS DISTINCT FROM target.id AND NOT EXISTS(SELECT 1 FROM public.crm_pipeline_stages old WHERE old.id=d.pipeline_stage_id AND (old.stage_type='closed_won' OR (old.stage_type='closed_lost' AND target.stage_type<>'closed_won') OR (target.stage_type='open' AND old.order_index>=target.order_index))) THEN
   UPDATE public.orders_v2 SET pipeline_stage_id=target.id WHERE id=d.id;
   INSERT INTO public.audit_logs(action,actor_type,entity_type,entity_id,meta) VALUES('telegram_funnel_deal_stage','system','deal',d.id::text,jsonb_build_object('from_stage',d.pipeline_stage_id,'to_stage',target.id));
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.telegram_funnel_crm_move(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_funnel_crm_move(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.telegram_funnel_crm_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.telegram_funnel_enrollments; c public.telegram_funnel_crm_bindings; d public.telegram_funnel_deliveries; target uuid;
BEGIN
 IF NEW.kind NOT IN('sent','finished') THEN RETURN NEW;END IF;
 SELECT * INTO e FROM public.telegram_funnel_enrollments WHERE id=NEW.enrollment_id;
 SELECT * INTO c FROM public.telegram_funnel_crm_bindings WHERE funnel_id=e.funnel_id;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.telegram_funnel_launches WHERE id=e.launch_id AND test_profile_id IS NOT NULL) THEN RETURN NEW;END IF;
 IF public.telegram_funnel_crm_has_paid(e.profile_id,c.product_id) THEN target:=c.paid_stage_id;
 ELSIF NEW.kind='finished' THEN
  IF NOT coalesce((NEW.detail->>'button_id')::uuid=ANY(c.refusal_button_ids),false) THEN RETURN NEW;END IF;
  target:=c.refusal_stage_id;
 ELSE
  SELECT * INTO d FROM public.telegram_funnel_deliveries WHERE id=NEW.delivery_id AND enrollment_id=e.id AND status='sent';
  IF NOT FOUND THEN RETURN NEW;END IF;
  target:=(c.block_stages->>d.block_id::text)::uuid;
 END IF;
 IF target IS NOT NULL THEN PERFORM public.telegram_funnel_crm_move(e.profile_id,c.pipeline_id,target);END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.telegram_funnel_crm_event() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER telegram_funnel_crm_event AFTER INSERT ON public.telegram_funnel_events FOR EACH ROW EXECUTE FUNCTION public.telegram_funnel_crm_event();

CREATE FUNCTION public.telegram_funnel_crm_order_paid() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c record; profile uuid; product uuid;
BEGIN
 IF TG_TABLE_NAME='payments_v2' THEN
  SELECT profile_id,product_id INTO profile,product FROM public.orders_v2 WHERE id=NEW.order_id AND NOT is_deleted AND coalesce(meta->>'source','')<>'telegram_funnel_cohort';
 ELSE
  IF NEW.is_deleted OR NEW.meta->>'source'='telegram_funnel_cohort' THEN RETURN NEW;END IF;
  profile:=NEW.profile_id;product:=NEW.product_id;
 END IF;
 IF profile IS NOT NULL AND public.telegram_funnel_crm_has_paid(profile,product) THEN
  FOR c IN SELECT DISTINCT pipeline_id,paid_stage_id FROM public.telegram_funnel_crm_bindings WHERE product_id=product LOOP
   PERFORM public.telegram_funnel_crm_move(profile,c.pipeline_id,c.paid_stage_id);
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.telegram_funnel_crm_order_paid() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER telegram_funnel_crm_order_paid AFTER INSERT OR UPDATE OF status,paid_amount ON public.orders_v2 FOR EACH ROW EXECUTE FUNCTION public.telegram_funnel_crm_order_paid();
CREATE TRIGGER telegram_funnel_crm_payment_paid AFTER INSERT OR UPDATE OF status,refunded_amount,is_deleted ON public.payments_v2 FOR EACH ROW EXECUTE FUNCTION public.telegram_funnel_crm_order_paid();
