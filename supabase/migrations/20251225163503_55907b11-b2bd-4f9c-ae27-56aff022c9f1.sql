-- Add importance and urgency fields (1-10 scale) to eisenhower_tasks
ALTER TABLE public.eisenhower_tasks 
ADD COLUMN IF NOT EXISTS importance integer NOT NULL DEFAULT 5,
ADD COLUMN IF NOT EXISTS urgency integer NOT NULL DEFAULT 5;

-- Add importance and urgency fields to wheel_balance_tasks (replace boolean with numeric scale)
ALTER TABLE public.wheel_balance_tasks 
ADD COLUMN IF NOT EXISTS importance_score integer NOT NULL DEFAULT 5,
ADD COLUMN IF NOT EXISTS urgency_score integer NOT NULL DEFAULT 5;

-- Create index for faster filtering by importance/urgency
CREATE INDEX IF NOT EXISTS idx_eisenhower_tasks_importance_urgency 
ON public.eisenhower_tasks(importance, urgency);

-- Migrate existing boolean important/urgent in wheel_balance_tasks to numeric scores
UPDATE public.wheel_balance_tasks 
SET importance_score = CASE WHEN important = true THEN 8 ELSE 3 END,
    urgency_score = CASE WHEN urgent = true THEN 8 ELSE 3 END
WHERE importance_score = 5 AND urgency_score = 5;

-- Migrate existing eisenhower_tasks based on quadrant
UPDATE public.eisenhower_tasks 
SET importance = CASE 
      WHEN quadrant IN ('urgent-important', 'not-urgent-important') THEN 8 
      ELSE 3 
    END,
    urgency = CASE 
      WHEN quadrant IN ('urgent-important', 'urgent-not-important') THEN 8 
      ELSE 3 
    END
WHERE importance = 5 AND urgency = 5;