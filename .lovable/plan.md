## Да, согласен, с учетом правок:

```text
Дополнить C5-G перед execute:

1. UNIQUE по idempotency_key
- Проверить, есть ли уже unique index на `ai_generated_documents.idempotency_key`.
- Если нет — добавить partial unique index:
  `unique (idempotency_key) where idempotency_key is not null`.
- Это обязательно, иначе retry/двойной клик теоретически может создать два документа до reuse-проверки.

2. Тестовая дата для проверки `1005/1`
- Не менять системное время.
- Для тестов добавить внутренний параметр RPC:
  `allocate_document_number(p_document_id uuid, p_now timestamptz default null)`.
- В production используется `coalesce(p_now, now())`.
- Вызов с `p_now` разрешить только service_role / тестовому контексту, не из UI.
- Это нужно для proof `09.05 → 0905/N`, `10.05 → 1005/1`.

3. Concurrency test
- Не полагаться на `pg_background`, если расширение недоступно в Supabase.
- Основной proof делать через edge/script: 10 параллельных вызовов RPC/генерации.
- В SQL-proof оставить только проверку результата:
  - count=10
  - count(distinct document_number)=10
  - min/max seq = 1/10
  - last_seq=10
  - no gaps через `generate_series`.

4. Проверить имена колонок audit_logs
- В проекте встречались `meta` и `metadata`.
- Перед миграцией сделать discovery schema `audit_logs`.
- Использовать фактическую колонку, чтобы миграция не упала.
- Для system actor обязательно:
  `actor_type='system'`,
  `actor_user_id=NULL`,
  `actor_label='document_numbering_v2'`.

5. Immutability trigger
- Trigger должен блокировать не только изменение, но и очистку:
  `document_number -> NULL`, `document_date -> NULL`, `document_seq -> NULL`.
- Первичное заполнение разрешено только если OLD.* IS NULL.
- Override только через `SET LOCAL app.allow_document_number_override='1'`.

6. Генерация документа
- Порядок строго такой:
  1) найти existing по `idempotency_key`;
  2) если existing есть и номер есть → вернуть existing;
  3) если existing есть без номера → вызвать `allocate_document_number(existing.id)`;
  4) если existing нет → создать row `ai_generated_documents` с `idempotency_key`;
  5) вызвать `allocate_document_number(new.id)`;
  6) только после этого render DOCX.
- Если render/upload после выдачи номера упал — номер не откатывать. Документ остаётся с ошибочным статусом/логом, номер считается занятым. Это нормально для неизменяемой нумерации.

7. Single-number per document
- В `source_trace` явно показать:
  `document.number` / `FLD-000069` source=`system_generated`, value=`0905/1`.
- Если `FLD-000069` встречается 3 раза — counter увеличивается только на 1.

8. Каталог плейсхолдеров
- После архивации legacy в основной таблице активными должны остаться только:
  - `document.number`
  - `document.date`
- Legacy act/contract/invoice/date_short не показывать в обычном режиме.
- В техническом режиме показать archived + alias badge.

9. Поиск
- Поиск `0905` должен искать prefix:
  `document_number ILIKE '0905/%'` или `ILIKE '0905%'`.
- Поиск `0905/1` — exact/normalized.
- Не использовать `orders_v2.meta.document_numbers` как обязательный источник.

10. Proof
- В proof отдельно зафиксировать:
  - `preview` не вызывает `allocate_document_number`;
  - `validate` не вызывает `allocate_document_number`;
  - `download original / draft / template markup` не вызывают `allocate_document_number`;
  - только `generate` создаёт номер.
```

После этих уточнений план можно отдавать в execute.

&nbsp;

C5-G — Единая нумерация документов (финальная версия с дополнениями)

Цель: единая модель `**document.number**` + `**document.date**`, формат строго `**DDMM/N**` (без точек/тире/дефисов), дневной счётчик по `Europe/Minsk`, сброс в 00:00 Минска. Номер выдаётся **один раз на документ**, сохраняется в `ai_generated_documents` навсегда и **immutable**. Совместимость со старой нумерацией не делаем — реальной эксплуатации не было.

### Dry-run (фактические данные)

