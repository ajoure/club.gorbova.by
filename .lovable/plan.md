

# Plan: Fix 4 Security Issues — Implementation (Revised)

## Correction Applied

**Cross-domain coupling fix:** Move `sanitizeHtml()` from `src/services/sitePages/adapters/SanitizationAdapter.ts` to a shared location `src/lib/sanitization.ts` before creating `SafeHtml`. Then update all existing consumers (3 site-renderer files) to import from the new location. The old file becomes a re-export or is removed.

---

## Execution Order

### Step 1: Database Migration

Single migration:
```sql
-- Issue 2: temporary compatibility fix for __default__ sentinel
DROP POLICY "Authenticated users can manage folders" ON public.site_page_folders;
CREATE POLICY "Admins manage workspace folders"
  ON public.site_page_folders FOR ALL TO authenticated
  USING (workspace_id = '__default__' AND (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin')))
  WITH CHECK (workspace_id = '__default__' AND (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin')));

-- Issue 4a: view hardening
ALTER VIEW public.v_club_members_enriched SET (security_invoker = true);
```

### Step 2: Extract shared sanitizer + create SafeHtml

1. **Create `src/lib/sanitization.ts`** — move `sanitizeHtml()` + `SANITIZE_CONFIG` here (domain-neutral shared module)
2. **Update `src/services/sitePages/adapters/SanitizationAdapter.ts`** — re-export from `@/lib/sanitization` for backward compatibility of site-renderer imports (or update those 3 imports directly)
3. **Create `src/components/ui/SafeHtml.tsx`** — imports from `@/lib/sanitization`, not from sitePages domain

### Step 3: Replace `dangerouslySetInnerHTML` in ~28 files

All lesson blocks + `LibraryLesson.tsx` + communication previews (`TelegramMessagePreview`, `CommunicationSettingsTabContent`, `AdminEmail` preview). Already-sanitized files unchanged.

**Compatibility rule:** Only dangerous HTML stripped. Rich formatting preserved.

### Step 4: Fix SMTP credential exposure in `AdminEmail.tsx`

Read from `email_accounts_safe`. Password sent only on explicit change. Audit logging for both `email.account.created` and `email.account.updated`.

---

## VERIFY

**Issue 1:**
- All raw `dangerouslySetInnerHTML` in lesson blocks replaced with `SafeHtml`
- `<script>`, event handlers stripped; rich HTML renders correctly
- No visual regression in student lesson view
- **Lesson blocks and communication previews do not import from `src/services/sitePages/`** — only from `@/lib/sanitization` via `SafeHtml`

**Issue 2:**
- Non-admin cannot CRUD folders; admin/super_admin can
- Existing folder UI unchanged

**Issue 3:**
- `smtp_password` never returned to browser
- Password sent only on explicit change
- Audit log written for create and update

**Issue 4a:**
- `v_club_members_enriched` is security_invoker after migration

**Issue 4b:** No-op — 0 public-schema functions affected.

---

## Files

| Action | File |
|---|---|
| Create | `src/lib/sanitization.ts` |
| Create | `src/components/ui/SafeHtml.tsx` |
| Modify | `src/services/sitePages/adapters/SanitizationAdapter.ts` (re-export from shared) |
| Modify | ~25 lesson block files + `LibraryLesson.tsx` + 3 communication files |
| Modify | `src/pages/admin/AdminEmail.tsx` |
| Migration | RLS for `site_page_folders` + `v_club_members_enriched` security_invoker |

