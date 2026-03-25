
CREATE OR REPLACE FUNCTION public.validate_ai_user_prompt_launcher()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
