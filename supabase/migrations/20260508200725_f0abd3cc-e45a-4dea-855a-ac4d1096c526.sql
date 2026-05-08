ALTER TABLE document_template_versions
  ADD COLUMN IF NOT EXISTS markup_draft jsonb;

COMMENT ON COLUMN document_template_versions.markup_draft IS
  'Sprint 11 C5-D: autosave draft of UI markup state (replacements, statuses, FLD picks, format, case_modifier, occurrence_index, last_saved_at). Cleared after successful apply-markup.';