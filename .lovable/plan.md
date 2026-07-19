## да, согласен, с учетом правок:

1. В §2 исправить формулировку:

```text
Прямые записи присутствуют строго в семи фрагментах §11:
шесть public RPC и один private helper.

```

Сейчас ошибочно указано «в шести местах», хотя перечислено семь.

2. Не вводить новый `event_type`:

```text
company.linked_to_contact.updated.v1

```

Матрица §8 остаётся неизменной. Для создания связи и её материального обновления используется один тип:

```text
company.linked_to_contact.v1

```

Различаются только:

- `payload.update=true` для материального обновления;
- формат `idempotency_key`;
- состав payload.

Иначе патч незаметно изменит утверждённую event matrix, хотя §6 плана прямо запрещает это.

3. В нормативном перечне event types оставить:

```text
company.created.v1
company.linked_to_contact.v1
company.upserted_from_billing.v1
company.merged.v1
company.archived.v1
company.grp_refetch_requested.v1

```

Это шесть типов событий при семи местах вызова helper: два вызова относятся к `company.linked_to_contact.v1`.

4. Уточнить первый self-check: `rg` может найти описательные упоминания строки в §8 и §10.1. Критерий приёмки должен проверять не общее число hits, а отсутствие прямых inserts именно внутри SQL-блоков §11.2–§11.9, кроме тела самого emit-helper в §11.11.
5. Заголовок итогового отчёта должен быть дословно:

```text
Отчет о выполненной работе: CRM Companies — Phase 2 финализация event writers через _crm_company_emit_domain_event

```

Не использовать заголовок `Отчёт о выполнении`.

6. В конец плана добавить дословно:

```text
План должен быть составлен на русском языке.
Отчет о выполненной работе должен быть составлен на русском языке.
Вся переписка, все пояснения и все результаты должны предоставляться только на русском языке.

```

```text
Docs-only patch: APPROVED
Разрешённый файл: companies_phase2_runnable_plan.md
Phase 2 production execution: NOT APPROVED
БД и миграции: НЕ ИЗМЕНЯТЬ
Admin fixture blocker: СОХРАНИТЬ

```

&nbsp;

&nbsp;

## План: Phase 2 runnable plan — финализация §11 через `_crm_company_emit_domain_event`

**Статус:** `PLAN ONLY / DOCS ONLY / DO NOT EXECUTE`.
**Scope файлов:** ровно один файл — `.lovable/discovery/companies-1.0/companies_phase2_runnable_plan.md`.
**НЕ трогать:** БД, миграции, `supabase/`, `src/`, `.lovable/plan.md`, ADR-0002, отчёты Phase 1.
**Execution:** Phase 2 остаётся `NOT APPROVED`. Blocker `admin fixture required` сохранён.

### 1. Цель патча (единственный остаток проверки)

Закрыть частично внесённый остаток №1: убрать из §11 все прямые `INSERT INTO public.domain_events (...)` и выражения `ON CONFLICT ((payload->>'idempotency_key')) DO NOTHING`, заменив их на `PERFORM public._crm_company_emit_domain_event(...)` согласно нормативному контракту §10.1. После патча §11 становится финальным runnable SQL, без формулировки «при финализации SQL заменяются».

### 2. Точный перечень мест замены (по фактическим строкам файла)

Проверено `rg` по документу. Прямые записи в `domain_events` присутствуют строго в шести местах §11:

1. §11.2 `_crm_company_resolve_or_create_internal` — строки ~766–785 (`company.created.v1`, INSERT + WHERE NOT EXISTS-guard).
2. §11.4 `crm_company_link_contact` — строки ~943–952 (`company.linked_to_contact.v1`, INSERT + WHERE NOT EXISTS).
3. §11.4 `crm_company_link_contact` — строки ~954–961 (`company.linked_to_contact.updated.v1`, INSERT + `ON CONFLICT ((payload->>'idempotency_key'))`).
4. §11.5 `crm_company_upsert_from_billing` — строки ~1058–1067 (`company.upserted_from_billing.v1`, INSERT + `ON CONFLICT`).
5. §11.6 `crm_company_merge` — строки ~1217–1225 (`company.merged.v1`, INSERT + `ON CONFLICT`).
6. §11.7 `crm_company_archive` — строки ~1285–1289 (`company.archived.v1`, INSERT + `ON CONFLICT`).
7. §11.9 `crm_company_grp_refetch` — строки ~1344–1348 (`company.grp_refetch_requested.v1`, INSERT + `ON CONFLICT`).

Итого семь фрагментов (шесть RPC + один private helper). Все остальные упоминания `domain_events` в §8, §10.1, §11.11 — описательные/контрактные и остаются без изменений.

### 3. Нормативный шаблон замены

Каждый фрагмент вида

