-- СПРИНТ: SYSTEM ACTOR
-- Изменения в audit_logs для поддержки системных событий

-- 1. Сделать actor_user_id nullable
ALTER TABLE public.audit_logs ALTER COLUMN actor_user_id DROP NOT NULL;

-- 2. Добавить actor_type для различения пользовательских и системных событий
ALTER TABLE public.audit_logs 
ADD COLUMN IF NOT EXISTS actor_type text NOT NULL DEFAULT 'user';

-- 3. Добавить actor_label для идентификации источника системных событий
ALTER TABLE public.audit_logs 
ADD COLUMN IF NOT EXISTS actor_label text NULL;

-- 4. Индекс для эффективной фильтрации по типу актора
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_type_created 
ON public.audit_logs (actor_type, created_at DESC);

-- 5. Добавить check constraint для actor_type
ALTER TABLE public.audit_logs 
ADD CONSTRAINT audit_logs_actor_type_check 
CHECK (actor_type IN ('user', 'system'));