-- =====================================================================
-- CRM Routing — SQL Proof Pack (Layer A, offer-driven первичная оплата)
-- =====================================================================
-- Назначение: единый набор запросов для DB/Audit/Coverage proof
-- после ручных тестовых оплат на тестовом оффере с включённым routing.
--
-- Использование:
--   1. Включить crm_routing.enabled=true на тестовом оффере (см. чек-лист)
--   2. Запомнить: <TEST_OFFER_ID>, <TEST_PIPELINE_ID>, <ORDER_ID_*>
--   3. Прогнать 4 сценария вручную (см. crm-routing.checklist.md)
--   4. Подставить ID и выполнить блоки A–G ниже
-- =====================================================================

-- :param test_offer_id   = '<TEST_OFFER_ID>'
-- :param order_guest_ok  = '<ORDER_ID_guest_success>'
-- :param order_guest_no  = '<ORDER_ID_guest_failed>'
-- :param order_pay_ok    = '<ORDER_ID_pay_success>'
-- :param order_pay_no    = '<ORDER_ID_pay_failed>'

-- ---------------------------------------------------------------------
-- A. Конфигурация оффера: routing включён и валиден
-- ---------------------------------------------------------------------
SELECT
  id,
  button_label,
  meta -> 'crm_routing' AS crm_routing,
  updated_at
FROM tariff_offers
WHERE id = '<TEST_OFFER_ID>';

-- Должно: enabled=true, 4 валидных uuid, 3 разные стадии.

-- ---------------------------------------------------------------------
-- B. Семантика стадий выбранной воронки (open / closed_won / closed_lost)
-- ---------------------------------------------------------------------
SELECT
  s.id, s.name, s.stage_type, s.pipeline_id, p.name AS pipeline_name
FROM crm_pipeline_stages s
JOIN crm_pipelines p ON p.id = s.pipeline_id
WHERE s.id IN (
  ((SELECT meta -> 'crm_routing' ->> 'stage_on_pending' FROM tariff_offers WHERE id = '<TEST_OFFER_ID>'))::uuid,
  ((SELECT meta -> 'crm_routing' ->> 'stage_on_success' FROM tariff_offers WHERE id = '<TEST_OFFER_ID>'))::uuid,
  ((SELECT meta -> 'crm_routing' ->> 'stage_on_failed'  FROM tariff_offers WHERE id = '<TEST_OFFER_ID>'))::uuid
);

-- ---------------------------------------------------------------------
-- C. Pending proof — стадии и snapshot выставлены при создании заказа
-- ---------------------------------------------------------------------
SELECT
  id,
  status,
  pipeline_id,
  pipeline_stage_id,
  jsonb_pretty(meta -> 'crm_routing_snapshot') AS snapshot,
  created_at
FROM orders_v2
WHERE id IN (
  '<ORDER_ID_guest_success>',
  '<ORDER_ID_guest_failed>',
  '<ORDER_ID_pay_success>',
  '<ORDER_ID_pay_failed>'
)
ORDER BY created_at;

-- Должно (для всех 4-х сразу после создания):
--   pipeline_stage_id = snapshot.stage_on_pending
--   meta.crm_routing_snapshot содержит pipeline_id, stage_on_*,
--   offer_id, offer_updated_at, pipeline_name, stage_names, offer_title.

-- ---------------------------------------------------------------------
-- D. Terminal proof — success/failed применены из snapshot
-- ---------------------------------------------------------------------
SELECT
  id,
  status,
  pipeline_stage_id,
  meta -> 'crm_routing_snapshot' ->> 'stage_on_success' AS expected_success,
  meta -> 'crm_routing_snapshot' ->> 'stage_on_failed'  AS expected_failed,
  CASE
    WHEN status = 'paid'
      AND pipeline_stage_id::text = meta -> 'crm_routing_snapshot' ->> 'stage_on_success' THEN 'OK_SUCCESS'
    WHEN status IN ('failed','canceled')
      AND pipeline_stage_id::text = meta -> 'crm_routing_snapshot' ->> 'stage_on_failed'  THEN 'OK_FAILED'
    ELSE 'MISMATCH'
  END AS verdict,
  updated_at
FROM orders_v2
WHERE id IN (
  '<ORDER_ID_guest_success>',
  '<ORDER_ID_guest_failed>',
  '<ORDER_ID_pay_success>',
  '<ORDER_ID_pay_failed>'
);

