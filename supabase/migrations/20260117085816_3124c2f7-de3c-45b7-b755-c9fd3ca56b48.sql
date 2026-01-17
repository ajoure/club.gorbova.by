-- Add column to track if card supports recurring payments without 3DS
ALTER TABLE payment_methods 
ADD COLUMN IF NOT EXISTS supports_recurring BOOLEAN DEFAULT false;

COMMENT ON COLUMN payment_methods.supports_recurring IS 
  'true if card was tokenized with recurring contract, allowing merchant-initiated charges without 3DS';