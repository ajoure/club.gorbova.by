UPDATE tariff_offers
SET meta = jsonb_set(meta, '{installment,max_charge_attempts}', 'null'::jsonb, false)
WHERE (meta->'installment'->>'max_charge_attempts') = '0';