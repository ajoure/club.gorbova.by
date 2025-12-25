-- Create sphere_goals table for strategic goals within Balance Wheel spheres
CREATE TABLE public.sphere_goals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  sphere_key TEXT NOT NULL,
  content TEXT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.sphere_goals ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for sphere_goals
CREATE POLICY "Users can view their own sphere goals" 
ON public.sphere_goals 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own sphere goals" 
ON public.sphere_goals 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sphere goals" 
ON public.sphere_goals 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own sphere goals" 
ON public.sphere_goals 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_sphere_goals_updated_at
BEFORE UPDATE ON public.sphere_goals
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();