# Phase 3I — Document Packages UI

## Phase 3I-B — CLOSED

UI generation tab implemented и проверен live:
- подвкладка «Генерация» внутри `PackagesWorkspace` (Состав / Шаблоны /
  Анкеты / Роли / Проверка / Генерация);
- user + admin кнопки запуска, history фильтруется по
  `meta->>package_session_id`;
- гидратация выбранного ЮЛ исправлена через `sessionQuery.isFetched`;
- DOCX/PDF download переключены на текущий trusted `*.gorbova.by` origin
  (`getPublicAppBaseUrl`) — session не теряется на `club.gorbova.by`;
- backend pipeline, edge functions, migrations, Gotenberg, billing
  documents untouched.

## Phase 3I-C — DONE

Cleanup + UX polish (frontend-only):
- legacy `DocumentPackageIdeologyView.tsx` удалён, import снят, stale
  ссылка в `AiPageContent.tsx` обновлена;
- `useAiDocumentPackageGeneration` для user-запуска отправляет только
  `{ package_session_id }` (run_mode опускается, default backend),
  admin_test — явно;
- ошибки маппятся через `humanizePackageGenerationError`, сырые коды
  пользователю не показываются;
- toast'ы и empty-states на русском, статусы локализованы;
- история генераций показывает дату (ru), режим (бейдж admin_test),
  статус (цветной бейдж), счётчик и DOCX/PDF.

Proof: `.lovable/proofs/sprint_3i_c_closeout_2026_05.md`.
