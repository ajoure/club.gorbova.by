-- Добавить уникальный constraint для идемпотентности payments
-- Сначала проверим дубликаты
DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT count(*) INTO dup_count
  FROM (
    SELECT provider, provider_payment_id, count(*) as cnt
    FROM payments_v2
    WHERE provider_payment_id IS NOT NULL
    GROUP BY provider, provider_payment_id
    HAVING count(*) > 1
  ) dups;
  
  IF dup_count > 0 THEN
    RAISE NOTICE 'Found % duplicate provider_payment_id combinations - skipping unique constraint', dup_count;
  END IF;
END $$;

-- Создаём уникальный индекс (partial - только где provider_payment_id не null)
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_v2_provider_unique 
ON payments_v2 (provider, provider_payment_id) 
WHERE provider_payment_id IS NOT NULL;