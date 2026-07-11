# SQL test suite Gate A.1 v3.1a (18 сценариев)

Статус: DRAFT. Запускать ТОЛЬКО в preview/test Supabase environment.
Запуск в production запрещён.

Обозначения:
- `PREVIEW_DB` — отдельный Supabase project (см. `preview_environment_setup.md`).
- `T_<n>` — идентификатор теста.
- Формат каждого теста: **Вход → SQL → Ожидание → Проверка → Cleanup**.
- Каждый тест сохраняет: `orders_v2.meta.rr` до/после, все `provider_events` за интервал.

## Общий bootstrap

Перед suite:

```sql
-- Изолированный тестовый offer/tariff/product в PREVIEW_DB (не боевые UUID).
INSERT INTO products_v2(...) VALUES ('P_TEST', ...);
INSERT INTO tariffs(...) VALUES ('T_TEST', ...);
INSERT INTO tariff_offers(id, tariff_id, offer_type, payment_method, amount, is_active)
VALUES ('OFFER_TEST', 'T_TEST', 'bank_installment', 'full_payment', 1650, true);
```

## T_01. Новый заказ получает upstream_call_state='not_started'

```sql
SELECT public.rr_get_or_create_pending_order(
  'OFFER_TEST'::uuid, NULL, 'a@ex.com','+375291000001',
  'P_TEST'::uuid, 'T_TEST'::uuid, 1650, 'BYN',
  'a@ex.com','+375291000001','127.0.0.1', '{}'::jsonb);
```

Ожидание: `state='created_new'`, `upstream_call_state='not_started'`.
Проверка: `SELECT meta->'rr' FROM orders_v2 WHERE id=<returned>;`.

## T_02. rr_mark_call_started переводит в 'started'

## T_03. Canonical happy path → completed

`rr_finalize_created_order(valid_https_url,...)` → `state='created'`; `orders_v2.initiation_status='created'`, `upstream_call_state='completed'`.

## T_04. Повтор того же URL → compatible already_created

`same_payment_url=true`, HTTP-эквивалент = reuse.

## T_05. Другой URL → rr_finalize_url_conflict

`ERRCODE=P0001`, `MESSAGE='rr_finalize_url_conflict'`.

## T_06. Unsafe URL (http://, с @, с CR/LF) отклоняется в SQL

`rr_is_safe_payment_url('http://example')` = false; `rr_finalize_created_order(...)` кидает `rr_payment_url_invalid`.
Тест-кейсы: `http://x`, `https://user@host/x`, `https://host/\nabc`, пустая строка, NULL, строка >2048 символов.

## T_07. Direct ambiguous canonical finalize запрещён

Заказ в `upstream_outcome='unknown'` → `rr_finalize_created_order` кидает `rr_finalize_ambiguous_source_forbidden`.

## T_08. Reconciler принимает только ambiguous source

`rr_reconcile_confirm_created` на заказе с чистым pending → `rr_finalize_reconciler_source_required_unknown`.
На заказе с `upstream_outcome='unknown'` → успех.

## T_09. rr_mark_upstream_unknown → outcome_unknown

Проверка: `upstream_call_state='outcome_unknown'`, `reconciliation_status='pending'`.

## T_10. rr_mark_local_persist_failed → completed_unpersisted

## T_11. Legacy unknown нормализуется

Ручной `UPDATE orders_v2 SET meta = jsonb_set(meta,'{rr,upstream_outcome}',to_jsonb('unknown'))` без остальных полей → `rr_mark_upstream_unknown` возвращает `already_unknown` + гарантирует `upstream_call_state='outcome_unknown'` и `reconciliation_status='pending'`.

## T_12. Legacy persist-failed нормализуется

Аналогично T_11 для `local_persist_failed=true` без `upstream_call_state`.

## T_13. Rejected finalizer guard

`rr_finalize_order_rejected` на заказе с `initiation_status='created'` → `rr_reject_after_created_forbidden`.

## T_14. not-created contract disabled

`SELECT public.rr_get_config_flag('rr.not_created_resolution_enabled')` = false. `rr_finalize_order_not_created` возвращает `contract_disabled`.

## T_15. allow-new-order contract disabled

`SELECT public.rr_get_config_flag('rr.allow_new_order_enabled')` = false. `rr_operator_resolve(..., 'allow_new_order')` возвращает `contract_disabled`.

## T_16. Internal helper недоступен всем API-ролям

```sql
SET ROLE anon; SELECT public.rr_finalize_created_order_internal(...); -- ERROR permission denied
SET ROLE authenticated; SELECT public.rr_finalize_created_order_internal(...); -- ERROR
SET ROLE service_role; SELECT public.rr_finalize_created_order_internal(...); -- ERROR
RESET ROLE;
```

Только owner (superuser в preview) может вызвать напрямую; production доступ — только через wrapper'ы.

## T_17. Audit events не дублируются

Двукратный вызов `rr_insert_idempotent_audit_event(order_id, 'call_started', payload)` создаёт ровно одну строку в `provider_events`.

## T_18. Multi-candidate identity priority

Создать вручную 4 заказа одной identity в состояниях:
- created + valid URL
- local_persist_failed=true
- upstream_outcome='unknown'
- upstream_call_state='started'

`rr_get_or_create_pending_order(...)` должен вернуть кандидата с `initiation_status='created'` (weight=1).

Далее удалить его, повторить — должен вернуться `local_persist_failed`; далее `unknown`; далее `started`.

## Cleanup

```sql
DELETE FROM provider_events WHERE order_id = ANY(<test_ids>);
DELETE FROM orders_v2 WHERE id = ANY(<test_ids>);
DELETE FROM tariff_offers WHERE id='OFFER_TEST'; -- если создавали
-- и т.д.
```

## Отчёт

`sql_integration_tests.md` в `runtime_proof/` — по каждому тесту:
- SQL вход;
- фактический ответ RPC;
- meta.rr до/после;
- строки provider_events;
- вердикт PASS/FAIL;
- timestamp;
- commit SHA миграции.
