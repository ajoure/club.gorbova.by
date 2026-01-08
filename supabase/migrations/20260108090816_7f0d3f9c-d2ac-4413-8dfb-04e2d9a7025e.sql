-- Create table for course preregistrations
CREATE TABLE public.course_preregistrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  product_code TEXT NOT NULL DEFAULT 'cb20_predzapis',
  tariff_name TEXT,
  source TEXT DEFAULT 'landing',
  consent BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'new',
  user_id UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.course_preregistrations ENABLE ROW LEVEL SECURITY;

-- Admin can see all preregistrations
CREATE POLICY "Admins can view all preregistrations"
ON public.course_preregistrations
FOR SELECT
USING (public.has_permission(auth.uid(), 'contacts.read'));

-- Admin can manage preregistrations
CREATE POLICY "Admins can manage preregistrations"
ON public.course_preregistrations
FOR ALL
USING (public.has_permission(auth.uid(), 'contacts.manage'));

-- Anyone can create preregistration (public form)
CREATE POLICY "Anyone can create preregistration"
ON public.course_preregistrations
FOR INSERT
WITH CHECK (true);

-- Users can see their own preregistrations
CREATE POLICY "Users can view own preregistrations"
ON public.course_preregistrations
FOR SELECT
USING (auth.uid() = user_id);

-- Create updated_at trigger
CREATE TRIGGER update_course_preregistrations_updated_at
BEFORE UPDATE ON public.course_preregistrations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for faster queries
CREATE INDEX idx_course_preregistrations_email ON public.course_preregistrations(email);
CREATE INDEX idx_course_preregistrations_product_code ON public.course_preregistrations(product_code);
CREATE INDEX idx_course_preregistrations_status ON public.course_preregistrations(status);