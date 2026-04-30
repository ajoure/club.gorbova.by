-- Hide phantom outcome markers from subscription-renewal-reminders
-- (subject IS NULL, body NULL, from_email='system') so they stop appearing
-- in the "История переписки" UI as empty "(Без темы)" letters.
UPDATE public.email_logs
SET meta = COALESCE(meta, '{}'::jsonb)
         || jsonb_build_object('ui_hidden', true,
                               'hidden_reason', 'technical_outcome_marker')
WHERE from_email = 'system'
  AND subject IS NULL
  AND body_html IS NULL
  AND body_text IS NULL
  AND meta->>'source' = 'subscription-renewal-reminders'
  AND (meta->>'ui_hidden') IS DISTINCT FROM 'true';