-- Должно: verdict = OK_SUCCESS или OK_FAILED для всех 4-х.

-- ---------------------------------------------------------------------
-- E. Audit proof — pending / success / failed / skipped
-- ---------------------------------------------------------------------
SELECT
  created_at,
  action,
  meta ->> 'order_id'         AS order_id,
  meta ->> 'trigger'          AS trigger,
  meta ->> 'pipeline_name'    AS pipeline_name,
  meta ->> 'to_stage_name'    AS to_stage,
  meta ->> 'reason'           AS reason
FROM audit_logs
WHERE action IN (
  'crm_stage_applied_pending',
  'crm_stage_applied_success',
  'crm_stage_applied_failed',
  'crm_stage_apply_skipped_manual_override',
  'crm_stage_apply_skipped_invalid_config'
)
  AND meta ->> 'order_id' IN (
    '<ORDER_ID_guest_success>',
    '<ORDER_ID_guest_failed>',
    '<ORDER_ID_pay_success>',
    '<ORDER_ID_pay_failed>'
  )
ORDER BY created_at DESC;

-- Должно: по каждому из 4-х заказов есть pending + соответствующий terminal.

-- ---------------------------------------------------------------------
-- F. Snapshot immutability proof
-- ---------------------------------------------------------------------
-- Шаги (вне SQL):
--   1. Создать заказ при старом routing → запомнить order_id.
--   2. Изменить crm_routing на оффере (другой success-stage).
--   3. Завершить оплату webhook'ом.
--   4. Выполнить запрос ниже:

SELECT
  o.id AS order_id,
  o.pipeline_stage_id AS applied_stage,
  o.meta -> 'crm_routing_snapshot' ->> 'stage_on_success' AS snapshot_success,
  t.meta -> 'crm_routing'        ->> 'stage_on_success' AS current_offer_success,
  CASE
    WHEN o.pipeline_stage_id::text = o.meta -> 'crm_routing_snapshot' ->> 'stage_on_success'
      AND o.pipeline_stage_id::text <> t.meta -> 'crm_routing' ->> 'stage_on_success'
    THEN 'OK_SNAPSHOT_WINS'
    ELSE 'CHECK'
  END AS verdict
FROM orders_v2 o
JOIN tariff_offers t ON t.id = o.offer_id
WHERE o.id = '<ORDER_ID_immutability_test>';

-- Должно: verdict = OK_SNAPSHOT_WINS.

-- ---------------------------------------------------------------------
-- G. Manual override proof
-- ---------------------------------------------------------------------
-- Шаги:
--   1. Создать заказ (pending выставлен из snapshot).
--   2. В Kanban вручную перетащить сделку в другую open-стадию.
--   3. Завершить оплату webhook'ом.

SELECT
  o.id,
  o.pipeline_stage_id AS current_stage,
  o.meta -> 'crm_routing_snapshot' ->> 'stage_on_pending' AS snapshot_pending,
  o.meta -> 'crm_routing_snapshot' ->> 'stage_on_success' AS snapshot_success,
  CASE
    WHEN o.pipeline_stage_id::text NOT IN (
      o.meta -> 'crm_routing_snapshot' ->> 'stage_on_pending',
      o.meta -> 'crm_routing_snapshot' ->> 'stage_on_success',
      o.meta -> 'crm_routing_snapshot' ->> 'stage_on_failed'
    )
    THEN 'OK_MANUAL_NOT_OVERWRITTEN'
    ELSE 'CHECK'
  END AS verdict
FROM orders_v2 o
WHERE o.id = '<ORDER_ID_manual_override_test>';

-- Плюс убедиться, что в audit_logs есть запись skipped_manual_override:
SELECT created_at, action, meta
FROM audit_logs
WHERE action = 'crm_stage_apply_skipped_manual_override'
  AND meta ->> 'order_id' = '<ORDER_ID_manual_override_test>';

-- ---------------------------------------------------------------------
-- H. Skipped invalid_config proof (для оффера БЕЗ routing)
-- ---------------------------------------------------------------------
-- Шаги: оплатить заказ, у которого offer без crm_routing или routing.enabled=false.
SELECT created_at, action, meta ->> 'reason' AS reason, meta
FROM audit_logs
WHERE action = 'crm_stage_apply_skipped_invalid_config'
  AND created_at > now() - interval '1 day'
ORDER BY created_at DESC
LIMIT 20;
