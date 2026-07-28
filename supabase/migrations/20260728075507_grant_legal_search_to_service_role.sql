-- The Telegram Edge Function uses the server service role after it has
-- verified that the sender owns a linked club account. Explicit execution
-- access keeps this server-only call independent from role inheritance.
GRANT EXECUTE ON FUNCTION public.search_legal_documents(text, integer)
  TO service_role;
