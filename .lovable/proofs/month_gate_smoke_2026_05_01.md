# Month-Gate Smoke Test — 2026-05-01

## Test User
- email: `1@ajoure.by`
- user_id: `37e91f59-e4db-4840-b9c9-e760e634ddd1`
- active CHAT entitlement on product `11c9f1b8-0355-4753-bd74-40b42aa53616`
- paid CHAT months (orders_v2.meta.deal_month, status=paid):
  - `2026-04` (order 28464393-d2e4-4ba6-a774-a098e2a67155)
  - `2026-01` (order 148a1cac-e2c9-4af6-93c4-29ffb0bde598)
- unpaid CHAT month for test: `2026-03`

## Test Fixtures (created)
- `lesson_id = aaaaaaaa-bbbb-cccc-dddd-000000000301`
  - title: `[SMOKE] month-gate test lesson`
  - module_id: `f5dc3e63-4cfd-40ba-9ce6-cee3b8790630` (Видеоответы, child of root `8b1fb03e`)
  - content_month: `2026-03`
- `rule_id = aaaaaaaa-bbbb-cccc-dddd-000000000302`
  - grant_target_type: `training_content`
  - target_ref: `8b1fb03e-8743-4654-a07f-b6c03ca7517b` (root: База знаний)
  - tariff_id: `31f75673-a7ae-420a-b5ab-5906e34cbf84` (CHAT)
  - conditions: `{access_mode: 'partial', allowed_lesson_ids: [smoke_lesson], match_purchase_month: true, smoke_test: true}`

## Migration F2 (delivered)
`has_month_purchase_bulk` теперь принимает `YYYY-MM` и `YYYY-MM-DD`, нормализует
к `YYYY-MM` и сравнивает с `orders_v2.meta->>'deal_month'` (SOT). Источник
`rule_engine` исключён.

## RPC Dry-Run Result
```
SELECT * FROM has_month_purchase_bulk(
  '37e91f59-e4db-4840-b9c9-e760e634ddd1',
  [
    {lesson, tariff: CHAT, content_month: '2026-03'},  -- expect false
    {lesson, tariff: CHAT, content_month: '2026-04'},  -- expect true
    {lesson, tariff: CHAT, content_month: '2026-01'},  -- expect true
  ]
);
```
Результат:
| content_month | has_purchase | expected |
|---------------|--------------|----------|
| 2026-03       | **false**    | false ✅ |
| 2026-04       | **true**     | true  ✅ |
| 2026-01       | **true**     | true  ✅ |

## UI Smoke
- Запуск под живым пользователем заблокирован отсутствием service-role в
  sandbox-окружении (нет автологина за 1@ajoure.by). Тестовые данные оставлены
  живыми для ручной проверки.

## Rollback (готов к запуску)
```sql
DELETE FROM lesson_progress WHERE lesson_id = 'aaaaaaaa-bbbb-cccc-dddd-000000000301';
DELETE FROM access_rules    WHERE id        = 'aaaaaaaa-bbbb-cccc-dddd-000000000302';
DELETE FROM training_lessons WHERE id        = 'aaaaaaaa-bbbb-cccc-dddd-000000000301';
```
