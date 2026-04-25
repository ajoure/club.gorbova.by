-- Staging-таблица для операций ревизии
DROP TABLE IF EXISTS public.rev_7101ed3c_ops;
CREATE TABLE public.rev_7101ed3c_ops (
  seq bigserial PRIMARY KEY,
  payload jsonb NOT NULL
);
ALTER TABLE public.rev_7101ed3c_ops ENABLE ROW LEVEL SECURITY;
CREATE POLICY rev_ops_admin_only ON public.rev_7101ed3c_ops FOR SELECT USING (false);

-- Функция-исполнитель ревизии (idempotency: TRUNCATE staging в конце)
CREATE OR REPLACE FUNCTION public.apply_rev_7101ed3c(_batch_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _op  jsonb;
  _b_ar bigint; _a_ar bigint;
  _b_e  bigint; _a_e  bigint;
  _b_s  bigint; _a_s  bigint;
  _b_t  bigint; _a_t  bigint;
  _cnt_ins int := 0; _cnt_upd int := 0; _cnt_arch int := 0; _cnt_prof int := 0;
BEGIN
  SELECT count(*) INTO _b_ar FROM access_rules           WHERE created_at >= now() - interval '1 minute';
  SELECT count(*) INTO _b_e  FROM entitlements           WHERE created_at >= now() - interval '1 minute';
  SELECT count(*) INTO _b_s  FROM subscriptions_v2       WHERE created_at >= now() - interval '1 minute';
  SELECT count(*) INTO _b_t  FROM telegram_access_grants WHERE created_at >= now() - interval '1 minute';

  FOR _op IN SELECT payload FROM public.rev_7101ed3c_ops ORDER BY seq
  LOOP
    CASE _op->>'op'
      WHEN 'create_profile' THEN
        INSERT INTO profiles (id, email, full_name, is_archived, user_id, source, created_at, updated_at)
        VALUES ((_op->>'profile_id')::uuid, _op->>'email', _op->>'full_name', true, NULL, 'revision_7101ed3c', now(), now());
        _cnt_prof := _cnt_prof + 1;

      WHEN 'insert_order' THEN
        INSERT INTO orders_v2 (id, order_number, profile_id, user_id, product_id, tariff_id, base_price, final_price, currency, status, deal_date, customer_email, meta, reconcile_source, created_at, updated_at)
        VALUES (
          (_op->>'order_id')::uuid, _op->>'order_number', (_op->>'profile_id')::uuid, NULL,
          '7101ed3c-7839-4a74-ad95-aa0660369b22'::uuid, (_op->>'tariff_id')::uuid,
          (_op->>'price')::numeric, (_op->>'price')::numeric, 'BYN', 'paid',
          (_op->>'deal_date')::timestamptz, _op->>'email',
          jsonb_build_object('batch_id',_batch_id,'import_source','revision_7101ed3c','source_row_index',(_op->>'source_row_index')::int,'source_raw_tariff_name',_op->>'source_raw_tariff_name','source_raw_price',_op->>'source_raw_price'),
          'revision_7101ed3c', now(), now()
        );
        _cnt_ins := _cnt_ins + 1;

      WHEN 'update_match' THEN
        UPDATE orders_v2 SET base_price=(_op->>'price')::numeric, final_price=(_op->>'price')::numeric, currency='BYN', deal_date=(_op->>'deal_date')::timestamptz,
          meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('revision_batch_id',_batch_id,'revision_source','revision_7101ed3c','revision_source_row_index',(_op->>'source_row_index')::int,'revision_subcategory','update_existing_match','revision_before',_op->'before'),
          updated_at = now()
        WHERE id = (_op->>'order_id')::uuid;
        _cnt_upd := _cnt_upd + 1;

      WHEN 'update_tariff_mismatch' THEN
        UPDATE orders_v2 SET tariff_id=(_op->>'tariff_id')::uuid, base_price=(_op->>'price')::numeric, final_price=(_op->>'price')::numeric, currency='BYN', deal_date=(_op->>'deal_date')::timestamptz,
          meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('revision_batch_id',_batch_id,'revision_source','revision_7101ed3c','revision_source_row_index',(_op->>'source_row_index')::int,'revision_subcategory','tariff_mismatch_single_order','revision_before',_op->'before'),
          updated_at = now()
        WHERE id = (_op->>'order_id')::uuid;
        _cnt_upd := _cnt_upd + 1;

      WHEN 'update_keep' THEN
        UPDATE orders_v2 SET base_price=(_op->>'price')::numeric, final_price=(_op->>'price')::numeric, currency='BYN', deal_date=(_op->>'deal_date')::timestamptz,
          meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('revision_batch_id',_batch_id,'revision_source','revision_7101ed3c','revision_source_row_index',(_op->>'source_row_index')::int,'revision_subcategory','archive_duplicate_keep','revision_before',_op->'before'),
          updated_at = now()
        WHERE id = (_op->>'order_id')::uuid;
        _cnt_upd := _cnt_upd + 1;

      WHEN 'archive_dup' THEN
        UPDATE orders_v2 SET status='canceled',
          meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('revision_batch_id',_batch_id,'revision_source','revision_7101ed3c','revision_source_row_index',(_op->>'source_row_index')::int,'archived_reason','duplicate_of:'||(_op->>'kept_order_id'),'archived_before_status',_op->>'before_status','archived_before',_op->'before'),
          updated_at = now()
        WHERE id = (_op->>'order_id')::uuid;
        _cnt_arch := _cnt_arch + 1;

      ELSE RAISE EXCEPTION 'Unknown op: %', _op->>'op';
    END CASE;
  END LOOP;

  SELECT count(*) INTO _a_ar FROM access_rules           WHERE created_at >= now() - interval '5 minute';
  SELECT count(*) INTO _a_e  FROM entitlements           WHERE created_at >= now() - interval '5 minute';
  SELECT count(*) INTO _a_s  FROM subscriptions_v2       WHERE created_at >= now() - interval '5 minute';
  SELECT count(*) INTO _a_t  FROM telegram_access_grants WHERE created_at >= now() - interval '5 minute';
  IF _a_ar > _b_ar OR _a_e > _b_e OR _a_s > _b_s OR _a_t > _b_t THEN
    RAISE EXCEPTION 'ZERO-GRANTS VIOLATION: ar %->%, ent %->%, sub %->%, tg %->%', _b_ar,_a_ar,_b_e,_a_e,_b_s,_a_s,_b_t,_a_t;
  END IF;

  RETURN jsonb_build_object('batch_id',_batch_id,'profiles',_cnt_prof,'inserts',_cnt_ins,'updates',_cnt_upd,'archives',_cnt_arch);
END;
$$;