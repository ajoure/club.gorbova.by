## да, согласен, с учетом правок:

## **Главное уточнение**

Да, правильно: **для будущей генерации пакета не нужно создавать отдельную новую систему генерации документов**.

Нужно идти так:

```text
Пакет документов
→ собирает контекст: пакет + шаблон + анкета документа + роли + ЮЛ/ИП/ФЛ
→ передаёт этот контекст в существующий pipeline генерации
→ существующий renderer / DOCX / PDF / Gotenberg / storage / ai_generated_documents работают как раньше
```

То есть в Sprint 3H нельзя делать отдельную «пакетную генерацию с нуля». Нужен **adapter/wrapper над существующей генерацией**, который только добавляет package-context.

---

## **Обязательные правки к плану proof Sprint 3G**

### **1. В Step 6 заменить проверку кнопки «Сформировать пакет»**

Сейчас там написано только проверить, не вызывает ли она `ai-generate-document-package`.

Нужно уточнить:

```md
Кнопка «Сформировать пакет» в Sprint 3G не должна запускать генерацию.

Но в proof нужно зафиксировать архитектурное правило для Sprint 3H:

- не создавать отдельный независимый generation engine;
- не дублировать DOCX/PDF/render/storage логику;
- будущая генерация пакета должна переиспользовать существующий pipeline генерации документов;
- новый package-layer может только:
  1. выбрать список шаблонов из `document_package_template_items`;
  2. собрать package context;
  3. подставить package-aware токены;
  4. вызвать существующий renderer/generation pipeline для каждого шаблона;
  5. объединить результаты в пакет / историю.
```

---



### **2. Добавить отдельный пункт**

`7.8 Future generation architecture`

В proof добавить секцию:

```text
7.8 Future generation architecture — PASS/GAP
```

Проверить и зафиксировать:

```md
Sprint 3G не создаёт отдельную генерацию пакетов.

Для Sprint 3H утверждается правило:

Package generation must reuse existing document generation infrastructure:
- existing DOCX renderer;
- existing placeholder parser / resolver chain;
- existing PDF conversion path;
- existing storage path;
- existing ai_generated_documents / history model, если она применима;
- existing validation_status / template_version logic.

Новый слой допустим только как package orchestrator:
- загрузить package_session;
- получить document_package_template_items;
- для каждого template_item собрать контекст;
- добавить package resolvers для `{{package.ul...}}`, `{{package.ip...}}`, `{{package.fl...}}`, `{{package.role.PKR...}}`;
- вызвать существующий generation/render function;
- записать результат так же, как обычный документ, но с package metadata.
```

---





### **3. В**

`Untouched artifacts` **добавить проверку на отсутствие нового генератора**

В Step 7 добавить grep:

```bash
rg -n "generate-package|package-generate|ai-generate-document-package|document-package-generation|generateDocumentPackage" src supabase/functions
```

И зафиксировать:

```md
Если найден новый edge/function, который самостоятельно рендерит DOCX/PDF или пишет в storage/ai_generated_documents — это BLOCKER.

Допустимы только:
- disabled-заглушка;
- UI-кнопка без вызова;
- будущий orchestrator, который вызывает существующий generation pipeline.
```

---

### **4. Не путать validation и generation**

Добавить в proof:

```md
Controlled validation не является генерацией.

Validation может:
- читать DOCX;
- извлекать плейсхолдеры;
- проверять синтаксис;
- проверять наличие package context / roles / assignments.

Validation не может:
- вызывать Gotenberg;
- создавать PDF;
- писать `ai_generated_documents`;
- сохранять generated file;
- менять template/content/snapshot.
```

---

## **Готовый текст для Lovable**

