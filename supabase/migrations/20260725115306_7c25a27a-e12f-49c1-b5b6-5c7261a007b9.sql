
DO $$
DECLARE
  v_run_id text := 'a1b2c3d4-e5f6-7890-abcd-ef0123456789';
  v_profile_ids uuid[];
  v_user_ids uuid[];
  v_partner_ids uuid[];
  v_tx_ids uuid[];
  v_order_ids uuid[];
BEGIN
  -- Discover QA scope
  SELECT array_agg(id), array_agg(user_id) FILTER (WHERE user_id IS NOT NULL)
    INTO v_profile_ids, v_user_ids
  FROM public.profiles
  WHERE meta->>'qa_e2e_run_id' = v_run_id OR email LIKE 'qa.ref.%@example.test';

  SELECT array_agg(id) INTO v_partner_ids
  FROM public.referral_partners
  WHERE metadata->>'qa_e2e_run_id' = v_run_id
     OR (v_profile_ids IS NOT NULL AND profile_id = ANY(v_profile_ids));

  SELECT array_agg(id) INTO v_tx_ids
  FROM public.referral_balance_transactions
  WHERE v_partner_ids IS NOT NULL AND partner_id = ANY(v_partner_ids);

  SELECT array_agg(id) INTO v_order_ids
  FROM public.orders_v2
  WHERE (meta->>'qa_e2e_run_id' = v_run_id)
     OR (v_profile_ids IS NOT NULL AND profile_id = ANY(v_profile_ids));

  -- Sale attributions FIRST (they reference payments_v2 and orders_v2)
  IF v_partner_ids IS NOT NULL THEN
    DELETE FROM public.referral_sale_attributions WHERE partner_id = ANY(v_partner_ids);
  END IF;
  IF v_order_ids IS NOT NULL THEN
    DELETE FROM public.referral_sale_attributions WHERE order_id = ANY(v_order_ids);
  END IF;

  -- Payments must go before orders
  IF v_order_ids IS NOT NULL THEN
    DELETE FROM public.payments_v2 WHERE order_id = ANY(v_order_ids);
  END IF;

  -- Ledger: temporarily disable append-only triggers
  ALTER TABLE public.referral_balance_entries DISABLE TRIGGER referral_entries_append_only;
  ALTER TABLE public.referral_balance_transactions DISABLE TRIGGER referral_transactions_append_only;

  IF v_tx_ids IS NOT NULL THEN
    DELETE FROM public.referral_balance_entries WHERE transaction_id = ANY(v_tx_ids);
    DELETE FROM public.referral_balance_transactions WHERE id = ANY(v_tx_ids);
  END IF;

  ALTER TABLE public.referral_balance_entries ENABLE TRIGGER referral_entries_append_only;
  ALTER TABLE public.referral_balance_transactions ENABLE TRIGGER referral_transactions_append_only;

  -- Relationships + links
  IF v_partner_ids IS NOT NULL THEN
    DELETE FROM public.referral_relationships WHERE partner_id = ANY(v_partner_ids);
    DELETE FROM public.referral_program_links WHERE partner_id = ANY(v_partner_ids);
  END IF;
  IF v_profile_ids IS NOT NULL THEN
    DELETE FROM public.referral_relationships WHERE referred_profile_id = ANY(v_profile_ids);
  END IF;

  -- Orders (after payments and attributions gone)
  IF v_order_ids IS NOT NULL THEN
    DELETE FROM public.orders_v2 WHERE id = ANY(v_order_ids);
  END IF;

  -- Partners
  IF v_partner_ids IS NOT NULL THEN
    DELETE FROM public.referral_partners WHERE id = ANY(v_partner_ids);
  END IF;

  -- Notification outbox (targets QA users and QA-tagged meta)
  IF v_user_ids IS NOT NULL THEN
    DELETE FROM public.notification_outbox WHERE user_id = ANY(v_user_ids);
  END IF;
  DELETE FROM public.notification_outbox
  WHERE meta IS NOT NULL AND meta->>'qa_e2e_run_id' = v_run_id;

  -- Profiles
  IF v_profile_ids IS NOT NULL THEN
    DELETE FROM public.profiles WHERE id = ANY(v_profile_ids);
  END IF;

  -- Auth users (cascade will remove any leftover profiles too)
  IF v_user_ids IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = ANY(v_user_ids);
  END IF;

  -- Also sweep any lingering qa auth users by email prefix
  DELETE FROM auth.users WHERE email LIKE 'qa.ref.%@example.test';
END $$;

-- Post-cleanup verification (raises if anything remains)
DO $$
DECLARE v_cnt bigint; BEGIN
  SELECT count(*) INTO v_cnt FROM public.profiles WHERE email LIKE 'qa.ref.%@example.test' OR meta->>'qa_e2e_run_id' IS NOT NULL;
  IF v_cnt > 0 THEN RAISE EXCEPTION 'qa profiles residue: %', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM public.referral_partners WHERE metadata->>'qa_e2e_run_id' IS NOT NULL;
  IF v_cnt > 0 THEN RAISE EXCEPTION 'qa partners residue: %', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM public.referral_balance_transactions t
    JOIN public.referral_balance_entries e ON e.transaction_id = t.id
    WHERE t.description ILIKE '%приглашённого%' AND t.created_at > now() - interval '2 hours' AND t.partner_id NOT IN (SELECT id FROM public.referral_partners);
  -- entries with orphan partner check
  SELECT count(*) INTO v_cnt FROM public.referral_balance_entries WHERE partner_id NOT IN (SELECT id FROM public.referral_partners);
  IF v_cnt > 0 THEN RAISE EXCEPTION 'orphan ledger entries: %', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM auth.users WHERE email LIKE 'qa.ref.%@example.test';
  IF v_cnt > 0 THEN RAISE EXCEPTION 'qa auth users residue: %', v_cnt; END IF;
END $$;
