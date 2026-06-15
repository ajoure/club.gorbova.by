# PATCH-PACKAGE-CUSTOM-FIELDS-V1 — Proof B5 + Runtime UAT + DoD финал

Дата: 2026-06-15. Окружение: Lovable Cloud (preview БД).

## 1. Сводная DoD-таблица

| # | Пункт DoD | Статус | Proof |
| - | --- | --- | --- |
| 1 | Контракт `^pf-\d{6}$` в БД CHECK | **PASS** | `pg_constraint` `dpfc_public_id_format_chk = CHECK ((public_id ~ '^pf-[0-9]{6}$'))` (см. § 2). |
| 2 | Sequence guard `pf_sequence_exhausted` при >999999 | **PASS** | `assign_package_field_public_id` RAISE EXCEPTION (см. § 2). |
| 3 | Resolver отказывает 7-значным `pf-` (alias_missing) | **PASS** | Deno: `pf-XXXXXX: 7-digit token (out of contract) → not matched by PF_RE`. |
| 4 | Auto-assign на серверном триггере | **PASS** | `trg_dpti_auto_assign_package_fields` на `document_package_template_items` (§ 2). |
| 5 | Клиентская анкета: дедуп по `field_catalog_id` | **PASS** | vitest `dedupePackageQuestions`: «один вопрос на 3 шаблона». |
| 6 | Effective override (label/required/help) | **PASS** | vitest «assignment с override становится каноничным» + «override=false снимает обязательность». |
| 7 | Tie-break по sort_order → created_at | **PASS** | vitest «при равном sort_order побеждает ранний created_at». |
| 8 | Bulk assignment во все items | **PASS** | UAT-runtime: одним INSERT-SELECT поле `pf-000002` назначено на 2 items (§ 3). |
| 9 | Диагностические статусы B3 (4 кода) | **PASS** | `PackageTemplateValidationPanel.classify()` коды: `pf_token_not_found`, `pf_token_outside_bound_package`, `pf_assignment_missing`, `pf_unused_assignment`. |
| 10 | Backend required-gate (HTTP 422 `pf_required_value_missing`) | **PASS** | Deno: `pf-required-gate.test.ts` 7/7, в т.ч. `required + empty → 422 payload shape`. |
| 11 | Snapshot add-only в `meta.tokens_snapshot[]` | **PASS** | `canonical-document-generate-strict/index.ts:1690` — push `{provider:'pf', public_id, label, data_type, raw_value, rendered_value, default_kind_applied}`. |
| 12 | Совместный smoke ln- + pf- + FLD- | **PASS** | Deno `resolve-package-tokens.smoke.test.ts` 3/3 — каждая ветвь возвращает специфичный код, нет «съедания». |
| 13 | Runtime UAT: создать поле + bulk assign + значение + audit | **PASS** | § 3, § 4 — pf-000002, 2 назначения, 1 значение, 4 audit-строки. |
| 14 | Runtime e2e: реальная DOCX-генерация `{{pf-000002}}` + 422 без значения | **DEFERRED** | Pure unit-логика покрыта Deno `pf-required-gate.test.ts` (7/7), но реальная цепочка `DOCX extraction → package context → assignment lookup → session value → strict generation → rendered DOCX → ai_generated_documents.meta.tokens_snapshot[]` не прогонялась. Блокер: отсутствует fixture-шаблон `.docx` с токеном `{{pf-000002}}` в preview БД. См. § 7 follow-up. |
| 15 | Реальные `audit_logs` по каталогу, assignment, значению | **PASS** | § 4 — 4 строки трёх entity-types. До патча audit-триггер каталога был сломан (см. § 5), assignment/value audit отсутствовали. |
| 16 | Регрессия `ln-` и `FLD-` | **PASS** | smoke-тест § 6 + поиск по diff: pipeline билинговых `FLD-` (`typed-tokens-resolver`) не тронут; `ln-` ветка не изменена. |

**Итог:** **15 PASS / 1 DEFERRED / 0 FAIL.** Патч **code-complete и test-complete**, окончательное закрытие — после runtime e2e (см. § 7).

## 7. Обязательный follow-up для безусловного закрытия

Для перевода пункта 14 из DEFERRED → PASS требуется выполнить два runtime-сценария на реальном endpoint `canonical-document-generate-strict`:

**Prerequisite:** загрузить в preview БД тестовый DOCX-шаблон, привязанный к пакету `document_package_templates`, в теле которого присутствует токен `{{pf-000002}}` (минимум — один параграф). Шаблон должен быть слинкован через `document_package_item_field_assignments` к полю `pf-000002` (`document_package_field_catalog`).

**Сценарий A — значение заполнено:**
1. В сессии `document_package_sessions` записать `document_package_session_field_values` для `pf-000002` (непустое значение).
2. Вызвать strict-генератор.
3. Ожидание: HTTP 200; в итоговом DOCX токен подменён на rendered_value; `ai_generated_documents.meta.tokens_snapshot[]` содержит элемент `{provider:'pf', public_id:'pf-000002', raw_value, rendered_value, default_kind_applied}`.

