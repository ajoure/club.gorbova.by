-- Read-only attempt history. No payment, order, provider or access mutations.
BEGIN;
CREATE FUNCTION public.admin_get_contact_failed_attempts(p_profile_id uuid)
RETURNS TABLE(id uuid,provider_payment_id text,amount numeric,currency text,attempted_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(public.has_admin_section_access(auth.uid(),'payments','view'),false)
 THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 RETURN QUERY WITH attempts AS (
 SELECT DISTINCT ON (q.bepaid_uid) q.id,q.bepaid_uid AS provider_payment_id,q.amount::numeric AS amount,q.currency,q.paid_at AS attempted_at
 FROM public.profiles p
 JOIN public.subscriptions_v2 s ON s.profile_id=p.id AND s.user_id=p.user_id
 JOIN public.provider_subscriptions ps ON ps.subscription_v2_id=s.id
   AND ps.profile_id=p.id AND ps.user_id=p.user_id AND ps.provider='bepaid'
 JOIN public.payment_reconcile_queue q ON q.raw_payload->>'id'=ps.provider_subscription_id
 WHERE p.id=p_profile_id AND q.provider='bepaid' AND q.source='webhook'
   AND NOT coalesce(q.is_fee,false) AND NOT coalesce(q.has_conflict,false)
   AND ps.provider_subscription_id ~ '^sbs_[a-zA-Z0-9]+$'
   AND (SELECT count(*) FROM public.provider_subscriptions other
     WHERE other.provider='bepaid' AND other.provider_subscription_id=ps.provider_subscription_id)=1
   AND (q.matched_profile_id IS NULL OR q.matched_profile_id=p.id)
   AND (q.matched_order_id IS NULL OR EXISTS(SELECT 1 FROM public.orders_v2 o
     WHERE o.id=q.matched_order_id AND o.profile_id=p.id AND o.user_id=p.user_id))
   AND q.bepaid_uid IS NOT NULL AND length(q.bepaid_uid)>0
   AND q.raw_payload#>>'{transaction,uid}'=q.bepaid_uid
   AND q.raw_payload#>>'{transaction,status}'='failed'
   AND q.transaction_type IN('payment','capture','Оплата','Платеж')
   AND (q.raw_payload#>>'{transaction,type}' IS NULL
     OR q.raw_payload#>>'{transaction,type}' IN('payment','capture'))
   AND q.raw_payload->>'state'='failed_attempt'
   AND q.status_normalized='failed' AND q.amount>0 AND q.paid_at IS NOT NULL
   AND q.currency ~ '^[A-Z]{3}$'
   AND q.raw_payload#>>'{transaction,currency}'=q.currency
   AND NOT EXISTS(SELECT 1 FROM public.payments_v2 pay
     WHERE pay.provider='bepaid' AND pay.provider_payment_id=q.bepaid_uid)
 ORDER BY q.bepaid_uid,q.created_at DESC,q.id
 ) SELECT a.id,a.provider_payment_id,a.amount,a.currency,a.attempted_at FROM attempts a
 ORDER BY a.attempted_at DESC,a.id LIMIT 100;
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_get_contact_failed_attempts(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_get_contact_failed_attempts(uuid) TO authenticated;
COMMIT;
