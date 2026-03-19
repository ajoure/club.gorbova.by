

# Hardening Verification: Orphan DoD (post-deploy anchor)

## Статус

До hardening был старый debug-прогон без меток `debug`/`ttl_hint` — он не засчитывается.

Для hardening-проверки нужен ручной invoke, потому что требуется передать CRON_SECRET в заголовке.

---

## Действие (одно, без вариантов)

Backend проекта → Edge Functions → `subscription-renewal-reminders` → Invoke

**Header:**
```
x-debug-secret: <CRON_SECRET>
```

**Body:**
```json
{
  "source": "manual_orphan_dod",
  "debug_mode": true,
  "debug_dry_run": true,
  "debug_user_id": "252e4b5c-8784-4876-a4ce-412444753b3a",
  "debug_days_left": 3,
  "debug_product_id": null,
  "debug_subscription_id": "sbs_2ba8ec82d7d5c39b"
}
```

---

## После invoke — 2 SQL-запроса

### 1. Anchor (ожидание: 1 запись)

```sql
SELECT created_at, meta->>'execution_id' AS execution_id, meta->>'debug' AS debug, meta->>'ttl_hint' AS ttl_hint
FROM audit_logs
WHERE action = 'reminders.orphan_dod_completed'
  AND meta->>'debug' = 'true'
  AND meta->>'source' = 'manual_orphan_dod'
ORDER BY created_at DESC
LIMIT 1;
```

### 2. DoD (ожидание: completed + suppressed есть; has_sbs_false и paylink_cta_generated = 0)

```sql
SELECT action, created_at, meta
FROM audit_logs
WHERE meta->>'user_id' = '252e4b5c-8784-4876-a4ce-412444753b3a'
  AND meta->>'debug' = 'true'
  AND action IN (
    'reminders.orphan_dod_started',
    'reminders.orphan_dod_has_sbs_true',
    'reminders.orphan_dod_suppressed_sbs',
    'reminders.orphan_dod_has_sbs_false',
    'reminders.orphan_dod_completed',
    'reminders.paylink_cta_generated'
  )
ORDER BY created_at DESC
LIMIT 50;
```

---

## Критерий

**Готово**, если:
- `orphan_dod_completed` ≥ 1 и `meta.debug=true`
- `orphan_dod_suppressed_sbs` ≥ 1
- `orphan_dod_has_sbs_false` = 0
- `paylink_cta_generated` = 0 для этого user_id в debug-окне

Иначе — **не готово**.

---

После invoke пришлите результат 2 SQL — и закрываем hardening.

