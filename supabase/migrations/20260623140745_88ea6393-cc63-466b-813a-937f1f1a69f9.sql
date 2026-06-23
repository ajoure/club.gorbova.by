-- Patch site_pages HTML via base64 staging table
CREATE TABLE IF NOT EXISTS public._html_staging_site018_hero(idx INT PRIMARY KEY, b64 TEXT NOT NULL);
TRUNCATE public._html_staging_site018_hero;
-- chunks inserted by follow-up migrations
