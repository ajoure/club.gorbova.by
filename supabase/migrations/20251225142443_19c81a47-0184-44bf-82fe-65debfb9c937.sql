-- Create subscription tiers enum
CREATE TYPE public.subscription_tier AS ENUM ('free', 'pro', 'premium', 'webinar');

-- Create subscriptions table
CREATE TABLE public.subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tier subscription_tier NOT NULL DEFAULT 'free',
  starts_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

-- Create Eisenhower tasks table
CREATE TABLE public.eisenhower_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  quadrant TEXT NOT NULL CHECK (quadrant IN ('urgent-important', 'not-urgent-important', 'urgent-not-important', 'not-urgent-not-important')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create Balance Wheel data table
CREATE TABLE public.balance_wheel_data (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('audit', 'awareness', 'intention', 'goal', 'task', 'plan', 'action', 'reflection')),
  value INTEGER NOT NULL DEFAULT 5 CHECK (value >= 1 AND value <= 10),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, stage)
);

-- Enable RLS
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eisenhower_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.balance_wheel_data ENABLE ROW LEVEL SECURITY;

-- RLS policies for subscriptions
CREATE POLICY "Users can view their own subscription"
ON public.subscriptions FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Superadmins can manage all subscriptions"
ON public.subscriptions FOR ALL
USING (has_role(auth.uid(), 'superadmin'));

-- RLS policies for eisenhower_tasks
CREATE POLICY "Users can view their own tasks"
ON public.eisenhower_tasks FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own tasks"
ON public.eisenhower_tasks FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tasks"
ON public.eisenhower_tasks FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tasks"
ON public.eisenhower_tasks FOR DELETE
USING (auth.uid() = user_id);

-- RLS policies for balance_wheel_data
CREATE POLICY "Users can view their own balance data"
ON public.balance_wheel_data FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own balance data"
ON public.balance_wheel_data FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own balance data"
ON public.balance_wheel_data FOR UPDATE
USING (auth.uid() = user_id);

-- Trigger for subscriptions
CREATE TRIGGER update_subscriptions_updated_at
BEFORE UPDATE ON public.subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger for eisenhower_tasks
CREATE TRIGGER update_eisenhower_tasks_updated_at
BEFORE UPDATE ON public.eisenhower_tasks
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger for balance_wheel_data
CREATE TRIGGER update_balance_wheel_data_updated_at
BEFORE UPDATE ON public.balance_wheel_data
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create default subscription on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Create profile
  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data ->> 'full_name');
  
  -- Assign default user role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  
  -- Create free subscription
  INSERT INTO public.subscriptions (user_id, tier)
  VALUES (NEW.id, 'free');
  
  RETURN NEW;
END;
$$;