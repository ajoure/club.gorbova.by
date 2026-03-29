

# План: «Закрой год» v8 final — подтверждён, готов к выполнению

Все 5 правок уже включены в v8 (предыдущее сообщение). План не изменился.

## Краткая сводка перед стартом

| Параметр | Значение |
|---|---|
| Product | `73c29914`, «ЗАКРОЙ ГОД» |
| Target tariff | Standard T-000009 (`56c35e86`) |
| Wrong tariffs | 4 шт. (T-000032, T-000033, T-000034, T-000028) |
| Existing orders | 37 (все flow_id=NULL) |
| Existing subscriptions | 11 (все flow_id=NULL) |
| CSV rows | 453 |
| Output files | **20** |
| Phases | A → B → C → D, STOP/verify между каждой |

## Порядок выполнения

1. **Phase A** — discovery + 12 dry-run артефактов
2. **STOP: verify dry-run**
3. **Phase B** — reassign 12 orders + 10 subs → Standard, zero-ref verify (включая `payment_reconcile_queue`), hard delete 4 wrong tariffs + `close_year_deleted_tariffs_proof.txt` с `delete_mode=hard_delete`
4. **STOP: verify 1 тариф, 0 wrong refs**
5. **Phase C** — backfill flow_id (чистый flow-fix), join-proof с `backfill_source`
6. **STOP: verify flow consistency**
7. **Phase D** — collapse CSV (broken = отдельный bucket в skip_reasons и reconciliation), profile matching, anti-join, import, final reconciliation с числовым DB-level verify (37 = N auto-mapped + M gap, 11 = X auto-mapped + Y manual_review), `close_year_unmatched_profiles.csv` разделён на `ghost_profile_created` / `ghost_order_only_executed`

## Следующий шаг

Запускаю **Phase A: Discovery + dry-run артефакты** — генерация 12 файлов в `/mnt/documents/close_year_import/`.

Подтвердите старт, и я начну с Phase A.

