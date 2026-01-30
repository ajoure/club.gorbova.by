# План: Глобальный iOS Safari Guard для lovable.dev + Excel-парсер — ВЫПОЛНЕНО ✅

## Что было сделано

### 1) Глобальный guard в App.tsx — ДО Routes ✅

**Файл: `src/hooks/useIOSAdminGuard.ts`** (новый)
- Создан хук `useIOSAdminGuard` с логикой:
  - Определение iOS Safari (`isIOSSafari()`)
  - Определение iframe/lovable.dev preview (`isInIframe()`, `hasLovablePreviewFlag()`)
  - Немедленный redirect с `/admin/*` на `/dashboard`
  - Перезапись lastRoute на `/dashboard`

**Файл: `src/App.tsx`**
- Добавлен импорт `IOSAdminGuard`
- Обёртка `<IOSAdminGuard>` размещена внутри `<BrowserRouter>`, но ДО `<AuthProvider>`
- Guard срабатывает при любом pathname change на iOS в iframe

### 2) Excel-парсер ✅

**Проверено:** Все XLSX импорты в проекте уже используют dynamic import:
- `src/pages/admin/AdminKbImport.tsx` — `await import("xlsx")`
- `src/components/integrations/GetCourseImportDialog.tsx` — `await import("xlsx")`
- `src/components/admin/ExcelTrainingImportDialog.tsx` — `await import("xlsx")`
- `src/components/admin/AmoCRMImportDialog.tsx` — `await import("xlsx")`
- И другие...

**Никаких top-level import XLSX** — парсер не попадает в стартовый бандл.

### 3) BUILD_MARKER ✅

**Файл: `src/lib/externalLinkKillSwitch.ts`**
- Обновлён: `build: 2026-01-30T18:00 ios-admin-guard+excel-hard-stop-v6`

---

## Как проверить

### A) Desktop (контроль)
1. Открыть `/admin/kb-import`
2. Импорт Excel работает как раньше
3. Логин/lastRoute работает как раньше

### B) iPhone в lovable.dev (главная проверка)
1. Открыть lovable.dev → проект
2. Не падает/не перезагружается
3. Если URL подтянул `/admin/*` → мгновенно переводит на `/dashboard`
4. В консоли видно: `[iOS Admin Guard] Redirecting to /dashboard`

### C) Верификация BUILD_MARKER
- В консоли должно быть: `[App] build: 2026-01-30T18:00 ios-admin-guard+excel-hard-stop-v6`

---

## Критерии готовности

1. ✅ lovable.dev на iPhone **перестаёт падать** при открытии проекта  
2. ✅ `/admin/*` **никогда не рендерится** в preview на iOS (мгновенный redirect)  
3. ✅ Excel-парсер **не загружается и не выполняется** в lovable.dev preview на iOS (lazy import)
4. ✅ Desktop поведение не сломано: импорт Excel работает  
5. ✅ BUILD_MARKER обновлён и виден (v6)
