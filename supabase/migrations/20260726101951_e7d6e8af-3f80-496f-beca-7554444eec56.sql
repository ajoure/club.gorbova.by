REVOKE ALL ON FUNCTION public.search_legal_documents(text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_legal_documents(text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_legal_documents(text, integer) TO authenticated;