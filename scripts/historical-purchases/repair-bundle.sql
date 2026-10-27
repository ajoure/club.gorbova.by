-- Managed Lovable DATA artifact; never a migration or automatic scheduled job.
-- Render private observed input separately. The unrendered artifact fails closed.
BEGIN;
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, /* TRANSACTION_MODE */ READ ONLY;
SET LOCAL lock_timeout = '5s';
-- The full protected-state fingerprint runs both before and after the repair.
-- Keep its bounded budget separate from the five-second row-lock deadline.
SET LOCAL statement_timeout = '90s';
DO $bundle$
DECLARE
  cfg jsonb := /* REVIEWED_INPUT */ '{}'::jsonb;
  do_execute boolean := /* EXECUTE_FLAG */ false;
  uid uuid := (cfg->>'user_id')::uuid;
  pid uuid := (cfg->>'profile_id')::uuid;
  history_id uuid := (cfg->>'history_order_id')::uuid;
  ip_ent_id uuid := (cfg->>'ip_entitlement_id')::uuid;
  retail_ent_id uuid := (cfg->>'retail_entitlement_id')::uuid;
  sub_id uuid := (cfg->>'business_subscription_id')::uuid;
  paid_order_id uuid := (cfg->>'business_order_id')::uuid;
  payment_id uuid := (cfg->>'business_payment_id')::uuid;
  end_at timestamptz := (cfg->>'business_end_at')::timestamptz;
  batch text := cfg->>'repair_key';
  rule_id constant uuid := '1b497fba-031a-4318-8d9f-2530f1bac116';
  business_tariff constant uuid := '7c748940-dcad-4c7c-a92e-76a2344622d3';
  club_product constant uuid := '11c9f1b8-0355-4753-bd74-40b42aa53616';
  cb_product constant uuid := '7101ed3c-7839-4a74-ad95-aa0660369b22';
  targets constant uuid[] := ARRAY['ea98d043-e852-443f-8807-6e77de6a5e1f',
    'abee24cd-5c8b-4111-a6cb-7dee7acf168c']::uuid[];
  target_codes constant text[] := ARRAY['cb_module_ip','cb_module_retail'];
  hist jsonb; old_ip jsonb; source_sub jsonb; prior_audit jsonb;
  before_hashes jsonb; fingerprints jsonb; v jsonb;
  new_meta jsonb; canonical_meta jsonb; provenance jsonb;
  order_ids uuid[]; event_keys text[];
  tbl text; scoped text; global_scope text;
  pass integer; i integer; changed integer; n integer;
  already_done boolean; post_ok boolean;
