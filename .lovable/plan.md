

# Fix: DB-first order + UUID generation in EmailAccountService

## Two problems in current code

1. **Line 67**: `entityId = account.id || "new"` — text surrogate violates ID-driven standard
2. **Lines 70-75**: `emitEvent()` fires before DB insert — if insert fails, orphaned event exists for nonexistent entity

Both `save()` and `remove()` have event-first ordering. `remove()` is less risky (entity exists pre-delete) but should be consistent.

## Fix: Variant A (DB → Event → Execution → Audit)

Reorder to: DB operation first, then emit event as **fact**, then record execution, then audit.

### `save()` changes (lines 60-133)

```
static async save(account, newSmtpPassword?) {
  const user = await this.getCurrentUser();
  const isUpdate = !!account.id;
  const entityId = isUpdate ? account.id! : crypto.randomUUID();
  const eventType = isUpdate ? "email.account.updated" : "email.account.created";

  // 1. DB operation FIRST
  if (isUpdate) { /* update with account.id */ }
  else { /* insert with { id: entityId, ...payload } */ }

  // 2. Emit event as FACT (entity guaranteed to exist)
  const eventId = await DomainEventService.emitEvent(
    eventType, "email-admin", entityId,
    { email: account.email, account_id: entityId }
  );

  // 3. Record execution (always "success" — DB succeeded)
  await DomainEventService.recordExecution(eventId, "save_account", "success");

  // 4. Audit
  await this.writeAudit(eventType, user.id, user.email, { account_id: entityId });
}
```

If DB fails → exception thrown immediately, no event emitted, no orphaned records. Clean.

### `remove()` changes (lines 137-171)

Same reorder: DB delete → emitEvent → recordExecution → writeAudit.

### Error handling simplification

Since events only fire after successful DB ops, the `try/catch/finally` with status tracking becomes unnecessary. If DB fails, we throw. If DB succeeds, event/execution/audit are best-effort post-fact logging.

## Comment update

Line 11: change docstring from `emitEvent() → DB operation → recordExecution() → writeAudit()` to `DB operation → emitEvent() → recordExecution() → writeAudit()`.

## Files

| Action | File |
|---|---|
| Modify | `src/services/email/EmailAccountService.ts` |

## VERIFY

- Create path generates UUID via `crypto.randomUUID()`, no `"new"` placeholder
- Insert payload includes `id: entityId`
- DB operation executes **before** `emitEvent()` in both `save()` and `remove()`
- Events represent facts (completed mutations), not intentions
- No orphaned events possible on DB failure
- `entity_id` is always a real UUID in all domain events

