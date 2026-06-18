да, согласен, с учетом правок:

1. **Статический шаблон должен быть валиден не только для пакета, но и для обычной генерации.** Если документ без плейсхолдеров активирован как standalone-шаблон, он также должен генерироваться без замен. Не делать отдельную логику «только для пакетов», если валидатор общий.
2. **Не обещать byte-for-byte после PDF.** Корректная формулировка:
  &nbsp;
  ```text
  DOCX после генерации должен сохранить исходное содержимое без token-substitution.
  PDF создаётся через Gotenberg из этого DOCX, но не является byte-for-byte копией.
  ```
  Byte-for-byte можно сравнивать только исходный DOCX и generated DOCX, если генератор действительно не перепаковывает файл. Если DOCX перепаковывается библиотекой, сравнивать нужно plain-text/content XML, а не байты.
3. **Проверить backend activation gate отдельно.** Недостаточно, что `validation_status='valid'`. Нужно явно проверить функцию/путь активации:
  - UI-кнопка активна;
  - backend activation endpoint/RPC не содержит отдельного запрета по пустому `token_manifest`;
  - `current_version_id` реально обновился.
4. **Warning должен сохраняться в существующей модели без миграции.** Если в `document_template_versions` уже есть `validation_warnings` — использовать его. Если такого поля нет, не добавлять миграцию в этом патче без отдельного согласования. Тогда warning должен жить в существующем `validation_result/meta`, если такой контейнер уже есть. В proof указать фактическое место хранения warning.
5. **Frontend и backend должны иметь одинаковый код warning.**
  &nbsp;
  ```text
  no_placeholders_in_template
  ```
  Один и тот же code должен отображаться в UI и возвращаться backend-валидацией. Не создавать разные коды вроде `static_template` / `empty_token_manifest`.
6. **Token manifest для статического документа должен быть пустым, но валидным.**  
Проверить:
  - `token_manifest = []` или канонически пустая структура;
  - `detected_tokens = []`;
  - нет `null`, который ломает генератор, snapshot или UI.
7. **Package readiness не должна требовать заполнения полей для статического документа.** В карточке пакета такой документ должен показываться как:
  &nbsp;
  ```text
  Поля документа: нет дополнительных полей
  ```
  и не блокировать генерацию пакета.
8. **Генерация пакета должна включать статический документ в итоговый набор.** Проверить не только одиночную генерацию strict, но и пакетную сборку:
  - статический документ попал в output;
  - порядок документов в пакете сохранён;
  - остальные документы с токенами продолжают заменяться;
  - snapshots по статическому документу корректно показывают пустой token snapshot, а не ошибку.
9. **Регресс-тест на реальные ошибки обязателен.** Помимо `unknown_field_public_id`, проверить хотя бы один package-context gate:
  &nbsp;
  ```text
  package_token_outside_package_context
  ```
  Он должен оставаться `invalid` и блокировать активацию.
10. **Не смешивать этот hotfix с незакрытым Stage 5 field+role.** Static-template activation можно добавить отдельным блоком в отчёт, но Stage 5 по-прежнему не закрыт, пока не выполнен фактический combined `field+role` одним RPC.
11. **В финальном proof указать изменённые файлы и deploy.**  
Минимально:

- frontend file;
- edge function file;
- deploy timestamp / function version;
- screenshot UI;
- SQL before/after по `validation_status`, warnings и `current_version_id`.

12. **DoD дополнить итоговым статусом:**

```text
Static-template activation: PASS
Stage 5 field+role combined: still required
Stage 6/7: still blocked only by DOCX upload, unless static-template hotfix unblocks them
Patch: OPEN until full PASS

План: разрешить активацию шаблонов без плейсхолдеров
```

## Проблема

Шаблон без `{{field:...}}`/`{{pf-...}}`/`{{ln-...}}`/`{{package.*}}` помечается как `invalid` с ошибкой `no_placeholders_in_template`, кнопка «Активировать шаблон» заблокирована, и такой документ нельзя положить в пакет. По бизнес-требованию документ без плейсхолдеров — это валидный статический документ: при генерации пакета он должен попадать в выходной набор «как есть» (байт-в-байт DOCX → PDF Gotenberg).

## Diagnose