- `ai_generated_documents`: 1 строка (тестовый документ от 2026-05-08), без `document_number`.
- Шаблонов с legacy number/date FLDs (FLD-000071/182/183/184/185): 1 версия, `is_current=false`. Активных боевых — **0**.
- Clean-slate безопасен. FLD-remap не нужен.

---

### 1. Канонические поля (уже существуют)

- `document.number` — text, FLD-000069, label «Номер документа».
- `document.date` — date, FLD-000070, label «Дата документа». Прописью — `|format=words` → `09 мая 2026 года`.

### 2. Архивация legacy (idempotent, whitelist)

`archived_at=now()`, `archive_reason='replaced_by_document_numbering_v2'`, только active:
`document.act_number`, `document.act_date`, `document.contract_number`, `document.contract_date`, `document.date_short`.

Token_key aliases (`document.act_number → document.number` и т.п.) — добавим в `document_token_aliases` для отображения в каталоге. Никакого FLD-remap в runtime.

### 3. Таблица счётчиков

```text
public.document_number_counters
  id uuid pk default gen_random_uuid()
  document_date date not null
  document_timezone text not null default 'Europe/Minsk'
  last_seq integer not null default 0
  created_at timestamptz default now()
  updated_at timestamptz default now()
  unique (document_date, document_timezone)
```

RLS: enabled, deny-all для anon/authenticated. Запись только через SECURITY DEFINER RPC.

### 4. Поля в `ai_generated_documents`

Новые столбцы:

- `document_number text`
- `document_date date`
- `document_seq integer`
- `document_timezone text default 'Europe/Minsk'`
- `document_number_assigned_at timestamptz`

Индексы:

- `unique (document_number)`
- `unique (document_timezone, document_date, document_seq)`
- `index (context_type, context_id, document_number)`

### 5. RPC `allocate_document_number(p_document_id uuid)` — concurrency-safe

`SECURITY DEFINER`, returns `(document_number, document_date, document_seq, document_timezone)`. Одна транзакция:

1. `SELECT ... FOR UPDATE` строки `ai_generated_documents WHERE id=p_document_id`. Если уже есть `document_number` → вернуть существующий (idempotent retry).
2. `today := (now() AT TIME ZONE 'Europe/Minsk')::date`.
3. Атомарный upsert:
  ```sql
   INSERT INTO document_number_counters(document_date, document_timezone, last_seq)
   VALUES (today, 'Europe/Minsk', 1)
   ON CONFLICT (document_date, document_timezone)
   DO UPDATE SET last_seq = document_number_counters.last_seq + 1, updated_at = now()
   RETURNING last_seq
  ```
4. `number := to_char(today, 'DDMM') || '/' || seq::text` (строго `DDMM/N`).
5. UPDATE `ai_generated_documents` (заполнение нулевых полей; immutable trigger пропускает первое заполнение, см. §6).
6. INSERT в `audit_logs`: `action='document_number.assigned'`, `actor_type='system'`, `actor_label='document_numbering_v2'`, meta={document_id, context_type, context_id, order_id, template_id, template_version_id, document_number, document_date, document_seq, timezone='Europe/Minsk'}.

### 6. Immutability guard (DB-level)

BEFORE UPDATE trigger на `ai_generated_documents`:

```text
IF OLD.document_number IS NOT NULL AND NEW.document_number IS DISTINCT FROM OLD.document_number THEN RAISE 'document_number_is_immutable';
IF OLD.document_date   IS NOT NULL AND NEW.document_date   IS DISTINCT FROM OLD.document_date   THEN RAISE 'document_number_is_immutable';
IF OLD.document_seq    IS NOT NULL AND NEW.document_seq    IS DISTINCT FROM OLD.document_seq    THEN RAISE 'document_number_is_immutable';
```

Bypass — только через отдельную SECURITY DEFINER RPC `admin_override_document_number(p_document_id, p_new_number, p_reason)`:

- доступна только super_admin (в RPC проверка `has_role_v2`);
- внутри устанавливает `SET LOCAL app.allow_document_number_override='1'`, trigger пропускает изменение, если эта setting='1';
- обязательно пишет audit `document_number.override` с `actor_type='user'`, `actor_user_id=auth.uid()`, meta включая `old`, `new`, `reason`.

