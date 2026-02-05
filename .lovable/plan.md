
# План: Канонический reset прогресса через Edge Function

## Анализ проблемы

### Текущее состояние
1. **Прогресс хранится в 2 таблицах:**
   - `lesson_progress_state` — state_json с role, completedSteps, currentStepIndex, videoProgress, pointA_rows, pointB_answers
   - `user_lesson_progress` — ответы на тесты (response, is_correct, score)

2. **Текущий reset работает с клиента:**
   - `useLessonProgressState.reset()` — делает DELETE/UPSERT напрямую
   - `useUserProgress.resetLessonProgress()` — делает DELETE напрямую
   - Проблема: RLS может блокировать операции, состояние "залипает"

3. **Impersonation:**
   - Когда админ "входит как пользователь", `auth.user.id` = id импесонируемого пользователя
   - НЕТ отдельного `effectiveUserId` — просто используется `user.id` из текущей сессии
   - Значит reset уже работает по правильному user_id

4. **Проблема "залипания":**
   - `updateState()` делает merge через spread: `{ ...currentState, ...partial }`
   - Если установить `role: undefined`, ключ остаётся (JS: `undefined` не удаляет ключ)
   - После reset + hard refresh данные остаются

---

## Решение: Edge Function `reset-lesson-progress`

### PATCH-1: Создать Edge Function

