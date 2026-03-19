# да, согласен, с учетом правок:

&nbsp;

1. Вариант B (curl): убрать пустой header  
Сейчас -H "x-debug-secret: " отправляет пустое значение и гарантированно даст 403. Должно быть явно:  
-H "x-debug-secret: <CRON_SECRET>" (или x-cron-secret, если используете его).
2. Ожидаемый ответ (curl) — обновить под текущий JSON  
У вас ожидаемый ответ старый. Сейчас debug-ответ содержит доп.поля (via, orphanPsCount, executionId). Исправить ожидание на:  
ok=true, mode="debug", userHasSBS=true, dryRun=true (остальные поля допускаются).
3. Все DoD SQL-префиксовать hardening_anchor_utc (чтобы не ловить старые записи)  
Сейчас DoD-1..4 не ограничены created_at >= hardening_anchor_utc. Добавить в каждый запрос:  
AND created_at >= (SELECT created_at FROM ...hardening anchor...)  
или просто AND created_at >= '<hardening_anchor_utc>' после выполнения шага 2.
4. Шаг 2 (Hardening anchor): добавить фильтр по source  
Чтобы якорь был именно этого прогона:  
AND meta->>'source' = 'manual_orphan_dod'.
5. Шаг 4 (мониторинг 22.03): уточнить, что это PROD, не debug  
Добавить в запрос:  
AND (meta->>'debug' IS NULL OR meta->>'debug' <> 'true')  
чтобы debug-события не мешали боевым.
6. STOP-guard “повторить invoke” — добавить лимит повторов  
Например: максимум 3 повтора, дальше — проверка секрета/headers/endpoint, чтобы не зациклиться.

&nbsp;

&nbsp;

Остальное — корректно и без выбора параметров.

Hardening Verification: Orphan DoD (post-deploy anchor)

## Goal

Invoke debug mode after hardening deploy to get audit records with `debug=true` and `ttl_hint='debug'`, then verify all DoD criteria.

---

## Step 1 — Invoke debug mode (2 варианта)

### Вариант A: Lovable Cloud → Backend Functions

1. Открыть backend проекта
2. Перейти в Edge Functions → `subscription-renewal-reminders`
3. Invoke с телом:

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

Добавить header: `x-debug-secret: <значение CRON_SECRET из секретов проекта>`

### Вариант B: curl

```bash
curl -X POST \
  "https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/subscription-renewal-reminders" \
  -H "Content-Type: application/json" \
  -H "x-debug-secret: <CRON_SECRET>" \
  -d '{
    "source": "manual_orphan_dod",
    "debug_mode": true,
    "debug_dry_run": true,
    "debug_user_id": "252e4b5c-8784-4876-a4ce-412444753b3a",
    "debug_days_left": 3,
    "debug_product_id": null,
    "debug_subscription_id": "sbs_2ba8ec82d7d5c39b"
  }'
```

Ожидаемый ответ: `{"ok":true,"mode":"debug","userHasSBS":true,"dryRun":true}`

---

## Step 2 — Hardening anchor (DEPLOY_TIME)

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
ORDER BY created_at DESC
LIMIT 1;
```

Ожидание: 1 запись, `debug='true'`, `ttl_hint='debug'`.

---

## Step 3 — DoD SQL-пруфы (4 запроса)

### DoD-1: started + completed (ожидание: ≥1 запись каждого)

```sql
SELECT action, created_at, meta
FROM audit_logs
WHERE meta->>'user_id' = '252e4b5c-8784-4876-a4ce-412444753b3a'
  AND action IN ('reminders.orphan_dod_started','reminders.orphan_dod_completed')
ORDER BY created_at DESC
LIMIT 20;
```

### DoD-2: suppressed (ожидание: ≥1 запись)

```sql
SELECT action, created_at, meta
FROM audit_logs
WHERE meta->>'user_id' = '252e4b5c-8784-4876-a4ce-412444753b3a'
  AND action = 'reminders.orphan_dod_suppressed_sbs'
ORDER BY created_at DESC
LIMIT 20;
```

### DoD-3: no generated (ожидание: 0 записей)

```sql
SELECT action, created_at, meta
FROM audit_logs
WHERE meta->>'user_id' = '252e4b5c-8784-4876-a4ce-412444753b3a'
  AND action = 'reminders.paylink_cta_generated'
ORDER BY created_at DESC
LIMIT 20;
```

### DoD-4: no fail-signal (ожидание: 0 записей)

```sql
SELECT action, created_at, meta
FROM audit_logs
WHERE meta->>'user_id' = '252e4b5c-8784-4876-a4ce-412444753b3a'
  AND action = 'reminders.orphan_dod_has_sbs_false'
ORDER BY created_at DESC
LIMIT 20;
```

---

## Step 4 — Мониторинг боевого прогона 22.03

```sql
SELECT action, created_at, meta
FROM audit_logs
WHERE meta->>'user_id' = '252e4b5c-8784-4876-a4ce-412444753b3a'
  AND action IN ('reminders.paylink_cta_suppressed_sbs','reminders.paylink_cta_generated',
                 'reminders.sbs_fallback_hit','reminders.sbs_fallback_hit_no_product')
ORDER BY created_at DESC
LIMIT 50;
```

Ожидание: `paylink_cta_suppressed_sbs` ≥1, `paylink_cta_generated` = 0.

---

## STOP-guards


| Условие                                                | Действие                                |
| ------------------------------------------------------ | --------------------------------------- |
| После invoke нет `orphan_dod_completed` с `debug=true` | Hardening НЕ пройден. Повторить invoke. |
| Появился `paylink_cta_generated` для user `252e4b5c…`  | **Регрессия P0**. Блокировать выпуск.   |


---

## Чек-лист ожидаемых результатов


| Запрос           | Action                       | Ожидание                                |
| ---------------- | ---------------------------- | --------------------------------------- |
| DoD-1            | `orphan_dod_started`         | ≥1 запись                               |
| DoD-1            | `orphan_dod_completed`       | ≥1 запись, `debug=true`, `has_sbs=true` |
| DoD-2            | `orphan_dod_suppressed_sbs`  | ≥1 запись, `via=fallback`               |
| DoD-3            | `paylink_cta_generated`      | **0 записей**                           |
| DoD-4            | `orphan_dod_has_sbs_false`   | **0 записей**                           |
| Hardening anchor | `orphan_dod_completed`       | `debug='true'`, `ttl_hint='debug'`      |
| Мониторинг 22.03 | `paylink_cta_suppressed_sbs` | ≥1 запись (prod)                        |
| Мониторинг 22.03 | `paylink_cta_generated`      | **0 записей**                           |