### 7. Точка вызова

Только `canonical-document-generate-strict` (mode=`generate`), **до** DOCX render. Никогда из preview/validate/draft/template-save/markup-save/source-download.

### 8. **Один номер на документ** (резерв на уровне факта генерации, не плейсхолдера)

В `canonical-document-generate-strict` (mode=`generate`):

```ts
// 1. Idempotency: если документ с таким idempotency_key уже есть → reuse
const existing = await findByIdempotencyKey(key);
if (existing?.document_number) return existing;

// 2. Создание/получение ai_generated_documents row
const docId = existing?.id ?? await createDoc(...);

// 3. ОДИН вызов allocate_document_number на документ
const allocated = await rpc.allocate_document_number(docId);  // вне resolver

// 4. Запись в snapshot ОДИН раз
resolvedTokens['FLD-000069'] = { value: allocated.document_number, source: 'system_generated' };
resolvedTokens['FLD-000070'] = { value: allocated.document_date,   source: 'system_generated' };

// 5. Render — Docxtemplater подставит одно значение во все вхождения
```

**Запрещено:**

```ts
// НЕЛЬЗЯ:
resolvePlaceholder('document.number') { return rpc.allocate_document_number(); }
```

В `_shared/document-render.ts` — никаких вызовов RPC. Resolver только читает уже-заполненный snapshot. Если в DOCX `{{field:FLD-000069}}` встречается N раз — все N вхождений получают одно значение.

Idempotency:

- request содержит `idempotency_key` (per-click UUID из UI);
- UI: button `disabled` на время mutation;
- технический retry → reuse документа и его номера.

### 9. Поиск сделок по номеру документа

Расширить `useDealsSearch` / `search_deals` RPC:

```sql
OR EXISTS (
  SELECT 1 FROM ai_generated_documents d
  WHERE d.context_type IN ('order','deal')
    AND d.context_id   = orders_v2.id
    AND d.document_number = :q
)
OR EXISTS (
  SELECT 1 FROM ai_generated_documents d
  WHERE d.context_type IN ('order','deal')
    AND d.context_id   = orders_v2.id
    AND d.document_number ILIKE :q || '%'   -- частичный ввод '0905' → все за 09.05
)
```

Запрос нормализуется (trim, без пробелов). В строке результата бейдж: `Документ № 0905/1`. SOT — только `ai_generated_documents.document_number`. `orders_v2.meta.document_numbers` как mirror/cache — опционально, не primary.

### 10. UI

`**PlaceholdersCatalogTab.tsx`:**

- Группа «Документ» = ровно 2 active токена (data-driven).
- Archived legacy — только под тогглом «Технические данные», бейдж «archived (replaced_by_document_numbering_v2)».

`**DealDocumentsPanel**` (история документов сделки):

- Колонки: `№ документа` (крупно), `Дата документа`, `Шаблон`, `Версия`, `Создан`, `Скачать`.
- Если `document_number IS NULL` → показывать `—`.
- Кнопка copy рядом с номером.
- Сортировка `created_at DESC`.
- После generate список инвалидируется и номер виден сразу.

**Новая admin-страница `/admin/documents/numbering**` (`Нумерация документов`, RBAC: admin/super_admin):

- Read-only таблица: `№ документа`, `Дата документа`, `seq`, `timezone`, `Шаблон`, `Версия`, `Сделка/заказ`, `Клиент`, `Кто/что создал`, `created_at`, `document_id`, кнопки «Открыть документ» / «Открыть сделку».
- Фильтры: дата документа, номер документа, клиент, шаблон, сделка/order, диапазон дат, тоггл «только сегодняшние».
- Никакого редактирования номеров из UI.

### 11. Что НЕ трогается

- Формат placeholder `{{field:FLD-XXXXXX}}`.
- Формат номера — строго `DDMM/N`. Не возвращать act/invoice/contract отдельные номера. Не делать сквозную годовую нумерацию.
- `fields_registry`, `document-data-snapshot.ts`, `tariff_offers.meta.document_defaults`.
- Email/Telegram delivery, batch generation, auto-generation triggers.
- Legacy `generated_documents` (Sprint 10).

