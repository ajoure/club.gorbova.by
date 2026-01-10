-- Add auto_renew column to subscriptions_v2
ALTER TABLE public.subscriptions_v2 
ADD COLUMN auto_renew BOOLEAN NOT NULL DEFAULT false;

-- Update existing trial subscriptions to have auto_renew = true
UPDATE public.subscriptions_v2 
SET auto_renew = true 
WHERE is_trial = true AND status = 'trial' AND trial_end_at > now();