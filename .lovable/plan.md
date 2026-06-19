Ответ для Lovable:

да, согласен, с учетом правок:

1. План можно выполнять как **Stage D.1 — UI grouping + read-only stale/missing indicators**.
  &nbsp;
  Важно: это не закрывает selective regeneration и не закрывает полноценный cleanup. Это только:
  - группировка per-recipient результатов;
  - read-only индикация stale/missing/mode_changed;
  - честная кнопка/переход «Сформировать пакет заново» без обещания точечной регенерации.
2. В Discovery дополнительно проверить фактическое поле item id в `ai_generated_documents`.
  &nbsp;
  В разных местах ранее использовались названия:
  - `package_template_item_id`;
  - `source_package_template_item_id`;
  - `meta.source_package_template_item_id`.
  В D.1 нельзя завязаться на несуществующее поле. Нужно в proof явно указать, какое поле реально используется для группировки item-а.
  Приоритет:
3. Latest batch определять не только по `max(created_at)` отдельного документа, а по batch-группе.
  &nbsp;
  Правильно:
  ```text
  сгруппировать документы по generation_batch_id
  определить batch created_at = max(created_at) или batch-level timestamp, если он есть
  latest batch = batch с самым поздним batch created_at
  ```
  Не выбирать отдельную строку и не смешивать batch.
4. В истории batch-группы должны быть разделены явно.
  &nbsp;
  Заголовок batch:
  ```text
  Batch <short id> · дата/время · generated/errors/blocked
  ```
  Внутри batch — группы по item.
5. Для per-role group сортировка:
  &nbsp;
  ```text
  recipient_index ASC NULLS LAST
  created_at ASC
  id ASC
  ```
  `id` нужен как последний tie-breaker, чтобы порядок не прыгал.
6. В fallback ФИО получателя добавить поддержку фактической структуры `recipient_snapshot`.
  &nbsp;
  Использовать порядок:
7. Для кнопки «Скачать» у failed/error recipient уточнить условие:
  - если файл/URL есть — кнопку показывать;
  - если файла нет — показывать disabled state `Файл не создан`.
  Не должно быть клика на несуществующий файл.
8. В `PackageDocumentCard` индикатор `N/M получателей` показывать только для item с текущим:
  &nbsp;
  ```text
  generation_mode = 'per_role_person'
  repeat_role_catalog_id IS NOT NULL
  ```
  Для single item не добавлять новый шум.
9. Stale/missing считать только для latest successful batch.
  &nbsp;
  Если latest batch failed/blocked, отдельно показывать:
  ```text
  Последний успешный batch: N/M
  Последний запуск: blocked/error
  ```
  Stale/missing не считать по failed batch как по нормальному результату.
10. Для active assignments в `useRepeatableDocumentStaleness` обязательно учитывать дедуп по `person_id`, как в Stage B resolver.

Если в активных assignments случайно две строки на одного person, UI не должен считать это двумя разными missing, если resolver берёт первую. Нужно либо:

- использовать тот же порядок/дедуп, что resolver;
- либо явно показать warning `duplicate active assignment`.

11. `useRepeatableDocumentStaleness` должен быть read-only.

В proof добавить `rg`/кодовое подтверждение, что hook не вызывает:

- `update`;
- `insert`;
- `delete`;
- edge function;
- RPC write-path.

12. Кнопка «Сформировать пакет заново» не должна называться «синхронизировать» или «досоздать недостающие».

Допустимый текст:

```text
Сформировать пакет заново
```

Tooltip:

```text
Создаст новый batch со всеми документами пакета. Точечная регенерация недостающих будет отдельным Stage E.
```

13. В proof stale/missing сценарии выполнять только безопасно.

Допустимые варианты:

- тестовая сессия;
- SQL transaction + ROLLBACK;
- UI-изменение с последующим восстановлением.

После сценария обязательно SQL-подтверждение, что исходная сессия восстановлена.

14. В `DocumentHistoryView` проверить регрессию отдельно.

Если `DocumentHistoryView` показывает глобальную историю не только package generation, нельзя ломать его группировкой. Если общий компонент используется несколькими режимами, группировку включать только для package-session документов с `meta.generation_mode='per_role_person'`.

15. Не менять backend и схему.

Если при реализации выяснится, что нужных meta-полей нет или не хватает для корректной группировки, остановиться и оформить D.0/backend data patch. Не придумывать frontend workaround, который группирует по title/template_name.

16. В DoD добавить проверку mixed-status group:

- один recipient success;
- один recipient failed/error;
- заголовок группы показывает `1 из N с ошибкой`;
- successful recipient можно скачать;
- failed recipient показывает ошибку и disabled download, если файла нет.

