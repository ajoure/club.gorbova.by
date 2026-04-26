## Да, согласен, с учетом правок:

```text
План принимаю add-only. Ничего из предыдущего ТЗ не удалять и не заменять.

Добавь в план обязательные правила:

1. Это отчет/план по доработке, а не закрытие задачи. Закрытие только после proof: UI + SQL + audit_logs.

2. Audit logs:
   - если клиентский INSERT в audit_logs не проходит из-за RLS, НЕ считать задачу выполненной;
   - тогда сделать безопасный backend/RPC/edge путь записи audit_logs;
   - в финальном отчете приложить SQL proof записей audit_logs.

3. CSV export:
   - экспорт CSV должен включать все dynamic columns по interactive blocks;
   - для external_product_workshop обязательно вывести: client_types_count, portfolio_count, completed, import_source, updated_at;
   - CSV export не должен ломать текущий JSON export из StudentProgressModal.

4. Consistency proof:
   - totalStudents должен равняться фактической длине таблицы;
   - completedStudents должен равняться количеству строк со статусом “Завершён”;
   - один user_id = одна строка, даже если есть lesson_progress_state + user_lesson_progress.

5. Toggle completion:
   - проверить оба направления:
     a) “Завершить Шаг 3” → admin progress показывает “Завершён”;
     b) “Редактировать”/reopen → admin progress больше не показывает “Завершён”;
   - без reload-магии, через invalidate/refetch.

6. Proof-панели:
   - не писать “SQL proof”, если данные не прочитаны из БД;
   - панели должны показывать live-данные из user_lesson_progress, а не локальный state.

7. Финальный отчет:
   - не писать “готово” без 6 скринов и 2 SQL-выгрузок;
   - отдельно указать, что именно проверено вручную в UI.
```

Можно выполнять.

&nbsp;

План: Финальный proof-пакет для «Шаг 3: Внешний продукт»

Все изменения — **add-only**, ничего из уже реализованного не удаляется. Цель — закрыть DoD: SQL proof + UI proof ученика + UI proof преподавателя + reload proof + export proof + audit_logs proof.

---

### 1. Синхронизация завершения блока (фикс рассинхрона UI ↔ admin)

**Файл:** `src/components/lesson/blocks/ExternalProductWorkshop.tsx`

- При нажатии «Редактировать / Снять завершение» сейчас локально сбрасывается флаг, но в `user_lesson_progress` `completed_at` может остаться. Добавить в canonical-save путь явный сброс: при `completed=false` вызывать `saveBlockResponse(block.id, payload, null, 0, 1)` — это занулит `completed_at` (см. `useUserProgress.saveBlockResponse`: `completed_at: isCorrect !== null ? ... : null`).
- При `completed=true` — `saveBlockResponse(..., true, 1, 1)` (как сейчас).
- Принудительный `refetch` после canonical-save, чтобы proof-панель в UI ученика и admin progress показывали одинаковый `completed_at`.

**Файл:** `src/pages/admin/AdminLessonProgress.tsx`

- Сейчас при merge stateRows + manualRows `completed_at` берётся как `existing.completed_at || completedAt`. Заменить на «свежее по updated_at побеждает», чтобы снятие завершения в manual-блоке не оставляло старый `completed_at` от kvest-прогресса.
- В `getUserBlockResponse` и счётчике `answeredCounts` дополнительно проверять, что для блока `external_product_workshop` есть запись в `user_lesson_progress` с `completed_at != null` — иначе ученик не считается завершившим блок.

---

### 2. Проверки консистентности таблицы прогресса

**Файл:** `src/pages/admin/AdminLessonProgress.tsx`

- Дедупликация уже есть через `byUser: Map<user_id, ...>` — добавить инвариант-assert в dev-режиме: `console.assert(progressRecords.length === new Set(progressRecords.map(r=>r.user_id)).size)`.
- Добавить ConsistencyBadge в шапке таблицы:
  - `totalStudents = rows.length`
  - `completedStudents = rows.filter(completed_at).length`
  - источник прогресса (`progress_sources`) показывать как маленький значок в строке: `K` (kvest) / `M` (manual) / `K+M`.
- Кнопка «Просмотр» уже передаёт `record.user_id` в `StudentProgressModal`, который сам тянет свежие `user_lesson_progress` — дополнительно прокинуть `key={record.user_id + record.updated_at}` чтобы при reopen всегда был свежий ответ.

