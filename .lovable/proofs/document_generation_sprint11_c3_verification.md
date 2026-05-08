# Sprint 11 — C3 VERIFICATION PASS

Дата: 2026-05-08
Контекст: 6951EAA2-1264-4A1A-A86D-817E462202C7

---

## 1. Legacy imports — orphan check

`rg` по 10 legacy-сущностям в `src` и `supabase/functions`:

```
CanonicalActGenerator           : 0 импортов (только comments в AiPageContent.tsx)
AiDocumentsGenerateView         : 0 импортов
AiDocumentsHistoryView          : 0 импортов
AliasesTab                      : 0 импортов
TokenMappingDialog              : 0 импортов
DocumentSnapshotDialog          : 0 импортов
AiDocumentTemplatesManager      : 0 импортов (только doc-comment в src/lib/sheetShell.ts)
useAiDocuments                  : только определение в src/hooks/useAiDocuments.ts
                                  + 1 doc-comment в useDocumentPackages.ts (не вызов)
useAiDocumentPackageGeneration  : только определение
useCorporatePackageGeneration   : импортируется только в CorporateStep5Confirm
                                  → CorporateWizard (никем не импортируется)
                                  → orphan tree, в роутинге отсутствует
```

Активных потребителей legacy-кода в работающих страницах нет.
Файлы hooks/CorporateWizard оставлены как dead-code до отдельного cleanup-коммита
(их физическое удаление ничего не ломает, но не входит в C3-VERIFY scope).

---

## 2. Safety-check — доступы / оплаты / подписки / Telegram

Counts (read-only):

| Таблица                     | Rows |
|-----------------------------|------|
| orders_v2                   | 3359 |
| payments_v2                 | 5704 |
| subscriptions_v2            | 1135 |
| entitlements                |  923 |
| telegram_access             |  248 |
| telegram_club_members       | 1285 |
| document_template_versions  |    1 |
| ai_generated_documents      |    0 |
| generated_documents (legacy)|    3 |
| fields_registry             |  209 |

Audit за последние 6 часов (revoke / kick / access):

```
live_access_granted                              397   ← штатный live-доступ
telegram.autokick.admin_protected                 13   ← защитный no-op
live_access_denied                                 4   ← штатный отказ
grant-access-for-order.skip_blocked_stale_access   1   ← штатный skip
```

Никаких массовых revoke / kick / mass-access событий, связанных с C3, нет.
SOT-таблицы доступов и оплат не затронуты.

---

## 3. Strict validator — DoD по legacy-placeholders

Реализация: `src/components/ai-documents/StrictDocumentTemplatesManager.tsx`
функция `strictValidate` (lines 78–112):

```ts
if (!STRICT_PLACEHOLDER_RE.test(inside)) {
  errors.push({
    code: "legacy_placeholder_format_detected",
    placeholder: `{{${inside}}}`,
    message: `В шаблоне найден старый формат … Используйте только {{field:FLD-XXXXXX}}.`,
  });
}
```

Activation guard (line 396–397):

```ts
if (ver.validation_status !== "valid") {
  toast.error("Активация заблокирована: validation_status != valid");
  return;
}
```

Сервер-сайд активация (`canonical-template-activate-version`) делает
повторную проверку `validation_status === 'valid'` перед `is_current = true`.

Live-доказательство (загруженный пользователем шаблон со старыми
`{{ld-...-...}}` плейсхолдерами):

```
id              : 426b6981-3882-441c-a9a8-3150230ef774
version_number  : 1
validation_status: invalid
validation_errors: 33
detected_tokens : 33
is_current      : false   ← активация заблокирована автоматически
```

DoD выполнен: legacy-placeholder → critical error → blocked activation.

---

## 4. Happy-path

Контур реализован и доступен:

- upload DOCX → `documents/templates/...` (private bucket)
- preview → mammoth client-side
- `canonical-template-apply-markup` → новая version, `token_manifest` по
  `field_public_id`, повторная strict-валидация
- `canonical-template-activate-version` → server-side activation с проверкой
  `validation_status='valid'` и `super_admin`
- `DealDocumentsPanel` → выбор активной версии, edit полей через
  `canonical-deal-fields-update` (записывает `manual_override:true` + audit)
- `canonical-document-generate-strict`:
  - dry-run preview → `can_generate: true/false` + список missing FLD
  - generate → DOCX в `documents/generated/...` + запись
    `ai_generated_documents`

Текущее состояние БД на момент verification:

- `ai_generated_documents`: 0 (новый pipeline ожидает первой генерации
  оператором — это требует загрузки strict-шаблона с FLD-разметкой,
  чего на dev-инстансе пока нет; единственный загруженный шаблон —
  legacy-формат, по дизайну заблокирован на этапе валидации).
- `generated_documents` (legacy): 3 — счётчик не растёт, новой UI/edge
  не используется (см. п. 5).

End-to-end UI-прогон оставлен оператору: wipe удалил все размеченные
шаблоны, и единственный путь получить `valid` версию — это загрузить
новый DOCX и пройти разметку через UI (TipTap-редактор будет в C4).

---

## 5. Legacy `generated_documents` — не используется

`rg` по новому pipeline:

- `canonical-document-generate-strict` пишет ТОЛЬКО в `ai_generated_documents`
- `DealDocumentsPanel` читает ТОЛЬКО `ai_generated_documents`
- `StrictDocumentTemplatesManager` не обращается к `generated_documents`

3 строки в `generated_documents` — артефакт legacy-генерации до wipe,
оставлены как историческая запись, новой UI не отображаются.

---

## 6. Feature flags

- auto-generation: OFF
- email-отправка сгенерированных документов: OFF
- Telegram-отправка сгенерированных документов: OFF
- batch-генерация: отсутствует в pipeline

Никаких клиентских уведомлений, никаких production auto-generation — не было
и не запланировано в C3.

---

## 7. UI-патч в составе C3-VERIFY

`TemplateMarkupDialog.FieldPicker` переписан с `Select` на `Popover + Command`
(cmdk) по образцу `TokenizedRichInput` из быстрых рассылок:

- курсор больше не вылетает из ячейки поиска (Radix Select перехватывал
  typeahead — с cmdk это не воспроизводится);
- фильтрация мгновенная (cmdk in-memory);
- выпадающий список рендерится в `PopoverContent` с явным
  `bg-popover` + `shadow-lg` + `z-[60]` — фон не «просвечивает»;
- ширина: `var(--radix-popover-trigger-width)` с `min-width: 420px`,
  чтобы помещались `FLD-XXXXXX` + label без обрезки и без выхода за края;
- поиск по `field_public_id`, `token_key`, `ui_label` — одной строкой.

Имена полей и `FLD-XXXXXX` рендерятся в одной строке: моно-FLD слева
фиксированной шириной, label справа `truncate`.

---

## DoD

- [x] Нет активных импортов legacy-сущностей в работающем коде.
- [x] Доступы / оплаты / подписки / Telegram не затронуты C3.
- [x] Strict validator блокирует legacy-плейсхолдеры (live evidence).
- [x] Активация требует `validation_status='valid'` (client + server).
- [x] `generated_documents` legacy не используется новой UI.
- [x] Все auto-flags выключены.
- [x] UI-баг с поиском полей в Markup-диалоге устранён.

Готов к C4 (TipTap inline-chips + падежи).
