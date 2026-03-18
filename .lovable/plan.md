

# Plan: Extract EmailAccountService with Domain Events

## Corrections Applied

1. **SiteEventService → shared `DomainEventService`**: Extract to `src/lib/domain-events.ts`. Old file becomes backward-compatible re-export only. `EmailAccountService` imports exclusively from `@/lib/domain-events`.

2. **CommunicationSettingsTabContent.tsx included in scope**: Line 99 reads from `email_accounts` with safe column subset (no `smtp_password`), but for consistency all email account read paths switch to `email_accounts_safe`. One-line change.

3. **VERIFY expanded**: `AdminEmail.tsx` must contain zero inline Supabase logic for email account lifecycle — no `supabase.from("email_accounts")`, `supabase.from("audit_logs")`, `supabase.from("domain_events")`, `supabase.from("domain_executions")`.

4. **Audit contract explicit**: All `writeAudit()` calls include `actor_type: "user"`, `actor_user_id`, `actor_label` (user email). Source label for events: `"email-admin"`.

5. **Read path invariant**: `EmailAccountService.list()` reads exclusively from `email_accounts_safe`. `smtp_password` never reaches the browser.

---

## Execution

### Step 1: Extract DomainEventService to `src/lib/domain-events.ts`

Move class + types (`DomainEvent`, `DomainExecution`) from `src/services/sitePages/SiteEventService.ts`. Rename class to `DomainEventService`. Same API: `emitEvent()`, `recordExecution()`, `updateExecution()`.

Update `src/services/sitePages/SiteEventService.ts` to re-export only:
```ts
export { DomainEventService as SiteEventService } from "@/lib/domain-events";
export type { DomainEvent, DomainExecution } from "@/lib/domain-events";
```

Also update `src/services/sitePages/index.ts` export line accordingly.

No changes to `SitePageService.ts`, `SiteTagService.ts`, `SitePublicationService.ts` — they continue importing `SiteEventService` from `./SiteEventService` which re-exports.

### Step 2: Create `src/services/email/types.ts`

```ts
export interface EmailAccount {
  id: string;
  email: string;
  display_name: string | null;
  provider: string;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_encryption: string | null;
  smtp_username: string | null;
  has_password: boolean;
  from_name: string | null;
  from_email: string | null;
  reply_to: string | null;
  is_default: boolean;
  is_active: boolean;
  use_for: string[];
  created_at: string;
  imap_host: string | null;
  imap_port: number | null;
  imap_encryption: string | null;
  imap_enabled: boolean;
  last_fetched_at: string | null;
}

export interface EmailAccountSaveInput { /* fields for create/update */ }
```

### Step 3: Create `src/services/email/EmailAccountService.ts`

Static methods, imports `DomainEventService` from `@/lib/domain-events`.

- **`list()`** — reads from `email_accounts_safe`. Returns `EmailAccount[]`. **Invariant: smtp_password never in response.**
- **`save(account, newSmtpPassword?)`**:
  - `emitEvent("email.account.created"/"email.account.updated", "email-admin", entityId, payload)`
  - DB write to `email_accounts`
  - `recordExecution(eventId, "save_account", "success"/"failed")`
  - `writeAudit()` with `actor_type: "user"`, `actor_user_id`, `actor_label`
- **`remove(id)`**:
  - `emitEvent("email.account.deleted", "email-admin", id, payload)`
  - DB delete
  - `recordExecution(eventId, "delete_account", "success"/"failed")`
  - `writeAudit()` with same actor contract

Internal helpers: `getCurrentUserId()`, `writeAudit()` — same pattern as `SiteTagService`.

### Step 4: Update `AdminEmail.tsx`

- Remove `saveAccountMutation` inline body (lines 241–301) → delegate to `EmailAccountService.save()`
- Remove `deleteAccountMutation` inline body (lines 304–316) → delegate to `EmailAccountService.remove()`
- Replace list query (lines 214–226) → delegate to `EmailAccountService.list()`
- Remove `EmailAccount` interface → import from `@/services/email/types`
- Keep UI helpers (`getSmtpSettings`, `getImapSettings`, `getProviderName`, `USE_FOR_OPTIONS`) in component

### Step 5: Update `CommunicationSettingsTabContent.tsx`

Line 99: change `supabase.from("email_accounts")` → `supabase.from("email_accounts_safe" as any)`. Same column selection, defense-in-depth consistency.

---

## Files

| Action | File |
|---|---|
| Create | `src/lib/domain-events.ts` |
| Create | `src/services/email/types.ts` |
| Create | `src/services/email/EmailAccountService.ts` |
| Modify | `src/services/sitePages/SiteEventService.ts` (re-export only) |
| Modify | `src/services/sitePages/index.ts` (update export) |
| Modify | `src/pages/admin/AdminEmail.tsx` |
| Modify | `src/components/admin/communication/CommunicationSettingsTabContent.tsx` |

## VERIFY

- `AdminEmail.tsx` contains no `supabase.from("email_accounts")`, `supabase.from("audit_logs")`, `supabase.from("domain_events")`, `supabase.from("domain_executions")` calls
- `AdminEmail.tsx` contains no inline create/update/delete business logic for email accounts — only service method calls
- `EmailAccountService.list()` reads exclusively from `email_accounts_safe` — **smtp_password never reaches browser**
- `CommunicationSettingsTabContent.tsx` reads from `email_accounts_safe`
- `EmailAccountService.save()` and `.remove()` follow `emitEvent() → DB → recordExecution() → writeAudit()` path
- Audit logs include `actor_type: "user"`, `actor_user_id`, `actor_label` for all operations
- Domain events: `email.account.created`, `email.account.updated`, `email.account.deleted` with source `"email-admin"`
- `EmailAccountService` imports from `@/lib/domain-events`, not from `src/services/sitePages/`
- `SiteEventService.ts` contains only re-exports from `@/lib/domain-events`
- Existing save/delete/list functionality works unchanged