```md
да, согласен, с учетом правок:

1. В proof Sprint 3G добавь отдельную секцию `7.8 Future generation architecture`.

2. Зафиксируй принцип: будущая генерация пакета в Sprint 3H НЕ должна создавать новый независимый generation engine. Нужно переиспользовать существующий pipeline генерации документов: DOCX renderer, placeholder parser/resolver chain, PDF conversion/Gotenberg, storage, template_version/validation logic, историю/ai_generated_documents — если применимо.

3. Новый package-layer может быть только orchestrator/wrapper:
   - получить `package_session`;
   - получить `document_package_template_items`;
   - для каждого template_item собрать package context;
   - добавить package resolvers для `{{package.ul...}}`, `{{package.ip...}}`, `{{package.fl...}}`, `{{package.role.PKR...}}`;
   - вызвать существующий generation/render pipeline;
   - сохранить результат тем же способом, что обычные документы, но с package metadata.

4. В Step 6 по кнопке «Сформировать пакет» зафиксировать: в Sprint 3G кнопка не должна запускать генерацию. Если она живая и вызывает edge/function генерации — это blocker.

5. В Step 7 добавить grep:
   `rg -n "generate-package|package-generate|ai-generate-document-package|document-package-generation|generateDocumentPackage" src supabase/functions`

   Если найден новый самостоятельный генератор, который сам рендерит DOCX/PDF, пишет в storage или `ai_generated_documents`, это blocker. Допустим только disabled stub либо будущий orchestrator, который вызывает существующие функции.

6. В proof отдельно указать: controlled validation не является генерацией. Она может читать DOCX и проверять плейсхолдеры, но не может вызывать Gotenberg, создавать PDF, писать `ai_generated_documents`, storage или snapshot.

7. Остальные пункты плана оставить без изменений: сейчас только proof/grep/read-only, без кода, миграций, UI и запуска генерации.
```

## **Итог**

План можно выполнять после этой правки.  
Ключевая мысль: **Sprint 3G закрывает проверку и архитектурную готовность, а Sprint 3H должен подключать пакетную генерацию через существующую систему генерации, а не строить новую.**

&nbsp;

План: дополнение proof Sprint 3G секцией DoD-верификации

Скоуп: только дополнение файла `.lovable/proofs/package_documents_sprint3g_document_level_questionnaires_2026_05.md`. Никаких изменений в коде, миграциях, edge-функциях, UI. Перед записью — провести фактическую верификацию (чтение БД и grep по репо), и зафиксировать результаты в proof.

### Шаг 1. Верификация PKR-каталога (UI)

- Прочитать `src/components/ai-documents/placeholders/PlaceholdersCatalogTab.tsx` (и компонент группы «Пакет: Роли»), убедиться:
  - таблица рендерит русские колонки (Группа, Название, ID, Тип, Пример, Плейсхолдер, Копировать);
  - нет упоминаний `document_package_role_catalog`, `source_path`, `role_key`, raw JSON в обычном UI;
  - copy-token формируется как `{{package.role.PKR-XXXXXX}}`.
- Подтвердить тестом `src/utils/packagePlaceholderCatalog.test.ts` (`buildPackageRoleItems генерирует ровно один токен`).

### Шаг 2. Верификация валидации системных FLD

- В `PackageTemplateValidationPanel.tsx` + `src/utils/billingFldGroups.ts` подтвердить, что FLD-000209, FLD-000211, FLD-000069 имеют системный/документный `entity_type` (через `supabase--read_query` по `fields_registry`) и относятся к non-billing.
- Зафиксировать вывод: для всех трёх → `valid` без warning.

### Шаг 3. Верификация billing-FLD

- Через `supabase--read_query` выбрать примеры FLD по `entity_type ∈ {customer*, executor_leg}`.
- Подтвердить, что validator выдаёт warning `billing_fld_in_package_scope`, не error.

### Шаг 4. Верификация `role_assignment_missing`

