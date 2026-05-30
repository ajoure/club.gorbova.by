# План: закрытие Sprint 3J-Roles

Цель — закрыть только оставшиеся пункты DoD спринта (UI уже почти готов, backend закрыт). Новую логику не расширять, backend/migrations/purchases/Gotenberg/billing pipeline не трогать.

## Шаг 1. Прогнать frontend-тесты

Запуск (vitest, project-команда):

```
bunx vitest run src/utils/personNameFormat.test.ts src/utils/packagePlaceholderCatalog.test.ts
```

Ожидание: оба файла зелёные.

Если падает:
- чинить только в рамках UI Sprint 3J-Roles (`src/utils/personNameFormat.ts`, `src/utils/packagePlaceholderCatalog.ts`, `PlaceholdersCatalogTab.tsx`, `FieldChipNode.ts`);
- backend (`supabase/functions/**`), migrations, `/purchases`, Gotenberg — НЕ трогать.

Зафиксировать stdout (PASS-строки) для §11 proof.

## Шаг 2. Runtime DOCX proof

Сгенерировать пакетный DOCX через admin/test flow (без правки prod billing-шаблонов):

1. В админке `/admin/documents` (или эквивалент) создать **тестовый** document_template c content, содержащим 5 токенов:
   ```
   {{ln-000012}}
   {{ln-000012|format=short}}
   {{ln-000012|format=signature_short}}
   {{ln-000012|format=short|case=genitive}}
   {{ln-000012|format=signature_short|case=genitive}}
   ```
   (привязка к тестовому package + роль `ln-000012` = Федорчук Сергей Валерьевич).
2. Запустить `ai-generate-document-package` в режиме `admin_test`.
3. Скачать готовый DOCX из `ai_generated_documents` (через `DocumentDownloadPage` / storage URL).
4. Распаковать:
   ```
   unzip -o generated.docx -d /tmp/docx_proof
   ```
5. Из `word/document.xml` извлечь текстовые runs, подтвердить 5 строк:
   ```
   Федорчук Сергей Валерьевич
   Федорчук С.В.
   С.В.Федорчук
   Федорчука С.В.
   С.В.Федорчука
   ```
6. Подтвердить `grep -c '{{' word/document.xml == 0` (raw токенов нет).

После доказательства — тестовый шаблон удалить (или пометить `archived=true`), чтобы prod не задело.

## Шаг 3. UI скриншот

Через browser tools:
- `/admin/ai` → вкладка «Плейсхолдеры» → группа «Пакет: Роли»;
- развернуть строку `ln-000012`, снять скриншот modifier-controls (три кнопки формата + dropdown падежа + preview);
- сохранить под `/mnt/documents/sprint_3j_roles_ui.png`.

## Шаг 4. Дополнить proof

Файл: `.lovable/proofs/sprint_3j_roles_modifier_parity_2026_05.md`

Добавить секции:

- **§10 Frontend modifier controls** — описание `RowSettingsCell` для `person_name`, ссылка на скриншот.
- **§11 Frontend tests** — команда + PASS-вывод vitest для обоих файлов.
- **§12 Runtime DOCX excerpt** — 5 строк результата + подтверждение отсутствия `{{...}}`.
- **§13 Billing regression** — подтверждение, что `fullNameToInitials` теперь возвращает без пробела между инициалами, и что это распространяется на billing director / IP short_name (ссылка на `_shared/typed-tokens-resolver.ts` и unit-результат).
- **§14 Untouched scope / final status** — grep-доказательства:
  ```
  git diff --name-only origin/main...HEAD | grep -E '^(supabase/functions|supabase/migrations|src/pages/.*[Pp]urchases)' || echo "untouched"
  ```
  + явное перечисление: `/purchases`, migrations, Gotenberg, billing pipeline — не тронуты в UI-заходе.
  + copy examples (5) + preview examples (5) + подтверждение absent `PKR` / `package.role.PKR` / `package.roles.*` в catalog output (`grep` по vitest snapshot или по `packagePlaceholderCatalog.ts`).

## Шаг 5. Финальный статус

В §9 / §14 зафиксировать:

```
completed: Sprint 3J-Roles
- ln role placeholders support full/short/signature_short and case modifiers in UI and runtime DOCX
- short FIO standard is global: Фамилия И.О.
- signature short standard is global: И.О.Фамилия
- old PKR/package.roles formats absent from UI
- billing/order pipeline unchanged except intended FIO short formatting standard
```

## Технические детали

**Изменяемые файлы (ожидаемо):**
- `.lovable/proofs/sprint_3j_roles_modifier_parity_2026_05.md` (дополнение секций §10–§14)
- `/mnt/documents/sprint_3j_roles_ui.png` (скриншот UI)
- `/mnt/documents/sprint_3j_roles_docx_excerpt.txt` (excerpt DOCX)

**НЕ изменяется:**
- `supabase/functions/**`
- `supabase/migrations/**`
- `/purchases` страницы и хуки
- Gotenberg конфиг
- billing tokens / customer.* / executor.* mapping
- Production document_templates (используется только временный admin/test шаблон, удаляется после proof)

**Стоп-условие:** Sprint 3J-Roles НЕ закрывается, пока §12 (Runtime DOCX excerpt) не подтверждён реальным generated документом — не только vitest и не только UI preview.

## DoD

- [x] vitest зелёный для обоих файлов (Шаг 1).
- [x] Runtime DOCX содержит ровно 5 ожидаемых строк, без raw `{{...}}` (Шаг 2).
- [x] Скриншот UI с тремя форматами + падежом (Шаг 3).
- [x] Proof §10–§14 заполнены (Шаг 4).
- [x] Финальный статус completed зафиксирован (Шаг 5).
