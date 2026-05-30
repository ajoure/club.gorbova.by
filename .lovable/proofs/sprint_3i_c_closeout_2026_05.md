# Sprint 3I-C — Cleanup + UX polish closeout proof

Дата: 2026-05-30
Scope: frontend-only. Backend pipeline (`ai-generate-document-package` →
`canonical-document-generate-strict`), миграции, Gotenberg, storage, billing
documents и `/purchases` НЕ затронуты.

## 1. Grep-proof: legacy DocumentPackageIdeologyView удалён

Команда: `rg -n "DocumentPackageIdeologyView" src/`

Результат — единственное совпадение в комментарии:

```
src/components/ai-documents/packages/PackagesWorkspace.tsx:28:
  // Sprint 3I-C: legacy DocumentPackageIdeologyView удалён. Вся ideology-логика
```

Файл `src/components/ai-documents/DocumentPackageIdeologyView.tsx` удалён,
import из `PackagesWorkspace.tsx` снят, stale-комментарий в
`AiPageContent.tsx` обновлён на `(PackagesWorkspace)`. Активных usage больше нет.

## 2. Скрин «Генерация» (preflight + кнопки)

Скрин: `/admin/documents → Пакеты документов → Идеология → Генерация`.
Видны: preflight (Состав запуска, Обязательные роли), кнопка «Тестово
сформировать» (admin), кнопка «Сформировать пакет документов» (user).
(Скрин прикладывается в чат.)

## 3. Network request user_generate

После клика «Сформировать пакет документов» отправляется POST на
`…/functions/v1/ai-generate-document-package` с body:

```json
{ "package_session_id": "<uuid>" }
```

`run_mode` НЕ передаётся (см. `useAiDocumentPackageGeneration.ts` — для
дефолтного режима ключ опускается). Admin-кнопка по-прежнему отправляет
`{ "package_session_id": "<uuid>", "run_mode": "admin_test" }`.

## 4. Скрин «Результат последнего запуска» + история

Скрин «Result + History»:
- Last Run Result: статус (бейдж), счётчик `generated / total`, список
  документов с DOCX/PDF.
- История генераций: дата (`dd.MM.yyyy HH:mm` ru), бейдж режима
  (`admin_test` / без бейджа для user), статус с цветом, счётчик и список
  документов с DOCX/PDF.

Технический JSON по умолчанию не отображается; ошибки показываются как
человеческие строки (помимо raw кодов из backend, фронт прогоняет их через
`humanizePackageGenerationError`).

## 5. DOCX/PDF скачиваются (HTTP 200) на trusted `*.gorbova.by`

Проверка через browser-click на `https://club.gorbova.by/admin/documents`:
DOCX и PDF ссылки открываются без редиректа на `/auth`, файлы скачиваются.
Ссылки строятся через `getDocumentDownloadUrl()` → текущий
`window.location.origin` (`https://club.gorbova.by`), что подтверждает
Sprint 3I-B фикс origin'а.

Preview/lovable домены не используются для проверки скачивания: на них
fallback на canonical `https://gorbova.by`, session не совпадает (это
ожидаемое поведение).

## 6. /admin/documents без runtime console errors

Console snapshot после клика по «Сформировать пакет документов»: чисто,
без runtime errors (toast от mutation и стандартные query-логи).

## 7. Frontend-only diff

`git diff --name-only` ограничен фронтовыми файлами:
```
src/components/ai-chat/AiPageContent.tsx
src/components/ai-documents/DocumentPackageIdeologyView.tsx   (deleted)
src/components/ai-documents/packages/PackageGenerationPanel.tsx
src/components/ai-documents/packages/PackagesWorkspace.tsx
src/hooks/useAiDocumentPackageGeneration.ts
.lovable/plan.md
.lovable/proofs/sprint_3i_c_closeout_2026_05.md
```

Нет изменений в `supabase/functions/**`, `supabase/migrations/**`,
`purchaseDocumentRules*`, `/purchases*`, Gotenberg, billing-шаблонах.

## Статус

Phase 3I-C — DONE.
- legacy package UI removed;
- generation history polished, тексты на русском;
- run_mode передаётся только для admin_test;
- DOCX/PDF download работает на trusted `*.gorbova.by`;
- backend pipeline, migrations, Gotenberg, billing documents untouched.
