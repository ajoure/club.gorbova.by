План: унификация скачивания пакетных DOCX/PDF с биллинговыми

## Diagnose

Биллинговые документы (`SubscriptionDocumentActions`, `OrderListItem`, `OrderDocuments`, админ-логи) скачиваются через canonical helper `downloadDocumentBlob(documentId, kind)` — он зовёт edge function `document-download`, получает blob, и через скрытый `<a download>` сразу сохраняет файл в «Загрузки». Никакого нового окна не открывается. Если пользователь потом сам кликает на скачанный файл, браузер открывает его в соседней вкладке — это поведение системы, нам трогать нечего.

Пакетные документы используют другой путь:
- `src/components/ai-documents/packages/PackageGenerationPanel.tsx` (строки 299–318)
- `src/components/ai-documents/packages/PackageGenerationHistory.tsx` (строки 107–122)

Там вместо `downloadDocumentBlob` стоит `<a href={getDocumentDownloadUrl(id, kind)} target="_blank" rel="noopener noreferrer">`. Это открывает страницу `/document-download/:id` (`DocumentDownloadPage`) в новой вкладке, и уже она внутри качает blob — отсюда лишнее окно и непривычное поведение по сравнению с биллингом.

## Решение

Заменить в этих двух местах ссылки на кнопки, которые вызывают тот же канонический `downloadDocumentBlob(id, "pdf"|"docx")`, что и биллинговые компоненты. Поведение станет идентичным: один клик → файл сразу в «Загрузки», без новой вкладки.

## Изменения (только UI, frontend-only)

1. `src/components/ai-documents/packages/PackageGenerationPanel.tsx`
   - Убрать `import { getDocumentDownloadUrl } from "@/utils/buildDocumentDownloadUrl"`.
   - Добавить `import { downloadDocumentBlob } from "@/utils/downloadDocumentBlob"` и `toast` (если ещё не импортирован — он там уже есть).
   - Заменить блок `<a ... PDF /></a> <a ... DOCX /></a>` на два `<button type="button" onClick={async () => { const r = await downloadDocumentBlob(r.document_id, "pdf"|"docx"); if (!r.ok) toast.error(r.message); }}>` с теми же иконками `FileDown` и текстом. Стили (`inline-flex items-center gap-1 text-[10px] text-indigo-600 hover:underline`) сохранить.

2. `src/components/ai-documents/packages/PackageGenerationHistory.tsx`
   - То же самое: убрать `getDocumentDownloadUrl`, импортировать `downloadDocumentBlob`, заменить два `<a>` на `<button>` с onClick → `downloadDocumentBlob(d.id, "pdf"|"docx")` + `toast.error` на ошибку. Стили сохранить.

`getDocumentDownloadUrl` и страница `/document-download/:id` остаются как есть — они нужны для email-ссылок в шаблонах и публичных кейсов; в UI пакетов их не используем.

## Что не трогаем

- Backend, edge functions, миграции, billing pipeline, Gotenberg.
- `src/pages/DocumentDownloadPage.tsx` — публичная страница для ссылок из email/уведомлений.
- `src/utils/buildDocumentDownloadUrl.ts` — используется в шаблонах писем.
- Sprint 3J-Roles артефакты не задеваются.

## DoD

- В `Пакеты документов → Запуск пакета` и в `История запусков` клик по «PDF»/«DOCX» сразу скачивает файл в «Загрузки», без новой вкладки.
- Поведение визуально и функционально идентично биллинговым актам (`/purchases`).
- Открытие уже скачанного файла из «Загрузок» по клику пользователя открывается в соседней вкладке браузера — это нативное поведение, отдельной работы не требует.
- Никаких изменений в backend, edge functions, миграциях, billing pipeline.
- При ошибке скачивания (`unauthorized` / `document_not_ready` / `download_failed`) показывается toast, как у биллинговых документов.
