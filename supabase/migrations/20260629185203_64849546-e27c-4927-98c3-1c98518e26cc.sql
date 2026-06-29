
CREATE OR REPLACE FUNCTION public.crm_task_stats_by_assignee()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _items jsonb;
  _totals jsonb;
BEGIN
  PERFORM public._crm_tasks_assert_staff();

  WITH base AS (
    SELECT t.*
    FROM public.crm_tasks t
  ),
  per_user AS (
    SELECT
      assignee_user_id,
      count(*) FILTER (WHERE status IN ('open','in_progress'))                                    AS open_total,
      count(*) FILTER (WHERE status = 'in_progress')                                              AS in_progress_cnt,
      count(*) FILTER (WHERE status IN ('open','in_progress') AND due_at IS NOT NULL AND due_at < now()) AS overdue_cnt,
      count(*) FILTER (
        WHERE status IN ('open','in_progress')
          AND due_at >= date_trunc('day', now() AT TIME ZONE 'Europe/Minsk') AT TIME ZONE 'Europe/Minsk'
          AND due_at <  (date_trunc('day', now() AT TIME ZONE 'Europe/Minsk') + interval '1 day') AT TIME ZONE 'Europe/Minsk'
      )                                                                                            AS due_today_cnt,
      count(*) FILTER (WHERE created_at >= now() - interval '7 days')                              AS created_7d,
      count(*) FILTER (WHERE created_at >= now() - interval '30 days')                             AS created_30d,
      count(*) FILTER (WHERE status='done'     AND closed_at >= now() - interval '7 days')         AS done_7d,
      count(*) FILTER (WHERE status='done'     AND closed_at >= now() - interval '30 days')        AS done_30d,
      count(*) FILTER (WHERE status='canceled' AND closed_at >= now() - interval '7 days')         AS canceled_7d,
      count(*) FILTER (WHERE status='canceled' AND closed_at >= now() - interval '30 days')        AS canceled_30d,
      avg(EXTRACT(EPOCH FROM (closed_at - created_at)) / 3600.0)
        FILTER (WHERE status='done' AND closed_at >= now() - interval '30 days')                   AS avg_close_hours_30d
    FROM base
    GROUP BY assignee_user_id
  )
  SELECT
    jsonb_agg(
      jsonb_build_object(
        'assignee_user_id',  pu.assignee_user_id,
        'full_name',         COALESCE(p.full_name, p.first_name, p.email, 'Не назначен'),
        'avatar_url',        p.avatar_url,
        'has_telegram',      p.telegram_user_id IS NOT NULL,
        'open_total',        pu.open_total,
        'in_progress',       pu.in_progress_cnt,
        'overdue',           pu.overdue_cnt,
        'due_today',         pu.due_today_cnt,
        'created_7d',        pu.created_7d,
        'created_30d',       pu.created_30d,
        'done_7d',           pu.done_7d,
        'done_30d',          pu.done_30d,
        'canceled_7d',       pu.canceled_7d,
        'canceled_30d',      pu.canceled_30d,
        'avg_close_hours_30d', round(pu.avg_close_hours_30d::numeric, 1)
      )
      ORDER BY (pu.assignee_user_id IS NULL), pu.open_total DESC, COALESCE(p.full_name, p.email)
    )
  INTO _items
  FROM per_user pu
  LEFT JOIN public.profiles p ON p.user_id = pu.assignee_user_id;

  SELECT jsonb_build_object(
    'total_open',       count(*) FILTER (WHERE status IN ('open','in_progress')),
    'total_overdue',    count(*) FILTER (WHERE status IN ('open','in_progress') AND due_at IS NOT NULL AND due_at < now()),
    'total_done_7d',    count(*) FILTER (WHERE status='done'     AND closed_at >= now() - interval '7 days'),
    'total_done_30d',   count(*) FILTER (WHERE status='done'     AND closed_at >= now() - interval '30 days'),
    'total_canceled_30d', count(*) FILTER (WHERE status='canceled' AND closed_at >= now() - interval '30 days'),
    'total_created_30d', count(*) FILTER (WHERE created_at >= now() - interval '30 days')
  ) INTO _totals
  FROM public.crm_tasks;

  RETURN jsonb_build_object(
    'items',  COALESCE(_items, '[]'::jsonb),
    'totals', _totals,
    'generated_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.crm_task_stats_by_assignee() TO authenticated;
REVOKE ALL ON FUNCTION public.crm_task_stats_by_assignee() FROM anon, PUBLIC;
