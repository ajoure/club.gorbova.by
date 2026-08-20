UPDATE public.site_pages
SET title = 'CB', updated_at = now()
WHERE public_id = 'SITE-000021' AND slug = 'cb' AND title <> 'CB';