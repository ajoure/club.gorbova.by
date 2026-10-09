-- Read-only prerequisite for customer sales conversations. This migration
-- enables no campaign and sends no messages, notifications or access grants.
CREATE FUNCTION public.site_questionnaire_sales_identity(
  p_page_id uuid, p_block_id uuid, p_user_id uuid, p_telegram_user_id bigint
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT p_page_id IS NOT NULL AND p_block_id IS NOT NULL
    AND p_user_id IS NOT NULL AND p_telegram_user_id > 0
    AND public.site_questionnaire_telegram_link_ready(p_user_id)
    AND EXISTS (
      SELECT 1 FROM public.profiles profile
      JOIN auth.users account ON account.id=profile.user_id
      JOIN public.site_form_submissions submission ON submission.profile_id=profile.id
      JOIN public.site_pages page ON page.id=submission.page_id
      WHERE profile.user_id=p_user_id
        AND profile.status='active' AND NOT coalesce(profile.is_archived,false)
        AND profile.merged_to_profile_id IS NULL
        AND profile.telegram_user_id=p_telegram_user_id
        AND account.email_confirmed_at IS NOT NULL AND account.deleted_at IS NULL
        AND (account.banned_until IS NULL OR account.banned_until<=now())
        AND submission.page_id=p_page_id AND submission.status='processed'
        AND submission.source='site_form_auth'
        AND submission.metadata->>'questionnaire_first'='true'
        AND submission.metadata->>'block_id'=p_block_id::text
        AND submission.metadata->>'user_id'=p_user_id::text
        AND page.status='published'
        AND (SELECT count(*) FROM jsonb_array_elements(page.blocks) block
          WHERE block->>'id'=p_block_id::text AND block->>'type'='form')=1
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(page.blocks) block
          WHERE block->>'id'=p_block_id::text AND block->>'type'='form'
            AND block->'content'->'questionnaire_first'='true'::jsonb
            AND block->'content'->'auth_mode'='true'::jsonb)
    );
$$;
REVOKE ALL ON FUNCTION public.site_questionnaire_sales_identity(uuid,uuid,uuid,bigint)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.site_questionnaire_sales_identity(uuid,uuid,uuid,bigint)
  TO service_role;
