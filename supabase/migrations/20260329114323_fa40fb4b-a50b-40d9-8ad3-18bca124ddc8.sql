
-- CB2S Follow-up: Import 8 remaining rows (batch: cb2s_followup_final_8)

-- 1. Ghost profiles
INSERT INTO profiles (id, email, phone, first_name, last_name, full_name)
VALUES
  (gen_random_uuid(), 'apotekina@mail.ru', '+375291647943', 'Анастасия', 'Потекина', 'Анастасия Потекина'),
  (gen_random_uuid(), 'dar.gurinovich123@gmail.com', '+375299592052', 'Дарья', 'Гуринович', 'Дарья Гуринович')
ON CONFLICT DO NOTHING;

-- 2. Orders
INSERT INTO orders_v2 (order_number, user_id, product_id, tariff_id, flow_id, status, currency, provider, reconcile_source, profile_id, final_price, paid_amount, base_price, discount_percent, payer_type, meta)
VALUES
  ('MIG-CB2S-ROW-30', '84b60f85-a7d4-4eaf-b31d-666c96ebf79f', '87a8870f-d426-419a-9f15-faa76c3f2be3', '5d598dae-4933-47a6-9af9-c0e05940ea9e', 'b28f0254-5f14-4f6f-abad-0af9aeab57e1', 'paid', 'BYN', 'getcourse', 'getcourse_historical', 'be175bf1-8eec-44f6-a5f0-09b54e0bc628', 1990.0, 1990.0, 0, 0, 'individual',
   '{"source":"cb2s_followup_final_8","batch_id":"cb2s_followup_final_8","source_row":"30","flow_code":"flow-3","non_mit_historical_active":true,"duplicate_resolution":"keep_row30_skip_row31_higher_amount"}'::jsonb),
  ('MIG-CB2S-ROW-35', '1658b558-edf3-46ab-89f3-0fe712bbfbe0', '87a8870f-d426-419a-9f15-faa76c3f2be3', '5d598dae-4933-47a6-9af9-c0e05940ea9e', 'b28f0254-5f14-4f6f-abad-0af9aeab57e1', 'paid', 'BYN', 'getcourse', 'getcourse_historical', 'b48a7646-7388-40f2-9113-36654e5a7fdc', 366.0, 366.0, 0, 0, 'individual',
   '{"source":"cb2s_followup_final_8","batch_id":"cb2s_followup_final_8","source_row":"35","flow_code":"flow-3","non_mit_historical_active":true,"duplicate_resolution":"keep_row35_skip_row36_same_amount_earlier_row"}'::jsonb),
  ('MIG-CB2S-ROW-38', '57ed7da6-5521-466a-b9bd-14e2f854d671', '87a8870f-d426-419a-9f15-faa76c3f2be3', '5d598dae-4933-47a6-9af9-c0e05940ea9e', 'b28f0254-5f14-4f6f-abad-0af9aeab57e1', 'paid', 'BYN', 'getcourse', 'getcourse_historical', '165cd052-b1f9-400b-9e8c-9a4d093ba35f', 1990.0, 1990.0, 0, 0, 'individual',
   '{"source":"cb2s_followup_final_8","batch_id":"cb2s_followup_final_8","source_row":"38","flow_code":"flow-3","non_mit_historical_active":true,"duplicate_resolution":"keep_row38_skip_row39_higher_amount"}'::jsonb),
  ('MIG-CB2S-ROW-40', '1b68252b-62ca-4e99-b1fd-d07706ac134d', '87a8870f-d426-419a-9f15-faa76c3f2be3', '5d598dae-4933-47a6-9af9-c0e05940ea9e', 'b28f0254-5f14-4f6f-abad-0af9aeab57e1', 'paid', 'BYN', 'getcourse', 'getcourse_historical', '77326882-efd6-4769-bb8b-16fb2ed85edc', 366.0, 366.0, 0, 0, 'individual',
   '{"source":"cb2s_followup_final_8","batch_id":"cb2s_followup_final_8","source_row":"40","flow_code":"flow-3","non_mit_historical_active":true,"duplicate_resolution":"keep_row40_skip_row41_same_amount_earlier_row"}'::jsonb),
  ('MIG-CB2S-ROW-2', 'f4dba33b-6afb-4360-a7ee-a94f58858ae2', '87a8870f-d426-419a-9f15-faa76c3f2be3', '5d598dae-4933-47a6-9af9-c0e05940ea9e', '94dc4c62-7ae1-42c8-b284-3ac89f7a42b1', 'paid', 'BYN', 'getcourse', 'getcourse_historical', 'f0a4fcda-d361-4e2f-bbf4-1b0f41b063dd', 1930.0, 1930.0, 0, 0, 'individual',
   '{"source":"cb2s_followup_final_8","batch_id":"cb2s_followup_final_8","source_row":"2","flow_code":"flow-1","non_mit_historical_active":true,"unmatched_resolution":"matched_by_phone_alexasermyazhko"}'::jsonb),
  ('MIG-CB2S-ROW-87', 'e296da5b-cb46-4155-ac47-53fa6aefc831', '87a8870f-d426-419a-9f15-faa76c3f2be3', '5d598dae-4933-47a6-9af9-c0e05940ea9e', 'b28f0254-5f14-4f6f-abad-0af9aeab57e1', 'paid', 'BYN', 'getcourse', 'getcourse_historical', '3c148831-133a-4dad-b978-06cd46b0ea20', 1990.0, 1990.0, 0, 0, 'individual',
   '{"source":"cb2s_followup_final_8","batch_id":"cb2s_followup_final_8","source_row":"87","flow_code":"flow-3","non_mit_historical_active":true,"unmatched_resolution":"matched_by_telegram_mbsolga571"}'::jsonb),
  ('MIG-CB2S-ROW-14',
   (SELECT id FROM profiles WHERE email = 'apotekina@mail.ru' LIMIT 1),
   '87a8870f-d426-419a-9f15-faa76c3f2be3', '5d598dae-4933-47a6-9af9-c0e05940ea9e', 'b28f0254-5f14-4f6f-abad-0af9aeab57e1', 'paid', 'BYN', 'getcourse', 'getcourse_historical',
   (SELECT id FROM profiles WHERE email = 'apotekina@mail.ru' LIMIT 1),
   1990.0, 1990.0, 0, 0, 'individual',
   '{"source":"cb2s_followup_final_8","batch_id":"cb2s_followup_final_8","source_row":"14","flow_code":"flow-3","non_mit_historical_active":true,"ghost_profile":true,"is_ghost_grant":true}'::jsonb),
  ('MIG-CB2S-ROW-28',
   (SELECT id FROM profiles WHERE email = 'dar.gurinovich123@gmail.com' LIMIT 1),
   '87a8870f-d426-419a-9f15-faa76c3f2be3', '34628d81-91f7-4261-a231-ad1e118d71df', '94dc4c62-7ae1-42c8-b284-3ac89f7a42b1', 'paid', 'BYN', 'getcourse', 'getcourse_historical',
   (SELECT id FROM profiles WHERE email = 'dar.gurinovich123@gmail.com' LIMIT 1),
   900.0, 900.0, 0, 0, 'individual',
   '{"source":"cb2s_followup_final_8","batch_id":"cb2s_followup_final_8","source_row":"28","flow_code":"flow-1","non_mit_historical_active":true,"ghost_profile":true,"is_ghost_grant":true}'::jsonb)
