-- Allow NULL user_id for orders linked to ghost profiles (imported deals without real auth users)
ALTER TABLE public.orders_v2 
  ALTER COLUMN user_id DROP NOT NULL;