-- Таблица для хранения подключений интеграций (мультиаккаунт)
CREATE TABLE public.integration_instances (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('crm', 'payments', 'email', 'other')),
  provider TEXT NOT NULL,
  alias TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'error', 'disconnected')),
  last_check_at TIMESTAMP WITH TIME ZONE,
  config JSONB DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Таблица логов интеграций
CREATE TABLE public.integration_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id UUID NOT NULL REFERENCES public.integration_instances(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload_meta JSONB DEFAULT '{}'::jsonb,
  result TEXT NOT NULL CHECK (result IN ('success', 'error', 'pending')),
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Индексы
CREATE INDEX idx_integration_instances_category ON public.integration_instances(category);
CREATE INDEX idx_integration_instances_provider ON public.integration_instances(provider);
CREATE INDEX idx_integration_instances_is_default ON public.integration_instances(is_default);
CREATE INDEX idx_integration_logs_instance_id ON public.integration_logs(instance_id);
CREATE INDEX idx_integration_logs_created_at ON public.integration_logs(created_at DESC);

-- Триггер обновления updated_at
CREATE TRIGGER update_integration_instances_updated_at
  BEFORE UPDATE ON public.integration_instances
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.integration_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies для integration_instances
CREATE POLICY "Admins can view integration instances"
  ON public.integration_instances
  FOR SELECT
  USING (has_permission(auth.uid(), 'entitlements.manage'));

CREATE POLICY "Admins can manage integration instances"
  ON public.integration_instances
  FOR ALL
  USING (has_permission(auth.uid(), 'entitlements.manage'))
  WITH CHECK (has_permission(auth.uid(), 'entitlements.manage'));

-- RLS policies для integration_logs
CREATE POLICY "Admins can view integration logs"
  ON public.integration_logs
  FOR SELECT
  USING (has_permission(auth.uid(), 'entitlements.manage'));

CREATE POLICY "Admins can insert integration logs"
  ON public.integration_logs
  FOR INSERT
  WITH CHECK (has_permission(auth.uid(), 'entitlements.manage'));

-- Функция для обеспечения единственного default на тип provider
CREATE OR REPLACE FUNCTION public.ensure_single_default_integration()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_default = true THEN
    UPDATE public.integration_instances
    SET is_default = false
    WHERE provider = NEW.provider
      AND id != NEW.id
      AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ensure_single_default_integration_trigger
  BEFORE INSERT OR UPDATE ON public.integration_instances
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_single_default_integration();