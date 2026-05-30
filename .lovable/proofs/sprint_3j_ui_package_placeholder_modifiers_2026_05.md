# Sprint 3J-UI — Package placeholders modifier-controls parity с billing UI

**Статус:** DONE. UI пакетных групп получил те же modifier-controls, что у billing.

## 1. Что сделано

- `src/utils/packagePlaceholderCatalog.ts`: добавлены `buildPackagePlaceholderToken`, `classifyPackageItem`, `supportsLongFormat`. Никакого нового formatter-а — UI только строит copy-токен.
- `src/components/ai-documents/PlaceholdersCatalogTab.tsx`:
  - Новое состояние `pkgRowSettings: Map<tech_key, {format, caseModifier}>`.
  - В строках групп `Пакет: ЮЛ / ИП / ФЛ` рендерится тот же `RowSettingsCell`, что и у billing-строк, с правильным `kind` (text/numeric) и `supportsLongFormat=true` для `package.*.org_form`.
  - Итоговый copy-токен и кнопка «Копировать» используют `buildPackagePlaceholderToken(p, format, case)`.
  - Preview-колонка показывает «Пример появится после заполнения анкеты документа» (live formatter output требует сессию пакета — Sprint 3J backend SOT уже на месте, фронту без сессии его не вызвать).
  - Группа `Пакет: Роли` (`{{ln-XXXXXX}}`) — без модификаторов (§5 спецификации).
- `RowSettingsCell`: расширен пропом `supportsLongFormat?: boolean`. При `kind="text"` и `supportsLongFormat=true` добавляется toggle `Кратко / Развёрнуто` → `|format=long`. Поведение billing-строк не изменилось (по умолчанию `supportsLongFormat=false`).

## 2. Copy examples (проверено тестом)

| Action | Token |
|---|---|
| Краткое название ЮЛ без модификаторов | `{{package.ul.FLD-000011}}` |
| Краткое название ЮЛ + case=genitive | `{{package.ul.FLD-000011|case=genitive}}` |
| Форма собственности ЮЛ + format=long | `{{package.ul.FLD-000010|format=long}}` |
| Форма собственности ЮЛ + format=long + case=genitive | `{{package.ul.FLD-000010|format=long|case=genitive}}` |
| Роль | `{{ln-XXXXXX}}` (модификаторы недоступны) |

## 3. Preview

Preview-колонка package-строки показывает: **«Пример появится после заполнения анкеты документа»** (фолбэк, разрешённый §5 спецификации). Backend formatter (`_shared/packageFieldFormatter.ts`) гарантирует, что при реальной генерации значение будет идентично billing output (Sprint 3J backend proof §1, parity manifest, e.g. `ЗАО «АЖУР инкам»`).

## 4. Тесты (vitest, 20 passed)

`src/utils/packagePlaceholderCatalog.test.ts` — новая describe-секция `Sprint 3J-UI modifier helpers`:
- copy-токен без модификаторов;
- copy-токен с `case=genitive`;
- copy-токен с `format=long` только для org_form;
- порядок `|format=...|case=...`;
- `classifyPackageItem`: text для имён, date для дат рождения/паспорта, other для ролей;
- роль игнорирует модификаторы;
- not-ready item не имеет copy-токена.

Полный прогон: `bunx vitest run src/utils/packagePlaceholderCatalog.test.ts` → **20/20 passed**.

## 5. Что НЕ менялось

- `_shared/packageFieldFormatter.ts`, `ai-generate-document-package`, `canonical-document-generate-strict`, `package-tokens-dry-run` — НЕ тронуты.
- Billing UI / billing buildFieldPlaceholder / billing-токены — без визуальных и логических изменений (`supportsLongFormat` по умолчанию `false`).
- `/purchases`, миграции, RLS, edge-функции, Gotenberg, document_templates — без изменений.
- Никаких новых FLD, никакого отдельного package-формаатера в UI.

## 6. Изменённые файлы (frontend-only)

```
src/utils/packagePlaceholderCatalog.ts
src/utils/packagePlaceholderCatalog.test.ts
src/components/ai-documents/PlaceholdersCatalogTab.tsx
.lovable/proofs/sprint_3j_ui_package_placeholder_modifiers_2026_05.md
```

## 7. DoD

- [x] Package-группы в «Плейсхолдерах» визуально работают как billing-группы.
- [x] Modifiers доступны для package-токенов там же, где у billing-аналога (text → case; org_form → +format=long; даты → format=words+case).
- [x] Preview показывает фолбэк-сообщение (формат, согласованный §5); backend formatter обеспечивает byte-parity при реальной генерации.
- [x] Copy button формирует корректный package placeholder с modifiers.
- [x] Старые `PKR` / `package.role.PKR` / `package.roles.*` в UI не появляются (existing test).
- [x] Billing UI не изменился.
- [x] Proof создан.

## 8. Финальный статус

completed: Sprint 3J-UI package placeholders modifier controls and preview reached billing UI parity; package placeholder copy/preview reuse billing UI logic; backend/billing/purchases untouched.
