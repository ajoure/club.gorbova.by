-- A.1. ilex_documents — narrow SELECT to owner only
DROP POLICY IF EXISTS "Authenticated users can read all ilex documents"
  ON public.ilex_documents;

CREATE POLICY "Users can read own ilex documents"
  ON public.ilex_documents
  FOR SELECT
  TO authenticated
  USING (auth.uid() = saved_by);

-- A.2. storage.objects / bucket documents — close unsafe public INSERT
DROP POLICY IF EXISTS "System can upload document files"
  ON storage.objects;