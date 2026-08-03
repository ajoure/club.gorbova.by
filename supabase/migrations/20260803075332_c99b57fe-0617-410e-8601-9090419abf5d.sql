DO $$
DECLARE n int; ent_cnt int; act_cnt int;
BEGIN
  -- guards
  SELECT count(*) INTO ent_cnt FROM entitlements
   WHERE user_id='f08cc354-02c3-4c66-9906-1812e4cc6af3'
     AND product_id='11c9f1b8-0355-4753-bd74-40b42aa53616'
     AND status='active' AND expires_at='2026-09-13 12:00:00+00';
  IF ent_cnt <> 1 THEN RAISE EXCEPTION 'entitlement guard mismatch: %', ent_cnt; END IF;

  SELECT count(*) INTO act_cnt FROM subscriptions_v2
   WHERE id='b90cd524-00bf-40e0-91d1-2073a031944d' AND status='active';
  IF act_cnt <> 1 THEN RAISE EXCEPTION 'sibling B guard mismatch'; END IF;

  UPDATE provider_subscriptions
     SET state='canceled', next_charge_at=NULL, updated_at=now(),
         meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
           'canceled_at','2026-08-03T07:53:01Z',
           'cancel_reason','duplicate_provider_recurring_no_refund',
           'canceled_by','audit-2026-08-03:a2-provider-cancel',
           'provider_proof', jsonb_build_object('state','canceled','renew_at',NULL,'checked_at','2026-08-03T07:53:06Z')
         )
   WHERE id='99c5fb14-e7fa-4bd6-93c9-7e606e4a1c67'
     AND provider_subscription_id='sbs_a1c38d507d74096d';
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'provider_subscriptions rowcount %', n; END IF;

  UPDATE subscriptions_v2
     SET status='superseded', auto_renew=false, next_charge_at=NULL, updated_at=now(),
         meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
           'superseded_by','b90cd524-00bf-40e0-91d1-2073a031944d',
           'superseded_reason','provider_recurring_canceled_duplicate',
           'superseded_key','audit-2026-08-03:a2-provider-cancel:99c5fb14-e7fa-4bd6-93c9-7e606e4a1c67'
         )
   WHERE id='8bcd02d5-5aae-48bc-90fb-b1e41d591308' AND status='past_due';
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'subscriptions_v2 rowcount %', n; END IF;

  INSERT INTO audit_logs (action, actor_label, meta)
  VALUES ('subscription.provider_recurring_canceled_duplicate','system:a2-provider-cancel',
    jsonb_build_object(
      'key','audit-2026-08-03:a2-provider-cancel:99c5fb14-e7fa-4bd6-93c9-7e606e4a1c67',
      'provider_link_id','99c5fb14-e7fa-4bd6-93c9-7e606e4a1c67',
      'provider_subscription_id','sbs_a1c38d507d74096d',
      'before', jsonb_build_object('provider_state','active','provider_renew_at','2026-08-12T21:09:34Z','sub_a_status','past_due','sub_a_next_charge_at','2026-08-12T21:09:34Z'),
      'after', jsonb_build_object('provider_state','canceled','provider_renew_at',NULL,'sub_a_status','superseded','sub_a_next_charge_at',NULL),
      'provider_proof', jsonb_build_object('endpoint','GET /subscriptions/sbs_a1c38d507d74096d','state','canceled','renew_at',NULL,'checked_at','2026-08-03T07:53:06Z'),
      'unchanged', jsonb_build_object('canonical_subscription','b90cd524-00bf-40e0-91d1-2073a031944d','entitlement','8868831e-3671-46aa-9b03-7405daaafe1b','entitlement_expires_at','2026-09-13T12:00:00Z'),
      'rollback_note','Local rows can be restored to prior values; provider-side cancel of sbs_a1c38d507d74096d is NOT rollbackable. No refund performed.'
    ));
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'audit rowcount %', n; END IF;
END $$;