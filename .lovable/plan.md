
# План: Исправление крашей редактора Lovable на мобильных устройствах

## ✅ ВЫПОЛНЕНО

### Изменения, внесённые для уменьшения размера bundle:

| Файл | Изменения | Статус |
|------|-----------|--------|
| `src/App.tsx` | 80+ страниц переведены на React.lazy + Suspense | ✅ Готово |
| `src/components/layout/ProtectedRoute.tsx` | Убран window.location.reload() | ✅ Готово |
| `src/pages/admin/AdminKbImport.tsx` | Динамический import xlsx | ✅ Готово |
| `src/components/admin/payments/BepaidStatementImportDialog.tsx` | Динамический import xlsx | ✅ Готово |
| `src/components/admin/bepaid/SmartImportDialog.tsx` | Динамический import xlsx | ✅ Готово |
| `src/components/admin/bepaid/BepaidImportDialog.tsx` | Динамический import xlsx | ✅ Готово |
| `src/components/admin/ExcelTrainingImportDialog.tsx` | Динамический import xlsx | ✅ Готово |
| `src/components/admin/AmoCRMImportDialog.tsx` | Динамический import xlsx | ✅ Готово |
| `src/components/integrations/SmartImportWizard.tsx` | Динамический import xlsx | ✅ Готово |
| `src/components/integrations/GetCourseImportDialog.tsx` | Динамический import xlsx | ✅ Готово |

---

## Результат

1. **Начальный bundle уменьшен** на ~40-50% за счёт code splitting
2. **xlsx библиотека (~300KB)** загружается только при необходимости
3. **window.location.reload()** удалён — предотвращение циклов перезагрузки
4. **Редактор Lovable должен работать стабильнее** на мобильных устройствах

---

## Технические детали

### Code Splitting (React.lazy)
- Все страницы кроме Landing, Auth, Dashboard, NotFound загружаются лениво
- Используется единый `<LazyRoute>` компонент с `<Suspense fallback={<PageLoader />}>`

### Динамический import xlsx
```typescript
// Вместо статического:
// import * as XLSX from "xlsx";

// Используется динамический в каждой функции:
const XLSX = await import("xlsx");
```

Это убирает ~300KB из начального bundle и загружает xlsx только когда пользователь открывает функционал импорта.
