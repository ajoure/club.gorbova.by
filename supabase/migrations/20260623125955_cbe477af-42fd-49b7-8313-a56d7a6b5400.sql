CREATE TABLE IF NOT EXISTS public._html_staging_site018 (ord int PRIMARY KEY, chunk text NOT NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON public._html_staging_site018 TO service_role;
ALTER TABLE public._html_staging_site018 ENABLE ROW LEVEL SECURITY;