

# План: INV-22 — финальный P0-патч (фикс meta-ключей в webhook)

Это план, не отчёт. P0-стандартизация формата мета — бизнес-логика INV-22 уже закрыта; патч предотвращает разрастание ключей и упрощает запросы/отчёты.

---

## Add-only / no-loss mapping

| Патч | Статус | Изменения в этом плане |
|------|--------|----------------------|
| INV-22 PATCH-1 (data fix) | ✅ Выполнен | Без изменений |
| INV-22 PATCH-2 (backfill propagation) | ✅ Выполнен | Без изменений |
| INV-22 PATCH-3 (webhook terminal states) | ✅ Выполнен | Без изменений по логике, только нормализация meta-ключей (этот патч) |

---

## Что делаем (ровно 1 место, без scope creep)

**Файл**: `supabase/functions/bepaid-webhook/index.ts`, строка 1806

В блоке terminal states (`['canceled','expired','failed','redirecting']`) заменить динамический meta-ключ:

**Было** (строка 1806):
```ts
[`bepaid_${subscriptionState}_at`]: now.toISOString(),
```

**Стало**:
```ts
bepaid_terminal_at: now.toISOString(),
bepaid_terminal_state: subscriptionState,
```

**Запрещено**:
- Менять body ответа (`status: subscriptionState` на строке 1829 — остаётся как есть)
- Менять audit action
- Переименовывать существующие поля
- Трогать другие ветки webhook

---

## STOP-guards

- Если затронуты `access_end_at`, entitlements, grant-access логика → **STOP**
- Если изменились другие участки webhook кроме meta блока terminal state → **STOP**
- Если добавлены новые ключи кроме двух фиксированных (`bepaid_terminal_at`, `bepaid_terminal_state`) → **STOP**

---

## DoD (пруфы)

1. **Diff-summary**: изменена только строка 1806 в `bepaid-webhook/index.ts` (meta блок terminal state) — никаких других файлов и участков
2. **SQL-check**: после деплоя убедиться, что в свежих записях `subscriptions_v2.meta` и `audit_logs.meta` присутствуют `bepaid_terminal_at` и `bepaid_terminal_state`, и нет ключей вида `bepaid_canceled_at` / `bepaid_failed_at` / `bepaid_expired_at` / `bepaid_redirecting_at`
3. **Негатив**: active state обработка не затронута (визуальная проверка diff)

