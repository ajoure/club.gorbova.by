-- Drop the existing constraint and add a new one that includes 'planned' for inbox tasks
ALTER TABLE public.eisenhower_tasks DROP CONSTRAINT IF EXISTS eisenhower_tasks_quadrant_check;

ALTER TABLE public.eisenhower_tasks ADD CONSTRAINT eisenhower_tasks_quadrant_check 
CHECK (quadrant = ANY (ARRAY['urgent-important'::text, 'not-urgent-important'::text, 'urgent-not-important'::text, 'not-urgent-not-important'::text, 'planned'::text]));

-- Update existing "inbox" tasks to "planned"
UPDATE public.eisenhower_tasks SET quadrant = 'planned' WHERE quadrant = 'inbox';