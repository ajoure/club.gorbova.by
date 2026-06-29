
-- crm_deal_task_summary_v: per-deal aggregation for kanban badges
CREATE OR REPLACE VIEW public.crm_deal_task_summary_v
WITH (security_invoker = true)
AS
WITH open_tasks AS (
  SELECT
    t.deal_id,
    t.id,
    t.task_type_id,
    t.due_at,
    t.status,
    ROW_NUMBER() OVER (
      PARTITION BY t.deal_id
      ORDER BY (t.due_at IS NULL), t.due_at ASC, t.created_at ASC
    ) AS rn
  FROM public.crm_tasks t
  WHERE t.deal_id IS NOT NULL
    AND t.status IN ('open', 'in_progress')
)
SELECT
  ot.deal_id,
  COUNT(*)::int AS open_count,
  SUM(CASE WHEN ot.due_at IS NOT NULL AND ot.due_at < now() THEN 1 ELSE 0 END)::int AS overdue_count,
  MIN(CASE WHEN ot.rn = 1 THEN ot.due_at END) AS next_due_at,
  MAX(CASE WHEN ot.rn = 1 THEN tt.key END) AS next_task_type_key,
  MAX(CASE WHEN ot.rn = 1 THEN tt.label END) AS next_task_type_label,
  MAX(CASE WHEN ot.rn = 1 THEN tt.icon END) AS next_task_type_icon,
  MAX(CASE WHEN ot.rn = 1 THEN tt.color END) AS next_task_type_color
FROM open_tasks ot
LEFT JOIN public.crm_task_types tt ON tt.id = ot.task_type_id
GROUP BY ot.deal_id;

GRANT SELECT ON public.crm_deal_task_summary_v TO authenticated;
GRANT SELECT ON public.crm_deal_task_summary_v TO service_role;
