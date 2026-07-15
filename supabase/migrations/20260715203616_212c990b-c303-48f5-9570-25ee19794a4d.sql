BEGIN;
SET LOCAL search_path = public, pg_temp;

ALTER TABLE public.tariff_offers
  DROP CONSTRAINT IF EXISTS tariff_offers_meta_slot_role_format,
  DROP CONSTRAINT IF EXISTS tariff_offers_meta_site_button_variant_allowlist;

ALTER TABLE public.tariff_offers
  ADD CONSTRAINT tariff_offers_meta_slot_role_format
  CHECK (
    meta IS NULL
    OR NOT (meta ? 'slot_role')
    OR nullif(meta->>'slot_role','') IS NULL
    OR (meta->>'slot_role') ~ '^[a-z0-9_]{2,64}$'
  );

ALTER TABLE public.tariff_offers
  ADD CONSTRAINT tariff_offers_meta_site_button_variant_allowlist
  CHECK (
    meta IS NULL
    OR NOT (meta ? 'site_button_variant')
    OR nullif(meta->>'site_button_variant','') IS NULL
    OR (meta->>'site_button_variant') IN ('primary','outline','installment','legal_entity','lead')
  );

DROP INDEX IF EXISTS public.tariff_offers_slot_role_per_tariff_uidx;
CREATE UNIQUE INDEX tariff_offers_slot_role_per_tariff_uidx
  ON public.tariff_offers (tariff_id, ((meta->>'slot_role')))
  WHERE nullif(meta->>'slot_role','') IS NOT NULL;

DO $$
DECLARE
  m jsonb;
  row_cur record;
  updates_count integer := 0;
  expected_count integer;
  dup_found boolean;
  unknown_found boolean;