---

### 3. Экспорт CSV по уроку

**Файл:** `src/pages/admin/AdminLessonProgress.tsx`

Добавить кнопку «Экспорт CSV» рядом с заголовком таблицы. Колонки:

```
student_name, email, status, updated_at, progress_source,
<для каждого interactive блока>: <короткое значение>
```

Короткое значение через уже существующий `resolveProgressValue(block_type, response, content)` → `summary`. Для `external_product_workshop` — счётчики из payload (`client_types: N, portfolio: M, completed: yes/no`).

Использовать `Blob` + `URL.createObjectURL` (паттерн как в `exportFullResponse`). UTF-8 BOM в начале для Excel.

---

### 4. Audit log действий

**Новый helper:** `src/lib/auditTrainingActions.ts` (тонкая обёртка над `supabase.from("audit_logs").insert`).

**События:**

1. `training.external_product_workshop.completed` — вызывается из `ExternalProductWorkshop.tsx` при canonical-save с `completed=true`. Meta: `{ lesson_id, block_id, student_user_id: user.id, source: "student", client_types_count, portfolio_count }`.
2. `training.external_product_workshop.reopened` — при `completed=false`. Meta аналогично, `source: "student"`.
3. `training.student_response.exported` — вызывается в `StudentProgressModal.exportFullResponse` и в новом CSV-экспорте. Meta: `{ lesson_id, block_id: null|block.id, student_user_id, actor_user_id, source: "teacher", format: "json"|"csv" }`.

`actor_user_id` берём из `useAuth().user.id`. Запись best-effort (try/catch без блокировки UI).

---

### 5. UI proof-панели (доработка существующих)

**Файл:** `src/components/lesson/blocks/ExternalProductWorkshop.tsx`

Дополнить уже существующую proof-панель тремя строками + кнопками копирования:

- `SQL proof`: показывает `last_saved_at` и `completed_at` из `user_lesson_progress` (read live из `useUserProgress.getBlockProgress(block.id)`).
- `Reload proof`: считаем «pass», если после mount данные восстановились из БД (а не из локального стейта по умолчанию).
- `Export proof`: кнопка «Скачать мой ответ» (JSON), пишет audit `training.student_response.exported` с `source: "student_self"`.

Это даёт runtime-доказательство, которое легко скриншотить.

---

### 6. Скриншоты для финального DoD

После реализации сгенерируем proof-набор:

1. `/admin/training-lessons/<id>/progress` — таблица со студентом, источниками K/M, кнопками «Экспорт CSV» и «Просмотр».
2. Открытый `StudentProgressModal` с полным блоком `external_product_workshop` (4 справочника + калькулятор).
3. Кнопка «Экспорт ответа» в модалке + сам JSON.
4. Урок ученика с заполненным блоком и proof-панелями (SQL/UI/Reload/Export).
5. SQL: `SELECT user_id, completed_at, response->'meta' FROM user_lesson_progress WHERE lesson_id='<step3>' AND block_id='<epw>'`.
6. SQL: `SELECT action, meta, created_at FROM audit_logs WHERE action LIKE 'training.external_product_workshop.%' OR action='training.student_response.exported' ORDER BY created_at DESC LIMIT 20`.

Все скрины и SQL-выводы прикладываем в финальный отчёт.

---

### Технические детали

- Все правки add-only, без миграций (audit_logs уже существует).
- `audit_logs.insert` идёт под клиентским `supabase`-клиентом — RLS должен позволять `INSERT` авторизованным; используется тот же путь, что в `useProductTrainings`, `useGrpRefresh`, `useFormsBulkDelete` — паттерн рабочий.
- CSV: разделитель `,`, кавычки `"`, экранирование `""`, перевод строк `\r\n`, имя файла `lesson-progress-<lessonId>-<YYYYMMDD>.csv`.
- Никаких изменений в схеме БД, edge-функциях, миграциях.

### DoD

- `completed_at` синхронен между UI ученика и admin progress (toggle проверен в обе стороны).
- Дедупликация: один пользователь — одна строка, даже если есть и kvest, и manual прогресс.
- CSV экспортируется и открывается в Excel/Numbers.
- `audit_logs` содержит записи completed / reopened / exported с правильным meta.
- Proof-панели в уроке ученика показывают live SQL/Reload/Export статус.
- Финальный отчёт содержит 6 скринов + 2 SQL-выгрузки.