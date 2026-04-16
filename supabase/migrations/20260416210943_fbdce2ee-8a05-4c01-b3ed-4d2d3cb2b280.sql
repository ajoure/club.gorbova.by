
-- Site Builder Sprint Phase 2: служебный module для site-questionnaires
-- Гейт: проверяем что module ещё не существует (idempotent)

DO $$
DECLARE
  v_module_id uuid;
BEGIN
  SELECT id INTO v_module_id FROM public.training_modules WHERE slug = '__site_questionnaires__' LIMIT 1;
  IF v_module_id IS NULL THEN
    INSERT INTO public.training_modules (
      slug, title, description, is_active, sort_order, display_layout
    ) VALUES (
      '__site_questionnaires__',
      'Site Questionnaires (системный)',
      'Служебный модуль для анкет, размещаемых в конструкторе сайтов. Не отображается в обучении.',
      false,  -- не активен в обычном UI
      9999,
      'list'
    );
  END IF;
END $$;

-- Add metadata column to lesson_blocks if missing (for source markers).
-- Schema check показал, что у lesson_blocks уже есть settings (jsonb), используем его.
-- Маркер: settings.source = 'site' и settings.site_block_id = <UUID>

-- Add embed_origin/embed_block_id support to site_form_submissions metadata (no schema change — JSONB).
-- (metadata column уже jsonb, ничего не меняем)

-- Comment to make purpose explicit
COMMENT ON COLUMN public.training_modules.slug IS 'URL slug. Спецзначение __site_questionnaires__ — служебный module для анкет конструктора сайтов.';
