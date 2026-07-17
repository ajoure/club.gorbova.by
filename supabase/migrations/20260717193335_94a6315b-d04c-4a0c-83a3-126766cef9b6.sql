UPDATE tariff_offers
SET meta = jsonb_set(meta, '{installment,max_charge_attempts}', '5'::jsonb, true)
WHERE id='7e9187ea-9b7d-48ed-b6d4-9ebf6284e8ae';