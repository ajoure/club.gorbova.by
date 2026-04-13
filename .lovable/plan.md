# Отчет о выполнении: WRONG-GRANTS-ROLLBACK + ROOT-CAUSE

## Дата: 2026-04-13

## Статус: ВЫПОЛНЕНО

## Forensic Discovery

### Ключевое уточнение
PATCH D (cohort repair от 13.04) **НЕ создал ошибочных грантов**. Все гранты PATCH D — корректные (Gorbova Club для Club BUSINESS подписчиков).

### Root Cause
**6 февраля 2026** — legacy `bepaid-webhook` при обработке оплаты создавал telegram_access записи для ВСЕХ клубов без product-scoped валидации (source=`system`). В результате пользователи Gorbova Club получили ложные pending записи для клуба "Бухгалтерия как бизнес".

**18 февраля** — массовый revoke отозвал grants в `telegram_access_grants`, но НЕ очистил записи в `telegram_access`. Результат: `state_chat=pending` висит бессрочно.

### Масштаб

| Метрика | До | После |
|---------|-----|-------|
| pending записей "Бухгалтерия как бизнес" | 43 | 33 (все с valid sub) |
| pending без валидного доступа к продукту | 10 | 0 |
| pending с null active_until | 7 | 0 |
| removed (очищено) | 1 | 11 |

### Очищенные пользователи (10 записей)

| user_id | active_until | Причина очистки |
|---------|-------------|-----------------|
| 80afcb07 | null | Нет подписки на продукт |
| 56fb9a7c | null | Нет подписки, grants revoked |
| a832c11e | null | Нет подписки, grants revoked |
| 23b80521 | null | Нет подписки, grants revoked |
| c9e8dd78 | null | Нет подписки, grants revoked |
| 6b0e0451 | null | Нет подписки, grants revoked |
| 05cd3754 | 2026-02-04 (expired) | Нет подписки, grant revoked |
| f08cc354 | 2026-02-18 (expired) | Нет подписки |
| 4d54a47d | 2026-02-21 (expired) | Нет подписки, grant revoked |
| c6325f89 | 2026-03-08 (expired) | Нет подписки, grant expired |

### Аномалия исправлена
User 6ae5cc6e — имел active sub + active grant, но `active_until=null` в telegram_access. Обновлено на `access_end_at` из подписки.

### Audit
10 записей в `audit_logs` с action=`telegram_access.wrong_grant_cleanup`, actor_label=`wrong-grants-rollback-patch`.

### STOP-guards соблюдены
- 33 записи с валидным доступом НЕ затронуты
- Клуб Gorbova Club НЕ затронут
- Никто не кикнут из Telegram (все записи были pending, не в чате)
- Legacy bepaid-webhook path уже заблокирован в PATCH A

## Связь с предыдущими PATCH

| PATCH | Участие в инциденте | Verdict |
|-------|-------------------|---------|
| PATCH A (snake_case fix) | НЕТ — инцидент от февраля | Safe, bepaid:5496 заблокирован |
| PATCH B (UI write-path) | НЕТ — записи от legacy webhook | Safe |
| PATCH D (cohort repair) | НЕТ — repair выдал только Gorbova Club | Safe |

## Техдолг (PATCH E — backlog)

- `telegram-grant-access` state-machine: pending ставится до invite, нет rollback при ошибке шагов 3-5
- Нет различия в UI между "TG not linked pending" и "invite sent pending"
- 155 pending пользователей требуют drill-down классификации (valid/false/stuck)
- `telegram-cron-sync`: обновляет updated_at для dead-pending записей (низкий приоритет, косметический)
