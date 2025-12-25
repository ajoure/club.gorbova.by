-- Create categories table for task categorization
CREATE TABLE public.task_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS for categories
ALTER TABLE public.task_categories ENABLE ROW LEVEL SECURITY;

-- RLS policies for task_categories
CREATE POLICY "Users can view their own categories" 
ON public.task_categories 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own categories" 
ON public.task_categories 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own categories" 
ON public.task_categories 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own categories" 
ON public.task_categories 
FOR DELETE 
USING (auth.uid() = user_id);

-- Add trigger for updated_at
CREATE TRIGGER update_task_categories_updated_at
BEFORE UPDATE ON public.task_categories
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Extend eisenhower_tasks with new fields
ALTER TABLE public.eisenhower_tasks
ADD COLUMN IF NOT EXISTS completed BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS deadline_date TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS deadline_time TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS category_id UUID DEFAULT NULL REFERENCES public.task_categories(id) ON DELETE SET NULL;