ON CONFLICT (order_number) DO NOTHING;

-- 3. Subscriptions
INSERT INTO subscriptions_v2 (user_id, product_id, tariff_id, flow_id, status, access_start_at, access_end_at, billing_type, auto_renew, profile_id, meta)
VALUES
  ('84b60f85-a7d4-4eaf-b31d-666c96ebf79f', '87a8870f-d426-419a-9f15-faa76c3f2be3', '5d598dae-4933-47a6-9af9-c0e05940ea9e', 'b28f0254-5f14-4f6f-abad-0af9aeab57e1', 'active', now(), now() + interval '270 days', 'mit', false, 'be175bf1-8eec-44f6-a5f0-09b54e0bc628', '{"batch_id":"cb2s_followup_final_8","non_mit_historical_active":true}'::jsonb),
  ('1658b558-edf3-46ab-89f3-0fe712bbfbe0', '87a8870f-d426-419a-9f15-faa76c3f2be3', '5d598dae-4933-47a6-9af9-c0e05940ea9e', 'b28f0254-5f14-4f6f-abad-0af9aeab57e1', 'active', now(), now() + interval '270 days', 'mit', false, 'b48a7646-7388-40f2-9113-36654e5a7fdc', '{"batch_id":"cb2s_followup_final_8","non_mit_historical_active":true}'::jsonb),
  ('57ed7da6-5521-466a-b9bd-14e2f854d671', '87a8870f-d426-419a-9f15-faa76c3f2be3', '5d598dae-4933-47a6-9af9-c0e05940ea9e', 'b28f0254-5f14-4f6f-abad-0af9aeab57e1', 'active', now(), now() + interval '270 days', 'mit', false, '165cd052-b1f9-400b-9e8c-9a4d093ba35f', '{"batch_id":"cb2s_followup_final_8","non_mit_historical_active":true}'::jsonb),
  ('1b68252b-62ca-4e99-b1fd-d07706ac134d', '87a8870f-d426-419a-9f15-faa76c3f2be3', '5d598dae-4933-47a6-9af9-c0e05940ea9e', 'b28f0254-5f14-4f6f-abad-0af9aeab57e1', 'active', now(), now() + interval '270 days', 'mit', false, '77326882-efd6-4769-bb8b-16fb2ed85edc', '{"batch_id":"cb2s_followup_final_8","non_mit_historical_active":true}'::jsonb),
  ('f4dba33b-6afb-4360-a7ee-a94f58858ae2', '87a8870f-d426-419a-9f15-faa76c3f2be3', '5d598dae-4933-47a6-9af9-c0e05940ea9e', '94dc4c62-7ae1-42c8-b284-3ac89f7a42b1', 'active', now(), now() + interval '270 days', 'mit', false, 'f0a4fcda-d361-4e2f-bbf4-1b0f41b063dd', '{"batch_id":"cb2s_followup_final_8","non_mit_historical_active":true}'::jsonb),
  ('e296da5b-cb46-4155-ac47-53fa6aefc831', '87a8870f-d426-419a-9f15-faa76c3f2be3', '5d598dae-4933-47a6-9af9-c0e05940ea9e', 'b28f0254-5f14-4f6f-abad-0af9aeab57e1', 'active', now(), now() + interval '270 days', 'mit', false, '3c148831-133a-4dad-b978-06cd46b0ea20', '{"batch_id":"cb2s_followup_final_8","non_mit_historical_active":true}'::jsonb),
  ((SELECT id FROM profiles WHERE email = 'apotekina@mail.ru' LIMIT 1), '87a8870f-d426-419a-9f15-faa76c3f2be3', '5d598dae-4933-47a6-9af9-c0e05940ea9e', 'b28f0254-5f14-4f6f-abad-0af9aeab57e1', 'active', now(), now() + interval '270 days', 'mit', false, (SELECT id FROM profiles WHERE email = 'apotekina@mail.ru' LIMIT 1), '{"batch_id":"cb2s_followup_final_8","non_mit_historical_active":true,"ghost_profile":true}'::jsonb),
  ((SELECT id FROM profiles WHERE email = 'dar.gurinovich123@gmail.com' LIMIT 1), '87a8870f-d426-419a-9f15-faa76c3f2be3', '34628d81-91f7-4261-a231-ad1e118d71df', '94dc4c62-7ae1-42c8-b284-3ac89f7a42b1', 'active', now(), now() + interval '270 days', 'mit', false, (SELECT id FROM profiles WHERE email = 'dar.gurinovich123@gmail.com' LIMIT 1), '{"batch_id":"cb2s_followup_final_8","non_mit_historical_active":true,"ghost_profile":true}'::jsonb);

