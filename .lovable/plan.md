

# PATCH: Исправление ошибок сборки

## Выявленные проблемы

### 1. Неправильный путь импорта
**Файл:** `src/components/admin/payments/ReconcileFileDialog.tsx`
**Строка 14:**
```tsx
// НЕПРАВИЛЬНО:
import { useAuth } from "@/context/AuthContext";

// ПРАВИЛЬНО:
import { useAuth } from "@/contexts/AuthContext";
```

### 2. Несуществующее поле `profile`
**Файл:** `src/components/admin/payments/ReconcileFileDialog.tsx`
**Строка 161:**
```tsx
// НЕПРАВИЛЬНО:
const { user, profile } = useAuth();

// ПРАВИЛЬНО (согласно AuthContext.tsx):
const { user, role } = useAuth();
```

**Также строки 173-176:**
```tsx
// НЕПРАВИЛЬНО:
const whoami = useMemo(() => ({
  email: user?.email || profile?.email || 'unknown',
  uid: user?.id || 'unknown',
  roles: profile?.role || 'user',
}), [user, profile]);

// ПРАВИЛЬНО:
const whoami = useMemo(() => ({
  email: user?.email || 'unknown',
  uid: user?.id || 'unknown',
  roles: role || 'user',
}), [user, role]);
```

---

## Файлы для изменения

| Файл | Строка | Изменение |
|------|--------|-----------|
| `ReconcileFileDialog.tsx` | 14 | Исправить путь: `@/context/` → `@/contexts/` |
| `ReconcileFileDialog.tsx` | 161 | Заменить `profile` на `role` |
| `ReconcileFileDialog.tsx` | 173-176 | Обновить `whoami` — использовать `role` вместо `profile` |

---

## Также: Проверка дизайна карточек

По скриншоту видно, что карточки уже используют новый дизайн, но текст "BYN" всё ещё может обрезаться на мобильных устройствах.

**Дополнительное улучшение в `PaymentsStatsPanel.tsx`:**
- Уменьшить размер суммы на мобильных: `text-2xl md:text-3xl`
- Добавить `min-w-0` для предотвращения overflow

---

## Порядок исправления

1. Исправить импорт `@/contexts/AuthContext`
2. Заменить `profile` на `role` в destructuring
3. Обновить `whoami` useMemo
4. Проверить, что сборка проходит

