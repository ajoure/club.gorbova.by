
# План v2: Исправление System Health + Функция игнорирования инвариантов

## Принятые коррекции

| Коррекция | Принято | Детали |
|-----------|---------|--------|
| Роль → `super_admin` | ✅ | В v2 системе код роли = `super_admin` (с подчёркиванием) |
| OPTIONS ≠ абсолютный truth | ✅ | Добавляем POST fallback при OPTIONS timeout |
| UNIQUE(check_key) → убрать | ✅ | Разрешаем несколько записей, активна = `expires_at IS NULL OR expires_at > now()` |
| Игнор ≠ OK визуально | ✅ | Muted секция с жёлтым индикатором и причиной |
| Добавить `source` колонку | ✅ | `manual`, `auto`, `migration` для post-mortem |

---

## STEP 1: Миграция — таблица `system_health_ignored_checks`

```sql
CREATE TABLE public.system_health_ignored_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_key TEXT NOT NULL,
  ignored_by UUID REFERENCES auth.users(id),
  reason TEXT NOT NULL,
  source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'auto', 'migration')),
  ignored_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ, -- NULL = permanent
  created_at TIMESTAMPTZ DEFAULT now()
  -- БЕЗ UNIQUE(check_key) — один check_key может иметь несколько записей
);

-- Индекс для быстрого поиска активных игноров
CREATE INDEX idx_ignored_checks_active ON system_health_ignored_checks (check_key) 
WHERE expires_at IS NULL OR expires_at > now();

-- RLS: только super_admin может читать/писать
ALTER TABLE system_health_ignored_checks ENABLE ROW LEVEL SECURITY;

-- Функция проверки super_admin через user_roles_v2
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM user_roles_v2 ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = _user_id
    AND r.code = 'super_admin'
  )
$$;

-- Политика: только super_admin может всё
CREATE POLICY "Super admins can manage ignored checks"
  ON system_health_ignored_checks
  FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));
```

---

## STEP 2: Исправление Edge Functions healthcheck

**Файл:** `src/hooks/useEdgeFunctionsHealth.ts`

### Изменения:

1. **Увеличить таймаут:** 10s → 15s
2. **Добавить POST fallback:** если OPTIONS timeout/error — пробуем POST с ping payload
3. **Новая логика статусов:**

```text
┌─────────────────────────────────────────────────────────────┐
│                   Edge Function Check Logic                  │
├─────────────────────────────────────────────────────────────┤
│ 1. OPTIONS запрос (15s timeout)                             │
│    ├─ 200/204 → status = "ok"                               │
│    ├─ 404 или body содержит NOT_FOUND → status = "not_found"│
│    └─ timeout/error → переход к шагу 2                      │
│                                                             │
│ 2. POST запрос (10s timeout, body: {"ping": true})          │
│    ├─ 200/401/400/403 → status = "ok" (функция существует)  │
│    ├─ 404 или NOT_FOUND → status = "not_found"              │
│    └─ timeout/error → status = "error"                      │
│                                                             │
│ Особые случаи:                                              │
│    • OPTIONS timeout + POST 200 → status = "ok" (slow cors) │
│    • OPTIONS 404 = абсолютный blocker, POST не нужен        │
└─────────────────────────────────────────────────────────────┘
```

4. **Новый статус "slow_preflight"** — OPTIONS таймаутит, но функция работает

---

## STEP 3: Обновить хук `useSystemHealthRuns.ts`

### Добавить:

```typescript
// Интерфейс для игнорируемых проверок
export interface IgnoredCheck {
  id: string;
  check_key: string;
  ignored_by: string;
  reason: string;
  source: "manual" | "auto" | "migration";
  ignored_at: string;
  expires_at: string | null;
}

// Хук для получения активных игноров
export function useIgnoredChecks() {
  return useQuery({
    queryKey: ["system-health-ignored"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_health_ignored_checks")
        .select("*")
        .or("expires_at.is.null,expires_at.gt.now()");
      if (error) throw error;
      return data as IgnoredCheck[];
    },
  });
}

// Мутация для добавления игнора (только super_admin)
export function useIgnoreCheck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ 
      checkKey, 
      reason, 
      expiresAt 
    }: { 
      checkKey: string; 
      reason: string; 
      expiresAt?: Date | null;
    }) => {
      const { error } = await supabase
        .from("system_health_ignored_checks")
        .insert({ 
          check_key: checkKey, 
          reason,
          expires_at: expiresAt?.toISOString() || null,
          source: "manual"
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-health-ignored"] });
      toast.success("Проверка добавлена в игнорируемые");
    },
    onError: (error) => {
      toast.error("Ошибка", { description: String(error) });
    },
  });
}

// Мутация для удаления игнора
export function useUnignoreCheck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("system_health_ignored_checks")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-health-ignored"] });
      toast.success("Игнорирование отменено");
    },
  });
}
```

---

