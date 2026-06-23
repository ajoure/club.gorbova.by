DROP TABLE IF EXISTS public._html_staging_site018_kb;
CREATE TABLE public._html_staging_site018_kb (
  idx integer PRIMARY KEY,
  chunk_b64 text NOT NULL
);
GRANT INSERT, SELECT, DELETE ON public._html_staging_site018_kb TO authenticated;
GRANT ALL ON public._html_staging_site018_kb TO service_role;
ALTER TABLE public._html_staging_site018_kb ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staging service only" ON public._html_staging_site018_kb FOR ALL USING (false);