План: PATCH-PACKAGE-CUSTOM-FIELDS-V1 — закрытие Phase 2 и DoD

Принимаю замечания. Текущий проход = Phase 1 proof + B1 checkpoint. Ниже — порядок добивания до полного DoD без замены ранее согласованных пунктов.

## Шаг 0. Контракт `pf-XXXXXX` (regex + sequence) — блокер

Канон: ровно шесть цифр, `^pf-\d{6}$`. Это уже стоит в resolver и UI, но БД-CHECK сейчас `^pf-[0-9]{6,}$` (≥6). Привести БД к ровно 6.

- Миграция:
  - `ALTER TABLE document_package_field_catalog DROP CONSTRAINT … (текущий CHECK на public_id)` и пересоздать как `CHECK (public_id ~ '^pf-\\d{6}$')`.
  - Предварительно: `SELECT public_id FROM document_package_field_catalog WHERE public_id !~ '^pf-\\d{6}$'`. Если строки есть — миграция фейлится с явной ошибкой (без авто-переименования; данные ценные).
  - Перепроверить генератор `next_public_id('pf')` / соответствующий sequence: при достижении `pf-999999` функция должна возвращать `pf_sequence_exhausted` (RAISE EXCEPTION), а не молча выдавать 7 цифр. Если в текущей реализации нет проверки — добавить guard в SQL-функцию выдачи `public_id`.
  - Аналогично проверить и при необходимости ужать CHECK на `document_package_role_catalog.public_id` до канона `^ln-\\d{6}$` (если там также `{6,}`) — без правок контракта, только align.
- Resolver: оставить `PF_RE = /^pf-\d{6}$/` как есть; добавить отдельный unit «`pf-1234567` → не матчится → `alias_missing`», чтобы зафиксировать симметрию с БД.

Proof Step 0: запрос `pg_constraint` (новый regdef), unit-тест resolver на 7-значный id, ручной SQL-вызов sequence в граничной точке (имитация через временную установку счётчика недопустима в проде — поэтому только unit-тест функции на in-memory счётчике + код-review guard).

## Шаг B2. Клиентская анкета (дедуп + типы + RPC)

Файлы:
- `src/components/ai-documents/packages/ClientPackageQuestionnaire.tsx` (или существующий компонент клиентской анкеты пакета — сначала найти, не дублировать).
- Новые контролы по типам в `src/components/ai-documents/packages/fields/` (text/number/date/datetime/time/year/select/multiselect/checkbox).

Логика:
- Источник вопросов = `document_package_item_field_assignments` с `visibility_mode = 'ask_client'` по всем шаблонам сессии.
- Дедуп по `field_catalog_id`: вопрос рендерится один раз, даже если назначен в N документах. Метаданные (label/help/required) — эффективные: override берётся из «канонического» assignment приоритетом (a) наличие override, (b) минимальный `sort_order`, (c) самый ранний `created_at`. Эта политика фиксируется в memory.
- Предзаполнение `smart-date` через существующий `src/lib/packageFields/smartDate.ts`.
- Сохранение — батчем через RPC `upsert_session_field_values(_session_id, _values jsonb)` (создан в Phase 1). Серверная типовая валидация уже есть; на клиенте — мягкая валидация перед отправкой + показ ошибок типа из RPC (`pf_value_type_mismatch`).
- Прогресс «N из M required заполнено».

## Шаг B3. Сверка `pf-` в DOCX и панель валидации

- Расширить `PackageTemplateValidationPanel` (или эквивалент в `DocumentPackageQuestionnairesView`) блоком «Поля пакета»:
  - На каждый item: вытащить `pf-XXXXXX` через `extractDocxPlaceholders` из последнего `document_template_versions.file`.
  - Сопоставить с `document_package_item_field_assignments` и `document_package_field_catalog`.
  - Категории: `ok`, `pf_token_not_found` (нет в каталоге), `pf_token_outside_bound_package` (поле другого пакета), `pf_assignment_missing` (есть в каталоге, но не назначено на этот item), `pf_unused_assignment` (назначено, но в DOCX нет).
  - CTA: «Назначить во все», «Создать поле», «Снять назначение».

## Шаг B4. Backend required-gate + snapshot

- В `supabase/functions/canonical-document-generate-strict/index.ts` (только обвязка, ядро не трогаем):
  - Перед рендером — precheck по `effective_required` с учётом значений сессии и `default_kind`/`generation_date`. Если есть unresolved required без вычислимого default → HTTP 422 `pf_required_value_missing` со списком `{ document_template_id, public_id, label }[]`.
  - После успешного рендера — add-only запись в `ai_generated_documents.meta.tokens_snapshot[]` элементов: `{ provider:'pf', public_id, label, data_type, raw_value, rendered_value, default_kind_applied }`. Не создавать `meta.tokens_snapshot.pf`.

## Шаг B5. Тесты и регрессия

- Resolver Deno: добавить тест «ln + pf + FLD в одном шаблоне» — все три ветви срабатывают изолированно; soft-empty для не-required.
- UI vitest: дедуп клиентской анкеты, override-приоритет, типы значений.
- Регрессия: existing `ln-` сценарии не меняются; `FLD-` billing pipeline не затронут.

## Шаг UAT (runtime) + audit proof

- Сценарий в `/admin/documents`:
  1) создать поле `pf-XXXXXX` (date, required, default `last_day_of_month`),
  2) bulk «во все шаблоны»,
  3) открыть клиентскую анкету сессии — поле один раз, prefill виден,
  4) сохранить — `audit_logs` запись `pf_value_upserted`,
  5) сгенерировать DOCX — pf-токены подставлены, snapshot записан,
  6) попытка сгенерировать без значения required без default → 422.
- Собрать в `.lovable/proofs/package_custom_fields_2026-06-14.md`:
  - SQL-выписки нового CHECK,
  - 20 свежих строк `audit_logs` по трём entity types,
  - результаты resolver-тестов,
  - HTTP-лог 422 от generate-strict,
  - скрин/описание UI факта (без скриншотов из агента — фиксируем шагами и SQL).

## Память и DoD

- Обновить `mem://architecture/documents/package-custom-fields-v1`:
  - канон `^pf-\d{6}$` + поведение sequence на исчерпании,
  - политика выбора «канонического» assignment при дедупе клиентской анкеты,
  - snapshot — только массив `tokens_snapshot[]` с `provider:'pf'`.
- DoD считается выполненным только после Шага UAT + audit proof.

## Что НЕ трогаем

`ln-` namespace и `document_package_item_role_assignments`; billing `FLD-` / `fields_registry` / `document_token_registry` / `document_package_token_aliases`; Gotenberg; ядро `canonical-document-generate-strict` (только precheck + snapshot-обвязка); структура `ai_generated_documents` (только add-only ключ массива).

## Порядок исполнения

Строго последовательно: Шаг 0 (миграция + resolver unit) → B2 → B3 → B4 → B5 → UAT + audit proof. Между шагами — короткий отчёт фактом, без «выполнено в целом».

Подтверди план — начну с Шага 0 (миграция CHECK + sequence guard + resolver-тест на 7 цифр).
