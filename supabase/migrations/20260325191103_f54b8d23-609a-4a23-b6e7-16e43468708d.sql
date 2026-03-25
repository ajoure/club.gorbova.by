
-- Enum для типа промпта
CREATE TYPE prompt_type AS ENUM ('chat','file_analysis','document_review','text_transform');

-- Таблица ai_user_prompts
CREATE TABLE ai_user_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  prompt_text text NOT NULL,
  type prompt_type NOT NULL DEFAULT 'chat',
  category text,
  icon text,
  input_hint text,
  response_format jsonb,
  is_active boolean DEFAULT true,
  is_archived boolean DEFAULT false,
  sort_order int DEFAULT 0 CHECK (sort_order >= 0),
  is_visible_in_chat boolean DEFAULT false,
  launcher_title text,
  launcher_description text,
  launcher_order int DEFAULT 0 CHECK (launcher_order >= 0),
  created_by uuid REFERENCES auth.users(id) DEFAULT auth.uid(),
  updated_by uuid REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE ai_user_prompts ENABLE ROW LEVEL SECURITY;

-- RLS: admin-only, раздельные policies
CREATE POLICY "admin_select" ON ai_user_prompts FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','superadmin']::app_role[]));
CREATE POLICY "admin_insert" ON ai_user_prompts FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','superadmin']::app_role[]));
CREATE POLICY "admin_update" ON ai_user_prompts FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','superadmin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','superadmin']::app_role[]));
CREATE POLICY "admin_delete" ON ai_user_prompts FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','superadmin']::app_role[]));

-- updated_at trigger
CREATE TRIGGER set_ai_user_prompts_updated_at
  BEFORE UPDATE ON ai_user_prompts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- updated_by auto-fill on UPDATE
CREATE OR REPLACE FUNCTION public.set_ai_user_prompts_updated_by()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.updated_by = auth.uid(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_set_updated_by BEFORE UPDATE ON ai_user_prompts
  FOR EACH ROW EXECUTE FUNCTION public.set_ai_user_prompts_updated_by();

-- Validation trigger: launcher_title required when visible; archive forces invisible; normalize whitespace
CREATE OR REPLACE FUNCTION public.validate_ai_user_prompt_launcher()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.launcher_description IS NOT NULL AND trim(NEW.launcher_description) = '' THEN
    NEW.launcher_description := NULL;
  END IF;
  IF NEW.is_archived = true THEN
    NEW.is_visible_in_chat := false;
  END IF;
  IF NEW.is_visible_in_chat = true AND (NEW.launcher_title IS NULL OR trim(NEW.launcher_title) = '') THEN
    RAISE EXCEPTION 'launcher_title required when is_visible_in_chat is true';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_prompt BEFORE INSERT OR UPDATE ON ai_user_prompts
  FOR EACH ROW EXECUTE FUNCTION public.validate_ai_user_prompt_launcher();

-- RPC для launcher (secure, no prompt_text)
CREATE OR REPLACE FUNCTION get_chat_scenarios()
RETURNS TABLE (
  id uuid, launcher_title text, launcher_description text,
  type prompt_type, input_hint text, icon text, launcher_order int
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, launcher_title, launcher_description, type, input_hint, icon, launcher_order
  FROM ai_user_prompts
  WHERE is_active = true AND is_archived = false AND is_visible_in_chat = true
    AND launcher_title IS NOT NULL AND trim(launcher_title) <> ''
  ORDER BY launcher_order NULLS LAST, created_at;
$$;

REVOKE ALL ON FUNCTION get_chat_scenarios() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_chat_scenarios() TO authenticated;