**Файл:** `supabase/functions/reset-lesson-progress/index.ts`

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ResetRequest {
  lesson_id: string;
  target_user_id?: string;  // Для admin/impersonation
  scope: "quiz_only" | "lesson_all";
  block_id?: string;        // Для quiz_only — конкретный блок
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Verify JWT and get caller
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user: caller }, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !caller) {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const body: ResetRequest = await req.json();
    const { lesson_id, target_user_id, scope, block_id } = body;

    // STOP-guard: required params
    if (!lesson_id || !scope) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing lesson_id or scope' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Determine effective user_id
    // If target_user_id provided (admin mode), verify caller is admin
    let effectiveUserId = caller.id;
    if (target_user_id && target_user_id !== caller.id) {
      // Check if caller is admin
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', caller.id)
        .single();
      
      if (profile?.role !== 'admin' && profile?.role !== 'superadmin') {
        return new Response(JSON.stringify({ ok: false, error: 'Admin required for target_user_id' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      effectiveUserId = target_user_id;
    }

    const result = { 
      affected: { lesson_progress_state: 0, user_lesson_progress: 0 },
      clearedKeys: [] as string[]
    };

    if (scope === 'lesson_all') {
      // Full reset: delete both tables
      const { count: lpsCount } = await supabase
        .from('lesson_progress_state')
        .delete({ count: 'exact' })
        .eq('user_id', effectiveUserId)
        .eq('lesson_id', lesson_id);

      const { count: ulpCount } = await supabase
        .from('user_lesson_progress')
        .delete({ count: 'exact' })
        .eq('user_id', effectiveUserId)
        .eq('lesson_id', lesson_id);

      result.affected.lesson_progress_state = lpsCount || 0;
      result.affected.user_lesson_progress = ulpCount || 0;
      result.clearedKeys = ['*'];

    } else if (scope === 'quiz_only') {
      // Quiz-only reset
      if (block_id) {
        // Delete specific block from user_lesson_progress
        const { count } = await supabase
          .from('user_lesson_progress')
          .delete({ count: 'exact' })
          .eq('user_id', effectiveUserId)
          .eq('lesson_id', lesson_id)
          .eq('block_id', block_id);
        result.affected.user_lesson_progress = count || 0;
      }

      // Update lesson_progress_state: clear quiz keys
      const { data: current } = await supabase
        .from('lesson_progress_state')
        .select('state_json')
        .eq('user_id', effectiveUserId)
        .eq('lesson_id', lesson_id)
        .maybeSingle();

      if (current?.state_json) {
        const stateJson = current.state_json as Record<string, unknown>;
        const keysToRemove = ['role', 'quiz_result', 'quiz_answers'];
        
        // Build new state without quiz keys
        const newState: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(stateJson)) {
          if (!keysToRemove.includes(key)) {
            newState[key] = value;
          }
        }
        
        // Remove block_id from completedSteps
        if (block_id && Array.isArray(newState.completedSteps)) {
          newState.completedSteps = (newState.completedSteps as string[])
            .filter(id => id !== block_id);
        }
        
        // Reset currentStepIndex
        newState.currentStepIndex = 0;

        const { count } = await supabase
          .from('lesson_progress_state')
          .update({ 
            state_json: newState,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', effectiveUserId)
          .eq('lesson_id', lesson_id);

        result.affected.lesson_progress_state = count || 0;
        result.clearedKeys = [...keysToRemove, 'completedSteps.block', 'currentStepIndex'];
      }
    }

    // Log without PII
    console.log(`[reset-lesson-progress] scope=${scope}, user=${effectiveUserId.slice(0,8)}, lesson=${lesson_id.slice(0,8)}, affected=${JSON.stringify(result.affected)}`);

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[reset-lesson-progress] Error:', error);
    return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
```

### PATCH-2: Добавить конфиг

**Файл:** `supabase/config.toml` (добавить)
```toml
[functions.reset-lesson-progress]
verify_jwt = false
```

---

### PATCH-3: Frontend — создать хук `useResetProgress`

**Файл:** `src/hooks/useResetProgress.ts`

```typescript
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

interface ResetResult {
  ok: boolean;
  affected?: { lesson_progress_state: number; user_lesson_progress: number };
  clearedKeys?: string[];
  error?: string;
}

export function useResetProgress() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const resetProgress = async (
    lessonId: string,
    scope: "quiz_only" | "lesson_all",
    blockId?: string,
    targetUserId?: string  // For admin impersonation
  ): Promise<ResetResult> => {
    if (!user) return { ok: false, error: 'Not authenticated' };

    try {
      const { data, error } = await supabase.functions.invoke('reset-lesson-progress', {
        body: {
          lesson_id: lessonId,
          target_user_id: targetUserId,
          scope,
          block_id: blockId,
        }
      });

      if (error) throw error;

      // Invalidate all progress queries
      queryClient.invalidateQueries({ queryKey: ['lesson-progress'] });
      queryClient.invalidateQueries({ queryKey: ['user-progress', lessonId] });

      console.log(`[useResetProgress] Reset complete: scope=${scope}, lesson=${lessonId.slice(0,8)}`);
      return data as ResetResult;

    } catch (error: any) {
      console.error('[useResetProgress] Error:', error);
      return { ok: false, error: error.message };
    }
  };

  return { resetProgress };
}
```

---

### PATCH-4: Обновить AdminLessonBlockEditor

**Файл:** `src/pages/admin/AdminLessonBlockEditor.tsx`

Заменить прямые вызовы reset на Edge Function:

```typescript
// Импорт
import { useResetProgress } from "@/hooks/useResetProgress";

// В компоненте
const { resetProgress: resetViaEdge } = useResetProgress();

// Кнопка "Сбросить прогресс"
onClick={async () => {
  try {
    const result = await resetViaEdge(lessonId!, 'lesson_all');
    
    if (!result.ok) {
      toast.error(`Ошибка: ${result.error}`);
      return;
    }

    // Force refetch
    await refetch();
    
    console.log('[AdminReset] Done:', result);
    toast.success(`Прогресс сброшен: удалено ${result.affected?.lesson_progress_state || 0} + ${result.affected?.user_lesson_progress || 0} записей`);
  } catch (error) {
    console.error('[AdminReset] Error:', error);
    toast.error("Ошибка сброса прогресса");
  }
}}
```

---

### PATCH-5: Обновить QuizSurveyBlock — reset через Edge Function

**Файл:** `src/components/lesson/LessonBlockRenderer.tsx`

Передать lessonId и blockId в onReset:

```typescript
case 'quiz_survey':
  return (
    <QuizSurveyBlock 
      ...
      onReset={async () => {
        // Вызов канонического reset через пропс, переданный из KvestLessonView
        await kvestProps?.onQuizReset?.();
      }}
    />
  );
```

**Файл:** `src/components/lesson/KvestLessonView.tsx`

Заменить локальный reset на Edge Function:

```typescript
// Импорт
import { useResetProgress } from "@/hooks/useResetProgress";

// В компоненте
const { resetProgress: resetViaEdge } = useResetProgress();

// handleQuizSurveyReset
const handleQuizSurveyReset = useCallback(async (blockId: string) => {
  console.log('[KvestLessonView] Quiz reset via Edge Function:', blockId.slice(0, 8));
  
  const result = await resetViaEdge(lesson.id, 'quiz_only', blockId);
  
  if (!result.ok) {
    console.error('[KvestLessonView] Reset failed:', result.error);
    return;
  }

  // Force refetch state from DB (Edge Function already cleared it)
  // Local state will update via useLessonProgressState refetch
  console.log('[KvestLessonView] Reset success:', result);
}, [lesson.id, resetViaEdge]);
```

---

### PATCH-6: Убрать "залипание" — useLessonProgressState

**Файл:** `src/hooks/useLessonProgressState.tsx`

Заменить локальный reset на вызов Edge Function + refetch:

```typescript
// Импорт вверху
import { useQueryClient } from "@tanstack/react-query";

// Функция reset — теперь только refetch после edge function
const reset = useCallback(async () => {
  // Больше не делаем delete/upsert из клиента
  // Edge Function уже всё сделала
  // Просто очищаем локальный state и делаем refetch
  
  if (saveTimeoutRef.current) {
    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = null;
  }
  
  setRecord(null);
  pendingStateRef.current = null;
  
  queryClient.invalidateQueries({ queryKey: ['lesson-progress'] });
  
  // Refetch from DB
  await fetchState();
  
  return { ok: true };
}, [fetchState, queryClient]);
```

---

## Файлы для создания/изменения

| Файл | Действие |
|------|----------|
| `supabase/functions/reset-lesson-progress/index.ts` | CREATE |
| `supabase/config.toml` | ADD entry |
| `src/hooks/useResetProgress.ts` | CREATE |
| `src/pages/admin/AdminLessonBlockEditor.tsx` | UPDATE — использовать useResetProgress |
| `src/components/lesson/KvestLessonView.tsx` | UPDATE — handleQuizSurveyReset через Edge |
| `src/hooks/useLessonProgressState.tsx` | UPDATE — упростить reset() |

---

## DoD (тест-кейсы)

### A) "Пройти тест ещё раз"
1. Пройти quiz_survey, увидеть результат
2. Нажать "Пройти тест ещё раз"
3. **SQL-проверка:** `SELECT * FROM user_lesson_progress WHERE lesson_id=X AND block_id=Y` → 0 rows
4. **SQL-проверка:** `SELECT state_json FROM lesson_progress_state WHERE lesson_id=X` → role=null, currentStepIndex=0
5. **UI:** отображается первый вопрос
6. **Hard refresh:** всё ещё первый вопрос

### B) "Сбросить прогресс" в админке
1. Нажать кнопку "Сбросить прогресс"
2. **SQL-проверка:** `SELECT * FROM lesson_progress_state WHERE lesson_id=X` → 0 rows
3. **SQL-проверка:** `SELECT * FROM user_lesson_progress WHERE lesson_id=X` → 0 rows
4. **UI:** квест начинается с шага 1
5. **Hard refresh:** квест всё ещё на шаге 1

### C) Логи без PII
- Проверить console.log — только ids (first 8 chars), scope, affected counts
- Никаких email/answers/role values

---

## STOP-guards в Edge Function

1. ✅ `lesson_id` и `scope` — обязательные параметры
2. ✅ `target_user_id` — только для admin/superadmin
3. ✅ Нет batch mode — только один урок за раз
4. ✅ Service role key — обходит RLS
5. ✅ Логи без PII
