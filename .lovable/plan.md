## Отчет о выполнении: FORENSIC-IDENTITY-ACCESS-SPRINT

### PATCH-SUPPORT-CONTACT-USERID-RESOLVER-FIX — ВЫПОЛНЕН

#### Что сделано

**Файл: `src/hooks/useTickets.ts`** — добавлен `user_id` в profiles JOIN:
```typescript
profiles:profile_id (
  user_id,        // ← ДОБАВЛЕНО
  full_name, email, phone, avatar_url
)
```

**Файл: `src/components/admin/ContactDetailSheet.tsx`** — переведены все data-queries на `resolvedUserId`:
- Subscriptions query (queryKey + userIds)
- Deals query (queryKey + userIds)
- Communications / audit_logs query
- Notification events query (telegram_logs + email_logs)
- Realtime subscription (useEffect)
- `isGhostContact` flag в handleGrantNewAccess

**Root cause подтверждён:** `useTicket` не включал `user_id` в JOIN → ContactDetailSheet из Support получал `contact.user_id = undefined` → подписки не находились (ищутся по auth user_id) → контакт помечался как ghost.

**Build:** TypeScript компиляция проходит без ошибок.

---

### PATCH-CASE-KOROLYOVA-REVOKE-FORENSICS — ROOT CAUSE ДОКАЗАН

#### Финальный timeline (DB proof)

| Время (UTC) | Событие | Proof |
|---|---|---|
| 05.04 08:58 | Старая подписка `4462ee5c` expired (`access_end_at`) | subscriptions_v2 |
| 06.04 03:01:46 | Новая подписка `dea78a37` создана, `access_end_at = 2026-05-05` | subscriptions_v2.created_at |
| 06.04 03:01:48 | Grant в access_grant_ledger: `reason_code=paid_order`, `status=granted` | access_grant_ledger |
| **06.04 04:00:17** | **AUTO_REVOKE** в telegram_logs, status=ok | telegram_logs |
| 06.04 07:06:24 | MANUAL_GRANT (админ восстановил) | telegram_logs |
| 06.04 07:07:04 | AUTO_GRANT + telegram_access.active_until обновлён до 2026-05-05 | telegram_access.updated_at |

#### Доказанный root cause

**Новая подписка `dea78a37` УЖЕ СУЩЕСТВОВАЛА за 59 минут до revoke.** Grant в `access_grant_ledger` тоже был записан.

Но `telegram-kick-violators` cron проверяет `telegram_access.active_until`, которое НЕ было обновлено при создании подписки (06.04 03:01). Обновление `telegram_access` произошло только в 07:07:04 — после ручного вмешательства админа.

**Системный gap:** `grant-access-for-order` записывает в `access_grant_ledger`, но НЕ обновляет `telegram_access.active_until`. Cron `telegram-kick-violators` не проверяет `access_grant_ledger` или `subscriptions_v2` — полагается только на стale `telegram_access.active_until`.

#### Safe remediation plan
- Добавить pre-revoke guard: перед kick проверять `subscriptions_v2.access_end_at > now()` для того же product/club
- Или: grant-access-for-order должен немедленно обновлять `telegram_access.active_until`

---

### Consolidated вывод

**Три отдельные проблемы, не один identity-баг:**

1. **Support-path resolver bug (Дергелёва):** `useTicket` не включал `user_id` → ContactDetailSheet не видел подписки. **ИСПРАВЛЕНО.**
2. **Revoke race condition (Королёва):** grant-access-for-order не обновляет `telegram_access.active_until` → cron видит stale данные и revoke-ит. **ROOT CAUSE ДОКАЗАН, remediation plan ready.**
3. **Ghost placeholder subscriptions (12 кейсов):** `user_id = profile_id` placeholder. **Discovery done, execute not approved.**

---

### Статус-блок

| Патч | Статус |
|---|---|
| PATCH 1 | closed |
| PATCH 2 | partial — 12 ghost кейсов ждут fix |
| PATCH-SUPPORT-CONTACT-USERID-RESOLVER-FIX | **DONE — code deployed** |
| PATCH-CASE-KOROLYOVA-REVOKE-FORENSICS | **root cause proved — remediation plan ready** |
| PATCH-GHOST-PLACEHOLDER-NORMALIZATION | discovery done, execute not approved |
| PATCH-GHOST-CLAIM-BRIDGE-PROOF | pending — historical proof needed |
| PATCH 3 illegal_bonus_access | pending (discovery можно начинать) |
| PATCH 4 duration drift | pending (независим) |
