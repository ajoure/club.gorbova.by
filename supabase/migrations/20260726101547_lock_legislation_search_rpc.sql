-- Supabase may grant function execution through schema default privileges.
-- Keep legislation full-text search available to signed-in members only.
REVOKE ALL ON FUNCTION public.search_legal_documents(text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_legal_documents(text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_legal_documents(text, integer)
  TO authenticated;
