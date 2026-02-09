
-- Add 'superseded' and 'expired_reentry' to subscription_status enum
ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'superseded';
ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'expired_reentry';
