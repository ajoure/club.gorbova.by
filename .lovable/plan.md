

# Plan: Site Builder — Corrected Event Schema

## Corrections Applied

### 1. `domain_events` schema aligned to canonical standard

Canonical fields: `id`, `event_type`, `source`, `entity_id`, `payload`, `created_at`.

Previous plan used non-canonical names (`aggregate_type`, `aggregate_id`, `actor_type`, `actor_user_id`, `status`). These are replaced:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK DEFAULT gen_random_uuid() | |
| `event_type` | text NOT NULL | e.g. `site.page.published` |
| `source` | text NOT NULL | e.g. `site-builder`, `system` |
| `entity_id` | uuid NOT NULL | ID of affected entity (site_page or binding) |
| `payload` | jsonb NOT NULL DEFAULT '{}' | Event data incl. `actor_user_id`, `entity_type` |
| `created_at` | timestamptz DEFAULT now() | |

**Infrastructure exception**: This table is explicitly NOT a business entity — it is platform infrastructure (append-only event log). It does NOT follow global entity structure (no `public_id`, `updated_at`, `updated_by`, `metadata`, `workspace_id`). This is a **platform-wide decision**, not a module-local deviation, documented via comment in migration SQL.

### 2. `domain_executions` schema aligned to canonical standard

Canonical fields: `id`, `event_id`, `step`, `status`, `error`, `attempt`, `created_at`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK DEFAULT gen_random_uuid() | |
| `event_id` | uuid FK → domain_events(id) NOT NULL | |
| `step` | text NOT NULL | Handler/step name |
| `status` | text NOT NULL DEFAULT 'pending' | `pending`, `success`, `failed`, `retrying` |
| `error` | text | Error message if failed |
| `attempt` | integer DEFAULT 0 | |
| `created_at` | timestamptz DEFAULT now() | |

**Same infrastructure exception** as `domain_events`: no `public_id`, `updated_at/by`, `metadata`. Documented as platform infrastructure.

### 3. Event flow entity-contract clarification

For `site.domain.bound`:

1. `SitePublicationService.bindDomain(pageId, domain, userId)` is called
2. Service validates uniqueness, prepares full entity data (`id`, `workspace_id`, `created_by`, `updated_by: null`, `metadata: {}`)
3. Service calls `SiteEventService.emitEvent('site.domain.bound', 'site-builder', bindingId, payload)`
4. Service executes the DB insert of `site_domain_bindings` with all required fields filled
5. `SiteEventService.recordExecution(eventId, 'insert_binding', 'success')`
6. Audit log written

The service is the single point that fills the entity contract — the event records the intent and outcome, not the entity creation itself.

### 4. `source` field in `domain_events`

Added as canonical column (see table above). Values: `site-builder`, `system`, or module name. Actor details (`actor_user_id`, `actor_type`) go into `payload` since they're context, not event identity.

---

## Everything else remains unchanged from the approved plan

- **`site_pages`**: full entity (public_id, workspace_id NOT NULL, created_by, updated_by, metadata)
- **`site_domain_bindings`**: full entity (public_id, workspace_id NOT NULL, created_by, updated_by, metadata)
- **Service layer**: SitePageService, SitePublicationService, SiteRenderService, SiteEventService — sole location of business logic
- **8 MVP block types** with versioned schema (id, type, version, content, settings, metadata)
- **DomainRouter compatibility layer**: prepend resolution, legacy unchanged
- **RLS**: admin write, anon published-only SELECT
- **Audit contract**: actor_type, actor_user_id, actor_label on all entries
- **INV-SITE-1**: nightly check, violations → `system_health_checks`
- **Adapter rule**: all external embeds through adapter layer
- **DRY RUN** before migration and DomainRouter changes
- **Implementation order**: 10 steps as previously defined
- **Files**: ~30 new, 3 modified, 1 migration