```sql
INSERT INTO public.domain_events (event_type, source, entity_id, payload)
VALUES ('company.<op>.v1', 'crm', <entity_id>,
  jsonb_build_object('version',1, ..., 'idempotency_key','company.<op>:<...>'))
ON CONFLICT ((payload->>'idempotency_key')) DO NOTHING;
```

или эквивалент с `WHERE NOT EXISTS`, заменяется на:

```sql
PERFORM public._crm_company_emit_domain_event(
  'company.<op>.v1',
  <entity_id>,
  'company.<op>:<...>',
  jsonb_build_object(
    'version', 1,
    'idempotency_key', 'company.<op>:<...>',
    -- остальные обязательные поля payload из §8 (occurred_at, actor_user_id и т.д.)
    ...
  )
);
```

Правила:

- `_idempotency_key` (3-й аргумент) и `payload->>'idempotency_key'` должны совпадать байт-в-байт — иначе helper падает `emit: payload/key mismatch` (§10.1 шаг 1).
- `payload.version` строго `1` (integer 1, не строка).
- `event_type` строго из матрицы §8 (`company.created.v1` / `company.linked_to_contact.v1` / `company.linked_to_contact.updated.v1` / `company.upserted_from_billing.v1` / `company.merged.v1` / `company.archived.v1` / `company.grp_refetch_requested.v1`).
- `source` внутри helper прибит гвоздями к `'crm'` — параметра нет; убрать из вызывающих inserts любые `source`-поля payload, если они дублировали это значение.
- Возврат helper (`uuid` либо `NULL`) не проверяется вызывающим RPC — подавление дубля не считается ошибкой (§10.1 шаг 3).

Записи в `crm_activity_log` и `audit_logs` остаются как есть — они не проходят через `_crm_company_emit_domain_event` и уже guarded через `WHERE NOT EXISTS` по своим ключам (§8, §11.4–§11.7).

### 4. Дополнительные редакционные правки в том же файле

- §10.1, последний абзац: удалить формулировку «sample-фрагменты в §11.2–§11.9, где остался „сырой“ INSERT … при финализации SQL заменяются на вызов helper — контракт §10.1 является нормативным». Заменить на: «Все Phase 2 RPC в §11 вызывают helper напрямую; прямых `INSERT INTO public.domain_events` в §11 не осталось.»
- §8, комментарий про «Прямых `INSERT INTO public.domain_events` из тел Phase 2 RPC нет — весь трафик идёт через helper» — оставить без изменений (после патча становится фактом, а не декларацией).
- Историческое упоминание ранее предполагавшегося уникального индекса `domain_events_company_idem_uniq` в §10.1 (rationale) — оставить, оно допустимо.

### 5. Post-edit self-check (без запуска SQL)

Выполнить локально `rg` по обновлённому файлу и убедиться:

```bash
rg -n "INSERT INTO public\.domain_events" .lovable/discovery/companies-1.0/companies_phase2_runnable_plan.md
# Ожидается: единственный hit в §10.1 (тело helper, строка ~615) и, возможно, в §8 (описательный текст). В §11.2–§11.9 — 0 hits.

rg -n "ON CONFLICT \(\(payload->>'idempotency_key'\)\)" .lovable/discovery/companies-1.0/companies_phase2_runnable_plan.md
# Ожидается: 0 hits.

rg -n "_crm_company_emit_domain_event\(" .lovable/discovery/companies-1.0/companies_phase2_runnable_plan.md
# Ожидается: минимум 7 hits в §11 (по одному на каждое место замены из §2 этого плана) + вхождения в §10.1/§8/§11.11.
```

Если любой из первых двух grep-ов возвращает hit внутри §11.2–§11.9 — патч не завершён.

### 6. Инварианты, которые патч НЕ меняет

- Матрица событий §8 (7 event_type, формат `idempotency_key`, обязательные поля payload).
- Security matrix §9: 7 public RPC + 2 private helper, ACL для `_crm_company_emit_domain_event` (REVOKE ALL от PUBLIC/anon/authenticated/service_role, без GRANT).
- Rollback §12: порядок `DROP` двух helper после public RPC.
- Post-apply invariants §11.12/§13.5: helper существует, `SECURITY DEFINER`, отсутствие Phase 2 индексов на `domain_events`.
- Baseline schema hash `c41160b83c8e15c3d3c41a13028700d5`.
- ADR-0002: без изменений.

### 7. Deliverable отчёта

После применения (в build mode) отчёт «Отчёт о выполнении» на русском, содержащий:

- фактический diff-summary по 7 фрагментам §11;
- вывод трёх `rg`-команд из §5 этого плана как машинное доказательство;
- подтверждение отсутствия изменений в БД, миграциях, `src/`, ADR-0002 и `.lovable/plan.md`;
- статус: Phase 2 runnable plan — READY for review; execution по-прежнему NOT APPROVED.