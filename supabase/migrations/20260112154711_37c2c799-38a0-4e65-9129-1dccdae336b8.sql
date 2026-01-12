-- Add meta column to tariff_offers for storing welcome_message config
ALTER TABLE tariff_offers 
ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN tariff_offers.meta IS 'Additional offer settings including welcome_message for Telegram';