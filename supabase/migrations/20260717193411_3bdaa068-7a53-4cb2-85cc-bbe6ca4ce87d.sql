UPDATE tariff_offers
SET meta = jsonb_set(meta, '{installment}', (meta->'installment') - 'max_charge_attempts', true)
WHERE id='7e9187ea-9b7d-48ed-b6d4-9ebf6284e8ae';

UPDATE payment_links SET status='invalidated', meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('invalidated_reason','p03_test_cleanup')
WHERE id='ded92390-a1ed-46f9-8965-bcb1f6c32736';