# Phase 4E — GitHub UI bridge (prepared for controlled deployment)

**Status:** code prepared; no Supabase runtime change has been made by this step.

## Delivered through GitHub

- The Companies screen now includes a protected Company sync queue panel.
- The panel is visible only to users with Companies manage access. It shows health, recent failed/dead-letter jobs and requires a reason for retry or dismiss.
- The company-sync-admin Edge Function validates the user JWT and admin/super_admin role before calling the existing service-only health, retry and dismiss RPCs. The authenticated actor id is retained by the existing CRM audit trail.

## Deployment gate that remains intentionally closed

The function fails closed until COMPANY_SYNC_ADMIN_ALLOWED_ORIGINS contains the exact comma-separated production and approved preview origins. This setting is a Supabase runtime secret and must be configured/deployed through Lovable; it is not stored in GitHub. The function does not widen queue table/RPC grants, expose a service key, or enable wildcard CORS.

## Explicitly deferred

Notification delivery targets for dead-letter/stuck-job alerts are not guessed. Email/Telegram recipients, sender integration and escalation policy require an owner decision before an alerting job can be activated.
