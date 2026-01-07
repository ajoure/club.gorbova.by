-- Add payment method and installment settings to tariff_offers
ALTER TABLE tariff_offers ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'full_payment';
-- Значения: 'full_payment', 'internal_installment', 'bank_installment'

ALTER TABLE tariff_offers ADD COLUMN IF NOT EXISTS installment_count integer;
-- Количество платежей (например: 3, 6, 12)

ALTER TABLE tariff_offers ADD COLUMN IF NOT EXISTS installment_interval_days integer DEFAULT 30;
-- Интервал между платежами в днях

ALTER TABLE tariff_offers ADD COLUMN IF NOT EXISTS first_payment_delay_days integer DEFAULT 0;
-- Задержка первого платежа (0 = сразу, 7 = через неделю)

-- Add comment for documentation
COMMENT ON COLUMN tariff_offers.payment_method IS 'Payment method: full_payment, internal_installment, bank_installment';
COMMENT ON COLUMN tariff_offers.installment_count IS 'Number of installment payments';
COMMENT ON COLUMN tariff_offers.installment_interval_days IS 'Days between installment payments';
COMMENT ON COLUMN tariff_offers.first_payment_delay_days IS 'Days to delay first payment (0 = immediate)';