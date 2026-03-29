

# План: Исправление дат + мердж Потекина→Михейкина

## Диагностика

| Проблема | Масштаб |
|---|---|
| Все 111 orders MIG-CB2S-* имеют `deal_date` = 29.03.2026 или NULL | 111 строк |
| Все 89 subscriptions cb2s_* имеют `access_start_at` = 29.03.2026 | 89 строк |
| Потекина создана как ghost вместо мерджа в Михейкину | 1 order + 1 subscription + 1 entitlement |
| `meta` не содержит `payment_date` — дату не записали при импорте | все |

## Данные от пользователя

- **Поток 1** → `deal_date = 2023-02-08`, `access_start_at = 2023-02-08`
- **Поток 2** → `deal_date = 2023-08-04`, `access_start_at = 2023-08-04`
- **Поток 3** → `deal_date = 2025-04-28`, `access_start_at = 2025-04-28`
- **access_end_at для всех** → `2026-08-30 23:59:59`

## Порядок выполнения

### Шаг 1: Мердж Потекина → Михейкина

1. Перепривязать order `MIG-CB2S-ROW-14` (`f349ef8f`):
   - `profile_id` → `e19ea68a` (Михейкина)
   - `user_id` → `51f7fd83` (Михейкина auth)

2. Перепривязать subscription (`155d7eeb`) на Потекина → Михейкина:
   - `profile_id` → `e19ea68a`
   - `user_id` → `51f7fd83`

3. Обновить entitlement cb_2_step, если привязан к ghost user_id `e6fd6835`:
   - Проверить: есть ли entitlement cb_2_step у Михейкиной (`51f7fd83`)?
     - Нет → обновить `user_id` entitlement на `51f7fd83`
     - Да → удалить дубль от ghost

4. Удалить ghost-профиль `e6fd6835` (Потекина)

5. Audit log: `actor_label = 'patch_cb2s_potekina_merge'`, `batch_id`, affected entities

### Шаг 2: Backfill deal_date для всех 111 orders

Логика: по `flow_id` определить поток → проставить `deal_date`:

```text
flow_id = '94dc4c62...' (1 поток) → deal_date = 2023-02-08
flow_id = 'a1db20a0...' (2 поток) → deal_date = 2023-08-04
flow_id = 'b28f0254...' (3 поток) → deal_date = 2025-04-28
```

Для orders без `flow_id` — проверить `meta->>'flow_code'` или `purchase_snapshot->>'flow_code'`.

### Шаг 3: Backfill access_start_at + access_end_at для всех 89 subscriptions

Аналогичная логика по flow:

```text
поток 1 → access_start_at = 2023-02-08, access_end_at = 2026-08-30
поток 2 → access_start_at = 2023-08-04, access_end_at = 2026-08-30  
поток 3 → access_start_at = 2025-04-28, access_end_at = 2026-08-30
```

### Шаг 4: Обновить entitlements expires_at

Все entitlements с `product_id = 87a8870f` (ЦБ 2 ступень):
- `expires_at = 2026-08-30 23:59:59`

### Шаг 5: Audit log + proof

- Записать в `audit_logs` все batch-операции
- Пересобрать `batch_report.txt` и `proof_full_join.csv`

---

## Reconciliation (ожидаемый итог)

- Orders: 111 (из них ROW-14 теперь на Михейкиной)
- Subscriptions: 89
- Ghost-профиль Потекина: удален
- deal_date: архивные даты по потокам
- access_end_at: 30.08.2026 у всех

## Риски

- Orders без flow_id и без flow_code в meta — не получат deal_date. Будут выявлены и показаны в отчете.
- Entitlement cb_2_step для row 107 (`438e32a4`) — уже создан ранее, expires_at будет обновлен до 30.08.2026.

## Изменяемые компоненты

Только data-fix через insert tool (UPDATE). Никаких миграций, edge functions, UI-изменений.