BEGIN
  IF uid IS NULL OR pid IS NULL OR history_id IS NULL OR sub_id IS NULL OR end_at IS NULL
    OR batch IS NULL OR batch !~ '^[A-Za-z0-9-]{12,90}$'
    OR jsonb_array_length(cfg->'proof_message_ids') NOT BETWEEN 2 AND 8
  THEN RAISE EXCEPTION 'Reviewed private input required'; END IF;
  IF (/* DEPENDENCY_EXPRESSION */ NULL::text) IS DISTINCT FROM cfg->>'dependency_md5'
  THEN RAISE EXCEPTION 'Live helpers/triggers/CRM definitions changed; HOLD'; END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id=pid AND user_id=uid AND is_archived IS NOT TRUE
    AND merged_to_profile_id IS NULL)
  THEN RAISE EXCEPTION 'Profile identity drift'; END IF;
  IF do_execute THEN
    PERFORM 1 FROM orders_v2 WHERE id IN(history_id,paid_order_id) ORDER BY id FOR UPDATE;
    PERFORM 1 FROM subscriptions_v2 WHERE id=sub_id FOR UPDATE;
    PERFORM 1 FROM payments_v2 WHERE id=payment_id FOR UPDATE;
    PERFORM 1 FROM entitlements WHERE user_id=uid AND (product_id=ANY(targets)
      OR product_code=ANY(target_codes)) ORDER BY id FOR UPDATE;
  END IF;
  SELECT to_jsonb(o) INTO STRICT hist FROM orders_v2 o WHERE id=history_id;
  SELECT to_jsonb(e) INTO STRICT old_ip FROM entitlements e WHERE id=ip_ent_id;
  SELECT to_jsonb(s) INTO STRICT source_sub FROM subscriptions_v2 s WHERE id=sub_id;
  IF hist->>'user_id' IS DISTINCT FROM uid::text OR hist->>'profile_id' IS DISTINCT FROM pid::text
    OR hist->>'product_id' IS DISTINCT FROM cb_product::text OR hist->>'status'<>'paid'
    OR (hist->>'is_deleted')::boolean IS TRUE OR (hist->>'is_trial')::boolean IS TRUE
    OR hist->'purchase_snapshot'->>'historical_purchase_type' IS DISTINCT FROM 'base_tariff_purchase'
  THEN RAISE EXCEPTION 'Historical paid order identity/type drift'; END IF;
  IF source_sub->>'user_id' IS DISTINCT FROM uid::text
    OR source_sub->>'product_id' IS DISTINCT FROM club_product::text
    OR source_sub->>'tariff_id' IS DISTINCT FROM business_tariff::text
    OR source_sub->>'order_id' IS DISTINCT FROM paid_order_id::text
    OR source_sub->>'status' IS DISTINCT FROM 'active'
    OR (source_sub->>'is_trial')::boolean IS TRUE
    OR (source_sub->>'access_end_at')::timestamptz IS DISTINCT FROM end_at
    OR (source_sub->>'access_start_at')::timestamptz>now() OR end_at<=now()
    OR NOT EXISTS (SELECT 1 FROM orders_v2 o JOIN payments_v2 p ON p.order_id=o.id
      WHERE o.id=paid_order_id AND o.user_id=uid AND o.profile_id=pid AND o.status::text='paid'
      AND o.product_id=club_product AND o.tariff_id=business_tariff
      AND o.is_deleted IS NOT TRUE AND o.is_trial IS NOT TRUE
      AND o.currency='BYN' AND o.paid_amount=250 AND p.id=payment_id AND p.user_id=uid
      AND p.status::text='succeeded' AND p.amount=250 AND p.currency='BYN'
      AND COALESCE(p.refunded_amount,0)=0 AND p.is_deleted IS NOT TRUE)
  THEN RAISE EXCEPTION 'Current paid BUSINESS source/window/refund drift'; END IF;
  IF NOT EXISTS (SELECT 1 FROM access_rules r WHERE r.id=rule_id AND r.is_active
    AND r.product_id=club_product AND r.tariff_id=business_tariff AND r.duration_days IS NULL
    AND r.grant_target_type='product_access' AND r.conditions->>'condition_type'='prior_purchase'
    AND r.conditions->>'match_mode'='per_product'
    AND r.conditions->'target_product_ids' @> to_jsonb(targets))
    OR (SELECT count(*) FROM products_v2 WHERE (id=targets[1] AND code=target_codes[1])
      OR (id=targets[2] AND code=target_codes[2]))<>2
    OR EXISTS (SELECT 1 FROM entitlement_sources WHERE user_id=uid)
  THEN RAISE EXCEPTION 'Canonical rule/catalogue or independent source drift'; END IF;
  SELECT array_agg(id ORDER BY id) INTO order_ids FROM orders_v2 WHERE user_id=uid OR profile_id=pid;
  event_keys:=ARRAY['support_bundle:'||batch||':'||rule_id||':'||targets[1],
    'support_bundle:'||batch||':'||rule_id||':'||targets[2]];
  SELECT count(*) INTO n FROM audit_logs WHERE target_user_id=uid
    AND meta->>'support_bundle_repair_key'=batch;
  IF n>1 THEN RAISE EXCEPTION 'Duplicate repair audit'; END IF;
  already_done:=n=1;
  IF already_done THEN
    SELECT meta INTO STRICT prior_audit FROM audit_logs WHERE target_user_id=uid
      AND meta->>'support_bundle_repair_key'=batch;
  END IF;
  FOR pass IN 1..2 LOOP
    fingerprints:='{}'::jsonb;
    FOREACH tbl IN ARRAY ARRAY['orders_v2','payments_v2','subscriptions_v2','provider_subscriptions',
      'payment_reconcile_queue','crm_pipeline_automation_jobs','referral_sale_attributions',
      'notification_outbox','pending_telegram_notifications','telegram_messages','entitlement_sources',
      'entitlements','access_grant_ledger','audit_logs'] LOOP
      global_scope:='true';
      scoped:=CASE tbl
        WHEN 'orders_v2' THEN '(t.user_id=$1 OR t.profile_id=$2) AND t.id<>$7'
        WHEN 'payments_v2' THEN 't.user_id=$1 OR t.profile_id=$2 OR t.order_id=ANY($3)'
        WHEN 'provider_subscriptions' THEN 't.user_id=$1 OR t.profile_id=$2'
        WHEN 'payment_reconcile_queue' THEN 't.matched_profile_id=$2 OR t.matched_order_id=ANY($3) OR t.processed_order_id=ANY($3)'
        WHEN 'crm_pipeline_automation_jobs' THEN 't.deal_id=ANY($3)'
        WHEN 'referral_sale_attributions' THEN 't.order_id=ANY($3)'
        WHEN 'telegram_messages' THEN 't.user_id=$1 AND t.business_account_id IS NULL AND t.business_connection_id IS NULL AND t.bot_id IN(''2a676ae6-71f1-49f6-9fe4-f7ec7ce46c01'',''6d967844-eebf-4788-9f00-8655297fe9bb'',''f20fbca1-7833-4e92-923d-2712d2ad3d3c'',''1a560e98-574e-4fd9-82ab-4b7bbdc300b4'')'
        WHEN 'entitlements' THEN 't.user_id=$1 AND NOT (COALESCE(t.product_id=ANY($6),false) OR t.product_code IN(''cb_module_ip'',''cb_module_retail''))'
        WHEN 'access_grant_ledger' THEN 't.user_id=$1 AND NOT(t.source_event_key=ANY($5))'
        WHEN 'audit_logs' THEN 't.target_user_id=$1 AND t.meta->>''support_bundle_repair_key'' IS DISTINCT FROM $4'
        ELSE 't.user_id=$1' END;
      IF tbl='entitlements' THEN global_scope:='NOT(t.user_id=$1 AND (COALESCE(t.product_id=ANY($6),false) OR t.product_code IN(''cb_module_ip'',''cb_module_retail'')))'; END IF;
      IF tbl='access_grant_ledger' THEN global_scope:='NOT(t.source_event_key=ANY($5))'; END IF;
      IF tbl='audit_logs' THEN global_scope:='t.meta->>''support_bundle_repair_key'' IS DISTINCT FROM $4'; END IF;
      -- Business/personal Telegram is excluded even from the protection fingerprint.
      IF tbl='telegram_messages' THEN global_scope:=scoped; END IF;
      EXECUTE format('SELECT jsonb_build_object(''scope_md5'',(SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text,''[]'')) FROM public.%1$I t WHERE %2$s),''global_count'',(SELECT count(*) FROM public.%1$I t WHERE %3$s))',tbl,scoped,global_scope)
        INTO v USING uid,pid,order_ids,batch,event_keys,targets,history_id;
      fingerprints:=fingerprints||jsonb_build_object(tbl,v);
    END LOOP;
    IF pass=2 THEN
      IF fingerprints IS DISTINCT FROM before_hashes THEN RAISE EXCEPTION 'Unexpected protected row/side-effect change'; END IF;
      EXIT;
    END IF;
    before_hashes:=fingerprints;
    IF already_done THEN
      IF hist->'purchase_snapshot'->'module_list_mapped' IS DISTINCT FROM to_jsonb(targets)
        OR hist->'purchase_snapshot'->'module_list_provenance'->>'repair_key' IS DISTINCT FROM batch
        OR md5((hist-'purchase_snapshot'-'updated_at')::text) IS DISTINCT FROM prior_audit->>'history_protected_md5'
        OR before_hashes IS DISTINCT FROM prior_audit->'protected_before'
        OR md5((hist->'purchase_snapshot')::text) IS DISTINCT FROM prior_audit->>'history_snapshot_after_md5'
        OR (SELECT md5(jsonb_agg(to_jsonb(e) ORDER BY e.id)::text) FROM entitlements e
          WHERE e.user_id=uid AND e.product_id=ANY(targets)) IS DISTINCT FROM prior_audit->>'targets_after_md5'
        OR (SELECT md5(jsonb_agg(to_jsonb(l) ORDER BY l.id)::text) FROM access_grant_ledger l
          WHERE l.source_event_key=ANY(event_keys)) IS DISTINCT FROM prior_audit->>'ledger_after_md5'
        OR (SELECT count(*) FROM access_grant_ledger WHERE user_id=uid AND source_event_key=ANY(event_keys)
          AND source_subscription_id=sub_id AND source_order_id=paid_order_id
          AND ((action_type='reactivate' AND status='reactivated' AND target_key=uid||':'||targets[1])
            OR (action_type='grant' AND status='granted' AND target_key=uid||':'||targets[2])))<>2
        OR (SELECT count(*) FROM entitlements WHERE user_id=uid AND product_id=ANY(targets) AND status='active'
          AND expires_at=end_at AND meta->>'support_bundle_repair_key'=batch
          AND meta->>'business_subscription_id'=sub_id::text AND meta->>'source_access_kind'='subscription'
          AND meta->>'prior_purchase_order_id'=history_id::text
          AND meta->'historical_module_product_ids'=to_jsonb(targets))<>2
      THEN RAISE EXCEPTION 'Completed repair no longer matches; HOLD'; END IF;
      RAISE NOTICE 'bundle_repair changes: orders=0 entitlements=0 ledger=0 audit=0';
      RETURN;
    END IF;
    IF md5(hist::text) IS DISTINCT FROM cfg->>'history_row_md5'
      OR md5((hist->'purchase_snapshot')::text) IS DISTINCT FROM cfg->>'history_snapshot_md5'
      OR md5((hist->'meta')::text) IS DISTINCT FROM cfg->>'history_meta_md5'
      OR (hist->>'updated_at')::timestamptz IS DISTINCT FROM (cfg->>'history_updated_at')::timestamptz
      OR hist->'purchase_snapshot' ? 'module_list_mapped' OR hist->'purchase_snapshot' ? 'module_list_provenance'
      OR md5(old_ip::text) IS DISTINCT FROM cfg->>'ip_row_md5'
      OR md5((old_ip->'meta')::text) IS DISTINCT FROM cfg->>'ip_meta_md5'
      OR (old_ip->>'updated_at')::timestamptz IS DISTINCT FROM (cfg->>'ip_updated_at')::timestamptz
      OR old_ip->>'user_id' IS DISTINCT FROM uid::text OR old_ip->>'product_id' IS DISTINCT FROM targets[1]::text
      OR (old_ip->>'profile_id' IS NOT NULL AND old_ip->>'profile_id'<>pid::text)
      OR old_ip->>'product_code' IS DISTINCT FROM target_codes[1] OR old_ip->>'status' IS DISTINCT FROM 'expired'
      OR old_ip->>'order_id' IS NOT NULL
      OR old_ip->'meta'->>'source_rule_id' IS DISTINCT FROM rule_id::text
      OR lower(COALESCE(old_ip->'meta'->>'source_type','')) IN('manual','admin')
      OR lower(COALESCE(old_ip->'meta'->>'granted_by','')) ~ '(manual|admin)'
      OR old_ip->'meta' ?| ARRAY['manual_access_edit_last_at','manual_override','manual_blocked']
      OR (SELECT count(*) FROM entitlements WHERE user_id=uid AND (product_id=ANY(targets) OR product_code=ANY(target_codes)))<>1
      OR EXISTS(SELECT 1 FROM entitlements WHERE id=retail_ent_id)
      OR EXISTS(SELECT 1 FROM access_grant_ledger WHERE source_event_key=ANY(event_keys))
      OR (SELECT count(*) FROM entitlements WHERE user_id=uid AND status='active')<>4
      OR (SELECT count(*) FROM entitlements WHERE user_id=uid AND status='active' AND expires_at=end_at
        AND product_code IN('club','cb20','cb_module_catering','cb_module_marketplaces'))<>4
    THEN RAISE EXCEPTION 'Observed CAS/lineage/coverage drift'; END IF;
    IF NOT do_execute THEN
      RAISE NOTICE 'bundle_repair planned: orders=1 ip_reactivate=1 retail_insert=1 ledger=2 audit=1; protected=%',before_hashes;
      RETURN;
    END IF;
    provenance:=jsonb_build_object('repair_key',batch,'evidence_kind','support_original_bundle_correspondence',
      'proof_message_ids',cfg->'proof_message_ids','history_order_id',history_id,'confirmed_modules',to_jsonb(targets),'repaired_at',now());
    UPDATE orders_v2 o SET purchase_snapshot=o.purchase_snapshot||jsonb_build_object(
      'module_list_mapped',to_jsonb(targets),'module_list_provenance',provenance)
      WHERE o.id=history_id AND md5(to_jsonb(o)::text)=cfg->>'history_row_md5';
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed<>1 THEN RAISE EXCEPTION 'Historical order CAS count'; END IF;
    IF (SELECT to_jsonb(o)-'purchase_snapshot'-'updated_at' FROM orders_v2 o WHERE id=history_id)
      IS DISTINCT FROM hist-'purchase_snapshot'-'updated_at'
      OR (SELECT purchase_snapshot-'module_list_mapped'-'module_list_provenance' FROM orders_v2 WHERE id=history_id)
      IS DISTINCT FROM hist->'purchase_snapshot'
    THEN RAISE EXCEPTION 'Historical money/meta/snapshot fields changed'; END IF;
    canonical_meta:=jsonb_build_object('granted_by','rule_engine_product_access','source_type','rule_engine',
      'source_rule_id',rule_id,'source_order_id',paid_order_id,'business_subscription_id',sub_id,
      'business_tariff_id',business_tariff,'source_access_kind','subscription','source_entitlement_source_id',NULL,
      'source_window_rule','align_with_source','source_access_end_at',end_at,
      'scope_resolution_mode','module_scope_only','prior_purchase_order_id',history_id,
      'prior_purchase_match_type','module_list_mapped','historical_purchase_type','base_tariff_purchase',
      'historical_tariff_id',hist->'tariff_id','historical_module_product_ids',to_jsonb(targets),
      'support_bundle_repair_key',batch);
    new_meta:=COALESCE(old_ip->'meta','{}'::jsonb)||canonical_meta||jsonb_build_object(
      'previous_lineage',jsonb_build_object('business_subscription_id',old_ip->'meta'->'business_subscription_id',
        'source_rule_id',old_ip->'meta'->'source_rule_id','source_type',old_ip->'meta'->'source_type',
        'source',old_ip->'meta'->'source','meta_md5',cfg->>'ip_meta_md5'),
      'previous_status',old_ip->'status','previous_expires_at',old_ip->'expires_at');
    UPDATE entitlements e SET status='active',expires_at=end_at,updated_at=now(),
      profile_id=COALESCE(e.profile_id,pid),meta=new_meta
      WHERE e.id=ip_ent_id AND md5(to_jsonb(e)::text)=cfg->>'ip_row_md5';
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed<>1 THEN RAISE EXCEPTION 'IP entitlement CAS count'; END IF;
    INSERT INTO entitlements(id,user_id,profile_id,product_id,product_code,status,expires_at,order_id,meta)
      VALUES(retail_ent_id,uid,pid,targets[2],target_codes[2],'active',end_at,NULL,canonical_meta);
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed<>1 THEN RAISE EXCEPTION 'Retail insert count'; END IF;
    FOR i IN 1..2 LOOP
      INSERT INTO access_grant_ledger(source_event_type,source_event_key,source_subject_type,source_subject_ref,
        source_subscription_id,source_order_id,action_type,reason_code,target_type,target_key,user_id,profile_id,
        order_id,status,result,metadata)
      VALUES('admin',event_keys[i],'subscription',sub_id::text,sub_id,paid_order_id,
        CASE WHEN i=1 THEN 'reactivate' ELSE 'grant' END,'rule_engine_bonus','product',uid||':'||targets[i],uid,pid,
        paid_order_id,CASE WHEN i=1 THEN 'reactivated' ELSE 'granted' END,
        jsonb_build_object('rule_id',rule_id,'target_product_id',targets[i],
          'previous_expires_at',CASE WHEN i=1 THEN old_ip->'expires_at' ELSE NULL END,
          'new_expires_at',end_at,'source_window_rule','align_with_source'),
        jsonb_build_object('support_bundle_repair_key',batch,'prior_purchase_order_id',history_id));
      GET DIAGNOSTICS changed=ROW_COUNT;
      IF changed<>1 THEN RAISE EXCEPTION 'Ledger insert count'; END IF;
    END LOOP;
    INSERT INTO audit_logs(action,actor_type,actor_label,target_user_id,entity_type,entity_id,meta)
    VALUES('SUPPORT_HISTORICAL_BUNDLE_REPAIRED','system','Verified support bundle repair',uid,'order',history_id,
      jsonb_build_object('support_bundle_repair_key',batch,'history_order_id',history_id,
        'history_protected_md5',md5((hist-'purchase_snapshot'-'updated_at')::text),'protected_before',before_hashes,
        'history_snapshot_after_md5',(SELECT md5(purchase_snapshot::text) FROM orders_v2 WHERE id=history_id),
        'targets_after_md5',(SELECT md5(jsonb_agg(to_jsonb(e) ORDER BY e.id)::text) FROM entitlements e WHERE e.user_id=uid AND e.product_id=ANY(targets)),
        'ledger_after_md5',(SELECT md5(jsonb_agg(to_jsonb(l) ORDER BY l.id)::text) FROM access_grant_ledger l WHERE l.source_event_key=ANY(event_keys)),
        'proof_message_ids',cfg->'proof_message_ids','target_products',to_jsonb(targets),
        'changes',jsonb_build_object('orders',1,'ip_reactivated',1,'retail_inserted',1,'ledger',2,'audit',1)));
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed<>1 THEN RAISE EXCEPTION 'Audit insert count'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM entitlements WHERE user_id=uid AND product_id=ANY(targets) AND status='active'
    AND expires_at=end_at AND meta->>'support_bundle_repair_key'=batch
    AND meta->>'business_subscription_id'=sub_id::text AND meta->>'prior_purchase_order_id'=history_id::text
    AND meta->'historical_module_product_ids'=to_jsonb(targets))<>2
  THEN RAISE EXCEPTION 'Canonical target postcondition failed'; END IF;
  SELECT meta INTO STRICT prior_audit FROM audit_logs WHERE target_user_id=uid AND meta->>'support_bundle_repair_key'=batch;
  IF (SELECT md5(jsonb_agg(to_jsonb(e) ORDER BY e.id)::text) FROM entitlements e WHERE e.user_id=uid AND e.product_id=ANY(targets))
      IS DISTINCT FROM prior_audit->>'targets_after_md5'
    OR (SELECT md5(jsonb_agg(to_jsonb(l) ORDER BY l.id)::text) FROM access_grant_ledger l WHERE l.source_event_key=ANY(event_keys))
      IS DISTINCT FROM prior_audit->>'ledger_after_md5'
  THEN RAISE EXCEPTION 'Target/ledger changed during audit'; END IF;
  RAISE NOTICE 'bundle_repair changes: orders=1 ip_reactivated=1 retail_inserted=1 ledger=2 audit=1; protected unchanged';
END;
$bundle$;
COMMIT;