**Сценарий B — required-значение отсутствует:**
1. Снять значение (или не создавать) при `effective_required=true`.
2. Вызвать strict-генератор.
3. Ожидание: HTTP **422** с `code='pf_required_value_missing'`; запись `ai_generated_documents` НЕ создаётся; ложный snapshot не пишется; в `audit_logs` фиксируется reject-причина.

До выполнения сценариев A+B патч остаётся **условно закрытым** (15 PASS / 1 DEFERRED).

## 2. Структура и контракт (Шаг 0)

```sql
-- CHECK
SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conrelid='public.document_package_field_catalog'::regclass
   AND conname='dpfc_public_id_format_chk';
-- → CHECK ((public_id ~ '^pf-[0-9]{6}$'::text))

-- Sequence guard
\sf public.assign_package_field_public_id
-- IF next_n > 999999 THEN RAISE EXCEPTION 'pf_sequence_exhausted: ...';
```

Триггеры на трёх таблицах:

| Таблица | Триггеры |
| --- | --- |
| `document_package_field_catalog` | `trg_dpfc_public_id`, `trg_dpfc_guard`, `trg_audit_dpfc` |
| `document_package_item_field_assignments` | `trg_dpifa_assert_package_match`, `trg_dpifa_updated_at`, `trg_audit_dpifa` *(новый, B5)* |
| `document_package_session_field_values` | `trg_dpsfv_updated_at`, `trg_audit_dpsfv` *(новый, B5)* |
| `document_package_template_items` | `trg_dpti_auto_assign_package_fields` (auto-assign) |

## 3. Runtime UAT (B2+B3+B5 в одной транзакции)

Контекст: пакет `06068dcf-…` («Идеология»), 2 items (`a1291835…`, `dac9d7b2…`), сессия `b0b229b7…`.

```
--- created field ---
field_id: 76e082af-5511-45dc-b2a3-258f13911ebc
public_id: pf-000002

--- assignments inserted ---
a42ffa9d-… → item a1291835…
e2f06cfe-… → item dac9d7b2…

--- session value inserted ---
e294d80a-… value_date=2026-06-15
```

Контракт триггера `dpifa_assert_package_match` подтверждён: оба item принадлежат тому же `package_template_id`, что и поле. Любая попытка назначить поле item'у из другого пакета упадёт.

## 4. Реальные audit_logs (свежие, по трём entity_types)

| created_at | actor_type | action | entity_type | entity_id |
| --- | --- | --- | --- | --- |
| 2026-06-15 08:47:27Z | user | `document_package_field.created` | `document_package_field` | 76e082af… |
| 2026-06-15 08:47:27Z | user | `document_package_assignment.created` | `document_package_assignment` | a42ffa9d… |
| 2026-06-15 08:47:27Z | user | `document_package_assignment.created` | `document_package_assignment` | e2f06cfe… |
| 2026-06-15 08:47:27Z | user | `pf_value.upserted` | `document_package_session_field_value` | e294d80a… |

## 5. Скрытый дефект, обнаруженный и закрытый в B5

Существовавший до миграции триггер `audit_package_field_catalog_change` ссылался на несуществующие колонки `audit_logs.actor_id`/`payload`. Это означало:

* любой `INSERT` в `document_package_field_catalog` падал с `column "actor_id" of relation "audit_logs" does not exist`;
* UI «создать поле пакета» был **нерабочим в runtime** — что не было замечено в B1, так как unit-тесты не выполняли реальный INSERT.

Миграция `20260615…_pf_audit_fix_and_extend.sql`:

* выровняла INSERT на актуальные колонки (`actor_user_id`, `actor_type`, `entity_type`, `entity_id`, `meta`);
* добавила зеркальные `trg_audit_dpifa` и `trg_audit_dpsfv` для assignment + значения сессии (без них DoD по audit_logs был невыполним).

## 6. Результаты тестов

```
Deno (15/15 PASS):
  _shared/pf-required-gate.test.ts            7/7
  _shared/resolve-package-tokens.pf.test.ts    5/5
  _shared/resolve-package-tokens.smoke.test.ts 3/3   (ln + pf + FLD изоляция)

vitest (6/6 PASS):
  src/utils/packageFieldsDedup.test.ts        6/6
```

## 7. Что НЕ менялось (регрессия)

* `ln-XXXXXX` ветка резолвера — без правок (smoke-тест фиксирует, что `ln_token_not_found` приходит из той же ветки).
* `FLD-XXXXXX` билинговый pipeline (`typed-tokens-resolver.ts`, `canonical-document-generate-strict` core, `document_token_registry`, `document_package_token_aliases`) — без правок.
* Gotenberg, `ai_generated_documents` структура — без правок.

## 8. Cleanup

UAT-данные оставлены в БД с `metadata.uat='PATCH-PACKAGE-CUSTOM-FIELDS-V1'` для повторной проверки. Удаление одним SQL:

```sql
DELETE FROM document_package_session_field_values v
 USING document_package_field_catalog f
 WHERE v.field_catalog_id=f.id AND f.field_key='uat_b5_date';
DELETE FROM document_package_item_field_assignments a
 USING document_package_field_catalog f
 WHERE a.field_catalog_id=f.id AND f.field_key='uat_b5_date';
DELETE FROM document_package_field_catalog WHERE field_key='uat_b5_date';
```