## STEP 4: Новый компонент `IgnoreCheckDialog.tsx`

**Файл:** `src/components/admin/system-health/IgnoreCheckDialog.tsx`

UI элементы:
- Заголовок: "Игнорировать: {check_name}"
- Textarea: "Причина игнорирования" (обязательно)
- Switch: "Временно" + DatePicker для `expires_at`
- Предупреждение: "Игнорируемые проверки НЕ считаются пройденными"
- Кнопки: "Отмена" / "Игнорировать"

---

## STEP 5: Обновить `InvariantCheckCard.tsx`

### Изменения:

1. **Новый prop:** `isIgnored?: boolean`, `ignoredInfo?: IgnoredCheck`
2. **Новый variant:** `"ignored"` — жёлтый/muted стиль
3. **Кнопка "Игнорировать"** — только если `variant === "error"` и `isSuperAdmin`
4. **Отображение причины** — если `isIgnored`, показывать reason и expires_at

Визуальный контракт для ignored:
```text
┌──────────────────────────────────────────────────┐
│ 🟡 [muted bg] INV-8: Нет классификации           │
│     Игнорируется: 1070 исторических записей      │
│     До: 2026-03-01 (или "постоянно")             │
│     Кем: admin@example.com                       │
│     ────────────────────────────────             │
│     [Отменить игнорирование]                     │
└──────────────────────────────────────────────────┘
```

---

## STEP 6: Обновить `AdminSystemHealth.tsx`

### Изменения:

1. Подключить `useIgnoredChecks()` и `useHasRole('super_admin')` через хук `useSuperAdmin()`
2. Разделить проверки на 3 группы:

```text
┌─────────────────────────────────────────────────────────────┐
│ ❌ Требуют внимания (X)           ← failedChecks - ignored  │
├─────────────────────────────────────────────────────────────┤
│ 🟡 Игнорируемые (Y)               ← failedChecks ∩ ignored  │
│     [muted, collapsed by default]                           │
├─────────────────────────────────────────────────────────────┤
│ ✅ Пройдено (Z)                   ← passedChecks            │
└─────────────────────────────────────────────────────────────┘
```

3. Передавать `isSuperAdmin` в `InvariantCheckCard` для показа кнопки игнорирования

---

## STEP 7: Хук `useSuperAdmin`

**Файл:** `src/hooks/useSuperAdmin.ts`

```typescript
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useSuperAdmin() {
  return useQuery({
    queryKey: ["is-super-admin"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;
      
      const { data, error } = await supabase
        .rpc("is_super_admin", { _user_id: user.id });
      
      if (error) {
        console.error("useSuperAdmin error:", error);
        return false;
      }
      return data === true;
    },
  });
}
```

---

## Структура файлов

```text
src/
├── hooks/
│   ├── useEdgeFunctionsHealth.ts     # MODIFY: POST fallback, 15s timeout
│   ├── useSystemHealthRuns.ts        # MODIFY: add ignore hooks
│   └── useSuperAdmin.ts              # NEW: проверка super_admin
├── components/admin/system-health/
│   ├── InvariantCheckCard.tsx        # MODIFY: ignore button, ignored variant
│   ├── IgnoreCheckDialog.tsx         # NEW: диалог игнорирования
│   └── EdgeFunctionsHealth.tsx       # (без изменений)
└── pages/admin/
    └── AdminSystemHealth.tsx         # MODIFY: 3 группы проверок

supabase/migrations/
└── 20260206_ignored_checks.sql       # NEW: таблица + RLS + функция
```

---

## DoD Checklist

| Проверка | Ожидаемый результат |
|----------|---------------------|
| Edge Functions: таймаут | 15s (вместо 10s) |
| Edge Functions: POST fallback | При OPTIONS timeout → POST ping |
| Edge Functions: меньше "Load failed" | Retry + fallback logic |
| Инварианты: кнопка "Игнорировать" | Видна ТОЛЬКО super_admin |
| Инварианты: 3 секции | Ошибки / Игнорируемые / Пройдено |
| Игнорируемые: визуально muted | Жёлтый индикатор, НЕ зелёный |
| Игнорируемые: показывает причину | Reason + expires_at + кем |
| БД: таблица с `source` колонкой | manual / auto / migration |
| БД: нет UNIQUE(check_key) | Несколько записей разрешено |
| RLS: только super_admin | Проверка через `user_roles_v2.roles.code = 'super_admin'` |

---

## Приоритет выполнения

1. **P0:** Миграция БД (таблица + RLS)
2. **P0:** `useSuperAdmin` хук
3. **P1:** Edge Functions healthcheck fix (POST fallback)
4. **P1:** Ignore hooks в `useSystemHealthRuns.ts`
5. **P2:** `IgnoreCheckDialog.tsx`
6. **P2:** Обновление `InvariantCheckCard.tsx`
7. **P2:** Обновление `AdminSystemHealth.tsx` (3 группы)
