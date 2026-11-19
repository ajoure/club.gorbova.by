-- Add only fields used by the new branch to the synthetic base fixture.
ALTER TABLE public.subscriptions_v2 ADD COLUMN order_id uuid,ADD COLUMN is_trial boolean DEFAULT false;
ALTER TABLE public.payments_v2 ADD COLUMN user_id uuid,ADD COLUMN order_id uuid,ADD COLUMN paid_at timestamptz,ADD COLUMN reference_payment_id uuid;
ALTER TABLE public.orders_v2 ADD COLUMN product_id uuid,ADD COLUMN final_price numeric,ADD COLUMN currency text,ADD COLUMN is_trial boolean DEFAULT false,ADD COLUMN is_deleted boolean DEFAULT false;