17. В proof добавить итоговый статус строго так:

```text
Stage A — PASS
Stage B — PASS
Stage C — PASS
Stage D.1 — PASS: UI grouping + read-only stale/missing indicators
Stage E — NOT STARTED: selective regeneration / cleanup actions
```

Не писать `Stage D — PASS`, чтобы не создать впечатление, что selective regeneration/cleanup уже реализованы.

После этих правок Stage D.1 можно выполнять.

&nbsp;

План: Stage D.1 — UI grouping + read-only stale/missing indicators (frontend-only)

## Контекст и разделение

Предыдущий Stage D смешивал две разные задачи:

- **D.2** — UI-группировка per-recipient документов (frontend-only).
- **D.3** — retro/cleanup/«перегенерировать только недостающих» (требует backend selective regeneration, **не** frontend-only).

Ключевая ошибка прежнего плана: текущий idempotency-ключ генератора —

```
pkg:{batch_id}:{item_id}:assn:{assignment_id}
```

При повторном вызове `ai-generate-document-package` без новых параметров создаётся **новый** `batch_id`, и генератор пересоздаёт весь пакет, а не только missing. Поэтому кнопка «Перегенерировать только недостающих» в текущем backend-контракте невозможна.

Решение — разделить:

- **Stage D.1 (этот план)** — frontend-only: UI grouping + read-only stale/missing indicators. Никакой selective regeneration. Кнопка «Сформировать пакет заново» — это обычный запуск пакета, который создаёт новый batch и помечается как таковой.
- **Stage E (отдельный план, не сейчас)** — backend selective regeneration (новый контракт генератора `only_missing=true` / `target_item_id` / `target_assignment_ids`, новый proof по idempotency). Не часть Stage D.

## Цель Stage D.1

1. Пользователь видит per-recipient результаты сгруппированно по latest successful batch, в карточке документа понятно «N из M получателей».
2. Пользователь видит stale (участник удалён из роли) и missing (новый участник без документа) **только как индикацию**, без backend-действий по точечной регенерации.
3. История генераций не смешивает разные batch.

## Шаги

### D.1.0 Discovery (read-only)

Прочитать:

- `src/components/ai-documents/packages/PackageGenerationHistory.tsx`
- `src/components/ai-documents/packages/PackageDocumentCard.tsx`
- `src/components/ai-documents/packages/PackageGenerationPanel.tsx`
- `src/components/ai-documents/DocumentHistoryView.tsx` (регрессия)

Зафиксировать реальный набор полей в `ai_generated_documents.meta` для тестовой сессии `758080c9-...`:

```sql
SELECT id,
       generation_batch_id,
       package_template_item_id,
       status,
       meta->>'generation_mode'         AS generation_mode,
       meta->>'repeat_role_catalog_id'  AS repeat_role_catalog_id,
       meta->>'repeat_assignment_id'    AS repeat_assignment_id,
       meta->>'recipient_person_id'     AS recipient_person_id,
       meta->>'recipient_display_name'  AS recipient_display_name,
       meta->>'recipient_index'         AS recipient_index,
       meta->'recipient_snapshot'       AS recipient_snapshot,
       created_at
FROM ai_generated_documents
WHERE package_session_id = '<session_id>'
ORDER BY generation_batch_id DESC, package_template_item_id,
         (meta->>'recipient_index')::int NULLS LAST, created_at;
```

Канонические поля для D.1 (используем именно эти, не `meta.recipient.full_name`):

- `meta.generation_mode`
- `meta.repeat_role_catalog_id`
- `meta.repeat_assignment_id`
- `meta.recipient_person_id`
- `meta.recipient_display_name`
- `meta.recipient_index`
- `meta.recipient_snapshot` (fallback ФИО, если `recipient_display_name` пуст)

Fallback порядок отображения ФИО получателя:
`recipient_display_name` → `recipient_snapshot.full_name` → `recipient_person_id (short)` → `«Получатель #{recipient_index}»`.

### D.1.1 UI-группировка per-recipient (frontend-only)

Файлы: `PackageGenerationHistory.tsx`, `PackageDocumentCard.tsx`.

Расширить select: добавить `generation_batch_id, meta, created_at`.

Группировка — обязательно по тройке + batch:

```
(generation_batch_id, package_template_item_id, meta.generation_mode)
```

Алгоритм:

