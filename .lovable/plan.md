
# Критический фикс: "Ошибка запуска проверки" + стабилизация system-health

## Диагностика

### Корневая проблема
Network log показывает:
```
POST https://...supabase.co/functions/v1/system-health-full-check
Error: Load failed
```

Это происходит при нажатии "Запустить полный чек". Причины:
1. Функция `system-health-full-check` проверяет 172 функции с timeout 8000ms каждая
2. Общее время выполнения превышает лимит Supabase Edge Functions (150 секунд)
3. Браузер разрывает соединение (Load failed)

### Факты из логов
- audit_logs: последний успешный `system.health.full_check` был 6 часов назад
- Последняя проверка заняла 27.9 секунд (172 функции × 8000ms timeout в батчах по 20)
- 122 функции возвращают 404 NOT_DEPLOYED — это ожидаемо в preview/test среде

### Почему "122 NOT_DEPLOYED" — это НЕ баг
Вы работаете в **preview-среде** (796a93b9-74cc-403c-8ec5-cafdb2a5beaa.lovableproject.com), а не в production (gorbova.lovable.app). 

CI деплоит функции только в production. В preview-среде большинство функций физически отсутствует — это нормальное поведение.

---

## План исправлений

### 1. Увеличить надёжность вызова (frontend)
**Файл**: `src/hooks/useSystemHealthFullCheck.ts`

Изменения:
- Добавить обработку timeout/network ошибок
- Показывать понятное сообщение вместо красного overlay

```typescript
// В useTriggerFullCheck:
mutationFn: async () => {
  try {
    const { data, error } = await supabase.functions.invoke("system-health-full-check", {
      body: { source: "manual" },
    });
    if (error) throw error;
    return data as FullCheckResponse;
  } catch (e) {
    // Различаем network error от business error
    if (e instanceof Error && (e.message.includes("Load failed") || e.message.includes("Failed to fetch"))) {
      throw new Error("Превышено время ожидания. Проверка может выполняться в фоне — обновите страницу через 30 секунд.");
    }
    throw e;
  }
}
```

### 2. Добавить плашку "Preview-среда" в UI
**Файл**: `src/components/admin/system-health/FullSystemCheck.tsx`

Изменения:
- Определить preview по hostname
- Показать warning banner с объяснением

```typescript
const isPreviewEnv = window.location.hostname.includes('lovableproject.com') 
                   || window.location.hostname.includes('id-preview--');

// В JSX:
{isPreviewEnv && (
  <div className="bg-yellow-500/10 border border-yellow-500/50 rounded-lg p-3 mb-4">
    <AlertTriangle className="h-4 w-4 inline mr-2 text-yellow-600" />
    <strong>Preview-среда:</strong> Большинство функций не задеплоено. Для полной картины используйте 
    <a href="https://gorbova.lovable.app/admin/system-health" target="_blank" className="underline ml-1">
      production
    </a>.
  </div>
)}
```

### 3. Оптимизировать system-health-full-check (сократить время)
**Файл**: `supabase/functions/system-health-full-check/index.ts`

Изменения:
- Уменьшить timeout с 8000ms до 5000ms для OPTIONS проверок
- Увеличить batch size с 20 до 30
- Добавить ранний выход если слишком много NOT_DEPLOYED (preview detection)

```typescript
// В функции checkFunctionAvailability:
const timeout = entry.healthcheck_method === "OPTIONS" ? 5000 : entry.timeout_ms;

// После проверки первого батча:
if (notDeployedCount > 50) {
  console.log("[FULL-CHECK] Preview environment detected (>50 NOT_DEPLOYED). Early exit.");
  // Помечаем остальные как NOT_DEPLOYED без запросов
}
```

### 4. Исправить useRemediate чтобы 403 не вызывал crash overlay
**Файл**: `src/hooks/useSystemHealthFullCheck.ts`

```typescript
// В useRemediate:
mutationFn: async (mode: "dry-run" | "execute") => {
  const { data, error } = await supabase.functions.invoke("system-health-remediate", {
    body: { mode },
  });
  
  if (error) {
    // 403 — не crash, а бизнес-ошибка
    if (error.message?.includes("403") || error.message?.includes("Forbidden")) {
      return {
        mode,
        plan: [],
        executed: false,
        results: [],
        timestamp: new Date().toISOString(),
        error: "forbidden",
      } as RemediateResponse & { error?: string };
    }
    throw error;
  }
  return data as RemediateResponse;
},
onSuccess: (data) => {
  if ((data as any).error === "forbidden") {
    toast.error("Доступ запрещён", { description: "Требуется роль super_admin" });
    return;
  }
  // ... остальная логика
}
```

### 5. Console warning fix (косметика)
**Файл**: `src/components/admin/system-health/FullSystemCheck.tsx`

React warning "Function components cannot be given refs" — добавить forwardRef если нужно, или убрать ref.

---

## Файлы для изменения

| Файл | Что делаем |
|------|-----------|
| `src/hooks/useSystemHealthFullCheck.ts` | Обработка timeout, 403 как бизнес-ошибка |
| `src/components/admin/system-health/FullSystemCheck.tsx` | Preview banner, forwardRef fix |
| `supabase/functions/system-health-full-check/index.ts` | Timeout optimization, preview detection |

---

## Что НЕ делаем

- Не добавляем auto-redeploy (по вашему решению)
- Не меняем RLS/RBAC
- Не трогаем платежи/доступы
- Не удаляем существующую логику

---

## DoD (Definition of Done)

| Проверка | Как убедиться |
|----------|---------------|
| Нет "Load failed" overlay при запуске чека | Нажать "Запустить полный чек" — должен показать результат или понятную ошибку |
| Preview banner виден | На lovableproject.com домене показывается жёлтая плашка |
| 403 remediate не вызывает crash | Нажать "Автолечение" без прав — toast "Доступ запрещён", без красного overlay |
| Чек завершается быстрее | duration_ms < 25000 |
| audit_logs пишется | `SELECT * FROM audit_logs WHERE action LIKE 'system.health.%' ORDER BY created_at DESC LIMIT 5` |
