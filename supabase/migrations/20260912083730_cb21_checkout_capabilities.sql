-- Narrow server capability, not an administrator session. No campaign is enabled.
CREATE TABLE public.sales_checkout_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 job_id uuid NOT NULL UNIQUE REFERENCES public.sales_jobs(id),
 conversation_id uuid NOT NULL REFERENCES public.sales_conversations(id),
 quote_fingerprint text NOT NULL,
 document_started_at timestamptz,
 UNIQUE(conversation_id,quote_fingerprint),
 endpoint text NOT NULL CHECK(endpoint IN ('admin-create-public-link','public-rr-installment-initiate','admin-invoice-checkout-issue')),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 request_body jsonb NOT NULL,
 status text NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','consumed','completed','unknown')),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '2 minutes',
 result_url text, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sales_checkout_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_checkout_operations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.sales_checkout_operations TO service_role;

CREATE FUNCTION public.sales_cb_alumni_eligibility(p_user uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH eligible_orders AS (
 SELECT o.* FROM public.orders_v2 o
 WHERE (o.user_id=p_user OR o.profile_id IN (SELECT id FROM public.profiles WHERE user_id=p_user))
   AND NOT o.is_deleted AND NOT o.is_trial AND o.status::text='paid' AND o.final_price>0
   AND o.product_id IN ('7101ed3c-7839-4a74-ad95-aa0660369b22','3e43fb28-8322-41bc-bfee-714731bdc630')
   AND (o.product_id<>'7101ed3c-7839-4a74-ad95-aa0660369b22' OR coalesce(o.deal_date,o.created_at)>='2024-01-01'::timestamptz)
   AND coalesce(o.tariff_id::text,'') NOT IN ('04e6c302-f1ff-4d7d-a588-d30681e7a450','trf_191190b6-158')
   AND NOT EXISTS(SELECT 1 FROM public.payments_v2 pm WHERE pm.order_id=o.id AND NOT pm.is_deleted
     AND (pm.status::text='refunded' OR coalesce(pm.refunded_amount,0)>0 OR pm.transaction_type='refund'))
 ), proofs AS (
 SELECT o.id,
 CASE WHEN (SELECT coalesce(sum(pm.amount),0) FROM public.payments_v2 pm
   WHERE pm.order_id=o.id AND NOT pm.is_deleted AND pm.status::text='succeeded' AND pm.amount>0 AND pm.currency=o.currency)>=o.final_price THEN 'provider'
 WHEN o.product_id='7101ed3c-7839-4a74-ad95-aa0660369b22' AND o.deal_date>='2024-01-01'::timestamptz
   AND coalesce(o.meta->>'gc_deal_id','')<>'' AND coalesce(o.meta->>'import_source','')<>'' THEN 'getcourse_paid_import'
 END AS proof FROM eligible_orders o
 )
 SELECT jsonb_build_object('eligible',EXISTS(SELECT 1 FROM proofs WHERE proof IS NOT NULL),
   'proof',coalesce((SELECT proof FROM proofs WHERE proof IS NOT NULL ORDER BY proof='provider' DESC LIMIT 1),'unverified'));
$$;

CREATE FUNCTION public.sales_consume_checkout_capability(p_hash text,p_endpoint text,p_body jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE op public.sales_checkout_operations; j public.sales_jobs; c public.sales_conversations; p public.sales_campaigns;
BEGIN
 SELECT * INTO op FROM public.sales_checkout_operations WHERE token_hash=p_hash FOR UPDATE;
 IF NOT FOUND OR op.status<>'prepared' OR op.expires_at<=clock_timestamp() OR op.endpoint<>p_endpoint OR op.request_body<>p_body THEN RETURN NULL; END IF;
 SELECT * INTO j FROM public.sales_jobs WHERE id=op.job_id;
 SELECT * INTO c FROM public.sales_conversations WHERE id=j.conversation_id FOR UPDATE;
 SELECT * INTO p FROM public.sales_campaigns WHERE id=c.campaign_id;
 IF op.conversation_id IS DISTINCT FROM c.id OR p.mode<>'owner_test' OR p.policy_version<>'cb21-v2' OR c.human_hold OR c.state<>'READY'
   OR c.revision<>j.revision OR c.last_inbound_seq<>j.inbound_seq OR c.answered_seq>=j.inbound_seq OR j.status<>'claimed'
   OR p.knowledge->>'checkout_enabled' IS DISTINCT FROM 'true'
   OR NOT public.has_admin_section_access(p.assignee_user_id,'payments','edit')
   OR coalesce(p_body->>'user_id',p_body->>'target_user_id') IS DISTINCT FROM p.test_user_id::text
   OR p_body->>'responsible_user_id' IS DISTINCT FROM p.assignee_user_id::text
   OR NOT public.sales_delivery_gate(j.id) THEN RETURN NULL; END IF;
 UPDATE public.sales_checkout_operations SET status='consumed' WHERE id=op.id;
 INSERT INTO public.sales_events(conversation_id,event,source_message_id,details)
 VALUES(c.id,'checkout_authorized',j.inbound_id,jsonb_build_object('operation_id',op.id,'endpoint',p_endpoint));
 RETURN p.assignee_user_id;
END $$;
REVOKE ALL ON FUNCTION public.sales_cb_alumni_eligibility(uuid),public.sales_consume_checkout_capability(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sales_cb_alumni_eligibility(uuid),public.sales_consume_checkout_capability(text,text,jsonb) TO service_role;

CREATE FUNCTION public.sales_authorize_invoice_document(p_hash text,p_body jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE op public.sales_checkout_operations; o public.orders_v2; p public.sales_campaigns; c public.sales_conversations; j public.sales_jobs;
BEGIN
 SELECT * INTO op FROM public.sales_checkout_operations WHERE token_hash=p_hash FOR UPDATE;
 IF NOT FOUND OR op.endpoint<>'admin-invoice-checkout-issue' OR op.status<>'consumed' OR op.expires_at<=clock_timestamp() OR op.document_started_at IS NOT NULL
  OR p_body<>jsonb_build_object('order_id',p_body->>'order_id','mode','generate','pre_payment_invoice',true) THEN RETURN NULL; END IF;
 SELECT * INTO o FROM public.orders_v2 WHERE id=(p_body->>'order_id')::uuid;
 SELECT * INTO c FROM public.sales_conversations WHERE id=op.conversation_id FOR UPDATE;
 SELECT * INTO j FROM public.sales_jobs WHERE id=op.job_id;
 SELECT * INTO p FROM public.sales_campaigns WHERE id=c.campaign_id;
 IF p.mode<>'owner_test' OR c.human_hold OR c.revision<>j.revision OR c.last_inbound_seq<>j.inbound_seq OR j.status<>'claimed' OR NOT public.sales_delivery_gate(j.id) THEN RETURN NULL; END IF;
 IF o.meta->>'sales_checkout_operation_id' IS DISTINCT FROM op.id::text OR o.user_id IS DISTINCT FROM p.test_user_id
   OR o.product_id IS DISTINCT FROM p.product_id OR o.offer_id::text IS DISTINCT FROM op.request_body->>'offer_id'
   OR o.meta->>'checkout_kind' IS DISTINCT FROM 'invoice' OR o.meta->>'awaits_payment' IS DISTINCT FROM 'true'
   OR NOT public.has_admin_section_access(p.assignee_user_id,'payments','edit') THEN RETURN NULL; END IF;
 UPDATE public.sales_checkout_operations SET document_started_at=clock_timestamp() WHERE id=op.id;
 RETURN p.assignee_user_id;
END $$;
REVOKE ALL ON FUNCTION public.sales_authorize_invoice_document(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sales_authorize_invoice_document(text,jsonb) TO service_role;