- Загрузить документы текущей сессии.
- Определить **latest batch** = max(`created_at`) среди `generation_batch_id` сессии.
- В «Результате последнего запуска» отрисовывать **только latest batch**.
- В «Истории» отрисовывать batch-группы отдельно: заголовок batch = дата + status агрегата + режим, внутри — items.
- Внутри batch для каждого item:
  - если все строки `meta.generation_mode != 'per_role_person'` → одна строка (как сейчас).
  - если `per_role_person` → сворачиваемая карточка «{template_name} — {N} получателей»:
    - сортировка по `meta.recipient_index` ASC NULLS LAST, потом `created_at` ASC;
    - в каждой строке: ФИО (fallback chain), `status`, `document_number`/`document_date` если есть, кнопка «Скачать»;
    - если есть `failed`/`error` → бейдж «X из N с ошибкой» на заголовке группы;
    - кнопка «Скачать» сохраняется для всех получателей, в т.ч. failed (если файл есть).

В `PackageDocumentCard`:

- Индикатор «Сгенерировано N/M получателей» считается **по latest successful batch** для этого item. Если последний batch failed/blocked, показываем две строки:
  - «Последний успешный batch: N/M»
  - «Последний запуск: blocked/error» (без подмены статуса).
- Если у item никогда не было успешного batch — индикатор не показывается.
- Для single-документов индикатор не меняется.

Запрет искусственной группировки:

- Single-документы (1 строка, `generation_mode != 'per_role_person'`) **никогда** не сворачиваются в группу.
- Документы из разных `generation_batch_id` **никогда** не смешиваются в одну группу.

### D.1.2 Read-only stale / missing / mode_changed

Файлы: новый hook `src/hooks/useRepeatableDocumentStaleness.ts`, использование в `PackageDocumentCard.tsx`.

Источник истины «active assignments»:

```sql
SELECT id AS assignment_id, person_id
FROM document_package_item_role_assignments
WHERE package_session_id = :session_id
  AND package_template_item_id = :item_id
  AND role_catalog_id = :repeat_role_catalog_id
  AND is_active = true
  AND person_id IS NOT NULL;
```

Сравнение делаем **только внутри latest batch текущего item и его текущего `repeat_role_catalog_id**`:

- **stale** — документ latest batch имеет `meta.repeat_assignment_id`, которого нет в active assignments → бейдж «Устарело: участник удалён из роли». Скачивание остаётся.
- **missing** — есть active assignment, по которому в latest batch нет документа → строка-плейсхолдер «Не сгенерировано» + ФИО (из `legal_details_persons` через assignment).
- **mode_changed** — у item сейчас `generation_mode='single'`, но в `latest batch` (или в истории) есть `per_role_person` документы. Не помечаем устаревшими автоматически; показываем нейтральную пометку на batch-группе истории: «Создано в прежнем режиме: по роли». Скачивание не блокируем. Аналогично для обратного перехода.

Старые batch:

- Stale/missing **не считаются** для документов из не-latest batch. Старый batch — это исторический срез, в нём может не быть текущих ассайнментов, и это норма. В истории показываем нейтрально, без бейджей ошибок.

В карточке документа (`PackageDocumentCard`) дополнительно (только read-only):

- счётчик «X устаревших, Y не сгенерировано» относительно latest batch и текущих active assignments;
- подсказка-текст: «Чтобы синхронизировать состав получателей, сформируйте пакет заново»;
- кнопка «Сформировать пакет заново» — это обычный запуск `ai-generate-document-package` через существующий `PackageGenerationPanel` flow. **Честная подпись** и tooltip: «Создаст новый batch со всеми документами пакета». Никакой selective-логики, никаких новых параметров.

Запрещено в D.1:

- Кнопка «Перегенерировать только недостающих» — не добавлять.
- DELETE/UPDATE по `ai_generated_documents` со стороны UI — не делать.
- Новые параметры у edge function — не вводить.

### D.1.3 Proof-сценарии (безопасные, без ручных удалений в боевой сессии)

Запрещено для proof: руками удалять `document_package_item_role_assignments` в боевой сессии без восстановления.

Допустимые сценарии proof:

1. **Тестовая сессия / тестовый item** — клонировать сценарий «Извещение per_role_person + 3 Участника» в отдельную тестовую `document_package_sessions` запись, проверять stale/missing там.
2. **UI-изменение assignment** — через существующую карточку документа деактивировать/добавить ассайнмент (если такой UI есть), затем восстановить.
3. **SQL в транзакции с явным ROLLBACK** — `BEGIN; UPDATE ... is_active=false WHERE id=...; <read UI>; ROLLBACK;` — только для read-only проверки бейджей.

Каждый proof-сценарий обязан заканчиваться явным восстановлением состояния и SQL-подтверждением, что boевая сессия не повреждена.

### D.1.4 Proof + статус

