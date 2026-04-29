-- ============================================================================
-- DECOMMISSION LEGACY AUTO-GRANT TRIGGER ON subscriptions_v2
-- ============================================================================
-- Reason: trg_subscription_grant_telegram queues a SECOND DM via
-- telegram_access_queue → telegram-process-access-queue → telegram-grant-access,
-- duplicating the canonical path:
--   payment → grant-access-for-order → telegram-grant-access → mirror.
--
-- Decision (approved): the trigger is permanently disabled and its function
-- becomes an explicit no-op. The queue itself stays, but is allowed only for
-- explicit MANUAL/REPAIR sources (see telegram-process-access-queue guard).
--
-- Rollback (emergency only):
--   1. Restore body of trg_subscription_grant_telegram() from migration
--      20260429181943_d08bc9c0-57f0-4caf-94d0-be11524fe319.sql
--   2. ALTER TABLE public.subscriptions_v2
--        ENABLE TRIGGER subscription_grant_telegram;
-- ============================================================================

-- 1) Disable the trigger physically
ALTER TABLE public.subscriptions_v2
  DISABLE TRIGGER subscription_grant_telegram;

-- 2) Replace function body with explicit no-op (safety net if someone re-enables)
CREATE OR REPLACE FUNCTION public.trg_subscription_grant_telegram()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- INTENTIONAL NO-OP.
  -- The legacy queue path was decommissioned: see migration that added this body.
  -- Canonical write-path for Telegram auto-grant is:
  --   grant-access-for-order  →  telegram-grant-access  →  telegram_messages mirror.
  -- telegram_access_queue is reserved for explicit manual sources only
  -- (reinvite / manual_bulk / repair / admin_backfill); see
  -- telegram-process-access-queue source-guard.
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.trg_subscription_grant_telegram() IS
  'DECOMMISSIONED no-op. Canonical Telegram auto-grant goes through grant-access-for-order → telegram-grant-access. Manual queue items only: reinvite/manual_bulk/repair/admin_backfill.';