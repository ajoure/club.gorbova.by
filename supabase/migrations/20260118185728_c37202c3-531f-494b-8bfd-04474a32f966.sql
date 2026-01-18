-- Add additional columns for better document cataloging
ALTER TABLE ilex_documents 
ADD COLUMN IF NOT EXISTS source_url text,
ADD COLUMN IF NOT EXISTS search_query text,
ADD COLUMN IF NOT EXISTS extracted_articles jsonb DEFAULT '[]';

-- Add comments
COMMENT ON COLUMN ilex_documents.source_url IS 'Original URL where document was found';
COMMENT ON COLUMN ilex_documents.search_query IS 'Search query that led to finding this document';
COMMENT ON COLUMN ilex_documents.extracted_articles IS 'Extracted article texts from the document';