- `supabase/functions/canonical-template-apply-markup/index.ts:735-740` — backend SOT добавляет ошибку `no_placeholders_in_template` в `validationErrors`, из-за чего `validationStatus='invalid'`, активация версии блокируется (та же функция, строки `validation_status !== 'valid'` + UI-гейт `ValidationBadge`).
- `src/components/ai-documents/StrictDocumentTemplatesManager.tsx:254-259` — фронтовый strict-валидатор зеркалит то же поведение (panel «Проверка и исправление полей»).
- Генератор `canonical-document-generate-strict` и сборка пакета не требуют наличия токенов: при пустом `token_manifest` файл просто копируется без замен — статический документ корректно ляжет в ZIP/папку пакета и проедет через Gotenberg.
- Остальные гейты (`package_token_outside_package_context`, `unknown_field_public_id`, `invalid_legacy_role_placeholder` и т.д.) остаются ошибками — на них правка не распространяется.

## Решение (минимальная поверхностная правка)

Демоутить `no_placeholders_in_template` из ошибки в **warning** в обоих местах валидации. Активация и публикация версии разрешаются, статус становится `valid`, в UI остаётся информационное сообщение «В шаблоне нет плейсхолдеров — документ будет вставлен в пакет как есть».

### Изменения

1. `**supabase/functions/canonical-template-apply-markup/index.ts**` (≈строки 735-740):
  - Заменить `validationErrors.push({ code: 'no_placeholders_in_template', ... })` на `validationWarnings.push({ code: 'no_placeholders_in_template', message: 'В шаблоне нет плейсхолдеров — документ будет включён в пакет как есть (статический).' })`.
  - `validationStatus` останется `valid` при отсутствии других ошибок.
2. `**src/components/ai-documents/StrictDocumentTemplatesManager.tsx**`:
  - В `ValidationError` union тип `no_placeholders_in_template` перевести в новый список `ValidationWarning` (или отдать через отдельный канал — проще: вернуть `status: 'valid'` + warning-массив).
  - В `strictValidate` (строки 254-259): не пушить в `errors`; вернуть warning. Если других ошибок нет — `status='valid'`, кнопка «Активировать шаблон» включается.
  - В UI карточке версии (там, где сейчас красная плашка «no_placeholders_in_template…») показывать жёлтую/инфо-плашку с текстом «Шаблон без плейсхолдеров — будет включён в пакет как есть».
3. **Пакетная сборка / генерация** — кода трогать не нужно: `canonical-document-generate-strict` уже корректно обрабатывает версию с пустым `token_manifest` (нет замен → исходный DOCX в выход). Проверим это smoke-тестом после правки.

### Что НЕ меняем

- Контракт `document_template_versions` (`validation_status`, `validation_errors`, `token_manifest`) — без миграций.
- Гейты для `pf-*`/`ln-*` и неизвестных FLD — остаются ошибками.
- RPC `save_session_document_atomic`, `access_rules`, права, RLS, GRANT — не затронуты.
- Backend write-path активации (`canonical-template-activate-version` / эквивалент) — не правим: он уже зависит только от `validation_status='valid'`, который теперь будет проставляться.

## Dry run

- Текущее состояние из скриншота: шаблон «0. Приказ … инструкция» v1, `validation_status=invalid`, единственная ошибка — `no_placeholders_in_template`. После правки повторный прогон `canonical-template-apply-markup` (или /resave версии) даст `validation_status=valid`, warning виден в карточке, кнопка «Активировать шаблон» доступна.
- В пакете «Идеология» этот шаблон станет выбираемым в `document_package_template_items`; генерация выдаст исходный DOCX без модификаций.

## Execute (по шагам в build mode)

1. Патч edge-функции `canonical-template-apply-markup` (1 блок).
2. Патч `StrictDocumentTemplatesManager.tsx`: union типов + UI плашки + ветка `status` (минимально).
3. Deploy edge-функции.

## Verify / DoD

- Edge unit-вызов `canonical-template-apply-markup` на версии без токенов → `validation.status='valid'`, `validation.warnings[0].code='no_placeholders_in_template'`.
- В UI `/admin/documents` → «Шаблоны документов»: карточка «0. Приказ … инструкция» показывает жёлтую плашку (а не красную), кнопка «Активировать шаблон» активна; после клика версия становится `active`.
- В «Пакеты документов» этот шаблон выбирается; `canonical-document-generate-strict` для пакета возвращает файл с исходным содержимым (байты совпадают со storage-исходником).
- Шаблон с реальной ошибкой (например, `unknown_field_public_id`) по-прежнему `invalid`, активация заблокирована — регрессии нет.
- Audit `document_template.markup_applied` пишется как и раньше; новых полей не требуется.
- Скрин из preview с зелёной/жёлтой плашкой и активной кнопкой «Активировать шаблон».

## Отчёт по завершении

Отдельный блок «Static-template activation — PASS/FAIL» в финальном отчёте Stage 5/6.