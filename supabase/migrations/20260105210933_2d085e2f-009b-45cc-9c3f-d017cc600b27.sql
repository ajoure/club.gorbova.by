-- Create payment_methods table for storing tokenized cards
CREATE TABLE public.payment_methods (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  provider TEXT NOT NULL DEFAULT 'bepaid',
  provider_token TEXT NOT NULL,
  brand TEXT,
  last4 TEXT,
  exp_month INTEGER,
  exp_year INTEGER,
  is_default BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active',
  meta JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for user lookups
CREATE INDEX idx_payment_methods_user_id ON public.payment_methods(user_id);

-- Enable RLS
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;

-- Users can view their own payment methods
CREATE POLICY "Users can view own payment methods"
ON public.payment_methods
FOR SELECT
USING (auth.uid() = user_id);

-- Users can insert their own payment methods
CREATE POLICY "Users can insert own payment methods"
ON public.payment_methods
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own payment methods
CREATE POLICY "Users can update own payment methods"
ON public.payment_methods
FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own payment methods
CREATE POLICY "Users can delete own payment methods"
ON public.payment_methods
FOR DELETE
USING (auth.uid() = user_id);

-- Admins can view all payment methods
CREATE POLICY "Admins can view all payment methods"
ON public.payment_methods
FOR SELECT
USING (has_permission(auth.uid(), 'users.view'));

-- Add trigger for updated_at
CREATE TRIGGER update_payment_methods_updated_at
  BEFORE UPDATE ON public.payment_methods
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add cancel_at and payment_method_id to subscriptions_v2
ALTER TABLE public.subscriptions_v2 
ADD COLUMN IF NOT EXISTS cancel_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS payment_method_id UUID REFERENCES public.payment_methods(id);

-- Create index for subscription payment method lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_v2_payment_method_id ON public.subscriptions_v2(payment_method_id);

-- Add first_name and last_name columns to profiles (currently has full_name)
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS first_name TEXT,
ADD COLUMN IF NOT EXISTS last_name TEXT;