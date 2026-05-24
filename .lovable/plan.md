Да, согласен.

План правильный: это уже **не новый код**, а финальная проверка и применение через готовый UI/API-механизм.

Отправь:

План PATCH-RETROAPPLY-STAGE-6-VERIFY-AND-APPLY принимаю.

&nbsp;

Важно:

это не новый архитектурный патч и не новый discovery. Это финальный verify/apply по уже задеплоенному Stage 5/6 коду.

&nbsp;

Разрешаю выполнить:

&nbsp;

1. Diagnose:

- проверить payload/флаги;

- проверить audit_logs, не был ли execute уже выполнен.

&nbsp;

2. Preview cohort B / Gorbova Club BUSINESS:

- получить counts по категориям;

- отдельно показать reducible_by_rule;

- отдельно показать no_source_window;

- показать window_fallback_applied.

&nbsp;

3. Если reducible_by_rule > 0:

разрешаю execute только по:

apply_categories=["reducible_by_rule"]

allow_reduce_access=true

reconcile_mode="admin_canonicalize_all"

&nbsp;

Все остальные destructive/manual/Telegram флаги должны быть false.

&nbsp;

4. После execute:

- repeat preview;

- reducible_by_rule должен стать 0;

- проверить changed rows;

- проверить previous_expires_at / reduction_reason / batch_id;

- проверить audit_logs.

&nbsp;

5. Если reducible_by_rule уже 0:

- найти предыдущий batch/audit, который это закрыл;

- показать доказательство.

&nbsp;

6. no_source_window:

- должно стать 0 после window fallback;

- если осталось >0 — объяснить построчно.

&nbsp;

Запрещено:

- soft-expire;

- revoke;

- manual override;

- Telegram;

- physical DELETE;

- ручной SQL DML;

- изменения orders_v2/subscriptions_v2/access_rules.

&nbsp;

Proof обновить:

.lovable/proofs/retroapply_stage_6_mobile_apply_and_extra_detector_2026_[05.md](http://05.md)

&nbsp;

В proof обязательно добавить таблицу:

category | before | after | action

&nbsp;

После выполнения дать короткий итог:

- сколько было reducible;

- сколько применено;

- сколько стало;

- что с no_source_window;

- какие audit/batch_id.

Коротко: **approve на финальный verify/apply**. Только сокращение сроков по reducible_by_rule, без revoke/soft-expire/manual/Telegram.

&nbsp;

## План: PATCH-RETROAPPLY-STAGE-6-VERIFY-AND-APPLY

### Цель

Закрыть Stage 5/6 фактическими проверками: подтвердить, что `reducible_by_rule=22` и `no_source_window=7` либо реально приведены к канону через execute, либо уже исправлены ранее. Обновить proof итоговой таблицей `before/after/action`.

### Scope (что трогаем / что НЕ трогаем)

- **Трогаем:** edge function `rules-retroapply` (только вызовы preview/execute через `supabase--curl_edge_functions`), `audit_logs` (чтение), `entitlements` (только через canonical write-path функции, без ручного DML), proof-файл `.lovable/proofs/retroapply_stage_6_mobile_apply_and_extra_detector_2026_05.md`.
- **НЕ трогаем:** `orders_v2`, `subscriptions_v2`, `access_rules`, никакого SQL DML; запрещены `soft-expire`, `revoke`, `manual_override`, Telegram-действия, physical DELETE.

### Этапы

**Diagnose (read-only):**

1. Прочитать текущий `rules-retroapply/index.ts`, чтобы убедиться, что флаги payload корректны: `apply_categories=["reducible_by_rule"]`, `allow_reduce_access=true`, `reconcile_mode=admin_canonicalize_all`, отдельные флаги для revoke/soft-expire/manual/Telegram = false.
2. Прочитать недавние `audit_logs` за 2026-05-23/24 по action `rules_retroapply.executed` и `rules_retroapply.preview` для cohort B / BUSINESS (`tariff_id=7c748940-dcad-4c7c-a92e-76a2344622d3`) — выяснить, был ли уже выполнен destructive execute по 22 строкам.

**Step A — Preview (cohort B / BUSINESS, product-wide):**
Через `supabase--curl_edge_functions POST /rules-retroapply`:

- `mode=preview`, `reconcile_mode=admin_canonicalize_all`, `source_product_id=11c9f1b8-0355-4753-bd74-40b42aa53616` (а также отдельно `source_tariff_id=7c748940…`).
- Извлечь summary: `reducible_by_rule`, `no_source_window`, `already_satisfied`, `condition_not_met`, `conflict_existing`, `soft_expire_extra_access`, `revoke_extra_access`, `window_fallback_applied`, разбивка `window_resolved_from`.

**Step B — Execute (только если `reducible_by_rule > 0`):**

- `mode=execute`, `apply_categories=["reducible_by_rule"]`, `allow_reduce_access=true`, остальные destructive флаги = false, `reconcile_mode=admin_canonicalize_all`, super_admin JWT.
- Зафиксировать `targeted/updated/skipped/errors`, `batch_id`, `audit_log_id`.

**Step C — Post-verify:**

- Повторный preview с теми же параметрами: ожидаем `reducible_by_rule=0`.
- Для каждой из 22 затронутых строк прочитать `entitlements.meta` и подтвердить `previous_expires_at`, `reduction_reason="stage5_reducible_by_canonical_rule"`, `reduced_at`, `reduced_by_user_id`.
- Прочитать `audit_logs` запись об execute.
- Если `no_source_window` всё ещё > 0 — объяснить остаток (нет ни `rule.duration_days`, ни `sub.access_end_at`, ни `tariff.access_days`).

**Step D — Если `reducible_by_rule=0` уже на Step A:**

- Найти в `audit_logs` предыдущий execute, который их закрыл (batch_id, timestamp, actor, count).
- Подтвердить через выборку `entitlements`, что у них есть `meta.reduction_reason` и `previous_expires_at`.

**Step E — Обновить proof:**

- Дописать секцию `## Stage 6 Verify & Apply` в `.lovable/proofs/retroapply_stage_6_mobile_apply_and_extra_detector_2026_05.md` с итоговой таблицей:

  | category                    | before | after                  | action                           |
  | --------------------------- | ------ | ---------------------- | -------------------------------- |
  | reducible_by_rule           | N      | 0                      | execute / уже исправлено batch X |
  | no_source_window            | 7      | 0 (или K + объяснение) | window fallback                  |
  | already_satisfied           | …      | …                      | —                                |
  | condition_not_met           | …      | …                      | —                                |
  | conflict_existing           | …      | …                      | —                                |
  | extras (soft_expire+revoke) | …      | …                      | none                             |
  | window_fallback_applied     | —      | M                      | fallback (tariff.access_days)    |

- Приложить ссылки на `batch_id` и `audit_logs.id`.

### DoD

- Preview cohort B / BUSINESS показан с полной разбивкой counts + `window_fallback_applied`.
- По `reducible_by_rule` либо выполнен execute и показан targeted/updated/skipped/errors + post-verify=0, либо доказано предыдущее закрытие с batch/audit/timestamp.
- 22 строки имеют новый `expires_at` и `previous_expires_at` в meta (выборка показана).
- `no_source_window`: 0 либо остаток объяснён построчно.
- Destructive действия (revoke / soft-expire / manual override / Telegram) НЕ запускались — подтверждено payload-ом и audit.
- Никаких изменений в `orders_v2` / `subscriptions_v2` / `access_rules` / ручного DML.
- Proof обновлён, содержит итоговую таблицу `before/after/action`.

### Технические детали

- Все вызовы — через `supabase--curl_edge_functions` с super_admin JWT (для `admin_canonicalize_all`).
- Чтение audit/entitlements — через `supabase--read_query`.
- Никаких миграций, никаких изменений в edge function коде (Stage 5/6 код уже задеплоен) — только verify + apply через API.