-- Products 2 / sales manager attribution: payment analytics and reporting.
-- Historical assignments are intentionally not modified by this migration.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.sales_manager_report_v1(
  p_from date,
  p_to date,
  p_responsible_user_id uuid DEFAULT NULL,
  p_unassigned_only boolean DEFAULT false,
  p_product_id uuid DEFAULT NULL,
  p_tariff_id uuid DEFAULT NULL
)
RETURNS TABLE (
  month_start date,
  responsible_user_id uuid,
  responsible_name text,
  product_id uuid,
  product_name text,
  tariff_id uuid,
  tariff_name text,
  currency text,
  paid_deals bigint,
  payment_count bigint,
  gross_amount numeric,
  refund_amount numeric,
  net_amount numeric,
  average_payment numeric,
  installment_received numeric,
  installment_expected numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_can_view_all boolean;
  v_can_view_own boolean;
  v_effective_responsible_user_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'invalid_report_period' USING ERRCODE = '22023';
  END IF;
  IF p_to - p_from > 366 THEN
    RAISE EXCEPTION 'report_period_too_large' USING ERRCODE = '22023';
  END IF;
  IF p_unassigned_only AND p_responsible_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'conflicting_manager_filters' USING ERRCODE = '22023';
  END IF;

  v_can_view_all := public.has_permission(v_actor, 'sales_reports.view_all');
  v_can_view_own := public.has_permission(v_actor, 'sales_reports.view_own');

  IF NOT v_can_view_all AND NOT v_can_view_own THEN
    RAISE EXCEPTION 'forbidden_sales_report' USING ERRCODE = '42501';
  END IF;

  IF NOT v_can_view_all THEN
    IF p_unassigned_only
       OR (p_responsible_user_id IS NOT NULL AND p_responsible_user_id <> v_actor) THEN
      RAISE EXCEPTION 'forbidden_sales_report_scope' USING ERRCODE = '42501';
    END IF;
    v_effective_responsible_user_id := v_actor;
  ELSE
    v_effective_responsible_user_id := p_responsible_user_id;
  END IF;

  RETURN QUERY
  WITH payment_facts AS (
    SELECT
      date_trunc('month', payment.paid_at AT TIME ZONE 'Europe/Minsk')::date AS metric_month,
      attribution.responsible_user_id AS metric_responsible_user_id,
      coalesce(
        manager_profile.full_name,
        attribution.responsible_name_snapshot,
        'Без менеджера'
      ) AS metric_responsible_name,
      deal.product_id AS metric_product_id,
      coalesce(product.name, deal.purchase_snapshot->>'product_name', 'Без продукта') AS metric_product_name,
      deal.tariff_id AS metric_tariff_id,
      coalesce(tariff.name, deal.purchase_snapshot->>'tariff_name', 'Без тарифа') AS metric_tariff_name,
      upper(coalesce(nullif(payment.currency, ''), 'BYN')) AS metric_currency,
      payment.order_id,
      payment.amount,
      payment.installment_number,
      (
        lower(coalesce(payment.transaction_type, '')) LIKE '%refund%'
        OR lower(coalesce(payment.transaction_type, '')) LIKE '%возврат%'
        OR payment.amount < 0
      ) AS is_refund,
      CASE
        WHEN (
          lower(coalesce(payment.transaction_type, '')) LIKE '%refund%'
          OR lower(coalesce(payment.transaction_type, '')) LIKE '%возврат%'
          OR payment.amount < 0
        ) THEN abs(payment.amount)
        WHEN coalesce(payment.refunded_amount, 0) > 0
          AND NOT EXISTS (
            SELECT 1
            FROM public.payments_v2 refund
            WHERE refund.reference_payment_id = payment.id
              AND refund.is_deleted = false
              AND refund.deleted_at IS NULL
              AND refund.status::text IN ('succeeded', 'refunded')
              AND (
                lower(coalesce(refund.transaction_type, '')) LIKE '%refund%'
                OR lower(coalesce(refund.transaction_type, '')) LIKE '%возврат%'
                OR refund.amount < 0
              )
          )
          THEN payment.refunded_amount
        ELSE 0
      END AS effective_refund_amount,
      EXISTS (
        SELECT 1
        FROM public.installment_payments installment
        WHERE installment.payment_id = payment.id
      ) AS is_installment_payment
    FROM public.payments_v2 payment
    JOIN public.orders_v2 deal ON deal.id = payment.order_id
    LEFT JOIN LATERAL (
      SELECT current_attribution.*
      FROM public.payment_sales_attribution current_attribution
      WHERE current_attribution.payment_id = payment.id
        AND current_attribution.effective_to IS NULL
      ORDER BY current_attribution.effective_from DESC
      LIMIT 1
    ) attribution ON true
    LEFT JOIN LATERAL (
      SELECT profile.full_name
      FROM public.profiles profile
      WHERE profile.user_id = attribution.responsible_user_id
      ORDER BY profile.updated_at DESC
      LIMIT 1
    ) manager_profile ON true
    LEFT JOIN public.products_v2 product ON product.id = deal.product_id
    LEFT JOIN public.tariffs tariff ON tariff.id = deal.tariff_id
    WHERE payment.is_deleted = false
      AND payment.deleted_at IS NULL
      AND deal.is_deleted = false
      AND deal.deleted_at IS NULL
      AND payment.paid_at >= (p_from::timestamp AT TIME ZONE 'Europe/Minsk')
      AND payment.paid_at < ((p_to + 1)::timestamp AT TIME ZONE 'Europe/Minsk')
      AND payment.status::text IN ('succeeded', 'refunded')
      AND (p_product_id IS NULL OR deal.product_id = p_product_id)
      AND (p_tariff_id IS NULL OR deal.tariff_id = p_tariff_id)
      AND (
        (p_unassigned_only AND attribution.responsible_user_id IS NULL)
        OR (
          NOT p_unassigned_only
          AND (
            v_effective_responsible_user_id IS NULL
            OR attribution.responsible_user_id = v_effective_responsible_user_id
          )
        )
      )
  ),
  payment_metrics AS (
    SELECT
      fact.metric_month,
      fact.metric_responsible_user_id,
      fact.metric_responsible_name,
      fact.metric_product_id,
      fact.metric_product_name,
      fact.metric_tariff_id,
      fact.metric_tariff_name,
      fact.metric_currency,
      count(DISTINCT fact.order_id) FILTER (WHERE NOT fact.is_refund AND fact.amount > 0) AS paid_deals,
      count(*) FILTER (WHERE NOT fact.is_refund AND fact.amount > 0) AS payment_count,
      coalesce(sum(fact.amount) FILTER (WHERE NOT fact.is_refund AND fact.amount > 0), 0) AS gross_amount,
      coalesce(sum(fact.effective_refund_amount), 0) AS refund_amount,
      coalesce(sum(fact.amount) FILTER (
        WHERE NOT fact.is_refund
          AND fact.amount > 0
          AND (fact.installment_number IS NOT NULL OR fact.is_installment_payment)
      ), 0) AS installment_received
    FROM payment_facts fact
    GROUP BY
      fact.metric_month,
      fact.metric_responsible_user_id,
      fact.metric_responsible_name,
      fact.metric_product_id,
      fact.metric_product_name,
      fact.metric_tariff_id,
      fact.metric_tariff_name,
      fact.metric_currency
  ),
  expected_metrics AS (
    SELECT
      date_trunc('month', installment.due_date AT TIME ZONE 'Europe/Minsk')::date AS metric_month,
      deal.responsible_user_id AS metric_responsible_user_id,
      coalesce(manager_profile.full_name, 'Без менеджера') AS metric_responsible_name,
      deal.product_id AS metric_product_id,
      coalesce(product.name, deal.purchase_snapshot->>'product_name', 'Без продукта') AS metric_product_name,
      deal.tariff_id AS metric_tariff_id,
      coalesce(tariff.name, deal.purchase_snapshot->>'tariff_name', 'Без тарифа') AS metric_tariff_name,
      upper(coalesce(nullif(installment.currency, ''), 'BYN')) AS metric_currency,
      coalesce(sum(installment.amount), 0) AS installment_expected
    FROM public.installment_payments installment
    JOIN public.orders_v2 deal ON deal.id = installment.order_id
    LEFT JOIN LATERAL (
      SELECT profile.full_name
      FROM public.profiles profile
      WHERE profile.user_id = deal.responsible_user_id
      ORDER BY profile.updated_at DESC
      LIMIT 1
    ) manager_profile ON true
    LEFT JOIN public.products_v2 product ON product.id = deal.product_id
    LEFT JOIN public.tariffs tariff ON tariff.id = deal.tariff_id
    WHERE deal.is_deleted = false
      AND deal.deleted_at IS NULL
      AND installment.due_date >= (p_from::timestamp AT TIME ZONE 'Europe/Minsk')
      AND installment.due_date < ((p_to + 1)::timestamp AT TIME ZONE 'Europe/Minsk')
      AND installment.status IN ('pending', 'processing', 'failed')
      AND (p_product_id IS NULL OR deal.product_id = p_product_id)
      AND (p_tariff_id IS NULL OR deal.tariff_id = p_tariff_id)
      AND (
        (p_unassigned_only AND deal.responsible_user_id IS NULL)
        OR (
          NOT p_unassigned_only
          AND (
            v_effective_responsible_user_id IS NULL
            OR deal.responsible_user_id = v_effective_responsible_user_id
          )
        )
      )
    GROUP BY
      metric_month,
      deal.responsible_user_id,
      metric_responsible_name,
      deal.product_id,
      metric_product_name,
      deal.tariff_id,
      metric_tariff_name,
      metric_currency
  ),
  combined AS (
    SELECT
      metric_month,
      metric_responsible_user_id,
      metric_responsible_name,
      metric_product_id,
      metric_product_name,
      metric_tariff_id,
      metric_tariff_name,
      metric_currency,
      paid_deals,
      payment_count,
      gross_amount,
      refund_amount,
      installment_received,
      0::numeric AS installment_expected
    FROM payment_metrics

    UNION ALL

    SELECT
      metric_month,
      metric_responsible_user_id,
      metric_responsible_name,
      metric_product_id,
      metric_product_name,
      metric_tariff_id,
      metric_tariff_name,
      metric_currency,
      0::bigint,
      0::bigint,
      0::numeric,
      0::numeric,
      0::numeric,
      installment_expected
    FROM expected_metrics
  )
  SELECT
    combined.metric_month,
    combined.metric_responsible_user_id,
    combined.metric_responsible_name,
    combined.metric_product_id,
    combined.metric_product_name,
    combined.metric_tariff_id,
    combined.metric_tariff_name,
    combined.metric_currency,
    sum(combined.paid_deals)::bigint,
    sum(combined.payment_count)::bigint,
    sum(combined.gross_amount),
    sum(combined.refund_amount),
    sum(combined.gross_amount) - sum(combined.refund_amount),
    CASE
      WHEN sum(combined.payment_count) > 0
        THEN round(sum(combined.gross_amount) / sum(combined.payment_count), 2)
      ELSE 0
    END,
    sum(combined.installment_received),
    sum(combined.installment_expected)
  FROM combined
  GROUP BY
    combined.metric_month,
    combined.metric_responsible_user_id,
    combined.metric_responsible_name,
    combined.metric_product_id,
    combined.metric_product_name,
    combined.metric_tariff_id,
    combined.metric_tariff_name,
    combined.metric_currency
  ORDER BY
    combined.metric_month,
    combined.metric_responsible_name,
    combined.metric_product_name,
    combined.metric_tariff_name,
    combined.metric_currency;
END;
$$;

REVOKE ALL ON FUNCTION public.sales_manager_report_v1(
  date, date, uuid, boolean, uuid, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_manager_report_v1(
  date, date, uuid, boolean, uuid, uuid
) TO authenticated;

COMMENT ON FUNCTION public.sales_manager_report_v1(date, date, uuid, boolean, uuid, uuid) IS
  'Server-side sales report by paid_at/due_date, manager, product, tariff and currency with explicit own/all permission checks.';