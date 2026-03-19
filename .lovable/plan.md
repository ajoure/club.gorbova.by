

# Финальное ТЗ: HARDENING_VERIFICATION_FINAL.md

---

## Формат сдачи

Один артефакт: `HARDENING_VERIFICATION_FINAL.md` (или одно сообщение в чате).
Внутри ровно 4 блока: A, B1, B2, VERDICT. Без пояснений, без переписки.

---

## A — Скрин invoke из Lovable Cloud UI (обязательный)

Lovable Cloud → Backend → Edge Functions → `subscription-renewal-reminders` → Invoke history / Logs.

На скрине **одновременно** видны:
- `execution_id`
- `timestamp`
- request body с полями:
  - `source = "manual_orphan_dod"`
  - `debug_mode = true`
  - `debug_user_id = 252e4b5c-8784-4876-a4ce-412444753b3a`
- Секреты замазать.

Если старый invoke не виден — сделать новый manual debug invoke через UI с тем же body и приложить его скрин.

**execution_id на скрине A должен совпадать с execution_id из результата B1.**

---

## B1 — Anchor SQL (скрин результата)

```sql
SELECT
  created_at AS hardening_anchor_utc,
  meta->>'execution_id' AS execution_id,
  meta->>'source' AS source,
  meta->>'debug' AS debug,
  meta->>'ttl_hint' AS ttl_hint
FROM audit_logs
WHERE action = 'reminders.orphan_dod_completed'
  AND meta->>'debug' = 'true'
  AND meta->>'ttl_hint' = 'debug'
  AND meta->>'source' = 'manual_orphan_dod'
  AND meta->>'execution_id' IS NOT NULL
ORDER BY created_at DESC
LIMIT 1;
```

Ожидание: 1 строка с `debug=true`, `ttl_hint=debug`, `source=manual_orphan_dod`, `execution_id` NOT NULL.

---

## B2 — DoD-лента (скрин результата)

`execution_id` берётся строго из результата B1. Пустая строка или другой ID не допускается.

```sql
SELECT action, created_at, meta
FROM audit_logs
WHERE meta->>'user_id' = '252e4b5c-8784-4876-a4ce-412444753b3a'
  AND meta->>'execution_id' = '<EXEC_ID_FROM_B1>'
  AND meta->>'debug' = 'true'
  AND meta->>'ttl_hint' = 'debug'
  AND meta->>'source' = 'manual_orphan_dod'
  AND action IN (
    'reminders.orphan_dod_started',
    'reminders.orphan_dod_has_sbs_true',
    'reminders.orphan_dod_suppressed_sbs',
    'reminders.orphan_dod_has_sbs_false',
    'reminders.orphan_dod_completed',
    'reminders.paylink_cta_generated'
  )
ORDER BY created_at ASC;
```

---

## Критерий приёмки (PASS/FAIL)

PASS только если **одновременно**:
1. есть `orphan_dod_completed` с `debug=true`, `ttl_hint=debug`, `has_sbs=true`
2. есть `orphan_dod_suppressed_sbs` с `via=fallback`, `orphan_ps_count>=1`
3. **нет** `orphan_dod_has_sbs_false`
4. **нет** `paylink_cta_generated` для этого user_id
5. **execution_id совпадает** между A (скрин UI), B1 (Anchor SQL) и B2 (DoD SQL)

---

## STOP-условие

Если в ответе нет A (скрин invoke) или нет B1 (скрин Anchor SQL) или нет B2 (скрин DoD SQL) — ответ не принимается, задача невыполнена. Повторы словами без скринов не засчитываются.

---

## Финальная строка в артефакте

```
VERDICT: PASSED / FAILED
```

