-- An evidenced correction of an existing paid Club right, never a payment,
-- wallet credit, order, extension, or a claim that an entire month was bought.
BEGIN;

DO $preflight$
DECLARE r record; grants text[]; expected text[];
BEGIN
  IF to_regclass('private.club_paid_lesson_corrections') IS NOT NULL THEN
    RAISE EXCEPTION 'paid_lesson_migration_already_present_verify_history';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.has_month_purchase_bulk(uuid,jsonb)'::regprocedure
      AND md5(prosrc)='46bede9bb2ca48be8362285cfdadc5a1' AND prosecdef AND provolatile='s')
    OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.user_has_training_lesson_access(uuid,uuid)'::regprocedure
      AND md5(prosrc)='f637058db4edb7f6daea8257727e8b60' AND prosecdef AND provolatile='s')
    OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.has_month_purchase(uuid,uuid,text)'::regprocedure
      AND md5(prosrc)='79b2c0572e2d5a15f5302b1d276fa212') THEN
    RAISE EXCEPTION 'paid_lesson_baseline_drift';
  END IF;
  FOR r IN SELECT p.* FROM pg_proc p WHERE p.oid IN(
    'public.has_month_purchase(uuid,uuid,text)'::regprocedure,
    'public.has_month_purchase_bulk(uuid,jsonb)'::regprocedure,
    'public.user_has_training_lesson_access(uuid,uuid)'::regprocedure)
  LOOP
    SELECT array_agg(a.grantee::regrole::text ORDER BY a.grantee::regrole::text)
      INTO grants FROM aclexplode(r.proacl) a;
    expected:=ARRAY['authenticated','postgres','sandbox_exec_hdjgkjceownmmnrqqtuz','service_role'];
    IF r.proname='user_has_training_lesson_access' THEN expected:=ARRAY['anon']||expected; END IF;
    IF pg_get_userbyid(r.proowner)<>'postgres' OR grants IS DISTINCT FROM expected
      OR EXISTS(SELECT 1 FROM aclexplode(r.proacl) a
        WHERE a.grantor<>r.proowner OR a.is_grantable OR a.privilege_type<>'EXECUTE')
      OR r.proconfig IS DISTINCT FROM (CASE WHEN r.proname='user_has_training_lesson_access'
        THEN ARRAY['search_path=public, pg_temp'] ELSE ARRAY['search_path=public'] END)
      THEN RAISE EXCEPTION 'paid_lesson_baseline_permissions_drift'; END IF;
  END LOOP;
END;
$preflight$;

CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE private.club_paid_lesson_corrections (
  correction_key uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  profile_id uuid NOT NULL REFERENCES public.profiles(id),
  lesson_id uuid NOT NULL REFERENCES public.training_lessons(id),
  tariff_id uuid NOT NULL REFERENCES public.tariffs(id),
  deal_month text NOT NULL CHECK (deal_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  source_subscription_id uuid NOT NULL REFERENCES public.subscriptions_v2(id),
  source_payment_id uuid NOT NULL REFERENCES public.payments_v2(id),
  rule_id uuid NOT NULL REFERENCES public.access_rules(id),
  agreement_amount numeric NOT NULL CHECK (agreement_amount > 0),
  valid_until timestamptz NOT NULL,
  evidence_ref text NOT NULL CHECK (length(evidence_ref) BETWEEN 16 AND 256),
  operator_ref text NOT NULL CHECK (length(operator_ref) BETWEEN 1 AND 96),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  revoked_at timestamptz
);
CREATE UNIQUE INDEX club_paid_lesson_one_active
  ON private.club_paid_lesson_corrections(user_id,lesson_id) WHERE revoked_at IS NULL;
CREATE INDEX club_paid_lesson_lookup
  ON private.club_paid_lesson_corrections(user_id,tariff_id,deal_month) WHERE revoked_at IS NULL;
ALTER TABLE private.club_paid_lesson_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.club_paid_lesson_corrections FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE private.club_paid_lesson_correction_audit (
  correction_key uuid PRIMARY KEY REFERENCES private.club_paid_lesson_corrections(correction_key),
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  operator_ref text NOT NULL,
  evidence_ref text NOT NULL,
  snapshot jsonb NOT NULL
);
ALTER TABLE private.club_paid_lesson_correction_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.club_paid_lesson_correction_audit FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.club_month_rule_allows_lesson(c jsonb,l uuid,m uuid)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT CASE WHEN jsonb_typeof(c)='object'
   AND c->'match_purchase_month'='true'::jsonb
   AND c-ARRAY['match_purchase_month','access_mode','allowed_module_ids','allowed_lesson_ids']='{}'::jsonb
   AND coalesce(c->>'access_mode','full') IN('full','partial')
   AND coalesce(jsonb_typeof(c->'allowed_module_ids'),'array')='array'
   AND coalesce(jsonb_typeof(c->'allowed_lesson_ids'),'array')='array'
 THEN coalesce(
   (coalesce(c->>'access_mode','full')='full'
     AND coalesce(c->'allowed_module_ids','[]'::jsonb)='[]'::jsonb
     AND coalesce(c->'allowed_lesson_ids','[]'::jsonb)='[]'::jsonb)
   OR (c->'allowed_module_ids') ? m::text OR (c->'allowed_lesson_ids') ? l::text,false)
 ELSE false END;
$fn$;
REVOKE ALL ON FUNCTION private.club_month_rule_allows_lesson(jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.club_paid_lesson_claim_valid(c private.club_paid_lesson_corrections)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $fn$
 WITH RECURSIVE chain AS (
   SELECT m.id,m.parent_module_id,m.product_id,m.is_active,ARRAY[m.id] seen
     FROM public.training_modules m JOIN public.training_lessons l ON l.module_id=m.id
     WHERE l.id=c.lesson_id
   UNION ALL
   SELECT m.id,m.parent_module_id,m.product_id,m.is_active,a.seen||m.id
     FROM public.training_modules m JOIN chain a ON m.id=a.parent_module_id
     WHERE NOT m.id=ANY(a.seen) AND cardinality(a.seen)<12
 )
 SELECT coalesce(c.revoked_at IS NULL AND c.valid_until>now() AND EXISTS (
   SELECT 1 FROM public.training_lessons l
   JOIN public.subscriptions_v2 s ON s.id=c.source_subscription_id
   JOIN public.profiles p ON p.id=c.profile_id
   JOIN public.payments_v2 pay ON pay.id=c.source_payment_id
   JOIN public.access_rules r ON r.id=c.rule_id
   WHERE l.id=c.lesson_id AND l.is_active
     AND left(l.content_month::text,7)=c.deal_month
     AND public.training_release_guard(l.id)
     AND p.user_id=c.user_id AND s.profile_id=p.id AND s.user_id=p.user_id
     -- This correction mechanism is only for the existing canonical Club.
     AND s.product_id='11c9f1b8-0355-4753-bd74-40b42aa53616'::uuid
     AND s.tariff_id=c.tariff_id AND s.status::text='active'
     AND s.access_start_at<=now() AND s.access_end_at>now()
     AND s.access_start_at<(c.deal_month||'-01')::date+interval '1 month'
     AND s.access_end_at>(c.deal_month||'-01')::date
     AND pay.profile_id=p.id AND pay.status='succeeded' AND pay.currency='BYN'
     AND pay.transaction_type='payment' AND coalesce(pay.refunded_amount,0)>=0
     AND NOT coalesce(pay.is_deleted,false)
     AND pay.amount-coalesce(pay.refunded_amount,0)>=c.agreement_amount
     AND r.is_active AND r.grant_target_type='training_content'
     AND r.product_id=s.product_id AND r.tariff_id=s.tariff_id
     AND r.target_ref IN(SELECT id::text FROM chain WHERE parent_module_id IS NULL)
     AND EXISTS(SELECT 1 FROM chain WHERE parent_module_id IS NULL
       AND product_id='11c9f1b8-0355-4753-bd74-40b42aa53616'::uuid)
     AND NOT EXISTS(SELECT 1 FROM chain WHERE is_active IS NOT TRUE)
     AND private.club_month_rule_allows_lesson(r.conditions,l.id,l.module_id)
 ),false);
$fn$;
REVOKE ALL ON FUNCTION private.club_paid_lesson_claim_valid(private.club_paid_lesson_corrections)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.has_club_paid_lesson_correction(
  u uuid,t uuid,month_key text,target_key text,allow_module boolean)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path='' AS $fn$
DECLARE target uuid;
BEGIN
  IF u IS NULL OR target_key IS NULL
    OR target_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(::[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$'
    THEN RETURN false; END IF;
  target:=split_part(target_key,'::',1)::uuid;
  IF strpos(target_key,'::')>0 AND (t IS NULL OR split_part(target_key,'::',2)::uuid IS DISTINCT FROM t)
    THEN RETURN false; END IF;
  RETURN EXISTS(
    SELECT 1 FROM private.club_paid_lesson_corrections c
    WHERE c.user_id=u AND (t IS NULL OR c.tariff_id=t)
      AND (month_key IS NULL OR c.deal_month=month_key)
      AND private.club_paid_lesson_claim_valid(c)
      AND (c.lesson_id=target OR (allow_module
        -- Opaque keys cannot distinguish a module from a colliding lesson ID:
        -- fail closed instead of accidentally opening that other lesson.
        AND NOT EXISTS(SELECT 1 FROM public.training_lessons l WHERE l.id=target)
        AND EXISTS(WITH RECURSIVE ancestors AS (
          SELECT m.id,m.parent_module_id,ARRAY[m.id] seen FROM public.training_modules m
            JOIN public.training_lessons l ON l.module_id=m.id WHERE l.id=c.lesson_id
          UNION ALL SELECT m.id,m.parent_module_id,a.seen||m.id
            FROM public.training_modules m JOIN ancestors a ON m.id=a.parent_module_id
            WHERE NOT m.id=ANY(a.seen) AND cardinality(a.seen)<12
        ) SELECT 1 FROM ancestors WHERE id=target)))
  );
END;
$fn$;
REVOKE ALL ON FUNCTION private.has_club_paid_lesson_correction(uuid,uuid,text,text,boolean)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.record_club_paid_lesson_correction(
  p_key uuid,p_user uuid,p_profile uuid,p_subscription uuid,p_payment uuid,
  p_tariff uuid,p_lesson uuid,p_month text,p_agreement_amount numeric,
  p_expected_end timestamptz,p_evidence_ref text,p_operator_ref text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE candidate private.club_paid_lesson_corrections; existing private.club_paid_lesson_corrections;
  source record; rules uuid[];
BEGIN
  IF p_key IS NULL OR p_month IS NULL OR p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    OR p_agreement_amount IS NULL OR p_agreement_amount<=0
    OR p_expected_end IS NULL OR p_expected_end<=now()
    OR p_evidence_ref IS NULL OR length(p_evidence_ref) NOT BETWEEN 16 AND 256
    OR p_operator_ref IS NULL OR length(p_operator_ref) NOT BETWEEN 1 AND 96
    THEN RAISE EXCEPTION 'invalid_paid_lesson_correction'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_key::text,0));
  SELECT * INTO existing FROM private.club_paid_lesson_corrections WHERE correction_key=p_key;
  IF FOUND THEN
    IF (existing.user_id,existing.profile_id,existing.source_subscription_id,existing.source_payment_id,
        existing.tariff_id,existing.lesson_id,existing.deal_month,existing.agreement_amount,
        existing.valid_until,existing.evidence_ref,existing.operator_ref)
      IS DISTINCT FROM (p_user,p_profile,p_subscription,p_payment,p_tariff,p_lesson,p_month,
        p_agreement_amount,p_expected_end,p_evidence_ref,p_operator_ref)
      THEN RAISE EXCEPTION 'paid_lesson_idempotency_conflict'; END IF;
    RETURN jsonb_build_object('created',false,'correction_key',p_key,
      'active',private.club_paid_lesson_claim_valid(existing),'audit_rows_created',0);
  END IF;
  SELECT s.access_end_at INTO source FROM public.subscriptions_v2 s WHERE s.id=p_subscription FOR SHARE;
  IF NOT FOUND OR source.access_end_at IS DISTINCT FROM p_expected_end
    THEN RAISE EXCEPTION 'paid_lesson_source_period_drift'; END IF;
  PERFORM 1 FROM public.payments_v2 WHERE id=p_payment FOR SHARE;
  PERFORM 1 FROM public.profiles WHERE id=p_profile FOR SHARE;
  WITH RECURSIVE chain AS (
    SELECT m.id,m.parent_module_id,ARRAY[m.id] seen FROM public.training_modules m
      JOIN public.training_lessons l ON l.module_id=m.id WHERE l.id=p_lesson
    UNION ALL SELECT m.id,m.parent_module_id,c.seen||m.id FROM public.training_modules m
      JOIN chain c ON m.id=c.parent_module_id WHERE NOT m.id=ANY(c.seen) AND cardinality(c.seen)<12
  )
  SELECT array_agg(r.id) INTO rules FROM public.access_rules r
    JOIN public.subscriptions_v2 s ON s.id=p_subscription
    JOIN public.training_lessons l ON l.id=p_lesson
    WHERE r.is_active AND r.grant_target_type='training_content'
      AND r.product_id=s.product_id AND r.tariff_id=p_tariff
      AND r.target_ref IN(SELECT id::text FROM chain WHERE parent_module_id IS NULL)
      AND private.club_month_rule_allows_lesson(r.conditions,l.id,l.module_id);
  IF coalesce(cardinality(rules),0)<>1 THEN RAISE EXCEPTION 'paid_lesson_ambiguous_rule'; END IF;
  candidate.correction_key:=p_key; candidate.user_id:=p_user; candidate.profile_id:=p_profile;
  candidate.source_subscription_id:=p_subscription; candidate.source_payment_id:=p_payment;
  candidate.tariff_id:=p_tariff; candidate.lesson_id:=p_lesson; candidate.deal_month:=p_month;
  candidate.agreement_amount:=p_agreement_amount; candidate.valid_until:=p_expected_end;
  candidate.rule_id:=rules[1]; candidate.evidence_ref:=p_evidence_ref; candidate.operator_ref:=p_operator_ref;
  candidate.created_at:=statement_timestamp(); candidate.revoked_at:=NULL;
  IF NOT private.club_paid_lesson_claim_valid(candidate) THEN RAISE EXCEPTION 'paid_lesson_evidence_mismatch'; END IF;
  INSERT INTO private.club_paid_lesson_corrections SELECT(candidate).*;
  INSERT INTO private.club_paid_lesson_correction_audit(correction_key,operator_ref,evidence_ref,snapshot)
    VALUES(p_key,p_operator_ref,p_evidence_ref,to_jsonb(candidate));
  RETURN jsonb_build_object('created',true,'correction_key',p_key,'active',true,'audit_rows_created',1);
END;
$fn$;
REVOKE ALL ON FUNCTION public.record_club_paid_lesson_correction(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,timestamptz,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_club_paid_lesson_correction(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,timestamptz,text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.has_month_purchase_bulk(_user_id uuid,_items jsonb)
RETURNS TABLE(lesson_id text,has_purchase boolean) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public' AS $function$
BEGIN
 RETURN QUERY WITH items AS (
   SELECT elem->>'lesson_id' lesson_id,(elem->>'tariff_id')::uuid tariff_id,
     CASE WHEN elem->>'content_month' ~ '^\d{4}-\d{2}$' THEN elem->>'content_month'
       WHEN elem->>'content_month' ~ '^\d{4}-\d{2}-\d{2}' THEN substr(elem->>'content_month',1,7) END month_key
   FROM jsonb_array_elements(_items) elem
   WHERE elem?'lesson_id' AND elem?'tariff_id' AND elem?'content_month'
 ), user_profiles AS (SELECT id profile_id FROM public.profiles WHERE user_id=_user_id)
 SELECT i.lesson_id,EXISTS(SELECT 1 FROM public.orders_v2 o
     WHERE o.tariff_id=i.tariff_id AND o.status='paid' AND o.meta->>'deal_month'=i.month_key
       AND coalesce(o.meta->>'source','')<>'rule_engine'
       AND (o.user_id=_user_id OR o.profile_id IN(SELECT profile_id FROM user_profiles)))
   OR private.has_club_paid_lesson_correction(_user_id,i.tariff_id,i.month_key,i.lesson_id,true)
 FROM items i WHERE i.month_key IS NOT NULL;
END;
$function$;

DO $preserve$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.user_has_training_lesson_access(uuid,uuid)'::regprocedure) INTO definition;
  EXECUTE replace(definition,'public.user_has_training_lesson_access(', 'private.training_lesson_access_before_paid_correction(');
END;
$preserve$;
REVOKE ALL ON FUNCTION private.training_lesson_access_before_paid_correction(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.user_has_training_lesson_access(_user_id uuid,_lesson_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
 RETURN private.training_lesson_access_before_paid_correction(_user_id,_lesson_id)
   OR private.has_club_paid_lesson_correction(_user_id,NULL,NULL,_lesson_id::text,false);
END;
$fn$;

-- The existing Cloud SQL executor is not a new role or a client permission.
DO $technical_acl$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sandbox_exec_hdjgkjceownmmnrqqtuz') THEN
   GRANT EXECUTE ON FUNCTION public.record_club_paid_lesson_correction(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,timestamptz,text,text)
     TO sandbox_exec_hdjgkjceownmmnrqqtuz;
   REVOKE ALL ON private.club_paid_lesson_corrections,private.club_paid_lesson_correction_audit
     FROM sandbox_exec_hdjgkjceownmmnrqqtuz;
   REVOKE ALL ON FUNCTION private.training_lesson_access_before_paid_correction(uuid,uuid)
     FROM sandbox_exec_hdjgkjceownmmnrqqtuz;
 END IF;
END;
$technical_acl$;

DO $postcheck$
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.has_month_purchase(uuid,uuid,text)'::regprocedure)
     IS DISTINCT FROM '79b2c0572e2d5a15f5302b1d276fa212'
   OR EXISTS(SELECT 1 FROM private.club_paid_lesson_corrections)
   OR EXISTS(SELECT 1 FROM private.club_paid_lesson_correction_audit)
   OR has_function_privilege('anon','public.record_club_paid_lesson_correction(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,timestamptz,text,text)','EXECUTE')
   OR has_function_privilege('authenticated','public.record_club_paid_lesson_correction(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,timestamptz,text,text)','EXECUTE') THEN
   RAISE EXCEPTION 'paid_lesson_postcheck_failed';
 END IF;
END;
$postcheck$;
COMMIT;
