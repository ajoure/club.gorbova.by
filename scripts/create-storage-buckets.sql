-- ============================================
-- STORAGE BUCKETS SETUP
-- Run this in the new Supabase project
-- ============================================

-- Create buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('documents', 'documents', false, 52428800, ARRAY['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  ('documents-templates', 'documents-templates', false, 52428800, ARRAY['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  ('signatures', 'signatures', true, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp']),
  ('avatars', 'avatars', true, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  ('training-content', 'training-content', true, 104857600, ARRAY['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'application/pdf']),
  ('tariff-media', 'tariff-media', false, 52428800, ARRAY['image/png', 'image/jpeg', 'image/webp']),
  ('ticket-attachments', 'ticket-attachments', false, 20971520, ARRAY['image/png', 'image/jpeg', 'application/pdf', 'text/plain'])
ON CONFLICT (id) DO NOTHING;

-- Storage policies for documents bucket
CREATE POLICY "Authenticated users can upload documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'documents');

CREATE POLICY "Users can view their documents"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'documents');

-- Storage policies for avatars bucket (public)
CREATE POLICY "Anyone can view avatars"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'avatars');

CREATE POLICY "Authenticated users can upload avatars"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'avatars');

-- Storage policies for signatures bucket (public)
CREATE POLICY "Anyone can view signatures"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'signatures');

CREATE POLICY "Authenticated users can upload signatures"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'signatures');

-- Storage policies for training-content (public)
CREATE POLICY "Anyone can view training content"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'training-content');

CREATE POLICY "Authenticated users can upload training content"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'training-content');

-- Storage policies for ticket-attachments
CREATE POLICY "Authenticated users can upload ticket attachments"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'ticket-attachments');

CREATE POLICY "Authenticated users can view ticket attachments"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'ticket-attachments');
