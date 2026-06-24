-- staging table approach to avoid huge inline string in subsequent migrations
CREATE TABLE IF NOT EXISTS public._html_staging_site018_hero_v2 (
  id int primary key,
  chunk text not null
);
GRANT ALL ON public._html_staging_site018_hero_v2 TO service_role;