BEGIN
  m := jsonb_build_array(
    jsonb_build_object('offer_id','390a5196-8143-4c8f-9bb6-ca84654918c8','tariff_id','38ee08c4-21db-4a97-86e6-303bd96c48db','offer_type','pay_now','payment_method','full_payment','installment_count',NULL,'button_label','Оплата картой','is_active',true,'slot_role','payment_card','site_button_variant','primary'),
    jsonb_build_object('offer_id','b6476800-cc42-4332-836d-5e63ccc83c47','tariff_id','38ee08c4-21db-4a97-86e6-303bd96c48db','offer_type','pay_now','payment_method','full_payment','installment_count',NULL,'button_label','Оплатить от ЮЛ','is_active',true,'slot_role','payment_invoice','site_button_variant','legal_entity'),
    jsonb_build_object('offer_id','ba6d162c-d9c4-4fb9-99cd-71a6b3f91b92','tariff_id','38ee08c4-21db-4a97-86e6-303bd96c48db','offer_type','bank_installment','payment_method','full_payment','installment_count',NULL,'button_label','Оплатить в рассрочку от банка','is_active',true,'slot_role','installment_bank','site_button_variant','installment'),
    jsonb_build_object('offer_id','7ce395b0-d2b8-4128-b4e2-b00021c5ba3b','tariff_id','38ee08c4-21db-4a97-86e6-303bd96c48db','offer_type','lead','payment_method','full_payment','installment_count',NULL,'button_label','Оставить заявку','is_active',false,'slot_role','lead','site_button_variant','lead'),
    jsonb_build_object('offer_id','b2b533e1-0ce3-4ba2-bcfe-ddacc7df30da','tariff_id','38ee08c4-21db-4a97-86e6-303bd96c48db','offer_type','pay_now','payment_method','internal_installment','installment_count',3,'button_label','Оплатить в рассрочку','is_active',false,'slot_role','installment_3','site_button_variant','installment'),
    jsonb_build_object('offer_id','8d10f0c1-8af7-41a1-ac34-791e0e844132','tariff_id','a18df7a7-9c8b-4e63-9ea9-b6887c23927f','offer_type','pay_now','payment_method','full_payment','installment_count',NULL,'button_label','Оплатить обучение','is_active',true,'slot_role','payment_card','site_button_variant','primary'),
    jsonb_build_object('offer_id','d749583b-86ba-44cc-9d9c-bd0e38a70137','tariff_id','a18df7a7-9c8b-4e63-9ea9-b6887c23927f','offer_type','pay_now','payment_method','full_payment','installment_count',NULL,'button_label','Оплатить от ЮЛ','is_active',true,'slot_role','payment_invoice','site_button_variant','legal_entity'),
    jsonb_build_object('offer_id','52091c22-3b1e-412a-a96e-26ad54c02a26','tariff_id','a18df7a7-9c8b-4e63-9ea9-b6887c23927f','offer_type','pay_now','payment_method','internal_installment','installment_count',3,'button_label','Оплатить в два этапа','is_active',true,'slot_role','installment_2','site_button_variant','installment'),
    jsonb_build_object('offer_id','2bef1db8-b4b6-44bb-b62e-72cd0d713550','tariff_id','a18df7a7-9c8b-4e63-9ea9-b6887c23927f','offer_type','pay_now','payment_method','internal_installment','installment_count',3,'button_label','Рассрочка на 3 месяца','is_active',true,'slot_role','installment_3','site_button_variant','installment'),
    jsonb_build_object('offer_id','58de9fea-808f-40e0-a5ef-f3c5ee14414f','tariff_id','a18df7a7-9c8b-4e63-9ea9-b6887c23927f','offer_type','bank_installment','payment_method','full_payment','installment_count',NULL,'button_label','Заявка на рассрочку','is_active',true,'slot_role','installment_bank','site_button_variant','installment'),
    jsonb_build_object('offer_id','0067b672-fde9-412c-8b78-0e7d589ec8ba','tariff_id','a18df7a7-9c8b-4e63-9ea9-b6887c23927f','offer_type','lead','payment_method','full_payment','installment_count',NULL,'button_label','Оставить заявку','is_active',true,'slot_role','lead','site_button_variant','lead'),
    jsonb_build_object('offer_id','27774500-973b-46da-91fd-9feb59bde522','tariff_id','767bb895-30fa-49c9-8f31-d0794590020a','offer_type','pay_now','payment_method','full_payment','installment_count',NULL,'button_label','Оплатить обучение','is_active',true,'slot_role','payment_card','site_button_variant','primary'),
    jsonb_build_object('offer_id','4c6d6110-5c9b-419c-82ef-524dfe44ecc1','tariff_id','767bb895-30fa-49c9-8f31-d0794590020a','offer_type','pay_now','payment_method','full_payment','installment_count',NULL,'button_label','Оплатить от ЮЛ','is_active',true,'slot_role','payment_invoice','site_button_variant','legal_entity'),
    jsonb_build_object('offer_id','26f6ed06-69fb-4aaf-964a-2f3668a2085b','tariff_id','767bb895-30fa-49c9-8f31-d0794590020a','offer_type','pay_now','payment_method','internal_installment','installment_count',3,'button_label','Оплатить в рассрочку','is_active',true,'slot_role','installment_3','site_button_variant','installment'),
    jsonb_build_object('offer_id','136a1076-eadf-4e5a-8443-5856f85c2d90','tariff_id','767bb895-30fa-49c9-8f31-d0794590020a','offer_type','bank_installment','payment_method','full_payment','installment_count',NULL,'button_label','Заявка на рассрочку','is_active',true,'slot_role','installment_bank','site_button_variant','installment'),
    jsonb_build_object('offer_id','6bd271a7-f716-4996-810c-f401b8d5f97d','tariff_id','767bb895-30fa-49c9-8f31-d0794590020a','offer_type','lead','payment_method','full_payment','installment_count',NULL,'button_label','Оставить заявку','is_active',true,'slot_role','lead','site_button_variant','lead')
  );

  expected_count := jsonb_array_length(m);
  IF expected_count <> 16 THEN
    RAISE EXCEPTION 'Phase B backfill: expected 16 manifest entries, got %', expected_count;
  END IF;

  FOR row_cur IN
    SELECT (item->>'offer_id')::uuid                                   AS offer_id,
           (item->>'tariff_id')::uuid                                  AS tariff_id,
            item->>'offer_type'                                        AS offer_type,
            item->>'payment_method'                                    AS payment_method,
            NULLIF(item->>'installment_count','')::int                 AS installment_count,
            item->>'button_label'                                      AS button_label,
           (item->>'is_active')::boolean                               AS is_active
    FROM jsonb_array_elements(m) AS item
  LOOP
    PERFORM 1
      FROM public.tariff_offers o
      JOIN public.tariffs t ON t.id = o.tariff_id
     WHERE o.id = row_cur.offer_id
       AND o.tariff_id = row_cur.tariff_id
       AND t.product_id = '3e43fb28-8322-41bc-bfee-714731bdc630'::uuid
       AND o.offer_type = row_cur.offer_type
       AND o.payment_method = row_cur.payment_method
       AND o.installment_count IS NOT DISTINCT FROM row_cur.installment_count
       AND o.button_label = row_cur.button_label
       AND o.is_active = row_cur.is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Phase B preflight failed: offer % does not match frozen manifest', row_cur.offer_id;
    END IF;
  END LOOP;

  FOR row_cur IN
    SELECT (item->>'offer_id')::uuid AS offer_id,
            item->>'slot_role'       AS slot_role,
            item->>'site_button_variant' AS site_button_variant
    FROM jsonb_array_elements(m) AS item
  LOOP
    UPDATE public.tariff_offers
       SET meta = COALESCE(meta, '{}'::jsonb)
                  || jsonb_build_object(
                       'slot_role', row_cur.slot_role,
                       'site_button_variant', row_cur.site_button_variant
                     )
     WHERE id = row_cur.offer_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Phase B backfill: UPDATE affected 0 rows for offer %', row_cur.offer_id;
    END IF;
    updates_count := updates_count + 1;
  END LOOP;

  IF updates_count <> 16 THEN
    RAISE EXCEPTION 'Phase B backfill: expected 16 updates, got %', updates_count;
  END IF;

  SELECT EXISTS(
    SELECT 1
      FROM (
        SELECT o.tariff_id AS tid, o.meta->>'slot_role' AS role, COUNT(*) AS c
          FROM public.tariff_offers o
          JOIN public.tariffs t ON t.id = o.tariff_id
         WHERE t.product_id = '3e43fb28-8322-41bc-bfee-714731bdc630'::uuid
           AND nullif(o.meta->>'slot_role','') IS NOT NULL
         GROUP BY o.tariff_id, o.meta->>'slot_role'
         HAVING COUNT(*) > 1
      ) d
  ) INTO dup_found;
  IF dup_found THEN
    RAISE EXCEPTION 'Phase B backfill: duplicate (tariff_id, slot_role) detected';
  END IF;

  SELECT EXISTS(
    SELECT 1
      FROM public.tariff_offers o
      JOIN public.tariffs t ON t.id = o.tariff_id
     WHERE t.product_id = '3e43fb28-8322-41bc-bfee-714731bdc630'::uuid
       AND nullif(o.meta->>'site_button_variant','') IS NOT NULL
       AND (o.meta->>'site_button_variant') NOT IN ('primary','outline','installment','legal_entity','lead')
  ) INTO unknown_found;
  IF unknown_found THEN
    RAISE EXCEPTION 'Phase B backfill: unknown site_button_variant detected';
  END IF;

  RAISE NOTICE 'Phase B step 1 OK: 16 offers backfilled, 0 conflicts, 0 unknown variants.';
END $$;

COMMIT;