### 12. DoD (consolidated)

1. Dry-run: 0 продакшн-шаблонов с legacy number/date FLD.
2. Каталог группа «Документ» — 2 active токена.
3. Legacy токены архивированы с правильным `archive_reason`.
4. Первый generate 09.05 → `0905/1`; второй → `0905/2`; первый 10.05 → `1005/1`.
5. Preview/validate **не** меняет `last_seq`.
6. Idempotency: повтор generate с тем же `idempotency_key` → тот же номер.
7. **Single-number per document:** в шаблоне 3× `{{field:FLD-000069}}` → все 3 вхождения = `0905/1`; counter +1.
8. **Concurrency test:** 10 параллельных `allocate_document_number` за один день → строго `0905/1..0905/10`, без дублей и пропусков, `last_seq=10`, `unique(document_number)` не нарушается.
9. **Immutability:** прямой UPDATE `document_number/date/seq` падает с `document_number_is_immutable`. RPC `admin_override_document_number` работает только для super_admin и пишет audit `document_number.override`.
10. Поиск `0905/1` находит сделку; `0905` находит все документы за 09.05; обычный поиск (клиент/email/order_number) не сломан.
11. `audit_logs.document_number.assigned` для каждого нового номера, system actor, со всеми meta.
12. `DealDocumentsPanel`: после generate номер виден, копируется, скачивается, версия видна.
13. Admin-страница `/admin/documents/numbering` доступна только admin/super_admin, read-only, фильтры работают.
14. Email/Telegram/batch/auto-generation код не изменён.

### 13. Proof

`.lovable/proofs/document_generation_sprint11_c5g_document_numbering.md` — разделы:

1. **Dry-run** — usage старой нумерации = 0.
2. **Schema** — DDL counters + новые колонки + индексы + immutability trigger.
3. **Sequential allocation** — `0905/1`, `0905/2`, синтетический сдвиг даты → `1005/1`.
4. **Preview no-op** — counter не изменился после preview.
5. **Idempotency** — повтор с тем же ключом → тот же номер.
6. **Single-number per document** — 3× плейсхолдер → одно значение во всех вхождениях; counter +1.
7. **Concurrent allocation test** — 10 параллельных вызовов (DO-block с `pg_background`/edge test script): результат `0905/1..0905/10`, нет дублей, `last_seq=10`.
8. **Immutable number guard** — UPDATE падает; admin_override работает + audit.
9. **Documents numbering audit UI** — список полей страницы, RBAC.
10. **Deal documents panel** — скрин/HTML с номером в истории.
11. **Search by document number** — `0905/1` → сделка, `0905` → список, обычный поиск работает.
12. **Audit logs** — примеры `document_number.assigned` и `document_number.override`.
13. **Untouched** — git-diff список изменённых файлов; email/TG/batch/auto-generate не тронуты.

---

### Технические детали (для разработчика)

**Изменяемые файлы:**

- `supabase/migrations/<ts>_c5g_document_numbering.sql` — counters + столбцы + индексы + immutability trigger + RPC `allocate_document_number` + RPC `admin_override_document_number` + RLS deny-all + архивация 5 токенов + token_key aliases.
- `supabase/functions/canonical-document-generate-strict/index.ts` — single-call RPC до render, idempotency_key reuse.
- `supabase/functions/_shared/document-render.ts` — read-only из snapshot, **никаких** RPC вызовов в resolver.
- `src/components/ai-documents/PlaceholdersCatalogTab.tsx` — текстовка/бейджи (data-driven).
- `src/components/ai-documents/DealDocumentsPanel.tsx` — колонка «№ документа», copy.
- `src/hooks/useAiDocuments.ts` — типы новых полей.
- `src/pages/admin/AdminDocumentsNumbering.tsx` (новый) + роут в admin.
- `src/components/admin/AdminDocumentsNumberingTable.tsx` (новый).
- Расширение поиска Deals (`useDealsSearch` или `search_deals` RPC).

**Не изменяемые:** `fields_registry`, формат placeholder, email/TG/batch/auto-generate, legacy `generated_documents`.