# да, согласен, с учетом правок:

&nbsp;

1. matched / to_grant считать только там, где есть и profile_id, и user_id. В execute обязательно писать оба поля в subscriptions_v2.
2. Для reactivate нужно зафиксировать, какую именно запись обновляем:  

  - только latest row по явному правилу,
  - например: ORDER BY COALESCE(updated_at, created_at) DESC, id DESC LIMIT 1.  
  Иначе при нескольких старых подписках поведение будет недетерминированным.
3. &nbsp;
4. target_end и executed_at вычислить один раз в начале execute и использовать одинаково во всех UPDATE/INSERT/meta/audit. Не считать NOW() отдельно на каждой строке.
5. Verify по COUNT active subscriptions on tariff_id в лоб слабоват. Лучше проверять:  

  - либо по resolved cohort user_id/profile_id,
  - либо по batch_id в meta,
  - чтобы не смешать этот запуск с чужими/старыми подписками.
6. &nbsp;
7. В row-level audit/meta добавить минимум:  

  - module_id
  - tariff_id
  - product_id
  - row_action (grant / extend / reactivate / skip)
  - target_end
8. &nbsp;
9. Если у пользователя найдено несколько исторических строк по тому же tariff_id, это надо отдельно логировать как anomaly в dry run / execute report, а не молча “чинить”.
10. В verify оставить обязательную ручную проверку 3–5 email, и именно:  

  - запись в subscriptions_v2 есть,
  - status = active,
  - tariff_id правильный,
  - access_end_at совпадает с batch target,
  - модуль реально открывается.
11. &nbsp;

&nbsp;

&nbsp;

В остальном план правильный:

&nbsp;

- один access-path через subscriptions_v2,
- entitlements не трогаем,
- training_modules.product_id не меняем,
- dry run → execute → verify выстроены верно.

&nbsp;

&nbsp;

План: массовая выдача доступа к модулю «Подоходный налог ИП» на 90 дней

## Архитектура доступа (SoT)

```text
module_access(module_id → tariff_id) → subscriptions_v2(user_id, tariff_id, status=active)
```

- **module_id**: `40927147-918b-4597-bb9e-6a41c2b16c94` (Подоходный налог ИП, is_active=true)
- **tariff_id**: `0fb3db55-b6ba-44bf-8a0b-37bb040ab01a` (Стандарт)
- **product_id**: `de36a695-6b66-4547-bdb8-e64aa85eeabc`
- Entitlements-path **не трогаем** (training_modules.product_id = NULL)
- training_modules.product_id **не меняем** в этом патче

## batch_id

Один UUID генерируется **до dry run** и используется везде: dry run report, subscriptions_v2.meta, audit_logs.

## Шаг 1: Dry Run

### 1a. CSV-дедупликация


| Метрика          | Описание                                         |
| ---------------- | ------------------------------------------------ |
| total_rows       | Всего строк в CSV (без заголовка)                |
| unique_emails    | Уникальных email                                 |
| duplicate_emails | Список повторяющихся email и количество повторов |


### 1b. Классификация по UUID

После match email → profiles, вся дальнейшая логика только на UUID.


| Группа                       | Логика                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| **matched**                  | email в profiles, есть user_id                                                                           |
| **profile_without_user**     | email в profiles, user_id = NULL → skip                                                                  |
| **not_found**                | email нет в profiles → skip                                                                              |
| **already_has_access**       | из matched: активная подписка на tariff_id, access_end_at >= target_end → skip                           |
| **has_subscription_history** | из matched: есть записи в subscriptions_v2 по tariff_id, но не активны / истекли → extend или reactivate |
| **to_grant**                 | matched, нет записей в subscriptions_v2 по tariff_id → новый INSERT                                      |


Отчёт содержит числа по каждой группе + списки email.

## Шаг 2: Execute

`target_end = NOW() + INTERVAL '90 days'`

### Детерминированная логика по группам:


| Ситуация                                       | Действие                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| Активная подписка, access_end_at >= target_end | **skip**                                                                             |
| Активная подписка, access_end_at < target_end  | **extend**: UPDATE access_end_at = target_end                                        |
| Неактивная/истекшая подписка (latest row)      | **reactivate**: UPDATE status='active', access_end_at=target_end на последней записи |
| Нет записей                                    | **grant**: INSERT новая подписка                                                     |


### meta для каждой записи:

```json
{
  "source": "bulk_grant",
  "reason": "ЦБ 2.0 — Подоходный налог ИП",
  "batch_id": "<batch_uuid>",
  "duration_days": 90,
  "granted_by": "system_bulk",
  "csv_name": "ИП_в_рамках_ЦБ-2.csv",
  "module_id": "40927147-...",
  "tariff_id": "0fb3db55-...",
  "product_id": "de36a695-...",
  "source_csv_row_count": 61,
  "executed_at": "<timestamp>"
}
```

### Аудит: batch + row-level

**Batch-level** — одна запись в audit_logs:

```
action: bulk_grant_completed, meta: {batch_id, total, granted, extended, reactivated, skipped, failed}
```

**Row-level** — запись на каждого пользователя:

```
action: subscription_granted | subscription_extended | subscription_reactivated | subscription_skipped
target_user_id: <user_id>
meta: {batch_id, row_action, tariff_id}
```

## Шаг 3: Verify

1. COUNT активных подписок на tariff_id — сравнить с ожиданием (to_grant + extended + reactivated + already_active)
2. Сводка: granted / extended / reactivated / skipped / failed — должна сходиться с dry run
3. **3–5 конкретных email** проверить вручную:
  - есть запись в subscriptions_v2 с нужным tariff_id
  - status = active
  - access_end_at корректный (≈ NOW + 90 days)
  - модуль реально доступен по UI-логике (useTrainingModules → has_access = true)

## DoD

1. batch_id единый для всей операции
2. CSV-дедупликация с отчётом
3. Dry Run с 6 группами представлен до execute
4. Execute с детерминированной логикой grant/extend/reactivate/skip
5. meta содержит все трассировочные поля
6. audit_logs: batch + row-level записи
7. Verify: count + 3-5 ручных проверок
8. training_modules.product_id не изменён
9. Один access-path (subscriptions), entitlements не затронуты