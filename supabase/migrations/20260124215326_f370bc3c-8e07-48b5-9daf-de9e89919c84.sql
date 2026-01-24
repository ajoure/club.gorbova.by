-- Create storage bucket for training assets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'training-assets',
  'training-assets',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload training assets
CREATE POLICY "Authenticated users can upload training assets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'training-assets');

-- Allow public read access
CREATE POLICY "Public can view training assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'training-assets');

-- Allow authenticated users to update their uploads
CREATE POLICY "Authenticated users can update training assets"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'training-assets');

-- Allow authenticated users to delete training assets
CREATE POLICY "Authenticated users can delete training assets"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'training-assets');