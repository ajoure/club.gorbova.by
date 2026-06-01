-- Backfill ai_generated_documents.generation_batch_id from meta where missing
UPDATE public.ai_generated_documents d
SET generation_batch_id = (d.meta->>'generation_batch_id')::uuid
WHERE d.generation_batch_id IS NULL
  AND d.meta ? 'generation_batch_id'
  AND (d.meta->>'generation_batch_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND EXISTS (
    SELECT 1 FROM public.ai_document_generation_batches b
    WHERE b.id = (d.meta->>'generation_batch_id')::uuid
  );