-- 4. Entitlements (only for users with real auth user_id)
INSERT INTO entitlements (user_id, product_id, product_code, status, meta)
VALUES
  ('84b60f85-a7d4-4eaf-b31d-666c96ebf79f', '87a8870f-d426-419a-9f15-faa76c3f2be3', 'cb_2_step', 'active', '{"batch_id":"cb2s_followup_final_8","source_row":"30"}'::jsonb),
  ('1658b558-edf3-46ab-89f3-0fe712bbfbe0', '87a8870f-d426-419a-9f15-faa76c3f2be3', 'cb_2_step', 'active', '{"batch_id":"cb2s_followup_final_8","source_row":"35"}'::jsonb),
  ('57ed7da6-5521-466a-b9bd-14e2f854d671', '87a8870f-d426-419a-9f15-faa76c3f2be3', 'cb_2_step', 'active', '{"batch_id":"cb2s_followup_final_8","source_row":"38"}'::jsonb),
  ('1b68252b-62ca-4e99-b1fd-d07706ac134d', '87a8870f-d426-419a-9f15-faa76c3f2be3', 'cb_2_step', 'active', '{"batch_id":"cb2s_followup_final_8","source_row":"40"}'::jsonb),
  ('f4dba33b-6afb-4360-a7ee-a94f58858ae2', '87a8870f-d426-419a-9f15-faa76c3f2be3', 'cb_2_step', 'active', '{"batch_id":"cb2s_followup_final_8","source_row":"2"}'::jsonb),
  ('e296da5b-cb46-4155-ac47-53fa6aefc831', '87a8870f-d426-419a-9f15-faa76c3f2be3', 'cb_2_step', 'active', '{"batch_id":"cb2s_followup_final_8","source_row":"87"}'::jsonb)
ON CONFLICT (user_id, product_code) DO NOTHING;

-- 5. Audit
INSERT INTO audit_logs (action, actor_type, actor_label, meta)
VALUES ('cb2s_followup_final_8_import', 'system', 'cb2s_followup_final_8', 
  '{"affected_count":8,"orders_created":8,"subscriptions_created":8,"entitlements_created":6,"ghost_profiles_created":2,"duplicate_rows_skipped":[31,36,39,41],"ghost_rows":[14,28],"matched_rows":[2,87]}'::jsonb);
