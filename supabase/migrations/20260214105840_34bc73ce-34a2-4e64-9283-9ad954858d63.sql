
-- Phase 2: Migrate 27 RLS policies from legacy EXISTS user_roles to has_role_v2()

/* ai_bot_settings (ALL) */
DROP POLICY IF EXISTS "Admins can manage ai_bot_settings" ON public.ai_bot_settings;
CREATE POLICY "Admins can manage ai_bot_settings"
ON public.ai_bot_settings AS PERMISSIVE FOR ALL TO authenticated
USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

/* audience_insights (ALL) */
DROP POLICY IF EXISTS "Admins can manage audience insights" ON public.audience_insights;
CREATE POLICY "Admins can manage audience insights"
ON public.audience_insights AS PERMISSIVE FOR ALL TO authenticated
USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

/* bepaid_product_mappings (S/I/U/D) */
DROP POLICY IF EXISTS "Admins can view bepaid mappings" ON public.bepaid_product_mappings;
DROP POLICY IF EXISTS "Admins can insert bepaid mappings" ON public.bepaid_product_mappings;
DROP POLICY IF EXISTS "Admins can update bepaid mappings" ON public.bepaid_product_mappings;
DROP POLICY IF EXISTS "Admins can delete bepaid mappings" ON public.bepaid_product_mappings;

CREATE POLICY "Admins can view bepaid mappings"
ON public.bepaid_product_mappings AS PERMISSIVE FOR SELECT TO authenticated
USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY "Admins can insert bepaid mappings"
ON public.bepaid_product_mappings AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY "Admins can update bepaid mappings"
ON public.bepaid_product_mappings AS PERMISSIVE FOR UPDATE TO authenticated
USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY "Admins can delete bepaid mappings"
ON public.bepaid_product_mappings AS PERMISSIVE FOR DELETE TO authenticated
USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

/* card_profile_links (ALL) */
DROP POLICY IF EXISTS "Admins can manage card links" ON public.card_profile_links;
CREATE POLICY "Admins can manage card links"
ON public.card_profile_links AS PERMISSIVE FOR ALL TO authenticated
USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

/* channel_posts_archive (ALL) */
DROP POLICY IF EXISTS "Admins can manage channel posts archive" ON public.channel_posts_archive;
CREATE POLICY "Admins can manage channel posts archive"
ON public.channel_posts_archive AS PERMISSIVE FOR ALL TO authenticated
USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

/* document_generation_rules (ALL) */
DROP POLICY IF EXISTS "Admins can manage document rules" ON public.document_generation_rules;
CREATE POLICY "Admins can manage document rules"
ON public.document_generation_rules AS PERMISSIVE FOR ALL TO authenticated
USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

/* document_number_sequences (ALL) */
DROP POLICY IF EXISTS "Admins can manage document sequences" ON public.document_number_sequences;
CREATE POLICY "Admins can manage document sequences"
ON public.document_number_sequences AS PERMISSIVE FOR ALL TO authenticated
USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

/* lesson_progress_state (SELECT) */
DROP POLICY IF EXISTS "Admins can read all progress state" ON public.lesson_progress_state;
CREATE POLICY "Admins can read all progress state"
ON public.lesson_progress_state AS PERMISSIVE FOR SELECT TO authenticated
USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

/* marketing_insights (ALL) */
DROP POLICY IF EXISTS "Admins can manage marketing insights" ON public.marketing_insights;
CREATE POLICY "Admins can manage marketing insights"
ON public.marketing_insights AS PERMISSIVE FOR ALL TO authenticated
USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

/* module_access (ALL) */
DROP POLICY IF EXISTS "Admins can manage module access (role)" ON public.module_access;
CREATE POLICY "Admins can manage module access (role)"
ON public.module_access AS PERMISSIVE FOR ALL TO authenticated
USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

/* news_content (S/I/U/D + editor) */
DROP POLICY IF EXISTS "Admins can view all news" ON public.news_content;
DROP POLICY IF EXISTS "Admins can insert news" ON public.news_content;
DROP POLICY IF EXISTS "Admins can update news" ON public.news_content;
DROP POLICY IF EXISTS "Admins can delete news" ON public.news_content;

CREATE POLICY "Admins can view all news"
ON public.news_content AS PERMISSIVE FOR SELECT TO authenticated
USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin') OR public.has_role_v2(auth.uid(), 'editor'));

CREATE POLICY "Admins can insert news"
ON public.news_content AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin') OR public.has_role_v2(auth.uid(), 'editor'));

CREATE POLICY "Admins can update news"
ON public.news_content AS PERMISSIVE FOR UPDATE TO authenticated
USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin') OR public.has_role_v2(auth.uid(), 'editor'))
WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin') OR public.has_role_v2(auth.uid(), 'editor'));

CREATE POLICY "Admins can delete news"
ON public.news_content AS PERMISSIVE FOR DELETE TO authenticated
USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin') OR public.has_role_v2(auth.uid(), 'editor'));

/* news_digest_queue (ALL) */
DROP POLICY IF EXISTS "Admins can manage digest queue" ON public.news_digest_queue;
CREATE POLICY "Admins can manage digest queue"
ON public.news_digest_queue AS PERMISSIVE FOR ALL TO authenticated
USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

/* news_sources (ALL) */
DROP POLICY IF EXISTS "Admins can manage news sources" ON public.news_sources;
CREATE POLICY "Admins can manage news sources"
ON public.news_sources AS PERMISSIVE FOR ALL TO authenticated
USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

/* product_email_mappings (S/I/U/D) */
DROP POLICY IF EXISTS "Admin can view product email mappings" ON public.product_email_mappings;
DROP POLICY IF EXISTS "Admin can insert product email mappings" ON public.product_email_mappings;
DROP POLICY IF EXISTS "Admin can update product email mappings" ON public.product_email_mappings;
DROP POLICY IF EXISTS "Admin can delete product email mappings" ON public.product_email_mappings;

CREATE POLICY "Admin can view product email mappings"
ON public.product_email_mappings AS PERMISSIVE FOR SELECT TO authenticated
USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY "Admin can insert product email mappings"
ON public.product_email_mappings AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY "Admin can update product email mappings"
ON public.product_email_mappings AS PERMISSIVE FOR UPDATE TO authenticated
USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY "Admin can delete product email mappings"
ON public.product_email_mappings AS PERMISSIVE FOR DELETE TO authenticated
USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

/* rejected_card_attempts (ALL) */
DROP POLICY IF EXISTS "Admin full access on rejected_card_attempts" ON public.rejected_card_attempts;
CREATE POLICY "Admin full access on rejected_card_attempts"
ON public.rejected_card_attempts AS PERMISSIVE FOR ALL TO authenticated
USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

/* telegram_publish_channels (ALL) */
DROP POLICY IF EXISTS "Admins can manage telegram channels" ON public.telegram_publish_channels;
CREATE POLICY "Admins can manage telegram channels"
ON public.telegram_publish_channels AS PERMISSIVE FOR ALL TO authenticated
USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

/* user_lesson_progress (SELECT) */
DROP POLICY IF EXISTS "Admins can view all progress" ON public.user_lesson_progress;
CREATE POLICY "Admins can view all progress"
ON public.user_lesson_progress AS PERMISSIVE FOR SELECT TO authenticated
USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

/* user_menu_sections (ALL) */
DROP POLICY IF EXISTS "Admins can manage menu sections" ON public.user_menu_sections;
CREATE POLICY "Admins can manage menu sections"
ON public.user_menu_sections AS PERMISSIVE FOR ALL TO authenticated
USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));