Создать `.lovable/proofs/package_repeatable_documents_stage_d1_ui_grouping_v1.md`.

Обязательное содержание:

- SQL по batch boundary (latest batch сессии):
  ```sql
  SELECT generation_batch_id, package_template_item_id,
         meta->>'generation_mode'        AS generation_mode,
         meta->>'repeat_assignment_id'   AS repeat_assignment_id,
         meta->>'recipient_display_name' AS recipient_display_name,
         meta->>'recipient_index'        AS recipient_index,
         status
  FROM ai_generated_documents
  WHERE generation_batch_id = '<batch_id>'
  ORDER BY package_template_item_id,
           (meta->>'recipient_index')::int NULLS LAST,
           created_at;
  ```
- SQL active assignments для item.
- Описание/скриншот: «Извещение — 3 получателя», раскрытие Петров / Иванов / Федорчук в порядке `recipient_index`.
- Сценарий stale (через тестовую сессию или SQL+rollback) — бейдж появился, restore подтверждён.
- Сценарий missing — плейсхолдер появился, restore подтверждён.
- Сценарий mode_changed — нейтральная пометка, скачивание работает.
- Сценарий «latest batch failed» — индикатор показывает обе строки (last success + last run).
- Явный раздел «Backend не менялся»: `ai-generate-document-package`, схема БД, idempotency-ключ, edge functions registry — без изменений.

Обновить `.lovable/plan.md`:

```
Stage A           — PASS
Stage B           — PASS
Stage C (all)     — PASS
Stage D.1         — PASS  (UI grouping + read-only stale/missing indicators)
Stage E           — NOT STARTED  (selective regeneration / cleanup actions, backend + UI)
```

## DoD D.1.1 (UI grouping)

- Latest batch показывает «Извещение — 3 получателя».
- Раскрытие выводит Петров / Иванов / Федорчук в порядке `recipient_index`.
- У каждого получателя своя кнопка «Скачать», включая failed (если файл есть).
- Single-документы («Инструкция», «Приказ») не группируются.
- Документы из разных batch не смешиваются — каждый batch в истории отдельно.
- Failed-получатель показывает бейдж ошибки на заголовке группы.
- Технические поля (`document_number`, `document_date`, скачивание) сохранены.
- Нет регрессии в `DocumentHistoryView`.

## DoD D.1.2 (read-only stale/missing/mode_changed)

- Stale-документ помечен бейджем «Устарело: участник удалён из роли» только относительно latest batch.
- Missing-ассайнмент показан плейсхолдером «Не сгенерировано» с ФИО.
- mode_changed → нейтральная пометка на batch-группе истории, без блокировок.
- Старые batch не помечаются stale/missing.
- Карточка документа показывает «X устаревших, Y не сгенерировано» по latest batch.
- Кнопка только «Сформировать пакет заново», подпись честная (новый batch, не selective).
- Нет кнопки «Перегенерировать только недостающих».
- Нет UI-операций DELETE/UPDATE по `ai_generated_documents`.

## DoD D.1.3 (карточка документа индикатор)

- «N/M получателей» считается по latest successful batch.
- При failed/blocked последнего запуска показаны две строки (last success + last run).
- Если успешного batch не было — индикатор скрыт, без подмены статуса.

## Stop-guards

- Любая необходимость менять backend (новый параметр генератора, изменение схемы, новый ключ в `meta`) → STOP, переоформить как Stage E. D.1 — строго frontend-only.
- Любая UI-операция, которая удаляет/правит `ai_generated_documents` или `document_package_item_role_assignments` → STOP.
- Proof-сценарий без восстановления состояния боевой сессии → STOP.

## Что НЕ делаем в Stage D.1

- Не трогаем `ai-generate-document-package` и любые edge functions.
- Не меняем схему БД, не добавляем колонки, индексы, enum.
- Не вводим selective regeneration (`only_missing`, `target_assignment_ids`).
- Не удаляем и не правим уже сгенерированные документы.
- Не трогаем DOCX-шаблоны.
- Не начинаем Stage E.

## Stage E (только обозначение, не выполняем)

Будущий отдельный план:

- Новый контракт генератора: `only_missing=true`, `target_item_id`, `target_assignment_ids`.
- Новый proof idempotency: повторный вызов создаёт документы **только** для missing ассайнментов, без нового полного batch (или с явным batch-flag «partial»).
- UI-кнопка «Перегенерировать только недостающих» появляется **только** после Stage E PASS.
- Cleanup policy для stale (опционально, отдельным подэтапом).

После Stage E итог пересматривается, до тех пор Stage D.1 не претендует на закрытие retro/cleanup.