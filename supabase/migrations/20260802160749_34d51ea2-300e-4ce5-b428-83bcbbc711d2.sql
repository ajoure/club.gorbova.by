DO $$
DECLARE v_cnt int; v_batch int;
BEGIN
  CREATE TEMP TABLE _b1(link_id uuid, sbs text) ON COMMIT DROP;
  INSERT INTO _b1(link_id, sbs) VALUES
    ('204f37ed-ba03-43bb-9b54-cb715ed15e09'::uuid,'sbs_2812f295f8ac90b7'),
    ('3e800311-3fdc-4fce-b6df-35380ac9795c'::uuid,'sbs_55f048da642f7c31'),
    ('537502c8-8b24-48a3-8300-21351a366154'::uuid,'sbs_48638da4c791f1fe'),
    ('70f0ed0c-36ea-45bb-808b-a2c7375ff5f0'::uuid,'sbs_7d6b5b7cc8807e95'),
    ('c57747d0-e338-4c44-9fe1-76bdb7887d9a'::uuid,'sbs_9d9ccca981519738'),
    ('d9e5fe9e-1e97-4ff3-a54f-2b40573d97f9'::uuid,'sbs_ff7a282ada699aed'),
    ('da31f466-6af0-4b14-a68e-b9342a471ebf'::uuid,'sbs_2ccaa492db3126bf');

  CREATE TEMP TABLE _b1_before ON COMMIT DROP AS
    SELECT ps.id, ps.state, ps.next_charge_at
    FROM provider_subscriptions ps JOIN _b1 b ON b.link_id = ps.id;

  SELECT count(*) INTO v_cnt FROM _b1_before;
  IF v_cnt <> 7 THEN RAISE EXCEPTION 'B1 preflight rows % <> 7', v_cnt; END IF;

  WITH upd AS (
    UPDATE provider_subscriptions ps
    SET state = 'expired',
        next_charge_at = NULL,
        updated_at = now(),
        meta = COALESCE(ps.meta,'{}'::jsonb) || jsonb_build_object(
          'state_reconciled_from_provider', jsonb_build_object(
            'at', now(), 'batch', 'B1',
            'audit_key', 'audit-2026-08-02:orphan-expired:' || ps.id::text,
            'provider_state', 'expired', 'provider_renew_at', null,
            'previous_state', ps.state, 'source', 'bepaid GET /subscriptions read-only'))
    FROM _b1 b
    WHERE ps.id = b.link_id
      AND ps.provider = 'bepaid'
      AND ps.state = 'pending'
      AND ps.subscription_v2_id IS NULL
      AND ps.provider_subscription_id = b.sbs
    RETURNING ps.id
  ) SELECT count(*) INTO v_cnt FROM upd;
  IF v_cnt <> 7 THEN RAISE EXCEPTION 'B1 CAS rowcount % <> 7', v_cnt; END IF;

  INSERT INTO audit_logs(actor_type, actor_label, action, entity_type, entity_id, meta)
  SELECT 'system', 'codex-execute-b1',
         'provider_subscription.state_reconciled_from_provider',
         'provider_subscriptions', bf.id::text,
         jsonb_build_object(
           'audit_key', 'audit-2026-08-02:orphan-expired:' || bf.id::text,
           'before', jsonb_build_object('state', bf.state, 'next_charge_at', bf.next_charge_at),
           'after', jsonb_build_object('state', 'expired', 'next_charge_at', null),
           'rollback', format('UPDATE provider_subscriptions SET state=%L, next_charge_at=%L WHERE id=%L;', bf.state, bf.next_charge_at, bf.id),
           'proof', 'bePaid GET 200 state=expired renew_at=null last_transaction=null',
           'batch', 'B1')
  FROM _b1_before bf;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt <> 7 THEN RAISE EXCEPTION 'B1 audit rowcount % <> 7', v_cnt; END IF;

  CREATE TEMP TABLE _b2(sub_id uuid, sibling_id uuid, batch int) ON COMMIT DROP;
  INSERT INTO _b2(sub_id, sibling_id, batch) VALUES
    ('044ec6f6-0ccd-40b6-ae66-d3e488abe38e'::uuid,'74dc5986-2e2c-4876-a341-c96c5b84baa9'::uuid,1),
    ('06bd349e-e8b8-4a8f-a729-ad2a7135bf00'::uuid,'7ee1ac92-8e14-42ce-977a-5e91932960ce'::uuid,1),
    ('07865298-1fd4-4924-9c74-c169256b5ca8'::uuid,'74dc5986-2e2c-4876-a341-c96c5b84baa9'::uuid,1),
    ('08a7d0ba-b774-482e-849d-9fc98cdbd839'::uuid,'28965857-e8ca-41ed-9c5f-87711e884716'::uuid,1),
    ('0d6ab52e-cb28-45e4-b84e-6786c55e1c5e'::uuid,'01d7f3f9-50f1-4956-9a15-181895a1ca15'::uuid,1),
    ('1187a872-03db-4a55-9146-bd28ab9c41a0'::uuid,'95d8330b-c647-462b-814e-9fcebc159176'::uuid,1),
    ('136c74f9-8821-4e50-82e7-652bfb629c0a'::uuid,'35e6cb55-e2c5-4727-b658-e31a420b98e1'::uuid,1),
    ('14fc459a-7b59-4238-a07c-3f964ac9eb5f'::uuid,'fc450f35-d6ec-4d61-ba70-7e0d6cd360ec'::uuid,1),
    ('1549a87c-1e2e-4283-863b-6a48c1796318'::uuid,'19f8dde6-134e-4643-9433-c8f1bd449b51'::uuid,1),
    ('167919a2-51e9-437e-96b8-a29e69f877f7'::uuid,'35e6cb55-e2c5-4727-b658-e31a420b98e1'::uuid,1),
    ('1703e977-64ba-44c7-a558-3980bb97aefe'::uuid,'4cfa6e2e-a5ef-4563-84e0-f157773e7c53'::uuid,1),
    ('1bc75069-544d-4713-9d7f-64e260a022f3'::uuid,'458c157c-1d0d-4ed2-abbf-85074403f553'::uuid,1),
    ('1c2b025e-da89-4af8-8b99-8db1af6aad58'::uuid,'98e253c4-8a92-48e9-b6bc-0919aa99f60c'::uuid,1),
    ('1c2f8977-6127-42d4-9557-703cc777dc78'::uuid,'16dc96e2-9405-4987-9c25-7ff05247928f'::uuid,1),
    ('1d9700de-0c4a-4f97-b783-1596d1d75ab6'::uuid,'81ba18e6-e3b4-4c20-8406-c056bc42c58d'::uuid,1),
    ('1e10acb7-3d65-46d4-a237-5a1e9ce4d947'::uuid,'103117e5-3fc8-4c13-bba1-d4eab6678c80'::uuid,1),
    ('2410328c-3114-4b4f-868b-0854f13fb101'::uuid,'fc450f35-d6ec-4d61-ba70-7e0d6cd360ec'::uuid,1),
    ('242b1c8b-0548-4215-86d2-19d7901663da'::uuid,'87067553-80fe-4a94-8a4a-810df49c3d47'::uuid,1),
    ('2598dea1-71b5-460a-b0d9-ef245f7c9af5'::uuid,'458c157c-1d0d-4ed2-abbf-85074403f553'::uuid,1),
    ('26efaa4f-9461-4912-8401-b42af3cc71ee'::uuid,'19f8dde6-134e-4643-9433-c8f1bd449b51'::uuid,1),
    ('2b797ce2-1333-4e64-9025-6958c6deda1f'::uuid,'50d46ef9-7ce2-4e2a-ba13-99a45ed6bc54'::uuid,2),
    ('2e1e000e-0574-4f75-b418-9be40d7ca098'::uuid,'458c157c-1d0d-4ed2-abbf-85074403f553'::uuid,2),
    ('323aa8d6-b50d-41a1-84f1-654a35c94078'::uuid,'bf8629ae-db41-491b-b0d7-3763abb86749'::uuid,2),
    ('343455b5-2d08-41b4-b412-adf4d38ec722'::uuid,'d6ba02e7-5b79-42a1-be44-03631565b0ca'::uuid,2),
    ('39e15f02-3206-40f7-afbf-b05c9d96e9cc'::uuid,'103117e5-3fc8-4c13-bba1-d4eab6678c80'::uuid,2),
    ('4433c3ab-71ec-47a8-a647-54c2719c87d7'::uuid,'35e6cb55-e2c5-4727-b658-e31a420b98e1'::uuid,2),
    ('46967550-e683-426d-bfbc-13d25edd631f'::uuid,'103117e5-3fc8-4c13-bba1-d4eab6678c80'::uuid,2),
    ('4d04d9f3-0604-4bb2-8d51-da426e6a5c24'::uuid,'458c157c-1d0d-4ed2-abbf-85074403f553'::uuid,2),
    ('4e351f0d-8965-4503-a3dc-1bc5153923b3'::uuid,'7ee1ac92-8e14-42ce-977a-5e91932960ce'::uuid,2),
    ('5521766b-805e-4607-a395-205bb7a9ba88'::uuid,'35e6cb55-e2c5-4727-b658-e31a420b98e1'::uuid,2),
    ('57235bc0-09c8-4322-96f7-9632631c5174'::uuid,'5b57c44f-0de2-4452-ad03-260eb7055b29'::uuid,2),
    ('575a31d3-65e0-4d68-9c20-55877ed09b53'::uuid,'a5f9a275-2204-4335-9c48-7aa6ad757163'::uuid,2),
    ('595f9d1f-a07e-4367-b325-ff817251334b'::uuid,'0fc9ec31-9304-4848-8b84-1534dabe357d'::uuid,2),
    ('5c5e29a5-a338-4f5a-b65c-23176023499f'::uuid,'01d7f3f9-50f1-4956-9a15-181895a1ca15'::uuid,2),
    ('63de531c-5637-413e-b321-d2a9b0fb2857'::uuid,'44daab00-e8b2-49e3-bb85-1a067840ce97'::uuid,2),
    ('6dcdf72d-ac79-4110-b33e-8498f7f71099'::uuid,'2f88696a-795d-4c7c-b7a5-d90e30119b00'::uuid,2),
    ('754b4b51-e425-4e53-ae33-52541e855e92'::uuid,'d6e9fb31-6aee-428c-9798-4891d25927c8'::uuid,2),
    ('775272a8-3b32-416a-a3b1-7ee167e59d77'::uuid,'5a909ae1-42ef-4249-b571-3516e330273d'::uuid,2),
    ('794661f3-ff89-42a1-833c-35e1a20a52f3'::uuid,'81ba18e6-e3b4-4c20-8406-c056bc42c58d'::uuid,2),
    ('7f1411d9-6811-47a7-8d36-57b309a7b03d'::uuid,'87067553-80fe-4a94-8a4a-810df49c3d47'::uuid,2),
    ('816019f4-b9eb-4f00-9d90-48c56d226224'::uuid,'085952d5-ef13-41c6-91e3-a49d431b5e7d'::uuid,3),
    ('823fb0c4-9b70-42e5-80ab-34fe2292490a'::uuid,'0b44857e-835d-474f-99c4-05dcf61c0f4d'::uuid,3),
    ('870c778a-30f4-401a-be53-347cc7684326'::uuid,'458c157c-1d0d-4ed2-abbf-85074403f553'::uuid,3),
    ('8a4bf258-7437-4677-8314-637eae23a743'::uuid,'458c157c-1d0d-4ed2-abbf-85074403f553'::uuid,3),
    ('961a2b7e-58ab-494d-adf7-6cfd2ea626c9'::uuid,'261adae7-c6f9-4dfe-ae60-455abb4b0a46'::uuid,3),
    ('99568894-1c47-40bb-a139-ee89a504ce94'::uuid,'a5c7b490-b587-4c71-b333-f9011cb350a6'::uuid,3),
    ('9d214246-fa3a-413f-91af-c1365cd1b3b6'::uuid,'2e36ba57-b38b-4f72-9a04-d98e9e3c7c49'::uuid,3),
    ('9e370c40-96d5-4473-a317-3ae1e518f91a'::uuid,'28d7775b-9264-47c1-8f5f-ceac1dbf2a43'::uuid,3),
    ('a29a5b0c-51fa-4631-a4f9-85c28ebc1154'::uuid,'103117e5-3fc8-4c13-bba1-d4eab6678c80'::uuid,3),
    ('a29ee113-8904-440f-9e5d-562bdf5343fe'::uuid,'dac29cf5-3ab3-4b8b-a889-7bcbf3139664'::uuid,3),
    ('a5421c66-1ba7-4d44-84bb-da33530d0545'::uuid,'56128e34-53c7-4565-87e1-fa4745860349'::uuid,3),
    ('a5c69327-a48b-4534-9a3c-4b200ab4889e'::uuid,'0fc9ec31-9304-4848-8b84-1534dabe357d'::uuid,3),
    ('a9ce878b-b777-4b02-ad50-100742beaf50'::uuid,'50d46ef9-7ce2-4e2a-ba13-99a45ed6bc54'::uuid,3),
    ('b2adaae4-d6b5-4f34-83d6-9fd64356783c'::uuid,'95d8330b-c647-462b-814e-9fcebc159176'::uuid,3),
    ('b60095a5-dbc0-4ac3-8ca4-9df6746dcfe3'::uuid,'dc937f82-c171-423b-8279-7c7c8c3de065'::uuid,3),
    ('b793b852-a172-45d6-ba20-c2829819b6cb'::uuid,'7ee1ac92-8e14-42ce-977a-5e91932960ce'::uuid,3),
    ('b9701fc8-5a3f-49ca-9a7c-0de1fa7979c7'::uuid,'35e6cb55-e2c5-4727-b658-e31a420b98e1'::uuid,3),
    ('ba458d4c-431b-4576-8efc-ce2af853ebee'::uuid,'fc450f35-d6ec-4d61-ba70-7e0d6cd360ec'::uuid,3),
    ('c4d88348-341c-496a-b4df-215d6dc01d0d'::uuid,'19f8dde6-134e-4643-9433-c8f1bd449b51'::uuid,3),
    ('c5c24b2f-aaa8-4edf-8098-18c58257ac13'::uuid,'56128e34-53c7-4565-87e1-fa4745860349'::uuid,3),
    ('c6d959a6-e2da-48a9-af57-84e787dd880d'::uuid,'203bfc5f-cfee-4b0f-9dc7-60137023d214'::uuid,4),
    ('c7c11b0d-35c5-4405-aef3-b270e0f412a6'::uuid,'203bfc5f-cfee-4b0f-9dc7-60137023d214'::uuid,4),
    ('ce23d405-f460-4664-bd61-c4e06ab1258a'::uuid,'dac29cf5-3ab3-4b8b-a889-7bcbf3139664'::uuid,4),
    ('d0a16762-2f2f-42c7-b5d7-51677c8f0704'::uuid,'74dc5986-2e2c-4876-a341-c96c5b84baa9'::uuid,4),
    ('d317c622-6823-470a-83e0-b54c2b58e92e'::uuid,'203bfc5f-cfee-4b0f-9dc7-60137023d214'::uuid,4),
    ('d53ad2ed-73d1-4f6d-ada4-f08e047f183e'::uuid,'1a2352ab-0b12-4420-be70-af740f733fbf'::uuid,4),
    ('dca157a3-d539-422b-889a-8859a518ffc7'::uuid,'103117e5-3fc8-4c13-bba1-d4eab6678c80'::uuid,4),
    ('dcf6badf-74e3-45c6-a111-76725dc3c25a'::uuid,'54bbfd90-92b0-4cc4-b96f-7950df6723de'::uuid,4),
    ('dfeabfde-4bea-4db4-8314-a506a0ecab60'::uuid,'16dc96e2-9405-4987-9c25-7ff05247928f'::uuid,4),
    ('e30a9e5c-c3a1-44bd-966a-d5683e0f2ef1'::uuid,'95d8330b-c647-462b-814e-9fcebc159176'::uuid,4),
    ('e4275cdf-d69c-421e-8313-33921818e1b5'::uuid,'74dc5986-2e2c-4876-a341-c96c5b84baa9'::uuid,4),
    ('e6925aed-6234-4e34-a266-150a116f7813'::uuid,'b8023b07-a1ed-41f6-8cba-1dda679cd638'::uuid,4),
    ('e782be94-bc44-41a4-9fe1-2e14f1a8973d'::uuid,'45fd120a-c520-43e0-b745-ae5ce2283c01'::uuid,4),
    ('e892072f-1466-49e7-bfb4-c7fef04b10e9'::uuid,'44daab00-e8b2-49e3-bb85-1a067840ce97'::uuid,4),
    ('e9350521-23f0-4fe1-9058-928531af4f4d'::uuid,'c4d32067-e827-4fae-8627-07be3a1b79c9'::uuid,4),
    ('ef6ee979-ef67-4021-899a-f5fa359beb01'::uuid,'203bfc5f-cfee-4b0f-9dc7-60137023d214'::uuid,4),
    ('f7612756-d820-4e24-afc5-0318d4952d3a'::uuid,'7ee1ac92-8e14-42ce-977a-5e91932960ce'::uuid,4),
    ('f9118e88-00cf-4779-80a1-580e9f076f1d'::uuid,'926329fe-3d31-4ddf-b0f3-1336a50c6b85'::uuid,4),
    ('fb60326f-a284-4e70-8d4b-6c58d2a6c17c'::uuid,'19f8dde6-134e-4643-9433-c8f1bd449b51'::uuid,4),
    ('ffcc9af8-7a90-4a66-a10a-9427bf5a43ef'::uuid,'d6ba02e7-5b79-42a1-be44-03631565b0ca'::uuid,4);

  CREATE TEMP TABLE _b2_before ON COMMIT DROP AS
    SELECT s.id, s.status::text AS status, s.auto_renew, s.next_charge_at, s.payment_method_id
    FROM subscriptions_v2 s JOIN _b2 b ON b.sub_id = s.id;
  SELECT count(*) INTO v_cnt FROM _b2_before;
  IF v_cnt <> 80 THEN RAISE EXCEPTION 'B2 preflight rows % <> 80', v_cnt; END IF;

  FOR v_batch IN 1..4 LOOP
    WITH upd AS (
      UPDATE subscriptions_v2 s
      SET status = 'superseded',
          updated_at = now(),
          meta = COALESCE(s.meta,'{}'::jsonb) || jsonb_build_object(
            'past_due_superseded_duplicate', jsonb_build_object(
              'at', now(), 'batch', v_batch,
              'audit_key', 'audit-2026-08-02:pd-supersede:' || s.id::text,
              'sibling_subscription_id', b.sibling_id,
              'reason', 'stale past_due duplicate: no live provider link, >30d, no payment method, exactly one active/trial sibling'))
      FROM _b2 b
      WHERE b.sub_id = s.id AND b.batch = v_batch
        AND s.status = 'past_due'
        AND s.auto_renew = false
        AND s.payment_method_id IS NULL
        AND s.next_charge_at IS NULL
        AND s.updated_at < now() - interval '30 days'
        AND NOT EXISTS (SELECT 1 FROM provider_subscriptions ps WHERE ps.subscription_v2_id = s.id AND ps.state IN ('active','pending'))
        AND (SELECT count(*) FROM subscriptions_v2 sib WHERE sib.user_id = s.user_id AND sib.product_id = s.product_id AND sib.id <> s.id AND sib.status IN ('active','trial')) = 1
        AND EXISTS (SELECT 1 FROM subscriptions_v2 sib WHERE sib.id = b.sibling_id AND sib.user_id = s.user_id AND sib.product_id = s.product_id AND sib.status IN ('active','trial')
                     AND (s.access_end_at IS NULL OR sib.access_end_at IS NULL OR s.access_end_at <= sib.access_end_at))
        AND NOT EXISTS (SELECT 1 FROM entitlements e WHERE e.order_id = s.order_id AND e.status = 'active')
        AND NOT EXISTS (SELECT 1 FROM payments_v2 p WHERE p.order_id = s.order_id AND p.status = 'succeeded' AND COALESCE(p.paid_at, p.created_at) > now() - interval '60 days')
        AND COALESCE(s.billing_type,'') NOT IN ('installment','deferred')
        AND NOT EXISTS (SELECT 1 FROM installment_payments ip WHERE ip.order_id = s.order_id)
      RETURNING s.id
    ) SELECT count(*) INTO v_cnt FROM upd;
    IF v_cnt <> 20 THEN RAISE EXCEPTION 'B2 batch % rowcount % <> 20', v_batch, v_cnt; END IF;
  END LOOP;

  SELECT count(*) INTO v_cnt FROM subscriptions_v2 s JOIN _b2 b ON b.sub_id = s.id WHERE s.status = 'superseded';
  IF v_cnt <> 80 THEN RAISE EXCEPTION 'B2 total superseded % <> 80', v_cnt; END IF;

  SELECT count(*) INTO v_cnt FROM subscriptions_v2 s JOIN _b2 b ON b.sub_id = s.id
    WHERE s.auto_renew IS DISTINCT FROM false OR s.next_charge_at IS NOT NULL OR s.payment_method_id IS NOT NULL;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'B2 invariant violation on % rows', v_cnt; END IF;

  INSERT INTO audit_logs(actor_type, actor_label, action, entity_type, entity_id, target_user_id, meta)
  SELECT 'system', 'codex-execute-b2',
         'subscription.past_due_superseded_duplicate',
         'subscriptions_v2', bf.id::text, s.user_id,
         jsonb_build_object(
           'audit_key', 'audit-2026-08-02:pd-supersede:' || bf.id::text,
           'before', jsonb_build_object('status', bf.status, 'auto_renew', bf.auto_renew, 'next_charge_at', bf.next_charge_at),
           'after', jsonb_build_object('status', 'superseded', 'auto_renew', bf.auto_renew, 'next_charge_at', bf.next_charge_at),
           'sibling_subscription_id', b.sibling_id,
           'batch', b.batch,
           'rollback', format('UPDATE subscriptions_v2 SET status=%L WHERE id=%L;', bf.status, bf.id))
  FROM _b2_before bf
  JOIN _b2 b ON b.sub_id = bf.id
  JOIN subscriptions_v2 s ON s.id = bf.id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt <> 80 THEN RAISE EXCEPTION 'B2 audit rowcount % <> 80', v_cnt; END IF;
END $$;