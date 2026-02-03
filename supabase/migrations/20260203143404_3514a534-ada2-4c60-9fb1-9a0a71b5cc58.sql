-- Create storage bucket for owner reference photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'owner-photos', 
  'owner-photos', 
  true,
  5242880, -- 5MB
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- RLS: Only admins can upload/delete
CREATE POLICY "Admin upload owner photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'owner-photos' 
  AND (
    public.has_role(auth.uid(), 'admin') 
    OR public.has_role(auth.uid(), 'superadmin')
  )
);

CREATE POLICY "Admin update owner photos"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'owner-photos' 
  AND (
    public.has_role(auth.uid(), 'admin') 
    OR public.has_role(auth.uid(), 'superadmin')
  )
);

CREATE POLICY "Admin delete owner photos"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'owner-photos' 
  AND (
    public.has_role(auth.uid(), 'admin') 
    OR public.has_role(auth.uid(), 'superadmin')
  )
);

-- Public can view (for AI generation)
CREATE POLICY "Public view owner photos"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'owner-photos');