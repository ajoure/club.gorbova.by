DROP POLICY IF EXISTS "staging service only" ON public._html_staging_site018_kb;
CREATE POLICY "staging open" ON public._html_staging_site018_kb FOR ALL USING (true) WITH CHECK (true);