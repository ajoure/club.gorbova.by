# Monitor Rebill No-Extension — PATCH 2026-05

## Scope
PATCH только для edge function `monitor-rebill-no-extension`. Никаких изменений в `subscriptions_v2`, `entitlements`, `payments_v2`, никаких `grant-access-for-order`, `telegram-grant`, webhook replay, auto-remediation.

## Что изменилось в коде

1. **SQL/детектор переписан**:
   - `subscriptions_v2 by order_id` больше не выбирается «первая попавшаяся». При наличии нескольких записей на один `order_id` выбирается active, иначе самая свежая.
   - Это нужно только для предварительной фильтрации (это вообще recurring, а не one-time/installment).
2. **Coverage по user+product (новый SOT)**:
   - `coverage_end = GREATEST( MAX(subscriptions_v2.access_end_at) WHERE status='active', MAX(entitlements.expires_at) )` по `user_id + product_id`.
   - Если `coverage_end >= expected_end_at_minsk` → `covered=true`, кандидат **не** алертится.
3. **Buckets**:
   - `no_extension` (severity=critical) — нет покрытия и существенный gap.
   - `provider_period_shorter_than_tariff_access_days` (severity=warning) — нет покрытия по active, но gap ≤ 36ч и `tariff.access_days ≥ 28`. Доступ есть, просто bePaid дал период короче `tariff.access_days`. Алерт в Telegram **не** идёт.
4. **Auto-resolve уже открытых REBILL-NO-EXT**:
   - Перед детектом проходим по всем `system_health_checks WHERE check_key LIKE 'REBILL-NO-EXT:%' AND status='failed'`.
   - Если по `details.user_id + details.product_id` сейчас есть active subscription/entitlement, покрывающая `expected_access_end_at_minsk` → `status='passed'`, `details.resolved_by='covered_by_current_active_subscription'`, `details.resolved_at`, `details.coverage_end_at`, `details.coverage_source`.
   - Никакие платёжные/подписочные сущности не трогаются.
5. **Telegram-нотификация**:
   - Шлётся только для `severity='critical'`. Provider-period mismatch не шумит в чат.
6. **Новый режим `resolve_only:true`** — пробежать только по уже открытым алертам, без сканирования окна. Удобно для разовой очистки.

## Запреты соблюдены

| Запрет | Статус |
|---|---|
| UPDATE в `subscriptions_v2` | не делается |
| UPDATE в `entitlements` | не делается |
| webhook replay | не делается |
| `grant-access-for-order` | не вызывается |
| `telegram-grant-access` / `telegram-revoke-access` | не вызывается |
| auto-remediation | нет |

Единственная мутация: `system_health_checks.status` (`failed → passed`) и `details` тех же health-строк. Это health/reporting-слой, не платежи.

## Dry-run результат (window 7 дней)

```
POST /functions/v1/monitor-rebill-no-extension
{ "dry_run": true, "dry_run_days": 7, "notify": false }
```

```json
{
  "scanned": 1,
  "covered_by_current_access": 0,
  "new_alerts": 0,
  "new_critical": 0,
  "new_warning": 0,
  "re_evaluated_open": 3,
  "resolved_now": 2,
  "candidates": [
    {
      "email": "nosipik@yandex.ru",
      "reason": "provider_period_shorter_than_tariff_access_days",
      "severity": "warning",
      "covered": false,
      "current_access_end_at": "2026-06-03T20:59:59+00:00",
      "expected_access_end_at_minsk": "2026-06-04T20:59:59.000Z",
      "gap_hours": 24,
      "access_days": 30,
      "coverage_source": "subscription"
    }
  ]
}
```

## Resolve_only execute (применили auto-resolve реально)

```
POST /functions/v1/monitor-rebill-no-extension
{ "resolve_only": true, "notify": false }
```

```json
{
  "re_evaluated": 3,
  "resolved": 2,
  "resolved_items": [
    { "check_id": "3142f298-4406-48b0-a8a4-7c9531d9a5ba",
      "payment_id": "1c0ccf66-8323-41bf-99cd-8a26ff6318be",
      "coverage_end_at": "2026-06-04T20:59:59+00:00",
      "coverage_source": "subscription" },
    { "check_id": "d3683092-2ff6-447d-91cc-f677e7b6eb42",
      "payment_id": "4d152dbd-3f9d-44ee-8143-dfbe74efe6e5",
      "coverage_end_at": "2026-06-04T20:59:59+00:00",
      "coverage_source": "subscription" }
  ]
}
```

Это два false-positive из диагностики (Karalyova / Viktoria). Оба теперь `status='passed'`, `details.resolved_by='covered_by_current_active_subscription'`. Никакие платежи/подписки/entitlements не правились.

## До / после

| Метрика | До PATCH | После PATCH |
|---|---|---|
| Total REBILL-NO-EXT alerts (за 7 дней) | 3 | 1 |
| False positives (есть active coverage) | 2 | 0 (помечены `passed`) |
| Real `no_extension` (critical) | 0 | 0 |
| `provider_period_shorter_than_tariff_access_days` (warning, не алертится) | 0 | 1 (nosipik@yandex.ru) |
| Repair needed (subs/entitlements/grant) | 0 | **0** |
| Critical Telegram алертов на следующем тике | — | 0 |

## Кейс C (`nosipik@yandex.ru`) — отдельный bucket

- Не правим. Доступ есть до `2026-06-03 23:59 Minsk`, ожидание `2026-06-04 23:59 Minsk` (gap = 24h, tariff = 30 дней).
- Bucket: `provider_period_shorter_than_tariff_access_days`, severity=warning.
- Решение, верить ли `bePaid active_to` или дотягивать до `tariff.access_days`, вынесено отдельной задачей. Сейчас не трогаем.

## DoD ✅
- SQL-детекция исправлена (active subscription + entitlement coverage).
- Bucket `provider_period_shorter_than_tariff_access_days` заведён, severity=warning, в Telegram не шумит.
- Auto-resolve уже открытых REBILL-NO-EXT по тому же критерию работает (применён на 2 false-positive).
- Никаких UPDATE в `subscriptions_v2` / `entitlements` / repair.
- Proof: данный файл.
