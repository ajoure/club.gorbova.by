DO $$
DECLARE
  v_full_offer  uuid := '5dfc9ca5-f601-4cf2-95ab-f0a3511f91cc';
  v_inst_offer  uuid := '7e9187ea-9b7d-48ed-b6d4-9ebf6284e8ae';
  v_tariff      uuid := '0fb3db55-b6ba-44bf-8a0b-37bb040ab01a';
  v_batch       text := 'p3_offer_id_backfill_multi_active_2026_05_22';
  v_now         timestamptz := now();
  v_n_full      int;
  v_n_inst      int;
BEGIN
  WITH upd AS (
    UPDATE orders_v2
       SET offer_id = v_full_offer,
           meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
                    'offer_id_backfill_source','multi_active_amount_match_350',
                    'offer_id_backfill_reason','full_payment_350',
                    'offer_id_backfill_batch', v_batch,
                    'offer_id_backfill_at',    v_now
                  )
     WHERE id IN (
       'da83a233-7bcd-435a-897d-46aa9918e0ff',
       'f8f17976-dc8c-46eb-9933-272baedb24c5',
       'f87bce7c-ff7d-4890-8535-cd10fae08b8c',
       'c86771cf-6a6a-4340-9aa5-06d292db2e54',
       'e4839a02-7d23-4dd1-ab2f-ef9f158a7557',
       'df2d8eda-0769-45e7-9a75-9b1f8dfe5808',
       '43c34b9a-9f57-4408-bdd0-a6ba49226f95',
       'a6067599-fe74-45d3-9eac-b2bb53d85ed0',
       '603e3336-b9b4-41a2-b6c2-2558a39aa798'
     )
       AND offer_id IS NULL
       AND tariff_id = v_tariff
       AND status   = 'paid'
       AND paid_amount = 350
    RETURNING id
  )
  SELECT count(*) INTO v_n_full FROM upd;

  IF v_n_full <> 9 THEN
    RAISE EXCEPTION 'Rowcount guard FAILED full_payment_350: expected 9, got %', v_n_full;
  END IF;

  WITH upd AS (
    UPDATE orders_v2
       SET offer_id = v_inst_offer,
           meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
                    'offer_id_backfill_source','multi_active_amount_match_195',
                    'offer_id_backfill_reason','installment_195',
                    'offer_id_backfill_batch', v_batch,
                    'offer_id_backfill_at',    v_now
                  )
     WHERE id = '65ef18e5-4d2d-4712-a85c-a41a5a18f4cc'
       AND offer_id IS NULL
       AND tariff_id = v_tariff
       AND paid_amount = 195
    RETURNING id
  )
  SELECT count(*) INTO v_n_inst FROM upd;

  IF v_n_inst <> 1 THEN
    RAISE EXCEPTION 'Rowcount guard FAILED installment_195: expected 1, got %', v_n_inst;
  END IF;

  INSERT INTO audit_logs(action, actor_type, actor_user_id, actor_label, meta)
  VALUES (
    'orders.offer_id_backfill_multi_active','system',NULL,v_batch,
    jsonb_build_object(
      'batch_id', v_batch,
      'tariff_id', v_tariff,
      'full_payment_350_updates', v_n_full,
      'installment_195_updates',  v_n_inst,
      'full_offer_id', v_full_offer,
      'installment_offer_id', v_inst_offer,
      'skipped_gift_order_id', 'a0ec1f74-868d-4ec5-8f8e-e926605e3e54'
    )
  );

  RAISE NOTICE 'Multi-active backfill OK: full=%, installment=%', v_n_full, v_n_inst;
END$$;