- Проверить в `PackageTemplateValidationPanel.tsx` ветку для `{{package.role.PKR-XXXXXX}}`: если в `document_package_item_role_assignments` (active) для пары (session, package_template_item_id) нет назначения по этому `role_catalog_id` → warning `role_assignment_missing`.
- Если в текущей реализации эта проверка делается только на уровне резолвера, а не валидатора UI — пометить в proof как **gap** и завести в backlog `package_validator_role_assignment_missing` (без правки кода в этом шаге плана).

### Шаг 5. Верификация item-level анкет

- Через `supabase--read_query` к `document_package_item_role_assignments` подтвердить DDL-инварианты:
  - один `person_id` может встречаться на разные `(package_template_item_id, role_catalog_id)` в рамках одной `package_session_id`;
  - на одну `(package_session_id, package_template_item_id, role_catalog_id)` можно вставить несколько активных `person_id`;
  - partial unique index не даёт дубль `(package_session_id, package_template_item_id, role_catalog_id, person_id) WHERE is_active = true`.
- Триггер `dpira_assert_package_match` проверить через `pg_trigger` / `pg_proc`.

### Шаг 6. Верификация кнопки «Сформировать пакет»

- Grep по `useAiDocumentPackageGeneration`, `ai-generate-document-package`, `DocumentPackageIdeologyView.tsx`, `DocumentPackageQuestionnairesView.tsx`, `PackagesWorkspace.tsx`.
- Зафиксировать в proof одно из:
  - кнопка disabled с tooltip «генерация будет подключена в Sprint 3H»;
  - либо кнопка отсутствует / помечена заглушкой.
- Если по факту кнопка живая и вызывает edge `ai-generate-document-package` — пометить как **blocker** для закрытия Sprint 3G и поставить задачу в Sprint 3G hotfix (без правки кода в этом плановом шаге).

### Шаг 7. Grep/diff подтверждение неприкосновенных артефактов

- `rg "canonical-document-generate-strict"` + `git`-нейтральная проверка (только просмотр файла) — подтвердить, что edge-функция не модифицирована в скоуп-коммитах Sprint 3G.
- `rg -n "gotenberg"` в `supabase/functions/_shared/resolve-package-tokens.ts`, новых UI и хуке — отсутствие вызова.
- `rg -n "ai_generated_documents"` в новых файлах Sprint 3G — отсутствие записи.
- `rg -n "billing|customer_resolver|executor_resolver"` в новых файлах — отсутствие правок биллинг-резолвера.
- Все четыре пункта зафиксировать как PASS/FAIL с конкретным выводом команд.

### Шаг 8. Запись новой секции в proof

Дописать в `.lovable/proofs/package_documents_sprint3g_document_level_questionnaires_2026_05.md` секцию:

```text
## 7. DoD verification (Sprint 3G closeout)

7.1 PKR catalog UI — PASS/FAIL + ссылки на файлы
7.2 System FLD validation (FLD-000209/211/069) — PASS/FAIL
7.3 Billing FLD validation — PASS/FAIL
7.4 role_assignment_missing — PASS / GAP (+ backlog ref)
7.5 Item-level invariants (DB) — PASS (DDL + index + trigger)
7.6 «Сформировать пакет» — DISABLED / BLOCKER (+ ref)
7.7 Untouched artifacts — PASS (4 grep-результата)
```

Если какие-либо пункты — FAIL/BLOCKER, явно написать «Sprint 3G **не закрывается** до устранения», и перечислить blocker-задачи.

### Не входит в этот план

- Никаких изменений кода, миграций, edge-функций, UI, тестов.
- Никакого реального запуска генерации (это Sprint 3H).
- Никакой правки memory/index — обновление произойдёт только когда все 7 пунктов PASS.

### DoD этого шага

- Proof-файл содержит секцию «7. DoD verification» со всеми 7 пунктами.
- Для каждого пункта приведено наблюдение (файл/строка, SQL-результат, grep-вывод).
- Явный вердикт closeout-а Sprint 3G: CLOSED или OPEN c blocker-списком.