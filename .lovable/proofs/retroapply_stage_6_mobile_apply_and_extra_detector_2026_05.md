# PATCH-RETROAPPLY-STAGE-6 — кнопки применения, поиск лишних доступов, русификация UI

**Дата:** 2026-05-24  
**Scope:** `rules-retroapply` + `RetroApplyPanel`  
**Destructive execute:** не запускался.

## Diagnose

1. Полный предпросмотр по тарифу BUSINESS до патча мог обрываться с `context canceled`.
2. Детектор лишних доступов смотрел только пары user×product, уже попавшие в rule-driven pass, поэтому активный лишний доступ у пользователя мог не попасть в проверку, если он не входил в покрытие текущего правила.
3. `prior_purchase` проверялся по одному запросу на строку, что утяжеляло мобильный/полный предпросмотр.
4. В UI оставались технические английские подписи: `Stage`, `Destructive`, `soft-expire`, `revoke`, `zombie`, `idempotent`.
5. В полной ручной сверке четыре подтверждающие галочки не предзаполнялись.
6. Ночная проверка активна: cron job `access-rules-nightly-reconcile`, schedule `0 0 * * *`, последний execute `2026-05-24 00:00:43+00`, `failed=0`, `no_source_window=0`, destructive не выполнялся.

## Execute

1. `rules-retroapply` теперь строит batch cache для `prior_purchase` через существующий shared helper `buildPriorPurchaseCache`.
2. Extra-access detector теперь сканирует активные entitlements в рамках целевых продуктов правил по всей когорте, а не только уже покрытые rule-driven пары.
3. Область сканирования лишних доступов осталась ограниченной текущей когортой пользователей, чтобы не превращать проверку одного тарифа в глобальный sweep.
4. `RetroApplyPanel`:
   - нормализует ошибки функции в понятный русский текст;
   - предзаполняет все подтверждения при выборе полной ручной сверки;
   - заменяет технические английские UI-подписи на русские;
   - фильтр «Изменения» теперь включает сокращения сроков, перепривязку, приведение ручных доступов и снятие лишних доступов.

## Dry-run / Verify

### Tests

`supabase test_edge_functions rules-retroapply`:

- 15 passed / 0 failed.

### Deployed function smoke

`rules-retroapply` redeployed successfully.

### BUSINESS dry-run

Payload: `mode=preview`, `reconcile_mode=nightly_safe`, `source_tariff_id=7c748940-dcad-4c7c-a92e-76a2344622d3`.

Result:

```json
{
  "status": 200,
  "elapsed_ms": 19332,
  "summary": {
    "total": 1243,
    "missing_access": 0,
    "aligned_update_needed": 0,
    "reducible_by_rule": 0,
    "already_satisfied": 459,
    "condition_not_met": 784,
    "no_source_window": 0,
    "window_fallback_applied": 26,
    "soft_expire_extra_access": 0,
    "revoke_extra_access": 0
  }
}
```

### Product-wide dry-run

Payload: `mode=preview`, `reconcile_mode=nightly_safe`, `source_product_id=11c9f1b8-0355-4753-bd74-40b42aa53616`.

Result:

```json
{
  "status": 200,
  "elapsed_ms": 19830,
  "summary": {
    "total": 1405,
    "missing_access": 0,
    "aligned_update_needed": 0,
    "reducible_by_rule": 0,
    "already_satisfied": 462,
    "condition_not_met": 792,
    "no_source_window": 0,
    "window_fallback_applied": 26,
    "telegram_action_required": 151,
    "soft_expire_extra_access": 0,
    "revoke_extra_access": 0
  }
}
```

### Киреева check

Марина Киреева (`user_id=1ca89a55-80aa-4178-8d35-652ffe4ce888`) по BUSINESS dry-run:

```json
{
  "total": 11,
  "already_satisfied": 10,
  "condition_not_met": 1,
  "no_source_window": 0,
  "reducible_by_rule": 0,
  "soft_expire_extra_access": 0,
  "revoke_extra_access": 0
}
```

## DoD

- Кнопки больше не должны показывать сырую ошибку `Edge Function` / `context canceled`.
- Полная ручная сверка открывается с уже включёнными подтверждениями.
- В карточке настроек видимые подписи переведены на русский.
- Ночная проверка подтверждённо активна и запускалась сегодня.
- Деструктивные действия не запускались.